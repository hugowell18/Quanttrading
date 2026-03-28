/**
 * 模拟盘模式（Paper Trading）
 * Phase 4.8 / 需求 18 / 任务书 4.8
 *
 * 通过环境变量 ZT_MODE=paper 启用模拟盘：
 *   - 所有下单动作只写日志，不发真实委托
 *   - 模拟盘开始时锁定策略参数，防止调参过拟合
 *   - 4.9 实盘切换时，ZT_MODE=live 且 paperOrder 替换为 QMT 委托
 *
 * 用法：
 *   ZT_MODE=paper node server/daily-scheduler.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const PAPER_DIR = resolve(ROOT, 'cache', 'risk', 'paper-orders');
const PARAMS_PATH = resolve(ROOT, 'cache', 'risk', 'paper-params.json');
mkdirSync(PAPER_DIR, { recursive: true });
mkdirSync(resolve(ROOT, 'cache', 'risk'), { recursive: true });

// ──────────────────────────────────────────────
// 模式判断
// ──────────────────────────────────────────────

/**
 * 是否处于模拟盘模式
 * @returns {boolean}
 */
export function isPaperMode() {
  return process.env.ZT_MODE === 'paper';
}

// ──────────────────────────────────────────────
// 模拟下单
// ──────────────────────────────────────────────

/**
 * 模拟下单：写入日志，不发真实委托
 *
 * @param {object} order
 *   {
 *     date:    string,           // YYYYMMDD
 *     time:    string,           // HH:MM:SS
 *     code:    string,           // 股票代码
 *     name:    string,           // 股票名称
 *     action:  'buy' | 'sell',   // 操作方向
 *     price:   number,           // 委托价格
 *     shares:  number,           // 委托股数
 *     channel: 'A' | 'B',        // 通道
 *     reason:  string,           // 触发原因
 *   }
 * @returns {{ ok: boolean, orderId: string, message: string }}
 */
export async function paperOrder(order) {
  const orderId = `PAPER-${order.date}-${order.code}-${Date.now()}`;
  const record = {
    ...order,
    orderId,
    mode: 'paper',
    submittedAt: new Date().toISOString(),
    status: 'simulated',
  };

  const filePath = resolve(PAPER_DIR, `${order.date}.json`);
  const existing = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, 'utf8'))
    : [];
  existing.push(record);
  writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');

  return {
    ok: true,
    orderId,
    message: `[PAPER] ${order.action.toUpperCase()} ${order.code} ${order.shares}股 @${order.price}`,
  };
}

/**
 * 读取指定日期的模拟订单记录
 * @param {string} date - YYYYMMDD
 * @returns {object[]}
 */
export function readPaperOrders(date) {
  const filePath = resolve(PAPER_DIR, `${date}.json`);
  if (!existsSync(filePath)) return [];
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

// ──────────────────────────────────────────────
// 参数锁定
// ──────────────────────────────────────────────

/**
 * 锁定策略参数（模拟盘开始时调用一次）
 * 已锁定后拒绝覆盖，必须先手动删除 cache/risk/paper-params.json
 *
 * @param {object} params - 需要锁定的策略参数
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function lockParams(params) {
  if (existsSync(PARAMS_PATH)) {
    return { ok: false, reason: '参数已锁定，模拟盘期间禁止修改。如需重置请删除 cache/risk/paper-params.json' };
  }
  writeFileSync(PARAMS_PATH, JSON.stringify({
    lockedAt: new Date().toISOString(),
    params,
  }, null, 2), 'utf8');
  return { ok: true, reason: null };
}

/**
 * 读取已锁定的策略参数
 * @returns {{ lockedAt: string, params: object } | null}
 */
export function readLockedParams() {
  if (!existsSync(PARAMS_PATH)) return null;
  return JSON.parse(readFileSync(PARAMS_PATH, 'utf8'));
}

/**
 * 是否已锁定参数
 * @returns {boolean}
 */
export function isParamsLocked() {
  return existsSync(PARAMS_PATH);
}
