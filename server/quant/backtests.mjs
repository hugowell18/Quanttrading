import { strategyRegistry } from './strategy-registry.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

const compoundReturn = (returns) => returns.reduce((equity, value) => equity * (1 + value / 100), 1);

const maxDrawdown = (returns) => {
  let peak = 1;
  let equity = 1;
  let drawdown = 0;

  for (const value of returns) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, (equity - peak) / peak);
  }

  return Math.abs(drawdown * 100);
};

const sharpeRatio = (returns) => {
  if (returns.length < 2) {
    return 0;
  }

  const mean = average(returns) / 100;
  const std = standardDeviation(returns.map((value) => value / 100));
  if (std === 0) {
    return 0;
  }

  return (mean / std) * Math.sqrt(12);
};

const profitFactor = (returns) => {
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) {
    return gains > 0 ? 99 : 0;
  }

  return gains / losses;
};

const normalizeProfitFactor = (value) => clamp(value >= 99 ? 5 : value, 0, 5);
const normalizeSharpe = (value) => clamp(value, -1, 4);

const buildStrategyScore = ({ sharpe, annualReturn, winRate, maxDrawdown: drawdown, profitFactor: pf, trades }) => {
  const effectiveSharpe = normalizeSharpe(sharpe);
  const effectiveAnnualReturn = clamp(annualReturn, -60, 120);
  const effectiveProfitFactor = normalizeProfitFactor(pf);
  return Number((effectiveSharpe * 4.5 + effectiveAnnualReturn * 0.12 + winRate * 0.18 + effectiveProfitFactor * 6 - drawdown * 0.22 + Math.min(trades, 18) * 0.2).toFixed(2));
};

const inferSignalFromMetrics = (strategy) => {
  if (strategy.score >= 28 && strategy.annualReturn > 0 && strategy.sharpe > 0.75 && strategy.maxDrawdown < 22) {
    return { signal: 'buy', strength: Number(clamp(strategy.score / 60, 0, 1).toFixed(2)) };
  }

  if (strategy.score <= 10 || strategy.annualReturn < 0 || strategy.maxDrawdown > 28) {
    return { signal: 'sell', strength: Number(clamp(Math.abs(strategy.score) / 50, 0, 1).toFixed(2)) };
  }

  return { signal: 'hold', strength: Number(clamp(strategy.score / 70, 0, 1).toFixed(2)) };
};

const finalizeMetrics = (definition, trades) => {
  const returns = trades.map((trade) => trade.returnPct);
  const wins = trades.filter((trade) => trade.returnPct > 0).length;
  const totalReturn = compoundReturn(returns) - 1;
  const tradeYears = Math.max((trades.length * 20) / 252, 0.25);
  const annualReturnRaw = returns.length ? (Math.pow(1 + totalReturn, 1 / tradeYears) - 1) * 100 : 0;
  const annualReturn = clamp(annualReturnRaw, -99, 250);
  const metrics = {
    strategyId: definition.id,
    strategyName: definition.name,
    category: definition.category,
    weightBucket: definition.weightBucket,
    regimeFit: definition.regimeFit,
    params: definition.params,
    sharpe: Number(sharpeRatio(returns).toFixed(2)),
    maxDrawdown: Number(maxDrawdown(returns).toFixed(2)),
    winRate: Number((trades.length ? (wins / trades.length) * 100 : 0).toFixed(2)),
    profitFactor: Number(profitFactor(returns).toFixed(2)),
    annualReturn: Number(annualReturn.toFixed(2)),
    trades: trades.length,
  };

  return {
    ...metrics,
    score: buildStrategyScore(metrics),
  };
};

