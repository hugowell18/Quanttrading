/**
 * 投资组合回测器 — 横截面轮动策略的核心引擎
 *
 * 架构：事件驱动型 (Daily Snapshot)
 * 每个交易日：
 *   1. 对池内所有股票打分 → 排序
 *   2. 检查持仓是否触发退出条件
 *   3. 按 Top-N 填充空余仓位 / 调仓换股
 *   4. 更新组合净值
 *
 * 关键设计：
 *   - 严格 T+1：信号日无法买卖，次日开盘执行
 *   - 涨停/跌停检测
 *   - 双边手续费 + 滑点
 *   - 最大持仓限制（slot management）
 */

const average = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

export class PortfolioBacktester {
  constructor(options = {}) {
    this.initialCash = options.initialCash ?? 1_000_000;
    this.maxPositions = options.maxPositions ?? 5;           // 最多同时持有 N 只
    this.positionSizeMode = options.positionSizeMode ?? 'equal'; // equal | kelly
    this.tradingCost = options.tradingCost ?? 0.003;         // 双边手续费
    this.slippage = options.slippage ?? 0.002;               // 单边滑点
    this.maxHoldingDays = options.maxHoldingDays ?? 20;
    this.stopLossAtrMul = options.stopLossAtrMul ?? 2.0;     // 止损 = 2×ATR
    this.trailingAtrMul = options.trailingAtrMul ?? 1.5;     // 追踪止盈回撤 = 1.5×ATR
    this.minProfitToTrail = options.minProfitToTrail ?? 0.02; // 盈利>2%后启动追踪
    this.hardStopPct = options.hardStopPct ?? 0.08;          // 绝对硬止损 8%
    this.minScoreThreshold = options.minScoreThreshold ?? 0;
    this.rebalanceInterval = options.rebalanceInterval ?? 1;

    // 内部状态
    this.cash = this.initialCash;
    this.positions = new Map(); // code → { buyPrice, buyDate, shares, buyDateIndex, atr, peakPrice }
    this.equityCurve = [];
    this.trades = [];
    this.dailyLog = [];
  }

  /**
   * 运行完整回测
   * @param {string[]} tradeDates - 有序的交易日列表
   * @param {Map} stockDataMap - 股票数据（含 dateMap）
   * @param {Map} perStockModels - 每只股票的模型（predictor + threshold）
   * @param {Object[]} indexRows - 指数数据（用于大盘过滤）
   */
  run(tradeDates, stockDataMap, perStockModels, indexRows = null) {
    // 构建指数 dateMap
    const indexMap = new Map();
    if (indexRows) {
      for (const r of indexRows) indexMap.set(r.date, r);
    }

    // 记录挂单（T日产生信号 → T+1日执行）
    let pendingBuys = [];  // [{ code, score, confidence }]
    let pendingSells = []; // [{ code, reason }]

    for (let dayIdx = 0; dayIdx < tradeDates.length; dayIdx += 1) {
      const date = tradeDates[dayIdx];
      const prevDate = dayIdx > 0 ? tradeDates[dayIdx - 1] : null;

      // ── 1. 执行昨日挂单（T+1 开盘执行）──
      this._executePendingBuys(pendingBuys, date, stockDataMap, prevDate);
      this._executePendingSells(pendingSells, date, stockDataMap, prevDate);
      pendingBuys = [];
      pendingSells = [];

      // ── 2. 检查持仓退出条件 ──
      for (const [code, pos] of this.positions) {
        const row = stockDataMap.get(code)?.dateMap.get(date);
        if (!row) continue;

        const holdDays = dayIdx - pos.buyDateIndex;
        const currentReturn = (row.close - pos.buyPrice) / pos.buyPrice;

        // 更新峰值价格（用于追踪止盈）
        if (row.close > pos.peakPrice) pos.peakPrice = row.close;

        // ATR 自适应止损线
        const atrStop = pos.atr > 0
          ? (pos.buyPrice - this.stopLossAtrMul * pos.atr) / pos.buyPrice - 1
          : -this.hardStopPct;
        const stopLine = Math.max(atrStop, -this.hardStopPct); // 不超过硬止损

        let exitReason = null;

        // ATR 止损
        if (currentReturn <= stopLine) {
          exitReason = 'stopLoss';
        }
        // 追踪止盈：盈利超过阈值后，从峰值回撤超过 trailingAtrMul×ATR 就卖
        else if (currentReturn >= this.minProfitToTrail && pos.atr > 0) {
          const drawdownFromPeak = (pos.peakPrice - row.close) / pos.peakPrice;
          const trailStop = this.trailingAtrMul * pos.atr / pos.peakPrice;
          if (drawdownFromPeak >= trailStop) {
            exitReason = 'trailingStop';
          }
        }
        // 超时
        else if (holdDays >= this.maxHoldingDays) {
          exitReason = 'timeout';
        }

        if (exitReason) {
          pendingSells.push({ code, reason: exitReason });
        }
      }

      // ── 3. 每 N 天扫描一次，产生新信号 ──
      if (dayIdx % this.rebalanceInterval === 0) {
        // 大盘过滤
        const idxRow = indexMap.get(date);
        const marketOk = !idxRow || !Number.isFinite(idxRow.ma20) || idxRow.close >= idxRow.ma20;

        if (marketOk) {
          const candidates = this._scoreAllStocks(date, stockDataMap, perStockModels);

          // 可用仓位 = 最大仓位 - 当前持仓 - 挂单卖出后释放的仓位
          const slotsAfterSells = this.maxPositions - this.positions.size + pendingSells.length;
          const availableSlots = Math.max(0, slotsAfterSells - pendingBuys.length);

          // 取 Top-N（排除已持仓和已挂单的）
          const heldCodes = new Set([...this.positions.keys(), ...pendingBuys.map((b) => b.code)]);
          const topN = candidates
            .filter((c) => !heldCodes.has(c.code) && c.score >= c.threshold)
            .slice(0, availableSlots);

          pendingBuys.push(...topN);
        }
      }

      // ── 4. 计算组合净值 ──
      let positionValue = 0;
      for (const [code, pos] of this.positions) {
        const row = stockDataMap.get(code)?.dateMap.get(date);
        const price = row?.close ?? pos.buyPrice;
        positionValue += price * pos.shares;
      }
      const totalEquity = this.cash + positionValue;
      this.equityCurve.push({ date, equity: totalEquity, cash: this.cash, positionCount: this.positions.size });
    }

    return this._buildReport();
  }

