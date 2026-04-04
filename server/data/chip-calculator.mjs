/**
 * 筹码分布计算器 (Chip Distribution Calculator)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 基于历史成交量计算筹码分布（CYQ），实现同花顺风格的筹码峰分析。
 * 
 * 算法：
 *   1. 读取指定回溯期内的K线数据（默认120天）
 *   2. 按价格区间（网格）统计成交量分布
 *   3. 应用衰减因子：越早的成交量权重越低（模拟换手）
 *   4. 计算关键指标：均成本、获利盘比例、集中度、主峰位置
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KLINE_DIR = resolve(process.cwd(), 'cache', 'kline');

/**
 * 解析K线CSV文件
 * @param {string} filePath
 * @returns {{ date: string, open: number, high: number, low: number, close: number, volume: number }[]}
 */
function parseKlineCsv(filePath) {
  const text = readFileSync(filePath, 'utf8').trim();
  const [_header, ...lines] = text.split(/\r?\n/);
  return lines
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',');
      return {
        date: parts[0],
        open: Number(parts[1]),
        high: Number(parts[2]),
        low: Number(parts[3]),
        close: Number(parts[4]),
        volume: Number(parts[6]),
      };
    });
}

/**
 * 计算筹码分布
 * @param {string} tsCode - 股票代码（如 300059.SZ）
 * @param {string} [targetDate] - 目标日期 YYYYMMDD，不传则取最新
 * @param {number} [lookback=120] - 回溯天数（如果不传startDate则使用此参数）
 * @param {string} [startDate] - 起始日期 YYYYMMDD（优先级高于lookback）
 * @returns {object|null} 筹码分布数据
 */
