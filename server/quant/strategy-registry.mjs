export const strategyRegistry = [
  { id: 'ma10_30_cross', name: 'MA10/30 双均线交叉', category: 'trend', weightBucket: 'maCross', regimeFit: ['trend'], evaluator: 'maCross', params: { fast: 10, slow: 30 } },
  { id: 'ma20_60_cross', name: 'MA20/60 双均线交叉', category: 'trend', weightBucket: 'maCross', regimeFit: ['trend'], evaluator: 'maCross', params: { fast: 20, slow: 60 } },
  { id: 'ma30_120_cross', name: 'MA30/120 双均线交叉', category: 'trend', weightBucket: 'maCross', regimeFit: ['trend'], evaluator: 'maCross', params: { fast: 30, slow: 120 } },
  { id: 'ma20_60_adx25', name: 'MA20/60 + ADX25 趋势确认', category: 'trend', weightBucket: 'maCross', regimeFit: ['trend'], evaluator: 'maCross', params: { fast: 20, slow: 60, adxMin: 25 } },
  { id: 'ma20_120_adx30', name: 'MA20/120 + ADX30 长趋势确认', category: 'trend', weightBucket: 'maCross', regimeFit: ['trend'], evaluator: 'maCross', params: { fast: 20, slow: 120, adxMin: 30 } },
  { id: 'donchian20_break', name: 'Donchian 20 日突破', category: 'trend', weightBucket: 'bollVolume', regimeFit: ['trend'], evaluator: 'donchianBreak', params: { lookback: 20 } },
  { id: 'donchian55_break', name: 'Donchian 55 日突破', category: 'trend', weightBucket: 'bollVolume', regimeFit: ['trend'], evaluator: 'donchianBreak', params: { lookback: 55 } },
  { id: 'ma_alignment_pullback', name: '多头排列回踩 MA20', category: 'trend', weightBucket: 'maCross', regimeFit: ['trend'], evaluator: 'maAlignmentPullback', params: { pullbackMa: 20 } },
  { id: 'macd_classic', name: 'MACD 经典金叉死叉', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend', 'range'], evaluator: 'macdClassic', params: {} },
  { id: 'macd_rsi_confirm', name: 'MACD + RSI 节奏确认', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend'], evaluator: 'macdRsiConfirm', params: { rsiEntryMax: 65, rsiExitMin: 75 } },
  { id: 'macd_zero_axis', name: 'MACD 零轴上方顺势', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend'], evaluator: 'macdZeroAxis', params: {} },
  { id: 'roc12_trend', name: 'ROC12 动量延续', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend'], evaluator: 'rocTrend', params: { rocMin: 3.5 } },
  { id: 'price_momentum_20d', name: '20 日价格动量', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend'], evaluator: 'priceMomentum', params: { lookback: 20, minMomentum: 0.06 } },
  { id: 'price_momentum_60d', name: '60 日价格动量', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend'], evaluator: 'priceMomentum', params: { lookback: 60, minMomentum: 0.12 } },
  { id: 'kdj_trend_filter', name: 'KDJ 金叉 + 趋势过滤', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend', 'range'], evaluator: 'kdjTrendFilter', params: {} },
  { id: 'rsi50_regime_shift', name: 'RSI50 趋势切换', category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend'], evaluator: 'rsi50RegimeShift', params: {} },
  { id: 'boll_revert_20_2', name: '布林回归 20/2', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'bollRevert', params: { sigma: 2, exitRsi: 58 } },
  { id: 'boll_revert_20_25', name: '布林回归 20/2.5', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'bollRevert', params: { sigma: 2.5, exitRsi: 60 } },
  { id: 'rsi2_oversold_bounce', name: 'RSI2 超卖反弹', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'rsi2Bounce', params: { entryMax: 10, exitMin: 55 } },
  { id: 'rsi6_wr14_revert', name: 'RSI6 + WR14 反转', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'rsiWrRevert', params: { rsiEntryMax: 25, wrEntryMax: -85 } },
  { id: 'z_score_10_revert', name: '10 日 Z-Score 回归', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'zScoreRevert', params: { lookback: 10, threshold: 1.5 } },
  { id: 'z_score_20_revert', name: '20 日 Z-Score 回归', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'zScoreRevert', params: { lookback: 20, threshold: 1.8 } },
  { id: 'ma20_deviation_revert', name: '偏离 MA20 回归', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'maDeviationRevert', params: { deviationPct: 0.06 } },
  { id: 'boll_midline_recovery', name: '下轨回到中轨恢复', category: 'mean_reversion', weightBucket: 'bollVolume', regimeFit: ['range'], evaluator: 'bollMidlineRecovery', params: {} },
  { id: 'boll_break_vol', name: '布林突破 + 量能确认', category: 'breakout', weightBucket: 'bollVolume', regimeFit: ['trend', 'speculative'], evaluator: 'bollBreakVolume', params: { volumeRatioMin: 1.2 } },
  { id: 'donchian_break_obv', name: 'Donchian 突破 + OBV', category: 'breakout', weightBucket: 'bollVolume', regimeFit: ['trend'], evaluator: 'donchianBreakObv', params: { lookback: 20 } },
  { id: 'range_break_volume', name: '区间突破 + 放量', category: 'breakout', weightBucket: 'bollVolume', regimeFit: ['trend', 'speculative'], evaluator: 'rangeBreakVolume', params: { lookback: 30, volumeRatioMin: 1.35 } },
  { id: 'ma20_break_turnover', name: '突破 MA20 + 量比放大', category: 'breakout', weightBucket: 'bollVolume', regimeFit: ['trend', 'speculative'], evaluator: 'maBreakTurnover', params: { volumeRatioMin: 1.4 } },
  { id: 'adx_rising_breakout', name: 'ADX 上升突破', category: 'breakout', weightBucket: 'bollVolume', regimeFit: ['trend'], evaluator: 'adxRisingBreakout', params: { breakoutLookback: 20, adxMin: 22 } },
  { id: 'price_volume_confirm', name: '价涨量增确认', category: 'breakout', weightBucket: 'bollVolume', regimeFit: ['trend', 'speculative'], evaluator: 'priceVolumeConfirm', params: { volumeRatioMin: 1.15 } },
  { id: 'multi_factor_trend', name: '多因子趋势评分', category: 'multi_factor', weightBucket: 'multiFactor', regimeFit: ['trend'], evaluator: 'multiFactor', params: { mode: 'trend', entryScore: 4, exitScore: 2 } },
  { id: 'multi_factor_range', name: '多因子震荡评分', category: 'multi_factor', weightBucket: 'multiFactor', regimeFit: ['range'], evaluator: 'multiFactor', params: { mode: 'range', entryScore: 4, exitScore: 2 } },
  { id: 'multi_factor_balanced', name: '多因子均衡评分', category: 'multi_factor', weightBucket: 'multiFactor', regimeFit: ['trend', 'range'], evaluator: 'multiFactor', params: { mode: 'balanced', entryScore: 4, exitScore: 2 } },
  { id: 'low_vol_trend', name: '低波动趋势延续', category: 'multi_factor', weightBucket: 'multiFactor', regimeFit: ['trend'], evaluator: 'multiFactor', params: { mode: 'lowVolTrend', entryScore: 4, exitScore: 2 } },
  { id: 'high_liquidity_breakout', name: '高流动性突破', category: 'multi_factor', weightBucket: 'multiFactor', regimeFit: ['trend'], evaluator: 'multiFactor', params: { mode: 'highLiquidityBreakout', entryScore: 4, exitScore: 2 } },
  { id: 'quality_signal_stack', name: '高质量信号叠加', category: 'multi_factor', weightBucket: 'multiFactor', regimeFit: ['trend', 'range'], evaluator: 'multiFactor', params: { mode: 'qualityStack', entryScore: 5, exitScore: 2 } },
];

export const buildStrategyOptions = (strategies, bestStrategy) => {
  const topThree = [...strategies].sort((left, right) => right.score - left.score).slice(0, 3);

  return [
    {
      id: bestStrategy.strategyId,
      label: '优化组合策略 E (Recommended)',
      kind: 'composite',
      score: Number((bestStrategy.confidence * 100).toFixed(2)),
    },
    ...topThree.map((strategy) => ({
      id: strategy.strategyId,
      label: strategy.strategyName,
      kind: 'base',
      score: strategy.score,
    })),
  ];
};