const simulateTrades = (candles, shouldEnter, shouldExit, capitalWan, stopLossPercent, takeProfitPercent) => {
  const capital = capitalWan * 10000;
  const trades = [];
  let openTrade = null;

  candles.forEach((item, index) => {
    const previous = candles[index - 1];
    if (!previous) {
      return;
    }

    if (!openTrade && shouldEnter(item, previous, index, candles)) {
      openTrade = {
        buyDate: item.date,
        buyPrice: item.close,
      };
      return;
    }

    if (!openTrade) {
      return;
    }

    const returnPct = ((item.close - openTrade.buyPrice) / openTrade.buyPrice) * 100;
    const hitStopLoss = returnPct <= -stopLossPercent;
    const hitTakeProfit = returnPct >= takeProfitPercent;

    if (hitStopLoss || hitTakeProfit || shouldExit(item, previous, index, candles, openTrade) || index === candles.length - 1) {
      const shares = capital / openTrade.buyPrice;
      trades.push({
        buyDate: openTrade.buyDate,
        sellDate: item.date,
        buyPrice: openTrade.buyPrice,
        sellPrice: item.close,
        returnPct: Number(returnPct.toFixed(2)),
        returnAmount: Number((shares * (item.close - openTrade.buyPrice)).toFixed(2)),
      });
      openTrade = null;
    }
  });

  return trades;
};

const runWalkForward = (candles, evaluator) => {
  const trainSize = 120;
  const testSize = 40;
  const step = 20;
  const trades = [];

  for (let start = 0; start + trainSize + testSize <= candles.length; start += step) {
    const testSlice = candles.slice(start + trainSize, start + trainSize + testSize);
    trades.push(...evaluator(testSlice));
  }

  if (!trades.length) {
    const fallbackSlice = candles.slice(Math.max(candles.length - 140, 0));
    trades.push(...evaluator(fallbackSlice));
  }

  return trades;
};

const maValue = (item, period) => item[`ma${period}`] ?? item.close;
const recentSlice = (candles, index, lookback, includeCurrent = false) =>
  candles.slice(Math.max(0, index - lookback + (includeCurrent ? 1 : 0)), includeCurrent ? index + 1 : index);

const rollingHigh = (candles, index, lookback, field = 'high') => {
  const values = recentSlice(candles, index, lookback).map((item) => item[field]);
  return values.length ? Math.max(...values) : candles[index]?.[field] ?? 0;
};

const rollingLow = (candles, index, lookback, field = 'low') => {
  const values = recentSlice(candles, index, lookback).map((item) => item[field]);
  return values.length ? Math.min(...values) : candles[index]?.[field] ?? 0;
};

const rollingAverage = (candles, index, lookback, field) => average(recentSlice(candles, index, lookback, true).map((item) => item[field] ?? 0));

const rollingZScore = (candles, index, lookback) => {
  const values = recentSlice(candles, index, lookback, true).map((item) => item.close);
  if (values.length < 2) {
    return 0;
  }

  const mean = average(values);
  const std = standardDeviation(values);
  if (std === 0) {
    return 0;
  }

  return (candles[index].close - mean) / std;
};

const closeMomentum = (candles, index, lookback) => {
  const base = candles[Math.max(0, index - lookback)]?.close ?? candles[index].close;
  return base === 0 ? 0 : (candles[index].close - base) / base;
};

const realizedVolatility = (candles, index, lookback = 20) => {
  const slice = recentSlice(candles, index, lookback, true);
  if (slice.length < 2) {
    return 0;
  }

  const returns = slice.slice(1).map((item, offset) => {
    const base = slice[offset].close || 1;
    return (item.close - base) / base;
  });

  return standardDeviation(returns) * Math.sqrt(252);
};

