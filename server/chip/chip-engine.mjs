/**
 * 筹码分布引擎 (CYQ / Chip Distribution Engine)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Gate 1 最小可行原型 — 独立筹码峰量化模型
 *
 * 算法概述：
 *   1. 读取本地 K 线 CSV（已前复权：close_adj；其余字段为复权前原始值）
 *   2. 前复权调整 OHLC：adj_factor = close_adj / close，应用到 high/low/vwap
 *   3. VWAP-centered 三角核：每日交易量按三角分布分配到价格桶
 *   4. Log-sum 留存率（防双精度下溢）：
 *        logRetSuffix[i] = Σ log(1 − turnover_rate[j]/100)  for j = i+1 … n−1
 *        retention[i] = exp(logRetSuffix[i])
 *   5. 自适应 Gaussian 平滑：σ = ATR₁₄ × ratio（默认 0.3）→ 转为桶数单位
 *   6. 峰值检测（最小突出度过滤）
 *   7. 最窄成本带（70% / 90%）
 *
 * 数据单位约定（Tushare pro_bar）：
 *   amount: 千元（1000 元），volume: 手（100 股）
 *   → VWAP（元/股）= amount * 1000 / (volume * 100) = amount * 10 / volume
 *
 * V1 限制：使用 turnover_rate（全部股本），待 V2 升级为 turnover_rate_f（自由流通）
 *
 * 用法：
 *   import { computeChipDistribution } from './chip-engine.mjs';
 *   const result = computeChipDistribution('300059.SZ', '20240101', { lookback: 120 });
 */

import { createLogger } from '../logger.mjs';
import { readDaily } from '../data/csv-manager.mjs';

const log = createLogger('chip-engine');

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_N_BUCKETS          = 200;   // 价格轴分桶数
const DEFAULT_LOOKBACK           = 120;   // 默认回望窗口（交易日）
const DEFAULT_SMOOTH_ATR_RATIO   = 0.30;  // Gaussian σ = ATR * ratio
const DEFAULT_MIN_PROMINENCE     = 0.015; // 峰值最小突出度（占总权重比）
const MAX_TURNOVER_RATE          = 99.9;  // 换手率上限（防止 log(0)）

// ─────────────────────────────────────────────────────────────────────────────
// 工具：日期偏移（用于确定回望窗口起始日期范围）
// ─────────────────────────────────────────────────────────────────────────────

