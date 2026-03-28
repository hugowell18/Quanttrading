/**
 * 统一下单路由层
 * Phase 4.9 / 需求 18 / 任务书 4.9
 *
 * 调用方只需调 submitOrder(order)，内部根据 ZT_MODE 自动路由：
 *   ZT_MODE=paper → paperOrder()（模拟盘，4.8）
 *   ZT_MODE=live  → qmtOrder()（QMT 实盘）
 *
 * 首月半仓：ZT_MODE=live 时，live-start-date 起 30 个交易日内
 *   所有 allocatedRatio 自动乘以 0.5
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPaperMode, paperOrder } from './paper-trading.mjs';

const ROOT = process.cwd();
const RISK_DIR = resolve(ROOT, 'cache', 'risk');
const LIVE_META_PATH = resolve(RISK_DIR, 'live-meta.json');
const QMT_SCRIPT = resolve(ROOT, 'server', 'signal', 'qmt_order.py');
const PYTHON_BIN = process.env.PYTHON || 'python';
const HALF_POSITION_DAYS = 30;

mkdirSync(RISK_DIR, { recursive: true });

// ──────────────────────────────────────────────
// 模式判断
// ──────────────────────────────────────────────

export function isLiveMode() {
  return process.env.ZT_MODE === 'live';
}

// ──────────────────────────────────────────────
// 首月半仓
// ──────────────────────────────────────────────

/**
 * 读取实盘启动元数据
 * @returns {{ liveStartDate: string, recordedAt: string } | null}
 */
export function readLiveMeta() {
  if (!existsSync(LIVE_META_PATH)) return null;
  return JSON.parse(readFileSync(LIVE_META_PATH, 'utf8'));
}

/**
 * 记录实盘启动日期（首次切换实盘时调用一次）
 * 已存在时不覆盖
 * @param {string} date - YYYYMMDD
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function recordLiveStart(date) {
  if (existsSync(LIVE_META_PATH)) {
    return { ok: false, reason: '实盘启动日期已记录，不重复写入' };
  }
  writeFileSync(LIVE_META_PATH, JSON.stringify({
    liveStartDate: date,
    recordedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  return { ok: true, reason: null };
}

/**
 * 获取首月半仓系数
 * 实盘启动后 30 个交易日内返回 0.5，之后返回 1.0
 * @param {string} today - YYYYMMDD
 * @returns {Promise<number>} 0.5 或 1.0
 */
export async function getHalfPositionMultiplier(today) {
  if (!isLiveMode()) return 1.0;
  const meta = readLiveMeta();
  if (!meta) return 0.5;
  try {
    const { readDaily } = await import('../data/csv-manager.mjs');
    const calendar = readDaily('000300.SH', meta.liveStartDate, today)
      .map((r) => r.trade_date)
      .filter((d) => d >= meta.liveStartDate && d <= today);
    return calendar.length <= HALF_POSITION_DAYS ? 0.5 : 1.0;
  } catch {
    return 0.5;
  }
}

// ──────────────────────────────────────────────
// QMT 实盘委托
// ──────────────────────────────────────────────

/**
 * 通过 QMT Python 脚本发送真实委托
 * @param {object} order
 * @returns {{ ok: boolean, orderId: string | null, message: string }}
 */
function qmtOrder(order) {
  if (!existsSync(QMT_SCRIPT)) {
    return { ok: false, orderId: null, message: 'QMT 脚本不存在：server/signal/qmt_order.py' };
  }
  try {
    const output = execFileSync(PYTHON_BIN, [
      QMT_SCRIPT,
      '--action', order.action,
      '--code',   order.code,
      '--price',  String(order.price),
      '--shares', String(order.shares),
      '--reason', order.reason ?? '',
    ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const result = JSON.parse(output);
    return {
      ok:      result.ok ?? false,
      orderId: result.orderId ?? null,
      message: result.message ?? output.trim(),
    };
  } catch (err) {
    return { ok: false, orderId: null, message: `QMT 委托失败：${err.message}` };
  }
}

// ──────────────────────────────────────────────
// 统一下单入口
// ──────────────────────────────────────────────

/**
 * 统一下单接口，根据 ZT_MODE 自动路由
 * 实盘模式下自动应用首月半仓系数
 *
 * @param {object} order
 *   {
 *     date:           string,
 *     time:           string,
 *     code:           string,
 *     name:           string,
 *     action:         'buy' | 'sell',
 *     price:          number,
 *     shares:         number,
 *     allocatedRatio?: number,
 *     channel:        'A' | 'B',
 *     reason:         string,
 *   }
 * @returns {Promise<{ ok: boolean, orderId: string | null, message: string, mode: string }>}
 */
export async function submitOrder(order) {
  if (!isPaperMode() && !isLiveMode()) {
    return {
      ok: false,
      orderId: null,
      message: 'ZT_MODE 未设置，拒绝下单。请设置 ZT_MODE=paper 或 ZT_MODE=live',
      mode: 'none',
    };
  }

  if (isPaperMode()) {
    const result = await paperOrder(order);
    return { ...result, mode: 'paper' };
  }

  // 实盘：应用首月半仓系数
  const multiplier = await getHalfPositionMultiplier(order.date);
  const liveOrder = {
    ...order,
    shares: order.action === 'buy'
      ? Math.floor((order.shares * multiplier) / 100) * 100
      : order.shares,
    allocatedRatio: order.allocatedRatio != null
      ? order.allocatedRatio * multiplier
      : undefined,
  };

  if (liveOrder.shares <= 0) {
    return { ok: false, orderId: null, message: '首月半仓后股数为0，跳过委托', mode: 'live' };
  }

  const result = qmtOrder(liveOrder);
  return { ...result, mode: 'live', halfPosition: multiplier < 1 };
}
