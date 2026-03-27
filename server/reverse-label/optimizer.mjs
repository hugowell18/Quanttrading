import { DataEngine } from './data-engine.mjs';
import { SignalLabeler } from './signal-labeler.mjs';
import { ModelSelector } from './model-selector.mjs';
import { WalkForwardValidator } from './validator.mjs';
import { readDaily } from '../data/csv-manager.mjs';

const LABEL_FORWARD_DAYS = 5;
const LABEL_MIN_RETURN = 0.045;
const LABEL_MAX_DRAWDOWN = 0.025;
const LABEL_TRADING_COST = 0.007;

const WINDOW_TRAIN_END = '2015-12-31';
const WINDOW_VALID_START = '2016-01-01';
const WINDOW_VALID_END = '2019-12-31';
const WINDOW_STRESS_START = '2020-01-01';
const WINDOW_STRESS_END = '2021-12-31';
const WINDOW_FINAL_START = '2022-01-01';

const average = (arr) => (arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : 0);
const todayCompact = () => {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
};
const formatTradeDate = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
const toTsCode = (stockCode) => (/^6/.test(stockCode) ? `${stockCode}.SH` : `${stockCode}.SZ`);
const priceValue = (row) => Number(row?.close_adj ?? row?.close ?? 0);

const normalizeCsvCandles = (rows) =>
  rows.map((row) => {
    const rawClose = Number(row.close ?? 0);
    const closeAdj = Number(row.close_adj ?? row.close ?? 0);
    const adjFactor = rawClose > 0 ? closeAdj / rawClose : 1;
    return {
      date: formatTradeDate(row.trade_date),
      open: Number(row.open) * adjFactor,
      high: Number(row.high) * adjFactor,
      low: Number(row.low) * adjFactor,
      close: closeAdj,
      close_adj: closeAdj,
      open_adj: Number(row.open) * adjFactor,
      high_adj: Number(row.high) * adjFactor,
      low_adj: Number(row.low) * adjFactor,
      volume: Math.round(Number(row.volume ?? 0)),
      amount: Number(row.amount ?? 0),
      turnover_rate: Number(row.turnover_rate ?? 0),
    };
  });

const buildOptimizerRows = (featureRows) =>
  featureRows.map((row) => ({
    ...row,
    close_adj: priceValue(row),
    open_adj: Number(row.open_adj ?? row.open),
    high_adj: Number(row.high_adj ?? row.high),
    low_adj: Number(row.low_adj ?? row.low),
    ma20: Number(row.ma20 ?? 0),
    ma60: Number(row.ma60 ?? 0),
    rsi6: Number(row.rsi6 ?? 0),
    kdj_j: Number(row.j ?? row.kdj_j ?? 0),
    boll_pos: Number(row.bollPos ?? row.boll_pos ?? 1),
    indexTrendOk: true,
  }));

const splitByDateWindows = (rows) => ({
  train: rows.filter((row) => row.date <= WINDOW_TRAIN_END),
  validation: rows.filter((row) => row.date >= WINDOW_VALID_START && row.date <= WINDOW_VALID_END),
  stress: rows.filter((row) => row.date >= WINDOW_STRESS_START && row.date <= WINDOW_STRESS_END),
  final: rows.filter((row) => row.date >= WINDOW_FINAL_START),
});

const buildExitPlan = (name) => {
  switch (name) {
    case 'A':
      return { name, stopLoss: 0.03, maxHoldingDays: 3, takeProfitStyle: 'target', targetProfitPct: 0.04, trailingStopMultiplier: 1.5 };
    case 'B':
      return { name, stopLoss: 0.025, maxHoldingDays: 5, takeProfitStyle: 'target', targetProfitPct: 0.045, trailingStopMultiplier: 1.5 };
    case 'C':
      return { name, stopLoss: 0.03, maxHoldingDays: 5, takeProfitStyle: 'target', targetProfitPct: 0.05, trailingStopMultiplier: 1.5 };
    case 'D':
    default:
      return { name: 'D', stopLoss: 0.025, maxHoldingDays: 5, takeProfitStyle: 'tiered', targetProfitPct: 0.03, trailingStopMultiplier: 0.6 };
  }
};

