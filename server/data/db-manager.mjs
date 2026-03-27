import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CACHE_DIR = resolve(process.cwd(), 'cache');
const META_PATH = resolve(CACHE_DIR, 'meta.csv');
const ENV_LOCAL_PATH = resolve(process.cwd(), '.env.local');
const TUSHARE_API = 'http://api.tushare.pro';
const DEFAULT_START_DATE = '20050101';
const DEFAULT_STOCK_TS_CODE = '600519.SH';
const DEFAULT_INDEX_TS_CODE = '000300.SH';

const STOCK_DAILY_FIELDS = 'trade_date,open,high,low,close,vol,amount';
const STOCK_DAILY_BASIC_FIELDS = 'trade_date,turnover_rate';
const STOCK_ADJ_FACTOR_FIELDS = 'trade_date,adj_factor';
const INDEX_DAILY_FIELDS = 'trade_date,open,high,low,close,vol,amount';
const DAILY_HEADERS = ['trade_date', 'open', 'high', 'low', 'close', 'close_adj', 'volume', 'amount', 'turnover_rate'];
const META_HEADERS = ['ts_code', 'security_type', 'last_trade_date', 'updated_at'];

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

const normalizeDate = (value) => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  throw new Error(`Unsupported date value: ${value}`);
};

const compactDate = (value) => normalizeDate(value).replace(/-/g, '');

const todayAsCompactDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const addOneDay = (value) => {
  const normalized = normalizeDate(value);
  const [year, month, day] = normalized.split('-').map(Number);
  const next = new Date(year, month - 1, day + 1);
  const nextYear = next.getFullYear();
  const nextMonth = String(next.getMonth() + 1).padStart(2, '0');
  const nextDay = String(next.getDate()).padStart(2, '0');
  return `${nextYear}${nextMonth}${nextDay}`;
};

const mapRows = ({ fields = [], items = [] } = {}) =>
  items.map((item) =>
    fields.reduce((record, field, index) => {
      record[field] = item[index];
      return record;
    }, {}),
  );

const assertTsCode = (tsCode) => {
  if (!/^\d{6}\.(SH|SZ)$/.test(tsCode)) {
    throw new Error(`Unsupported ts_code: ${tsCode}`);
  }
};

const tableNameForTsCode = (tsCode) => `daily_${tsCode.replace('.', '_')}`;
const csvPathForTsCode = (tsCode) => resolve(CACHE_DIR, `${tableNameForTsCode(tsCode)}.csv`);

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

const readCsv = (filePath) => {
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
      return headers.reduce((record, header, index) => {
        record[header] = values[index] ?? '';
        return record;
      }, {});
    });
};

const writeCsv = (filePath, headers, rows) => {
  const lines = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ];
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
};

const toNumber = (value, digits = 4) => Number(Number(value ?? 0).toFixed(digits));

const normalizeDailyRow = (row) => ({
  trade_date: normalizeDate(row.trade_date),
  open: toNumber(row.open),
  high: toNumber(row.high),
  low: toNumber(row.low),
  close: toNumber(row.close),
  close_adj: toNumber(row.close_adj),
  volume: toNumber(row.volume),
  amount: toNumber(row.amount),
  turnover_rate: toNumber(row.turnover_rate),
});

const readMetaRows = () =>
  readCsv(META_PATH).map((row) => ({
    ts_code: row.ts_code,
    security_type: row.security_type,
    last_trade_date: normalizeDate(row.last_trade_date),
    updated_at: row.updated_at,
  }));

const writeMetaRows = (rows) => {
  writeCsv(META_PATH, META_HEADERS, rows);
};

const readDailyRows = (tsCode) =>
  readCsv(csvPathForTsCode(tsCode))
    .map(normalizeDailyRow)
    .sort((left, right) => left.trade_date.localeCompare(right.trade_date));

const writeDailyRows = (tsCode, rows) => {
  const normalizedRows = rows
    .map(normalizeDailyRow)
    .sort((left, right) => left.trade_date.localeCompare(right.trade_date));
  writeCsv(csvPathForTsCode(tsCode), DAILY_HEADERS, normalizedRows);
};

