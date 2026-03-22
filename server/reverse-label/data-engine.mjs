import { computeIndicators } from '../quant/indicators.mjs';

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

const standardDeviation = (values) => {
  if (values.length < 2) {
    return 0;
  }
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
};

const computeAtrSeries = (candles, period = 14) => {
  const queue = [];
  return candles.map((item, index) => {
    const previous = candles[index - 1] ?? item;
    const tr = Math.max(
      item.high - item.low,
      Math.abs(item.high - previous.close),
      Math.abs(item.low - previous.close),
    );
    queue.push(tr);
    if (queue.length > period) {
      queue.shift();
    }
    return Number(average(queue).toFixed(4));
  });
};

export class DataEngine {
  constructor(klineJson) {
    this.rows = [...klineJson]
      .map((item) => ({
        date: String(item.date).slice(0, 10),
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close),
        volume: Number(item.volume ?? item.vol ?? 0),
        turnover: item.turnover !== undefined ? Number(item.turnover) : undefined,
      }))
      .filter((item) => item.date && Number.isFinite(item.close))
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  computeAllFeatures() {
    const enriched = computeIndicators(this.rows);
    const atr14 = computeAtrSeries(enriched, 14);

    const featured = enriched.map((item, index, source) => {
      const recent5 = source.slice(Math.max(0, index - 4), index + 1).map((entry) => entry.volume);
      const recent20 = source.slice(Math.max(0, index - 19), index + 1).map((entry) => entry.volume);
      const denom = Math.max((item.bollUpper ?? item.close) - (item.bollLower ?? item.close), 0.0001);
      const bollPos = ((item.close - (item.bollLower ?? item.close)) / denom);
      const maBull =
        Number(item.ma5 > item.ma10) +
        Number(item.ma10 > item.ma20) +
        Number((item.ma20 ?? item.close) > (item.ma60 ?? item.close));
      const turnRatio5 = item.turnover && index >= 4
        ? Number((item.turnover / average(source.slice(index - 4, index + 1).map((entry) => entry.turnover ?? 0))).toFixed(4))
        : undefined;
      const close20 = source.slice(Math.max(0, index - 19), index + 1).map((entry) => entry.close);
      const previous5 = source[index - 5];
      const previous20 = source[index - 20];
      const roc5 = previous5?.close
        ? Number((((item.close - previous5.close) / previous5.close) * 100).toFixed(3))
        : undefined;
      const roc20 = previous20?.close
        ? Number((((item.close - previous20.close) / previous20.close) * 100).toFixed(3))
        : undefined;
      return {
        ...item,
        maBull,
        bollPos: Number(Math.max(0, Math.min(1, bollPos)).toFixed(4)),
        atr14: atr14[index],
        volRatio5: Number((item.volume / Math.max(average(recent5), 1)).toFixed(4)),
        volRatio20: Number((item.volume / Math.max(average(recent20), 1)).toFixed(4)),
        turnRatio5,
        closeVol20: Number(standardDeviation(close20).toFixed(4)),
        adx14: item.adx,
        macd_dif: item.dif,
        macd_dea: item.dea,
        macd_bar: item.macd,
        roc5,
        roc20,
      };
    });

    this.rows = featured.filter((item) =>
      Number.isFinite(item.ma20) &&
      Number.isFinite(item.rsi6) &&
      Number.isFinite(item.rsi12) &&
      Number.isFinite(item.macd) &&
      Number.isFinite(item.adx) &&
      Number.isFinite(item.bollPos),
    );
    return this.rows;
  }
}
