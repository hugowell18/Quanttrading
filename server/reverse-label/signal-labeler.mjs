export class SignalLabeler {
  constructor(rows, options = {}) {
    this.rows = rows.map((row) => ({ ...row }));
    this.forwardDays = options.forwardDays ?? 10;       // 缩短持仓周期，增加交易频率
    this.minReturn = options.minReturn ?? 0.04;          // T+1 open 买入后的最低收益要求（从8%降到4%）
    this.maxDrawdown = options.maxDrawdown ?? 0.05;      // 稍放宽回撤容忍（从4%→5%，因为open买入天然劣势）
    this.zoneForward = options.zoneForward ?? 10;
    this.zoneBackward = options.zoneBackward ?? 3;
    this.minZoneCapture = options.minZoneCapture ?? 0.7;
    this.sellZoneForward = options.sellZoneForward ?? 3;
    this.sellZoneBackward = options.sellZoneBackward ?? 5;
    this.useT1Open = options.useT1Open ?? true;          // 核心修复：用T+1 open作为买入基准
  }

  buildWaveCandidates() {
    const candidates = [];
    for (let buyIndex = 0; buyIndex < this.rows.length - this.forwardDays - 1; buyIndex += 1) {
      const signalRow = this.rows[buyIndex]; // T日：信号产生日
      // 核心修复：买入价 = T+1 日开盘价（模拟实盘 T+1 执行）
      const executionRow = this.rows[buyIndex + 1];
      if (!executionRow) continue;
      const buyPrice = this.useT1Open ? executionRow.open : signalRow.close;
      if (!buyPrice || buyPrice <= 0) continue;

      // 涨停检测：如果T+1开盘价 >= 信号日收盘×1.098，一字涨停买不进
      if (this.useT1Open && signalRow.close > 0 && executionRow.open >= signalRow.close * 1.098) continue;

      // 从 T+1 之后开始寻找卖出点
      const searchStart = buyIndex + 2; // T+2 起才可能卖出（T+1买入当天不能卖）
      const searchEnd = Math.min(buyIndex + 1 + this.forwardDays, this.rows.length);
      const futureSlice = this.rows.slice(searchStart, searchEnd);
      if (!futureSlice.length) continue;

      let bestSellOffset = -1;
      let bestReturn = -Infinity;
      let drawdownBeforePeak = 0;

      futureSlice.forEach((futureRow, offset) => {
        // 用 T+1 open 计算收益（对齐实盘执行价）
        const candidateReturn = (futureRow.high - buyPrice) / buyPrice;
        if (candidateReturn <= bestReturn) return;

        const sliceToPeak = futureSlice.slice(0, offset + 1);
        const localMin = Math.min(...sliceToPeak.map((row) => row.low), executionRow.low);
        const localDrawdown = (buyPrice - localMin) / buyPrice;
        bestReturn = candidateReturn;
        bestSellOffset = offset;
        drawdownBeforePeak = localDrawdown;
      });

      if (bestSellOffset === -1) continue;

      const sellIndex = searchStart + bestSellOffset;
      const sellRow = this.rows[sellIndex];
      // 卖出也用 open 模拟（次日开盘卖出）
      const sellPrice = (sellIndex + 1 < this.rows.length)
        ? this.rows[sellIndex + 1].open
        : sellRow.close;
      const realizedReturn = (sellPrice - buyPrice) / buyPrice;

      if (bestReturn < this.minReturn || drawdownBeforePeak > this.maxDrawdown) continue;

      candidates.push({
        buyIndex,      // 信号日 index（标记为 isBuyPoint 的日期）
        sellIndex,
        buyDate: signalRow.date,
        sellDate: sellRow.date,
        buyPrice: Number(buyPrice.toFixed(4)),
        sellPrice: Number(sellPrice.toFixed(4)),
        labelSellPriceHigh: sellRow.high,
        maxReturn: Number(bestReturn.toFixed(4)),
        return: Number(realizedReturn.toFixed(4)),
        drawdownBeforePeak: Number(drawdownBeforePeak.toFixed(4)),
        holdingDays: sellIndex - buyIndex,
      });
    }

    return candidates;
  }

  selectNonOverlappingPairs() {
    const candidates = this.buildWaveCandidates().sort((a, b) => {
      if (b.maxReturn !== a.maxReturn) return b.maxReturn - a.maxReturn;
      if (a.buyIndex !== b.buyIndex) return a.buyIndex - b.buyIndex;
      return a.sellIndex - b.sellIndex;
    });

    const chosen = [];
    for (const candidate of candidates) {
      const overlaps = chosen.some((item) => !(candidate.sellIndex < item.buyIndex || candidate.buyIndex > item.sellIndex));
      if (!overlaps) chosen.push(candidate);
    }

    return chosen.sort((a, b) => a.buyIndex - b.buyIndex).map((item, index) => ({
      ...item,
      tradeGroupId: `wave-${String(index + 1).padStart(3, '0')}`,
      success: item.return > 0,
    }));
  }

  _avgVolume(idx, days = 10) {
    const start = Math.max(0, idx - days);
    const slice = this.rows.slice(start, idx);
    if (!slice.length) return 0;
    return slice.reduce((sum, row) => sum + (row.volume ?? 0), 0) / slice.length;
  }

  _isLearnable(idx) {
    const row = this.rows[idx];
    const pctChg = row.pct_chg ?? row.pctChg ?? null;
    if (pctChg !== null && pctChg >= 9.5) return false;

    const avgVol = this._avgVolume(idx);
    if (avgVol > 0 && (row.volume ?? 0) < avgVol * 0.3) return false;

    if (pctChg !== null && pctChg <= -3.0) return false;

    if (idx >= 5) {
      const recentDays = this.rows.slice(idx - 5, idx);
      const allDown = recentDays.every((item) => {
        const dayChange = item.pct_chg ?? item.pctChg ?? ((item.open ?? 0) === 0 ? 0 : ((item.close - item.open) / item.open) * 100);
        return dayChange < 0;
      });
      if (allDown) return false;
    }

    if (idx >= 3) {
      const vol3 = this.rows.slice(idx - 3, idx).map((item) => item.volume ?? 0);
      const isDecreasing = vol3.length === 3 && vol3[0] > vol3[1] && vol3[1] > vol3[2];
      if (isDecreasing && (row.volume ?? 0) < vol3[2]) return false;
    }

    return true;
  }

  _expandWaveToZone(pair) {
    const { buyIndex, sellIndex, buyPrice, maxReturn } = pair;
    const waveHigh = this.rows[sellIndex].high;
    const buyZone = new Set();
    const sellZone = new Set();

    const buyStart = Math.max(0, buyIndex - this.zoneForward);
    const buyEnd = Math.min(this.rows.length - 2, buyIndex + this.zoneBackward);
    for (let index = buyStart; index <= buyEnd; index += 1) {
      // 核心：zone 内每个候选点也以 T+1 open 为买入价
      const nextRow = this.rows[index + 1];
      if (!nextRow) continue;
      const entryPrice = this.useT1Open ? nextRow.open : this.rows[index].close;
      if (!entryPrice || entryPrice <= 0) continue;
      // 涨停检测
      if (this.useT1Open && this.rows[index].close > 0 && nextRow.open >= this.rows[index].close * 1.098) continue;
      const captureReturn = (waveHigh - entryPrice) / entryPrice;
      if (captureReturn < maxReturn * this.minZoneCapture) continue;
      if (!this._isLearnable(index)) continue;
      buyZone.add(index);
    }

    const sellStart = Math.max(0, sellIndex - this.sellZoneForward);
    const sellEnd = Math.min(this.rows.length - 1, sellIndex + this.sellZoneBackward);
    for (let index = sellStart; index <= sellEnd; index += 1) {
      const exitPrice = this.rows[index].close;
      if (exitPrice < buyPrice * (1 + this.minReturn * 0.6)) continue;
      sellZone.add(index);
    }

    return { buyZone, sellZone };
  }

  getLabeledRows() {
    const pairs = this.selectNonOverlappingPairs();
    const buyPointMap = new Map();
    const sellPointMap = new Map();

    for (const pair of pairs) {
      const { buyZone, sellZone } = this._expandWaveToZone(pair);

      for (const index of buyZone) {
        if (!buyPointMap.has(index) || buyPointMap.get(index).maxReturn < pair.maxReturn) {
          buyPointMap.set(index, pair);
        }
      }

      for (const index of sellZone) {
        if (!sellPointMap.has(index) || sellPointMap.get(index).maxReturn < pair.maxReturn) {
          sellPointMap.set(index, pair);
        }
      }
    }

    this.rows = this.rows.map((row, index) => {
      const buyPair = buyPointMap.get(index);
      const sellPair = sellPointMap.get(index);
      return {
        ...row,
        isBuyPoint: buyPair ? 1 : 0,
        isSellPoint: sellPair ? 1 : 0,
        tradeGroupId: buyPair?.tradeGroupId ?? sellPair?.tradeGroupId ?? null,
        targetSellDate: buyPair?.sellDate ?? null,
        targetSellPrice: buyPair?.sellPrice ?? null,
        targetReturn: buyPair?.return ?? null,
        maxFutureReturn: buyPair?.maxReturn ?? null,
        drawdownBeforePeak: buyPair?.drawdownBeforePeak ?? null,
        holdingDays: buyPair?.holdingDays ?? null,
      };
    });

    return this.rows;
  }

  getLabeledPairs() {
    this.getLabeledRows();
    return this.selectNonOverlappingPairs();
  }

  getDiagnostics() {
    const rows = this.getLabeledRows();
    const totalRows = rows.length;
    const buyPointCount = rows.filter((row) => row.isBuyPoint === 1).length;
    const sellPointCount = rows.filter((row) => row.isSellPoint === 1).length;
    const buyPointRate = totalRows ? buyPointCount / totalRows : 0;
    const sellPointRate = totalRows ? sellPointCount / totalRows : 0;

    return {
      totalRows,
      buyPointCount,
      sellPointCount,
      buyPointRate: Number(buyPointRate.toFixed(4)),
      sellPointRate: Number(sellPointRate.toFixed(4)),
      targetMet: buyPointRate >= 0.08 && buyPointRate <= 0.15,
    };
  }
}
