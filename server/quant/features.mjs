const average = (values) => {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const standardDeviation = (values) => {
  if (values.length < 2) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
};

const autocorrelation = (values, lag) => {
  if (values.length <= lag) {
    return 0;
  }

  const mean = average(values);
  let numerator = 0;
  let denominator = 0;

  for (let index = lag; index < values.length; index += 1) {
    numerator += (values[index] - mean) * (values[index - lag] - mean);
  }

  for (const value of values) {
    denominator += (value - mean) ** 2;
  }

  return denominator === 0 ? 0 : numerator / denominator;
};

const slope = (values) => {
  if (values.length < 2) {
    return 0;
  }

  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = average(values);
  let numerator = 0;
  let denominator = 0;

  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });

  return denominator === 0 ? 0 : numerator / denominator;
};

export const buildFeatures = (candles) => {
  if (!candles.length) {
    return {
      trend: {},
      momentum: {},
      volume: {},
      volatility: 0,
      autocorr5: 0,
      autocorr20: 0,
      liquidityScore: 0,
    };
  }

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const returns = candles.slice(1).map((item, index) => {
    const base = candles[index].close || 1;
    return (item.close - base) / base;
  });
  const ma20Series = candles.map((item) => item.ma20 ?? item.close);
  const ma60Series = candles.map((item) => item.ma60 ?? item.close);
  const obvSeries = candles.map((item) => item.obv ?? 0);
  const recentVolumes = candles.slice(-20).map((item) => item.volume);
  const recentAdx = average(candles.slice(-14).map((item) => item.adx ?? 0));
  const maAlignment =
    latest.ma20 > latest.ma60 && latest.ma60 > latest.ma120
      ? 'bullish'
      : latest.ma20 < latest.ma60 && latest.ma60 < latest.ma120
        ? 'bearish'
        : 'mixed';
  const trendDirection =
    latest.close > latest.ma20 && slope(ma20Series.slice(-20)) > 0
      ? 'up'
      : latest.close < latest.ma20 && slope(ma20Series.slice(-20)) < 0
        ? 'down'
        : 'flat';
  const trendStrength = recentAdx >= 35 ? 'strong' : recentAdx >= 25 ? 'medium' : 'weak';
  const bollingerPosition =
    latest.close > latest.bollUpper
      ? 'upper_breakout'
      : latest.close >= latest.bollMid
        ? 'upper'
        : latest.close < latest.bollLower
          ? 'lower_breakdown'
          : latest.close < latest.bollMid
            ? 'lower'
            : 'middle';
  const macdSignal =
    previous.dif <= previous.dea && latest.dif > latest.dea
      ? 'golden_cross'
      : previous.dif >= previous.dea && latest.dif < latest.dea
        ? 'dead_cross'
        : latest.dif >= latest.dea
          ? 'bullish'
          : 'bearish';
  const rsiSignal = latest.rsi12 >= 70 ? 'overbought' : latest.rsi12 <= 30 ? 'oversold' : 'neutral';
  const kdjSignal =
    previous.k <= previous.d && latest.k > latest.d
      ? 'golden_cross'
      : previous.k >= previous.d && latest.k < latest.d
        ? 'dead_cross'
        : 'neutral';
  const wrSignal = latest.wr14 <= -80 ? 'oversold' : latest.wr14 >= -20 ? 'overbought' : 'neutral';
  const priceChange = latest.close - previous.close;
  const volumeConfirmation =
    priceChange > 0 && latest.volumeRatio >= 1.2
      ? 'confirm_up'
      : priceChange > 0
        ? 'fake_up'
        : priceChange < 0 && latest.volumeRatio >= 1.2
          ? 'confirm_down'
          : 'exhaustion';
  const obvTrend = slope(obvSeries.slice(-20)) > 0 ? 'up' : slope(obvSeries.slice(-20)) < 0 ? 'down' : 'flat';
  const turnoverSpike = latest.volumeRatio >= 2;
  const annualizedVolatility = standardDeviation(returns) * Math.sqrt(252);
  const liquidityScore = average(recentVolumes) === 0 ? 0 : Math.min(1, average(recentVolumes) / 1000000);

  return {
    trend: {
      direction: trendDirection,
      strength: trendStrength,
      adx: Number(recentAdx.toFixed(2)),
      maAlignment,
      bollingerPosition,
      bollingerWidth: latest.bollWidth,
      maSlope20: Number(slope(ma20Series.slice(-20)).toFixed(4)),
      maSlope60: Number(slope(ma60Series.slice(-30)).toFixed(4)),
    },
    momentum: {
      macdSignal,
      macdHistogram: latest.macd,
      rsiSignal,
      rsi6: latest.rsi6,
      rsi12: latest.rsi12,
      rsi24: latest.rsi24,
      kdjSignal,
      k: latest.k,
      d: latest.d,
      j: latest.j,
      wrSignal,
      wr14: latest.wr14,
      roc12: latest.roc12,
    },
    volume: {
      priceVolumePattern: volumeConfirmation,
      obvTrend,
      volumeRatio: latest.volumeRatio,
      turnoverSpike,
    },
    volatility: Number(annualizedVolatility.toFixed(4)),
    autocorr5: Number(autocorrelation(returns, 5).toFixed(4)),
    autocorr20: Number(autocorrelation(returns, 20).toFixed(4)),
    liquidityScore: Number(liquidityScore.toFixed(4)),
  };
};
