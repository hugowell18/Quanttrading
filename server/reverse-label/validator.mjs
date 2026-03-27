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
    this.trainSize = options.trainSize ?? 120;     // 缩短训练窗口，适应更频繁的信号
    this.testSize = options.testSize ?? 40;        // 缩短测试窗口
    this.forwardDays = options.forwardDays ?? 10;
    this.purgeGap = options.purgeGap ?? this.forwardDays;
    this.stopLoss = options.stopLoss ?? 0.05;
    this.maxHoldingDays = options.maxHoldingDays ?? 15; // 缩短默认持仓，配合 forwardDays=10
    this.minConfidence = options.minConfidence ?? 0.5;
    this.envFilter = options.envFilter ?? 'ma20';
    this.indexRows = options.indexRows ?? null;
    // 短线策略统一按双边 0.7% 成本计，默认不再叠加额外滑点
    this.tradingCost = options.tradingCost ?? 0.007;
    this.slippage = options.slippage ?? 0;
    this.trailingStopMultiplier = options.trailingStopMultiplier ?? 1.5;
    this.featurePool = options.featurePool ?? null;
    this.modelPref = options.modelPref ?? null;
    this.regime = options.regime ?? null;
    // 方案 A/B/C 传 'target'；方案 D 当前由 optimizer 传 'tiered' 作为追踪止盈开关
    this.takeProfitStyle = options.takeProfitStyle ?? 'target';
    this.targetProfitPct = options.targetProfitPct ?? 0.06;
    this.bollUpperExit = options.bollUpperExit ?? false;
    // 方向3：指标阈值门槛
    this.indicatorGate = options.indicatorGate ?? {
      rsiOverbought: 80,
      rsiOversold: 15,
      jOverbought: 95,
    };
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
    let skippedByGapUp = 0;
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
        // 方向1：弱势 regime 下提高置信度门槛，减少低质量入场
        const regimeMinConf = (this.regime === 'downtrend' || this.regime === 'high_vol')
          ? Math.max(this.minConfidence, 0.6)  // 弱势环境要求更高置信度
          : this.minConfidence;
        if (!isRawSignal || confidence < regimeMinConf) {
          if (isRawSignal) {
            skippedSignals += 1;
          }
          index += 1;
          continue;
        }

        // T+1 实盘模拟：信号日 index（T日收盘后出信号），T+1日开盘买入
        const signalIndex = index;
        const buyIndex = index + 1; // T+1: 次日开盘买入
        if (buyIndex >= testRows.length) {
          break;
        }
        const buyRow = testRows[buyIndex];

        const prevClose = testRows[signalIndex]?.close ?? 0; // 信号日收盘 = 买入日前一天
        if (prevClose > 0 && buyRow.open >= prevClose * 1.01) {
          skippedByGapUp += 1;
        }

        // 方向3：技术指标门槛过滤 — 超买区拒绝入场，降低 stopLossRate
        const gate = this.indicatorGate;
        if (gate) {
          const rsi6 = buyRow.rsi6 ?? 50;
          const jVal = buyRow.j ?? 50;
          if (rsi6 > gate.rsiOverbought || jVal > gate.jOverbought) {
            skippedByEnvironment += 1;
            index += 1;
            continue;
          }
        }

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
        // T+1 实盘：买入价 = 当日开盘价 + 滑点
        const actualBuyPrice = buyRow.open * (1 + this.slippage);
        const stopLossPct = this.stopLoss ?? 0.025;
        let exitIndex = Math.min(testRows.length - 1, buyIndex + this.maxHoldingDays);
        let exitReason = 'timeout';
        let bestNetReturn = -Infinity;
        const trailingEnabled = this.takeProfitStyle === 'tiered';

        for (let cursor = buyIndex + 1; cursor <= Math.min(testRows.length - 1, buyIndex + this.maxHoldingDays); cursor += 1) {
          const candidateRow = testRows[cursor];
          const grossReturn = (candidateRow.close - actualBuyPrice) / actualBuyPrice;
          const netReturn = grossReturn - this.tradingCost;
          bestNetReturn = Math.max(bestNetReturn, netReturn);

          // 1. 止损出场
          if (netReturn <= -stopLossPct) {
            exitIndex = cursor;
            exitReason = 'stopLoss';
            stopLossHits += 1;
            break;
          }

          // 2. 止盈出场
          if (netReturn >= this.targetProfitPct) {
            exitIndex = cursor;
            exitReason = 'takeProfit';
            break;
          }

          // 3. 追踪止盈出场：仅方案 D 启用
          if (trailingEnabled && bestNetReturn >= 0.03 && (bestNetReturn - netReturn) >= 0.015) {
            exitIndex = cursor;
            exitReason = 'trailingStop';
            break;
          }

          // 4. 卖点信号出场
          if (candidateRow.isSellPoint === 1) {
            exitIndex = cursor;
            exitReason = 'sellSignal';
            break;
          }
        }

        // T+1 卖出：退出信号在 exitIndex 日触发，实际卖出在 exitIndex+1 日开盘
        const sellDayIndex = Math.min(exitIndex + 1, testRows.length - 1);
        const sellRow = testRows[sellDayIndex];
        // 跌停检测：如果卖出日开盘价 <= 前日收盘×0.902，跌停无法卖出，顺延
        const exitDayClose = testRows[exitIndex]?.close ?? 0;
        const limitDownPrice = exitDayClose * 0.902;
        let actualSellDayIndex = sellDayIndex;
        if (exitDayClose > 0 && sellRow.open <= limitDownPrice && sellDayIndex + 1 < testRows.length) {
          // 跌停无法卖出，顺延到下一个交易日
          actualSellDayIndex = sellDayIndex + 1;
        }
        const actualSellRow = testRows[actualSellDayIndex];
        const actualSellPrice = actualSellRow.open * (1 - this.slippage);
        const netReturn = ((actualSellPrice - actualBuyPrice) / actualBuyPrice) - this.tradingCost;
        const trade = {
          buyDate: buyRow.date,
          sellDate: actualSellRow.date,
          buyPrice: Number(actualBuyPrice.toFixed(4)),
          sellPrice: Number(actualSellPrice.toFixed(4)),
          return: Number(netReturn.toFixed(4)),
          holdingDays: actualSellDayIndex - buyIndex,
          confidence: Number(confidence.toFixed(4)),
          stopLossPct: Number(stopLossPct.toFixed(4)),
          exitReason,
        };
        allTrades.push(trade);
        windowTrades.push(trade);
        index = actualSellDayIndex + 1;
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
    const exitReasonBreakdown = (() => {
      const total = allTrades.length || 1;
      const counts = allTrades.reduce((acc, trade) => {
        acc[trade.exitReason] = (acc[trade.exitReason] ?? 0) + 1;
        return acc;
      }, {});
      return Object.fromEntries(
        Object.entries(counts).map(([reason, count]) => [
          reason,
          { count, ratio: Number((count / total).toFixed(4)) },
        ]),
      );
    })();

    // 建议5：计算 avgWin / avgLoss / profitFactor
    const wins = returns.filter((v) => v > 0);
    const losses = returns.filter((v) => v <= 0);
    const avgWin = wins.length ? average(wins) : 0;
    const avgLoss = losses.length ? Math.abs(average(losses)) : 0;
    const grossProfit = wins.reduce((s, v) => s + v, 0);
    const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
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
      skippedByGapUp,
      skippedByEnvironment,
      skippedByMarket,
      trailingStopRate: allTrades.length ? Number((trailingStopHits / allTrades.length).toFixed(4)) : 0,
      avgWin: Number(avgWin.toFixed(4)),
      avgLoss: Number(avgLoss.toFixed(4)),
      profitFactor: Number(profitFactor.toFixed(4)),
      bestWindowReturn: windowStats.length ? Number(Math.max(...windowStats.map((item) => item.avgReturn)).toFixed(4)) : 0,
      worstWindowReturn: windowStats.length ? Number(Math.min(...windowStats.map((item) => item.avgReturn)).toFixed(4)) : 0,
      exitReasonBreakdown,
      diagnosis: diagnostics,
      windowStats,
      trades: allTrades,
    };
  }
}