const buildParamGrid = () => {
  const grid = [];
  for (const trendProfile of ['A', 'B', 'C']) {
    for (const rsiThreshold of [35, 40, 45]) {
      for (const jThreshold of [15, 20, 25, 30]) {
        for (const oversoldMinCount of [2, 3]) {
          for (const bollPosThreshold of [0.2, 0.3, null]) {
            for (const exitPlanName of ['A', 'B', 'C', 'D']) {
              grid.push({
                trendProfile,
                rsiThreshold,
                jThreshold,
                oversoldMinCount,
                bollPosThreshold,
                exitPlan: buildExitPlan(exitPlanName),
              });
            }
          }
        }
      }
    }
  }
  return grid;
};

const createIndexMap = (indexRows) => new Map(indexRows.map((row) => [row.date, row]));

const injectTrendProfile = (rows, indexMap, trendProfile) =>
  rows.map((row) => {
    const indexRow = indexMap.get(row.date);
    const marketOk = indexRow ? priceValue(indexRow) > Number(indexRow.ma20 ?? Infinity) : false;
    let indexTrendOk = true;
    if (trendProfile === 'A') {
      indexTrendOk = true;
    } else if (trendProfile === 'B') {
      indexTrendOk = marketOk;
    } else {
      indexTrendOk = marketOk && row.close_adj > Number(row.ma20 ?? Infinity);
    }
    return {
      ...row,
      indexTrendOk,
    };
  });

const countOversoldConditions = (rows, index, config) => {
  if (index < 4) {
    return 0;
  }

  const row = rows[index];
  let conditionCount = 0;

  if (row.rsi6 < config.rsiThreshold) conditionCount += 1;
  if (row.kdj_j < config.jThreshold) conditionCount += 1;
  if (config.bollPosThreshold != null && row.boll_pos < config.bollPosThreshold) conditionCount += 1;

  let negativeLines = 0;
  for (let cursor = index - 3; cursor <= index; cursor += 1) {
    if (rows[cursor].close_adj < rows[cursor].open_adj) negativeLines += 1;
  }
  if (negativeLines >= 3) conditionCount += 1;

  const price4DaysAgo = rows[index - 3].close_adj;
  const dropPct = price4DaysAgo > 0 ? (row.close_adj - price4DaysAgo) / price4DaysAgo : 0;
  if (dropPct < -0.02) conditionCount += 1;

  const vol0 = row.volume ?? 0;
  const vol1 = rows[index - 1].volume ?? 0;
  const vol2 = rows[index - 2].volume ?? 0;
  if (vol0 < vol1 && vol1 < vol2) conditionCount += 1;

  return conditionCount;
};

const validateLabelOutcome = (rows, index) => {
  const row = rows[index];
  const effectiveBuyPrice = row.close_adj * (1 + LABEL_TRADING_COST);
  if (!Number.isFinite(effectiveBuyPrice) || effectiveBuyPrice <= 0) {
    return null;
  }

  let maxHigh = -Infinity;
  let minLow = Infinity;
  let sellIndex = null;

  for (let cursor = index + 1; cursor <= index + LABEL_FORWARD_DAYS && cursor < rows.length; cursor += 1) {
    const futureRow = rows[cursor];
    if (futureRow.high_adj > maxHigh) maxHigh = futureRow.high_adj;
    if (futureRow.low_adj < minLow) minLow = futureRow.low_adj;
    const futureReturn = (futureRow.high_adj - effectiveBuyPrice) / effectiveBuyPrice;
    if (sellIndex === null && futureReturn >= LABEL_MIN_RETURN) {
      sellIndex = cursor;
    }
  }

  const realizedMaxReturn = (maxHigh - effectiveBuyPrice) / effectiveBuyPrice;
  const realizedMaxDrawdown = (effectiveBuyPrice - minLow) / effectiveBuyPrice;
  if (realizedMaxReturn < LABEL_MIN_RETURN || realizedMaxDrawdown > LABEL_MAX_DRAWDOWN || sellIndex === null) {
    return null;
  }

  return {
    sellIndex,
    targetReturn: realizedMaxReturn,
    maxDrawdown: realizedMaxDrawdown,
  };
};

