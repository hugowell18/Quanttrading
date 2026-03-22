import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataEngine } from './data-engine.mjs';
import { SignalLabeler } from './signal-labeler.mjs';
import { ModelSelector } from './model-selector.mjs';
import { WalkForwardValidator } from './validator.mjs';

const ENV_LOCAL_PATH = resolve(process.cwd(), '.env.local');
const TUSHARE_API = 'http://api.tushare.pro';

const readEnvLocalToken = () => {
  if (!existsSync(ENV_LOCAL_PATH)) return '';
  const sourceText = readFileSync(ENV_LOCAL_PATH, 'utf8');
  for (const rawLine of sourceText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (key !== 'TUSHARE_TOKEN') continue;
    return line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
};

const fetchTushare = async (token, apiName, params, fields) => {
  const response = await fetch(TUSHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
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

const mapRows = ({ fields, items }) => items.map((item) => fields.reduce((record, field, index) => ({ ...record, [field]: item[index] }), {}));
const formatTradeDate = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const loadStockInfo = async (token, symbol) => {
  const guesses = /^6/.test(symbol) ? [`${symbol}.SH`, `${symbol}.SZ`] : [`${symbol}.SZ`, `${symbol}.SH`];
  for (const tsCode of guesses) {
    const rows = mapRows(await fetchTushare(token, 'stock_basic', { ts_code: tsCode, list_status: 'L' }, 'ts_code,symbol,name,industry'));
    if (rows[0]) return rows[0];
  }
  const fallbackRows = mapRows(await fetchTushare(token, 'stock_basic', { symbol, list_status: 'L' }, 'ts_code,symbol,name,industry'));
  if (!fallbackRows[0]) throw new Error(`No listed stock found for symbol ${symbol}`);
  return fallbackRows[0];
};

const loadDailyCandles = async (token, tsCode, startDate, endDate) => {
  const rows = mapRows(await fetchTushare(token, 'daily', { ts_code: tsCode, start_date: startDate, end_date: endDate }, 'trade_date,open,high,low,close,vol'));
  return rows
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

const inferCurrentSignal = (bestModel, rows) => {
  if (!bestModel?.predictor || !rows.length) {
    return { signal: 'hold', probability: 0 };
  }
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2] ?? latest;
  const predicted = bestModel.predictor.predict([latest])[0];
  if (predicted === 1) {
    return { signal: 'buy', probability: bestModel.precision };
  }
  if ((latest.isSellPoint ?? 0) === 1 || latest.close < previous.close) {
    return { signal: 'sell', probability: 1 - bestModel.precision };
  }
  return { signal: 'hold', probability: Math.max(bestModel.precision - 0.1, 0) };
};

export const runReverseLabelPipeline = async ({ symbol = '600519', startDate = '20220101', endDate = '20260322', forwardDays = 20, minReturn = 0.08, maxDrawdown = 0.05 } = {}) => {
  const token = readEnvLocalToken() || process.env.TUSHARE_TOKEN || '';
  if (!token) {
    throw new Error('Missing TUSHARE_TOKEN environment variable');
  }

  const stock = await loadStockInfo(token, symbol);
  const candles = await loadDailyCandles(token, stock.ts_code, startDate, endDate);
  const engine = new DataEngine(candles);
  const featuredRows = engine.computeAllFeatures();
  const labeler = new SignalLabeler(featuredRows, { forwardDays, minReturn, maxDrawdown });
  const labeledRows = labeler.getLabeledRows();
  const labeledPairs = labeler.getLabeledPairs();
  const selector = new ModelSelector(labeledRows);
  const leaderboard = selector.run();
  const bestModel = selector.bestModel();
  const validator = new WalkForwardValidator(labeledRows, { forwardDays, takeProfit: minReturn, stopLoss: maxDrawdown * 0.8, trainSize: 180, testSize: 60 });
  const validation = bestModel ? validator.validate(bestModel) : null;
  const currentSignal = inferCurrentSignal(bestModel, labeledRows);

  return {
    stock: { code: stock.symbol, name: stock.name, industry: stock.industry || 'unknown', tsCode: stock.ts_code },
    dataset: { candles: labeledRows.length, featureCount: Object.keys(labeledRows[0] ?? {}).length, buyPoints: labeledRows.filter((row) => row.isBuyPoint === 1).length, sellPoints: labeledRows.filter((row) => row.isSellPoint === 1).length, labeledPairs: labeledPairs.length },
    bestModel: bestModel ? { featureSet: bestModel.featureSet, model: bestModel.model, precision: bestModel.precision, recall: bestModel.recall, f1: bestModel.f1, features: bestModel.features } : null,
    leaderboard: leaderboard.slice(0, 5).map((item) => ({ featureSet: item.featureSet, model: item.model, precision: item.precision, recall: item.recall, f1: item.f1 })),
    validation,
    currentSignal,
  };
};
