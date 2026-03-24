/**
 * 第一层：市场状态识别器（Regime Detector）
 *
 * 设计原则：
 * 1. 纯宏观指标：只用 ADX（趋势强度）、ATR/close（波动率）、price/MA200（长周期趋势锚）
 * 2. 严禁个股参数：不使用 maBull、bollWidth 等个股特征
 * 3. 低频防闪烁：连续 N 日确认后才切换状态
 */

const average = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);

const REGIMES = ['uptrend', 'downtrend', 'range', 'breakout', 'high_vol'];

/**
 * 单次判定：基于给定窗口数据判定 regime（无状态）
 * @param {Object[]} window - 最近 lookback 根K线（需含 adx14, atr14, close, ma20, ma60, ma120）
 * @returns {string} regime
 */
function classifyWindow(window) {
  if (!window.length) return 'range';

  const recent = window.slice(-60);
  const tail = window.slice(-20);

  // 1. ADX 均值（趋势强度）
  const avgAdx = average(recent.map((r) => r.adx14 ?? r.adx ?? 0));

  // 2. ATR 归一化波动率 = ATR14 / close（最近20日均值）
  const atrNormalized = average(tail.map((r) => {
    const atr = r.atr14 ?? 0;
    return r.close > 0 ? atr / r.close : 0;
  }));

  // 3. 长周期趋势锚：close / MA120（用MA120代替MA200，日线数据量更实际）
  const latest = window[window.length - 1];
  const ma120 = latest.ma120 ?? latest.ma60 ?? latest.close;
  const priceVsLongMa = ma120 > 0 ? latest.close / ma120 : 1;

  // 4. 短期趋势方向：最近20日的均线斜率
  const ma20Start = window[Math.max(0, window.length - 20)]?.ma20 ?? latest.close;
  const ma20End = latest.ma20 ?? latest.close;
  const ma20Slope = ma20Start > 0 ? (ma20End - ma20Start) / ma20Start : 0;

  // 5. 波动率变化：最近20日ATR vs 前60日ATR（突破判定）
  const recentAtr = average(tail.map((r) => r.atr14 ?? 0));
  const olderAtr = average(window.slice(-60, -20).map((r) => r.atr14 ?? 0));
  const atrExpansion = olderAtr > 0 ? recentAtr / olderAtr : 1;

  // === 判定逻辑 ===

  // 上升趋势：ADX强 + 价格在长均线上方 + 短均线向上
  if (avgAdx >= 25 && priceVsLongMa > 1.02 && ma20Slope > 0.005) {
    return 'uptrend';
  }

  // 下降趋势：ADX强 + 价格在长均线下方 + 短均线向下
  if (avgAdx >= 25 && priceVsLongMa < 0.97 && ma20Slope < -0.005) {
    return 'downtrend';
  }

  // 突破前夕：ADX弱（震荡中）但波动率在扩张
  if (avgAdx < 22 && atrExpansion > 1.3 && atrNormalized > 0.015) {
    return 'breakout';
  }

  // 高波动：波动率超高，不属于明确趋势
  if (atrNormalized > 0.025) {
    return 'high_vol';
  }

  // 震荡区间：ADX弱 + 波动率适中
  if (avgAdx < 22) {
    return 'range';
  }

  // 默认：ADX中等区域，根据价格位置判断
  if (priceVsLongMa > 1.0) return 'uptrend';
  if (priceVsLongMa < 0.95) return 'downtrend';
  return 'range';
}

export class RegimeDetector {
  /**
   * @param {Object} options
   * @param {number} options.lookback - 用于判定的K线窗口长度，默认120
   * @param {number} options.confirmDays - 防闪烁：新regime须连续N日确认，默认5
   */
  constructor(options = {}) {
    this.lookback = options.lookback ?? 120;
    this.confirmDays = options.confirmDays ?? 5;
  }

  /**
   * 检测当前 regime（带防闪烁）
   * 从数据尾部向前滚动 confirmDays 次，只有连续一致才确认新状态
   *
   * @param {Object[]} rows - 完整K线数据（需含 adx14, atr14, close, ma20, ma60, ma120）
   * @returns {{ regime: string, confidence: number, raw: string[] }}
   */
  detect(rows) {
    if (rows.length < this.lookback) {
      return { regime: 'range', confidence: 0, raw: [] };
    }

    // 在最近 confirmDays 个位置分别判定 regime
    const rawSequence = [];
    for (let offset = 0; offset < this.confirmDays; offset += 1) {
      const endIdx = rows.length - offset;
      const window = rows.slice(Math.max(0, endIdx - this.lookback), endIdx);
      rawSequence.unshift(classifyWindow(window));
    }

    // 防闪烁：如果 confirmDays 内全部一致 → 高置信度
    const latest = rawSequence[rawSequence.length - 1];
    const allSame = rawSequence.every((r) => r === latest);

    if (allSame) {
      return { regime: latest, confidence: 1.0, raw: rawSequence };
    }

    // 部分一致：取众数，置信度 = 众数频率
    const counts = {};
    rawSequence.forEach((r) => { counts[r] = (counts[r] ?? 0) + 1; });
    const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const confidence = Number((majority[1] / rawSequence.length).toFixed(2));

    return { regime: majority[0], confidence, raw: rawSequence };
  }

  /**
   * 检测历史 regime 序列（用于观察 regime 演变和验证稳定性）
   * 每隔 step 根K线采样一次
   *
   * @param {Object[]} rows
   * @param {number} step - 采样步长，默认20（约1个月）
   * @returns {{ date: string, regime: string }[]}
   */
  detectHistory(rows, step = 20) {
    const history = [];
    for (let end = this.lookback; end <= rows.length; end += step) {
      const window = rows.slice(Math.max(0, end - this.lookback), end);
      const regime = classifyWindow(window);
      const date = rows[end - 1]?.date ?? '';
      history.push({ date, regime });
    }
    return history;
  }
}

export { REGIMES, classifyWindow };
