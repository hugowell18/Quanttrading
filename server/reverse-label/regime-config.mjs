/**
 * 第二层：Regime → 策略配置映射表
 *
 * 每种 regime 定义：
 *   featurePool  - 该状态下有意义的特征子集（模型只能从这个池中选择）
 *   scanRange    - 缩窄后的 SignalLabeler 参数搜索空间
 *   exitParams   - 持仓周期/止损/追踪止损参数
 *   modelPref    - 偏好的模型类型（排在前面优先测试）
 */

export const REGIME_CONFIGS = {
  uptrend: {
    label: '上升趋势',
    featurePool: ['maBull', 'adx14', 'macd_dif', 'macd_bar', 'roc5', 'roc20', 'volRatio5', 'distFromLow', 'atrRatio', 'rs20'],
    scanRange: {
      minZoneCapture: [0.6, 0.7, 0.8],
      zoneForward: [5, 10, 15],
      zoneBackward: [2, 3],
      envFilter: ['ma20', 'ma20_0.98', 'ma60_rising'],
    },
    exitParams: {
      maxHoldingDays: 60,              // 趋势行情允许更长持仓
      stopLoss: 0.05,
      trailingStopMultiplier: 1.5,
      takeProfitStyle: 'trend_follow', // 趋势跟随：不破MA20不走
    },
    modelPref: ['ContrastRank', 'EnsembleVote'],
  },

  downtrend: {
    label: '下降趋势',
    featurePool: ['rsi6', 'rsi2', 'bollPos', 'wr14', 'volRatio5', 'atr14', 'distFromHigh', 'consecutiveDown', 'rsiVolCross'],
    scanRange: {
      minZoneCapture: [0.6, 0.7, 0.8],
      zoneForward: [3, 5, 10],
      zoneBackward: [2, 3],
      envFilter: ['none', 'ma20_0.98'],
    },
    exitParams: {
      maxHoldingDays: 15,
      stopLoss: 0.04,
      trailingStopMultiplier: 1.2,
      takeProfitStyle: 'target',       // 目标止盈：摸到目标就走
      targetProfitPct: 0.05,           // 5% 目标止盈
    },
    modelPref: ['PercentileRank', 'PositiveBiasRank'],
  },

  range: {
    label: '震荡区间',
    featurePool: ['rsi6', 'rsi12', 'bollPos', 'bollWidth', 'wr14', 'k', 'j', 'atr14', 'distFromHigh', 'distFromLow', 'rsiVolCross'],
    scanRange: {
      minZoneCapture: [0.5, 0.6, 0.7],
      zoneForward: [3, 5, 10],
      zoneBackward: [2, 3, 5],
      envFilter: ['none', 'ma20_0.98'],
    },
    exitParams: {
      maxHoldingDays: 25,
      stopLoss: 0.04,
      trailingStopMultiplier: 1.3,
      takeProfitStyle: 'target',       // 震荡市摸高派发
      targetProfitPct: 0.06,           // 6% 目标止盈
      bollUpperExit: true,             // 触碰布林上轨止盈
    },
    modelPref: ['PercentileRank', 'ContrastRank'],
  },

  breakout: {
    label: '突破前夕',
    featurePool: ['bollWidth', 'bollPos', 'adx14', 'volRatio5', 'volRatio20', 'roc5', 'macd_dif', 'atrRatio', 'bollAdxCross', 'distFromLow', 'rs20'],
    scanRange: {
      minZoneCapture: [0.5, 0.6],
      zoneForward: [3, 5],
      zoneBackward: [2, 3],
      envFilter: ['none', 'ma20'],
    },
    exitParams: {
      maxHoldingDays: 30,
      stopLoss: 0.04,
      trailingStopMultiplier: 1.8,
      takeProfitStyle: 'trend_follow', // 突破后跟随趋势，不主动止盈
    },
    modelPref: ['EnsembleVote', 'ContrastRank'],
  },

  high_vol: {
    label: '高波动',
    featurePool: ['atr14', 'rsi6', 'adx14', 'volRatio20', 'bollPos', 'roc20', 'macd_bar', 'atrRatio', 'distFromHigh', 'consecutiveDown', 'rsiVolCross'],
    scanRange: {
      minZoneCapture: [0.5, 0.6, 0.7, 0.8],
      zoneForward: [3, 5, 10],
      zoneBackward: [2, 3],
      envFilter: ['none', 'ma20', 'ma20_0.98'],
    },
    exitParams: {
      maxHoldingDays: 20,
      stopLoss: 0.06,
      trailingStopMultiplier: 2.0,
      takeProfitStyle: 'tiered',       // 分级止盈（保持现有逻辑）
    },
    modelPref: ['EnsembleVote', 'PercentileRank'],
  },
};

/**
 * 根据 regime 构建缩窄后的参数网格
 * @param {string} regime
 * @returns {Object[]} 参数组合列表
 */
export function buildRegimeGrid(regime) {
  const config = REGIME_CONFIGS[regime] ?? REGIME_CONFIGS.range;
  const grid = [];
  for (const minZoneCapture of config.scanRange.minZoneCapture)
    for (const zoneForward of config.scanRange.zoneForward)
      for (const zoneBackward of config.scanRange.zoneBackward)
        for (const envFilter of config.scanRange.envFilter)
          grid.push({ minZoneCapture, zoneForward, zoneBackward, envFilter });
  return grid;
}

/**
 * 获取 regime 的退出参数
 * @param {string} regime
 * @returns {Object}
 */
export function getExitParams(regime) {
  return (REGIME_CONFIGS[regime] ?? REGIME_CONFIGS.range).exitParams;
}

/**
 * 获取 regime 的特征池
 * @param {string} regime
 * @returns {string[]}
 */
export function getFeaturePool(regime) {
  return (REGIME_CONFIGS[regime] ?? REGIME_CONFIGS.range).featurePool;
}

/**
 * 获取 regime 的模型偏好
 * @param {string} regime
 * @returns {string[]}
 */
export function getModelPref(regime) {
  return (REGIME_CONFIGS[regime] ?? REGIME_CONFIGS.range).modelPref;
}

// 各 regime 网格大小预览
// uptrend:   3×3×2×3 = 54
// downtrend: 2×2×1×1 = 4
// range:     3×3×3×2 = 54
// breakout:  2×2×2×2 = 16
// high_vol:  2×2×1×2 = 8
// 总计最大 54 组，对比原来的 240 组减少 70%+
