/**
 * 方向6：基本面过滤器
 *
 * 在扫描开始前，用最新财报数据对股票做基本面质量检查。
 * 不达标直接标记为"基本面弱势"，信号需额外谨慎。
 *
 * 数据源：Tushare fina_indicator 接口
 * 缓存策略：本地文件缓存，每季度更新一次
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CACHE_DIR = resolve(process.cwd(), 'results', 'fundamental-cache');
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90天（一个季度）

// 基本面合格阈值
const QUALITY_THRESHOLDS = {
  roe: 5,              // ROE ≥ 5%（近一年）
  grossProfitMargin: 20, // 毛利率 ≥ 20%
  revenueGrowth: -10,   // 营收增速 ≥ -10%（允许小幅下滑）
  currentRatio: 1.0,    // 流动比率 ≥ 1.0
};

/**
 * 从 Tushare 拉取基本面数据
 */
async function fetchFundamental(token, tsCode) {
  const response = await fetch('http://api.tushare.pro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_name: 'fina_indicator',
      token,
      params: { ts_code: tsCode, limit: 4 }, // 最近4个报告期
      fields: 'ts_code,end_date,roe,grossprofit_margin,revenue_yoy,current_ratio',
    }),
  });
  if (!response.ok) throw new Error(`Tushare upstream error: ${response.status}`);
  const payload = await response.json();
  if (payload.code !== 0) throw new Error(payload.msg || 'Tushare fina_indicator error');

  const { fields, items } = payload.data;
  return items.map((item) =>
    fields.reduce((record, field, index) => ({ ...record, [field]: item[index] }), {})
  );
}

/**
 * 缓存管理
 */
function getCachePath(tsCode) {
  mkdirSync(CACHE_DIR, { recursive: true });
  return resolve(CACHE_DIR, `${tsCode}.json`);
}

function readCache(tsCode) {
  const path = getCachePath(tsCode);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (Date.now() - data.timestamp > CACHE_TTL_MS) return null; // 过期
    return data;
  } catch {
    return null;
  }
}

function writeCache(tsCode, records, result) {
  const path = getCachePath(tsCode);
  writeFileSync(path, JSON.stringify({
    tsCode,
    timestamp: Date.now(),
    records,
    result,
  }, null, 2));
}

/**
 * 分析基本面质量
 * @param {Object[]} records - fina_indicator 返回的财报数据（最近4期）
 * @returns {{ qualified: boolean, scores: Object, warnings: string[] }}
 */
function analyzeQuality(records) {
  if (!records || !records.length) {
    return { qualified: true, scores: {}, warnings: ['无财报数据，跳过基本面检查'] };
  }

  const latest = records[0]; // 最近一期
  const warnings = [];

  const roe = Number(latest.roe ?? 0);
  const grossMargin = Number(latest.grossprofit_margin ?? 0);
  const revenueGrowth = Number(latest.revenue_yoy ?? 0);
  const currentRatio = Number(latest.current_ratio ?? 0);

  const scores = {
    roe: Number(roe.toFixed(2)),
    grossProfitMargin: Number(grossMargin.toFixed(2)),
    revenueGrowth: Number(revenueGrowth.toFixed(2)),
    currentRatio: Number(currentRatio.toFixed(2)),
    reportDate: latest.end_date,
  };

  let failCount = 0;

  if (roe < QUALITY_THRESHOLDS.roe) {
    warnings.push(`ROE ${roe.toFixed(1)}% < ${QUALITY_THRESHOLDS.roe}%`);
    failCount += 1;
  }
  if (grossMargin < QUALITY_THRESHOLDS.grossProfitMargin) {
    warnings.push(`毛利率 ${grossMargin.toFixed(1)}% < ${QUALITY_THRESHOLDS.grossProfitMargin}%`);
    failCount += 1;
  }
  if (revenueGrowth < QUALITY_THRESHOLDS.revenueGrowth) {
    warnings.push(`营收增速 ${revenueGrowth.toFixed(1)}% < ${QUALITY_THRESHOLDS.revenueGrowth}%`);
    failCount += 1;
  }
  if (currentRatio > 0 && currentRatio < QUALITY_THRESHOLDS.currentRatio) {
    warnings.push(`流动比率 ${currentRatio.toFixed(2)} < ${QUALITY_THRESHOLDS.currentRatio}`);
    failCount += 1;
  }

  // ROE 趋势：如果近4期 ROE 持续下滑，额外警告
  if (records.length >= 3) {
    const roeValues = records.slice(0, 3).map((r) => Number(r.roe ?? 0));
    if (roeValues[0] < roeValues[1] && roeValues[1] < roeValues[2]) {
      warnings.push(`ROE 连续3期下滑：${roeValues.reverse().map((v) => v.toFixed(1)).join('→')}`);
      failCount += 1;
    }
  }

  // 2项以上不达标 → 不合格
  const qualified = failCount < 2;

  return { qualified, scores, warnings, failCount };
}

/**
 * 主入口：检查股票基本面质量
 * @param {string} token - Tushare token
 * @param {string} tsCode - 如 600588.SH
 * @returns {Promise<{ qualified: boolean, scores: Object, warnings: string[] }>}
 */
export async function checkFundamental(token, tsCode) {
  // 先查缓存
  const cached = readCache(tsCode);
  if (cached) {
    return cached.result;
  }

  try {
    const records = await fetchFundamental(token, tsCode);
    const result = analyzeQuality(records);
    writeCache(tsCode, records, result);
    return result;
  } catch (error) {
    // 基本面拉取失败不阻塞流程，宽松通过
    return {
      qualified: true,
      scores: {},
      warnings: [`基本面数据拉取失败：${error.message}，跳过检查`],
    };
  }
}

export { QUALITY_THRESHOLDS };