function shiftDateByCalendarDays(yyyymmdd, calendarDays) {
  const d = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
  d.setDate(d.getDate() + calendarDays);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// 前复权调整（adj_factor = close_adj / close）
// ─────────────────────────────────────────────────────────────────────────────

function buildAdjRows(rows) {
  return rows.map((row) => {
    const adjFactor = (row.close > 0 && row.close_adj > 0)
      ? row.close_adj / row.close
      : 1;

    // VWAP (元/股)：amount 千元，volume 手（100股/手）
    const vwapRaw = row.volume > 0
      ? (row.amount * 10) / row.volume
      : row.close;

    const highAdj  = row.high  * adjFactor;
    const lowAdj   = row.low   * adjFactor;
    const vwapAdj  = Math.max(lowAdj, Math.min(highAdj, vwapRaw * adjFactor));

    return {
      trade_date:    row.trade_date,
      highAdj,
      lowAdj,
      vwapAdj,
      volume:        row.volume,
      turnover_rate: row.turnover_rate,
      closeAdj:      row.close_adj > 0 ? row.close_adj : row.close * adjFactor,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 三角核：将 weight 分配到价格桶
// ─────────────────────────────────────────────────────────────────────────────
// 三角分布 CDF on [a, b] with mode m:
//   F(x) = (x-a)² / ((b-a)(m-a))    for a ≤ x ≤ m
//   F(x) = 1 − (b-x)² / ((b-a)(b-m)) for m < x ≤ b

function addTriangularKernel(dist, gridMin, dp, lowAdj, highAdj, vwapAdj, weight) {
  if (!isFinite(weight) || weight <= 0) return;
  if (!isFinite(lowAdj) || !isFinite(highAdj) || !isFinite(vwapAdj)) return;

  const n = dist.length;

  // Doji（高低相等）：全部权重放入最近桶
  if (highAdj <= lowAdj) {
    const k = Math.max(0, Math.min(n - 1, Math.floor((vwapAdj - gridMin) / dp)));
    dist[k] += weight;
    return;
  }

  const a = lowAdj;
  const b = highAdj;
  const m = vwapAdj;                 // 已 clamp 至 [a, b]
  const spanAB = b - a;
  const spanAM = m - a;              // 左侧跨度（≥ 0）
  const spanMB = b - m;              // 右侧跨度（≥ 0）

  const triCdf = (x) => {
    if (x <= a) return 0;
    if (x >= b) return 1;
    if (x <= m) return spanAM > 0 ? (x - a) ** 2 / (spanAB * spanAM) : 0;
    return spanMB > 0 ? 1 - (b - x) ** 2 / (spanAB * spanMB) : 1;
  };

  // 只遍历 [low, high] 覆盖的桶
  const kMin = Math.max(0, Math.floor((a - gridMin) / dp));
  const kMax = Math.min(n - 1, Math.ceil((b - gridMin) / dp));

  for (let k = kMin; k <= kMax; k++) {
    const bucketL = gridMin + k * dp;
    const bucketR = bucketL + dp;
    const cdfL = triCdf(Math.max(bucketL, a));
    const cdfR = triCdf(Math.min(bucketR, b));
    const fraction = Math.max(0, cdfR - cdfL);
    if (fraction > 0) dist[k] += weight * fraction;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATR₁₄（真实波动幅度均值，以调整价计算）
// ─────────────────────────────────────────────────────────────────────────────

function computeAtr14(adjRows) {
  const last = adjRows.slice(-15);
  if (last.length < 2) return last[0]?.highAdj - last[0]?.lowAdj || 1;
  let sum = 0;
  for (let i = 1; i < last.length; i++) {
    const prevClose = last[i - 1].closeAdj;
    const tr = Math.max(
      last[i].highAdj - last[i].lowAdj,
      Math.abs(last[i].highAdj - prevClose),
      Math.abs(last[i].lowAdj  - prevClose),
    );
    sum += tr;
  }
  return sum / (last.length - 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gaussian 平滑（1D 卷积，以桶数为单位的 σ）
// ─────────────────────────────────────────────────────────────────────────────

function gaussianSmooth(dist, sigmaBuckets) {
  if (sigmaBuckets < 0.3) return dist.slice();
  const radius = Math.ceil(sigmaBuckets * 3);
  const kernel = [];
  let kernelSum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-0.5 * (i / sigmaBuckets) ** 2);
    kernel.push(w);
    kernelSum += w;
  }
  const norm = kernel.map((w) => w / kernelSum);
  const smoothed = new Array(dist.length).fill(0);
  for (let k = 0; k < dist.length; k++) {
    for (let j = 0; j < norm.length; j++) {
      const src = k + j - radius;
      if (src >= 0 && src < dist.length) {
        smoothed[k] += dist[src] * norm[j];
      }
    }
  }
  return smoothed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 峰值检测（局部极大值 + 最小突出度过滤）
// ─────────────────────────────────────────────────────────────────────────────

function findPeaks(dist, gridMin, dp, minProminence) {
  const totalWeight = dist.reduce((s, v) => s + v, 0);
  if (totalWeight === 0) return [];

  const peaks = [];
  for (let k = 1; k < dist.length - 1; k++) {
    if (dist[k] > dist[k - 1] && dist[k] >= dist[k + 1]) {
      const prominence = dist[k] / totalWeight;
      if (prominence >= minProminence) {
        peaks.push({
          price:     +(gridMin + (k + 0.5) * dp).toFixed(4),
          weight:    dist[k],
          share:     +prominence.toFixed(6),
          bucketIdx: k,
        });
      }
    }
  }
  // 按权重降序：index 0 = 主峰（dominant peak）
  return peaks.sort((a, b) => b.weight - a.weight);
}

// ─────────────────────────────────────────────────────────────────────────────
// 最窄成本带（覆盖 pct 比例筹码的最小连续价格区间）
// 滑动窗口 O(n)
// ─────────────────────────────────────────────────────────────────────────────

function narrowestCostBand(dist, gridMin, dp, pct) {
  const total = dist.reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  const target = total * pct;

  let bestL = 0;
  let bestR = dist.length - 1;
  let bestWidth = dist.length;
  let windowSum = 0;
  let l = 0;

  for (let r = 0; r < dist.length; r++) {
    windowSum += dist[r];
    // 收缩左边界直到窗口和不足 target
    while (l <= r && windowSum - dist[l] >= target) {
      windowSum -= dist[l];
      l += 1;
    }
    if (windowSum >= target) {
      const w = r - l + 1;
      if (w < bestWidth) {
        bestWidth = w;
        bestL = l;
        bestR = r;
      }
    }
  }

  return {
    low:  +(gridMin + bestL * dp).toFixed(4),
    high: +(gridMin + (bestR + 1) * dp).toFixed(4),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主函数：计算某股票某日的筹码分布
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 计算筹码分布
 *
 * @param {string} tsCode      - Tushare 代码，如 '300059.SZ'
 * @param {string} targetDate  - 目标日期 YYYYMMDD（取该日或最近的可用日）
 * @param {object} [options]
 * @param {number} [options.lookback=120]        - 回望窗口（交易日数）
 * @param {number} [options.nBuckets=200]         - 价格轴分桶数
 * @param {number} [options.smoothAtrRatio=0.30]  - Gaussian σ = ATR * ratio
 * @param {number} [options.minProminence=0.015]  - 峰值最小突出度
 *
 * @returns {ChipResult | null}
 *
 * @typedef {object} ChipResult
 * @property {string}   tsCode
 * @property {string}   date           - 实际使用的基准日期
 * @property {string}   targetDate
 * @property {number}   lookback
 * @property {number}   gridMin        - 价格桶起始价（元）
 * @property {number}   gridMax        - 价格桶终止价（元）
 * @property {number}   dp             - 每桶价格宽度（元）
 * @property {number}   nBuckets
 * @property {number[]} distribution   - 归一化筹码密度数组（已平滑），length = nBuckets
 * @property {number[]} rawDistribution - 归一化密度数组（平滑前）
 * @property {number}   avgCost        - 平均成本（元）
 * @property {number}   profitRatio    - 获利盘比例（0~1）
 * @property {number}   currentPrice   - 当日收盘价（前复权）
 * @property {Peak[]}   peaks          - 峰值列表（按权重降序）
 * @property {Band}     band70         - 覆盖 70% 筹码最窄价格带
 * @property {Band}     band90         - 覆盖 90% 筹码最窄价格带
 * @property {number}   windowDays     - 实际使用的交易日数（≤ lookback）
 * @property {number}   cyqMaturity    - 数据成熟度 windowDays/lookback（0~1）
 * @property {number}   atr14          - ATR₁₄（前复权）
 * @property {number}   sigmaBuckets   - Gaussian σ（桶数单位）
 *
 * @typedef {object} Peak
 * @property {number} price
 * @property {number} weight
 * @property {number} share      - 占总筹码比例
 * @property {number} bucketIdx
 *
 * @typedef {object} Band
 * @property {number} low
 * @property {number} high
 */
export function computeChipDistribution(tsCode, targetDate, options = {}) {
  const {
    lookback        = DEFAULT_LOOKBACK,
    nBuckets        = DEFAULT_N_BUCKETS,
    smoothAtrRatio  = DEFAULT_SMOOTH_ATR_RATIO,
    minProminence   = DEFAULT_MIN_PROMINENCE,
  } = options;

  // ── 1. 读取 K 线（取 targetDate 前约 lookback*2 个日历天，保证有足够交易日）──
  const fetchStart = shiftDateByCalendarDays(targetDate, -(lookback * 2));
  const allRows = readDaily(tsCode, fetchStart, targetDate);

  if (allRows.length < 5) {
    log.warn('K 线数据不足', { tsCode, targetDate, rows: allRows.length });
    return null;
  }

  // 取最近 lookback 根
  const window = allRows.slice(-lookback);
  const n = window.length;

  // ── 2. 前复权调整 ──
  const adjRows = buildAdjRows(window);
  const currentRow = adjRows[n - 1];
  const currentPrice = currentRow.closeAdj;

  // ── 3. 价格网格 ──
  let gridMin = Infinity;
  let gridMax = -Infinity;
  for (const r of adjRows) {
    if (r.lowAdj  < gridMin) gridMin = r.lowAdj;
    if (r.highAdj > gridMax) gridMax = r.highAdj;
  }
  // 扩展边界 2%，避免边界截断
  gridMin = gridMin * 0.98;
  gridMax = gridMax * 1.02;
  const dp = (gridMax - gridMin) / nBuckets;

  if (!isFinite(dp) || dp <= 0) {
    log.warn('价格区间无效', { tsCode, gridMin, gridMax });
    return null;
  }

  // ── 4. Log-sum 留存率（从右到左累积）──
  // logRetSuffix[i] = Σ log(1 − tr[j]/100) for j = i+1 … n−1
  // 表示：day i 的筹码到今日（day n-1）还剩 exp(logRetSuffix[i]) 比例
  const logRetSuffix = new Float64Array(n);
  logRetSuffix[n - 1] = 0;   // 今日筹码留存率 = 1
  for (let i = n - 2; i >= 0; i--) {
    const tr = Math.min(adjRows[i + 1].turnover_rate, MAX_TURNOVER_RATE);
    const retRate = tr / 100;
    logRetSuffix[i] = logRetSuffix[i + 1] + Math.log(1 - retRate);
  }

  // ── 5. 构建原始筹码分布 ──
  const dist = new Float64Array(nBuckets);
  for (let i = 0; i < n; i++) {
    const r = adjRows[i];
    const retention = Math.exp(logRetSuffix[i]);
    const weight = r.volume * retention;  // 以手为单位，相对权重
    addTriangularKernel(dist, gridMin, dp, r.lowAdj, r.highAdj, r.vwapAdj, weight);
  }

  // ── 6. 归一化 ──
  const totalWeight = dist.reduce((s, v) => s + v, 0);
  if (totalWeight === 0) {
    log.warn('筹码总权重为 0', { tsCode, targetDate });
    return null;
  }
  const distNorm = Array.from(dist).map((v) => v / totalWeight);

  // ── 7. 自适应 Gaussian 平滑 ──
  const atr14 = computeAtr14(adjRows);
  const sigmaBuckets = Math.max(0.5, (atr14 * smoothAtrRatio) / dp);
  const smoothed = gaussianSmooth(distNorm, sigmaBuckets);

  // 平滑后重新归一化（数值误差修正）
  const smoothedSum = smoothed.reduce((s, v) => s + v, 0);
  if (smoothedSum > 0) smoothed.forEach((_, k) => { smoothed[k] /= smoothedSum; });

  // ── 8. 导出指标 ──
  let avgCostNum = 0;
  let profitWeight = 0;
  for (let k = 0; k < nBuckets; k++) {
    const price = gridMin + (k + 0.5) * dp;
    avgCostNum   += price * smoothed[k];
    if (price < currentPrice) profitWeight += smoothed[k];
  }
  const avgCost = avgCostNum;

  const peaks   = findPeaks(smoothed, gridMin, dp, minProminence);
  const band70  = narrowestCostBand(smoothed, gridMin, dp, 0.70);
  const band90  = narrowestCostBand(smoothed, gridMin, dp, 0.90);

  log.debug('筹码分布计算完成', {
    tsCode,
    date: currentRow.trade_date,
    peaks: peaks.length,
    avgCost: avgCost.toFixed(2),
    profitRatio: (profitWeight * 100).toFixed(1) + '%',
    windowDays: n,
    sigmaBuckets: sigmaBuckets.toFixed(2),
  });

  return {
    tsCode,
    date:          currentRow.trade_date,
    targetDate,
    lookback,
    gridMin:       +gridMin.toFixed(4),
    gridMax:       +gridMax.toFixed(4),
    dp:            +dp.toFixed(6),
    nBuckets,
    distribution:  smoothed,         // 已平滑归一化
    rawDistribution: distNorm,       // 平滑前归一化
    // 核心指标
    avgCost:       +avgCost.toFixed(4),
    profitRatio:   +profitWeight.toFixed(6),
    currentPrice,
    peaks,
    band70,
    band90,
    // 元信息
    windowDays:    n,
    cyqMaturity:   +(n / lookback).toFixed(4),
    atr14:         +atr14.toFixed(4),
    sigmaBuckets:  +sigmaBuckets.toFixed(4),
  };
}

/**
 * 批量计算多个窗口（60 / 120 / 250 天），方便特征提取对比
 */
export function computeChipMultiWindow(tsCode, targetDate, options = {}) {
  const windows = options.windows ?? [60, 120, 250];
  const result = {};
  for (const lb of windows) {
    result[`cyq_${lb}`] = computeChipDistribution(tsCode, targetDate, { ...options, lookback: lb });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI 验证入口
// node server/chip/chip-engine.mjs 300059.SZ 20240101
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv[1]?.includes('chip-engine')) {
  const tsCode     = process.argv[2] ?? '300059.SZ';
  const targetDate = process.argv[3] ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const lookback   = Number(process.argv[4] ?? 120);

  console.log(`\n筹码分布引擎 — ${tsCode}  截止 ${targetDate}  窗口 ${lookback}日\n`);

  const result = computeChipDistribution(tsCode, targetDate, { lookback });

  if (!result) {
    console.error('计算失败：数据不足或价格区间无效（请先运行 csv-manager.mjs 下载数据）');
    process.exitCode = 1;
  } else {
    console.log('基准日期 :', result.date);
    console.log('当前价格 :', result.currentPrice);
    console.log('平均成本 :', result.avgCost);
    console.log('获利盘   :', (result.profitRatio * 100).toFixed(1) + '%');
    console.log('数据成熟度:', (result.cyqMaturity * 100).toFixed(0) + '%', `(${result.windowDays}/${lookback} 天)`);
    console.log('ATR₁₄    :', result.atr14, '元');
    console.log('平滑 σ   :', result.sigmaBuckets, '桶');
    console.log('价格网格 :', result.gridMin.toFixed(2), '~', result.gridMax.toFixed(2),
      `（${result.nBuckets} 桶 × ${result.dp.toFixed(4)} 元/桶）`);
    console.log('');
    console.log('峰值列表（主→次）:');
    result.peaks.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i === 0 ? '主峰' : `次峰${i}`} : ¥${p.price.toFixed(2)}  占比 ${(p.share * 100).toFixed(2)}%`);
    });
    console.log('');
    if (result.band70) console.log('70% 成本带:', result.band70.low.toFixed(2), '~', result.band70.high.toFixed(2), '元');
    if (result.band90) console.log('90% 成本带:', result.band90.low.toFixed(2), '~', result.band90.high.toFixed(2), '元');

    // 文字直方图（终端验证用）
    console.log('\n筹码分布直方图（每行 = 0.5% 价格桶，#=密度）:');
    const step = Math.max(1, Math.floor(result.nBuckets / 40));
    const maxV  = Math.max(...result.distribution);
    for (let k = result.nBuckets - 1; k >= 0; k -= step) {
      const price  = result.gridMin + (k + 0.5) * result.dp;
      const val    = result.distribution[k];
      const bars   = Math.round((val / maxV) * 30);
      const bar    = '#'.repeat(bars).padEnd(30);
      const marker = Math.abs(price - result.currentPrice) < result.dp ? '<当前' : '';
      console.log(`  ${price.toFixed(2).padStart(8)} | ${bar} ${marker}`);
    }
  }
}