const buildLabeledRows = (baseRows, config, indexMap) => {
  const trendRows = injectTrendProfile(baseRows, indexMap, config.trendProfile);

  // Keep the required flow in place, while optimizer applies config-specific thresholds on top.
  const baseLabeler = new SignalLabeler(trendRows, {
    forwardDays: LABEL_FORWARD_DAYS,
    minReturn: LABEL_MIN_RETURN,
    maxDrawdown: LABEL_MAX_DRAWDOWN,
    tradingCost: LABEL_TRADING_COST,
  });
  baseLabeler.getLabeledRows();

  const sellPointSet = new Set();
  const labeledRows = trendRows.map((row) => ({
    ...row,
    isBuyPoint: 0,
    isSellPoint: 0,
    targetReturn: null,
    maxDrawdown: null,
  }));

  for (let index = 0; index < labeledRows.length - LABEL_FORWARD_DAYS; index += 1) {
    const row = labeledRows[index];
    const stockTrendOk = row.ma60 != null && row.close_adj > row.ma60;
    if (!stockTrendOk || row.indexTrendOk === false) {
      continue;
    }

    const oversoldCount = countOversoldConditions(labeledRows, index, config);
    if (oversoldCount < config.oversoldMinCount) {
      continue;
    }

    const outcome = validateLabelOutcome(labeledRows, index);
    if (!outcome) {
      continue;
    }

    row.isBuyPoint = 1;
    row.targetReturn = Number(outcome.targetReturn.toFixed(4));
    row.maxDrawdown = Number(outcome.maxDrawdown.toFixed(4));
    sellPointSet.add(outcome.sellIndex);
  }

  for (const sellIndex of sellPointSet) {
    if (labeledRows[sellIndex]) {
      labeledRows[sellIndex].isSellPoint = 1;
    }
  }

  return labeledRows;
};

const createValidator = (rows, indexRows, config) =>
  new WalkForwardValidator(rows, {
    forwardDays: LABEL_FORWARD_DAYS,
    stopLoss: config.exitPlan.stopLoss,
    maxHoldingDays: config.exitPlan.maxHoldingDays,
    takeProfitStyle: config.exitPlan.takeProfitStyle,
    targetProfitPct: config.exitPlan.targetProfitPct,
    trailingStopMultiplier: config.exitPlan.trailingStopMultiplier,
    envFilter: 'none',
    indexRows,
    trainSize: 180,
    testSize: 60,
  });

const expectedReturn = (result) => {
  if (!result) return -Infinity;
  const winRate = Number(result.winRate ?? 0);
  const avgProfit = Number(result.avgWin ?? 0);
  const avgLoss = Number(result.avgLoss ?? 0);
  return winRate * avgProfit - (1 - winRate) * avgLoss;
};

const scoreConfig = (validationResult, stressResult) => {
  if (!validationResult || !stressResult) {
    return null;
  }

  if ((validationResult.totalTrades ?? 0) < 10 || (stressResult.totalTrades ?? 0) < 10) {
    return null;
  }

  const validationExpected = expectedReturn(validationResult);
  const stressExpected = expectedReturn(stressResult);
  const primary = validationExpected * 0.7 + stressExpected * 0.3;
  const secondary = ((validationResult.profitFactor ?? 0) + (stressResult.profitFactor ?? 0)) / 2;
  const tertiary = (validationResult.totalTrades ?? 0) + (stressResult.totalTrades ?? 0);

  return {
    primary,
    secondary,
    tertiary,
    validationExpected,
    stressExpected,
  };
};

