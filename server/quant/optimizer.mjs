import { strategyRegistry } from './strategy-registry.mjs';
import { evaluateStrategyVariant } from './backtests.mjs';

const cloneParams = (params) => JSON.parse(JSON.stringify(params ?? {}));

const dedupeVariants = (variants) => {
  const seen = new Set();
  return variants.filter((variant) => {
    const signature = JSON.stringify(variant.params);
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
};

const buildParamVariants = (definition) => {
  const baseParams = cloneParams(definition.params);
  const variants = [{ ...definition, params: baseParams }];

  switch (definition.evaluator) {
    case 'bollRevert': {
      [1.8, 2, 2.2, 2.5].forEach((sigma) => {
        [54, 58, 62].forEach((exitRsi) => {
          variants.push({ ...definition, params: { ...baseParams, sigma, exitRsi } });
        });
      });
      break;
    }
    case 'zScoreRevert': {
      const lookback = Number(baseParams.lookback ?? 20);
      [lookback - 5, lookback, lookback + 5].filter((value) => value >= 5).forEach((period) => {
        [1.4, 1.6, 1.8, 2].forEach((threshold) => {
          variants.push({ ...definition, params: { ...baseParams, lookback: period, threshold } });
        });
      });
      break;
    }
    case 'rsiWrRevert': {
      [20, 25, 30].forEach((rsiEntryMax) => {
        [-90, -85, -80].forEach((wrEntryMax) => {
          variants.push({ ...definition, params: { ...baseParams, rsiEntryMax, wrEntryMax } });
        });
      });
      break;
    }
    case 'rsi2Bounce': {
      [6, 8, 10, 12].forEach((entryMax) => {
        [50, 55, 60].forEach((exitMin) => {
          variants.push({ ...definition, params: { ...baseParams, entryMax, exitMin } });
        });
      });
      break;
    }
    case 'maCross': {
      const fast = Number(baseParams.fast ?? 20);
      const slow = Number(baseParams.slow ?? 60);
      [fast - 5, fast, fast + 5].filter((value) => value >= 5).forEach((fastPeriod) => {
        [slow - 10, slow, slow + 10].filter((value) => value > fastPeriod).forEach((slowPeriod) => {
          [baseParams.adxMin ?? 0, 20, 25, 30].forEach((adxMin) => {
            const nextParams = { ...baseParams, fast: fastPeriod, slow: slowPeriod };
            if (adxMin > 0) {
              nextParams.adxMin = adxMin;
            } else {
              delete nextParams.adxMin;
            }
            variants.push({ ...definition, params: nextParams });
          });
        });
      });
      break;
    }
    case 'macdRsiConfirm': {
      [60, 65, 68].forEach((rsiEntryMax) => {
        [70, 75, 80].forEach((rsiExitMin) => {
          variants.push({ ...definition, params: { ...baseParams, rsiEntryMax, rsiExitMin } });
        });
      });
      break;
    }
    case 'bollBreakVolume':
    case 'rangeBreakVolume':
    case 'maBreakTurnover':
    case 'priceVolumeConfirm': {
      [1.05, 1.15, 1.25, 1.35].forEach((volumeRatioMin) => {
        variants.push({ ...definition, params: { ...baseParams, volumeRatioMin } });
      });
      break;
    }
    case 'multiFactor': {
      [3, 4, 5].forEach((entryScore) => {
        [1, 2, 3].forEach((exitScore) => {
          if (entryScore > exitScore) {
            variants.push({ ...definition, params: { ...baseParams, entryScore, exitScore } });
          }
        });
      });
      break;
    }
    default:
      break;
  }

  return dedupeVariants(variants);
};

const buildImprovement = (metrics, baseMetrics) => ({
  winRateDelta: Number((metrics.winRate - (baseMetrics.winRate ?? 0)).toFixed(2)),
  annualReturnDelta: Number((metrics.annualReturn - (baseMetrics.annualReturn ?? 0)).toFixed(2)),
  maxDrawdownDelta: Number((metrics.maxDrawdown - (baseMetrics.maxDrawdown ?? 0)).toFixed(2)),
  sharpeDelta: Number((metrics.sharpe - (baseMetrics.sharpe ?? 0)).toFixed(2)),
});

const isQualifiedImprovement = (improvement) => {
  if (improvement.annualReturnDelta < 0) {
    return false;
  }

  if (improvement.winRateDelta < -0.25) {
    return false;
  }

  if (improvement.maxDrawdownDelta > 1) {
    return false;
  }

  return improvement.annualReturnDelta > 0.5 || improvement.winRateDelta > 0.5 || improvement.sharpeDelta > 0.2;
};

const buildOptimizationScore = (metrics, improvement) => {
  const sharpe = Math.max(metrics.sharpe, 0);
  const annualReturnGain = Math.max(improvement.annualReturnDelta, 0);
  const winRateGain = Math.max(improvement.winRateDelta, 0);
  const drawdownGain = Math.max(-improvement.maxDrawdownDelta, 0);
  const drawdownPenalty = Math.max(improvement.maxDrawdownDelta, 0);
  const profitFactor = Math.max(Math.min(metrics.profitFactor, 5), 0);
  const tradePenalty = metrics.trades < 2 ? 6 : 0;
  return Number((annualReturnGain * 1.8 + winRateGain * 1.4 + sharpe * 0.6 + drawdownGain * 1.2 + profitFactor * 0.3 - drawdownPenalty * 2.4 - tradePenalty).toFixed(2));
};

export const optimizeStrategyModel = ({ candles, capital, stopLoss, takeProfit, candidateStrategies }) => {
  const evaluatedVariants = candidateStrategies.flatMap((candidate) => {
    const definition = strategyRegistry.find((item) => item.id === candidate.strategyId);
    if (!definition) {
      return [];
    }

    return buildParamVariants(definition).map((variant) => {
      const { metrics, rawTrades } = evaluateStrategyVariant(variant, candles, capital, stopLoss, takeProfit);
      const improvement = buildImprovement(metrics, candidate);
      return {
        candidate,
        definition: variant,
        metrics,
        rawTrades,
        improvement,
        qualified: isQualifiedImprovement(improvement),
        optimizationScore: buildOptimizationScore(metrics, improvement),
      };
    });
  });

  const optimized = [...evaluatedVariants]
    .filter((item) => item.qualified)
    .sort((left, right) => right.optimizationScore - left.optimizationScore)[0];

  if (!optimized) {
    return null;
  }

  return {
    strategyId: 'adaptive_composite_e',
    strategyName: '\u4f18\u5316\u6a21\u578b E2',
    baseModel: optimized.definition.id,
    baseModelName: optimized.definition.name,
    isOptimized: true,
    params: optimized.definition.params,
    metrics: {
      sharpe: optimized.metrics.sharpe,
      maxDrawdown: optimized.metrics.maxDrawdown,
      winRate: optimized.metrics.winRate,
      profitFactor: optimized.metrics.profitFactor,
      annualReturn: optimized.metrics.annualReturn,
      trades: optimized.metrics.trades,
      score: optimized.optimizationScore,
    },
    improvement: optimized.improvement,
    rawTrades: optimized.rawTrades,
  };
};
