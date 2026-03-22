const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeWeights = (weights) => {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number((value / total).toFixed(4))]));
};

const signalFromStrategy = (strategy) => {
  if (strategy.score >= 18 && strategy.annualReturn > 0 && strategy.sharpe > 0.75 && strategy.maxDrawdown < 22) {
    return { signal: 'buy', strength: clamp(strategy.score / 32, 0, 1) };
  }

  if (strategy.score <= 4 || strategy.annualReturn < 0 || strategy.maxDrawdown > 28) {
    return { signal: 'sell', strength: clamp(Math.abs(strategy.score) / 24, 0, 1) };
  }

  return { signal: 'hold', strength: clamp(strategy.score / 28, 0, 1) };
};

const regimeBucketWeights = {
  trend: {
    maCross: 0.32,
    macdRsi: 0.27,
    bollVolume: 0.17,
    multiFactor: 0.24,
  },
  range: {
    maCross: 0.1,
    macdRsi: 0.18,
    bollVolume: 0.4,
    multiFactor: 0.32,
  },
  speculative: {
    maCross: 0.08,
    macdRsi: 0.14,
    bollVolume: 0.24,
    multiFactor: 0.54,
  },
};

const scoreBucketStrategies = (strategies, bucketWeights, regimeType) => {
  const bucketTotals = {
    maCross: 0,
    macdRsi: 0,
    bollVolume: 0,
    multiFactor: 0,
  };

  const enriched = strategies.map((strategy) => {
    const rawSignal = signalFromStrategy(strategy);
    const scoreFloor = Math.max(strategy.score, 0.1);
    const regimeBonus = strategy.regimeFit?.includes(regimeType) ? 1.08 : 0.76;
    const baseWeight = bucketWeights[strategy.weightBucket] ?? 0;
    const weightedScore = scoreFloor * regimeBonus;
    bucketTotals[strategy.weightBucket] = (bucketTotals[strategy.weightBucket] ?? 0) + weightedScore;

    return {
      ...strategy,
      signal: rawSignal.signal,
      signalStrength: Number(rawSignal.strength.toFixed(2)),
      _bucketBaseWeight: baseWeight,
      _weightedScore: weightedScore,
    };
  });

  return enriched.map((strategy) => {
    const bucketTotal = bucketTotals[strategy.weightBucket] || 1;
    const ensembleWeight = Number(((strategy._bucketBaseWeight * strategy._weightedScore) / bucketTotal).toFixed(4));
    const direction = strategy.signal === 'buy' ? 1 : strategy.signal === 'sell' ? -1 : 0;
    return {
      ...strategy,
      ensembleWeight,
      weightedContribution: Number((direction * strategy.signalStrength * ensembleWeight).toFixed(4)),
    };
  });
};

export const selectAdaptiveStrategy = ({ features, regime, strategies }) => {
  const bucketWeights = { ...(regimeBucketWeights[regime.type] || regimeBucketWeights.range) };
  const reasons = [`当前股票类型为 ${regime.type}，分类置信度 ${regime.confidence}`];

  if ((features.trend?.adx ?? 0) >= 30) {
    bucketWeights.maCross += 0.06;
    bucketWeights.macdRsi += 0.05;
    reasons.push(`ADX ${features.trend.adx} 偏强，增强趋势与动量家族权重`);
  }

  if (features.volume?.priceVolumePattern === 'confirm_up' || features.volume?.priceVolumePattern === 'confirm_down') {
    bucketWeights.bollVolume += 0.05;
    reasons.push(`量价关系为 ${features.volume.priceVolumePattern}，提升突破/量能家族`);
  }

  if ((features.momentum?.rsi12 ?? 50) >= 72 || (features.momentum?.rsi12 ?? 50) <= 28) {
    bucketWeights.macdRsi -= 0.03;
    bucketWeights.multiFactor += 0.03;
    reasons.push(`RSI12 ${features.momentum.rsi12} 进入极值区，组合策略转向风险过滤`);
  }

  if ((features.autocorr20 ?? 0) >= 0.2) {
    bucketWeights.bollVolume += 0.04;
    bucketWeights.multiFactor += 0.02;
    reasons.push(`20日自相关 ${features.autocorr20} 较高，增强震荡/均衡类策略`);
  }

  if (features.volume?.turnoverSpike) {
    bucketWeights.multiFactor += 0.08;
    bucketWeights.maCross -= 0.03;
    reasons.push('量比突增，采用多因子作为核心风险过滤器');
  }

  const normalizedBuckets = normalizeWeights(bucketWeights);
  const perStrategy = scoreBucketStrategies(strategies, normalizedBuckets, regime.type);
  const aggregateScore = perStrategy.reduce((sum, strategy) => sum + strategy.weightedContribution, 0);
  const bestBaseStrategy = [...strategies].sort((left, right) => right.score - left.score)[0];

  let riskBias = regime.type === 'speculative' ? 'defensive' : regime.type === 'trend' ? 'aggressive' : 'balanced';
  let currentSignal = aggregateScore >= 0.14 ? 'buy' : aggregateScore <= -0.12 ? 'sell' : 'hold';
  let signalStrength = clamp(Math.abs(aggregateScore) * 2.4, 0, 1);

  if ((features.volatility ?? 0) >= 0.4 || (features.liquidityScore ?? 0) <= 0.15 || regime.type === 'speculative') {
    signalStrength = Number((signalStrength * 0.68).toFixed(2));
    if (signalStrength < 0.22) {
      currentSignal = 'hold';
    }
    reasons.push('高波动或低流动性触发风险折扣');
  }

  if (currentSignal === 'hold') {
    reasons.push('综合信号未达到交易阈值，当前建议观望');
  } else {
    reasons.push(`组合信号为 ${currentSignal}，强度 ${signalStrength.toFixed(2)}`);
  }

  if (bestBaseStrategy) {
    reasons.push(`基底模型表现最佳的是 ${bestBaseStrategy.strategyName}`);
  }

  return {
    strategyId: 'adaptive_composite_e',
    strategyName: 'Adaptive Composite Strategy',
    regime: regime.type,
    confidence: Number(clamp((regime.confidence + signalStrength) / 2, 0.45, 0.98).toFixed(2)),
    weights: {
      maCross: normalizedBuckets.maCross,
      macdRsi: normalizedBuckets.macdRsi,
      bollVolume: normalizedBuckets.bollVolume,
      multiFactor: normalizedBuckets.multiFactor,
    },
    currentSignal,
    signalStrength: Number(signalStrength.toFixed(2)),
    riskBias,
    reasons: reasons.slice(0, 6),
    benchmark: {
      bestBaseStrategyId: bestBaseStrategy?.strategyId || '',
      bestBaseStrategyScore: bestBaseStrategy?.score ?? 0,
    },
    components: perStrategy,
  };
};
