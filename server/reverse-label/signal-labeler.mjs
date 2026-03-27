import { readDaily } from '../data/csv-manager.mjs';
import { DataEngine } from './data-engine.mjs';

const INDEX_TS_CODE = '000300.SH';
const INDEX_START_DATE = '20050101';
const INDEX_END_DATE = '20991231';
const COST_RATE = 0.007;

const priceValue = (row) => Number(row?.close_adj ?? row?.close ?? 0);

const normalizeDate = (value) => {
  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return String(value ?? '').slice(0, 10);
};

const buildIndexMap = () => {
  const candles = readDaily(INDEX_TS_CODE, INDEX_START_DATE, INDEX_END_DATE).map((row) => ({
    date: normalizeDate(row.trade_date),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close_adj ?? row.close),
    close_adj: Number(row.close_adj ?? row.close),
    volume: Number(row.volume ?? 0),
    turnover_rate: Number(row.turnover_rate ?? 0),
  }));

  if (!candles.length) {
    return new Map();
  }

  const featured = new DataEngine(candles).computeAllFeatures();
  return new Map(featured.map((row) => [row.date, row]));
};

export class SignalLabeler {
  constructor(rows, options = {}) {
    this.rows = rows
      .map((row) => ({
        ...row,
        date: normalizeDate(row.date ?? row.trade_date),
      }))
      .sort((left, right) => left.date.localeCompare(right.date));
    this.forwardDays = options.forwardDays ?? 5;
    this.minReturn = options.minReturn ?? 0.045;
    this.maxDrawdown = options.maxDrawdown ?? 0.025;
    this.indexMap = options.indexMap ?? buildIndexMap();
    this._pairs = null;
    this._labeledRows = null;
    this._diagnostics = null;
  }

  _passesTrendFilter(index) {
    const row = this.rows[index];
    const currentPrice = priceValue(row);
    const stockTrendOk = Number.isFinite(row.ma60) && row.ma60 > 0 && currentPrice > row.ma60;
    if (!stockTrendOk) {
      return false;
    }

    const indexRow = this.indexMap.get(row.date);
    if (!indexRow) {
      return false;
    }

    return Number.isFinite(indexRow.ma20) && indexRow.ma20 > 0 && priceValue(indexRow) > indexRow.ma20;
  }

  _countDownDays(index) {
    const start = Math.max(0, index - 3);
    const slice = this.rows.slice(start, index + 1);
    return slice.filter((row) => priceValue(row) < Number(row.open ?? 0)).length;
  }

  _fourDayDrop(index) {
    if (index < 3) {
      return 0;
    }

    const base = priceValue(this.rows[index - 3]);
    const current = priceValue(this.rows[index]);
    if (base <= 0) {
      return 0;
    }

    return (current - base) / base;
  }

  _volumeShrinking(index) {
    if (index < 2) {
      return false;
    }

    const v1 = Number(this.rows[index - 2].volume ?? 0);
    const v2 = Number(this.rows[index - 1].volume ?? 0);
    const v3 = Number(this.rows[index].volume ?? 0);
    return v1 > v2 && v2 > v3;
  }

  _oversoldSignals(index) {
    const row = this.rows[index];
    const signals = [
      this._countDownDays(index) >= 3,
      this._fourDayDrop(index) <= -0.02,
      Number(row.rsi6 ?? 100) < 42,
      Number(row.j ?? 100) < 25,
      Number(row.bollPos ?? 1) < 0.25,
      this._volumeShrinking(index),
    ];

    return {
      metCount: signals.filter(Boolean).length,
      signals,
    };
  }

  _validateOutcome(index) {
    const row = this.rows[index];
    const buyPrice = priceValue(row) * (1 + COST_RATE);
    if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
      return null;
    }

    const futureSlice = this.rows.slice(index + 1, index + 1 + this.forwardDays);
    if (!futureSlice.length) {
      return null;
    }

    let bestReturn = -Infinity;
    let maxDrawdown = 0;
    let sellIndex = null;