const runOneConfig = (partitions, indexPartitions, config) => {
  const trainRows = buildLabeledRows(partitions.train, config, indexPartitions.trainMap);
  const validationRows = buildLabeledRows(partitions.validation, config, indexPartitions.validationMap);
  const stressRows = buildLabeledRows(partitions.stress, config, indexPartitions.stressMap);
  const finalRows = buildLabeledRows(partitions.final, config, indexPartitions.finalMap);

  const trainBuyCount = trainRows.filter((row) => row.isBuyPoint === 1).length;
  if (trainBuyCount < 8) {
    return null;
  }

  const selector = new ModelSelector(trainRows);
  selector.run();
  const bestModel = selector.bestModel();
  if (!bestModel?.predictor) {
    return null;
  }

  const validation = createValidator(validationRows, indexPartitions.validation, config).validate(bestModel);
  const stress = createValidator(stressRows, indexPartitions.stress, config).validate(bestModel);
  const final = createValidator(finalRows, indexPartitions.final, config).validate(bestModel);
  const score = scoreConfig(validation, stress);
  if (!score) {
    return null;
  }

  return {
    config,
    bestModel: {
      featureSet: bestModel.featureSet,
      model: bestModel.model,
      precision: bestModel.precision,
      recall: bestModel.recall,
      f1: bestModel.f1,
    },
    trainBuyCount,
    validation,
    stress,
    final,
    score,
  };
};

const loadInMemoryDataset = (stockCode, endDate) => {
  const effectiveEnd = endDate ?? todayCompact();
  const stockRows = readDaily(toTsCode(stockCode), '20050101', effectiveEnd);
  const indexRows = readDaily('000300.SH', '20050101', effectiveEnd);
  const stockCandles = normalizeCsvCandles(stockRows);
  const indexCandles = normalizeCsvCandles(indexRows);
  const indexFeatures = new DataEngine(indexCandles).computeAllFeatures();
  const indexMap = createIndexMap(indexFeatures);
  const stockFeatures = new DataEngine(stockCandles).computeAllFeatures(indexFeatures);
  const optimizerRows = buildOptimizerRows(stockFeatures);
  return {
    optimizerRows,
    indexFeatures,
    indexMap,
  };
};

const buildPartitionMaps = (indexRows) => ({
  train: indexRows.filter((row) => row.date <= WINDOW_TRAIN_END),
  validation: indexRows.filter((row) => row.date >= WINDOW_VALID_START && row.date <= WINDOW_VALID_END),
  stress: indexRows.filter((row) => row.date >= WINDOW_STRESS_START && row.date <= WINDOW_STRESS_END),
  final: indexRows.filter((row) => row.date >= WINDOW_FINAL_START),
  trainMap: createIndexMap(indexRows.filter((row) => row.date <= WINDOW_TRAIN_END)),
  validationMap: createIndexMap(indexRows.filter((row) => row.date >= WINDOW_VALID_START && row.date <= WINDOW_VALID_END)),
  stressMap: createIndexMap(indexRows.filter((row) => row.date >= WINDOW_STRESS_START && row.date <= WINDOW_STRESS_END)),
  finalMap: createIndexMap(indexRows.filter((row) => row.date >= WINDOW_FINAL_START)),
});

