import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { optimize } from './reverse-label/optimizer.mjs';
import { ensureSymbolCsv } from './data/csv-manager.mjs';

const app = express();
const PORT = 3001;
const SUMMARY_PATH = resolve(process.cwd(), 'results', 'batch', 'summary.json');
const KLINE_DIR = resolve(process.cwd(), 'cache', 'kline');
const SENTIMENT_DIR = resolve(process.cwd(), 'cache', 'sentiment');
const SENTIMENT_STATE_PATH = resolve(process.cwd(), 'cache', 'sentiment-state', 'state-history.json');
const ZTPOOL_DIR = resolve(process.cwd(), 'cache', 'ztpool');

app.use(cors());
app.use(express.json());

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a kline CSV file and return an array of IndexKLinePoint objects.
 * @param {string} filePath
 * @returns {{ date: string, open: number, high: number, low: number, close: number, volume: number }[]}
 */
const parseKlineCsv = (filePath) => {
  const text = readFileSync(filePath, 'utf8').trim();
  const [_header, ...lines] = text.split(/\r?\n/);
  return lines
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',');
      return {
        date: parts[0],
        open: Number(parts[1]),
        high: Number(parts[2]),
        low: Number(parts[3]),
        close: Number(parts[4]),
        volume: Number(parts[6]),
      };
    });
};

/**
 * Scan a directory and return sorted YYYYMMDD date strings extracted from JSON filenames.
 * @param {string} dir
 * @returns {string[]}
 */
const scanDatesFromDir = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^(\d{8})\.json$/)?.[1])
    .filter(Boolean)
    .sort();
};

// ─── Existing endpoints ──────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/batch/summary', (_req, res) => {
  if (!existsSync(SUMMARY_PATH)) {
    return res.status(404).json({ ok: false, error: '批量结果不存在，请先运行 batch-runner。' });
  }

  const raw = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
  // Support both legacy array format and new { strictPassed, weakPassed, failed, total } format
  let items;
  if (Array.isArray(raw)) {
    items = raw;
  } else if (Array.isArray(raw.strictPassed)) {
    // Merge strictPassed + weakPassed, preserving strictPass field
    items = [...(raw.strictPassed || []), ...(raw.weakPassed || [])];
  } else {
    items = [];
  }
  // 统一字段：summary.json 存的是 code/name，前端期望 stockCode/stockName
  const normalized = items.map((item) => ({
    ...item,
    stockCode: item.stockCode ?? item.code,
    stockName: item.stockName ?? item.name,
  }));
  return res.json({ ok: true, data: normalized });
});