const buildFactorScore = (item, previous, index, candles, mode) => {
  const bullishTrend = item.close >= item.ma20 && item.ma20 >= item.ma60;
  const macdBullish = item.dif >= item.dea;
  const balancedRsi = item.rsi12 >= 45 && item.rsi12 <= 65;
  const breakout = item.close > rollingHigh(candles, index, 20, 'high');
  const lowerBandTouch = item.close <= item.bollLower || rollingZScore(candles, index, 20) <= -1.5;
  const lowTrendStrength = item.adx < 20;
  const lowVol = realizedVolatility(candles, index) <= 0.24;
  const liquid = rollingAverage(candles, index, 20, 'volume') >= 300000;
  const obvUp = item.obv >= previous.obv;
  const strongVolume = item.volumeRatio >= 1.15;

  switch (mode) {
    case 'trend':
      return [bullishTrend, macdBullish, item.adx >= 25, strongVolume, item.roc12 > 0, obvUp].filter(Boolean).length;
    case 'range':
      return [lowerBandTouch, item.rsi6 <= 30, item.wr14 <= -80, lowTrendStrength, item.close <= item.ma20, item.volumeRatio <= 1.2].filter(Boolean).length;
    case 'lowVolTrend':
      return [bullishTrend, macdBullish, item.adx >= 22, lowVol, strongVolume, obvUp].filter(Boolean).length;
    case 'highLiquidityBreakout':
      return [liquid, breakout, strongVolume, item.plusDi >= item.minusDi, item.adx >= 20, obvUp].filter(Boolean).length;
    case 'qualityStack':
      return [bullishTrend, macdBullish, balancedRsi, strongVolume, obvUp, item.close >= item.bollMid].filter(Boolean).length;
    case 'balanced':
    default:
      return [item.close >= item.ma20, macdBullish, balancedRsi, strongVolume, item.roc12 >= 0, obvUp].filter(Boolean).length;
  }
};

