/**
 * 筹码特征提取器 (Chip Feature Extractor)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Gate 2：从筹码分布中提取 15 个量化特征，用于：
 *   1. 单变量相关性检验（对比现有买入标签）
 *   2. 作为附加因子接入 optimizer.mjs 特征集
 *   3. 独立筹码策略回测（chip-backtester.mjs）
 *
 * 特征列表（15 个）：
 *   F01  profit_ratio          获利盘比例（当前价以下的筹码占比）
 *   F02  upper_chip_ratio      套牢盘比例（当前价以上的筹码占比）
 *   F03  avg_cost_distance     均成本偏离度（(均成本 - 当前价) / 当前价）
 *   F04  peak_count            有效峰值数量（≥ minProminence）
 *   F05  dominant_peak_share   主峰筹码占比
 *   F06  dominant_peak_distance 主峰价格偏离度（(主峰价 - 当前价) / 当前价）
 *   F07  nearest_resistance    最近上方阻力价（最近的上方峰值价格 / 当前价 - 1）
 *   F08  band_70_width         70% 成本带宽度（占当前价的比例）
 *   F09  band_90_width         90% 成本带宽度（占当前价的比例）
 *   F10  lower_peak_retention  前日下方峰值今日留存率（∂筹码稳定性）
 *   F11  peak_shift_5d         5日主峰价格漂移（(今日主峰 - 5日前主峰) / 当前价）
 *   F12  wasserstein_5d        5日 Wasserstein 距离（分布变化幅度）
 *   F13  cyq_maturity          数据成熟度（windowDays / lookback）
 *   F14  double_peak_gap       双峰间距（仅当 peak_count ≥ 2；否则 null）
 *   F15  valley_fill_rate_5d   5日谷底填充率（双峰间低谷区筹码增长速率）
 *
 * 注意：F10/F11/F12/F15 需要前一个时间点（通常 5 日前）的分布，
 *       调用方需自行提供 prevResult（否则这些字段返回 null）。
 */

import { createLogger } from '../logger.mjs';

const log = createLogger('chip-features');

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：在分布数组中定位某价格对应的桶索引
// ─────────────────────────────────────────────────────────────────────────────

function priceToBucketIdx(price, gridMin, dp, nBuckets) {
  const k = Math.floor((price - gridMin) / dp);
  return Math.max(0, Math.min(nBuckets - 1, k));
}

// ─────────────────────────────────────────────────────────────────────────────
// F12：1D Wasserstein 距离（EMD）
// W₁(P, Q) = ∫|CDF_P(x) − CDF_Q(x)| dx  ≈ Σ|CDF_P[k] − CDF_Q[k]| * dp
// 要求两个分布具有相同的网格（gridMin、dp、nBuckets 对齐）
// ─────────────────────────────────────────────────────────────────────────────

function wasserstein1d(distA, distB, dp) {
  if (distA.length !== distB.length) return null;
  let cdfA = 0;
  let cdfB = 0;
  let emd  = 0;
  for (let k = 0; k < distA.length; k++) {
    cdfA += distA[k];
    cdfB += distB[k];
    emd  += Math.abs(cdfA - cdfB) * dp;
  }
  return emd;
}

// ─────────────────────────────────────────────────────────────────────────────
// F15：谷底填充率
// 对于双峰场景，计算两峰之间谷底区域（低于两峰均高的 50% 的区间）的筹码增长
// ─────────────────────────────────────────────────────────────────────────────

function valleyFillRate(currDist, prevDist, peak1BucketIdx, peak2BucketIdx) {
  if (!prevDist || peak1BucketIdx == null || peak2BucketIdx == null) return null;
  const lo = Math.min(peak1BucketIdx, peak2BucketIdx);
  const hi = Math.max(peak1BucketIdx, peak2BucketIdx);
  if (hi - lo < 2) return null;

  let currValley = 0;
  let prevValley = 0;
  for (let k = lo + 1; k < hi; k++) {
    currValley += currDist[k];
    prevValley += (prevDist[k] ?? 0);
  }
  if (prevValley === 0) return null;
  return +((currValley - prevValley) / prevValley).toFixed(6);
}

