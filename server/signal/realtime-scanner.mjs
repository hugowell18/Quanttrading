import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureSymbolCsv, readDaily } from '../data/csv-manager.mjs';
import { optimize } from '../reverse-label/optimizer.mjs';

const ROOT = process.cwd();
const SIGNAL_DIR = resolve(ROOT, 'server', 'signal');
const PYTHON_SCRIPT = resolve(SIGNAL_DIR, 'fetch_realtime.py');
const REALTIME_CACHE_DIR = resolve(ROOT, 'cache', 'realtime');
const RESEARCH_CACHE_DIR = resolve(ROOT, 'cache', 'research');
const KLINE_DIR = resolve(ROOT, 'cache', 'kline');
const PYTHON_BIN = process.env.PYTHON || 'python';
const SELF_PATH = resolve(ROOT, 'server', 'signal', 'realtime-scanner.mjs');
const CACHE_TTL_MS = 30 * 60 * 1000;
const HS300_CODE = '000300.SH';
const CONFIRM_BASELINE_PATH = (dateKey) => resolve(REALTIME_CACHE_DIR, `candidates_${dateKey}_1430.json`);
const TEST_DATES = [
  '20240115',
  '20240319',
  '20230601',
  '20230901',
  '20231101',
  '20220601',
  '20240601',
  '20240701',
  '20240819',
  '20240924',
];

const REPLAY_BOARDS = [
  { code: 'BK1136', name: '光通信模块' },
  { code: 'BK1166', name: '低空经济' },
  { code: 'BK1184', name: '人形机器人' },
  { code: 'BK0968', name: '固态电池' },
  { code: 'BK0490', name: '军工' },
];

mkdirSync(REALTIME_CACHE_DIR, { recursive: true });

const args = process.argv.slice(2);
const isConfirmMode = args.includes('--confirm');
const isForceMode = args.includes('--force');
const isBacktestMode = args.includes('--backtest');
const isBatchBacktestMode = args.includes('--batch-backtest');
const isJsonSummaryMode = args.includes('--json-summary');
const isFindSignalDaysMode = args.includes('--find-signal-days');
const isNonBullBacktestMode = args.includes('--non-bull-backtest');
const replayIndex = args.indexOf('--replay-date');
const replayDate = replayIndex >= 0 ? args[replayIndex + 1] : null;
const now = new Date();
const liveDateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
const dateKey = replayDate || liveDateKey;
const timeKey = replayDate
  ? `${replayDate.slice(0, 4)}-${replayDate.slice(4, 6)}-${replayDate.slice(6, 8)} 回放`
  : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pct = (value, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
const humanAmount = (amount) => {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(0)}亿`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}万`;
  return `${amount.toFixed(0)}`;
};
const toTsCode = (code) => (code.includes('.') ? code.toUpperCase() : (/^6/.test(code) ? `${code}.SH` : `${code}.SZ`));
const isHistoricalScan = (scanDate) => Boolean(replayDate || isBatchBacktestMode || isJsonSummaryMode || scanDate !== liveDateKey);

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function isFresh(filePath) {
  if (!existsSync(filePath)) return false;
  return Date.now() - statSync(filePath).mtimeMs <= CACHE_TTL_MS;
}

