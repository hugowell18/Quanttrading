/**
 * 仓位管理模块
 * Phase 4.1 / 需求 14 / 任务书 4.1
 *
 * 规则：
 *   - 总仓位上限由情绪状态机决定（冰点0% / 启动30% / 主升80% / 高潮50% / 退潮0%）
 *   - 通道 A 占总仓位 70%，通道 B 占 30%
 *   - 同时持仓不超过 5 只
 *   - 单股仓位上限由 channel-a-selector 的市值分档决定（15%/18%/20%）
 *
 * 用法（模块导入）：
 *   import { getAvailablePosition, tryOpenPosition } from './position-manager.mjs';
 */
import { STATE_POSITION_LIMITS } from '../sentiment/sentiment-state-machine.mjs';

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────

/** 通道资金分配比例 */
export const CHANNEL_ALLOCATION = { A: 0.70, B: 0.30 };

/** 最大同时持仓只数 */
export const MAX_POSITIONS = 5;

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * 获取情绪状态对应的总仓位上限（0–1）
 * @param {string} state 情绪状态
 */
function getTotalLimit(state) {
  return STATE_POSITION_LIMITS[state] ?? 0;
}

/**
 * 计算当前已用仓位（各持仓 positionRatio 之和）
 * @param {object[]} positions  持仓列表，每条含 { positionRatio: number }
 */
function usedRatio(positions) {
  return positions.reduce((sum, p) => sum + (p.positionRatio ?? 0), 0);
}

/**
 * 计算某通道已用仓位
 * @param {object[]} positions
 * @param {'A'|'B'} channel
 */
function channelUsedRatio(positions, channel) {
  return positions
    .filter((p) => p.channel === channel)
    .reduce((sum, p) => sum + (p.positionRatio ?? 0), 0);
}

// ──────────────────────────────────────────────
// 主函数 1：查询可用仓位
// ──────────────────────────────────────────────

/**
 * 计算当前可用仓位
 *
 * @param {string}   state      情绪状态（'冰点'|'启动'|'主升'|'高潮'|'退潮'）
 * @param {object[]} positions  当前持仓列表
 *   每条：{ code, channel: 'A'|'B', positionRatio: number（占总资金比例 0-1）}
 * @param {'A'|'B'}  channel    要查询的通道
 * @returns {{
 *   available: number,      // 该通道还可用的仓位比例（0-1）
 *   totalLimit: number,     // 情绪状态决定的总仓位上限
 *   channelLimit: number,   // 该通道的仓位上限
 *   totalUsed: number,      // 当前总已用仓位
 *   channelUsed: number,    // 该通道已用仓位
 *   positionCount: number,  // 当前持仓只数
 *   reason: string | null   // 为 null 时表示可以开仓
 * }}
 */
export function getAvailablePosition(state, positions, channel) {
  const totalLimit   = getTotalLimit(state);
  const channelAlloc = CHANNEL_ALLOCATION[channel] ?? 0;
  const channelLimit = round4(totalLimit * channelAlloc);

  const totalUsed   = round4(usedRatio(positions));
  const channelUsed = round4(channelUsedRatio(positions, channel));
  const posCount    = positions.length;

  // 可用 = min(通道剩余, 总仓位剩余)
  const channelRemain = Math.max(0, channelLimit - channelUsed);
  const totalRemain   = Math.max(0, totalLimit - totalUsed);
  const available     = round4(Math.min(channelRemain, totalRemain));

  // 判断是否可以开仓
  let reason = null;
  if (state === '冰点' || state === '退潮') {
    reason = `情绪状态[${state}]禁止开仓`;
  } else if (posCount >= MAX_POSITIONS) {
    reason = `持仓已达上限 ${MAX_POSITIONS} 只`;
  } else if (available <= 0) {
    reason = `通道${channel}仓位已满（已用${(channelUsed * 100).toFixed(1)}% / 上限${(channelLimit * 100).toFixed(1)}%）`;
  }

  return {
    available,
    totalLimit,
    channelLimit,
    totalUsed,
    channelUsed,
    positionCount: posCount,
    reason,
  };
}

// ──────────────────────────────────────────────
// 主函数 2：尝试开仓
// ──────────────────────────────────────────────

/**
 * 尝试开仓，返回是否允许及原因
 *
 * @param {string}   state      情绪状态
 * @param {object[]} positions  当前持仓列表
 * @param {object}   candidate  候选股信息
 *   { code, channel: 'A'|'B', positionCap: number（单股仓位上限 0-1）}
 * @returns {{
 *   ok: boolean,
 *   allocatedRatio: number,  // 建议分配的仓位比例（ok=true 时有效）
 *   reason: string | null
 * }}
 */
export function tryOpenPosition(state, positions, candidate) {
  const { code, channel, positionCap = 0.20 } = candidate;

  // 检查是否已持有该股
  if (positions.some((p) => p.code === code)) {
    return { ok: false, allocatedRatio: 0, reason: `已持有 ${code}，不重复开仓` };
  }

  const avail = getAvailablePosition(state, positions, channel);

  if (avail.reason) {
    return { ok: false, allocatedRatio: 0, reason: avail.reason };
  }

  // 实际分配 = min(可用仓位, 单股上限)
  const allocatedRatio = round4(Math.min(avail.available, positionCap));

  if (allocatedRatio <= 0) {
    return { ok: false, allocatedRatio: 0, reason: '可用仓位不足' };
  }

  return { ok: true, allocatedRatio, reason: null };
}

// ──────────────────────────────────────────────
// 辅助：计算开仓金额
// ──────────────────────────────────────────────

/**
 * 根据仓位比例计算开仓金额（元）
 * @param {number} totalCapital   总资金（元）
 * @param {number} allocatedRatio 分配比例（0-1）
 * @param {number} price          买入价格（元/股）
 * @returns {{ amount: number, shares: number }}  金额和股数（100股整数倍）
 */
export function calcOpenAmount(totalCapital, allocatedRatio, price) {
  const amount = totalCapital * allocatedRatio;
  const rawShares = Math.floor(amount / price);
  // A 股最小交易单位 100 股
  const shares = Math.floor(rawShares / 100) * 100;
  return {
    amount: round4(shares * price),
    shares,
  };
}


