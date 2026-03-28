/**
 * 三层止损规则引擎
 * Phase 4.2 / 需求 15 / 任务书 4.2
 *
 * 三层止损：
 *   第一层（竞价止损）：次日竞价低开 > 3%，竞价结束后立即清仓
 *   第二层（盘中止损）：盘中价格跌破买入价 5%，立即清仓
 *   第三层（情绪止损）：情绪状态切换至"退潮"，清仓全部持仓
 *
 * 优先级：第一层 > 第二层 > 第三层
 * 止损记录写入 cache/risk/stop-loss-log.json
 *
 * 用法（模块导入）：
 *   import { checkStopLoss, checkAllStopLoss } from './stop-loss-engine.mjs';
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RISK_DIR = resolve(ROOT, 'cache', 'risk');
const STOP_LOSS_LOG = resolve(RISK_DIR, 'stop-loss-log.json');
mkdirSync(RISK_DIR, { recursive: true });

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────

/** 第一层：竞价低开触发阈值（跌幅，正数） */
const AUCTION_STOP_PCT = 3;

/** 第二层：盘中跌破买入价触发阈值（跌幅，正数） */
const INTRADAY_STOP_PCT = 5;

// ──────────────────────────────────────────────
// 核心：单只持仓止损检查
// ──────────────────────────────────────────────

/**
 * 检查单只持仓是否触发止损
 *
 * @param {object} position  持仓信息
 *   { code, name, entryPrice, entryDate, channel }
 * @param {object} marketData  市场数据
 *   {
 *     auctionPct?:    number,  // 竞价涨跌幅（%），负数表示低开，如 -4.2
 *     currentPrice?:  number,  // 当前盘中价格
 *     emotionState?:  string,  // 当前情绪状态
 *   }
 * @returns {{
 *   triggered: boolean,
 *   layer: 1 | 2 | 3 | null,
 *   reason: string,
 *   stopPrice: number | null,  // 触发止损时的价格
 * }}
 */
export function checkStopLoss(position, marketData = {}) {
  const { entryPrice } = position;
  const { auctionPct, currentPrice, emotionState } = marketData;

  // ── 第一层：竞价低开 > 3% ──
  if (auctionPct != null) {
    const dropPct = -auctionPct;  // 转为正数跌幅
    if (dropPct > AUCTION_STOP_PCT) {
      return {
        triggered: true,
        layer: 1,
        reason: `竞价低开 ${dropPct.toFixed(2)}%，超过阈值 ${AUCTION_STOP_PCT}%`,
        stopPrice: currentPrice ?? null,
      };
    }
  }

  // ── 第二层：盘中跌破买入价 5% ──
  if (currentPrice != null && entryPrice > 0) {
    const returnPct = (currentPrice - entryPrice) / entryPrice * 100;
    if (returnPct <= -INTRADAY_STOP_PCT) {
      return {
        triggered: true,
        layer: 2,
        reason: `盘中跌破买入价 ${Math.abs(returnPct).toFixed(2)}%，超过阈值 ${INTRADAY_STOP_PCT}%`,
        stopPrice: currentPrice,
      };
    }
  }

  // ── 第三层：情绪退潮 ──
  if (emotionState === '退潮') {
    return {
      triggered: true,
      layer: 3,
      reason: '情绪状态切换至退潮，触发全仓清仓',
      stopPrice: currentPrice ?? null,
    };
  }

  return { triggered: false, layer: null, reason: '未触发止损', stopPrice: null };
}

// ──────────────────────────────────────────────
// 批量检查
// ──────────────────────────────────────────────

/**
 * 批量检查所有持仓的止损状态
 *
 * @param {object[]} positions  持仓列表
 * @param {object}   marketData
 *   {
 *     auctionMap?:   Map<string, number>,  // code → 竞价涨跌幅
 *     priceMap?:     Map<string, number>,  // code → 当前价格
 *     emotionState?: string,
 *   }
 * @returns {Array<{ position: object, stopLoss: object }>}
 *   只返回触发止损的持仓
 */
export function checkAllStopLoss(positions, marketData = {}) {
  const { auctionMap = new Map(), priceMap = new Map(), emotionState } = marketData;
  const triggered = [];

  for (const position of positions) {
    const result = checkStopLoss(position, {
      auctionPct:   auctionMap.get(position.code) ?? null,
      currentPrice: priceMap.get(position.code) ?? null,
      emotionState,
    });

    if (result.triggered) {
      triggered.push({ position, stopLoss: result });
    }
  }

  // 第一层优先，同层按持仓时间升序（先进先出）
  return triggered.sort((a, b) => {
    if (a.stopLoss.layer !== b.stopLoss.layer) return a.stopLoss.layer - b.stopLoss.layer;
    return (a.position.entryDate ?? '').localeCompare(b.position.entryDate ?? '');
  });
}

// ──────────────────────────────────────────────
// 止损记录持久化
// ──────────────────────────────────────────────

/**
 * 读取止损日志
 */
export function readStopLossLog() {
  if (!existsSync(STOP_LOSS_LOG)) return [];
  return JSON.parse(readFileSync(STOP_LOSS_LOG, 'utf8'));
}

/**
 * 写入一条止损记录
 * @param {object} record
 *   { date, time, code, name, layer, entryPrice, stopPrice, returnPct, reason }
 */
export function writeStopLossRecord(record) {
  const log = readStopLossLog();
  log.push({ ...record, recordedAt: new Date().toISOString() });
  writeFileSync(STOP_LOSS_LOG, JSON.stringify(log, null, 2), 'utf8');
}


