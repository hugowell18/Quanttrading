/**
 * 监管合规约束模块
 * Phase 4.5 / 需求 21 / 任务书 4.5
 *
 * 三条硬性约束：
 *   1. 每日单只股票撤单次数 ≤ 50 次
 *   2. 同一股票相邻两次买卖操作时间间隔 ≥ 1 分钟（60 秒）
 *   3. 单日单账户买入涨停/跌停附近（±0.5%）股票笔数 ≤ 10 笔
 *
 * 任何约束即将触及时，暂停对应操作并记录合规日志，不静默跳过。
 * 合规状态持久化：cache/risk/compliance-YYYYMMDD.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RISK_DIR = resolve(ROOT, 'cache', 'risk');
mkdirSync(RISK_DIR, { recursive: true });

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────

const MAX_CANCEL_PER_STOCK = 50;       // 单只股票每日最大撤单次数
const MIN_TRADE_INTERVAL_MS = 60_000;  // 同一股票相邻操作最小间隔（毫秒）
const MAX_LIMIT_TRADES_PER_DAY = 10;   // 涨跌停附近买入笔数上限
const LIMIT_PRICE_RANGE = 0.005;       // 涨跌停附近范围（±0.5%）

// ──────────────────────────────────────────────
// 持久化
// ──────────────────────────────────────────────

function statePath(date) {
  return resolve(RISK_DIR, `compliance-${date}.json`);
}

/**
 * 读取当日合规状态
 * @param {string} date YYYYMMDD
 * @returns {ComplianceState}
 */
export function readComplianceState(date) {
  const path = statePath(date);
  if (!existsSync(path)) {
    return {
      date,
      cancelCount:    {},   // code → 撤单次数
      lastTradeTime:  {},   // code → 最后操作时间戳（ms）
      limitTradeCount: 0,   // 涨跌停附近买入笔数
      violations:     [],   // 违规记录
    };
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * 写入当日合规状态
 */
export function writeComplianceState(state) {
  writeFileSync(statePath(state.date), JSON.stringify(state, null, 2), 'utf8');
}

// ──────────────────────────────────────────────
// 工具：判断价格是否在涨跌停附近
// ──────────────────────────────────────────────

/**
 * @param {number} price         当前价格
 * @param {number} prevClose     昨收价
 * @param {number} range         附近范围（默认 ±0.5%）
 */
function isNearLimitPrice(price, prevClose, range = LIMIT_PRICE_RANGE) {
  if (!prevClose || prevClose <= 0) return false;
  const limitUp   = prevClose * 1.10;  // A股涨停（普通股10%）
  const limitDown = prevClose * 0.90;  // A股跌停
  const pct = Math.abs(price - prevClose) / prevClose;
  return (
    Math.abs(price - limitUp)   / prevClose <= range ||
    Math.abs(price - limitDown) / prevClose <= range
  );
}

// ──────────────────────────────────────────────
// 主函数 1：检查操作是否合规
// ──────────────────────────────────────────────

/**
 * 检查一次操作是否违反合规约束
 *
 * @param {object} operation
 *   {
 *     type:       'cancel' | 'buy' | 'sell',
 *     code:       string,       // 股票代码
 *     price?:     number,       // 操作价格（buy/sell 时需要）
 *     prevClose?: number,       // 昨收价（判断涨跌停附近用）
 *     timestamp?: number,       // 操作时间戳 ms（不传则用 Date.now()）
 *   }
 * @param {object} state  当日合规状态（readComplianceState 返回值）
 * @returns {{
 *   allowed: boolean,
 *   violations: string[],  // 触发的违规描述（allowed=false 时非空）
 * }}
 */
export function checkCompliance(operation, state) {
  const { type, code, price, prevClose, timestamp = Date.now() } = operation;
  const violations = [];

  // ── 约束1：撤单次数 ──
  if (type === 'cancel') {
    const count = (state.cancelCount[code] ?? 0);
    if (count >= MAX_CANCEL_PER_STOCK) {
      violations.push(
        `[撤单超限] ${code} 今日已撤单 ${count} 次，达到上限 ${MAX_CANCEL_PER_STOCK} 次`,
      );
    }
  }

  // ── 约束2：交易间隔 ──
  if (type === 'buy' || type === 'sell') {
    const lastTime = state.lastTradeTime[code];
    if (lastTime != null) {
      const elapsed = timestamp - lastTime;
      if (elapsed < MIN_TRADE_INTERVAL_MS) {
        const remaining = Math.ceil((MIN_TRADE_INTERVAL_MS - elapsed) / 1000);
        violations.push(
          `[间隔不足] ${code} 距上次操作仅 ${Math.floor(elapsed / 1000)} 秒，需间隔 60 秒（还需等待 ${remaining} 秒）`,
        );
      }
    }
  }

  // ── 约束3：涨跌停附近买入笔数 ──
  if (type === 'buy' && price != null && prevClose != null) {
    if (isNearLimitPrice(price, prevClose)) {
      if (state.limitTradeCount >= MAX_LIMIT_TRADES_PER_DAY) {
        violations.push(
          `[涨跌停超限] 今日涨跌停附近买入已达 ${state.limitTradeCount} 笔，上限 ${MAX_LIMIT_TRADES_PER_DAY} 笔`,
        );
      }
    }
  }

  return { allowed: violations.length === 0, violations };
}

// ──────────────────────────────────────────────
// 主函数 2：更新合规状态
// ──────────────────────────────────────────────

/**
 * 操作执行后更新合规状态计数器
 * 仅在 checkCompliance 返回 allowed=true 后调用
 *
 * @param {object} state      当日合规状态（会被修改）
 * @param {object} operation  同 checkCompliance 的 operation 参数
 * @returns {object}          更新后的 state（同一引用）
 */
export function updateComplianceState(state, operation) {
  const { type, code, price, prevClose, timestamp = Date.now() } = operation;

  if (type === 'cancel') {
    state.cancelCount[code] = (state.cancelCount[code] ?? 0) + 1;
  }

  if (type === 'buy' || type === 'sell') {
    state.lastTradeTime[code] = timestamp;
  }

  if (type === 'buy' && price != null && prevClose != null) {
    if (isNearLimitPrice(price, prevClose)) {
      state.limitTradeCount = (state.limitTradeCount ?? 0) + 1;
    }
  }

  return state;
}

/**
 * 一步完成：检查 + 更新 + 持久化
 * 返回检查结果，若 allowed=true 则同时更新状态
 *
 * @param {object} operation
 * @param {string} date       YYYYMMDD
 * @returns {{ allowed: boolean, violations: string[] }}
 */
export function processOperation(operation, date) {
  const state = readComplianceState(date);
  const result = checkCompliance(operation, state);

  if (result.allowed) {
    updateComplianceState(state, operation);
  } else {
    // 记录违规日志
    state.violations.push({
      timestamp: new Date().toISOString(),
      operation,
      violations: result.violations,
    });
  }

  writeComplianceState(state);
  return result;
}
