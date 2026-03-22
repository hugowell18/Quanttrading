const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeConfidence = (topScore, secondScore) => {
  const gap = Math.max(topScore - secondScore, 0);
  return Number(clamp(0.5 + gap / 20, 0.5, 0.98).toFixed(2));
};

export const classifyRegime = (features) => {
  const reasons = {
    trend: [],
    range: [],
    speculative: [],
  };

  let trendScore = 0;
  let rangeScore = 0;
  let speculativeScore = 0;

  if ((features.trend?.adx ?? 0) >= 25) {
    trendScore += 4;
    reasons.trend.push(`ADX ${features.trend.adx}，高于趋势阈值`);
  } else if ((features.trend?.adx ?? 0) < 20) {
    rangeScore += 4;
    reasons.range.push(`ADX ${features.trend.adx}，趋势力度不足`);
  }

  if (features.trend?.maAlignment === 'bullish' || features.trend?.maAlignment === 'bearish') {
    trendScore += 3;
    reasons.trend.push(`均线排列为 ${features.trend.maAlignment}`);
  }

  if (features.trend?.maAlignment === 'mixed') {
    rangeScore += 3;
    reasons.range.push('均线纠缠，偏震荡结构');
  }

  if (features.trend?.direction === 'up' || features.trend?.direction === 'down') {
    trendScore += 2;
    reasons.trend.push(`趋势方向为 ${features.trend.direction}`);
  }

  if (features.trend?.direction === 'flat') {
    rangeScore += 2;
    reasons.range.push('方向不明确，偏横盘');
  }

  if (features.volume?.priceVolumePattern === 'confirm_up' || features.volume?.priceVolumePattern === 'confirm_down') {
    trendScore += 2;
    reasons.trend.push(`量价关系为 ${features.volume.priceVolumePattern}`);
  }

  if (features.volume?.priceVolumePattern === 'fake_up' || features.volume?.priceVolumePattern === 'exhaustion') {
    speculativeScore += 2;
    reasons.speculative.push(`量价关系显示 ${features.volume.priceVolumePattern}`);
  }

  if ((features.autocorr20 ?? 0) >= 0.2) {
    rangeScore += 2;
    reasons.range.push(`20日自相关 ${features.autocorr20}，价格反复性较强`);
  }

  if ((features.volatility ?? 0) >= 0.38) {
    speculativeScore += 4;
    reasons.speculative.push(`年化波动率 ${features.volatility} 偏高`);
  } else if ((features.volatility ?? 0) <= 0.2) {
    rangeScore += 1;
    reasons.range.push(`年化波动率 ${features.volatility} 偏低`);
  }

  if ((features.liquidityScore ?? 0) <= 0.2) {
    speculativeScore += 3;
    reasons.speculative.push(`流动性分数 ${features.liquidityScore} 偏低`);
  } else if ((features.liquidityScore ?? 0) >= 0.5) {
    trendScore += 1;
    reasons.trend.push(`流动性分数 ${features.liquidityScore} 较好`);
  }

  if (features.volume?.turnoverSpike) {
    speculativeScore += 3;
    reasons.speculative.push('量比突增，存在投机资金介入迹象');
  } else {
    rangeScore += 1;
    reasons.range.push('换手未异常放大');
  }

  if (features.momentum?.macdSignal === 'golden_cross' || features.momentum?.macdSignal === 'dead_cross') {
    trendScore += 1;
    reasons.trend.push(`MACD 信号为 ${features.momentum.macdSignal}`);
  }

  if (
    features.momentum?.rsiSignal === 'overbought' &&
    features.momentum?.wrSignal === 'overbought' &&
    features.volume?.turnoverSpike
  ) {
    speculativeScore += 2;
    reasons.speculative.push('超买叠加放量，短线投机特征明显');
  }

  const scores = {
    trend: trendScore,
    range: rangeScore,
    speculative: speculativeScore,
  };

  const ordered = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [topType, topScore] = ordered[0];
  const secondScore = ordered[1]?.[1] ?? 0;

  return {
    type: topType,
    confidence: normalizeConfidence(topScore, secondScore),
    scores,
    reasons: reasons[topType].slice(0, 4),
  };
};
