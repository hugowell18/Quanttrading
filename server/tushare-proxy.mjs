import { createServer } from 'node:http';
import { existsSync, readFileSync as readTextFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.TUSHARE_PORT || 3030);
const ENV_LOCAL_PATH = resolve(process.cwd(), '.env.local');
const readEnvLocalToken = () => {
  if (!existsSync(ENV_LOCAL_PATH)) {
    return '';
  }

  const sourceText = readTextFileSync(ENV_LOCAL_PATH, 'utf8');
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

    const value = line.slice(separatorIndex + 1).trim();
    return value.replace(/^['"]|['"]$/g, '');
  }

  return '';
};

const TOKEN = readEnvLocalToken() || process.env.TUSHARE_TOKEN || '';
const TUSHARE_API = 'http://api.tushare.pro';

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
};

const fetchTushare = async (apiName, params, fields) => {
  const response = await fetch(TUSHARE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_name: apiName,
      token: TOKEN,
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

  return payload.data;
};

const mapRows = ({ fields, items }) =>
  items.map((item) =>
    fields.reduce((record, field, index) => {
      record[field] = item[index];
      return record;
    }, {}),
  );

const formatTradeDate = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const average = (values) => {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const computeIndicators = (candles) => {
  const enriched = [];
  let ema12 = 0;
  let ema26 = 0;
  let dea = 0;
  let previousK = 50;
  let previousD = 50;
  let gainAverage = 0;
  let lossAverage = 0;

  candles.forEach((item, index) => {
    const close = item.close;
    const recentCloses = candles.slice(Math.max(0, index - 19), index + 1).map((entry) => entry.close);
    const ma5 = average(candles.slice(Math.max(0, index - 4), index + 1).map((entry) => entry.close));
    const ma10 = average(candles.slice(Math.max(0, index - 9), index + 1).map((entry) => entry.close));
    const ma20 = average(recentCloses);

    ema12 = index === 0 ? close : ema12 * (11 / 13) + close * (2 / 13);
    ema26 = index === 0 ? close : ema26 * (25 / 27) + close * (2 / 27);
    const dif = ema12 - ema26;
    dea = index === 0 ? dif : dea * (8 / 10) + dif * (2 / 10);
    const macd = (dif - dea) * 2;

    const previousClose = candles[Math.max(0, index - 1)]?.close ?? close;
    const change = close - previousClose;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (index === 0) {
      gainAverage = gain;
      lossAverage = loss;
    } else {
      gainAverage = (gainAverage * 13 + gain) / 14;
      lossAverage = (lossAverage * 13 + loss) / 14;
    }
    const relativeStrength = lossAverage === 0 ? 100 : gainAverage / lossAverage;
    const rsi = lossAverage === 0 ? 100 : 100 - 100 / (1 + relativeStrength);

    const recentPeriod = candles.slice(Math.max(0, index - 8), index + 1);
    const periodHigh = Math.max(...recentPeriod.map((entry) => entry.high));
    const periodLow = Math.min(...recentPeriod.map((entry) => entry.low));
    const rsv = periodHigh === periodLow ? 50 : ((close - periodLow) / (periodHigh - periodLow)) * 100;
    const k = previousK * (2 / 3) + rsv / 3;
    const d = previousD * (2 / 3) + k / 3;
    const j = 3 * k - 2 * d;
    previousK = k;
    previousD = d;

    enriched.push({
      date: item.date,
      open: item.open,
      close,
      high: item.high,
      low: item.low,
      volume: item.volume,
      k: Number(k.toFixed(2)),
      d: Number(d.toFixed(2)),
      j: Number(j.toFixed(2)),
      dif: Number(dif.toFixed(3)),
      dea: Number(dea.toFixed(3)),
      macd: Number(macd.toFixed(3)),
      rsi: Number(rsi.toFixed(2)),
      ma5: Number(ma5.toFixed(2)),
      ma10: Number(ma10.toFixed(2)),
      ma20: Number(ma20.toFixed(2)),
    });
  });

  return enriched;
};

const generateTrades = (candles, capitalWan, stopLossPercent, takeProfitPercent) => {
  const trades = [];
  const capital = capitalWan * 10000;
  let openTrade = null;

  candles.forEach((item, index) => {
    const previous = candles[index - 1];
    if (!previous) {
      return;
    }

    const crossedUp = previous.dif <= previous.dea && item.dif > item.dea;
    const crossedDown = previous.dif >= previous.dea && item.dif < item.dea;

    if (!openTrade && crossedUp && item.rsi < 70 && item.close >= item.ma10) {
      openTrade = {
        buyDate: item.date,
        buyPrice: item.close,
      };
      return;
    }

    if (!openTrade) {
      return;
    }

    const returnPct = ((item.close - openTrade.buyPrice) / openTrade.buyPrice) * 100;
    const hitStopLoss = returnPct <= -stopLossPercent;
    const hitTakeProfit = returnPct >= takeProfitPercent;

    if (crossedDown || hitStopLoss || hitTakeProfit || index === candles.length - 1) {
      const shares = capital / openTrade.buyPrice;
      const returnAmount = shares * (item.close - openTrade.buyPrice);
      trades.push({
        id: `${openTrade.buyDate}-${item.date}-${trades.length + 1}`,
        buyDate: openTrade.buyDate,
        buyPrice: Number(openTrade.buyPrice.toFixed(2)),
        sellDate: item.date,
        sellPrice: Number(item.close.toFixed(2)),
        returnPct: Number(returnPct.toFixed(2)),
        returnAmount: Number(returnAmount.toFixed(2)),
        result: returnPct >= 0 ? 'success' : 'failure',
      });
      openTrade = null;
    }
  });

  return trades;
};

const resolveDateRange = (period) => {
  const end = new Date();
  const start = new Date(end);
  const monthsByPeriod = {
    '3m': 3,
    '6m': 6,
    '1y': 12,
    '3y': 36,
  };
  start.setMonth(start.getMonth() - (monthsByPeriod[period] || 12));

  const serialize = (value) =>
    `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, '0')}${String(value.getDate()).padStart(2, '0')}`;

  return {
    startDate: serialize(start),
    endDate: serialize(end),
  };
};

const loadStockInfo = async (symbol) => {
  const guesses = /^6/.test(symbol) ? [`${symbol}.SH`, `${symbol}.SZ`] : [`${symbol}.SZ`, `${symbol}.SH`];

  for (const tsCode of guesses) {
    const data = await fetchTushare('stock_basic', { ts_code: tsCode, list_status: 'L' }, 'ts_code,symbol,name,industry');
    const rows = mapRows(data);
    if (rows[0]) {
      return rows[0];
    }
  }

  const fallbackData = await fetchTushare('stock_basic', { symbol, list_status: 'L' }, 'ts_code,symbol,name,industry');
  const fallbackRows = mapRows(fallbackData);
  if (!fallbackRows[0]) {
    throw new Error(`No listed stock found for symbol ${symbol}`);
  }

  return fallbackRows[0];
};

const loadDailyCandles = async (tsCode, period) => {
  const { startDate, endDate } = resolveDateRange(period);
  const data = await fetchTushare(
    'daily',
    {
      ts_code: tsCode,
      start_date: startDate,
      end_date: endDate,
    },
    'trade_date,open,high,low,close,vol',
  );

  return mapRows(data)
    .map((item) => ({
      date: formatTradeDate(item.trade_date),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      volume: Math.round(Number(item.vol)),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  if (!TOKEN) {
    sendJson(response, 500, { error: 'Missing TUSHARE_TOKEN environment variable' });
    return;
  }

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host}`);
  const match = requestUrl.pathname.match(/^\/api\/tushare\/stock\/(\d{6})$/);
  if (!match) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const symbol = match[1];
  const period = requestUrl.searchParams.get('period') || '1y';
  const capital = Number(requestUrl.searchParams.get('capital') || 100);
  const stopLoss = Number(requestUrl.searchParams.get('stopLoss') || 8);
  const takeProfit = Number(requestUrl.searchParams.get('takeProfit') || 20);

  try {
    const stock = await loadStockInfo(symbol);
    const candles = await loadDailyCandles(stock.ts_code, period);
    const enrichedCandles = computeIndicators(candles);
    const trades = generateTrades(enrichedCandles, capital, stopLoss, takeProfit);
    const successfulTrades = trades.filter((item) => item.result === 'success').length;
    const successRate = trades.length ? Number(((successfulTrades / trades.length) * 100).toFixed(1)) : 0;

    sendJson(response, 200, {
      stock: {
        code: stock.symbol,
        name: stock.name,
        industry: stock.industry || '未知行业',
        successRate,
      },
      candles: enrichedCandles,
      trades,
      source: {
        tsCode: stock.ts_code,
        fetchedAt: new Date().toISOString(),
        period,
      },
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Unknown proxy error',
    });
  }
});

server.listen(PORT, () => {
  console.log(`Tushare proxy listening on http://localhost:${PORT}`);
});