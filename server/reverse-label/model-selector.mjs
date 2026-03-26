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

// 硬伤2修复：计算被选中行的真实前瞻收益率（T+1开盘买 → 持有N日后卖）
const computeReturnMetric = (rows, predictions, forwardDays = 10) => {
  const selectedReturns = [];
  for (let i = 0; i < predictions.length; i += 1) {
    if (predictions[i] !== 1) continue;
    const buyIdx = i + 1; // T+1 买入
    const sellIdx = Math.min(i + 1 + forwardDays, rows.length - 1);
    if (buyIdx >= rows.length || sellIdx >= rows.length) continue;
    const buyPrice = rows[buyIdx]?.open ?? rows[buyIdx]?.close ?? 0;
    const sellPrice = rows[sellIdx]?.open ?? rows[sellIdx]?.close ?? 0;
    if (buyPrice > 0) {
      selectedReturns.push((sellPrice - buyPrice) / buyPrice);
    }
  }
  if (selectedReturns.length === 0) return 0;
  const avgRet = selectedReturns.reduce((s, v) => s + v, 0) / selectedReturns.length;
  // 盈利因子：正收益笔数的占比 × 平均收益
  const winCount = selectedReturns.filter((v) => v > 0).length;
  const winRate = winCount / selectedReturns.length;
  return avgRet * (0.5 + winRate); // 收益率 × 胜率加成
};
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
  // 事件+交叉特征组合（方向2+4）
  event_cross: ['distFromHigh', 'distFromLow', 'atrRatio', 'consecutiveDown', 'rsiVolCross', 'bollAdxCross', 'rsi6', 'volRatio5'],
  // 反弹猎手：超卖事件特征 + 量价交叉
  bounce_hunter: ['distFromHigh', 'consecutiveDown', 'rsiVolCross', 'rsi6', 'rsi2', 'bollPos', 'volRatio5'],
  // 突破猎手：压缩事件特征 + 突破交叉
  breakout_hunter: ['distFromLow', 'atrRatio', 'bollAdxCross', 'bollWidth', 'adx14', 'volRatio20'],
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

const buildThreshold = (scores, labels, rows = null) => {
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

    // 硬伤2修复：融合真实收益率到阈值评分
    // classificationScore: 分类精度（60%权重）
    // returnMetric: 被选中行的真实前瞻收益率（40%权重）
    const classificationScore = compositeScore(p, r, fi);
    let candidateScore = classificationScore;

    if (rows && rows.length > 0) {
      const returnMetric = computeReturnMetric(rows, pred, 10);
      // 收益率为负 → 惩罚；收益率为正 → 奖励
      // 将 returnMetric 映射到 [0, 1] 区间做加权
      const returnBonus = Math.max(0, returnMetric) * 5; // 5%收益 → 0.25加分
      const returnPenalty = Math.min(0, returnMetric) * 10; // -5%亏损 → -0.5惩罚
      candidateScore = classificationScore * 0.6 + (classificationScore + returnBonus + returnPenalty) * 0.4;
    }

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
    const threshold = buildThreshold(trainScores, labels, rows);
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

// 方向4：简单逻辑回归（梯度下降），学习最优特征权重替代手工 separation
const trainLogisticWeights = (X, y, lr = 0.1, epochs = 200, l2 = 0.01) => {
  const n = X.length;
  const d = X[0].length;
  const w = new Array(d).fill(0);
  let bias = 0;
  const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, z))));

  for (let ep = 0; ep < epochs; ep += 1) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      const z = X[i].reduce((s, x, j) => s + x * w[j], bias);
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < d; j += 1) gradW[j] += err * X[i][j];
      gradB += err;
    }
    for (let j = 0; j < d; j += 1) {
      w[j] -= lr * (gradW[j] / n + l2 * w[j]);
    }
    bias -= lr * (gradB / n);
  }
  return { w, bias, sigmoid };
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
  // 方向4：逻辑回归模型 — 用梯度下降学习特征权重，替代手工 separation 加权
  LogisticRank: ({ featureNames, rows, labels }) => {
    const stats = buildFeatureStats(featureNames, rows, labels);
    // 标准化特征矩阵
    const X = rows.map((row) =>
      stats.map((stat) => (Number(row[stat.name] ?? 0) - stat.mean) / stat.std)
    );
    const { w, bias, sigmoid } = trainLogisticWeights(X, labels);
    const scoreRow = (row) => {
      const z = stats.reduce((sum, stat, j) => {
        const x = (Number(row[stat.name] ?? 0) - stat.mean) / stat.std;
        return sum + x * w[j];
      }, bias);
      return sigmoid(z);
    };
    return createRankPredictor({ modelName: 'LogisticRank', featureNames, stats, scoreRow })({ rows, labels });
  },
};

/**
 * 从 regime featurePool 动态生成特征组合
 * 策略：全集 + 前半 + 后半 + 去掉每个特征的子集（leave-one-out）
 * 比固定 FEATURE_SETS 更灵活，但仍然可控
 */
function buildDynamicFeatureSets(pool) {
  const sets = {};
  // 全集
  sets.pool_full = [...pool];
  // 前半：偏前面的特征（regime 配置中排在前面的是更重要的）
  if (pool.length > 3) {
    sets.pool_top = pool.slice(0, Math.ceil(pool.length * 0.6));
  }
  // 后半
  if (pool.length > 4) {
    sets.pool_bottom = pool.slice(Math.floor(pool.length * 0.4));
  }
  // leave-one-out：每次去掉一个特征，发现哪个特征是关键
  if (pool.length >= 4) {
    for (let i = 0; i < Math.min(pool.length, 7); i += 1) {
      const subset = pool.filter((_, idx) => idx !== i);
      sets[`pool_drop_${pool[i]}`] = subset;
    }
  }
  return sets;
}

export class ModelSelector {
  constructor(rows) {
    this.rows = rows;
    this.results = [];
  }

  /**
   * @param {Object} options
   * @param {string[]|null} options.featurePool - Regime 特征池（若提供，自动生成特征组合替代 FEATURE_SETS）
   * @param {string[]|null} options.modelPref - Regime 偏好的模型类型（优先顺序）
   */
  run(options = {}) {
    const rows = this.rows;
    const labels = rows.map((row) => Number(row.isBuyPoint ?? 0));
    const splits = buildTimeSeriesSplits(rows.length, 5);

    // 第二层：如果提供了 featurePool，动态构建特征组合 + 保留原始 FEATURE_SETS 作为兜底
    const featureSetsToUse = options.featurePool
      ? { ...buildDynamicFeatureSets(options.featurePool), ...FEATURE_SETS }
      : FEATURE_SETS;

    // 第二层：如果提供了 modelPref，只测试偏好的模型类型
    const modelEntries = options.modelPref
      ? options.modelPref
          .filter((name) => MODEL_BUILDERS[name])
          .map((name) => [name, MODEL_BUILDERS[name]])
      : Object.entries(MODEL_BUILDERS);

    this.results = Object.entries(featureSetsToUse)
      .flatMap(([featureSetName, featureNames]) => {
        const available = featureNames.filter((name) => rows.every((row) => row[name] !== undefined));
        if (!available.length) {
          return [];
        }
        return modelEntries.map(([modelName, buildModel]) => {
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