// ─────────────────────────────────────────────────────────────────────────────
// 主特征提取函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从筹码分布结果中提取量化特征
 *
 * @param {import('./chip-engine.mjs').ChipResult} curr - 当日筹码分布（computeChipDistribution 返回值）
 * @param {import('./chip-engine.mjs').ChipResult|null} [prev] - 5日前筹码分布（用于计算时序特征 F10/F11/F12/F15）
 * @returns {ChipFeatures | null}
 *
 * @typedef {object} ChipFeatures
 * @property {string}      tsCode
 * @property {string}      date
 * @property {number}      profit_ratio
 * @property {number}      upper_chip_ratio
 * @property {number}      avg_cost_distance
 * @property {number}      peak_count
 * @property {number}      dominant_peak_share
 * @property {number}      dominant_peak_distance
 * @property {number|null} nearest_resistance
 * @property {number}      band_70_width
 * @property {number}      band_90_width
 * @property {number|null} lower_peak_retention
 * @property {number|null} peak_shift_5d
 * @property {number|null} wasserstein_5d
 * @property {number}      cyq_maturity
 * @property {number|null} double_peak_gap
 * @property {number|null} valley_fill_rate_5d
 */
export function extractChipFeatures(curr, prev = null) {
  if (!curr) return null;

  const {
    distribution: dist,
    gridMin,
    dp,
    nBuckets,
    currentPrice,
    avgCost,
    profitRatio,
    peaks,
    band70,
    band90,
    cyqMaturity,
    tsCode,
    date,
  } = curr;

  if (!dist || dist.length === 0) return null;

  const currentBucketIdx = priceToBucketIdx(currentPrice, gridMin, dp, nBuckets);

  // ── F01 / F02 ──
  const profit_ratio     = +profitRatio.toFixed(6);
  const upper_chip_ratio = +(1 - profitRatio).toFixed(6);

  // ── F03 均成本偏离度 ──
  const avg_cost_distance = currentPrice > 0
    ? +((avgCost - currentPrice) / currentPrice).toFixed(6)
    : 0;

  // ── F04 / F05 / F06 峰值相关 ──
  const peak_count = peaks.length;
  const dominantPeak = peaks[0] ?? null;

  const dominant_peak_share = dominantPeak
    ? +dominantPeak.share.toFixed(6)
    : 0;

  const dominant_peak_distance = (dominantPeak && currentPrice > 0)
    ? +((dominantPeak.price - currentPrice) / currentPrice).toFixed(6)
    : 0;

  // ── F07 最近上方阻力 ──
  const abovePeaks = peaks.filter((p) => p.price > currentPrice);
  const nearest_resistance = abovePeaks.length > 0 && currentPrice > 0
    ? +((abovePeaks[0].price / currentPrice) - 1).toFixed(6)
    : null;

  // ── F08 / F09 成本带宽度 ──
  const band_70_width = (band70 && currentPrice > 0)
    ? +((band70.high - band70.low) / currentPrice).toFixed(6)
    : 0;

  const band_90_width = (band90 && currentPrice > 0)
    ? +((band90.high - band90.low) / currentPrice).toFixed(6)
    : 0;

  // ── F13 数据成熟度 ──
  const cyq_maturity = +cyqMaturity.toFixed(4);

  // ── F14 双峰间距 ──
  let double_peak_gap = null;
  let peak1BucketIdx  = null;
  let peak2BucketIdx  = null;
  if (peak_count >= 2 && currentPrice > 0) {
    // 找主峰与次峰（按价格排序，保证 peak1 < peak2）
    const sorted = peaks.slice(0, 2).sort((a, b) => a.price - b.price);
    double_peak_gap     = +((sorted[1].price - sorted[0].price) / currentPrice).toFixed(6);
    peak1BucketIdx      = sorted[0].bucketIdx;
    peak2BucketIdx      = sorted[1].bucketIdx;
  }

  // ── 时序特征（需要 prev 分布）──
  let lower_peak_retention = null;
  let peak_shift_5d        = null;
  let wasserstein_5d       = null;
  let valley_fill_rate_5d  = null;

  if (prev && prev.distribution) {
    const prevDist = prev.distribution;

    // F10：下方峰值留存率
    // 取 prev 的主峰（若在当前价格以下）在同一桶位的今日占比 / prev 占比
    const prevDominant = prev.peaks?.[0] ?? null;
    if (
      prevDominant &&
      prevDominant.price < currentPrice &&
      prevDominant.bucketIdx < nBuckets
    ) {
      const prevShare = prevDominant.share;
      const currShare = dist[prevDominant.bucketIdx] ?? 0;
      lower_peak_retention = prevShare > 0
        ? +(currShare / prevShare).toFixed(6)
        : null;
    }

    // F11：5日主峰价格漂移
    if (dominantPeak && prev.peaks?.[0] && currentPrice > 0) {
      peak_shift_5d = +((dominantPeak.price - prev.peaks[0].price) / currentPrice).toFixed(6);
    }

    // F12：Wasserstein 距离
    // 如果两分布网格一致，可直接计算；否则跳过（V1 简化处理）
    if (
      Math.abs(curr.gridMin - prev.gridMin) < dp * 0.5 &&
      curr.nBuckets === prev.nBuckets &&
      Math.abs(curr.dp - prev.dp) < 1e-6
    ) {
      const wdRaw = wasserstein1d(dist, prevDist, dp);
      wasserstein_5d = wdRaw !== null ? +wdRaw.toFixed(6) : null;
    }

    // F15：谷底填充率（仅双峰场景）
    valley_fill_rate_5d = valleyFillRate(dist, prevDist, peak1BucketIdx, peak2BucketIdx);
  }

  return {
    tsCode,
    date,
    // ── 静态特征（单日）──
    profit_ratio,
    upper_chip_ratio,
    avg_cost_distance,
    peak_count,
    dominant_peak_share,
    dominant_peak_distance,
    nearest_resistance,
    band_70_width,
    band_90_width,
    // ── 时序特征（需要 prev）──
    lower_peak_retention,
    peak_shift_5d,
    wasserstein_5d,
    cyq_maturity,
    double_peak_gap,
    valley_fill_rate_5d,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量特征提取（跨窗口）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从多窗口结果（computeChipMultiWindow）中提取并合并特征
 * 返回带前缀的扁平特征对象，如 cyq120_profit_ratio, cyq250_band_70_width …
 *
 * @param {object} multiWindowResult  - { cyq_60, cyq_120, cyq_250 }
 * @param {object} [prevMultiWindow]  - 5日前对应的 multiWindowResult
 * @returns {object}
 */
export function extractMultiWindowFeatures(multiWindowResult, prevMultiWindow = {}) {
  const combined = {};
  for (const [key, chipResult] of Object.entries(multiWindowResult)) {
    if (!chipResult) continue;
    const prevResult = prevMultiWindow[key] ?? null;
    const features   = extractChipFeatures(chipResult, prevResult);
    if (!features) continue;
    // 去掉 tsCode/date，加前缀
    const prefix = key;   // 如 "cyq_120"
    for (const [fk, fv] of Object.entries(features)) {
      if (fk === 'tsCode' || fk === 'date') continue;
      combined[`${prefix}_${fk}`] = fv;
    }
  }
  return combined;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI 验证
// node server/chip/chip-features.mjs 300059.SZ 20240101
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv[1]?.includes('chip-features')) {
  const { computeChipDistribution } = await import('./chip-engine.mjs');

  const tsCode     = process.argv[2] ?? '300059.SZ';
  const targetDate = process.argv[3] ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const curr = computeChipDistribution(tsCode, targetDate, { lookback: 120 });
  if (!curr) {
    console.error('数据不足，无法提取特征');
    process.exitCode = 1;
  } else {
    const features = extractChipFeatures(curr);
    console.log(`\n筹码特征 — ${tsCode}  ${targetDate}\n`);
    for (const [k, v] of Object.entries(features)) {
      const display = v == null ? 'null' : typeof v === 'number' ? v.toFixed(4) : v;
      console.log(`  ${k.padEnd(28)}: ${display}`);
    }
  }
}