    futureSlice.forEach((futureRow, offset) => {
      const highReturn = (Number(futureRow.high ?? priceValue(futureRow)) - buyPrice) / buyPrice;
      const lowDrawdown = (buyPrice - Number(futureRow.low ?? buyPrice)) / buyPrice;

      bestReturn = Math.max(bestReturn, highReturn);
      maxDrawdown = Math.max(maxDrawdown, lowDrawdown);

      if (sellIndex === null && highReturn >= this.minReturn) {
        sellIndex = index + 1 + offset;
      }
    });

    if (bestReturn < this.minReturn || maxDrawdown > this.maxDrawdown || sellIndex === null) {
      return null;
    }

    const sellRow = this.rows[sellIndex];
    const sellPrice = priceValue(sellRow);

    return {
      buyIndex: index,
      sellIndex,
      buyDate: row.date,
      sellDate: sellRow.date,
      buyPrice: Number(buyPrice.toFixed(4)),
      sellPrice: Number(sellPrice.toFixed(4)),
      maxReturn: Number(bestReturn.toFixed(4)),
      drawdownBeforePeak: Number(maxDrawdown.toFixed(4)),
      holdingDays: sellIndex - index,
      return: Number(((sellPrice - buyPrice) / buyPrice).toFixed(4)),
    };
  }

  buildMeanReversionPairs() {
    const pairs = [];
    let trendQualifiedCount = 0;
    let oversoldCandidateCount = 0;

    for (let index = 0; index < this.rows.length; index += 1) {
      if (!this._passesTrendFilter(index)) {
        continue;
      }

      trendQualifiedCount += 1;

      const oversold = this._oversoldSignals(index);
      if (oversold.metCount < 3) {
        continue;
      }

      oversoldCandidateCount += 1;

      const validated = this._validateOutcome(index);
      if (!validated) {
        continue;
      }

      pairs.push({
        ...validated,
        tradeGroupId: `mr-${String(pairs.length + 1).padStart(4, '0')}`,
        success: validated.return > 0,
      });
    }

    this._diagnostics = {
      totalRows: this.rows.length,
      trendQualifiedCount,
      oversoldCandidateCount,
    };

    return pairs;
  }

  getLabeledRows() {
    if (this._labeledRows) {
      return this._labeledRows;
    }

    const pairs = this.buildMeanReversionPairs();
    this._pairs = pairs;

    const buyPointMap = new Map(pairs.map((pair) => [pair.buyIndex, pair]));
    const sellPointMap = new Map();
    for (const pair of pairs) {
      if (!sellPointMap.has(pair.sellIndex)) {
        sellPointMap.set(pair.sellIndex, pair);
      }
    }

    this._labeledRows = this.rows.map((row, index) => {
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

    const totalRows = this._labeledRows.length;
    const buyPointCount = this._labeledRows.filter((row) => row.isBuyPoint === 1).length;
    const sellPointCount = this._labeledRows.filter((row) => row.isSellPoint === 1).length;
    const buyPointRate = totalRows ? buyPointCount / totalRows : 0;
    const sellPointRate = totalRows ? sellPointCount / totalRows : 0;

    this._diagnostics = {
      ...this._diagnostics,
      totalRows,
      buyPointCount,
      sellPointCount,
      buyPointRate: Number(buyPointRate.toFixed(4)),
      sellPointRate: Number(sellPointRate.toFixed(4)),
      targetMet: buyPointCount >= 150 && buyPointCount <= 400,
    };

    console.log(
      `[Labeler] total=${totalRows} trendQualified=${this._diagnostics.trendQualifiedCount} oversoldCandidates=${this._diagnostics.oversoldCandidateCount} buyPoints=${buyPointCount} (${(buyPointRate * 100).toFixed(2)}%) sellPoints=${sellPointCount} (${(sellPointRate * 100).toFixed(2)}%)`,
    );

    return this._labeledRows;
  }

  getLabeledPairs() {
    if (!this._pairs) {
      this.getLabeledRows();
    }
    return this._pairs ?? [];
  }

  getDiagnostics() {
    if (!this._diagnostics) {
      this.getLabeledRows();
    }
    return this._diagnostics;
  }
}
