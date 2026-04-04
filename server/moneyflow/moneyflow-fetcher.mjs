/**
 * Tushare moneyflow 数据拉取与缓存
 * API: moneyflow — 个股资金流向（大/超大/中/小单买卖金额）
 * 缓存路径: cache/moneyflow/{ts_code}.csv
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '../logger.mjs';

const log = createLogger('moneyflow-fetcher');

const TUSHARE_API  = 'http://api.tushare.pro';
const CACHE_DIR    = resolve(process.cwd(), 'cache', 'moneyflow');
const ENV_PATH     = resolve(process.cwd(), '.env.local');

const CSV_HEADER   = 'trade_date,buy_elg_amount,sell_elg_amount,buy_lg_amount,sell_lg_amount,buy_sm_amount,sell_sm_amount,net_mf_amount';
const MF_FIELDS    = 'trade_date,buy_elg_amount,sell_elg_amount,buy_lg_amount,sell_lg_amount,buy_sm_amount,sell_sm_amount,net_mf_amount';

// ─── Token ──────────────────────────────────────────────────────────────────

function readToken() {
  if (existsSync(ENV_PATH)) {
    // strip UTF-8 BOM (\uFEFF) that Windows editors often prepend
    const raw = readFileSync(ENV_PATH, 'utf8').replace(/^\uFEFF/, '');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^TUSHARE_TOKEN\s*=\s*['"]?([^'"]+)['"]?\s*$/);
      if (m) return m[1].trim();
    }
  }
  return process.env.TUSHARE_TOKEN || '';
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function csvPath(tsCode) {
  return resolve(CACHE_DIR, `${tsCode}.csv`);
}

function readCached(tsCode) {
  const fp = csvPath(tsCode);
  if (!existsSync(fp)) return [];
  const [, ...lines] = readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  return lines.filter(Boolean).map(line => {
    const [trade_date, buy_elg_amount, sell_elg_amount, buy_lg_amount,
           sell_lg_amount, buy_sm_amount, sell_sm_amount, net_mf_amount] = line.split(',');
    return {
      trade_date,
      buy_elg_amount:  Number(buy_elg_amount),
      sell_elg_amount: Number(sell_elg_amount),
      buy_lg_amount:   Number(buy_lg_amount),
      sell_lg_amount:  Number(sell_lg_amount),
      buy_sm_amount:   Number(buy_sm_amount),
      sell_sm_amount:  Number(sell_sm_amount),
      net_mf_amount:   Number(net_mf_amount),
    };
  }).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

function writeCache(tsCode, rows) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const body = rows.map(r =>
    [r.trade_date, r.buy_elg_amount, r.sell_elg_amount, r.buy_lg_amount,
     r.sell_lg_amount, r.buy_sm_amount, r.sell_sm_amount, r.net_mf_amount].join(',')
  );
  writeFileSync(csvPath(tsCode), [CSV_HEADER, ...body].join('\n') + '\n', 'utf8');
}

// ─── Tushare fetch ───────────────────────────────────────────────────────────

async function fetchTushare(tsCode, startDate, endDate) {
  const token = readToken();
  if (!token) throw new Error('TUSHARE_TOKEN not set');

  const res = await fetch(TUSHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_name: 'moneyflow',
      token,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: MF_FIELDS,
    }),
  });

  if (!res.ok) throw new Error(`Tushare HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.code !== 0) throw new Error(payload.msg || 'Tushare error');

  const { fields = [], items = [] } = payload.data;
  return items
    .map(item => fields.reduce((r, f, i) => { r[f] = item[i]; return r; }, {}))
    .map(r => ({
      trade_date:      String(r.trade_date),
      buy_elg_amount:  Number(r.buy_elg_amount  ?? 0),
      sell_elg_amount: Number(r.sell_elg_amount ?? 0),
      buy_lg_amount:   Number(r.buy_lg_amount   ?? 0),
      sell_lg_amount:  Number(r.sell_lg_amount  ?? 0),
      buy_sm_amount:   Number(r.buy_sm_amount   ?? 0),
      sell_sm_amount:  Number(r.sell_sm_amount  ?? 0),
      net_mf_amount:   Number(r.net_mf_amount   ?? 0),
    }))
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

function nextDay(yyyymmdd) {
  const d = new Date(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)) - 1,
    Number(yyyymmdd.slice(6, 8)) + 1,
  );
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 确保 tsCode 的 moneyflow CSV 是最新的，返回全量缓存数据。
 * 自动增量拉取缺失日期。
 */
export async function ensureMoneyflow(tsCode, endDate = '') {
  mkdirSync(CACHE_DIR, { recursive: true });
  const end     = endDate || todayCompact();
  const cached  = readCached(tsCode);
  const lastDate = cached.length ? cached[cached.length - 1].trade_date : '20100101';

  if (lastDate >= end) {
    log.info(`${tsCode} moneyflow up-to-date`, { last: lastDate });
    return cached;
  }

  const startDate = nextDay(lastDate);
  log.info(`${tsCode} fetching moneyflow`, { from: startDate, to: end });

  try {
    const fresh = await fetchTushare(tsCode, startDate, end);
    const merged = [...cached, ...fresh.filter(r => r.trade_date > lastDate)]
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    writeCache(tsCode, merged);
    log.info(`${tsCode} moneyflow updated`, { added: fresh.length, total: merged.length });
    return merged;
  } catch (e) {
    log.warn(`${tsCode} moneyflow fetch failed — using cache`, { error: e.message });
    return cached;
  }
}

export { readCached as readMoneyflowCache };
