const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const standardDeviation = (values) => {
  if (values.length < 2) {
    return 0;
  }
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
};
const precision = (truth, pred) => {
  let tp = 0;
  let fp = 0;
  for (let i = 0; i < truth.length; i += 1) {
    if (pred[i] !== 1) continue;
    if (truth[i] === 1) tp += 1; else fp += 1;
  }
  return tp + fp === 0 ? 0 : tp / (tp + fp);
};
const recall = (truth, pred) => {
  let tp = 0;
  let fn = 0;
  for (let i = 0; i < truth.length; i += 1) {
    if (truth[i] === 1) {
      if (pred[i] === 1) tp += 1; else fn += 1;
    }
  }
  return tp + fn === 0 ? 0 : tp / (tp + fn);
};
const f1 = (p, r) => (p + r === 0 ? 0 : (2 * p * r) / (p + r));
// 精度优先：提高 precision 权重以减少假信号，达到更高胜率
const compositeScore = (p, r, itemF1) => (p * 0.65) + (itemF1 * 0.35);
const buildTimeSeriesSplits = (length, nSplits = 5) => {
  const splits = [];
  const minTrain = Math.max(Math.floor(length * 0.45), 80);
  const testSize = Math.max(Math.floor((length - minTrain) / nSplits), 20);
  for (let split = 0; split < nSplits; split += 1) {
    const trainEnd = minTrain + split * testSize;
    const testEnd = Math.min(trainEnd + testSize, length);
    if (testEnd - trainEnd < 10) break;
    splits.push({ trainStart: 0, trainEnd, testStart: trainEnd, testEnd });
  }
  return splits;
};

const FEATURE_SETS = {
  momentum: ['rsi6', 'rsi12', 'macd_dif', 'macd_bar', 'roc5', 'roc20'],
  trend: ['maBull', 'adx14', 'bollPos', 'macd_dea'],
  volume_price: ['volRatio5', 'volRatio20', 'obv', 'roc5'],
  composite: ['rsi6', 'rsi12', 'macd_dif', 'macd_bar', 'maBull', 'adx14', 'bollPos', 'volRatio5', 'volRatio20', 'roc5'],
  mean_rev: ['rsi6', 'bollPos', 'roc5', 'atr14'],
  anti_stoploss: ['roc20', 'macd_bar', 'rsi12', 'volRatio5', 'macd_dif', 'adx14'],
  anti_stoploss_core: ['roc20', 'macd_bar', 'macd_dif', 'adx14'],
  // 新增：量价质量组合（低波动压缩 + 动量启动）
  quality_momentum: ['bollWidth', 'maBull', 'rsi6', 'roc5', 'volRatio5', 'adx14'],
  // 新增：突破前夕特征（Boll带收窄 + ADX上升 + 量能放大）
  breakout_ready: ['bollWidth', 'bollPos', 'volRatio20', 'adx14', 'roc5', 'macd_dif'],
  // 新增：KDJ+RSI超卖反弹
  oversold_bounce: ['rsi6', 'rsi2', 'k', 'j', 'wr14', 'bollPos', 'volRatio5'],
  // 新增：全要素综合（胜率最大化）
  full_composite: ['rsi6', 'rsi12', 'macd_dif', 'macd_bar', 'macd_dea', 'maBull', 'adx14', 'bollPos', 'bollWidth', 'volRatio5', 'volRatio20', 'roc5', 'roc20', 'k', 'j'],
};

const buildFeatureStats = (featureNames, rows, labels) => {
  const positives = rows.filter((_, index) => labels[index] === 1);
  const negatives = rows.filter((_, index) => labels[index] !== 1);
  return featureNames.map((name) => {
    const values = rows.map((row) => Number(row[name] ?? 0));
    const mean = average(values);
    const std = standardDeviation(values) || 1;
    const positiveMean = average(positives.map((row) => Number(row[name] ?? 0)));
    const negativeMean = average(negatives.map((row) => Number(row[name] ?? 0)));
    return { name, mean, std, positiveMean, negativeMean, separation: (positiveMean - negativeMean) / std };
  });
};

