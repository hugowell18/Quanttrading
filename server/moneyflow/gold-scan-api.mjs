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
    const bea = Number(buy_elg_amount);
    const sea = Number(sell_elg_amount);
    const bla = Number(buy_lg_amount);
    const sla = Number(sell_lg_amount);
    return {
      trade_date,
      buy_elg_amount:  bea,
      sell_elg_amount: sea,
      buy_lg_amount:   bla,
      sell_lg_amount:  sla,
      buy_sm_amount:   Number(buy_sm_amount),
      sell_sm_amount:  Number(sell_sm_amount),
      // 大单净流入 = 超大单+大单 买-卖（万元）
      large_net: Number(((bea + bla) - (sea + sla)).toFixed(2)),
    };
  });
}

// ── T-3 到 T-1 大单趋势（区分洗盘底 vs 出货底）────────────────────────────────
function calcT3LargeNet(mfData, signalDate) {
  const idx = mfData.findIndex(r => r.trade_date === signalDate);
  if (idx < 3) return { t3LargeNetSum: null, t3Trend: null };

  const nets = [
    mfData[idx - 3].large_net,  // T-3
    mfData[idx - 2].large_net,  // T-2
    mfData[idx - 1].large_net,  // T-1
  ];
  const t3LargeNetSum = Number((nets[0] + nets[1] + nets[2]).toFixed(2));

  // T-3 → T-2 → T-1 逐日递增 = 建仓蓄势；逐日递减 = 边跌边出
  let t3Trend;
  if (nets[0] <= nets[1] && nets[1] <= nets[2]) t3Trend = 'accumulating';
  else if (nets[0] >= nets[1] && nets[1] >= nets[2]) t3Trend = 'distributing';
  else t3Trend = 'mixed';

  return { t3LargeNetSum, t3Trend };
}

// ── 下影线结构（收盘在振幅的位置 = 日内承接强度）────────────────────────────────
function calcShadowStructure(kDay) {
  if (!kDay) return { lowerShadowRatio: null, closePosition: null };
  const { open, high, low, close } = kDay;
  const totalRange = high - low;
  if (totalRange === 0) return { lowerShadowRatio: 0, closePosition: 0.5 };
  const bodyBottom = Math.min(open, close);
  return {
    // 下影线占全日振幅的比例（越大 = 日内反抽越强）
    lowerShadowRatio: Number(((bodyBottom - low) / totalRange).toFixed(4)),
    // 收盘在振幅中的位置 0=收在最低 1=收在最高（>=0.4 代表有效承接）
    closePosition:    Number(((close - low) / totalRange).toFixed(4)),
  };
}

function calcForwardReturn(kline, dateCompact, days) {
  const idx = kline.findIndex(k => k.date.replace(/-/g, '') === dateCompact);
  if (idx < 0 || idx + days >= kline.length) return null;
  return (kline[idx + days].close - kline[idx].close) / kline[idx].close;
}

// ─── MA 计算 ──────────────────────────────────────────────────────────────────

function calcMA(kline, endIdx, period) {
  if (endIdx < period - 1) return null;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += kline[i].close;
  return sum / period;
}

// ─── 两层过滤器 ───────────────────────────────────────────────────────────────

/**
 * 过滤器 A：趋势生命线
 * 收盘价 >= MA60（季线）或 >= MA250（年线）
 * 只在上升趋势中的洗盘坑抄底，拒绝漫漫熊途
 */
function passFilterA(kline, dayIdx) {
  const ma60  = calcMA(kline, dayIdx, 60);
  const ma250 = calcMA(kline, dayIdx, 250);
  const close = kline[dayIdx].close;
  const aboveMa60  = ma60  !== null && close >= ma60;
  const aboveMa250 = ma250 !== null && close >= ma250;
  return {
    pass: aboveMa60 && aboveMa250,   // AND：必须同时站上 MA60 和 MA250
    ma60:  ma60  !== null ? Number(ma60.toFixed(3))  : null,
    ma250: ma250 !== null ? Number(ma250.toFixed(3)) : null,
    aboveMa60,
    aboveMa250,
  };
}

/**
 * 过滤器 B：T+1 右侧确认
 * 次日收盘 > 金柱当日收盘，证明资金流入有效，多头收复失地
 * 若 T+1 数据不存在（当天信号），返回 pending
 */
function passFilterB(kline, dayIdx) {
  if (dayIdx + 1 >= kline.length) return { pass: null, status: 'pending' };
  const t0Close = kline[dayIdx].close;
  const t1Close = kline[dayIdx + 1].close;
  const t1Pct   = (t1Close - t0Close) / t0Close;
  return {
    pass:    t1Close > t0Close,
    status:  t1Close > t0Close ? 'confirmed' : 'rejected',
    t1Close: Number(t1Close.toFixed(3)),
    t1Pct:   Number(t1Pct.toFixed(4)),
  };
}

