/**
 * 股票数据本地缓存 — 避免频繁请求 Tushare 导致限流
 *
 * 功能：
 *   1. 批量下载 STOCK_UNIVERSE 中所有股票 + 指数的日K线数据
 *   2. 持久化为本地 JSON 文件（results/data-cache/）
 *   3. 增量更新：只拉取 lastDate 之后的新数据
 *   4. 提供 loadCachedStock / loadCachedIndex 读取接口
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STOCK_UNIVERSE } from './stock-universe.mjs';

const CACHE_DIR = resolve(process.cwd(), 'results', 'data-cache');
const ENV_LOCAL_PATH = resolve(process.cwd(), '.env.local');
const TUSHARE_API = 'http://api.tushare.pro';

const readEnvLocalToken = () => {
  if (!existsSync(ENV_LOCAL_PATH)) return '';
  const sourceText = readFileSync(ENV_LOCAL_PATH, 'utf8');
  for (const rawLine of sourceText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key !== 'TUSHARE_TOKEN') continue;
    return line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
};

async function fetchTushare(token, apiName, params, fields) {
  const response = await fetch(TUSHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
  });
  if (!response.ok) throw new Error(`Tushare ${response.status}`);
  const payload = await response.json();
  if (payload.code !== 0) throw new Error(payload.msg || 'Tushare non-zero code');
  return payload.data;
}

const mapRows = ({ fields, items }) =>
  items.map((item) => fields.reduce((rec, f, i) => ({ ...rec, [f]: item[i] }), {}));

const fmt = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

function normalizeCandles(rows) {
  return rows
    .map((r) => ({
      date: fmt(r.trade_date),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Math.round(Number(r.vol ?? 0)),
      pct_chg: Number(r.pct_chg ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function guessTsCode(code) {
  return /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

function cachePath(code) {
  return resolve(CACHE_DIR, `${code}.json`);
}

/** 读取缓存 */
export function loadCachedStock(code) {
  const p = cachePath(code);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 读取指数缓存 */
export function loadCachedIndex(tsCode = '000300.SH') {
  const p = resolve(CACHE_DIR, `index_${tsCode.replace('.', '_')}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 延迟函数 */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 批量下载并缓存所有股票 + 指数数据
 * @param {string} startDate - 开始日期 (YYYYMMDD)
 * @param {string} endDate - 结束日期 (YYYYMMDD)
 */
export async function refreshCache(startDate = '20200101', endDate = '20260326') {
  const token = readEnvLocalToken() || process.env.TUSHARE_TOKEN || '';
  if (!token) throw new Error('Missing TUSHARE_TOKEN');

  mkdirSync(CACHE_DIR, { recursive: true });

  // 1. 下载指数数据
  console.log('[Cache] 下载沪深300指数 ...');
  try {
    const indexRaw = mapRows(
      await fetchTushare(token, 'index_daily',
        { ts_code: '000300.SH', start_date: startDate, end_date: endDate },
        'trade_date,open,high,low,close,vol,pct_chg')
    );
    const indexCandles = normalizeCandles(indexRaw);
    const indexPath = resolve(CACHE_DIR, 'index_000300_SH.json');
    writeFileSync(indexPath, JSON.stringify(indexCandles));
    console.log(`      ${indexCandles.length} 行已缓存`);
  } catch (err) {
    console.warn(`      指数下载失败: ${err.message}`);
  }

  // 2. 逐只下载股票
  let done = 0;
  const errors = [];
  for (const stock of STOCK_UNIVERSE) {
    done += 1;
    const tsCode = guessTsCode(stock.code);
    process.stdout.write(`[Cache] [${done}/${STOCK_UNIVERSE.length}] ${stock.code} ${stock.name} ...`);

    try {
      // 检查增量
      const existing = loadCachedStock(stock.code);
      let fetchStart = startDate;
      if (existing && existing.length > 0) {
        const lastDate = existing[existing.length - 1].date.replace(/-/g, '');
        // 从最后日期的下一天开始拉
        const nextDay = new Date(existing[existing.length - 1].date);
        nextDay.setDate(nextDay.getDate() + 1);
        fetchStart = nextDay.toISOString().slice(0, 10).replace(/-/g, '');
        if (fetchStart > endDate) {
          console.log(` 已最新 (${existing.length} 行)`);
          continue;
        }
      }

      const raw = mapRows(
        await fetchTushare(token, 'daily',
          { ts_code: tsCode, start_date: fetchStart, end_date: endDate },
          'trade_date,open,high,low,close,vol,pct_chg')
      );
      const newCandles = normalizeCandles(raw);

      // 合并
      let merged;
      if (existing && fetchStart !== startDate) {
        const existingDates = new Set(existing.map((r) => r.date));
        const fresh = newCandles.filter((r) => !existingDates.has(r.date));
        merged = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
      } else {
        merged = newCandles;
      }

      writeFileSync(cachePath(stock.code), JSON.stringify(merged));
      console.log(` ${merged.length} 行 (新增 ${newCandles.length})`);

      // Tushare 限流保护
      await delay(300);
    } catch (err) {
      console.log(` 失败: ${err.message}`);
      errors.push({ code: stock.code, error: err.message });
      await delay(1000);
    }
  }

  console.log(`\n[Cache] 完成: ${done - errors.length}/${done} 成功`);
  if (errors.length) {
    console.log(`[Cache] 失败列表: ${errors.map((e) => e.code).join(', ')}`);
  }
}

// CLI 入口
if (process.argv[1]?.endsWith('stock-data-cache.mjs')) {
  const [,, startDate = '20200101', endDate = '20260326'] = process.argv;
  refreshCache(startDate, endDate).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
