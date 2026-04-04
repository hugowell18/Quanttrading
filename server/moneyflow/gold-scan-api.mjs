/**
 * 金柱选股 API
 *
 * GET /api/gold-scan?date=YYYYMMDD&threshold=0.81   单日扫描（SSE）
 * GET /api/gold-scan/history?threshold=0.81          全历史（SSE，有本地缓存）
 * GET /api/gold-scan/history-cache                   直接返回已缓存的历史结果
 * GET /api/gold-scan/watchlist                       可扫描股票列表
 */

import { Router } from 'express';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '../logger.mjs';
import { ensureMoneyflow } from './moneyflow-fetcher.mjs';
import { calculateDivergenceScores } from './moneyflow-calculator.mjs';

const log       = createLogger('gold-scan');
const KLINE_DIR = resolve(process.cwd(), 'cache', 'kline');
const MF_DIR    = resolve(process.cwd(), 'cache', 'moneyflow');
const CACHE_DIR = resolve(process.cwd(), 'cache');
const HIST_CACHE_PATH = resolve(CACHE_DIR, 'gold-scan-history.json');

export const goldScanRouter = Router();

const CONCURRENCY = 5;

// ─── 股票名称映射（从 realtime stocks JSON 读取）──────────────────────────────

let _nameMap = null;
function getNameMap() {
  if (_nameMap) return _nameMap;
  _nameMap = new Map();
  try {
    const dir = resolve(process.cwd(), 'cache', 'realtime');
    if (!existsSync(dir)) return _nameMap;
    // 找最新的 stocks_*.json
    const files = readdirSync(dir)
      .filter(f => f.startsWith('stocks_') && f.endsWith('.json'))
      .sort().reverse();
    if (!files.length) return _nameMap;
    const raw = readFileSync(resolve(dir, files[0]), 'utf8');
    const json = JSON.parse(raw);
    const arr = Array.isArray(json) ? json : (json.data ?? []);
    for (const item of arr) {
      if (item.code && item.name) _nameMap.set(item.code, item.name);
    }
    log.info(`name map loaded: ${_nameMap.size} stocks`);
  } catch (e) {
    log.warn('name map load failed', { error: e.message });
  }
  return _nameMap;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getWatchlist() {
  if (!existsSync(KLINE_DIR)) return [];
  return readdirSync(KLINE_DIR)
    .filter(f => /^\d{6}\.(SH|SZ)\.csv$/.test(f))
    .map(f => f.replace('.csv', ''));  // tsCode list
}

function readKline(tsCode) {
  const fp = resolve(KLINE_DIR, `${tsCode}.csv`);
  if (!existsSync(fp)) return [];
  const [, ...lines] = readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  return lines.filter(Boolean).map(line => {
    const p = line.split(',');
    const d = p[0];
    return {
      date:   `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`,
      open:   Number(p[1]), high: Number(p[2]),
      low:    Number(p[3]), close: Number(p[4]),
      volume: Number(p[6]),
    };
  });
}

// 只读本地缓存，不触发网络请求
function readMfCached(tsCode) {
  const fp = resolve(MF_DIR, `${tsCode}.csv`);
  if (!existsSync(fp)) return [];
  const [, ...lines] = readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  return lines.filter(Boolean).map(line => {
    const [trade_date, buy_elg_amount, sell_elg_amount, buy_lg_amount,
           sell_lg_amount, buy_sm_amount, sell_sm_amount] = line.split(',');
    return {
      trade_date,
      buy_elg_amount:  Number(buy_elg_amount),
      sell_elg_amount: Number(sell_elg_amount),
      buy_lg_amount:   Number(buy_lg_amount),
      sell_lg_amount:  Number(sell_lg_amount),
      buy_sm_amount:   Number(buy_sm_amount),
      sell_sm_amount:  Number(sell_sm_amount),
    };
  });
}

function calcForwardReturn(kline, dateCompact, days) {
  const idx = kline.findIndex(k => k.date.replace(/-/g, '') === dateCompact);
  if (idx < 0 || idx + days >= kline.length) return null;
  return (kline[idx + days].close - kline[idx].close) / kline[idx].close;
}

function makeHit(tsCode, s, kline) {
  const nameMap = getNameMap();
  const code    = tsCode.split('.')[0];
  const name    = nameMap.get(code) ?? code;
  const dayIdx  = kline.findIndex(k => k.date.replace(/-/g, '') === s.date);
  const kDay    = dayIdx >= 0 ? kline[dayIdx] : null;
  const prevDay = dayIdx > 0  ? kline[dayIdx - 1] : null;
  const pctChange = (kDay && prevDay && prevDay.close > 0)
    ? (kDay.close - prevDay.close) / prevDay.close : null;
  return {
    tsCode, code, name,
    date:            `${s.date.slice(0,4)}-${s.date.slice(4,6)}-${s.date.slice(6,8)}`,
    divergenceScore: s.divergence_score,
    largeNet:        s.large_net,   // 单位：万元，直接展示
    pctChange,
    ret3d:  calcForwardReturn(kline, s.date, 3),
    ret5d:  calcForwardReturn(kline, s.date, 5),
    ret10d: calcForwardReturn(kline, s.date, 10),
  };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function runBatched(items, fn) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

// ─── GET /api/gold-scan/watchlist ────────────────────────────────────────────

goldScanRouter.get('/watchlist', (_req, res) => {
  const list = getWatchlist();
  res.json({ ok: true, total: list.length });
});

// ─── GET /api/gold-scan/history-cache ────────────────────────────────────────
// 直接返回已缓存的历史结果，不重新计算

goldScanRouter.get('/history-cache', (req, res) => {
  const threshold = parseFloat(req.query.threshold ?? '0.81');
  if (!existsSync(HIST_CACHE_PATH)) {
    return res.json({ ok: false, cached: false });
  }
  try {
    const cache = JSON.parse(readFileSync(HIST_CACHE_PATH, 'utf8'));
    if (cache.threshold !== threshold) {
      return res.json({ ok: false, cached: false, reason: 'threshold_mismatch' });
    }
    log.info('serving history from cache', { hits: cache.hits?.length });
    return res.json({ ok: true, cached: true, ...cache });
  } catch {
    return res.json({ ok: false, cached: false });
  }
});

// ─── GET /api/gold-scan?date=YYYYMMDD&threshold=0.81 ─────────────────────────
// 单日扫描，优先用本地 moneyflow 缓存，没有才拉取

goldScanRouter.get('/', async (req, res) => {
  const dateParam = req.query.date;
  const threshold = parseFloat(req.query.threshold ?? '0.81');

  if (!dateParam || !/^\d{8}$/.test(dateParam)) {
    return res.status(400).json({ ok: false, error: 'date=YYYYMMDD 必填' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const watchlist = getWatchlist();
  let scanned = 0, hits = 0;
  sseWrite(res, 'start', { total: watchlist.length, date: dateParam, threshold });

  await runBatched(watchlist, async (tsCode) => {
    try {
      const kline = readKline(tsCode);
      if (!kline.length) return;

      const cutoffIdx = kline.findIndex(k => k.date.replace(/-/g, '') > dateParam);
      const sliceEnd  = cutoffIdx < 0 ? kline.length : Math.min(cutoffIdx + 11, kline.length);
      const klineForCalc = kline.slice(0, sliceEnd);

      // 优先本地缓存，没有才网络拉取
      const mfData = existsSync(resolve(MF_DIR, `${tsCode}.csv`))
        ? readMfCached(tsCode)
        : await ensureMoneyflow(tsCode, dateParam);

      const scores = calculateDivergenceScores(klineForCalc, mfData);
      const hit    = scores.find(s => s.date === dateParam);
      if (hit && hit.divergence_score >= threshold) {
        hits++;
        sseWrite(res, 'hit', makeHit(tsCode, hit, kline));
      }
    } catch { /* skip */ }

    scanned++;
    if (scanned % 20 === 0 || scanned === watchlist.length) {
      sseWrite(res, 'progress', { scanned, total: watchlist.length, hits });
    }
  });

  log.info(`gold-scan ${dateParam}`, { threshold, scanned, hits });
  sseWrite(res, 'done', { scanned, total: watchlist.length, hits });
  res.end();
});

// ─── GET /api/gold-scan/history?threshold=0.81 ───────────────────────────────
// 全历史扫描，完成后写入本地缓存，下次直接读

goldScanRouter.get('/history', async (req, res) => {
  const threshold  = parseFloat(req.query.threshold ?? '0.81');
  const forceRegen = req.query.force === '1';

  // 有缓存且阈值匹配，直接返回（非SSE）
  if (!forceRegen && existsSync(HIST_CACHE_PATH)) {
    try {
      const cache = JSON.parse(readFileSync(HIST_CACHE_PATH, 'utf8'));
      if (cache.threshold === threshold) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        sseWrite(res, 'start', { total: cache.hits.length, threshold, fromCache: true });
        for (const h of cache.hits) sseWrite(res, 'hit', h);
        sseWrite(res, 'done', { scanned: cache.scanned, total: cache.scanned, hits: cache.hits.length, fromCache: true });
        res.end();
        log.info('history served from cache', { hits: cache.hits.length });
        return;
      }
    } catch { /* regenerate */ }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 只扫有 moneyflow 缓存的股票（不触发网络请求，纯本地计算）
  const watchlist = readdirSync(MF_DIR)
    .filter(f => /^\d{6}\.(SH|SZ)\.csv$/.test(f))
    .map(f => f.replace('.csv', ''));

  let scanned = 0;
  const allHits = [];
  sseWrite(res, 'start', { total: watchlist.length, threshold });

  await runBatched(watchlist, async (tsCode) => {
    try {
      const kline  = readKline(tsCode);
      const mfData = readMfCached(tsCode);
      if (!kline.length || !mfData.length) return;

      const scores = calculateDivergenceScores(kline, mfData);
      for (const s of scores) {
        if (s.divergence_score < threshold) continue;
        const h = makeHit(tsCode, s, kline);
        allHits.push(h);
        sseWrite(res, 'hit', h);
      }
    } catch { /* skip */ }

    scanned++;
    if (scanned % 50 === 0 || scanned === watchlist.length) {
      sseWrite(res, 'progress', { scanned, total: watchlist.length, hits: allHits.length });
    }
  });

  // 写入本地缓存
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(HIST_CACHE_PATH, JSON.stringify({
      threshold,
      scanned,
      generatedAt: new Date().toISOString(),
      hits: allHits,
    }), 'utf8');
    log.info('history cache saved', { hits: allHits.length });
  } catch (e) {
    log.warn('history cache write failed', { error: e.message });
  }

  log.info('gold-scan history done', { threshold, scanned, hits: allHits.length });
  sseWrite(res, 'done', { scanned, total: watchlist.length, hits: allHits.length });
  res.end();
});