const buildTradeRules = (definition) => {
  const { evaluator, params } = definition;

  switch (evaluator) {
    case 'maCross':
      return {
        shouldEnter: (item, previous) => {
          const fast = maValue(item, params.fast);
          const slow = maValue(item, params.slow);
          const prevFast = maValue(previous, params.fast);
          const prevSlow = maValue(previous, params.slow);
          return prevFast <= prevSlow && fast > slow && (!params.adxMin || item.adx >= params.adxMin);
        },
        shouldExit: (item, previous) => {
          const fast = maValue(item, params.fast);
          const slow = maValue(item, params.slow);
          const prevFast = maValue(previous, params.fast);
          const prevSlow = maValue(previous, params.slow);
          return prevFast >= prevSlow && fast < slow;
        },
      };
    case 'donchianBreak':
      return {
        shouldEnter: (item, _previous, index, candles) => item.close > rollingHigh(candles, index, params.lookback, 'high') && item.close >= item.ma20,
        shouldExit: (item, _previous, index, candles) => item.close < item.ma20 || item.close < rollingLow(candles, index, Math.max(10, Math.floor(params.lookback / 2)), 'low'),
      };
    case 'maAlignmentPullback':
      return {
        shouldEnter: (item, previous) => item.ma20 > item.ma60 && item.ma60 > item.ma120 && previous.close <= previous.ma20 && item.close > item.ma20 && item.adx >= 20,
        shouldExit: (item, previous) => item.close < item.ma20 || (previous.dif >= previous.dea && item.dif < item.dea),
      };
    case 'macdClassic':
      return {
        shouldEnter: (item, previous) => previous.dif <= previous.dea && item.dif > item.dea,
        shouldExit: (item, previous) => previous.dif >= previous.dea && item.dif < item.dea,
      };
    case 'macdRsiConfirm':
      return {
        shouldEnter: (item, previous) => previous.dif <= previous.dea && item.dif > item.dea && item.rsi12 < params.rsiEntryMax,
        shouldExit: (item, previous) => (previous.dif >= previous.dea && item.dif < item.dea) || item.rsi12 > params.rsiExitMin,
      };
    case 'macdZeroAxis':
      return {
        shouldEnter: (item, previous) => previous.dif <= previous.dea && item.dif > item.dea && item.dif > 0 && item.dea > 0,
        shouldExit: (item, previous) => (previous.dif >= previous.dea && item.dif < item.dea) || item.dif < 0,
      };
    case 'rocTrend':
      return {
        shouldEnter: (item) => item.roc12 >= params.rocMin && item.close >= item.ma20 && item.dif >= item.dea,
        shouldExit: (item) => item.roc12 < 0 || item.close < item.ma20,
      };
    case 'priceMomentum':
      return {
        shouldEnter: (item, _previous, index, candles) => closeMomentum(candles, index, params.lookback) >= params.minMomentum && item.close >= item.ma20,
        shouldExit: (item, _previous, index, candles) => closeMomentum(candles, index, params.lookback) < 0 || item.close < item.ma20,
      };
    case 'kdjTrendFilter':
      return {
        shouldEnter: (item, previous) => previous.k <= previous.d && item.k > item.d && item.close >= item.ma20,
        shouldExit: (item, previous) => previous.k >= previous.d && item.k < item.d || item.close < item.ma10,
      };
    case 'rsi50RegimeShift':
      return {
        shouldEnter: (item, previous) => previous.rsi12 <= 50 && item.rsi12 > 50 && item.close >= item.ma20,
        shouldExit: (item, previous) => previous.rsi12 >= 50 && item.rsi12 < 50,
      };
    case 'bollRevert':
      return {
        shouldEnter: (item) => {
          const sigmaWidth = Math.max((item.bollUpper - item.bollMid) / 2, 0.01);
          const zScore = (item.close - item.bollMid) / sigmaWidth;
          return zScore <= -params.sigma && item.rsi6 <= 35 && item.adx < 22;
        },
        shouldExit: (item) => item.close >= item.bollMid || item.rsi12 >= params.exitRsi,
      };
    case 'rsi2Bounce':
      return {
        shouldEnter: (item) => item.rsi2 <= params.entryMax && item.wr14 <= -85,
        shouldExit: (item) => item.rsi2 >= params.exitMin || item.close >= item.ma5,
      };
    case 'rsiWrRevert':
      return {
        shouldEnter: (item) => item.rsi6 <= params.rsiEntryMax && item.wr14 <= params.wrEntryMax,
        shouldExit: (item) => item.rsi6 >= 55 || item.wr14 >= -30,
      };
    case 'zScoreRevert':
      return {
        shouldEnter: (item, _previous, index, candles) => rollingZScore(candles, index, params.lookback) <= -params.threshold && item.adx < 22,
        shouldExit: (item, _previous, index, candles) => rollingZScore(candles, index, params.lookback) >= -0.1 || item.close >= item.ma20,
      };
    case 'maDeviationRevert':
      return {
        shouldEnter: (item) => item.ma20 > 0 && (item.close - item.ma20) / item.ma20 <= -params.deviationPct && item.adx < 22,
        shouldExit: (item) => item.close >= item.ma20 || item.rsi12 >= 55,
      };
    case 'bollMidlineRecovery':
      return {
        shouldEnter: (item, previous) => previous.close < previous.bollLower && item.close > item.bollLower && item.adx < 24,
        shouldExit: (item) => item.close >= item.bollMid || item.dif < item.dea,
      };
    case 'bollBreakVolume':
      return {
        shouldEnter: (item) => item.close > item.bollUpper && item.volumeRatio >= params.volumeRatioMin,
        shouldExit: (item) => item.close < item.bollMid,
      };
    case 'donchianBreakObv':
      return {
        shouldEnter: (item, previous, index, candles) => item.close > rollingHigh(candles, index, params.lookback, 'high') && item.obv > previous.obv,
        shouldExit: (item, previous) => item.close < item.ma20 || item.obv < previous.obv,
      };
    case 'rangeBreakVolume':
      return {
        shouldEnter: (item, _previous, index, candles) => item.close > rollingHigh(candles, index, params.lookback, 'close') && item.volumeRatio >= params.volumeRatioMin,
        shouldExit: (item) => item.close < item.ma10 || item.dif < item.dea,
      };
    case 'maBreakTurnover':
      return {
        shouldEnter: (item, previous) => previous.close <= previous.ma20 && item.close > item.ma20 && item.volumeRatio >= params.volumeRatioMin,
        shouldExit: (item) => item.close < item.ma20,
      };
    case 'adxRisingBreakout':
      return {
        shouldEnter: (item, previous, index, candles) => item.adx >= params.adxMin && item.adx > previous.adx && item.plusDi >= item.minusDi && item.close > rollingHigh(candles, index, params.breakoutLookback, 'high'),
        shouldExit: (item, previous) => item.close < item.ma20 || (item.adx < previous.adx && item.close < item.ma10),
      };
    case 'priceVolumeConfirm':
      return {
        shouldEnter: (item, previous) => item.close > previous.close && item.volumeRatio >= params.volumeRatioMin && item.close >= item.ma20,
        shouldExit: (item, previous) => (item.close < previous.close && item.volumeRatio >= params.volumeRatioMin) || item.close < item.ma20,
      };
    case 'multiFactor':
      return {
        shouldEnter: (item, previous, index, candles) => buildFactorScore(item, previous, index, candles, params.mode) >= params.entryScore,
        shouldExit: (item, previous, index, candles) => buildFactorScore(item, previous, index, candles, params.mode) <= params.exitScore,
      };
    default:
      return {
        shouldEnter: () => false,
        shouldExit: () => false,
      };
  }
};

