/**
 * 核心因子周频降频版本 + IC/ICIR 监控
 * Phase 4.4 / 需求 20 / 任务书 4.4
 *
 * 功能：
 *   1. 将日频因子值转为 5 日滚动均值（周频版本），降低换手率
 *   2. 计算因子 IC（Pearson 相关系数）和 ICIR（IC均值/IC标准差）
 *   3. 检测因子失效：滚动窗口内 IC 连续 2 周（10 个交易日）< 1% 时预警
 *
 * 核心因子：涨停集中度、量比异动、封单质量
 */

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const round4 = (v) => Math.round(v * 10000) / 10000;

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ──────────────────────────────────────────────
// 1. 周频因子：5 日滚动均值
// ──────────────────────────────────────────────

/**
 * 将日频因子序列转为 5 日滚动均值（周频版本）
 * 不足 5 日时取已有数据的均值
 *
 * @param {number[]} dailyValues  日频因子值序列（按时间升序）
 * @returns {number[]}            与输入等长的周频版本序列
 */
export function computeWeeklyFactor(dailyValues) {
  return dailyValues.map((_, i) => {
    const window = dailyValues.slice(Math.max(0, i - 4), i + 1);
    return round4(mean(window));
  });
}

// ──────────────────────────────────────────────
// 2. 因子 IC 计算（Pearson 相关系数）
// ──────────────────────────────────────────────

/**
 * 计算因子 IC（单期）
 * IC = Pearson(factorValues, nextPeriodReturns)
 *
 * @param {number[]} factorValues  因子值序列
 * @param {number[]} returns       对应的下期收益率序列（与 factorValues 等长）
 * @returns {number | null}        IC 值（-1 到 1），数据不足时返回 null
 */
export function computeIC(factorValues, returns) {
  if (factorValues.length !== returns.length || factorValues.length < 2) return null;

  const n = factorValues.length;
  const mf = mean(factorValues);
  const mr = mean(returns);

  let cov = 0;
  let sf = 0;
  let sr = 0;

  for (let i = 0; i < n; i++) {
    const df = factorValues[i] - mf;
    const dr = returns[i] - mr;
    cov += df * dr;
    sf  += df * df;
    sr  += dr * dr;
  }

  const denom = Math.sqrt(sf * sr);
  if (denom === 0) return null;

  return round4(cov / denom);
}

/**
 * 计算滚动窗口 IC 序列及 ICIR
 *
 * @param {number[]} factorSeries  因子值时间序列（按日期升序）
 * @param {number[]} returnSeries  对应的下期收益率序列（等长）
 * @param {number}   window        滚动窗口大小（默认 20 个交易日）
 * @returns {{
 *   icSeries: number[],   // 每日滚动 IC（长度 = factorSeries.length - window + 1）
 *   icMean: number,       // IC 均值
 *   icStd: number,        // IC 标准差
 *   icir: number,         // ICIR = icMean / icStd
 * }}
 */
export function computeRollingIC(factorSeries, returnSeries, window = 20) {
  if (factorSeries.length !== returnSeries.length) {
    return { icSeries: [], icMean: 0, icStd: 0, icir: 0 };
  }

  const icSeries = [];
  for (let i = window - 1; i < factorSeries.length; i++) {
    const fSlice = factorSeries.slice(i - window + 1, i + 1);
    const rSlice = returnSeries.slice(i - window + 1, i + 1);
    const ic = computeIC(fSlice, rSlice);
    if (ic != null) icSeries.push(ic);
  }

  const icMean = round4(mean(icSeries));
  const icStd  = round4(std(icSeries));
  const icir   = icStd > 0 ? round4(icMean / icStd) : 0;

  return { icSeries, icMean, icStd, icir };
}

// ──────────────────────────────────────────────
// 3. 因子失效预警
// ──────────────────────────────────────────────

/**
 * 检测因子是否失效
 * 条件：最近 10 个交易日（2 周）的 IC 均值 < 1%（0.01）
 *
 * @param {number[]} icSeries   滚动 IC 序列（按时间升序）
 * @param {number}   lookback   检测窗口（默认 10 个交易日）
 * @param {number}   threshold  IC 失效阈值（默认 0.01）
 * @returns {{
 *   degraded: boolean,
 *   recentICMean: number,
 *   message: string,
 * }}
 */
export function detectFactorDegradation(icSeries, lookback = 10, threshold = 0.01) {
  if (icSeries.length < lookback) {
    return { degraded: false, recentICMean: 0, message: '数据不足，无法判断' };
  }

  const recent = icSeries.slice(-lookback);
  const recentICMean = round4(mean(recent));
  const degraded = Math.abs(recentICMean) < threshold;

  return {
    degraded,
    recentICMean,
    message: degraded
      ? `因子失效预警：近${lookback}日IC均值=${recentICMean}，低于阈值${threshold}`
      : `因子有效：近${lookback}日IC均值=${recentICMean}`,
  };
}

// ──────────────────────────────────────────────
// 4. 日频/周频信号方向一致性检查（需求 20 AC3）
// ──────────────────────────────────────────────

/**
 * 检查日频和周频信号方向是否一致
 * 一致时综合评分额外加权 10%
 *
 * @param {number} dailyValue   当日日频因子值
 * @param {number} weeklyValue  当日周频因子值（5日均值）
 * @param {number} baseline     基准值（通常为 0 或历史均值）
 * @returns {{ consistent: boolean, bonus: number }}
 */
export function checkFrequencyConsistency(dailyValue, weeklyValue, baseline = 0) {
  const dailyUp   = dailyValue  > baseline;
  const weeklyUp  = weeklyValue > baseline;
  const consistent = dailyUp === weeklyUp;
  return { consistent, bonus: consistent ? 0.10 : 0 };
}