const buildThreshold = (scores, labels) => {
  const positiveRate = labels.reduce((sum, value) => sum + value, 0) / Math.max(labels.length, 1);
  // 扩大搜索范围：从非常严格（高精度少信号）到宽松，找精度最优点
  const targetFractions = [
    Math.max(positiveRate * 0.15, 0.003),
    Math.max(positiveRate * 0.25, 0.005),
    Math.max(positiveRate * 0.35, 0.006),
    Math.max(positiveRate * 0.5, 0.008),
    Math.max(positiveRate * 0.65, 0.01),
    Math.max(positiveRate * 0.8, 0.012),
    Math.max(positiveRate * 1.0, 0.015),
    Math.max(positiveRate * 1.3, 0.02),
  ];

  let bestThreshold = Infinity;
  let bestScore = -Infinity;
  for (const fraction of targetFractions) {
    const count = Math.max(1, Math.round(scores.length * fraction));
    const sorted = [...scores].sort((a, b) => b - a);
    const threshold = sorted[Math.min(sorted.length - 1, count - 1)] ?? 0;
    const pred = scores.map((value) => Number(value >= threshold));
    const p = precision(labels, pred);
    const r = recall(labels, pred);
    const fi = f1(p, r);
    // 要求至少有1个正预测才计分，避免空预测得高分
    const totalPred = pred.reduce((s, v) => s + v, 0);
    if (totalPred === 0) continue;
    const candidateScore = compositeScore(p, r, fi);
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestThreshold = threshold;
    }
  }

  return bestThreshold === Infinity ? (scores.length ? Math.max(...scores) * 0.9 : 0) : bestThreshold;
};

const createRankPredictor = ({ modelName, featureNames, stats, scoreRow }) => {
  return ({ rows, labels }) => {
    const trainScores = rows.map(scoreRow);
    const threshold = buildThreshold(trainScores, labels);
    return {
      modelName,
      featureNames,
      stats,
      threshold,
      scoreRows(rowsToScore) {
        return rowsToScore.map(scoreRow);
      },
      predict(rowsToPredict) {
        return rowsToPredict.map((row) => Number(scoreRow(row) >= threshold));
      },
    };
  };
};

const MODEL_BUILDERS = {
  ContrastRank: ({ featureNames, rows, labels }) => {
    const stats = buildFeatureStats(featureNames, rows, labels);
    const scoreRow = (row) => stats.reduce((sum, stat) => {
      const z = (Number(row[stat.name] ?? 0) - stat.mean) / stat.std;
      return sum + z * (stat.separation || 0.1);
    }, 0);
    return createRankPredictor({ modelName: 'ContrastRank', featureNames, stats, scoreRow })({ rows, labels });
  },
  PositiveBiasRank: ({ featureNames, rows, labels }) => {
    const stats = buildFeatureStats(featureNames, rows, labels);
    const scoreRow = (row) => stats.reduce((sum, stat) => {
      const value = Number(row[stat.name] ?? 0);
      const towardPositive = ((value - stat.negativeMean) / stat.std) - ((value - stat.positiveMean) / stat.std);
      return sum + towardPositive;
    }, 0);
    return createRankPredictor({ modelName: 'PositiveBiasRank', featureNames, stats, scoreRow })({ rows, labels });
  },
  PercentileRank: ({ featureNames, rows, labels }) => {
    const stats = buildFeatureStats(featureNames, rows, labels);
    const directionStats = stats.map((stat) => ({ ...stat, direction: stat.positiveMean >= stat.negativeMean ? 1 : -1 }));
    const scoreRow = (row) => average(directionStats.map((stat) => (((Number(row[stat.name] ?? 0) - stat.mean) / stat.std) * stat.direction)));
    return createRankPredictor({ modelName: 'PercentileRank', featureNames, stats: directionStats, scoreRow })({ rows, labels });
  },
  // 集成投票模型：将三个基础模型的分数归一化后加权组合
  // 精度优先权重：ContrastRank(分离度)权重最高
  EnsembleVote: ({ featureNames, rows, labels }) => {
    const stats = buildFeatureStats(featureNames, rows, labels);

    // 计算各子模型原始分数（均使用同一特征集）
    const contrastScoreRow = (row) => stats.reduce((sum, stat) => {
      const z = (Number(row[stat.name] ?? 0) - stat.mean) / stat.std;
      return sum + z * (stat.separation || 0.1);
    }, 0);
    const directionStats = stats.map((stat) => ({ ...stat, direction: stat.positiveMean >= stat.negativeMean ? 1 : -1 }));
    const percentileScoreRow = (row) => average(directionStats.map((stat) => (((Number(row[stat.name] ?? 0) - stat.mean) / stat.std) * stat.direction)));
    const biasScoreRow = (row) => stats.reduce((sum, stat) => {
      const value = Number(row[stat.name] ?? 0);
      return sum + ((value - stat.negativeMean) / stat.std) - ((value - stat.positiveMean) / stat.std);
    }, 0);

    // 用训练集分数做归一化（min-max）
    const normalize = (rawScores) => {
      const minVal = Math.min(...rawScores);
      const maxVal = Math.max(...rawScores);
      const range = maxVal - minVal || 1;
      return rawScores.map((s) => (s - minVal) / range);
    };

    const trainContrastRaw = rows.map(contrastScoreRow);
    const trainPercentileRaw = rows.map(percentileScoreRow);
    const trainBiasRaw = rows.map(biasScoreRow);

    const contrastMin = Math.min(...trainContrastRaw);
    const contrastMax = Math.max(...trainContrastRaw);
    const percentileMin = Math.min(...trainPercentileRaw);
    const percentileMax = Math.max(...trainPercentileRaw);
    const biasMin = Math.min(...trainBiasRaw);
    const biasMax = Math.max(...trainBiasRaw);

    const contrastNorm = (s) => (s - contrastMin) / (contrastMax - contrastMin || 1);
    const percentileNorm = (s) => (s - percentileMin) / (percentileMax - percentileMin || 1);
    const biasNorm = (s) => (s - biasMin) / (biasMax - biasMin || 1);

    // 精度优先权重：ContrastRank 0.5, PercentileRank 0.3, PositiveBiasRank 0.2
    const ensembleScoreRow = (row) =>
      contrastNorm(contrastScoreRow(row)) * 0.5 +
      percentileNorm(percentileScoreRow(row)) * 0.3 +
      biasNorm(biasScoreRow(row)) * 0.2;

    return createRankPredictor({ modelName: 'EnsembleVote', featureNames, stats, scoreRow: ensembleScoreRow })({ rows, labels });
  },
};

