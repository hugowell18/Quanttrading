export class SignalLabeler {
  constructor(rows, options = {}) {
    this.rows = rows.map((row) => ({ ...row }));
    this.forwardDays = options.forwardDays ?? 20;
    this.minReturn = options.minReturn ?? 0.08;
    this.maxDrawdown = options.maxDrawdown ?? 0.04;
    this.zoneForward = options.zoneForward ?? 10;
    this.zoneBackward = options.zoneBackward ?? 3;
    this.minZoneCapture = options.minZoneCapture ?? 0.7;
    this.sellZoneForward = options.sellZoneForward ?? 3;
    this.sellZoneBackward = options.sellZoneBackward ?? 5;
  }

  buildWaveCandidates() {
    const candidates = [];
    for (let buyIndex = 0; buyIndex < this.rows.length - this.forwardDays; buyIndex += 1) {
      const buyRow = this.rows[buyIndex];
      const futureSlice = this.rows.slice(buyIndex + 1, buyIndex + this.forwardDays + 1);
      if (!futureSlice.length) continue;

      let bestSellOffset = -1;
      let bestReturn = -Infinity;
      let drawdownBeforePeak = 0;

      futureSlice.forEach((futureRow, offset) => {
        const candidateReturn = (futureRow.high - buyRow.close) / buyRow.close;
        if (candidateReturn <= bestReturn) return;

        const sliceToPeak = futureSlice.slice(0, offset + 1);
        const localMin = Math.min(...sliceToPeak.map((row) => row.low), buyRow.low);
        const localDrawdown = (buyRow.close - localMin) / buyRow.close;
        bestReturn = candidateReturn;
        bestSellOffset = offset;
        drawdownBeforePeak = localDrawdown;
      });

      if (bestSellOffset === -1) continue;

      const sellIndex = buyIndex + 1 + bestSellOffset;
      const sellRow = this.rows[sellIndex];
      const realizedReturn = (sellRow.close - buyRow.close) / buyRow.close;

      if (bestReturn < this.minReturn || drawdownBeforePeak > this.maxDrawdown) continue;

      candidates.push({
        buyIndex,
        sellIndex,
        buyDate: buyRow.date,
        sellDate: sellRow.date,
        buyPrice: buyRow.close,
        sellPrice: sellRow.close,
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
    const buyEnd = Math.min(this.rows.length - 1, buyIndex + this.zoneBackward);
    for (let index = buyStart; index <= buyEnd; index += 1) {
      const entryPrice = this.rows[index].close;
      const captureReturn = (waveHigh - entryPrice) / entryPrice;
      if (captureReturn < maxReturn * this.minZoneCapture) continue;
      if (!this._isLearnable(index)) continue;
      buyZone.add(index);
    }

    const sellStart = Math.max(0, sellIndex - this.sellZoneForward);
    const sellEnd = Math.min(this.rows.length - 1, sellIndex + this.sellZoneBackward);
    for (let index = sellStart; index <= sellEnd; index += 1) {
      const exitPrice = this.rows[index].close;
      if (exitPrice < buyPrice * (1 + this.minReturn * 0.8)) continue;
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