const fetchTushare = async (token, apiName, params, fields) => {
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

const buildStockRows = async (token, tsCode, startDate, endDate) => {
  const [dailyRows, dailyBasicRows, adjFactorRows] = await Promise.all([
    fetchTushare(token, 'daily', { ts_code: tsCode, start_date: startDate, end_date: endDate }, STOCK_DAILY_FIELDS),
    fetchTushare(token, 'daily_basic', { ts_code: tsCode, start_date: startDate, end_date: endDate }, STOCK_DAILY_BASIC_FIELDS),
    fetchTushare(token, 'adj_factor', { ts_code: tsCode, start_date: startDate, end_date: endDate }, STOCK_ADJ_FACTOR_FIELDS),
  ]);

  const turnoverRateByDate = new Map(dailyBasicRows.map((row) => [row.trade_date, Number(row.turnover_rate ?? 0)]));
  const adjFactorByDate = new Map(adjFactorRows.map((row) => [row.trade_date, Number(row.adj_factor ?? 1)]));
  const latestAdjFactor = adjFactorRows.length ? Number(adjFactorRows[0].adj_factor ?? 1) : 1;

  return dailyRows
    .map((row) => {
      const close = Number(row.close ?? 0);
      const adjFactor = adjFactorByDate.get(row.trade_date) ?? latestAdjFactor ?? 1;
      const closeAdj = latestAdjFactor ? close * (adjFactor / latestAdjFactor) : close;

      return {
        trade_date: normalizeDate(row.trade_date),
        open: toNumber(row.open),
        high: toNumber(row.high),
        low: toNumber(row.low),
        close,
        close_adj: toNumber(closeAdj),
        volume: toNumber(row.vol),
        amount: toNumber(row.amount),
        turnover_rate: toNumber(turnoverRateByDate.get(row.trade_date) ?? 0),
      };
    })
    .sort((left, right) => left.trade_date.localeCompare(right.trade_date));
};

const buildIndexRows = async (token, tsCode, startDate, endDate) => {
  const rows = await fetchTushare(
    token,
    'index_daily',
    { ts_code: tsCode, start_date: startDate, end_date: endDate },
    INDEX_DAILY_FIELDS,
  );

  return rows
    .map((row) => {
      const close = Number(row.close ?? 0);
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
};

const ensureCacheDir = () => {
  mkdirSync(CACHE_DIR, { recursive: true });
};

export const createDbManager = (dbPath = CACHE_DIR) => {
  ensureCacheDir();
  const resolvedPath = dbPath;

  const init = () => {
    if (!existsSync(META_PATH)) {
      writeMetaRows([]);
    }
  };

  const ensureDailyTable = (tsCode) => {
    assertTsCode(tsCode);
    const filePath = csvPathForTsCode(tsCode);
    if (!existsSync(filePath)) {
      writeCsv(filePath, DAILY_HEADERS, []);
    }
    return tableNameForTsCode(tsCode);
  };

  const getLastUpdate = (tsCode) => {
    const row = readMetaRows().find((item) => item.ts_code === tsCode);
    return row?.last_trade_date ?? null;
  };

  const setLastUpdate = (tsCode, securityType, lastTradeDate) => {
    const rows = readMetaRows().filter((item) => item.ts_code !== tsCode);
    rows.push({
      ts_code: tsCode,
      security_type: securityType,
      last_trade_date: normalizeDate(lastTradeDate),
      updated_at: new Date().toISOString(),
    });
    rows.sort((left, right) => left.ts_code.localeCompare(right.ts_code));
    writeMetaRows(rows);
  };

  const upsertDailyRows = (tsCode, rows, securityType) => {
    if (!rows.length) {
      return { inserted: 0, lastTradeDate: getLastUpdate(tsCode) };
    }

    ensureDailyTable(tsCode);
    const mergedByDate = new Map(readDailyRows(tsCode).map((row) => [row.trade_date, row]));
    for (const row of rows.map(normalizeDailyRow)) {
      mergedByDate.set(row.trade_date, row);
    }
    writeDailyRows(tsCode, [...mergedByDate.values()]);
    const lastTradeDate = rows[rows.length - 1].trade_date;
    setLastUpdate(tsCode, securityType, lastTradeDate);
    return { inserted: rows.length, lastTradeDate };
  };

  const fetchSeries = async (tsCode, securityType, startDate, endDate) => {
    const token = readToken();
    if (!token) {
      throw new Error('Missing TUSHARE_TOKEN environment variable');
    }

    if (securityType === 'index') {
      return buildIndexRows(token, tsCode, startDate, endDate);
    }

    return buildStockRows(token, tsCode, startDate, endDate);
  };

  const fetchAndCacheFull = async (tsCode, securityType = 'stock', startDate = DEFAULT_START_DATE, endDate = todayAsCompactDate()) => {
    init();
    const rows = await fetchSeries(tsCode, securityType, startDate, endDate);
    return {
      mode: 'full',
      tsCode,
      securityType,
      startDate,
      endDate,
      ...upsertDailyRows(tsCode, rows, securityType),
    };
  };

  const fetchAndCacheIncremental = async (tsCode, securityType = 'stock', endDate = todayAsCompactDate()) => {
    init();
    const lastTradeDate = getLastUpdate(tsCode);

    if (!lastTradeDate) {
      return fetchAndCacheFull(tsCode, securityType, DEFAULT_START_DATE, endDate);
    }

    const startDate = addOneDay(lastTradeDate);
    const normalizedEndDate = compactDate(endDate);
    if (startDate > normalizedEndDate) {
      return {
        mode: 'incremental',
        tsCode,
        securityType,
        startDate,
        endDate: normalizedEndDate,
        inserted: 0,
        lastTradeDate,
      };
    }

    const rows = await fetchSeries(tsCode, securityType, startDate, normalizedEndDate);
    return {
      mode: 'incremental',
      tsCode,
      securityType,
      startDate,
      endDate: normalizedEndDate,
      ...upsertDailyRows(tsCode, rows, securityType),
    };
  };

  const ensureSymbolData = async (tsCode, securityType = 'stock', startDate = DEFAULT_START_DATE, endDate = todayAsCompactDate()) => {
    init();
    ensureDailyTable(tsCode);

    if (!getLastUpdate(tsCode)) {
      return fetchAndCacheFull(tsCode, securityType, startDate, endDate);
    }

    return fetchAndCacheIncremental(tsCode, securityType, endDate);
  };

  const readDaily = (tsCode, startDate, endDate) => {
    init();
    ensureDailyTable(tsCode);
    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);

    return readDailyRows(tsCode)
      .filter((row) => row.trade_date >= normalizedStart && row.trade_date <= normalizedEnd)
      .map((row) => ({
        date: row.trade_date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        close_adj: row.close_adj,
        volume: row.volume,
        amount: row.amount,
        turnover_rate: row.turnover_rate,
      }));
  };

  const warmupDefaultSymbols = async () => {
    const stockResult = await ensureSymbolData(DEFAULT_STOCK_TS_CODE, 'stock');
    const indexResult = await ensureSymbolData(DEFAULT_INDEX_TS_CODE, 'index');
    return { stockResult, indexResult, dbPath: resolvedPath, metaPath: META_PATH };
  };

  const close = () => {};

  init();

  return {
    dbPath: resolvedPath,
    init,
    ensureDailyTable,
    getLastUpdate,
    setLastUpdate,
    upsertDailyRows,
    fetchAndCacheFull,
    fetchAndCacheIncremental,
    ensureSymbolData,
    readDaily,
    warmupDefaultSymbols,
    close,
  };
};

if (process.argv[1]?.endsWith('db-manager.mjs')) {
  const manager = createDbManager();

  const main = async () => {
    const result = await manager.warmupDefaultSymbols();
    console.log(JSON.stringify(result, null, 2));
  };

  main()
    .catch((error) => {
      console.error(`[db-manager] ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      manager.close();
    });
}