app.get('/api/analyze/:code', async (req, res) => {
  const { code } = req.params;
  const forceRefresh = req.query.refresh === '1';
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tsCode = /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;

  // ── Helper: build kline — 返回 CSV 全量历史，不按交易日截断 ──────────────
  const buildKline = (_trades) => {
    const fp = resolve(KLINE_DIR, `${tsCode}.csv`);
    if (!existsSync(fp)) return [];
    const candles = parseKlineCsv(fp);
    return candles.map(c => ({
      ...c,
      date: `${c.date.slice(0,4)}-${c.date.slice(4,6)}-${c.date.slice(6,8)}`,
    }));
  };

  // ── Helper: run optimizer + flatten + write back to summary ────────────
  const runFull = async () => {
    // 1. Incremental CSV update
    try {
      const r = await ensureSymbolCsv(tsCode, 'stock');
      console.log(`[analyze] ${code} CSV rows=${r.rows} appended=${r.appended ?? 0}`);
    } catch (e) {
      console.warn(`[analyze] ${code} CSV update failed: ${e.message}`);
    }

    // 2. Full optimizer run — unlock final partition to get 2022-today trades
    console.log(`[analyze] ${code} running optimizer...`);
    const raw = await optimize(code, '20050101', todayStr, { unlockTest: true });
    const br = raw.bestResult;
    // Combine all partitions for complete trade history
    const allTrades = [
      ...(br?.trainValidation?.trades ?? []),
      ...(br?.validation?.trades ?? []),
      ...(br?.stress?.trades ?? []),
      ...(Array.isArray(br?.final?.trades) ? br.final.trades : []),
    ].sort((a, b) => b.buyDate.localeCompare(a.buyDate));
    const wins = allTrades.filter(t => t.return > 0);
    const flatBestResult = br ? {
      stopLossRate: br.validation?.stopLossRate ?? 0,
      avgReturn: allTrades.length ? allTrades.reduce((s, t) => s + t.return, 0) / allTrades.length : (br.validation?.avgReturn ?? 0),
      totalTrades: allTrades.length,
      winRate: allTrades.length ? wins.length / allTrades.length : (br.validation?.winRate ?? 0),
      maxDrawdown: Math.min(br.validation?.maxDrawdown ?? 0, br.stress?.maxDrawdown ?? 0),
      avgStopLossPct: br.validation?.avgStopLossPct ?? 0,
      buyCount: br.trainBuyCount ?? 0,
      skippedByEnvironment: br.validation?.skippedByEnvironment ?? 0,
      skippedByMarket: br.validation?.skippedByMarket ?? 0,
      trades: allTrades,
    } : null;

    const newItem = {
      code,
      name: raw.stockName ?? code,
      bestConfig: raw.bestConfig,
      currentSignal: raw.currentSignal,
      strictPass: (raw.stats?.validCombinations ?? 0) > 0,
      bestResult: flatBestResult,
      valid: true,
      lastUpdated: todayStr,
    };

    // 3. Write back to summary.json
    try {
      let s = existsSync(SUMMARY_PATH)
        ? JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'))
        : { strictPassed: [], weakPassed: [], failed: [], total: 0 };
      if (!s.strictPassed) s = { strictPassed: [], weakPassed: [], failed: [], total: 0 };
      for (const k of ['strictPassed', 'weakPassed', 'failed']) {
        s[k] = (s[k] || []).filter(x => x.code !== code);
      }
      if (newItem.strictPass) s.strictPassed.push(newItem);
      else if ((flatBestResult?.totalTrades ?? 0) > 0) s.weakPassed.push(newItem);
      else s.failed.push({ code, name: raw.stockName ?? code, valid: false, lastUpdated: todayStr });
      s.total = s.strictPassed.length + s.weakPassed.length + s.failed.length;
      writeFileSync(SUMMARY_PATH, JSON.stringify(s, null, 2), 'utf8');
      console.log(`[analyze] ${code} written to summary.json`);
    } catch (e) {
      console.warn(`[analyze] failed to write summary: ${e.message}`);
    }

    return { ...newItem, stockCode: code, stockName: newItem.name, kline: buildKline(allTrades) };
  };

  try {
    // ── Check summary for existing entry ──────────────────────────────────
    if (existsSync(SUMMARY_PATH)) {
      const s = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
      const all = [
        ...(s.strictPassed || []),
        ...(s.weakPassed || []),
        ...(s.failed || []),
        ...(Array.isArray(s) ? s : []),
      ];
      const item = all.find(x => x.code === code);

      if (item && item.valid !== false) {
        const isUpToDate = item.lastUpdated === todayStr;

        if (!forceRefresh && isUpToDate) {
          // Data is fresh today — serve immediately
          console.log(`[analyze] ${code} up-to-date, serving from summary`);
          const trades = item.bestResult?.trades ?? [];
          return res.json({ ...item, stockCode: code, stockName: item.name, kline: buildKline(trades) });
        }

        // Data is stale (or force refresh) — update CSV + re-run optimizer
        console.log(`[analyze] ${code} stale (${item.lastUpdated ?? 'unknown'}), refreshing...`);
      } else {
        console.log(`[analyze] ${code} not in summary, running full analysis...`);
      }
    } else {
      console.log(`[analyze] ${code} no summary.json, running full analysis...`);
    }

    const result = await runFull();
    return res.json(result);

  } catch (error) {
    console.error(`[analyze] ${code} failed: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// ─── 1.1 GET /api/market/kline/:code ────────────────────────────────────────

app.get('/api/market/kline/:code', (req, res) => {
  try {
    const { code } = req.params;
    const filePath = resolve(KLINE_DIR, `${code}.csv`);
    if (!existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: `K线文件不存在: ${code}` });
    }
    const data = parseKlineCsv(filePath);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.2 GET /api/sentiment/metrics?date=YYYYMMDD ───────────────────────────

app.get('/api/sentiment/metrics', (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ ok: false, error: '缺少 date 参数' });
    }
    const filePath = resolve(SENTIMENT_DIR, `${date}.json`);
    if (!existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: `情绪数据不存在: ${date}` });
    }
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.3 GET /api/sentiment/state-history ───────────────────────────────────

app.get('/api/sentiment/state-history', (_req, res) => {
  try {
    if (!existsSync(SENTIMENT_STATE_PATH)) {
      return res.status(404).json({ ok: false, error: '情绪状态历史文件不存在' });
    }
    const data = JSON.parse(readFileSync(SENTIMENT_STATE_PATH, 'utf8'));
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.5 GET /api/ztpool/dates (must be before /api/ztpool) ─────────────────

app.get('/api/ztpool/dates', (_req, res) => {
  try {
    const dates = scanDatesFromDir(ZTPOOL_DIR);
    return res.json({ ok: true, data: dates });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.4 GET /api/ztpool?date=YYYYMMDD ──────────────────────────────────────

app.get('/api/ztpool', (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ ok: false, error: '缺少 date 参数' });
    }
    const filePath = resolve(ZTPOOL_DIR, `${date}.json`);
    if (!existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: `涨停池数据不存在: ${date}` });
    }
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.6 GET /api/admin/kline/list (must be before /api/admin/kline/:code) ──

app.get('/api/admin/kline/list', (_req, res) => {
  try {
    if (!existsSync(KLINE_DIR)) {
      return res.json({ ok: true, data: [] });
    }
    const files = readdirSync(KLINE_DIR).filter((f) => f.endsWith('.csv'));
    return res.json({ ok: true, data: files });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.7 GET /api/admin/kline/:code ─────────────────────────────────────────

app.get('/api/admin/kline/:code', (req, res) => {
  try {
    const { code } = req.params;
    const filePath = resolve(KLINE_DIR, `${code}.csv`);
    if (!existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: `K线文件不存在: ${code}` });
    }
    const rows = parseKlineCsv(filePath);
    const data = rows.slice(-30);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.8 GET /api/admin/ztpool/list ─────────────────────────────────────────

app.get('/api/admin/ztpool/list', (_req, res) => {
  try {
    const dates = scanDatesFromDir(ZTPOOL_DIR);
    return res.json({ ok: true, data: dates });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.9 GET /api/admin/sentiment/list ──────────────────────────────────────

app.get('/api/admin/sentiment/list', (_req, res) => {
  try {
    if (!existsSync(SENTIMENT_DIR)) {
      return res.json({ ok: true, data: [] });
    }
    const files = readdirSync(SENTIMENT_DIR)
      .filter((f) => /^\d{8}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, 60);

    const data = files
      .map((f) => {
        try {
          return JSON.parse(readFileSync(resolve(SENTIMENT_DIR, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse(); // return in ascending date order

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 1.10 Startup: ensure index kline CSVs exist ────────────────────────────

const INDEX_SYMBOLS = [
  { tsCode: '000001.SH', securityType: 'index' },
  { tsCode: '399001.SZ', securityType: 'index' },
  { tsCode: '399006.SZ', securityType: 'index' },
];

const ensureIndexKlines = async () => {
  for (const { tsCode, securityType } of INDEX_SYMBOLS) {
    const filePath = resolve(KLINE_DIR, `${tsCode}.csv`);
    if (!existsSync(filePath)) {
      console.log(`[startup] 缺少指数K线文件 ${tsCode}，正在拉取...`);
      try {
        const result = await ensureSymbolCsv(tsCode, securityType);
        console.log(`[startup] ${tsCode} 拉取完成，共 ${result.rows} 行`);
      } catch (err) {
        console.error(`[startup] ${tsCode} 拉取失败: ${err.message}`);
      }
    }
  }
};

// ─── Start server ────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log('\nQuantPulse API started');
  console.log(`  http://localhost:${PORT}/api/status`);
  console.log(`  http://localhost:${PORT}/api/batch/summary`);
  console.log(`  http://localhost:${PORT}/api/analyze/600519`);
  console.log(`  http://localhost:${PORT}/api/market/kline/000300.SH`);
  console.log(`  http://localhost:${PORT}/api/sentiment/metrics?date=20260327`);
  console.log(`  http://localhost:${PORT}/api/sentiment/state-history`);
  console.log(`  http://localhost:${PORT}/api/ztpool?date=20260327`);
  console.log(`  http://localhost:${PORT}/api/ztpool/dates`);
  await ensureIndexKlines();
});
