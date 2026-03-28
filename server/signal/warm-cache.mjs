import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureSymbolCsv, readDaily } from '../data/csv-manager.mjs';

const ROOT = process.cwd();
const RESEARCH_DIR = resolve(ROOT, 'cache', 'research');
const KLINE_DIR = resolve(ROOT, 'cache', 'kline');
const START_DATE = '20230101';
const END_DATE = '20260328';
const sleep = (ms) => new Promise((resolveFn) => setTimeout(resolveFn, ms));

function parseCsvLine(line) {
  const values = [];
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
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function readCsv(filePath) {
  const text = readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function latestBasicDateMap() {
  return readdirSync(RESEARCH_DIR)
    .filter((name) => /^daily_basic_\d{8}\.csv$/.test(name))
    .map((name) => name.match(/(\d{8})/)[1])
    .sort();
}

function findBasicDate(scanDate, allDates) {
  for (let i = allDates.length - 1; i >= 0; i -= 1) {
    if (allDates[i] <= scanDate) return allDates[i];
  }
  return null;
}

function loadCircMvMap(basicDate) {
  if (!basicDate) return new Map();
  const filePath = resolve(RESEARCH_DIR, `daily_basic_${basicDate}.csv`);
  if (!existsSync(filePath)) return new Map();
  const rows = readCsv(filePath);
  return new Map(rows.map((row) => [String(row.ts_code), Number(row.circ_mv || 0) * 10000]));
}

function isMainOrChiNext(tsCode) {
  return /^(0|3|6)\d{5}\.(SZ|SH)$/.test(tsCode);
}

function hasUsableCsv(tsCode) {
  const filePath = resolve(KLINE_DIR, `${tsCode}.csv`);
  if (!existsSync(filePath)) return false;
  if (statSync(filePath).size <= 100) return false;
  return readDaily(tsCode, START_DATE, END_DATE).length > 60;
}

async function main() {
  const startedAt = Date.now();
  const basicDates = latestBasicDateMap();
  const dailyFiles = readdirSync(RESEARCH_DIR)
    .filter((name) => /^daily_\d{8}\.csv$/.test(name))
    .map((name) => name.match(/(\d{8})/)[1])
    .filter((date) => date >= START_DATE && date <= '20241231')
    .sort();

  const limitUpPool = new Map();
  let scannedDays = 0;

  for (const tradeDate of dailyFiles) {
    const dailyPath = resolve(RESEARCH_DIR, `daily_${tradeDate}.csv`);
    const rows = readCsv(dailyPath);
    const basicDate = findBasicDate(tradeDate, basicDates);
    const circMvMap = loadCircMvMap(basicDate);
    scannedDays += 1;

    for (const row of rows) {
      const tsCode = String(row.ts_code || '').toUpperCase();
      if (!isMainOrChiNext(tsCode)) continue;
      const open = Number(row.open || 0);
      const close = Number(row.close || 0);
      const high = Number(row.high || 0);
      if (!(open > 0 && close > 0 && high > 0)) continue;
      const pct = ((close - open) / open) * 100;
      const circMv = Number(circMvMap.get(tsCode) || 0);
      const circYi = circMv / 100000000;
      if (!(circYi >= 20 && circYi <= 200)) continue;
      if (pct < 9.5) continue;
      if (Math.abs(close - high) > Math.max(0.01, close * 0.002)) continue;
      if (!limitUpPool.has(tsCode)) {
        limitUpPool.set(tsCode, { tsCode, lastSeen: tradeDate, circYi });
      }
    }
  }

  const symbols = Array.from(limitUpPool.values()).sort((a, b) => a.tsCode.localeCompare(b.tsCode));
  let skipped = 0;
  let added = 0;
  let failed = 0;

  for (const item of symbols) {
    if (hasUsableCsv(item.tsCode)) {
      skipped += 1;
      continue;
    }
    try {
      const result = await ensureSymbolCsv(item.tsCode, 'stock');
      if (Number(result.rows || 0) > 60) added += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
    await sleep(1000);
  }

  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`扫描交易日：${scannedDays} 天`);
  console.log(`涨停股票池：${symbols.length} 只`);
  console.log(`已有缓存：${skipped}只，跳过`);
  console.log(`新增缓存：${added}只，耗时${minutes}分钟`);
  console.log(`失败：${failed}只`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
