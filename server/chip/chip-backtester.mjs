/**
 * 筹码策略回测器 (Chip Strategy Backtester)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Gate 3：独立验证筹码峰特征的实际策略效果
 *
 * 策略列表：
 *   S1  lowPeakBreakout       低位密集筹码突破买入
 *   S2  peakLockedContinuation 筹码锁定持续做多（持仓续期）
 *   S3  doublePeakNarrow      双峰收窄突破（研究标签，暂不做主力策略）
 *
 * 策略逻辑（基于专家意见简化版，不做过拟合）：
 *   S1 入场条件（ALL必须满足）：
 *     - 主峰在当前价以下（low_peak = dominant_peak_distance < -0.005）
 *     - 获利盘 < 40%（筹码仍在低位）
 *     - 70% 成本带宽度 < 0.06（筹码密集）
 *     - 当日成交量 > 5日均量（放量突破）
 *   S1 出场条件（ANY触发）：
 *     - 获利盘 > 85%（主峰完全浮盈）
 *     - 持仓 > 30 个交易日
 *     - 价格跌破 70% 成本带下沿（止损）
 *
 *   S2 入场条件（ALL必须满足）：
 *     - 主峰在当前价以下
 *     - peak_count == 1（单峰，筹码集中）
 *     - 上方套牢盘 < 15%
 *   S2 出场条件：
 *     - 峰值数增加（筹码分散）
 *     - 持仓 > 20 个交易日
 *
 * 回测假设：
 *   - 次日开盘买入（信号日 +1 日），不滑点（简化）
 *   - 手续费 0.15% 双边（买入 0.075% + 卖出 0.075% + 印花税 0.1%）
 *   - 使用前复权价（close_adj）
 *   - 每次固定仓位（全仓），不计复利
 *
 * 用法：
 *   node server/chip/chip-backtester.mjs 300059.SZ 20230101 20241231 S1
 */

import { createLogger } from '../logger.mjs';
import { readDaily } from '../data/csv-manager.mjs';
import { computeChipDistribution } from './chip-engine.mjs';
import { extractChipFeatures } from './chip-features.mjs';

const log = createLogger('chip-bt');

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

const COMMISSION_RATE = 0.00075;   // 单边手续费（买/卖各 0.075%）
const STAMP_TAX       = 0.001;     // 印花税（卖出方）
const MAX_HOLD_DAYS   = { S1: 30, S2: 20, S3: 40 };

// ─────────────────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────────────────

function shiftDate(yyyymmdd, calendarDays) {
  const d = new Date(
    `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`,
  );
  d.setDate(d.getDate() + calendarDays);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
}

function netReturn(entryPrice, exitPrice, direction = 'long') {
  if (direction !== 'long') return 0;
  const gross = (exitPrice - entryPrice) / entryPrice;
  const cost  = COMMISSION_RATE * 2 + STAMP_TAX;   // buy + sell + stamp
  return gross - cost;
}

// ─────────────────────────────────────────────────────────────────────────────
// 信号生成
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S1: 低位密集筹码突破买入
 * 实际含义：筹码在低位长期积累（成本带窄），当前价刚刚突破/贴近主峰上方
 * 典型特征：获利盘 > 50%（已突破密集区），主峰刚低于价格（距离 < 20%），成本带较窄
 */
function checkS1Entry(feat, klineRow, avgVol5) {
  if (!feat) return false;
  return (
    feat.dominant_peak_distance > -0.20 &&            // 主峰距当前价不超过 20%（刚突破，非遥远低位）
    feat.dominant_peak_distance < -0.005 &&            // 主峰在当前价以下（已突破）
    feat.profit_ratio > 0.50 &&                        // 超过 50% 筹码获利（低位积累后突破）
    feat.band_70_width < 0.15 &&                       // 70% 成本带宽度 < 15%（筹码相对集中）
    feat.dominant_peak_share > 0.015 &&                // 主峰足够突出（非分散分布）
    klineRow.volume > avgVol5 * 1.2                    // 温和放量即可
  );
}

