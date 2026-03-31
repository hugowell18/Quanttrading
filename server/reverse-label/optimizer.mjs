import { DataEngine } from './data-engine.mjs';
import { SignalLabeler } from './signal-labeler.mjs';
import { ModelSelector } from './model-selector.mjs';
import { WalkForwardValidator } from './validator.mjs';
import { readDaily } from '../data/csv-manager.mjs';

const LABEL_FORWARD_DAYS = 5;
const LABEL_MIN_RETURN = 0.045;
const LABEL_MAX_DRAWDOWN = 0.025;
const LABEL_TRADING_COST = 0.007;
const NO_BOLL_LIMIT = 999;

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

const EXIT_PLAN_NAMES = ['A', 'B', 'C', 'D'];

// 108 种信号配置（不含出场方案）
// jThreshold 从 [15,20,25,30] 精简为 [15,25]：model-selector 自动调整特征权重，
// 中间值 20/25 在统计上与端点重叠，保留端点即可覆盖极端/宽松两种情景。
// 整体组合数减半：108 × 4 出场方案 = 432，比原 864 快约 50%。
const buildSignalGrid = () => {
  const grid = [];
  for (const trendProfile of ['A', 'B', 'C']) {
    for (const rsiThreshold of [35, 40, 45]) {
      for (const jThreshold of [15, 25]) {
        for (const oversoldMinCount of [2, 3]) {
          for (const bollPosThreshold of [0.2, 0.3, NO_BOLL_LIMIT]) {
            grid.push({ trendProfile, rsiThreshold, jThreshold, oversoldMinCount, bollPosThreshold });
          }
        }
      }
    }
  }
  return grid;
};