function makeHit(tsCode, s, kline, mfData = []) {
  const nameMap = getNameMap();
  const code    = tsCode.split('.')[0];
  const name    = nameMap.get(code) ?? code;
  const dayIdx  = kline.findIndex(k => k.date.replace(/-/g, '') === s.date);
  const kDay    = dayIdx >= 0 ? kline[dayIdx] : null;
  const prevDay = dayIdx > 0  ? kline[dayIdx - 1] : null;
  const pctChange = (kDay && prevDay && prevDay.close > 0)
    ? (kDay.close - prevDay.close) / prevDay.close : null;

  const filterA = dayIdx >= 0 ? passFilterA(kline, dayIdx) : { pass: false, ma60: null, ma250: null };
  const filterB = dayIdx >= 0 ? passFilterB(kline, dayIdx) : { pass: null, status: 'pending' };

  const confirmed = filterA.pass === true && filterB.pass === true;
  const pending   = filterA.pass === true && filterB.status === 'pending';

  const buyIdx  = dayIdx >= 0 ? dayIdx + 1 : -1;
  const buyDate = (buyIdx >= 0 && buyIdx < kline.length)
    ? kline[buyIdx].date.replace(/-/g, '') : '';
  const ret3d  = confirmed && buyDate ? calcForwardReturn(kline, buyDate, 3)  : null;
  const ret5d  = confirmed && buyDate ? calcForwardReturn(kline, buyDate, 5)  : null;
  const ret10d = confirmed && buyDate ? calcForwardReturn(kline, buyDate, 10) : null;

  // ── 新增：时序结构因子 ──────────────────────────────────────────────────────
  const t3           = calcT3LargeNet(mfData, s.date);
  const shadow       = calcShadowStructure(kDay);

  return {
    tsCode, code, name,
    date:            `${s.date.slice(0,4)}-${s.date.slice(4,6)}-${s.date.slice(6,8)}`,
    divergenceScore: s.divergence_score,
    largeNet:        s.large_net,
    pctChange,
    filterA, filterB,
    confirmed,
    pending,
    ret3d, ret5d, ret10d,
    // ── 第三层因子 ──────────────────────────────────────────────────────────
    // 前3日大单趋势（区分洗盘蓄势 vs 边跌边出）
    t3LargeNetSum:   t3.t3LargeNetSum,    // T-3~T-1 大单净流入合计（万元）
    t3Trend:         t3.t3Trend,          // 'accumulating'|'distributing'|'mixed'|null
    // 下影线结构（日内有效承接强度）
    lowerShadowRatio: shadow.lowerShadowRatio,  // 下影线/振幅 [0,1]
    closePosition:    shadow.closePosition,      // 收盘位置 [0,1]，>=0.4 为有效承接
    // 市场宽度（同日触发金柱数），由外部后处理填入
    marketBreadth:   null,
  };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // 强制刷新缓冲区，确保数据立即发出（纯本地计算时事件循环不会自动 flush）
  if (typeof res.flush === 'function') res.flush();
}

// 批次间 yield 一次事件循环，避免 CPU 密集计算阻塞 SSE 推送
const yieldToEventLoop = () => new Promise(r => setImmediate(r));

async function runBatched(items, fn) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
    await yieldToEventLoop();
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
        sseWrite(res, 'hit', makeHit(tsCode, hit, kline, mfData));
      }
    } catch { /* skip */ }

    scanned++;
    if (scanned % 20 === 0 || scanned === watchlist.length) {
      sseWrite(res, 'progress', { scanned, total: watchlist.length, hits });
    }
  });

  // 单日扫描：同一日期的所有命中数即为市场宽度
  const dateFormatted = `${dateParam.slice(0,4)}-${dateParam.slice(4,6)}-${dateParam.slice(6,8)}`;
  log.info(`gold-scan ${dateParam}`, { threshold, scanned, hits });
  sseWrite(res, 'done', { scanned, total: watchlist.length, hits, breadthByDate: { [dateFormatted]: hits } });
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
        // 分批推送缓存数据，每批 yield 一次避免阻塞
        for (let i = 0; i < cache.hits.length; i++) {
          sseWrite(res, 'hit', cache.hits[i]);
          if (i % 100 === 99) await yieldToEventLoop();
        }
        const breadthByDate = {};
        for (const h of cache.hits) breadthByDate[h.date] = (breadthByDate[h.date] ?? 0) + 1;
        sseWrite(res, 'done', { scanned: cache.scanned, total: cache.scanned, hits: cache.hits.length, fromCache: true, breadthByDate });
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
        const h = makeHit(tsCode, s, kline, mfData);
        allHits.push(h);
        sseWrite(res, 'hit', h);
      }
    } catch { /* skip */ }

    scanned++;
    if (scanned % 5 === 0 || scanned === watchlist.length) {
      sseWrite(res, 'progress', { scanned, total: watchlist.length, hits: allHits.length });
    }
  });

  // ── 市场宽度后处理：统计每日触发金柱数，回填 marketBreadth ─────────────────
  const breadthByDate = {};
  for (const h of allHits) breadthByDate[h.date] = (breadthByDate[h.date] ?? 0) + 1;
  for (const h of allHits) h.marketBreadth = breadthByDate[h.date];

  // 写入本地缓存（含 marketBreadth）
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
  sseWrite(res, 'done', { scanned, total: watchlist.length, hits: allHits.length, breadthByDate });
  res.end();
});