function checkS1Exit(feat, klineRow, entryPrice, holdDays) {
  if (!feat) return { exit: true, reason: 'no_feat' };
  if (holdDays >= MAX_HOLD_DAYS.S1) return { exit: true, reason: 'timeout' };
  // 止盈：价格远离成本带（主峰低于价格超过 30%）
  if (feat.dominant_peak_distance < -0.30) return { exit: true, reason: 'take_profit' };
  // 止损：价格跌破 70% 成本带下沿
  if (feat.band70 && klineRow.close_adj < feat.band70.low * 0.98) {
    return { exit: true, reason: 'stop_loss' };
  }
  return { exit: false };
}

/**
 * S2: 筹码锁定持续做多
 * 单峰 + 获利盘 > 70% + 套牢盘少 → 筹码结构健康，做多持续
 */
function checkS2Entry(feat) {
  if (!feat) return false;
  return (
    feat.dominant_peak_distance < -0.005 &&    // 主峰低于价格
    feat.peak_count === 1 &&                    // 单峰（筹码高度集中）
    feat.profit_ratio > 0.70 &&                 // 获利盘 > 70%
    feat.upper_chip_ratio < 0.30               // 套牢盘 < 30%
  );
}

function checkS2Exit(feat, holdDays, prevFeat) {
  if (!feat) return { exit: true, reason: 'no_feat' };
  if (holdDays >= MAX_HOLD_DAYS.S2) return { exit: true, reason: 'timeout' };

  // ① 套牢盘急增：upper_chip_ratio 相比入场时上涨 12 pct → 筹码结构恶化
  //    prevFeat 在 S2 中持续更新为最新一期，所以用前1日对比
  if (prevFeat && feat.upper_chip_ratio - prevFeat.upper_chip_ratio > 0.12) {
    return { exit: true, reason: 'upper_chip_spike' };
  }

  // ② 单峰破坏：持仓后峰数从 1 增加到 ≥ 3（筹码高度分散，多空分歧加大）
  if (feat.peak_count >= 3) {
    return { exit: true, reason: 'peak_scatter' };
  }

  // ③ 获利盘持续萎缩：profit_ratio 从 >70% 跌回 <45%（价格回落到主峰区域以下）
  if (prevFeat && prevFeat.profit_ratio > 0.60 && feat.profit_ratio < 0.45) {
    return { exit: true, reason: 'profit_pullback' };
  }

  // ④ 90% 成本带急速扩宽（绝对宽度）：band_90_width 日增 > 5%（分布崩散信号）
  if (prevFeat && feat.band_90_width - prevFeat.band_90_width > 0.05) {
    return { exit: true, reason: 'band_widen' };
  }

  return { exit: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 单策略回测主循环
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string}   tsCode
 * @param {string}   startDate   - YYYYMMDD
 * @param {string}   endDate     - YYYYMMDD
 * @param {'S1'|'S2'} strategy
 * @param {number}   [lookback=120]
 * @returns {BacktestResult}
 *
 * @typedef {object} Trade
 * @property {string} entryDate
 * @property {number} entryPrice
 * @property {string} exitDate
 * @property {number} exitPrice
 * @property {number} holdDays
 * @property {number} pnl          - 净收益率（小数）
 * @property {string} exitReason
 *
 * @typedef {object} BacktestResult
 * @property {string}  tsCode
 * @property {string}  strategy
 * @property {string}  startDate
 * @property {string}  endDate
 * @property {number}  totalTrades
 * @property {number}  winRate
 * @property {number}  avgPnl
 * @property {number}  totalPnl     - 累计（不复利）净收益率
 * @property {number}  maxDrawdown
 * @property {number}  sharpe       - 简化 Sharpe：avgPnl / stdPnl
 * @property {Trade[]} trades
 */
export async function backtest(tsCode, startDate, endDate, strategy = 'S1', lookback = 120) {
  log.info('回测开始', { tsCode, strategy, startDate, endDate });

  // 读取全部 K 线（含回望窗口）
  const fetchStart = shiftDate(startDate, -(lookback * 2));
  const allRows = readDaily(tsCode, fetchStart, endDate);

  if (allRows.length < lookback + 10) {
    log.warn('K 线数据不足', { tsCode, rows: allRows.length });
    return null;
  }

  // 过滤出回测区间的交易日
  const testRows = allRows.filter((r) => r.trade_date >= startDate && r.trade_date <= endDate);
  if (testRows.length < 5) return null;

  // 预先缓存筹码特征（每日计算一次），避免重复计算
  log.info(`预计算 ${testRows.length} 日筹码特征...`);
  const featCache = new Map();    // date → ChipFeatures
  const distCache = new Map();    // date → ChipResult

  for (let i = 0; i < testRows.length; i++) {
    const date = testRows[i].trade_date;
    try {
      const chip = computeChipDistribution(tsCode, date, { lookback });
      if (!chip) continue;
      distCache.set(date, chip);
      // 5日前分布用于时序特征
      const prevDate = i >= 5 ? testRows[i - 5].trade_date : null;
      const prevChip = prevDate ? distCache.get(prevDate) ?? null : null;
      const feat = extractChipFeatures(chip, prevChip);
      if (feat) {
        // 附带 band70 原始对象（特征中只有宽度）
        feat.band70 = chip.band70;
        featCache.set(date, feat);
      }
    } catch (e) {
      log.debug(`${date} 特征计算跳过`, { error: e.message });
    }
    if ((i + 1) % 20 === 0) log.info(`  已处理 ${i + 1}/${testRows.length}`);
  }

  // 5 日均量（滚动）
  const vol5Cache = new Map();
  for (let i = 0; i < testRows.length; i++) {
    const slice = testRows.slice(Math.max(0, i - 4), i + 1);
    vol5Cache.set(testRows[i].trade_date, slice.reduce((s, r) => s + r.volume, 0) / slice.length);
  }

  // ── 主回测循环 ──
  const trades = [];
  let position = null;   // { entryDate, entryPrice, holdDays, prevFeat }
  let inHold  = false;

  for (let i = 0; i < testRows.length; i++) {
    const row  = testRows[i];
    const date = row.trade_date;
    const feat = featCache.get(date) ?? null;
    const avgVol5 = vol5Cache.get(date) ?? row.volume;

    if (inHold && position) {
      position.holdDays += 1;
      let exitSignal = { exit: false };

      if (strategy === 'S1') {
        exitSignal = checkS1Exit(feat, row, position.entryPrice, position.holdDays);
      } else if (strategy === 'S2') {
        exitSignal = checkS2Exit(feat, position.holdDays, position.prevFeat);
      }

      if (exitSignal.exit) {
        // 卖出价：当日收盘（前复权）
        const exitPrice = row.close_adj || row.close;
        const pnl = netReturn(position.entryPrice, exitPrice);
        trades.push({
          entryDate:  position.entryDate,
          entryPrice: +position.entryPrice.toFixed(4),
          exitDate:   date,
          exitPrice:  +exitPrice.toFixed(4),
          holdDays:   position.holdDays,
          pnl:        +pnl.toFixed(6),
          exitReason: exitSignal.reason,
        });
        position = null;
        inHold   = false;
      } else {
        position.prevFeat = feat;
      }
    }

    // 检查入场（当前未持仓）
    if (!inHold) {
      let entrySignal = false;
      if (strategy === 'S1') entrySignal = checkS1Entry(feat, row, avgVol5);
      else if (strategy === 'S2') entrySignal = checkS2Entry(feat);

      if (entrySignal && i + 1 < testRows.length) {
        // 次日开盘买入
        const nextRow = testRows[i + 1];
        const entryPrice = nextRow.open * ((nextRow.close_adj || nextRow.close) / nextRow.close);
        position = {
          entryDate:  nextRow.trade_date,
          entryPrice,
          holdDays:   0,
          prevFeat:   feat,
        };
        inHold = true;
        i += 1;   // 跳过次日（已作为买入日）
      }
    }
  }

  // ── 统计 ──
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return { tsCode, strategy, startDate, endDate, totalTrades: 0, winRate: 0, avgPnl: 0, totalPnl: 0, maxDrawdown: 0, sharpe: 0, trades: [] };
  }

  const wins      = trades.filter((t) => t.pnl > 0).length;
  const pnls      = trades.map((t) => t.pnl);
  const totalPnl  = pnls.reduce((s, v) => s + v, 0);
  const avgPnl    = totalPnl / totalTrades;
  const winRate   = wins / totalTrades;

  // 最大回撤（基于累计 pnl 曲线）
  let cumPnl = 0, peak = 0, maxDrawdown = 0;
  for (const pnl of pnls) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe（简化：avgPnl / stdPnl，无无风险利率）
  const meanPnl = avgPnl;
  const variance = pnls.reduce((s, p) => s + (p - meanPnl) ** 2, 0) / totalTrades;
  const stdPnl = Math.sqrt(variance);
  const sharpe = stdPnl > 0 ? avgPnl / stdPnl : 0;

  const result = {
    tsCode,
    strategy,
    startDate,
    endDate,
    totalTrades,
    winRate:     +winRate.toFixed(4),
    avgPnl:      +avgPnl.toFixed(6),
    totalPnl:    +totalPnl.toFixed(6),
    maxDrawdown: +maxDrawdown.toFixed(6),
    sharpe:      +sharpe.toFixed(4),
    trades,
  };

  log.info('回测完成', {
    strategy,
    trades: totalTrades,
    winRate: (winRate * 100).toFixed(1) + '%',
    totalPnl: (totalPnl * 100).toFixed(2) + '%',
    sharpe: sharpe.toFixed(2),
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI 入口
// node server/chip/chip-backtester.mjs 300059.SZ 20230101 20241231 S1
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv[1]?.includes('chip-backtester')) {
  const tsCode    = process.argv[2] ?? '300059.SZ';
  const startDate = process.argv[3] ?? '20230101';
  const endDate   = process.argv[4] ?? '20241231';
  const strategy  = process.argv[5] ?? 'S1';

  console.log(`\n筹码策略回测 — ${tsCode}  ${startDate} → ${endDate}  策略: ${strategy}\n`);

  const result = await backtest(tsCode, startDate, endDate, strategy);

  if (!result) {
    console.error('回测失败：数据不足（请先下载 K 线数据）');
    process.exitCode = 1;
  } else {
    console.log('━'.repeat(52));
    console.log(`股票        : ${result.tsCode}`);
    console.log(`策略        : ${result.strategy}`);
    console.log(`回测区间    : ${result.startDate} → ${result.endDate}`);
    console.log(`总交易次数  : ${result.totalTrades}`);
    console.log(`胜率        : ${(result.winRate * 100).toFixed(1)}%`);
    console.log(`平均收益    : ${(result.avgPnl * 100).toFixed(2)}%/笔`);
    console.log(`累计收益    : ${(result.totalPnl * 100).toFixed(2)}%`);
    console.log(`最大回撤    : ${(result.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Sharpe      : ${result.sharpe.toFixed(2)}`);
    console.log('━'.repeat(52));

    if (result.trades.length > 0) {
      console.log('\n交易记录（最近 10 笔）:');
      const recent = result.trades.slice(-10);
      for (const t of recent) {
        const pnlStr = (t.pnl * 100).toFixed(2).padStart(7);
        const sign   = t.pnl >= 0 ? '+' : '';
        console.log(
          `  ${t.entryDate} → ${t.exitDate}`
          + `  ${String(t.holdDays).padStart(3)}日`
          + `  ${sign}${pnlStr}%`
          + `  [${t.exitReason}]`,
        );
      }
    }
  }
}
