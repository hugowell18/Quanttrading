/**
 * 板块 RPS（相对价格强度）排名计算器
 * Phase 3 / 需求 11（RPS 排名）/ 任务书 3.3
 *
 * RPS = 板块在指定周期内涨幅的百分位排名（0–100）
 *   rps3  = 3 日涨幅在全市场板块中的百分位
 *   rps10 = 10 日涨幅百分位
 *   rps20 = 20 日涨幅百分位
 *
 * 强主线信号：rps3 > 90 且 rps10 > 80
 *
 * 用法（模块导入）：
 *   import { computeSectorRps } from './rps-calculator.mjs';
 */

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 计算一组数值中某个值的百分位排名（0–100）
 * 百分位 = 小于该值的数量 / 总数量 * 100
 */
function percentileRank(values, target) {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v < target).length;
  return round2((below / values.length) * 100);
}

/**
 * 从历史序列中取指定日期之前（含当日）最近 N 条记录
 * @param {object[]} history  按 date 升序排列，每条含 { date: 'YYYYMMDD', pctChg: number }
 * @param {string}   date     截止日期 YYYYMMDD
 * @param {number}   n        取最近 N 条
 */
function recentRows(history, date, n) {
  const filtered = history.filter((r) => r.date <= date);
  return filtered.slice(-n);
}

/**
 * 计算某板块在指定周期内的累计涨幅（%）
 * 取最近 period+1 条，首尾价格变化率
 */
function periodReturn(history, date, period) {
  const rows = recentRows(history, date, period + 1);
  if (rows.length < 2) return null;
  const first = rows[0].close ?? rows[0].pctChg;  // 优先用收盘价
  const last  = rows[rows.length - 1].close ?? null;

  // 若有收盘价序列，用首尾价格计算
  if (first != null && last != null && typeof first === 'number' && first > 0) {
    return round2((last / first - 1) * 100);
  }

  // 否则用涨跌幅累加近似（复利）
  const pctRows = recentRows(history, date, period);
  if (pctRows.length === 0) return null;
  const compound = pctRows.reduce((acc, r) => acc * (1 + (r.pctChg ?? 0) / 100), 1);
  return round2((compound - 1) * 100);
}

// ──────────────────────────────────────────────
// 主函数
// ──────────────────────────────────────────────

/**
 * 计算所有板块的 RPS 排名
 *
 * @param {string} date  计算截止日期 YYYYMMDD
 * @param {Array<{
 *   name: string,
 *   history: Array<{ date: string, pctChg: number, close?: number }>
 * }>} sectorHistories  各板块历史数据（按 date 升序）
 * @param {number[]} periods  计算周期，默认 [3, 10, 20]
 * @returns {Map<string, { rps3: number, rps10: number, rps20: number, isStrongMainline: boolean }>}
 */
export function computeSectorRps(date, sectorHistories, periods = [3, 10, 20]) {
  const [p3, p10, p20] = periods;

  // 计算每个板块在各周期的收益率
  const returns = sectorHistories.map((sector) => ({
    name:  sector.name,
    r3:    periodReturn(sector.history, date, p3),
    r10:   periodReturn(sector.history, date, p10),
    r20:   periodReturn(sector.history, date, p20),
  }));

  // 提取各周期的全市场收益率分布（过滤 null）
  const all3  = returns.map((r) => r.r3).filter((v) => v != null);
  const all10 = returns.map((r) => r.r10).filter((v) => v != null);
  const all20 = returns.map((r) => r.r20).filter((v) => v != null);

  const result = new Map();

  for (const { name, r3, r10, r20 } of returns) {
    const rps3  = r3  != null ? percentileRank(all3,  r3)  : 50;
    const rps10 = r10 != null ? percentileRank(all10, r10) : 50;
    const rps20 = r20 != null ? percentileRank(all20, r20) : 50;

    result.set(name, {
      rps3,
      rps10,
      rps20,
      // 强主线信号：3日RPS>90 且 10日RPS>80
      isStrongMainline: rps3 > 90 && rps10 > 80,
      // 原始收益率（调试用）
      return3:  r3,
      return10: r10,
      return20: r20,
    });
  }

  return result;
}