  // ── 执行买入挂单 ──
  _executePendingBuys(pendingBuys, date, stockDataMap, prevDate) {
    for (const buy of pendingBuys) {
      const dataEntry = stockDataMap.get(buy.code);
      if (!dataEntry) continue;
      const row = dataEntry.dateMap.get(date);
      if (!row) continue;

      // 涨停检测
      const prevRow = prevDate ? dataEntry.dateMap.get(prevDate) : null;
      if (prevRow && prevRow.close > 0 && row.open >= prevRow.close * 1.098) {
        continue; // 一字涨停，无法买入
      }

      // 已满仓
      if (this.positions.size >= this.maxPositions) continue;

      const buyPrice = row.open * (1 + this.slippage);
      const slotCash = this.cash / Math.max(1, this.maxPositions - this.positions.size);
      const maxInvest = Math.min(slotCash, this.cash * 0.95); // 保留5%现金
      const shares = Math.floor(maxInvest / buyPrice / 100) * 100; // A股100股整数倍
      if (shares < 100) continue;

      const cost = buyPrice * shares;
      this.cash -= cost;

      // 找到 dayIdx
      const dayIdx = this.equityCurve.length; // 近似

      this.positions.set(buy.code, {
        buyPrice,
        buyDate: date,
        shares,
        buyDateIndex: dayIdx,
        score: buy.score,
        atr: buy.atr ?? 0,       // ATR at entry for adaptive stops
        peakPrice: buyPrice,      // track peak for trailing stop
      });
    }
  }

  // ── 执行卖出挂单 ──
  _executePendingSells(pendingSells, date, stockDataMap, prevDate) {
    for (const sell of pendingSells) {
      const pos = this.positions.get(sell.code);
      if (!pos) continue;

      const dataEntry = stockDataMap.get(sell.code);
      if (!dataEntry) continue;
      const row = dataEntry.dateMap.get(date);
      if (!row) continue;

      // 跌停检测
      const prevRow = prevDate ? dataEntry.dateMap.get(prevDate) : null;
      if (prevRow && prevRow.close > 0 && row.open <= prevRow.close * 0.902) {
        continue; // 跌停无法卖出，延迟到下一天
      }

      const sellPrice = row.open * (1 - this.slippage);
      const proceeds = sellPrice * pos.shares;
      const grossReturn = (sellPrice - pos.buyPrice) / pos.buyPrice;
      const netReturn = grossReturn - this.tradingCost;

      this.cash += proceeds;
      this.positions.delete(sell.code);

      this.trades.push({
        code: sell.code,
        buyDate: pos.buyDate,
        sellDate: date,
        buyPrice: Number(pos.buyPrice.toFixed(4)),
        sellPrice: Number(sellPrice.toFixed(4)),
        shares: pos.shares,
        return: Number(netReturn.toFixed(4)),
        holdingDays: this.equityCurve.length - pos.buyDateIndex,
        exitReason: sell.reason,
      });
    }
  }

