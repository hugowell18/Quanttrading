import { createServer } from 'node:http';
import { existsSync, readFileSync as readTextFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureSymbolCsv, readDaily } from './data/csv-manager.mjs';
import {
  buildSignalMarkers,
  buildTradeRecordsFromRaw,
  evaluateCandidateStrategies,
  executeStrategyById,
  inferStrategySignal,
} from './quant/backtests.mjs';
import { classifyRegime } from './quant/classifier.mjs';
import { buildFeatures } from './quant/features.mjs';
import { computeIndicators } from './quant/indicators.mjs';
import { optimizeStrategyModel } from './quant/optimizer.mjs';
import { selectAdaptiveStrategy } from './quant/selector.mjs';
import { optimize } from './reverse-label/optimizer.mjs';
import { STOCK_UNIVERSE } from './reverse-label/stock-universe.mjs';

const PORT = Number(process.env.TUSHARE_PORT || 3030);
const ENV_LOCAL_PATH = resolve(process.cwd(), '.env.local');
const BATCH_SUMMARY_PATH = resolve(process.cwd(), 'results', 'batch', 'summary.json');
const STOCK_UNIVERSE_MAP = new Map(STOCK_UNIVERSE.map((item) => [item.code, item]));

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
    'Cache-Control': 'no-store',
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
  const securityType = tsCode === '000300.SH' ? 'index' : 'stock';
  await ensureSymbolCsv(tsCode, securityType);

  return readDaily(tsCode, startDate, endDate)
    .map((item) => ({
      date: formatTradeDate(item.trade_date),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close_adj ?? item.close),
      close_adj: Number(item.close_adj ?? item.close),
      close_raw: Number(item.close),
      volume: Math.round(Number(item.volume)),
      amount: Number(item.amount ?? 0),
      turnover_rate: Number(item.turnover_rate ?? 0),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const buildTradeSignature = (rawTrades) =>
  rawTrades
    .map((trade) => `${trade.buyDate}|${trade.sellDate}|${Number(trade.buyPrice).toFixed(2)}|${Number(trade.sellPrice).toFixed(2)}`)
    .sort()
    .join(';');

const buildDistinctBaseExecutions = (strategies, candles, capital, stopLoss, takeProfit, limit = 6) => {
  const executions = [];
  const seen = new Set();

  for (const strategy of strategies) {
    const execution = executeStrategyById(strategy.strategyId, candles, capital, stopLoss, takeProfit);
    if (!execution) {
      continue;
    }

    const signature = buildTradeSignature(execution.rawTrades);
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    executions.push(execution);
    if (executions.length >= limit) {
      break;
    }
  }

  return executions;
};

const buildStrategyOptions = (executions, optimizedStrategy) => [
  {
    id: 'adaptive_composite_e',
    label: `${optimizedStrategy.strategyName} (Recommended)`,
    kind: 'composite',
    score: optimizedStrategy.metrics.score,
  },
  ...executions.slice(0, 3).map((execution) => ({
    id: execution.strategy.strategyId,
    label: execution.strategy.strategyName,
    kind: 'base',
    score: execution.strategy.score,
  })),
];

const resolveSelectedStrategy = (requestedMode, strategyOptions) => {
  if (requestedMode === 'adaptive_composite_e') {
    return 'adaptive_composite_e';
  }

  const matched = strategyOptions.find((item) => item.id === requestedMode && item.kind === 'base');
  return matched?.id || 'adaptive_composite_e';
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
  const stockMatch = requestUrl.pathname.match(/^\/api\/tushare\/stock\/(\d{6})$/);
  const optimizerMatch = requestUrl.pathname.match(/^\/api\/tushare\/optimizer\/(\d{6})$/);
  const indexMatch = requestUrl.pathname.match(/^\/api\/tushare\/index\/(\d{6})$/);
  const batchSummaryMatch = requestUrl.pathname === '/api/tushare/batch/summary';

  if (batchSummaryMatch) {
    if (!existsSync(BATCH_SUMMARY_PATH)) {
      sendJson(response, 404, { error: 'Batch summary not found. Run batch-runner first.' });
      return;
    }

    const summary = JSON.parse(readTextFileSync(BATCH_SUMMARY_PATH, 'utf8'));
    const decorate = (items = []) => items.map((item) => {
      const stock = STOCK_UNIVERSE_MAP.get(item.code);
      return stock ? { ...item, name: stock.name, sector: stock.sector } : item;
    });
    sendJson(response, 200, {
      ...summary,
      strictPassed: decorate(summary.strictPassed),
      weakPassed: decorate(summary.weakPassed),
      failed: decorate(summary.failed),
    });
    return;
  }

  if (indexMatch) {
    const symbol = indexMatch[1];
    const period = requestUrl.searchParams.get('period') || '1y';
    // Map 6-digit index symbol to ts_code (000300 → 000300.SH, others → .SH fallback)
    const tsCode = `${symbol}.SH`;
    try {
      const candles = await loadDailyCandles(tsCode, period);
      sendJson(response, 200, { tsCode, candles });
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error ? error.message : 'Index fetch error' });
    }
    return;
  }

  if (!stockMatch && !optimizerMatch) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  if (optimizerMatch) {
    const symbol = optimizerMatch[1];
    const period = requestUrl.searchParams.get('period') || '1y';
    const { startDate, endDate } = resolveDateRange(period);

    try {
      const summary = await optimize(symbol, startDate, endDate);
      sendJson(response, 200, summary);
    } catch (error) {
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : 'Unknown optimizer error',
      });
    }
    return;
  }

  const symbol = stockMatch[1];
  const period = requestUrl.searchParams.get('period') || '1y';
  const capital = Number(requestUrl.searchParams.get('capital') || 100);
  const stopLoss = Number(requestUrl.searchParams.get('stopLoss') || 8);
  const takeProfit = Number(requestUrl.searchParams.get('takeProfit') || 20);
  const strategyMode = requestUrl.searchParams.get('strategyMode') || 'adaptive_composite_e';

  try {
    const stock = await loadStockInfo(symbol);
    const candles = await loadDailyCandles(stock.ts_code, period);
    const enrichedCandles = computeIndicators(candles);
    const features = buildFeatures(enrichedCandles);
    const regime = classifyRegime(features);
    const allStrategies = evaluateCandidateStrategies(enrichedCandles, capital, stopLoss, takeProfit);
    const bestStrategy = selectAdaptiveStrategy({ features, regime, strategies: allStrategies });
    const distinctBaseExecutions = buildDistinctBaseExecutions(allStrategies, enrichedCandles, capital, stopLoss, takeProfit);
    const optimizedStrategy = optimizeStrategyModel({
      candles: enrichedCandles,
      capital,
      stopLoss,
      takeProfit,
      candidateStrategies: distinctBaseExecutions.slice(0, 3).map((item) => item.strategy),
    });

    const effectiveOptimizedStrategy = optimizedStrategy ?? {
      strategyId: 'adaptive_composite_e',
      strategyName: '优化模型 E2',
      metrics: {
        score: Number((bestStrategy.confidence * 100).toFixed(2)),
      },
      rawTrades: distinctBaseExecutions[0]?.rawTrades ?? [],
      baseModel: bestStrategy.benchmark.bestBaseStrategyId,
      baseModelName: distinctBaseExecutions[0]?.strategy.strategyName ?? '',
      params: {},
      improvement: {
        winRateDelta: 0,
        annualReturnDelta: 0,
        maxDrawdownDelta: 0,
        sharpeDelta: 0,
      },
    };

    const strategyOptions = buildStrategyOptions(distinctBaseExecutions, effectiveOptimizedStrategy);
    const selectedStrategyId = resolveSelectedStrategy(strategyMode, strategyOptions);
    const selectedExecution = distinctBaseExecutions.find((item) => item.strategy.strategyId === selectedStrategyId) ?? null;
    const trades = buildTradeRecordsFromRaw(
      selectedStrategyId === 'adaptive_composite_e'
        ? effectiveOptimizedStrategy.rawTrades
        : selectedExecution?.rawTrades ?? [],
    );
    const signalMarkers = buildSignalMarkers(trades, selectedStrategyId);
    const activeStrategy = selectedStrategyId === 'adaptive_composite_e'
      ? {
          strategyId: 'adaptive_composite_e',
          strategyName: effectiveOptimizedStrategy.strategyName,
          currentSignal: bestStrategy.currentSignal,
          signalStrength: bestStrategy.signalStrength,
          kind: 'composite',
        }
      : selectedExecution
        ? {
            strategyId: selectedExecution.strategy.strategyId,
            strategyName: selectedExecution.strategy.strategyName,
            currentSignal: inferStrategySignal(selectedExecution.strategy).signal,
            signalStrength: inferStrategySignal(selectedExecution.strategy).strength,
            kind: 'base',
          }
        : {
            strategyId: 'adaptive_composite_e',
            strategyName: effectiveOptimizedStrategy.strategyName,
            currentSignal: bestStrategy.currentSignal,
            signalStrength: bestStrategy.signalStrength,
            kind: 'composite',
          };

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
      signalMarkers,
      strategyOptions,
      activeStrategy,
      features,
      regime,
      strategies: distinctBaseExecutions.slice(0, 3).map((item) => item.strategy),
      bestStrategy: {
        ...bestStrategy,
        optimized: effectiveOptimizedStrategy,
      },
      source: {
        tsCode: stock.ts_code,
        fetchedAt: new Date().toISOString(),
        period,
        strategyMode: selectedStrategyId,
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
