import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CACHE_DIR = resolve(process.cwd(), 'cache');
const KLINE_DIR = resolve(CACHE_DIR, 'kline');
const META_PATH = resolve(CACHE_DIR, 'meta.json');
const ENV_LOCAL_PATH = resolve(process.cwd(), '.env.local');
const TUSHARE_API = 'http://api.tushare.pro';
const DEFAULT_START_DATE = '20050101';
const DEFAULT_SYMBOLS = [
  { tsCode: '600519.SH', securityType: 'stock' },
  { tsCode: '000300.SH', securityType: 'index' },
];
const CSV_HEADERS = ['trade_date', 'open', 'high', 'low', 'close', 'close_adj', 'volume', 'amount', 'turnover_rate'];

const readEnvLocalToken = () => {
  if (!existsSync(ENV_LOCAL_PATH)) {
    return '';
  }

  const sourceText = readFileSync(ENV_LOCAL_PATH, 'utf8');
  for (const rawLine of sourceText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (key !== 'TUSHARE_TOKEN') {
      continue;
    }

    return line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
  }

  return '';
};

const readToken = () => readEnvLocalToken() || process.env.TUSHARE_TOKEN || '';

const ensureCacheLayout = () => {
  mkdirSync(KLINE_DIR, { recursive: true });
  if (!existsSync(META_PATH)) {
    writeFileSync(META_PATH, '{}\n', 'utf8');
  }
};

const assertTsCode = (tsCode) => {
  if (!/^\d{6}\.(SH|SZ)$/.test(tsCode)) {
    throw new Error(`Unsupported ts_code: ${tsCode}`);
  }
};

const csvPathForTsCode = (tsCode) => resolve(KLINE_DIR, `${tsCode}.csv`);

const normalizeDate = (value) => {
  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.replace(/-/g, '');
  }

  throw new Error(`Unsupported date value: ${value}`);
};

const todayYmd = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const nextDate = (value) => {
  const normalized = normalizeDate(value);
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  const next = new Date(year, month - 1, day + 1);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, '0'),
    String(next.getDate()).padStart(2, '0'),
  ].join('');
};

const toNumber = (value, digits = 4) => Number(Number(value ?? 0).toFixed(digits));

const mapRows = ({ fields = [], items = [] } = {}) =>
  items.map((item) =>
    fields.reduce((record, field, index) => {
      record[field] = item[index];
      return record;
    }, {}),
  );

const readMeta = () => {
  ensureCacheLayout();
  const sourceText = readFileSync(META_PATH, 'utf8').trim();
  if (!sourceText) {
    return {};
  }

  const parsed = JSON.parse(sourceText);
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const writeMeta = (meta) => {
  writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
};

const escapeCsvValue = (value) => {
  const text = value == null ? '' : String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
};

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
};

const readCsvRows = (tsCode) => {
  assertTsCode(tsCode);
  const filePath = csvPathForTsCode(tsCode);
  if (!existsSync(filePath)) {
    return [];
  }

  const sourceText = readFileSync(filePath, 'utf8').trim();
  if (!sourceText) {
    return [];
  }

  const [headerLine, ...dataLines] = sourceText.split(/\r?\n/);
  const headers = parseCsvLine(headerLine);

  return dataLines
    .filter(Boolean)
    .map((line) => {
      const values = parseCsvLine(line);
      const row = headers.reduce((record, header, index) => {
        record[header] = values[index] ?? '';
        return record;
      }, {});

      return {
        trade_date: normalizeDate(row.trade_date),
        open: toNumber(row.open),
        high: toNumber(row.high),
        low: toNumber(row.low),
        close: toNumber(row.close),
        close_adj: toNumber(row.close_adj),
        volume: toNumber(row.volume),
        amount: toNumber(row.amount),
        turnover_rate: toNumber(row.turnover_rate),
      };
    })
    .sort((left, right) => left.trade_date.localeCompare(right.trade_date));
};

const ensureCsvFile = (tsCode) => {
  assertTsCode(tsCode);
  const filePath = csvPathForTsCode(tsCode);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${CSV_HEADERS.join(',')}\n`, 'utf8');
  }
  return filePath;
};

const serializeRows = (rows) =>
  rows
    .map((row) => CSV_HEADERS.map((header) => escapeCsvValue(row[header])).join(','))
    .join('\n');

const rewriteCsvRows = (tsCode, rows) => {
  const filePath = ensureCsvFile(tsCode);
  const body = serializeRows(rows);
  const content = body ? `${CSV_HEADERS.join(',')}\n${body}\n` : `${CSV_HEADERS.join(',')}\n`;
  writeFileSync(filePath, content, 'utf8');
};

const appendCsvRows = (tsCode, rows) => {
  if (!rows.length) {
    return;
  }

  const filePath = ensureCsvFile(tsCode);
  appendFileSync(filePath, `${serializeRows(rows)}\n`, 'utf8');
};

const fetchTushare = async (token, apiName, params, fields = '') => {
  const response = await fetch(TUSHARE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_name: apiName,
      token,
      params,
      fields,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tushare upstream error: ${response.status}`);
  }

  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.msg || 'Tushare returned a non-zero code');
  }

  return mapRows(payload.data);
};

