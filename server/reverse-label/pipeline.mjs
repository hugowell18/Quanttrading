import { DataEngine } from './data-engine.mjs';
import { SignalLabeler } from './signal-labeler.mjs';
import { ModelSelector } from './model-selector.mjs';
import { WalkForwardValidator } from './validator.mjs';
import { readDaily } from '../data/csv-manager.mjs';
import { STOCK_UNIVERSE } from './stock-universe.mjs';

const formatTradeDate = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const toTsCode = (symbol) => (/^6/.test(symbol) ? `${symbol}.SH` : `${symbol}.SZ`);

const loadStockInfo = (symbol) => {
  const matched = STOCK_UNIVERSE.find((item) => item.code === symbol);
  return {
    ts_code: toTsCode(symbol),
    symbol,
    name: matched?.name ?? symbol,
    industry: matched?.sector ?? 'unknown',
  };
};

const loadDailyCandles = (tsCode, startDate, endDate) =>
  readDaily(tsCode, startDate, endDate)
    .map((item) => ({
      date: formatTradeDate(item.trade_date ?? item.date.replace(/-/g, '')),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      close_adj: Number(item.close_adj ?? item.close),
      volume: Math.round(Number(item.volume ?? item.vol ?? 0)),
      turnover_rate: Number(item.turnover_rate ?? 0),
      amount: Number(item.amount ?? 0),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

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
  if ((latest.isSellPoint ?? 0) === 1 || Number(latest.close_adj ?? latest.close) < Number(previous.close_adj ?? previous.close)) {
    return { signal: 'sell', probability: 1 - bestModel.precision };
  }
  return { signal: 'hold', probability: Math.max(bestModel.precision - 0.1, 0) };
};

export const runReverseLabelPipeline = async ({ symbol = '600519', startDate = '20220101', endDate = '20260322', forwardDays = 5, minReturn = 0.045, maxDrawdown = 0.025 } = {}) => {
  const stock = loadStockInfo(symbol);
  const candles = loadDailyCandles(stock.ts_code, startDate, endDate);
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
    dataset: {
      candles: labeledRows.length,
      featureCount: Object.keys(labeledRows[0] ?? {}).length,
      buyPoints: labeledRows.filter((row) => row.isBuyPoint === 1).length,
      sellPoints: labeledRows.filter((row) => row.isSellPoint === 1).length,
      labeledPairs: labeledPairs.length,
      diagnostics: labeler.getDiagnostics(),
    },
    bestModel: bestModel ? { featureSet: bestModel.featureSet, model: bestModel.model, precision: bestModel.precision, recall: bestModel.recall, f1: bestModel.f1, features: bestModel.features } : null,
    leaderboard: leaderboard.slice(0, 5).map((item) => ({ featureSet: item.featureSet, model: item.model, precision: item.precision, recall: item.recall, f1: item.f1 })),
    validation,
    currentSignal,
  };
};