export function calculateChipDistribution(tsCode, targetDate = null, lookback = 120, startDate = null) {
  const filePath = resolve(KLINE_DIR, `${tsCode}.csv`);
  
  if (!existsSync(filePath)) {
    return null;
  }

  const allData = parseKlineCsv(filePath);
  if (allData.length === 0) return null;

  // 确定目标日期
  let endIdx = allData.length - 1;
  if (targetDate) {
    endIdx = allData.findIndex(d => d.date === targetDate);
    if (endIdx === -1) endIdx = allData.length - 1;
  }

  // 确定起始索引
  let startIdx;
  if (startDate) {
    // 如果指定了起始日期，从该日期开始
    startIdx = allData.findIndex(d => d.date === startDate);
    if (startIdx === -1) startIdx = Math.max(0, endIdx - lookback + 1);
  } else {
    // 否则使用回溯天数
    startIdx = Math.max(0, endIdx - lookback + 1);
  }

  const windowData = allData.slice(startIdx, endIdx + 1);
  
  if (windowData.length === 0) return null;

  const currentBar = windowData[windowData.length - 1];
  const currentPrice = currentBar.close;

  // ── 1. 确定价格网格范围 ──
  const allPrices = windowData.flatMap(d => [d.low, d.high]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  
  // 动态确定网格精度（根据价格范围）
  let dp = 0.01; // 默认精度
  if (priceRange > 100) dp = 0.5;
  else if (priceRange > 50) dp = 0.2;
  else if (priceRange > 20) dp = 0.1;
  else if (priceRange > 10) dp = 0.05;

  const gridMin = Math.floor(minPrice / dp) * dp;
  const gridMax = Math.ceil(maxPrice / dp) * dp;
  const nBuckets = Math.round((gridMax - gridMin) / dp) + 1;

  // ── 2. 初始化筹码分布数组 ──
  const distribution = new Array(nBuckets).fill(0);

  // ── 3. 分配成交量到价格网格（带衰减）──
  const decayRate = 0.98; // 每天衰减2%（模拟换手）
  
  windowData.forEach((bar, i) => {
    const daysAgo = windowData.length - 1 - i;
    const weight = Math.pow(decayRate, daysAgo);
    const volume = bar.volume * weight;

    // 假设成交量在 [low, high] 区间均匀分布
    const lowBucket = Math.floor((bar.low - gridMin) / dp);
    const highBucket = Math.floor((bar.high - gridMin) / dp);
    
    const bucketSpan = Math.max(1, highBucket - lowBucket + 1);
    const volumePerBucket = volume / bucketSpan;

    for (let k = lowBucket; k <= highBucket && k < nBuckets; k++) {
      if (k >= 0) distribution[k] += volumePerBucket;
    }
  });

  // ── 4. 归一化分布（转为占比）──
  const totalVolume = distribution.reduce((sum, v) => sum + v, 0);
  if (totalVolume === 0) return null;

  const normalizedDist = distribution.map(v => v / totalVolume);

  // ── 5. 计算均成本 ──
  let avgCost = 0;
  normalizedDist.forEach((weight, k) => {
    const price = gridMin + (k + 0.5) * dp;
    avgCost += price * weight;
  });

  // ── 6. 计算获利盘比例 ──
  let profitVolume = 0;
  normalizedDist.forEach((weight, k) => {
    const price = gridMin + (k + 0.5) * dp;
    if (price <= currentPrice) profitVolume += weight;
  });
  const profitRatio = profitVolume;

  // ── 7. 寻找峰值（局部最大值）──
  const peaks = [];
  for (let k = 1; k < nBuckets - 1; k++) {
    if (normalizedDist[k] > normalizedDist[k - 1] && 
        normalizedDist[k] > normalizedDist[k + 1] &&
        normalizedDist[k] > 0.01) { // 至少占1%
      peaks.push({
        price: gridMin + (k + 0.5) * dp,
        share: normalizedDist[k],
        weight: normalizedDist[k],
        bucketIdx: k,
      });
    }
  }
  peaks.sort((a, b) => b.weight - a.weight);

  // ── 8. 计算70%成本带 ──
  let band70 = null;
  const sortedBuckets = normalizedDist
    .map((weight, k) => ({ k, weight }))
    .filter(b => b.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  let accumulated = 0;
  const band70Buckets = [];
  for (const bucket of sortedBuckets) {
    band70Buckets.push(bucket.k);
    accumulated += bucket.weight;
    if (accumulated >= 0.7) break;
  }

  if (band70Buckets.length > 0) {
    const minK = Math.min(...band70Buckets);
    const maxK = Math.max(...band70Buckets);
    band70 = {
      low: gridMin + minK * dp,
      high: gridMin + (maxK + 1) * dp,
    };
  }

  // ── 9. 计算90%成本带 ──
  let band90 = null;
  accumulated = 0;
  const band90Buckets = [];
  for (const bucket of sortedBuckets) {
    band90Buckets.push(bucket.k);
    accumulated += bucket.weight;
    if (accumulated >= 0.9) break;
  }

  if (band90Buckets.length > 0) {
    const minK = Math.min(...band90Buckets);
    const maxK = Math.max(...band90Buckets);
    band90 = {
      low: gridMin + minK * dp,
      high: gridMin + (maxK + 1) * dp,
    };
  }

  // ── 10. 计算筹码集中度（成熟度）──
  // 使用基尼系数的简化版本：峰值越集中，成熟度越高
  const maxDensity = Math.max(...normalizedDist);
  const avgDensity = normalizedDist.reduce((s, v) => s + v, 0) / nBuckets;
  const cyqMaturity = Math.min(1, maxDensity / (avgDensity * 10));

  return {
    tsCode,
    date: currentBar.date,
    gridMin,
    gridMax,
    dp,
    nBuckets,
    distribution: normalizedDist,
    avgCost: Number(avgCost.toFixed(2)),
    profitRatio: Number(profitRatio.toFixed(4)),
    currentPrice,
    peaks: peaks.slice(0, 3), // 只返回前3个峰
    band70,
    band90,
    cyqMaturity: Number(cyqMaturity.toFixed(4)),
    windowDays: windowData.length,
    lookback,
  };
}