const generateCurrentSignal = (rows, config, bestModel, indexMap) => {
  if (!config || !bestModel?.predictor || !rows.length) {
    return { signal: 'hold', confidence: 0, reason: 'missing-config-or-model' };
  }

  const labeledRows = buildLabeledRows(rows, config, indexMap);
  const latest = labeledRows[labeledRows.length - 1];
  if (!latest) {
    return { signal: 'hold', confidence: 0, reason: 'missing-latest-row' };
  }

  const scores = bestModel.predictor.scoreRows([latest]);
  const score = scores[0] ?? 0;
  const threshold = bestModel.predictor.threshold ?? 0;
  if (latest.isBuyPoint === 1 && score >= threshold) {
    return { signal: 'buy', confidence: 1, score: Number(score.toFixed(4)), threshold: Number(threshold.toFixed(4)), date: latest.date };
  }
  if (latest.isSellPoint === 1) {
    return { signal: 'sell', confidence: 0.7, score: Number(score.toFixed(4)), threshold: Number(threshold.toFixed(4)), date: latest.date };
  }
  return { signal: 'hold', confidence: 0.3, score: Number(score.toFixed(4)), threshold: Number(threshold.toFixed(4)), date: latest.date };
};

export async function optimize(stockCode, _startDate, endDate = todayCompact()) {
  const startTime = Date.now();
  const { optimizerRows, indexFeatures, indexMap } = loadInMemoryDataset(stockCode, endDate);
  const partitions = splitByDateWindows(optimizerRows);
  const indexPartitions = buildPartitionMaps(indexFeatures);
  const grid = buildParamGrid();
  const results = [];

  for (const config of grid) {
    const result = runOneConfig(partitions, indexPartitions, config);
    if (result) {
      results.push(result);
    }
  }

  results.sort((left, right) => {
    if (right.score.primary !== left.score.primary) return right.score.primary - left.score.primary;
    if (right.score.secondary !== left.score.secondary) return right.score.secondary - left.score.secondary;
    return right.score.tertiary - left.score.tertiary;
  });

  const best = results[0] ?? null;
  const leaderboard = results.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    config: item.config,
    trainBuyCount: item.trainBuyCount,
    validation: item.validation,
    stress: item.stress,
    final: item.final,
    score: item.score,
    bestModel: item.bestModel,
  }));

  return {
    stockCode,
    stockName: stockCode,
    bestConfig: best?.config ?? null,
    bestModel: best?.bestModel ?? null,
    bestResult: best ? {
      validation: best.validation,
      stress: best.stress,
      final: best.final,
      trainBuyCount: best.trainBuyCount,
      expectedValidation: Number(best.score.validationExpected.toFixed(6)),
      expectedStress: Number(best.score.stressExpected.toFixed(6)),
    } : null,
    leaderboard,
    currentSignal: best ? generateCurrentSignal(optimizerRows, best.config, best.bestModel, indexMap) : { signal: 'hold', confidence: 0, reason: 'no-valid-config' },
    stats: {
      totalCombinations: grid.length,
      validCombinations: results.length,
      scanDurationMs: Date.now() - startTime,
      partitions: {
        train: { start: '2005-01-01', end: WINDOW_TRAIN_END, rows: partitions.train.length },
        validation: { start: WINDOW_VALID_START, end: WINDOW_VALID_END, rows: partitions.validation.length },
        stress: { start: WINDOW_STRESS_START, end: WINDOW_STRESS_END, rows: partitions.stress.length },
        final: { start: WINDOW_FINAL_START, end: formatTradeDate(endDate), rows: partitions.final.length },
      },
    },
  };
}

const [, , stockCode = '600519', startDate = '20050101', endDate = todayCompact()] = process.argv;

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('optimizer.mjs')) {
  optimize(stockCode, startDate, endDate)
    .then((summary) => {
      console.log('\n' + '='.repeat(72));
      console.log(`优化报告 | ${summary.stockCode}`);
      console.log('='.repeat(72));
      console.log(`总组合数: ${summary.stats.totalCombinations}`);
      console.log(`有效组合: ${summary.stats.validCombinations}`);
      console.log(`耗时: ${summary.stats.scanDurationMs}ms`);
      if (summary.bestConfig) {
        console.log(`最佳配置: ${JSON.stringify(summary.bestConfig)}`);
      } else {
        console.log('未找到有效配置');
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