const runStrategyDefinition = (definition, candles, capitalWan, stopLossPercent, takeProfitPercent) => {
  const rules = buildTradeRules(definition);
  const rawTrades = runWalkForward(candles, (slice) =>
    simulateTrades(slice, rules.shouldEnter, rules.shouldExit, capitalWan, stopLossPercent, takeProfitPercent),
  );
  const dedupedTrades = Array.from(
    rawTrades.reduce((map, trade) => {
      const key = `${trade.buyDate}|${trade.sellDate}|${Number(trade.buyPrice).toFixed(2)}|${Number(trade.sellPrice).toFixed(2)}`;
      if (!map.has(key)) {
        map.set(key, trade);
      }
      return map;
    }, new Map()).values(),
  );

  return {
    metrics: finalizeMetrics(definition, dedupedTrades),
    rawTrades: dedupedTrades,
  };
};

export const evaluateStrategyVariant = (definition, candles, capitalWan, stopLossPercent, takeProfitPercent) =>
  runStrategyDefinition(definition, candles, capitalWan, stopLossPercent, takeProfitPercent);

export const evaluateCandidateStrategies = (candles, capitalWan, stopLossPercent, takeProfitPercent) =>
  strategyRegistry
    .map((definition) => runStrategyDefinition(definition, candles, capitalWan, stopLossPercent, takeProfitPercent).metrics)
    .sort((left, right) => right.score - left.score);

export const executeStrategyById = (strategyId, candles, capitalWan, stopLossPercent, takeProfitPercent) => {
  const definition = strategyRegistry.find((item) => item.id === strategyId);
  if (!definition) {
    return null;
  }

  const { metrics, rawTrades } = runStrategyDefinition(definition, candles, capitalWan, stopLossPercent, takeProfitPercent);
  return {
    strategy: metrics,
    rawTrades,
    signal: inferSignalFromMetrics(metrics),
  };
};

export const buildTradeRecordsFromRaw = (rawTrades) =>
  rawTrades.map((trade, index) => ({
    id: `${trade.buyDate}-${trade.sellDate}-${index + 1}`,
    buyDate: trade.buyDate,
    buyPrice: Number(trade.buyPrice.toFixed(2)),
    sellDate: trade.sellDate,
    sellPrice: Number(trade.sellPrice.toFixed(2)),
    returnPct: Number(trade.returnPct.toFixed(2)),
    returnAmount: Number(trade.returnAmount.toFixed(2)),
    result: trade.returnPct >= 0 ? 'success' : 'failure',
  }));

export const buildSignalMarkers = (tradeRecords, strategyId) =>
  Array.from(
    tradeRecords
      .flatMap((trade) => [
        { date: trade.buyDate, type: 'buy', price: trade.buyPrice, label: 'B', strategyId },
        { date: trade.sellDate, type: 'sell', price: trade.sellPrice, label: 'S', strategyId },
      ])
      .reduce((map, marker) => {
        const key = `${marker.date}|${marker.type}|${Number(marker.price).toFixed(2)}`;
        if (!map.has(key)) {
          map.set(key, marker);
        }
        return map;
      }, new Map())
      .values(),
  );

export const inferStrategySignal = inferSignalFromMetrics;