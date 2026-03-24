import { ModelSelector } from './model-selector.mjs';

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const standardDeviation = (values) => {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class WalkForwardValidator {
  constructor(rows, options = {}) {
    this.rows = rows;
    this.trainSize = options.trainSize ?? 180;
    this.testSize = options.testSize ?? 60;
    this.forwardDays = options.forwardDays ?? 20;
    this.purgeGap = options.purgeGap ?? this.forwardDays;
    this.stopLoss = options.stopLoss ?? 0.04;
    this.maxHoldingDays = options.maxHoldingDays ?? 40;
    this.minConfidence = options.minConfidence ?? 0.5;
    this.envFilter = options.envFilter ?? 'ma20';
    this.indexRows = options.indexRows ?? null;
    this.tradingCost = options.tradingCost ?? 0.0013;
    this.trailingStopMultiplier = options.trailingStopMultiplier ?? 1.5;
    this.featurePool = options.featurePool ?? null;
    this.modelPref = options.modelPref ?? null;
  }

  _isMa60Rising(rows, currentIndex) {
    if (currentIndex < 5) return false;
    const ma60Now = rows[currentIndex]?.ma60;
    const ma60Prev = rows[currentIndex - 5]?.ma60;
    if (!Number.isFinite(ma60Now) || !Number.isFinite(ma60Prev)) return false;
    return ma60Now > ma60Prev;
  }

  _isMarketEnvironmentOk(row, rows, currentIndex) {
    const ma20 = row?.ma20;
    const ma60 = row?.ma60;

    switch (this.envFilter) {
      case 'none':
        return true;
      case 'ma20':
        if (!Number.isFinite(ma20)) return true;
        return row.close >= ma20;
      case 'ma20_0.98':
        if (!Number.isFinite(ma20)) return true;
        return row.close >= ma20 * 0.98;
      case 'ma60_rising':
        if (!Number.isFinite(ma60)) return true;
        return row.close >= ma60 && this._isMa60Rising(rows, currentIndex);
      case 'ma20_or_ma60_rising': {
        if (!Number.isFinite(ma20)) return true;
        const nearMa20 = row.close >= ma20 * 0.98;
        const aboveMa60Rising = Number.isFinite(ma60) && row.close >= ma60 && this._isMa60Rising(rows, currentIndex);
        return nearMa20 || aboveMa60Rising;
      }
      default:
        return true;
    }
  }

  _isBroadMarketOk(date) {
    if (!this.indexRows || !this.indexRows.length) return true;
    const idxRow = this.indexRows.find((row) => row.date === date);
    if (!idxRow) return true;
    const ma20 = idxRow.ma20 ?? null;
    if (!Number.isFinite(ma20)) return true;
    return idxRow.close >= ma20;
  }

  validate(bestModel) {
    const rows = this.rows;
    const allTrades = [];
    const windowStats = [];
    let totalRawSignals = 0;
    let skippedSignals = 0;
    let skippedByEnvironment = 0;
    let skippedByMarket = 0;
    let stopLossHits = 0;
    let start = this.trainSize;

    while (start + this.testSize <= rows.length) {
      const rawTrainStart = Math.max(0, start - this.trainSize);
      const rawTrainEnd = start;
      const trainEnd = Math.max(rawTrainStart, rawTrainEnd - this.purgeGap);
      const trainRows = rows.slice(rawTrainStart, trainEnd);
      const testRows = rows.slice(start, start + this.testSize);
      if (trainRows.length < 60 || testRows.length < 10) {
        start += this.testSize;
        continue;
      }
      const selector = new ModelSelector(trainRows);
      const ranked = selector.run({
        featurePool: this.featurePool,
        modelPref: this.modelPref,
      });
      const matched = ranked.find((item) => item.featureSet === bestModel.featureSet && item.model === bestModel.model) ?? ranked[0];
      if (!matched?.predictor) {
        start += this.testSize;
        continue;
      }

      const scores = matched.predictor.scoreRows(testRows);
      const threshold = matched.predictor.threshold ?? 0;
      const scoreStd = standardDeviation(scores) || 1;
      const scoreMean = average(scores);
      const windowTrades = [];
      let index = 0;

      while (index < testRows.length - 1) {
        const score = scores[index] ?? 0;
        const isRawSignal = score >= threshold;
        if (isRawSignal) {
          totalRawSignals += 1;
        }

        // 改进置信度：基于分数超出阈值的标准差倍数，区分度更高
        // 原公式(0.5 + delta/2std)几乎总是在0.5附近，改为sigmoid-like映射
        const delta = score - threshold;
        const normalizedDelta = scoreStd > 0 ? delta / scoreStd : 0;
        const confidence = clamp(0.5 + normalizedDelta * 0.25, 0, 1);
        if (!isRawSignal || confidence < this.minConfidence) {
          if (isRawSignal) {
            skippedSignals += 1;
          }
          index += 1;
          continue;
        }

        const buyIndex = index + 1;
        if (buyIndex >= testRows.length) {
          break;
        }
        const buyRow = testRows[buyIndex];
        if (!this._isMarketEnvironmentOk(buyRow, testRows, buyIndex)) {
          skippedByEnvironment += 1;
          index += 1;
          continue;
        }
        if (!this._isBroadMarketOk(buyRow.date)) {
          skippedByMarket += 1;
          index += 1;
          continue;
        }
        const atr14 = buyRow.atr14 ?? null;
        const dynamicStopLossPct = Number.isFinite(atr14) && buyRow.close > 0
          ? Math.max(0.02, Math.min(0.06, (1.5 * atr14) / buyRow.close))
          : (this.stopLoss ?? 0.04);
        let exitIndex = Math.min(testRows.length - 1, buyIndex + this.maxHoldingDays);
        let exitReason = 'timeout';
        // 追踪止损：记录持仓期间最高价，从最高价回撤超过一定幅度则止损锁利
        let highWatermark = buyRow.close;
        const trailingStopPct = dynamicStopLossPct * this.trailingStopMultiplier;

        for (let cursor = buyIndex + 1; cursor <= Math.min(testRows.length - 1, buyIndex + this.maxHoldingDays); cursor += 1) {
          const candidateRow = testRows[cursor];
          if (candidateRow.high > highWatermark) {
            highWatermark = candidateRow.high;
          }
          const grossReturn = (candidateRow.close - buyRow.close) / buyRow.close;
          const netReturn = grossReturn - this.tradingCost;
          if (netReturn <= -dynamicStopLossPct) {
            exitIndex = cursor;
            exitReason = 'stopLoss';
            stopLossHits += 1;
            break;
          }
          // 追踪止损：盈利超2%后激活，从高点回撤超trailingStopPct则锁利退出
          const retraceFromHigh = (highWatermark - candidateRow.close) / highWatermark;
          const profitProtectActive = highWatermark > buyRow.close * 1.02;
          if (profitProtectActive && retraceFromHigh >= trailingStopPct) {
            exitIndex = cursor;
            exitReason = 'trailingStop';
            break;
          }
          if (candidateRow.isSellPoint === 1) {
            exitIndex = cursor;
            exitReason = 'sellSignal';
            break;
          }
        }

        const sellRow = testRows[exitIndex];
        const netReturn = ((sellRow.close - buyRow.close) / buyRow.close) - this.tradingCost;
        const trade = {
          buyDate: buyRow.date,
          sellDate: sellRow.date,
          buyPrice: buyRow.close,
          sellPrice: sellRow.close,
          return: Number(netReturn.toFixed(4)),
          holdingDays: exitIndex - buyIndex,
          confidence: Number(confidence.toFixed(4)),
          stopLossPct: Number(dynamicStopLossPct.toFixed(4)),
          exitReason,
        };
        allTrades.push(trade);
        windowTrades.push(trade);
        index = exitIndex + 1;
      }

      if (windowTrades.length) {
        const windowReturns = windowTrades.map((trade) => trade.return);
        windowStats.push({
          periodStart: testRows[0].date,
          periodEnd: testRows[testRows.length - 1].date,
          trades: windowTrades.length,
          winRate: Number((windowReturns.filter((value) => value > 0).length / windowTrades.length).toFixed(4)),
          avgReturn: Number(average(windowReturns).toFixed(4)),
        });
      }

      start += this.testSize;
    }

    const returns = allTrades.map((trade) => trade.return);
    const holdingDays = allTrades.map((trade) => trade.holdingDays);
    const trailingStopHits = allTrades.filter((trade) => trade.exitReason === 'trailingStop').length;
    const equityCurve = [];
    let equity = 1;
    returns.forEach((value) => {
      equity *= 1 + value;
      equityCurve.push(equity);
    });
    let peak = 1;
    let maxDrawdown = 0;
    equityCurve.forEach((value) => {
      peak = Math.max(peak, value);
      maxDrawdown = Math.min(maxDrawdown, (value - peak) / peak);
    });

    const buyPointRate = rows.length ? rows.filter((row) => row.isBuyPoint === 1).length / rows.length : 0;
    const diagnostics = {
      labelQuality: `buyPoints=${rows.filter((row) => row.isBuyPoint === 1).length}, sellPoints=${rows.filter((row) => row.isSellPoint === 1).length}`,
      featureLeakage: `bestModel=${bestModel.featureSet}/${bestModel.model}, precision=${bestModel.precision}`,
      sampleBalance: `buyPointRate=${buyPointRate.toFixed(4)}`,
    };

    return {
      totalTrades: allTrades.length,
      winRate: allTrades.length ? Number((returns.filter((value) => value > 0).length / allTrades.length).toFixed(4)) : 0,
      avgReturn: Number(average(returns).toFixed(4)),
      totalReturn: Number((equity - 1).toFixed(4)),
      maxDrawdown: Number(maxDrawdown.toFixed(4)),
      sharpe: Number((standardDeviation(returns) === 0 ? 0 : (average(returns) / standardDeviation(returns)) * Math.sqrt(252)).toFixed(4)),
      avgHoldingDays: Number(average(holdingDays).toFixed(2)),
      avgStopLossPct: allTrades.length ? Number(average(allTrades.map((trade) => trade.stopLossPct ?? (this.stopLoss ?? 0.04))).toFixed(4)) : 0,
      stopLossRate: allTrades.length ? Number((stopLossHits / allTrades.length).toFixed(4)) : 0,
      signalSkipRate: totalRawSignals ? Number((skippedSignals / totalRawSignals).toFixed(4)) : 0,
      skippedByEnvironment,
      skippedByMarket,
      trailingStopRate: allTrades.length ? Number((trailingStopHits / allTrades.length).toFixed(4)) : 0,
      bestWindowReturn: windowStats.length ? Number(Math.max(...windowStats.map((item) => item.avgReturn)).toFixed(4)) : 0,
      worstWindowReturn: windowStats.length ? Number(Math.min(...windowStats.map((item) => item.avgReturn)).toFixed(4)) : 0,
      diagnosis: diagnostics,
      windowStats,
      trades: allTrades,
    };
  }
}