export class ModelSelector {
  constructor(rows) {
    this.rows = rows;
    this.results = [];
  }

  run() {
    const rows = this.rows;
    const labels = rows.map((row) => Number(row.isBuyPoint ?? 0));
    const splits = buildTimeSeriesSplits(rows.length, 5);

    this.results = Object.entries(FEATURE_SETS)
      .flatMap(([featureSetName, featureNames]) => {
        const available = featureNames.filter((name) => rows.every((row) => row[name] !== undefined));
        if (!available.length) {
          return [];
        }
        return Object.entries(MODEL_BUILDERS).map(([modelName, buildModel]) => {
          const precisions = [];
          const recalls = [];
          const f1s = [];
          let lastModel = null;

          splits.forEach((split) => {
            const trainRows = rows.slice(split.trainStart, split.trainEnd);
            const testRows = rows.slice(split.testStart, split.testEnd);
            const yTrain = labels.slice(split.trainStart, split.trainEnd);
            const yTest = labels.slice(split.testStart, split.testEnd);
            if (yTrain.reduce((sum, value) => sum + value, 0) < 3) {
              return;
            }
            const model = buildModel({ featureNames: available, rows: trainRows, labels: yTrain });
            const pred = model.predict(testRows);
            const p = precision(yTest, pred);
            const r = recall(yTest, pred);
            precisions.push(p);
            recalls.push(r);
            f1s.push(f1(p, r));
            lastModel = model;
          });

          return {
            featureSet: featureSetName,
            model: modelName,
            precision: Number(average(precisions).toFixed(4)),
            recall: Number(average(recalls).toFixed(4)),
            f1: Number(average(f1s).toFixed(4)),
            features: available,
            predictor: lastModel,
          };
        });
      })
      .filter((item) => item.predictor)
      .sort((left, right) => {
        const leftScore = compositeScore(left.precision, left.recall, left.f1);
        const rightScore = compositeScore(right.precision, right.recall, right.f1);
        return (rightScore - leftScore) || (right.precision - left.precision) || (right.f1 - left.f1);
      });

    return this.results;
  }

  bestModel() {
    return this.results[0] ?? null;
  }
}