const createIndexMap = (indexRows) => new Map(indexRows.map((row) => [row.date, row]));
const percent = (value) => `${(Number(value ?? 0) * 100).toFixed(2)}%`;
const fixed = (value, digits = 4) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '--');
const displayBoll = (value) => (value === NO_BOLL_LIMIT ? '不限制' : String(value));

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
  if (config.bollPosThreshold !== NO_BOLL_LIMIT && row.boll_pos != null && row.boll_pos < config.bollPosThreshold) {
    conditionCount += 1;
  }

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
  let trendPassedCount = 0;

  for (let index = 0; index < labeledRows.length - LABEL_FORWARD_DAYS; index += 1) {
    const row = labeledRows[index];

    // Market-level filter is always required
    if (row.indexTrendOk === false) continue;

    const oversoldCount = countOversoldConditions(labeledRows, index, config);
    const stockAboveMa60 = row.ma60 != null && row.close_adj > row.ma60;

    // Standard path: stock above MA60, meets configured oversold min count
    // Bear-market path: stock below MA60 but extreme oversold (≥4/6 conditions).
    //   Catches real capitulation dips in sustained downtrends without lowering the
    //   bar for ordinary pullbacks.
    const standardEntry = stockAboveMa60 && oversoldCount >= config.oversoldMinCount;
    const extremeBearEntry = !stockAboveMa60 && oversoldCount >= Math.max(config.oversoldMinCount + 1, 4);

    if (!standardEntry && !extremeBearEntry) continue;
    trendPassedCount += 1;

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

  return {
    rows: labeledRows,
    diagnostics: {
      totalRows: labeledRows.length,
      trendPassedCount,
      buyPointCount: labeledRows.filter((row) => row.isBuyPoint === 1).length,
    },
  };
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

const normalizedProfitFactor = (result) => {
  if (!result) return 0;
  const avgProfit = Number(result.avgWin ?? 0);
  const avgLoss = Number(result.avgLoss ?? 0);
  return avgLoss > 0 ? avgProfit / avgLoss : (avgProfit > 0 ? 99 : 0);
};

const passesHardFilters = (trainResult, validationResult) => {
  if (!trainResult || !validationResult) return false;
  const trainTrades = Number(trainResult.totalTrades ?? 0);
  const validationTrades = Number(validationResult.totalTrades ?? 0);
  if (trainTrades < 10 || validationTrades < 3) return false;
  // 用期望收益而非胜率——盈亏比好的策略胜率可以偏低
  const trainExp = expectedReturn(trainResult);
  const validExp = expectedReturn(validationResult);
  if (trainExp <= 0 || validExp <= 0) return false;
  // 防止严重过拟合：验证集期望收益不能低于训练集的40%
  if (validExp < trainExp * 0.4) return false;
  return true;
};

const scoreConfig = (validationResult) => {
  if (!validationResult) {
    return null;
  }

  const validationExpected = expectedReturn(validationResult);
  const validationProfitFactor = normalizedProfitFactor(validationResult);

  return {
    primary: validationExpected,
    secondary: Number(validationResult.maxDrawdown ?? 0),
    tertiary: validationProfitFactor,
    validationExpected,
    validationProfitFactor,
  };
};

// 第一层：打标签 + 训练模型（216次，不含出场方案）
const prepareSignal = (partitions, indexPartitions, signalConfig) => {
  const trainPack = buildLabeledRows(partitions.train, signalConfig, indexPartitions.trainMap);
  const trainRows = trainPack.rows;
  const trainBuyCount = trainRows.filter((row) => row.isBuyPoint === 1).length;
  if (trainBuyCount < 8) return null;

  const selector = new ModelSelector(trainRows);
  selector.run();
  const bestModel = selector.bestModel();
  if (!bestModel?.predictor) return null;

  const validationPack = buildLabeledRows(partitions.validation, signalConfig, indexPartitions.validationMap);
  const stressPack = buildLabeledRows(partitions.stress, signalConfig, indexPartitions.stressMap);
  const finalPack = buildLabeledRows(partitions.final, signalConfig, indexPartitions.finalMap);

  return {
    signalConfig,
    bestModel: {
      featureSet: bestModel.featureSet,
      model: bestModel.model,
      features: bestModel.features,
      precision: bestModel.precision,
      recall: bestModel.recall,
      f1: bestModel.f1,
      predictor: bestModel.predictor,
    },
    trainBuyCount,
    rows: { train: trainPack.rows, validation: validationPack.rows, stress: stressPack.rows, final: finalPack.rows },
    diagnostics: { train: trainPack.diagnostics, validation: validationPack.diagnostics, stress: stressPack.diagnostics, final: finalPack.diagnostics },
  };
};

// 第二层：对已有模型测试出场方案（864次，但只跑 Validator）
const runExitPlan = (signal, indexPartitions, exitPlan, unlockTest) => {
  const config = { ...signal.signalConfig, exitPlan };
  const trainValidation = createValidator(signal.rows.train, indexPartitions.train, config).validate(signal.bestModel);
  const validation = createValidator(signal.rows.validation, indexPartitions.validation, config).validate(signal.bestModel);
  if (!passesHardFilters(trainValidation, validation)) return null;
  const stress = createValidator(signal.rows.stress, indexPartitions.stress, config).validate(signal.bestModel);
  const final = unlockTest ? createValidator(signal.rows.final, indexPartitions.final, config).validate(signal.bestModel) : null;
  const score = scoreConfig(validation);
  if (!score) return null;

  return {
    config,
    bestModel: signal.bestModel,
    trainBuyCount: signal.trainBuyCount,
    diagnostics: signal.diagnostics,
    trainValidation,
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

  const labeledPack = buildLabeledRows(rows, config, indexMap);
  const latest = labeledPack.rows[labeledPack.rows.length - 1];
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

const summarizeExitReasons = (trades) => {
  const total = trades.length || 1;
  const reasons = ['takeProfit', 'stopLoss', 'trailingStop', 'sellSignal', 'timeout'];
  return reasons.map((reason) => {
    const matched = trades.filter((trade) => trade.exitReason === reason);
    const avgReturn = matched.length ? average(matched.map((trade) => Number(trade.return ?? 0))) : 0;
    return {
      reason,
      count: matched.length,
      ratio: matched.length / total,
      avgReturn,
    };
  });
};

const buildReport = ({ stockRows, results, best, unlockTest }) => {
  const earliestDate = stockRows[0]?.date ?? '--';
  const latestDate = stockRows[stockRows.length - 1]?.date ?? '--';
  const bestDiagnostics = best?.diagnostics?.train ?? { totalRows: 0, trendPassedCount: 0, buyPointCount: 0 };
  const combinedTrades = [
    ...(best?.trainValidation?.trades ?? []),
    ...(best?.validation?.trades ?? []),
  ];

  return {
    dataOverview: {
      dateRange: `${earliestDate} ~ ${latestDate}`,
      totalRows: bestDiagnostics.totalRows,
      trendPassedCount: bestDiagnostics.trendPassedCount,
      trendPassedRatio: bestDiagnostics.totalRows ? bestDiagnostics.trendPassedCount / bestDiagnostics.totalRows : 0,
      buyPointCount: bestDiagnostics.buyPointCount,
      passedConfigs: results.length,
    },
    topConfigs: results.slice(0, 5).map((item, index) => ({
      rank: index + 1,
      config: item.config,
      train: item.trainValidation,
      validation: item.validation,
    })),
    bestValidation: best ? {
      train: best.trainValidation,
      validation: best.validation,
      stress: best.stress,
      final: unlockTest ? best.final : '封存中',
    } : null,
    exitReasons: summarizeExitReasons(combinedTrades),
  };
};

const printDataOverview = (summary) => {
  const overview = summary.report.dataOverview;
  console.log('\n[第一部分] 数据概况');
  console.log(`本地CSV数据时间跨度: ${overview.dateRange}`);
  console.log(`总K线数量: ${overview.totalRows}`);
  console.log(`满足大趋势过滤的K线数量: ${overview.trendPassedCount} (${percent(overview.trendPassedRatio)})`);
  console.log(`最终买点标注数量: ${overview.buyPointCount}`);
  console.log(`432组参数中通过所有硬性过滤的数量: ${overview.passedConfigs}`);
};

const printTopConfigs = (summary) => {
  console.log('\n[第二部分] 前5名参数配置');
  const rows = summary.report.topConfigs;
  if (!rows.length) {
    console.log('无通过筛选的配置');
    return;
  }
  for (const item of rows) {
    console.log(
      `${item.rank}. 趋势=${item.config.trendProfile}, RSI=${item.config.rsiThreshold}, J=${item.config.jThreshold}, 超卖条件=${item.config.oversoldMinCount}, 布林=${displayBoll(item.config.bollPosThreshold)}, 出场=${item.config.exitPlan.name}`,
    );
    console.log(
      `   训练集: trades=${item.train.totalTrades}, winRate=${percent(item.train.winRate)}, exp=${fixed(expectedReturn(item.train))}, maxDD=${percent(Math.abs(item.train.maxDrawdown ?? 0))}`,
    );
    console.log(
      `   验证集: trades=${item.validation.totalTrades}, winRate=${percent(item.validation.winRate)}, exp=${fixed(expectedReturn(item.validation))}, maxDD=${percent(Math.abs(item.validation.maxDrawdown ?? 0))}`,
    );
  }
};

const printBestValidationTable = (summary, unlockTest) => {
  console.log('\n[第三部分] 最优配置的详细验证结果');
  const best = summary.report.bestValidation;
  if (!best) {
    console.log('无最优配置');
    return;
  }

  const finalValue = (selector) => {
    if (!unlockTest || typeof best.final === 'string') {
      return '封存中';
    }
    return selector(best.final);
  };

  const rows = [
    ['交易次数', best.train.totalTrades, best.validation.totalTrades, best.stress.totalTrades, finalValue((x) => x.totalTrades)],
    ['胜率', percent(best.train.winRate), percent(best.validation.winRate), percent(best.stress.winRate), finalValue((x) => percent(x.winRate))],
    ['平均盈利', fixed(best.train.avgWin), fixed(best.validation.avgWin), fixed(best.stress.avgWin), finalValue((x) => fixed(x.avgWin))],
    ['平均亏损', fixed(best.train.avgLoss), fixed(best.validation.avgLoss), fixed(best.stress.avgLoss), finalValue((x) => fixed(x.avgLoss))],
    ['盈亏比', fixed(normalizedProfitFactor(best.train)), fixed(normalizedProfitFactor(best.validation)), fixed(normalizedProfitFactor(best.stress)), finalValue((x) => fixed(normalizedProfitFactor(x)))],
    ['期望收益', fixed(expectedReturn(best.train)), fixed(expectedReturn(best.validation)), fixed(expectedReturn(best.stress)), finalValue((x) => fixed(expectedReturn(x)))],
    ['最大回撤', percent(Math.abs(best.train.maxDrawdown ?? 0)), percent(Math.abs(best.validation.maxDrawdown ?? 0)), percent(Math.abs(best.stress.maxDrawdown ?? 0)), finalValue((x) => percent(Math.abs(x.maxDrawdown ?? 0)))],
    ['平均持仓天数', fixed(best.train.avgHoldingDays, 2), fixed(best.validation.avgHoldingDays, 2), fixed(best.stress.avgHoldingDays, 2), finalValue((x) => fixed(x.avgHoldingDays, 2))],
  ];

  console.log('指标             训练集        验证集        压力测试      最终测试');
  for (const row of rows) {
    console.log(`${String(row[0]).padEnd(16)} ${String(row[1]).padEnd(12)} ${String(row[2]).padEnd(12)} ${String(row[3]).padEnd(12)} ${String(row[4]).padEnd(12)}`);
  }
};

const printExitReasonAnalysis = (summary) => {
  console.log('\n[第四部分] 出场原因分析（训练集+验证集合并）');
  for (const item of summary.report.exitReasons) {
    const labelMap = {
      takeProfit: '止盈出场',
      stopLoss: '止损出场',
      trailingStop: '追踪止盈',
      sellSignal: '卖点信号',
      timeout: '超时出场',
    };
    console.log(`${labelMap[item.reason]}: 次数=${item.count}, 占比=${percent(item.ratio)}, 平均收益=${fixed(item.avgReturn)}`);
  }
};

export async function optimize(stockCode, _startDate, endDate = todayCompact(), options = {}) {
  const unlockTest = options.unlockTest ?? false;
  const startTime = Date.now();

  console.log(`[optimizer] 加载 ${stockCode} 本地CSV数据...`);
  const { optimizerRows, indexFeatures, indexMap } = loadInMemoryDataset(stockCode, endDate);
  console.log(`[optimizer] 数据加载完成，共 ${optimizerRows.length} 行，耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  const partitions = splitByDateWindows(optimizerRows);
  console.log(`[optimizer] 数据分区 — 训练=${partitions.train.length}行 验证=${partitions.validation.length}行 压测=${partitions.stress.length}行 最终=${partitions.final.length}行`);

  const indexPartitions = buildPartitionMaps(indexFeatures);
  const signalGrid = buildSignalGrid();
  const totalSignals = signalGrid.length;
  const totalConfigs = totalSignals * EXIT_PLAN_NAMES.length;
  console.log(`[optimizer] 第一层：216 种信号配置（打标签+训练模型）...`);
  const results = [];
  let diagNullSignal = 0;
  let diagFailedFilter = 0;
  let diagBestTrainTrades = 0;
  let diagBestValidTrades = 0;
  let diagBestTrainWinRate = 0;
  let diagBestValidWinRate = 0;

  for (let si = 0; si < totalSignals; si += 1) {
    const signal = prepareSignal(partitions, indexPartitions, signalGrid[si]);
    if (!signal) {
      diagNullSignal += 1;
    } else {
      for (const exitPlanName of EXIT_PLAN_NAMES) {
        const exitPlan = buildExitPlan(exitPlanName);
        const config = { ...signal.signalConfig, exitPlan };
        const trainValidation = createValidator(signal.rows.train, indexPartitions.train, config).validate(signal.bestModel);
        const validation = createValidator(signal.rows.validation, indexPartitions.validation, config).validate(signal.bestModel);
        diagBestTrainTrades = Math.max(diagBestTrainTrades, trainValidation?.totalTrades ?? 0);
        diagBestValidTrades = Math.max(diagBestValidTrades, validation?.totalTrades ?? 0);
        diagBestTrainWinRate = Math.max(diagBestTrainWinRate, trainValidation?.winRate ?? 0);
        diagBestValidWinRate = Math.max(diagBestValidWinRate, validation?.winRate ?? 0);
        if (!passesHardFilters(trainValidation, validation)) {
          diagFailedFilter += 1;
          continue;
        }
        const stress = createValidator(signal.rows.stress, indexPartitions.stress, config).validate(signal.bestModel);
        const final = unlockTest ? createValidator(signal.rows.final, indexPartitions.final, config).validate(signal.bestModel) : null;
        const score = scoreConfig(validation);
        if (!score) continue;
        results.push({ config, bestModel: signal.bestModel, trainBuyCount: signal.trainBuyCount, diagnostics: signal.diagnostics, trainValidation, validation, stress, final, score });
      }
    }
    if ((si + 1) % 5 === 0 || si + 1 === totalSignals) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = (((si + 1) / totalSignals) * 100).toFixed(0);
      process.stdout.write(`\r[optimizer] 信号 ${si + 1}/${totalSignals} (${pct}%) 通过=${results.length} 无信号=${diagNullSignal} 过滤淘汰=${diagFailedFilter} 最高trades(训|验)=${diagBestTrainTrades}|${diagBestValidTrades} 耗时=${elapsed}s`);
    }
  }
  process.stdout.write('\n');
  console.log(`[optimizer] 诊断：无信号=${diagNullSignal}/216, 过滤淘汰=${diagFailedFilter}/${totalConfigs}, 通过=${results.length}/${totalConfigs}`);
  console.log(`[optimizer] 最高胜率(训|验)=${(diagBestTrainWinRate*100).toFixed(1)}%|${(diagBestValidWinRate*100).toFixed(1)}%  最高交易次数(训|验)=${diagBestTrainTrades}|${diagBestValidTrades}`);

  results.sort((left, right) => {
    if (right.score.primary !== left.score.primary) return right.score.primary - left.score.primary;
    if (left.score.secondary !== right.score.secondary) return left.score.secondary - right.score.secondary;
    return right.score.tertiary - left.score.tertiary;
  });

  const best = results[0] ?? null;
  const leaderboard = results.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    config: item.config,
    trainBuyCount: item.trainBuyCount,
    trainValidation: item.trainValidation,
    validation: item.validation,
    stress: item.stress,
    final: unlockTest ? item.final : '封存中，输入 --unlock-test 参数才解锁',
    score: item.score,
    bestModel: item.bestModel,
  }));

  return {
    stockCode,
    stockName: stockCode,
    bestConfig: best?.config ?? null,
    bestModel: best?.bestModel ?? null,
    bestResult: best ? {
      trainValidation: best.trainValidation,
      validation: best.validation,
      stress: best.stress,
      final: unlockTest ? best.final : '封存中，输入 --unlock-test 参数才解锁',
      trainBuyCount: best.trainBuyCount,
      expectedValidation: Number(best.score.validationExpected.toFixed(6)),
      validationProfitFactor: Number(best.score.validationProfitFactor.toFixed(6)),
    } : null,
    leaderboard,
    currentSignal: best ? generateCurrentSignal(optimizerRows, best.config, best.bestModel, indexMap) : { signal: 'hold', confidence: 0, reason: 'no-valid-config' },
    report: buildReport({ stockRows: optimizerRows, results, best, unlockTest }),
    stats: {
      totalCombinations: totalConfigs,
      validCombinations: results.length,
      unlockTest,
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

const cliArgs = process.argv.slice(2).filter((arg) => arg !== '--unlock-test');
const unlockTest = process.argv.includes('--unlock-test');
const [stockCode = '600519', startDate = '20050101', endDate = todayCompact()] = cliArgs;

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('optimizer.mjs')) {
  optimize(stockCode, startDate, endDate, { unlockTest })
    .then((summary) => {
      console.log('\n' + '='.repeat(72));
      console.log(`优化报告 | ${summary.stockCode}`);
      console.log('='.repeat(72));
      console.log(`总组合数: ${summary.stats.totalCombinations}`);
      console.log(`有效组合: ${summary.stats.validCombinations}`);
      console.log(`最终测试集: ${summary.stats.unlockTest ? '已解锁' : '封存中'}`);
      console.log(`耗时: ${summary.stats.scanDurationMs}ms`);
      if (summary.bestConfig) {
        console.log(`最佳配置: ${JSON.stringify(summary.bestConfig)}`);
      } else {
        console.log('未找到有效配置');
      }
      printDataOverview(summary);
      printTopConfigs(summary);
      printBestValidationTable(summary, unlockTest);
      printExitReasonAnalysis(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