function runPythonRealtime(type, name = '') {
  const argsLocal = [PYTHON_SCRIPT, '--type', type];
  if (name) argsLocal.push('--name', name);
  const output = execFileSync(PYTHON_BIN, argsLocal, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const payload = JSON.parse(output);
  if (!payload?.ok) throw new Error(payload?.error || '实时数据脚本返回失败');
  return payload.data || [];
}

function loadRealtimeCached(kind, loader) {
  const filePath = resolve(REALTIME_CACHE_DIR, `${kind}_${liveDateKey}.json`);
  if (isFresh(filePath)) {
    return readJson(filePath, { data: [] })?.data || [];
  }
  const data = loader();
  writeJson(filePath, { fetchedAt: Date.now(), data });
  return data;
}

function loadLiveBoardData() {
  return loadRealtimeCached('boards', () => runPythonRealtime('boards'));
}

function loadLiveStockData() {
  return loadRealtimeCached('stocks', () => runPythonRealtime('stocks'));
}

function loadLiveZtPool() {
  return loadRealtimeCached('ztpool', () => runPythonRealtime('ztpool'));
}

function loadBoardConstituents(boardName, scanDate = dateKey) {
  if (isHistoricalScan(scanDate)) {
    const matched = REPLAY_BOARDS.find((item) => item.name === boardName);
    if (!matched) return [];
    const payload = readJson(resolve(RESEARCH_CACHE_DIR, `concept_cons_${matched.code}.json`), { data: { diff: [] } });
    return (payload?.data?.diff || []).map((item) => ({ code: String(item.f12), name: item.f14 }));
  }
  const safeName = boardName.replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
  const filePath = resolve(REALTIME_CACHE_DIR, `cons_${safeName}_${liveDateKey}.json`);
  if (isFresh(filePath)) return readJson(filePath, { data: [] })?.data || [];
  try {
    const data = runPythonRealtime('cons', boardName);
    writeJson(filePath, { fetchedAt: Date.now(), data });
    return data;
  } catch {
    return [];
  }
}

function readHs300MarketState(scanDate) {
  const rows = readDaily(HS300_CODE, '20200101', scanDate).filter((row) => row.trade_date <= scanDate);
  if (rows.length < 20) return { allowed: false, close: 0, ma20: 0 };
  const latest = rows[rows.length - 1];
  const ma20 = avg(rows.slice(-20).map((row) => Number(row.close_adj || row.close || 0)));
  return { allowed: Number(latest.close || 0) >= ma20, close: Number(latest.close || 0), ma20 };
}

function calcRsi(closes, period = 6) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  const sample = closes.slice(-(period + 1));
  for (let i = 1; i < sample.length; i += 1) {
    const diff = sample[i] - sample[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function calcKdj(rows, period = 9) {
  if (rows.length < period) return { k: null, d: null, j: null };
  let k = 50;
  let d = 50;
  for (let i = period - 1; i < rows.length; i += 1) {
    const window = rows.slice(i - period + 1, i + 1);
    const highest = Math.max(...window.map((row) => row.high));
    const lowest = Math.min(...window.map((row) => row.low));
    const close = rows[i].closeAdj;
    const rsv = highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }
  return { k, d, j: 3 * k - 2 * d };
}

function calcBollPos(closes, period = 20) {
  if (closes.length < period) return null;
  const sample = closes.slice(-period);
  const mid = avg(sample);
  const variance = avg(sample.map((value) => (value - mid) ** 2));
  const std = Math.sqrt(variance);
  const upper = mid + 2 * std;
  const lower = mid - 2 * std;
  if (upper === lower) return 0.5;
  return (closes[closes.length - 1] - lower) / (upper - lower);
}

function getResearchHistPath(tsCode) {
  return resolve(RESEARCH_CACHE_DIR, `stock_hist_${tsCode.split('.')[0]}_20180101_20260328.json`);
}

function loadResearchHistory(tsCode) {
  const filePath = getResearchHistPath(tsCode);
  if (!existsSync(filePath)) return [];
  const payload = readJson(filePath, { data: { klines: [] } });
  return (payload?.data?.klines || []).map((line) => {
    const [tradeDate, open, close, high, low, vol] = line.split(',');
    return {
      tradeDate: tradeDate.replace(/-/g, ''),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      closeAdj: Number(close),
      volume: Number(vol),
    };
  });
}

async function loadHistoryRows(tsCode, scanDate) {
  let rows = readDaily(tsCode, '20200101', scanDate).map((row) => ({
    tradeDate: row.trade_date,
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    closeAdj: Number(row.close_adj || row.close || 0),
    volume: Number(row.volume || 0),
  }));

  if (rows.length < 60) {
    const researchRows = loadResearchHistory(tsCode).filter((row) => row.tradeDate <= scanDate);
    if (researchRows.length > rows.length) rows = researchRows;
  }

  if (rows.length < 60 && !replayDate) {
    try {
      await ensureSymbolCsv(tsCode, 'stock');
      rows = readDaily(tsCode, '20200101', scanDate).map((row) => ({
        tradeDate: row.trade_date,
        open: Number(row.open || 0),
        high: Number(row.high || 0),
        low: Number(row.low || 0),
        close: Number(row.close || 0),
        closeAdj: Number(row.close_adj || row.close || 0),
        volume: Number(row.volume || 0),
      }));
    } catch {
      return [];
    }
  }

  return rows.filter((row) => row.tradeDate <= scanDate);
}

async function loadHistoryFeatures(tsCode, scanDate) {
  const rows = await loadHistoryRows(tsCode, scanDate);
  if (rows.length < 60) return null;
  const closes = rows.map((row) => row.closeAdj);
  const volumes = rows.map((row) => row.volume);
  const ma5 = avg(closes.slice(-5));
  const ma20 = avg(closes.slice(-20));
  const ma60 = avg(closes.slice(-60));
  const rsi6 = calcRsi(closes, 6);
  const { j } = calcKdj(rows, 9);
  const bollPos = calcBollPos(closes, 20);
  const volRatio5 = avg(volumes.slice(-5)) > 0 ? volumes[volumes.length - 1] / avg(volumes.slice(-5)) : 0;

  let score = 0;
  if (ma5 > ma20 && ma20 > ma60) score += 25;
  if (closes[closes.length - 1] > ma5) score += 20;
  if (rsi6 != null && rsi6 >= 35 && rsi6 <= 65) score += 20;
  if (j != null && j >= 20 && j <= 70) score += 15;
  if (volRatio5 > 1.5) score += 20;

  const maState = ma5 > ma20 && ma20 > ma60 ? '多头' : closes[closes.length - 1] > ma20 ? '震荡' : '偏弱';
  return { ma5, ma20, ma60, rsi6, j, bollPos, volRatio5, score, maState };
}

async function loadSignalMetrics(tsCode, scanDate) {
  const rows = await loadHistoryRows(tsCode, scanDate);
  if (rows.length < 10) return null;
  const latest = rows[rows.length - 1];
  const closes = rows.map((row) => row.closeAdj);
  const volumes = rows.map((row) => row.volume);
  const ma5 = avg(closes.slice(-5));
  const ma20 = closes.length >= 20 ? avg(closes.slice(-20)) : avg(closes);
  const ma60 = closes.length >= 60 ? avg(closes.slice(-60)) : avg(closes);
  const rsi6 = calcRsi(closes, 6);
  const { j } = calcKdj(rows, 9);
  const prev5Base = rows.length >= 6 ? rows[rows.length - 6].closeAdj : rows[0].closeAdj;
  const prev5Return = prev5Base > 0 ? ((latest.closeAdj - prev5Base) / prev5Base) * 100 : 0;
  const prev5Volumes = volumes.slice(-6, -1);
  const volRatio5 = avg(prev5Volumes) > 0 ? volumes[volumes.length - 1] / avg(prev5Volumes) : 0;
  const maState = ma5 > ma20 && ma20 > ma60 ? '??' : latest.closeAdj > ma20 ? '??' : '??';
  return { ma5, ma20, ma60, rsi6, j, prev5Return, volRatio5, maState, latestClose: latest.closeAdj };
}

function buildMainlineBoardRanking(boards, stocksMap, scanDate) {
  const limitUpCodes = new Set();
  if (isHistoricalScan(scanDate)) {
    for (const spot of stocksMap.values()) {
      if (Number(spot.pct_chg || 0) >= 9.5) limitUpCodes.add(String(spot.code));
    }
  } else {
    for (const row of loadLiveZtPool()) {
      if (row?.code) limitUpCodes.add(String(row.code));
    }
  }

  const ranked = [];
  for (const board of boards) {
    const members = loadBoardConstituents(board.name, scanDate);
    const hitMembers = members.filter((member) => limitUpCodes.has(String(member.code)));
    if (!hitMembers.length) continue;
    ranked.push({
      ...board,
      ztCount: hitMembers.length,
      ztMembers: hitMembers.map((item) => `${item.name || item.code}(${item.code})`),
    });
  }

  return ranked.sort((a, b) => Number(b.ztCount || 0) - Number(a.ztCount || 0) || Number(b.pct_chg || 0) - Number(a.pct_chg || 0));
}

function calcFunnelScore(spot, metrics) {
  let score = 10;
  const pctChg = Number(spot.pct_chg || 0);
  const circYi = Number(spot.circ_mv || 0) / 100000000;
  if (pctChg >= 5 && pctChg <= 7.5) score += 10;
  else if (pctChg < 9) score += 8;
  if (Number(metrics.volRatio5 || 0) >= 3) score += 10;
  else if (Number(metrics.volRatio5 || 0) > 2) score += 8;
  if (circYi >= 30 && circYi <= 80) score += 10;
  else if (circYi >= 20 && circYi <= 100) score += 8;
  if (Number(metrics.prev5Return || 0) < 5) score += 10;
  else if (Number(metrics.prev5Return || 0) < 10) score += 8;
  return score;
}

async function analyzeMainlineBoard(mainlineBoard, stocksMap, scanDate) {
  const members = loadBoardConstituents(mainlineBoard.name, scanDate);
  const funnel = { total: members.length, step1Keep: 0, step1Out: 0, step2Keep: 0, step2Out: 0, step3Keep: 0, step3Out: 0, step4Keep: 0, step4Out: 0, finalKeep: 0 };
  const candidates = [];

  for (const member of members) {
    const spot = stocksMap.get(member.code);
    if (!spot) continue;
    const tsCode = spot.tsCode || toTsCode(spot.code);
    if (!/^(0|3|6)\d{5}\.(SZ|SH)$/.test(tsCode)) continue;
    const pctChg = Number(spot.pct_chg || 0);
    if (!(pctChg >= 5 && pctChg <= 9)) { funnel.step1Out += 1; continue; }
    funnel.step1Keep += 1;

    const metrics = await loadSignalMetrics(spot.tsCode || toTsCode(spot.code), scanDate);
    if (!metrics || !(Number(metrics.volRatio5 || 0) > 2)) { funnel.step2Out += 1; continue; }
    funnel.step2Keep += 1;

    const circYi = Number(spot.circ_mv || 0) / 100000000;
    if (!(circYi >= 20 && circYi <= 100)) { funnel.step3Out += 1; continue; }
    funnel.step3Keep += 1;

    if (!(Number(metrics.prev5Return || 0) < 10)) { funnel.step4Out += 1; continue; }
    funnel.step4Keep += 1;

    candidates.push({
      code: spot.code,
      tsCode,
      name: member.name || spot.name || spot.code,
      pctChg,
      price: Number(spot.price || 0),
      circMv: Number(spot.circ_mv || 0),
      volRatio5: Number(metrics.volRatio5 || 0),
      prev5Return: Number(metrics.prev5Return || 0),
      rsi6: metrics.rsi6,
      j: metrics.j,
      maState: metrics.maState,
      funnelScore: calcFunnelScore(spot, metrics),
    });
  }

  funnel.finalKeep = candidates.length;
  candidates.sort((a, b) => b.funnelScore - a.funnelScore || b.pctChg - a.pctChg);
  return { board: mainlineBoard, funnel, candidates };
}

function calcQuantScore(summary) {
  const validation = summary?.bestResult?.validation;
  if (!validation) {
    return { quantScore: 0, winRate: 0, avgReturn: 0, validCombinations: 0, stopLossRate: 0, quantSignal: '??????', quantReason: '?CSV?????=0' };
  }
  const winRate = Number(validation.winRate ?? 0);
  const avgReturn = Number(validation.avgReturn ?? 0);
  const validCombinations = Number(summary?.stats?.validCombinations ?? 0);
  const stopLossRate = Number(validation.stopLossRate ?? 0);
  const totalTrades = Number(validation.totalTrades ?? 0);
  let quantScore = 0;
  quantScore += Math.max(0, Math.min(20, winRate * 20));
  quantScore += Math.max(0, Math.min(15, (avgReturn / 0.05) * 15));
  quantScore += Math.max(0, Math.min(10, (validCombinations / 20) * 10));
  quantScore += Math.max(0, Math.min(5, (1 - Math.min(stopLossRate, 0.5) / 0.5) * 5));
  let quantSignal = winRate >= 0.6 && avgReturn > 0 && stopLossRate < 0.3 ? '????' : '????';
  let quantReason = '??????';
  if (validCombinations <= 0) {
    quantSignal = '??????';
    quantReason = '?CSV?????=0';
  } else if (validCombinations > 0 && totalTrades < 5) {
    quantReason = '????>0????';
  }
  return { quantScore, winRate, avgReturn, validCombinations, stopLossRate, quantSignal, quantReason };
}

async function enrichCandidatesWithOptimizer(candidates, scanDate) {
  const enriched = [];
  for (const item of candidates) {
    let quant = { quantScore: 0, winRate: 0, avgReturn: 0, validCombinations: 0, stopLossRate: 0, quantSignal: '??????', quantReason: '???CSV' };
    try {
      const localRows = readDaily(item.tsCode, '20050101', scanDate);
      if (localRows.length <= 60) {
        try {
          await ensureSymbolCsv(item.tsCode, 'stock');
        } catch {
        }
      }
      const refreshedRows = readDaily(item.tsCode, '20050101', scanDate);
      if (refreshedRows.length <= 60) {
        quant = { quantScore: 0, winRate: 0, avgReturn: 0, validCombinations: 0, stopLossRate: 0, quantSignal: '??????', quantReason: '???CSV' };
      } else {
        const summary = await optimize(item.code, '20050101', scanDate);
        quant = calcQuantScore(summary);
      }
    } catch {
      quant = { quantScore: 0, winRate: 0, avgReturn: 0, validCombinations: 0, stopLossRate: 0, quantSignal: '??????', quantReason: '???CSV' };
    }
    const totalScore = Number((item.funnelScore + quant.quantScore).toFixed(1));
    const finalSignal = totalScore >= 75 ? '?? ??' : totalScore >= 60 ? '?? ??' : '? ??';
    enriched.push({ ...item, ...quant, totalScore, finalSignal });
  }
  return enriched.sort((a, b) => b.totalScore - a.totalScore || b.funnelScore - a.funnelScore || b.pctChg - a.pctChg);
}

function printMainlineSummary(boardRanking, market) {
  console.log('========================================');
  console.log(`??????  ${replayDate ? `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}` : dateKey}  ${timeKey}`);
  console.log('========================================');
  console.log(`???????300=${market.close.toFixed(1)}  MA20=${market.ma20.toFixed(1)}  ${market.allowed ? '? ????' : isForceMode ? '?? ????' : '?? ?????????'}`);
  console.log('');
  console.log('----------------------------------------');
  console.log('???????????');
  console.log('----------------------------------------');
  boardRanking.slice(0, 5).forEach((board, index) => {
    console.log(`${String(index + 1).padEnd(3)} ${String(board.name).padEnd(12)} ???${String(board.ztCount).padStart(2)}?  ????${pct(Number(board.pct_chg || 0)).padStart(8)}`);
  });
  console.log('');
}

function printMainlineCandidates(mainline, enriched) {
  console.log(`?????${mainline.name}???? ${mainline.ztCount} ??`);
  console.log('');
  console.log('?????');
  console.log('??      ??         ????  ??   5???  ???  ???  ???  ????');
  enriched.forEach((item) => {
    console.log(`${item.code.padEnd(8)} ${String(item.name).padEnd(10)} ${pct(item.pctChg).padEnd(8)} ${`${item.volRatio5.toFixed(1)}x`.padEnd(6)} ${pct(item.prev5Return).padEnd(8)} ${String(Math.round(item.funnelScore)).padStart(3)}    ${String(Math.round(item.quantScore)).padStart(3)}    ${String(Math.round(item.totalScore)).padStart(3)}    ${item.finalSignal}`);
    console.log(`          ??${(item.winRate * 100).toFixed(1)}%  ??${(item.avgReturn * 100).toFixed(2)}%  ????${item.validCombinations}  ???${(item.stopLossRate * 100).toFixed(1)}%  ${item.quantSignal}`);
    console.log(`          ???=0????${item.quantReason}`);
  });
  console.log('');
  console.log(`??????? ${enriched.length} ?`);
  console.log('========================================');
}

function latestBasicDateFor(scanDate) {
  const files = readdirSync(RESEARCH_CACHE_DIR)
    .filter((name) => /^daily_basic_\d{8}\.csv$/.test(name))
    .map((name) => name.match(/(\d{8})/)[1])
    .sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    if (files[i] <= scanDate) return files[i];
  }
  return null;
}

function loadReplayStocks(scanDate) {
  const dailyPath = resolve(RESEARCH_CACHE_DIR, `daily_${scanDate}.csv`);
  const basicDate = latestBasicDateFor(scanDate);
  const basicPath = basicDate ? resolve(RESEARCH_CACHE_DIR, `daily_basic_${basicDate}.csv`) : null;
  const dailyRows = readCsv(dailyPath);
  const basicRows = basicPath ? readCsv(basicPath) : [];
  const basicMap = new Map(basicRows.map((row) => [row.ts_code, Number(row.circ_mv || 0)]));
  const stocksMap = new Map();

  for (const row of dailyRows) {
    const tsCode = row.ts_code;
    const code = tsCode.split('.')[0];
    const open = Number(row.open || 0);
    const close = Number(row.close || 0);
    const circMvWan = basicMap.get(tsCode) || 0;
    const circMv = circMvWan * 10000;
    const turnoverRate = circMv > 0 ? (Number(row.vol || 0) * close / circMv) * 100 : 0;
    const pctChg = open > 0 ? ((close - open) / open) * 100 : 0;
    stocksMap.set(code, {
      code,
      tsCode,
      name: code,
      pct_chg: pctChg,
      price: close,
      volume: Number(row.vol || 0),
      turnover_rate: turnoverRate,
      circ_mv: circMv,
    });
  }
  return stocksMap;
}

function loadReplayBoards(scanDate) {
  const boards = [];
  for (const board of REPLAY_BOARDS) {
    const payload = readJson(resolve(RESEARCH_CACHE_DIR, `concept_hist_${board.code}_20180101_20260328.json`), { data: { klines: [] } });
    const rows = (payload?.data?.klines || []).map((line) => {
      const [tradeDate, open, close, high, low, vol, amount] = line.split(',');
      return { tradeDate: tradeDate.replace(/-/g, ''), close: Number(close), vol: Number(vol), amount: Number(amount || 0) };
    });
    const ordered = rows.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    let prevClose = 0;
    const closes = [];
    const vols = [];
    for (const row of ordered) {
      closes.push(row.close);
      vols.push(row.vol);
      const ma20 = closes.length >= 20 ? avg(closes.slice(-20)) : 0;
      const avgVol20 = vols.length > 1 ? avg(vols.slice(Math.max(0, vols.length - 21), -1)) : 0;
      const pctChg = prevClose > 0 ? ((row.close - prevClose) / prevClose) * 100 : 0;
      prevClose = row.close;
      if (row.tradeDate === scanDate) {
        boards.push({
          name: board.name,
          code: board.code,
          pct_chg: pctChg,
          volume: row.vol,
          amount: row.amount,
          ma20,
          close: row.close,
          vol_ratio20: avgVol20 > 0 ? row.vol / avgVol20 : 0,
        });
        break;
      }
    }
  }
  return boards;
}

function findPreviousTradeDate(scanDate) {
  const hsRows = readDaily(HS300_CODE, '20200101', scanDate).filter((row) => row.trade_date < scanDate);
  return hsRows.length ? hsRows[hsRows.length - 1].trade_date : null;
}

function filterHotBoards(boards) {
  return boards
    .filter((board) => Number(board.pct_chg || 0) > 2 && Number(board.amount || 0) > 500000000 && !String(board.name || '').includes('ST'))
    .sort((a, b) => Number(b.pct_chg || 0) - Number(a.pct_chg || 0))
    .slice(0, 10);
}

function getCsvTurnoverRate(tsCode, scanDate) {
  if (!/^(\d{6})\.(SH|SZ)$/.test(tsCode)) return { value: 0, source: '??' };
  const rows = readDaily(tsCode, scanDate, scanDate);
  if (!rows.length) return { value: 0, source: '??' };
  const value = Number(rows[0].turnover_rate || 0);
  return { value, source: value > 0 ? '??CSV' : '??' };
}

async function getReplayCandidateMetrics(tsCode, scanDate) {
  const rows = await loadHistoryRows(tsCode, scanDate);
  if (!rows.length) {
    return {
      turnoverRate: null,
      turnoverSource: '??',
      volRatio5: null,
      volumeSource: '??',
    };
  }

  const latest = rows[rows.length - 1];
  const csvTurnover = getCsvTurnoverRate(tsCode, scanDate);
  const prevVolumes = rows.slice(-6, -1).map((row) => Number(row.volume || 0)).filter((value) => value > 0);
  const currentVolume = Number(latest.volume || 0);
  const avg5Volume = avg(prevVolumes);
  const volRatio5 = currentVolume > 0 && avg5Volume > 0 ? currentVolume / avg5Volume : null;

  return {
    turnoverRate: csvTurnover.value > 0 ? csvTurnover.value : null,
    turnoverSource: csvTurnover.source,
    volRatio5,
    volumeSource: currentVolume > 0 && avg5Volume > 0 ? '??CSV' : '??',
  };
}

function pickLeaders(members, stocksMap, scanDate) {
  const inspected = members
    .map((member) => {
      const spot = stocksMap.get(member.code);
      if (!spot) return null;
      const csvTurnover = isHistoricalScan(scanDate) ? getCsvTurnoverRate(spot.tsCode || toTsCode(spot.code), scanDate)
        : { value: Number(spot.turnover_rate || 0), source: '????' };
      return {
        member,
        spot: {
          ...spot,
          turnover_rate: isHistoricalScan(scanDate) ? csvTurnover.value : Number(spot.turnover_rate || 0),
          turnover_source: csvTurnover.source,
        },
      };
    })
    .filter(Boolean);

  const above30 = inspected.filter((item) => Number(item.spot.circ_mv || 0) > 3000000000);
  const withPct = above30.filter((item) => Number.isFinite(Number(item.spot.pct_chg)));
  const over3 = withPct.filter((item) => Number(item.spot.turnover_rate || 0) > 3);
  const rankedTop5 = withPct
    .slice()
    .sort((a, b) => Number(b.spot.pct_chg || 0) - Number(a.spot.pct_chg || 0))
    .slice(0, 5)
    .map((item) => ({
      code: item.spot.code,
      name: item.member.name || item.spot.name,
      pct: Number(item.spot.pct_chg || 0),
      turnover: Number(item.spot.turnover_rate || 0),
      source: item.spot.turnover_source || '??',
    }));

  const pool = over3.length ? over3 : withPct;
  const leaders = pool
    .slice()
    .sort((a, b) => Number(b.spot.pct_chg || 0) - Number(a.spot.pct_chg || 0))
    .slice(0, 3)
    .map((item) => ({ ...item.spot, name: item.member.name || item.spot.name }));

  const reason = leaders.length ? '???' : over3.length === 0 ? '??????????3%???????>30?+???3' : '???????';

  return {
    leaders,
    diagnostics: {
      total: members.length,
      above30Count: above30.length,
      withPctCount: withPct.length,
      over3Count: over3.length,
      rankedTop5,
      found: leaders.length > 0,
      reason,
    },
  };
}

async function analyzeBoard(board, stocksMap, scanDate) {
  const members = loadBoardConstituents(board.name, scanDate);
  const leaderInfo = pickLeaders(members, stocksMap, scanDate);
  const leaders = leaderInfo.leaders;
  const leaderTopPct = leaders.length ? Number(leaders[0].pct_chg || 0) : 0;
  const thresholdPct = leaderTopPct * 0.6;
  const candidates = [];
  const funnel = {
    total: members.length,
    step1Keep: 0, step1Low: 0, step1High: 0,
    step2Keep: 0, step2Out: 0,
    step3Keep: 0, step3Out: 0,
    step4Keep: 0, step4Out: 0,
    step5Keep: 0, step5Out: 0,
    step6Keep: 0, step6Out: 0,
    finalKeep: 0,
    leaderTopPct, thresholdPct,
  };

  for (const member of members) {
    const spot = stocksMap.get(member.code);
    if (!spot) continue;
    const pctChg = Number(spot.pct_chg || 0);
    const circMv = Number(spot.circ_mv || 0);
    let turnoverRate = Number(spot.turnover_rate || 0);
    const name = member.name || spot.name || spot.code;

    if (circMv < 5000000000) { funnel.step1Low += 1; continue; }
    if (circMv > 50000000000) { funnel.step1High += 1; continue; }
    funnel.step1Keep += 1;

    if (!(pctChg > 0.5) || pctChg >= 9 || String(name).includes('ST') || Number(spot.volume || 0) <= 0) {
      funnel.step2Out += 1;
      continue;
    }
    funnel.step2Keep += 1;

    if (!(pctChg < thresholdPct)) {
      funnel.step3Out += 1;
      continue;
    }
    funnel.step3Keep += 1;

    const tsCode = spot.tsCode || toTsCode(spot.code);
    let replayMetrics = null;
    if (isHistoricalScan(scanDate)) {
      replayMetrics = await getReplayCandidateMetrics(tsCode, scanDate);
      if (replayMetrics.turnoverRate != null) {
        turnoverRate = replayMetrics.turnoverRate;
      }
    }

    const shouldSkipTurnoverFilter = isHistoricalScan(scanDate) && replayMetrics && replayMetrics.turnoverRate == null;
    if (!shouldSkipTurnoverFilter && !(turnoverRate > 1)) {
      funnel.step4Out += 1;
      continue;
    }
    funnel.step4Keep += 1;

    const features = await loadHistoryFeatures(tsCode, scanDate);
    if (!features) {
      funnel.step6Out += 1;
      continue;
    }

    const volRatioForFilter = isHistoricalScan(scanDate) && replayMetrics ? replayMetrics.volRatio5 : features.volRatio5;
    const shouldSkipVolumeFilter = isHistoricalScan(scanDate) && (!replayMetrics || volRatioForFilter == null);
    if (!shouldSkipVolumeFilter && !(volRatioForFilter > 1.5)) {
      funnel.step5Out += 1;
      continue;
    }
    funnel.step5Keep += 1;

    funnel.step6Keep += 1;
    candidates.push({
      code: spot.code,
      tsCode,
      name,
      pctChg,
      price: Number(spot.price || 0),
      volume: Number(spot.volume || 0),
      turnoverRate,
      circMv,
      ...features,
      volRatio5: volRatioForFilter ?? features.volRatio5,
    });
  }

  funnel.finalKeep = candidates.length;
  candidates.sort((a, b) => b.score - a.score || b.pctChg - a.pctChg);
  return { board, leaders, candidates, funnel, leaderDiagnostics: leaderInfo.diagnostics };
}

function printBoardList(hotBoards) {
  console.log('----------------------------------------');
  console.log('今日热点板块 TOP5');
  console.log('----------------------------------------');
  console.log('排名  板块名称           今日涨幅   成交额');
  hotBoards.slice(0, 5).forEach((board, index) => {
    console.log(`${String(index + 1).padEnd(4)}  ${String(board.name).padEnd(16)} ${pct(Number(board.pct_chg || 0)).padEnd(9)} ${humanAmount(Number(board.amount || 0))}`);
  });
  console.log('');
}

function signalBadge(score) {
  if (score >= 75) return '🟢 候选';
  if (score >= 60) return '🟡 观望';
  return '⚪ 放弃';
}

function printCandidates(boardAnalyses) {
  console.log('----------------------------------------');
  console.log('??????');
  console.log('----------------------------------------');
  let total = 0;
  for (const analysis of boardAnalyses) {
    total += analysis.candidates.filter((item) => item.score >= 60).length;
    console.log(`?${analysis.board.name}???`);
    if (analysis.leaders.length) {
      const leader = analysis.leaders[0];
      console.log(`?????${leader.name}(${leader.code}) ??${pct(Number(leader.pct_chg || 0))}  ???${Number(leader.turnover_rate || 0).toFixed(1)}%`);
    } else {
      console.log('??????????????');
    }
    const d = analysis.leaderDiagnostics;
    console.log(`?${analysis.board.name} ???????`);
    console.log(`????????${d.total}?`);
    console.log(`??>30???${d.above30Count}?`);
    console.log(`???????????${d.withPctCount}?`);
    console.log(`?????>3%??${d.over3Count}?`);
    console.log('?????????>30????????5??');
    d.rankedTop5.forEach((item) => {
      console.log(`  ${item.code.padEnd(8)} ${String(item.name).padEnd(10)} ${pct(item.pct).padEnd(8)} ${`${item.turnover.toFixed(1)}%`.padEnd(8)} ${item.source}`);
    });
    console.log(`???????${d.found ? '?' : '?'}`);
    console.log(`?????${d.reason}`);
    const f = analysis.funnel;
    console.log(`??????${f.total}?`);
    console.log(`Step1 ????50-500????${f.step1Keep}????${f.step1Low + f.step1High}?`);
    console.log(`  ???????<50? ${f.step1Low}????>500? ${f.step1High}?`);
    console.log(`Step2 ????>0.5%???${f.step2Keep}????${f.step2Out}?`);
    console.log(`Step3 ????<?????0.6???${f.step3Keep}????${f.step3Out}?`);
    console.log(`  ???????${pct(f.leaderTopPct)}????${pct(f.thresholdPct)}`);
    console.log(`Step4 ???>1%???${f.step4Keep}????${f.step4Out}?`);
    console.log(`Step5 ??>1.5???${f.step5Keep}????${f.step5Out}?`);
    console.log(`Step6 ??CSV???????${f.step6Keep}????${f.step6Out}?`);
    console.log(`?????${f.finalKeep}?`);
    console.log('');
    if (analysis.candidates.length) {
      console.log('??      ??         ????  ??   RSI6  J?  MA??   ??   ??');
      analysis.candidates.slice(0, 8).forEach((item) => {
        console.log(`${item.code.padEnd(8)} ${String(item.name).padEnd(10)} ${pct(item.pctChg).padEnd(8)} ${`${item.volRatio5.toFixed(1)}x`.padEnd(6)} ${String(item.rsi6 == null ? '-' : item.rsi6.toFixed(0)).padEnd(5)} ${String(item.j == null ? '-' : item.j.toFixed(0)).padEnd(4)} ${item.maState.padEnd(6)} ${String(Math.round(item.score)).padStart(3)}?  ${signalBadge(item.score)}`);
      });
      console.log('');
    }
  }
  console.log('----------------------------------------');
  console.log(`????? ${total} ?????`);
  console.log(`???${isConfirmMode ? '??? 14:50 ?????????' : replayDate ? '???????????? --backtest ??????' : '14:50??????????????'}`);
  console.log('========================================');
}

function saveBaseline(boardAnalyses) {
  if (replayDate || isBatchBacktestMode || isJsonSummaryMode) return;
  const snapshot = {
    capturedAt: Date.now(),
    dateKey,
    timeKey,
    candidates: boardAnalyses.flatMap((analysis) => analysis.candidates.filter((item) => item.score >= 60).map((item) => ({
      boardName: analysis.board.name,
      code: item.code,
      name: item.name,
      price1430: item.price,
      volume1430: item.volume,
      score: item.score,
    }))),
  };
  writeJson(CONFIRM_BASELINE_PATH(dateKey), snapshot);
}

function printConfirm(stocksMap) {
  const baseline = readJson(CONFIRM_BASELINE_PATH(dateKey), null);
  if (!baseline?.candidates?.length) {
    console.log('未找到 14:30 候选基线，无法执行 14:50 二次确认。');
    return;
  }
  console.log('----------------------------------------');
  console.log('14:50 二次确认');
  console.log('----------------------------------------');
  let passed = 0;
  for (const item of baseline.candidates) {
    const latest = stocksMap.get(item.code);
    if (!latest) {
      console.log(`${item.code} ${item.name} ❌ 无最新行情，放弃`);
      continue;
    }
    const priceNow = Number(latest.price || 0);
    const volNow = Number(latest.volume || 0);
    const dropPct = item.price1430 > 0 ? ((priceNow - item.price1430) / item.price1430) * 100 : 0;
    const volumeOk = volNow >= Number(item.volume1430 || 0);
    const priceOk = dropPct >= -1;
    const passedNow = priceOk && volumeOk;
    if (passedNow) passed += 1;
    console.log(`${item.code} ${item.name} ${passedNow ? '✅ 14:50确认，可买入' : '❌ 信号消失，放弃'}  价格变化${pct(dropPct)}  成交量${volumeOk ? '增加' : '萎缩'}`);
  }
  console.log('----------------------------------------');
  console.log(`汇总：${passed}/${baseline.candidates.length} 只通过 14:50 确认`);
  console.log('========================================');
}

function getTradeCalendar(tsCode, scanDate) {
  return readDaily(tsCode, '20200101', scanDate).map((row) => row.trade_date);
}

async function backtestCandidate(candidate, scanDate) {
  const rows = await loadHistoryRows(candidate.tsCode, '20991231');
  if (!rows.length) return null;
  const idx = rows.findIndex((row) => row.tradeDate === scanDate);
  if (idx < 0 || idx + 3 >= rows.length) return null;
  const buyPrice = rows[idx].closeAdj || rows[idx].close;
  const future = rows.slice(idx + 1, idx + 4);
  const t1Return = ((future[0].closeAdj || future[0].close) - buyPrice) / buyPrice;
  const highest = Math.max(...future.map((row) => row.high));
  const lowest = Math.min(...future.map((row) => row.low));
  return {
    t1Return,
    highestGain: (highest - buyPrice) / buyPrice,
    maxDrawdown: (lowest - buyPrice) / buyPrice,
    hit3pct: (highest - buyPrice) / buyPrice >= 0.03,
  };
}

async function collectBacktestStats(boardAnalyses, scanDate) {
  const allCandidates = boardAnalyses.flatMap((analysis) => analysis.candidates);
  const enriched = [];
  for (const item of allCandidates) {
    const result = await backtestCandidate(item, scanDate);
    if (!result) continue;
    enriched.push({ ...item, ...result });
  }

  const groups = [
    { key: 'high', label: '??>=75???', filter: (item) => item.score >= 75 },
    { key: 'mid', label: '??60-75???', filter: (item) => item.score >= 60 && item.score < 75 },
    { key: 'low', label: '??<60???', filter: (item) => item.score < 60 },
  ].map((group) => {
    const rows = enriched.filter(group.filter);
    const hit = rows.filter((item) => item.hit3pct).length;
    return {
      key: group.key,
      label: group.label,
      count: rows.length,
      hit,
      hitRate: rows.length ? hit / rows.length : 0,
      avgHigh: avg(rows.map((item) => item.highestGain)),
      avgDd: avg(rows.map((item) => item.maxDrawdown)),
    };
  });

  return {
    enriched,
    groups,
    candidateCount: allCandidates.filter((item) => item.score >= 60).length,
  };
}

async function printBacktest(boardAnalyses, scanDate) {
  const stats = await collectBacktestStats(boardAnalyses, scanDate);

  console.log('');
  console.log('?????????????=????????');
  console.log('');

  stats.groups.forEach((group) => {
    console.log(`${group.label}??${group.count}???`);
    if (!group.count) {
      console.log('  ???');
      return;
    }
    console.log(`  3???+3%????${group.hit}/${group.count} = ${pct(group.hitRate)}`);
    console.log(`  ???????${pct(group.avgHigh)}`);
    console.log(`  ???????${pct(group.avgDd)}`);
  });

  const high = stats.groups.find((item) => item.key === 'high') || { hitRate: 0, avgHigh: 0 };
  const low = stats.groups.find((item) => item.key === 'low') || { hitRate: 0, avgHigh: 0 };
  const better = high.hitRate > low.hitRate && high.avgHigh > low.avgHigh;
  console.log('');
  console.log('???');
  console.log(`  ?????????????${better ? '?' : '?'}`);
}

function buildSummaryLine(summary) {
  const high = summary.groups.find((item) => item.key === 'high') || { hitRate: 0 };
  const mid = summary.groups.find((item) => item.key === 'mid') || { hitRate: 0 };
  return {
    date: summary.date,
    marketAllowed: summary.marketAllowed,
    candidateCount: summary.candidateCount,
    highHitRate: high.hitRate,
    midHitRate: mid.hitRate,
    diff: high.hitRate - mid.hitRate,
  };
}

async function collectReplaySummary(scanDate) {
  const market = readHs300MarketState(scanDate);
  if (!market.allowed) {
    return buildSummaryLine({
      date: scanDate,
      marketAllowed: false,
      candidateCount: 0,
      groups: [],
    });
  }

  const boards = loadReplayBoards(scanDate);
  const hotBoards = filterHotBoards(boards);
  const stocksMap = loadReplayStocks(scanDate);
  const boardAnalyses = [];
  for (const board of hotBoards) {
    boardAnalyses.push(await analyzeBoard(board, stocksMap, scanDate));
  }
  const stats = await collectBacktestStats(boardAnalyses, scanDate);
  return buildSummaryLine({
    date: scanDate,
    marketAllowed: true,
    candidateCount: stats.candidateCount,
    groups: stats.groups,
  });
}

function printBatchSummary(rows) {
  console.log('??        ????  ???  ??>=75???  ??60-75???  ??');
  rows.forEach((row) => {
    console.log(`${row.date}    ${row.marketAllowed ? '?' : '??'}        ${String(row.candidateCount).padEnd(5)} ${pct(row.highHitRate).padEnd(15)} ${pct(row.midHitRate).padEnd(15)} ${pct(row.diff)}`);
  });

  const normalRows = rows.filter((row) => row.date !== '20240924' && row.marketAllowed && row.candidateCount > 0);
  const highAvg = avg(normalRows.map((row) => row.highHitRate));
  const midAvg = avg(normalRows.map((row) => row.midHitRate));
  const diffAvg = highAvg - midAvg;

  console.log('');
  console.log('????????2024-09-24????????');
  console.log(`  ??>=75 ??????${pct(highAvg)}`);
  console.log(`  ??60-75 ??????${pct(midAvg)}`);
  console.log(`  ???????${pct(diffAvg)}`);
  console.log('');
  console.log('???');
  console.log(`  ${diffAvg > 0.15 ? '???????????????' : diffAvg >= 0.05 ? '??????????' : '?????????????'}`);
}

// --find-signal-days: 快速扫描 2022-2024 所有交易日，找出有信号的日期并批量回测
function getFullTradeCalendar(startDate, endDate) {
  return readDaily(HS300_CODE, '20200101', endDate)
    .map((row) => row.trade_date)
    .filter((d) => d >= startDate && d <= endDate);
}

async function collectSignalDaySummary(scanDate) {
  const market = readHs300MarketState(scanDate);
  if (!market.allowed) {
    return { date: scanDate, marketAllowed: false, candidateCount: 0, boards: [], boardAnalyses: [] };
  }

  const boards = loadReplayBoards(scanDate);
  const hotBoards = filterHotBoards(boards);
  if (hotBoards.length < 3) {
    return { date: scanDate, marketAllowed: true, candidateCount: 0, boards: [], boardAnalyses: [] };
  }

  const dailyPath = resolve(RESEARCH_CACHE_DIR, `daily_${scanDate}.csv`);
  if (!existsSync(dailyPath)) {
    return { date: scanDate, marketAllowed: true, candidateCount: 0, boards: [], boardAnalyses: [] };
  }

  const stocksMap = loadReplayStocks(scanDate);
  const boardAnalyses = [];
  for (const board of hotBoards) {
    boardAnalyses.push(await analyzeBoard(board, stocksMap, scanDate));
  }

  const activeAnalyses = boardAnalyses.filter((analysis) => analysis.candidates.length > 0);
  return {
    date: scanDate,
    marketAllowed: true,
    candidateCount: activeAnalyses.reduce((sum, analysis) => sum + analysis.candidates.length, 0),
    boards: activeAnalyses.map((analysis) => analysis.board.name),
    boardAnalyses,
  };
}

async function runFindSignalDays() {
  const SCAN_START = '20220101';
  const SCAN_END = '20241231';

  console.log('========================================');
  console.log(`?????  ${SCAN_START} ~ ${SCAN_END}`);
  console.log('========================================');

  const calendar = getFullTradeCalendar(SCAN_START, SCAN_END);
  console.log(`?????? ${calendar.length} ????`);
  console.log('??????????...');
  console.log('');

  const signalDays = [];
  let scanned = 0;

  for (const scanDate of calendar) {
    scanned += 1;
    if (scanned % 20 === 0) {
      process.stdout.write(`
  ??? ${scanned}/${calendar.length}????? ${signalDays.length} ?...`);
    }

    const summary = await collectSignalDaySummary(scanDate);
    if (summary.candidateCount > 0) {
      signalDays.push(summary);
    }
  }

  process.stdout.write('\n');
  console.log('');

  console.log('========================================');
  console.log('???????????');
  console.log('========================================');
  console.log(`??? ${signalDays.length} ????????`);
  console.log(`??????????${((signalDays.length / calendar.length) * 100).toFixed(1)}%`);
  console.log('');
  console.log('??        ???  ????');
  for (const day of signalDays) {
    console.log(`${day.date}    ${String(day.candidateCount).padEnd(6)}  ${day.boards.join(' / ')}`);
  }

  if (!signalDays.length) {
    console.log('??????????');
    return;
  }

  console.log('');
  console.log('========================================');
  console.log('?????????????? + 3????');
  console.log('========================================');
  console.log(`? ${signalDays.length} ????????...`);
  console.log('');

  const allEnriched = [];
  let btDone = 0;

  for (const day of signalDays) {
    btDone += 1;
    process.stdout.write(`
  ???? ${btDone}/${signalDays.length}?${day.date}?...`);
    const stats = await collectBacktestStats(day.boardAnalyses, day.date);
    for (const item of stats.enriched) {
      allEnriched.push({ ...item, scanDate: day.date });
    }
  }

  process.stdout.write('\n');
  console.log('');

  const scored = allEnriched.filter((item) => item.score >= 60);
  const high = allEnriched.filter((item) => item.score >= 75);
  const mid = allEnriched.filter((item) => item.score >= 60 && item.score < 75);

  const summarize = (rows, label) => {
    if (!rows.length) { console.log(`${label}????`); return; }
    const hit = rows.filter((item) => item.hit3pct).length;
    const hitRate = hit / rows.length;
    const avgHigh = avg(rows.map((item) => item.highestGain));
    const avgDd = avg(rows.map((item) => item.maxDrawdown));
    const avgT1 = avg(rows.map((item) => item.t1Return));
    console.log(`${label}`);
    console.log(`  ????${rows.length}`);
    console.log(`  3????+3% ???${hit}/${rows.length} = ${pct(hitRate)}`);
    console.log(`  ???????${pct(avgHigh)}`);
    console.log(`  ???????${pct(avgDd)}`);
    console.log(`  T+1 ?????${pct(avgT1)}`);
  };

  console.log('========================================');
  console.log('??????????');
  console.log('========================================');
  console.log(`????????????${allEnriched.length}`);
  console.log(`??>=60 ???${scored.length}`);
  console.log('');
  summarize(high, '??>=75?????');
  console.log('');
  summarize(mid, '??60-75?????');
  console.log('');
  summarize(scored, '??>=60????');
  console.log('');

  const years = ['2022', '2023', '2024'];
  console.log('?? ???????>=60???');
  for (const year of years) {
    const yearRows = scored.filter((item) => item.scanDate.startsWith(year));
    const yearDays = signalDays.filter((d) => d.date.startsWith(year)).length;
    if (!yearRows.length) { console.log(`${year}????`); continue; }
    const hit = yearRows.filter((item) => item.hit3pct).length;
    console.log(`${year}  ???${yearDays}?  ??${yearRows.length}  ??${pct(hit / yearRows.length)}  ??${pct(avg(yearRows.map((item) => item.highestGain)))}  ???${pct(avg(yearRows.map((item) => item.maxDrawdown)))}`);
  }

  console.log('');
  console.log('========================================');
  const bestHit = high.filter((item) => item.hit3pct).length;
  const bestRate = high.length ? bestHit / high.length : 0;
  console.log(`???????>=75??? ${pct(bestRate)}??? ${high.length} ?`);
  console.log(`      ???????? ${(signalDays.length / 3).toFixed(0)} ?`);
  console.log('========================================');
}

async function runNonBullBacktest() {
  const testDates = ['20231228', '20240206', '20240208', '20240429'];

  console.log('???????????2024?9-10??????');
  console.log('');
  console.log('??        ???  3??+3%  ??????  ??????');

  const allRows = [];

  for (const scanDate of testDates) {
    const summary = await collectSignalDaySummary(scanDate);
    const stats = await collectBacktestStats(summary.boardAnalyses || [], scanDate);
    const rows = stats.enriched.filter((item) => item.score >= 60);
    const hit = rows.filter((item) => item.hit3pct).length;
    const avgHigh = avg(rows.map((item) => item.highestGain));
    const avgDd = avg(rows.map((item) => item.maxDrawdown));
    allRows.push(...rows);
    console.log(`${scanDate}    ${String(rows.length).padEnd(6)}  ${String(hit).padEnd(2)}/${String(rows.length).padEnd(2)}    ${pct(avgHigh).padEnd(12)} ${pct(avgDd)}`);
  }

  console.log('');
  console.log('???');
  const total = allRows.length;
  const totalHit = allRows.filter((item) => item.hit3pct).length;
  const totalHitRate = total ? totalHit / total : 0;
  const totalAvgHigh = avg(allRows.map((item) => item.highestGain));
  const totalAvgDd = avg(allRows.map((item) => item.maxDrawdown));
  console.log(`  ????${total}?`);
  console.log(`  ?????${totalHit}/${total} = ${pct(totalHitRate)}`);
  console.log(`  ???????${pct(totalAvgHigh)}`);
  console.log(`  ???????${pct(totalAvgDd)}`);
  console.log('');
  console.log('???');
  console.log(`  ${totalHitRate >= 0.6 ? '??????????' : totalHitRate >= 0.4 ? '?????????????' : '??????????'}`);
}

async function main() {
  if (isNonBullBacktestMode) {
    await runNonBullBacktest();
    return;
  }

  if (isFindSignalDaysMode) {
    await runFindSignalDays();
    return;
  }

  if (isBatchBacktestMode) {
    const rows = [];
    for (const scanDate of TEST_DATES) {
      rows.push(await collectReplaySummary(scanDate));
    }
    printBatchSummary(rows);
    return;
  }

  if (isJsonSummaryMode && replayDate) {
    const summary = await collectReplaySummary(dateKey);
    console.log(JSON.stringify(summary));
    return;
  }

  const market = readHs300MarketState(dateKey);
  const boards = replayDate ? loadReplayBoards(dateKey) : loadLiveBoardData();
  const stocksMap = replayDate ? loadReplayStocks(dateKey) : new Map(loadLiveStockData().map((item) => [String(item.code), item]));

  if (!market.allowed && !isForceMode) {
    printMainlineSummary([], market);
    return;
  }

  const boardRanking = buildMainlineBoardRanking(boards, stocksMap, dateKey);
  printMainlineSummary(boardRanking, market);

  if (isConfirmMode) {
    printConfirm(stocksMap);
    return;
  }

  const mainline = boardRanking[0];
  if (!mainline) {
    console.log('?????????');
    return;
  }

  const analysis = await analyzeMainlineBoard(mainline, stocksMap, dateKey);
  const enriched = await enrichCandidatesWithOptimizer(analysis.candidates, dateKey);
  printMainlineCandidates(mainline, enriched);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
