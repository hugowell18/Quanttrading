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

const emaSeries = (values, period) => {
  const multiplier = 2 / (period + 1);
  let previous = values[0] ?? 0;

  return values.map((value, index) => {
    if (index === 0) {
      previous = value;
      return value;
    }

    previous = previous + (value - previous) * multiplier;
    return previous;
  });
};

const sum = (values) => values.reduce((total, value) => total + value, 0);

export const computeIndicators = (candles) => {
  if (!candles.length) {
    return [];
  }

  const closes = candles.map((item) => item.close);
  const ema12Series = emaSeries(closes, 12);
  const ema26Series = emaSeries(closes, 26);
  const tr14Queue = [];
  const plusDmQueue = [];
  const minusDmQueue = [];
  const gains2 = [];
  const losses2 = [];
  const gains6 = [];
  const losses6 = [];
  const gains12 = [];
  const losses12 = [];
  const gains24 = [];
  const losses24 = [];
  const rocQueue = [];
  const obvValues = [];
  const dxValues = [];
  let obv = 0;
  let previousK = 50;
  let previousD = 50;
  let previousAdx = 0;

  return candles.map((item, index) => {
    const previous = candles[index - 1] ?? item;
    const recentClose5 = candles.slice(Math.max(0, index - 4), index + 1).map((entry) => entry.close);
    const recentClose10 = candles.slice(Math.max(0, index - 9), index + 1).map((entry) => entry.close);
    const recentClose20 = candles.slice(Math.max(0, index - 19), index + 1).map((entry) => entry.close);
    const recentClose60 = candles.slice(Math.max(0, index - 59), index + 1).map((entry) => entry.close);
    const recentClose120 = candles.slice(Math.max(0, index - 119), index + 1).map((entry) => entry.close);
    const recentClose250 = candles.slice(Math.max(0, index - 249), index + 1).map((entry) => entry.close);
    const volume20 = candles.slice(Math.max(0, index - 19), index + 1).map((entry) => entry.volume);

    const dif = ema12Series[index] - ema26Series[index];
    const dea = index === 0 ? dif : previousAdx === previousAdx ? 0 : 0;
    const previousDea = index === 0 ? dif : candles[index - 1]?._dea ?? dif;
    const nextDea = index === 0 ? dif : previousDea * 0.8 + dif * 0.2;
    const macd = (dif - nextDea) * 2;

    const change = item.close - previous.close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    gains2.push(gain);
    losses2.push(loss);
    gains6.push(gain);
    losses6.push(loss);
    gains12.push(gain);
    losses12.push(loss);
    gains24.push(gain);
    losses24.push(loss);
    if (gains2.length > 2) gains2.shift();
    if (losses2.length > 2) losses2.shift();
    if (gains6.length > 6) gains6.shift();
    if (losses6.length > 6) losses6.shift();
    if (gains12.length > 12) gains12.shift();
    if (losses12.length > 12) losses12.shift();
    if (gains24.length > 24) gains24.shift();
    if (losses24.length > 24) losses24.shift();

    const calcRsi = (gains, losses) => {
      const avgGain = average(gains);
      const avgLoss = average(losses);
      if (avgLoss === 0) {
        return 100;
      }

      const rs = avgGain / avgLoss;
      return 100 - 100 / (1 + rs);
    };

    const recentKdj = candles.slice(Math.max(0, index - 8), index + 1);
    const periodHigh = Math.max(...recentKdj.map((entry) => entry.high));
    const periodLow = Math.min(...recentKdj.map((entry) => entry.low));
    const rsv = periodHigh === periodLow ? 50 : ((item.close - periodLow) / (periodHigh - periodLow)) * 100;
    const k = previousK * (2 / 3) + rsv / 3;
    const d = previousD * (2 / 3) + k / 3;
    const j = 3 * k - 2 * d;
    previousK = k;
    previousD = d;

    const highest14 = Math.max(...candles.slice(Math.max(0, index - 13), index + 1).map((entry) => entry.high));
    const lowest14 = Math.min(...candles.slice(Math.max(0, index - 13), index + 1).map((entry) => entry.low));
    const wr14 = highest14 === lowest14 ? -50 : ((highest14 - item.close) / (highest14 - lowest14)) * -100;

    const rocBase = candles[Math.max(0, index - 12)]?.close ?? item.close;
    const roc = rocBase === 0 ? 0 : ((item.close - rocBase) / rocBase) * 100;
    rocQueue.push(roc);
    if (rocQueue.length > 12) rocQueue.shift();

    obv += item.close >= previous.close ? item.volume : -item.volume;
    obvValues.push(obv);

    const tr = Math.max(
      item.high - item.low,
      Math.abs(item.high - previous.close),
      Math.abs(item.low - previous.close),
    );
    const upMove = item.high - previous.high;
    const downMove = previous.low - item.low;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    tr14Queue.push(tr);
    plusDmQueue.push(plusDm);
    minusDmQueue.push(minusDm);
    if (tr14Queue.length > 14) tr14Queue.shift();
    if (plusDmQueue.length > 14) plusDmQueue.shift();
    if (minusDmQueue.length > 14) minusDmQueue.shift();
    const tr14 = sum(tr14Queue);
    const plusDi = tr14 === 0 ? 0 : (sum(plusDmQueue) / tr14) * 100;
    const minusDi = tr14 === 0 ? 0 : (sum(minusDmQueue) / tr14) * 100;
    const dx = plusDi + minusDi === 0 ? 0 : (Math.abs(plusDi - minusDi) / (plusDi + minusDi)) * 100;
    dxValues.push(dx);
    if (dxValues.length > 14) dxValues.shift();
    const adx = dxValues.length < 14 ? average(dxValues) : index === 0 ? dx : (previousAdx * 13 + dx) / 14;
    previousAdx = adx;

    const ma20 = average(recentClose20);
    const std20 = standardDeviation(recentClose20);
    const bollMid = ma20;
    const bollUpper = ma20 + std20 * 2;
    const bollLower = ma20 - std20 * 2;
    const volumeAvg20 = average(volume20);
    const volumeRatio = volumeAvg20 === 0 ? 1 : item.volume / volumeAvg20;

    return {
      ...item,
      k: Number(k.toFixed(2)),
      d: Number(d.toFixed(2)),
      j: Number(j.toFixed(2)),
      dif: Number(dif.toFixed(3)),
      dea: Number(nextDea.toFixed(3)),
      _dea: nextDea,
      macd: Number(macd.toFixed(3)),
      rsi: Number(calcRsi(gains12, losses12).toFixed(2)),
      rsi2: Number(calcRsi(gains2, losses2).toFixed(2)),
      rsi6: Number(calcRsi(gains6, losses6).toFixed(2)),
      rsi12: Number(calcRsi(gains12, losses12).toFixed(2)),
      rsi24: Number(calcRsi(gains24, losses24).toFixed(2)),
      ma5: Number(average(recentClose5).toFixed(2)),
      ma10: Number(average(recentClose10).toFixed(2)),
      ma20: Number(ma20.toFixed(2)),
      ma60: Number(average(recentClose60).toFixed(2)),
      ma120: Number(average(recentClose120).toFixed(2)),
      ma250: Number(average(recentClose250).toFixed(2)),
      bollMid: Number(bollMid.toFixed(2)),
      bollUpper: Number(bollUpper.toFixed(2)),
      bollLower: Number(bollLower.toFixed(2)),
      bollWidth: Number((bollMid === 0 ? 0 : ((bollUpper - bollLower) / bollMid) * 100).toFixed(2)),
      adx: Number(adx.toFixed(2)),
      plusDi: Number(plusDi.toFixed(2)),
      minusDi: Number(minusDi.toFixed(2)),
      wr14: Number(wr14.toFixed(2)),
      roc12: Number(roc.toFixed(2)),
      obv,
      volumeRatio: Number(volumeRatio.toFixed(2)),
    };
  }).map(({ _dea, ...rest }) => rest);
};