const normalizeStockRows = (rows) =>
  rows
    .map((row) => {
      const qfqClose = toNumber(row.close);
      return {
        trade_date: normalizeDate(row.trade_date),
        open: toNumber(row.open),
        high: toNumber(row.high),
        low: toNumber(row.low),
        close: qfqClose,
        close_adj: qfqClose,
        volume: toNumber(row.vol),
        amount: toNumber(row.amount),
        turnover_rate: toNumber(row.turnover_rate ?? 0),
      };
    })
    .sort((left, right) => left.trade_date.localeCompare(right.trade_date));

const normalizeIndexRows = (rows) =>
  rows
    .map((row) => {
      const close = toNumber(row.close);
      return {
        trade_date: normalizeDate(row.trade_date),
        open: toNumber(row.open),
        high: toNumber(row.high),
        low: toNumber(row.low),
        close,
        close_adj: close,
        volume: toNumber(row.vol),
        amount: toNumber(row.amount),
        turnover_rate: 0,
      };
    })
    .sort((left, right) => left.trade_date.localeCompare(right.trade_date));

const fetchStockKlineQfq = async (token, tsCode, startDate, endDate) => {
  const rows = await fetchTushare(
    token,
    'pro_bar',
    {
      ts_code: tsCode,
      start_date: startDate,
      end_date: endDate,
      adj: 'qfq',
    },
    'trade_date,open,high,low,close,vol,amount,turnover_rate',
  );
  return normalizeStockRows(rows);
};

const fetchIndexKline = async (token, tsCode, startDate, endDate) => {
  const rows = await fetchTushare(
    token,
    'index_daily',
    {
      ts_code: tsCode,
      start_date: startDate,
      end_date: endDate,
    },
    'trade_date,open,high,low,close,vol,amount',
  );
  return normalizeIndexRows(rows);
};

const getSecurityType = (tsCode, meta) => meta[tsCode]?.securityType || (tsCode === '000300.SH' ? 'index' : 'stock');

const fetchSymbolRows = async (tsCode, securityType, startDate, endDate) => {
  const token = readToken();
  if (!token) {
    throw new Error('Missing TUSHARE_TOKEN environment variable');
  }

  if (securityType === 'index') {
    return fetchIndexKline(token, tsCode, startDate, endDate);
  }

  return fetchStockKlineQfq(token, tsCode, startDate, endDate);
};

export const ensureSymbolCsv = async (tsCode, securityType) => {
  ensureCacheLayout();
  assertTsCode(tsCode);

  const meta = readMeta();
  const resolvedSecurityType = securityType || getSecurityType(tsCode, meta);
  const filePath = ensureCsvFile(tsCode);
  const lastUpdate = meta[tsCode]?.lastUpdate || null;
  const endDate = todayYmd();

  if (!lastUpdate || !existsSync(filePath) || readCsvRows(tsCode).length === 0) {
    const rows = await fetchSymbolRows(tsCode, resolvedSecurityType, DEFAULT_START_DATE, endDate);
    rewriteCsvRows(tsCode, rows);
    meta[tsCode] = {
      securityType: resolvedSecurityType,
      lastUpdate: rows.length ? rows[rows.length - 1].trade_date : endDate,
    };
    writeMeta(meta);
    return {
      tsCode,
      securityType: resolvedSecurityType,
      mode: 'full',
      rows: rows.length,
      latestTradeDate: rows.length ? rows[rows.length - 1].trade_date : '',
    };
  }

  const fetchStartDate = nextDate(lastUpdate);
  if (fetchStartDate > endDate) {
    const existingRows = readCsvRows(tsCode);
    return {
      tsCode,
      securityType: resolvedSecurityType,
      mode: 'incremental',
      rows: existingRows.length,
      latestTradeDate: lastUpdate,
      appended: 0,
    };
  }

  const incomingRows = await fetchSymbolRows(tsCode, resolvedSecurityType, fetchStartDate, endDate);
  const newRows = incomingRows.filter((row) => row.trade_date > lastUpdate);

  if (newRows.length) {
    appendCsvRows(tsCode, newRows);
    meta[tsCode] = {
      securityType: resolvedSecurityType,
      lastUpdate: newRows[newRows.length - 1].trade_date,
    };
    writeMeta(meta);
  }

  const allRows = readCsvRows(tsCode);
  return {
    tsCode,
    securityType: resolvedSecurityType,
    mode: 'incremental',
    rows: allRows.length,
    latestTradeDate: meta[tsCode]?.lastUpdate || lastUpdate,
    appended: newRows.length,
  };
};

export const readDaily = (tsCode, startDate, endDate) => {
  ensureCacheLayout();
  assertTsCode(tsCode);
  const normalizedStart = normalizeDate(startDate);
  const normalizedEnd = normalizeDate(endDate);

  return readCsvRows(tsCode).filter(
    (row) => row.trade_date >= normalizedStart && row.trade_date <= normalizedEnd,
  );
};

export const warmupDefaultSymbols = async () => {
  const results = [];
  for (const item of DEFAULT_SYMBOLS) {
    results.push(await ensureSymbolCsv(item.tsCode, item.securityType));
  }
  return results;
};

if (process.argv[1]?.endsWith('csv-manager.mjs')) {
  const main = async () => {
    const results = await warmupDefaultSymbols();
    for (const result of results) {
      console.log(`${result.tsCode} rows=${result.rows} latest=${result.latestTradeDate}`);
    }
  };

  main().catch((error) => {
    console.error(`[csv-manager] ${error.message}`);
    process.exitCode = 1;
  });
}
