/**
 * 连续亏损熔断机制
 * Phase 4.3 / 需求 16 / 任务书 4.3
 *
 * 规则：
 *   - 连续 3 笔交易亏损 → 触发熔断，暂停新开仓 2 个交易日
 *   - 熔断期间止损规则仍正常执行
 *   - 熔断期满自动恢复
 *
 * 持久化：cache/risk/circuit-breaker.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RISK_DIR = resolve(ROOT, 'cache', 'risk');
const CB_PATH = resolve(RISK_DIR, 'circuit-breaker.json');
mkdirSync(RISK_DIR, { recursive: true });

const CONSECUTIVE_LOSS_THRESHOLD = 3;  // 连续亏损触发笔数
const PAUSE_TRADING_DAYS = 2;          // 暂停交易日数

// ──────────────────────────────────────────────
// 持久化
// ──────────────────────────────────────────────

function readState() {
  if (!existsSync(CB_PATH)) return { trades: [], triggeredAt: null };
  return JSON.parse(readFileSync(CB_PATH, 'utf8'));
}

function writeState(state) {
  writeFileSync(CB_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// ──────────────────────────────────────────────
// 工具：向前偏移 N 个工作日（跳周末，不处理节假日）
// ──────────────────────────────────────────────

function addTradingDays(yyyymmdd, days) {
  const d = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────
// 主函数 1：检查熔断状态
// ──────────────────────────────────────────────

/**
 * 检查当日是否处于熔断暂停状态
 *
 * @param {string} today  当日 YYYYMMDD
 * @returns {{
 *   active: boolean,          // 是否处于熔断中
 *   remainingDays: number,    // 剩余暂停天数（0 表示今日可恢复）
 *   triggeredAt: string|null, // 触发日期
 *   resumeAt: string|null,    // 恢复日期
 * }}
 */
export function checkCircuitBreaker(today) {
  const state = readState();

  if (!state.triggeredAt) {
    return { active: false, remainingDays: 0, triggeredAt: null, resumeAt: null };
  }

  const resumeAt = addTradingDays(state.triggeredAt, PAUSE_TRADING_DAYS);

  if (today >= resumeAt) {
    return { active: false, remainingDays: 0, triggeredAt: state.triggeredAt, resumeAt };
  }

  // 计算剩余天数（简单估算：按日历天数）
  const todayDate  = new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`);
  const resumeDate = new Date(`${resumeAt.slice(0, 4)}-${resumeAt.slice(4, 6)}-${resumeAt.slice(6, 8)}`);
  const diffMs = resumeDate - todayDate;
  const remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return { active: true, remainingDays, triggeredAt: state.triggeredAt, resumeAt };
}

// ──────────────────────────────────────────────
// 主函数 2：记录交易结果
// ──────────────────────────────────────────────

/**
 * 记录一笔交易结果，并判断是否触发熔断
 *
 * @param {object} trade
 *   { date: string, code: string, returnPct: number, ... }
 * @returns {{
 *   triggered: boolean,   // 本次记录是否触发了新的熔断
 *   triggeredAt: string|null,
 *   consecutiveLosses: number,
 * }}
 */
export function recordTradeResult(trade) {
  const state = readState();

  // 追加交易记录（只保留最近 10 笔，够判断连续亏损即可）
  state.trades = [...(state.trades ?? []), trade].slice(-10);

  // 统计末尾连续亏损笔数
  let consecutiveLosses = 0;
  for (let i = state.trades.length - 1; i >= 0; i--) {
    if ((state.trades[i].returnPct ?? 0) < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }

  // 触发熔断条件
  const shouldTrigger = consecutiveLosses >= CONSECUTIVE_LOSS_THRESHOLD;

  if (shouldTrigger && !state.triggeredAt) {
    state.triggeredAt = trade.date;
  }

  // 如果已经过了恢复日期，清除熔断状态
  if (state.triggeredAt) {
    const resumeAt = addTradingDays(state.triggeredAt, PAUSE_TRADING_DAYS);
    if (trade.date >= resumeAt) {
      state.triggeredAt = null;
    }
  }

  writeState(state);

  return {
    triggered: shouldTrigger && state.triggeredAt === trade.date,
    triggeredAt: state.triggeredAt,
    consecutiveLosses,
  };
}

/**
 * 读取最近交易记录
 */
export function readRecentTrades() {
  return readState().trades ?? [];
}

/**
 * 重置熔断状态（手动干预用）
 * 同时清空交易记录，确保完全重置
 */
export function resetCircuitBreaker() {
  writeState({ trades: [], triggeredAt: null });
}