  // ── 给所有股票打分并排序 ──
  _scoreAllStocks(date, stockDataMap, perStockModels) {
    const candidates = [];

    for (const [code, model] of perStockModels) {
      const dataEntry = stockDataMap.get(code);
      if (!dataEntry) continue;
      const row = dataEntry.dateMap.get(date);
      if (!row) continue;

      // 使用 predictor 打分
      try {
        const scores = model.predictor.scoreRows([row]);
        const score = scores[0] ?? 0;
        candidates.push({
          code,
          score,
          threshold: model.threshold,
          precision: model.precision,
          regime: model.regime,
        });
      } catch {
        // skip
      }
    }

    // 按分数降序排列
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  // ── 生成回测报告 ──
  _buildReport() {
    const returns = this.trades.map((t) => t.return);
    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r <= 0);

    // 组合级 Sharpe（基于日收益率）
    const dailyReturns = [];
    for (let i = 1; i < this.equityCurve.length; i += 1) {
      const prev = this.equityCurve[i - 1].equity;
      const curr = this.equityCurve[i].equity;
      dailyReturns.push((curr - prev) / prev);
    }
    const avgDaily = average(dailyReturns);
    const stdDaily = dailyReturns.length > 1
      ? Math.sqrt(average(dailyReturns.map((r) => (r - avgDaily) ** 2)))
      : 0;
    const annualizedSharpe = stdDaily > 0 ? (avgDaily / stdDaily) * Math.sqrt(252) : 0;

    // 最大回撤
    let peak = this.initialCash;
    let maxDrawdown = 0;
    for (const { equity } of this.equityCurve) {
      peak = Math.max(peak, equity);
      const dd = (equity - peak) / peak;
      maxDrawdown = Math.min(maxDrawdown, dd);
    }

    // 总收益
    const finalEquity = this.equityCurve.length
      ? this.equityCurve[this.equityCurve.length - 1].equity
      : this.initialCash;
    const totalReturn = (finalEquity - this.initialCash) / this.initialCash;

    // 年化收益率
    const years = this.equityCurve.length / 252;
    const annualizedReturn = years > 0 ? (finalEquity / this.initialCash) ** (1 / years) - 1 : 0;

    // Profit Factor
    const grossProfit = wins.reduce((s, v) => s + v, 0);
    const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);

    return {
      // 组合级指标
      initialCash: this.initialCash,
      finalEquity: Number(finalEquity.toFixed(2)),
      totalReturn: Number(totalReturn.toFixed(4)),
      annualizedReturn: Number(annualizedReturn.toFixed(4)),
      annualizedSharpe: Number(annualizedSharpe.toFixed(4)),
      maxDrawdown: Number(maxDrawdown.toFixed(4)),
      // 交易级指标
      totalTrades: this.trades.length,
      winRate: this.trades.length ? Number((wins.length / this.trades.length).toFixed(4)) : 0,
      avgReturn: Number(average(returns).toFixed(4)),
      avgWin: Number(average(wins).toFixed(4)),
      avgLoss: Number((losses.length ? Math.abs(average(losses)) : 0).toFixed(4)),
      profitFactor: Number(profitFactor.toFixed(4)),
      avgHoldingDays: Number(average(this.trades.map((t) => t.holdingDays)).toFixed(1)),
      stopLossRate: this.trades.length
        ? Number((this.trades.filter((t) => t.exitReason === 'stopLoss').length / this.trades.length).toFixed(4))
        : 0,
      trailingStopRate: this.trades.length
        ? Number((this.trades.filter((t) => t.exitReason === 'trailingStop').length / this.trades.length).toFixed(4))
        : 0,
      // 详细数据
      trades: this.trades,
      equityCurve: this.equityCurve,
      // 年度明细
      yearlyBreakdown: this._yearlyBreakdown(),
    };
  }

  _yearlyBreakdown() {
    const years = new Map();
    for (const trade of this.trades) {
      const year = trade.buyDate.slice(0, 4);
      if (!years.has(year)) years.set(year, []);
      years.get(year).push(trade);
    }
    const result = [];
    for (const [year, trades] of years) {
      const rets = trades.map((t) => t.return);
      const wins = rets.filter((r) => r > 0);
      result.push({
        year,
        trades: trades.length,
        winRate: Number((wins.length / trades.length).toFixed(4)),
        avgReturn: Number(average(rets).toFixed(4)),
        totalReturn: Number(rets.reduce((s, v) => s + (1 + v), 1).toFixed(4)),
      });
    }
    return result.sort((a, b) => a.year.localeCompare(b.year));
  }
}
