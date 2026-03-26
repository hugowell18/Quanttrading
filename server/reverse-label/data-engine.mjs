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

  /**
   * @param {Object[]} [indexRows] - 大盘指数数据（可选），用于计算相对强弱RS
   */
  computeAllFeatures(indexRows) {
    const enriched = computeIndicators(this.rows);
    // 建议3：构建日期→指数涨跌幅映射表
    const indexMap = new Map();
    if (indexRows?.length) {
      for (const row of indexRows) {
        indexMap.set(row.date, row);
      }
    }
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
      // bollWidth：布林带宽度（越窄 → 压缩 → 爆发前夕），归一化为百分比
      const bollWidth = item.bollWidth ?? (item.bollMid > 0
        ? Number((((item.bollUpper ?? item.close) - (item.bollLower ?? item.close)) / item.bollMid * 100).toFixed(4))
        : 0);

      // rsi2：极短期RSI（超买超卖更灵敏）
      const rsi2 = item.rsi2 ?? 50;

      // k、j：KDJ指标（oversold_bounce特征集用到）
      const kVal = item.k ?? 50;
      const jVal = item.j ?? 50;

      // wr14：威廉指标
      const wr14 = item.wr14 ?? -50;

      // obv归一化：使用OBV的20日变化率，避免绝对值过大
      const obv20 = source[Math.max(0, index - 20)]?.obv ?? 0;
      const obvChg20 = obv20 !== 0 ? Number(((item.obv - obv20) / Math.abs(obv20)).toFixed(4)) : 0;

      // ── 事件特征（方向2）──
      // 距60日高点/低点的距离（归一化百分比）
      const lookback60 = source.slice(Math.max(0, index - 59), index + 1);
      const high60 = Math.max(...lookback60.map((e) => e.high));
      const low60 = Math.min(...lookback60.map((e) => e.low));
      const distFromHigh = high60 > 0 ? Number(((high60 - item.close) / high60).toFixed(4)) : 0;
      const distFromLow = low60 > 0 ? Number(((item.close - low60) / low60).toFixed(4)) : 0;

      // ATR变化率：当前ATR / 60日ATR均值（波动扩张/收缩）
      const atr60Avg = average(atr14.slice(Math.max(0, index - 59), index + 1));
      const atrRatio = atr60Avg > 0 ? Number((atr14[index] / atr60Avg).toFixed(4)) : 1;

      // 连续下跌天数（反弹信号）
      let consecutiveDown = 0;
      for (let d = index; d >= Math.max(0, index - 10); d -= 1) {
        if (source[d].close < source[d].open) consecutiveDown += 1;
        else break;
      }

      // ── 交叉特征（方向4）── 非线性组合，塞进线性模型
      // RSI超卖 + 放量 = 强反弹信号
      const rsiVolCross = Number(((item.rsi6 ?? 50) < 35 && (item.volume / Math.max(average(recent5), 1)) > 1.3) ? 1 : 0);
      // Boll收窄 + ADX低 = 突破前夕
      const bollAdxCross = Number((bollWidth < 4 && (item.adx ?? 20) < 20) ? 1 : 0);

      // ── 建议3：相对强弱 RS（Relative Strength vs Index）──
      let rs20 = 0;
      if (index >= 20 && indexMap.size > 0) {
        const stockReturn20 = (item.close - source[index - 20].close) / source[index - 20].close;
        const idxRow = indexMap.get(item.date);
        const idxRow20 = indexMap.get(source[index - 20]?.date);
        if (idxRow && idxRow20 && idxRow20.close > 0) {
          const indexReturn20 = (idxRow.close - idxRow20.close) / idxRow20.close;
          rs20 = Number((stockReturn20 - indexReturn20).toFixed(4));
        }
      }

      return {
        ...item,
        maBull,
        bollPos: Number(Math.max(0, Math.min(1, bollPos)).toFixed(4)),
        bollWidth,
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
        rsi2,
        k: kVal,
        j: jVal,
        wr14,
        obv: obvChg20,
        // 事件特征
        distFromHigh,
        distFromLow,
        atrRatio,
        consecutiveDown,
        // 交叉特征
        rsiVolCross,
        bollAdxCross,
        // 相对强弱
        rs20,
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
