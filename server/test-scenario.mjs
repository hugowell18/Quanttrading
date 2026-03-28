/**
 * 系统集成测试场景
 * 场景：2024-10-08 起模拟盘运行 10 个交易日（924行情后主升浪）
 *
 * 出场参数来源：results/batch/600519.json bestConfig.exitPlan（经过 Walk-Forward 验证）
 *
 * 运行：
 *   ZT_MODE=paper node server/test-scenario.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDaily } from './data/csv-manager.mjs';
import { readZtpool } from './sentiment/ztpool-collector.mjs';
import { calcMetrics, saveSentiment, loadMetrics } from './sentiment/sentiment-engine.mjs';
import { evaluateState, readStateHistory, writeStateRecord } from './sentiment/sentiment-state-machine.mjs';
import { getAvailablePosition, tryOpenPosition, calcOpenAmount } from './risk/position-manager.mjs';
import { checkCircuitBreaker, recordTradeResult } from './risk/circuit-breaker.mjs';
import { paperOrder, lockParams } from './risk/paper-trading.mjs';
import { calcDynamicTP } from './risk/dynamic-tp.mjs';
import { generateReviewReport, saveReviewReport, formatReportText } from './risk/review-reporter.mjs';

const ROOT = process.cwd();

// ── 从已验证的最优配置读取出场参数 ──
const batchResult = JSON.parse(readFileSync(resolve(ROOT, 'results', 'batch', '600519.json'), 'utf8'));
const exitPlan = batchResult.bestConfig.exitPlan;

// --tp 参数覆盖止盈，不传则用 optimizer 验证值
const tpArg = process.argv.includes('--tp')
  ? Number(process.argv[process.argv.indexOf('--tp') + 1])
  : null;

const STOP_LOSS_PCT   = exitPlan.stopLoss * 100;                          // 3%
const TAKE_PROFIT_PCT = tpArg ?? (exitPlan.targetProfitPct * 100);        // 默认5%，--tp 可覆盖
const MAX_HOLD_DAYS   = exitPlan.maxHoldingDays;                          // 5日

// ── 场景参数 ──
// 多段场景验证，通过 --period 参数切换：
// node server/test-scenario.mjs --period 1  (2023-01 震荡反弹)
// node server/test-scenario.mjs --period 2  (2024-02 极端反弹)
// node server/test-scenario.mjs --period 3  (2025-02 DeepSeek行情)
// node server/test-scenario.mjs            (默认 2024-10 924主升浪)

const PERIOD_MAP = {
  '0': { label: '2024-10 924主升浪',    dates: ['20241008','20241009','20241010','20241011','20241014','20241015','20241016','20241017','20241018','20241021'] },
  '1': { label: '2023-01 震荡反弹',     dates: ['20230103','20230104','20230105','20230106','20230109','20230110','20230111','20230112','20230113','20230116'] },
  '2': { label: '2024-02 极端反弹',     dates: ['20240201','20240202','20240205','20240206','20240207','20240208','20240219','20240220','20240221','20240222'] },
  '3': { label: '2025-02 DeepSeek行情', dates: ['20250205','20250206','20250207','20250210','20250211','20250212','20250213','20250214','20250217','20250218'] },
  '4': { label: '2026-03 AKShare完整数据', dates: ['20260309','20260310','20260311','20260312','20260313','20260316','20260317','20260318','20260319','20260320','20260323','20260325','20260326'] },
};

const periodArg = process.argv.includes('--period')
  ? process.argv[process.argv.indexOf('--period') + 1]
  : '0';
const period = PERIOD_MAP[periodArg] ?? PERIOD_MAP['0'];
const SCENARIO_DATES = period.dates;
const TOTAL_CAPITAL = 500000;  // 50万总资金

// ── 运行时状态 ──
let positions = [];
const allTrades = [];
let currentState = '冰点';
let currentHeatScore = 50;  // 当日热度分，供动态止盈使用

// ── 工具 ──
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

function toTsCode(code) {
  return /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

function getKlineClose(tsCode, date) {
  const rows = readDaily(tsCode, date, date);
  return rows.length ? Number(rows[0].close || 0) : null;
}

// ── 从涨停池构造候选股（替代实时行情）──
// 取首板（continuous_days==1）、非一字板、市值50-150亿
function buildCandidatesFromZtpool(date, state) {
  if (state === '冰点' || state === '退潮') return [];
  const pool = readZtpool(date);
  if (!pool) return [];
  const rows = pool.ztpool?.rows ?? [];
  return rows
    .filter((r) => {
      if ((r.continuous_days ?? 1) !== 1) return false;
      // first_seal_time=09:25:00 是 Tushare 历史数据的占位值，无法区分一字板，跳过该过滤
      // AKShare 实时数据有真实封板时间时才排除一字板
      const sealTime = r.first_seal_time ?? '';
      if (sealTime && sealTime !== '09:25:00' && sealTime <= '09:26:00') return false;
      // circ_mv=0 是 Tushare 历史数据缺失，无数据时跳过市值过滤
      const mv = r.circ_mv ?? 0;
      if (mv > 0 && (mv < 5e9 || mv > 1.5e10)) return false;
      if (!r.price || r.price <= 0) return false;
      return true;
    })
    .map((r) => ({
      code:          r.code,
      name:          r.name || r.code,
      tsCode:        toTsCode(r.code),
      price:         r.price,
      circMv:        r.circ_mv ?? 0,
      circMvYi:      (r.circ_mv ?? 0) / 1e8,
      sealAmount:    r.seal_amount ?? 0,
      firstSealTime: r.first_seal_time,
      positionCap:   0.15,
    }))
    .slice(0, 3);
}

// ── 追踪持仓：止损 / 止盈 / 超时 ──
function trackPositions(date) {
  const closed = [];
  const remaining = [];

  for (const pos of positions) {
    const currentPrice = getKlineClose(pos.tsCode, date);
    if (!currentPrice) { remaining.push(pos); continue; }

    const returnPct = (currentPrice - pos.entryPrice) / pos.entryPrice * 100;
    const holdDays  = pos.holdDays + 1;
    let exitReason  = null;

    if (returnPct <= -STOP_LOSS_PCT) {
      exitReason = `止损`;
    } else if (returnPct >= (pos.tpPct ?? TAKE_PROFIT_PCT)) {
      exitReason = `止盈`;
    } else if (holdDays >= MAX_HOLD_DAYS) {
      exitReason = `超时`;
    }

    if (exitReason) {
      const trade = {
        code: pos.code, name: pos.name, channel: pos.channel,
        sector: '未知',
        entryDate: pos.entryDate, exitDate: date,
        entryPrice: pos.entryPrice, exitPrice: currentPrice,
        returnPct, holdDays, exitReason,
      };
      closed.push(trade);
      allTrades.push(trade);
      log('平仓', `${pos.name}(${pos.code}) ${exitReason} ${pct(returnPct)} 持${holdDays}日`);
    } else {
      remaining.push({ ...pos, holdDays });
    }
  }

  positions = remaining;
  return closed;
}

// ── 主流程 ──
async function runScenario() {
  log('场景', '========== 系统集成测试场景 ==========');
  log('场景', `日期范围：${SCENARIO_DATES[0]} ~ ${SCENARIO_DATES[SCENARIO_DATES.length - 1]}  【${period.label}】`);
  log('场景', `出场参数来源：results/batch/600519.json exitPlan=${exitPlan.name}`);
  log('场景', `止损：-${STOP_LOSS_PCT}%  止盈：+${TAKE_PROFIT_PCT}%  最长持仓：${MAX_HOLD_DAYS}日`);
  log('场景', `总资金：${(TOTAL_CAPITAL / 10000).toFixed(0)}万`);
  console.log('');

  // 锁定参数（已锁定则跳过）
  lockParams({ exitPlan: exitPlan.name, stopLossPct: STOP_LOSS_PCT, takeProfitPct: TAKE_PROFIT_PCT, maxHoldDays: MAX_HOLD_DAYS });

  // 读取场景开始前的情绪状态
  const prevRecord = readStateHistory().filter((r) => r.date < SCENARIO_DATES[0]).pop();
  currentState = prevRecord?.state ?? '冰点';

  for (let i = 0; i < SCENARIO_DATES.length; i++) {
    const date     = SCENARIO_DATES[i];
    const prevDate = i > 0 ? SCENARIO_DATES[i - 1] : null;

    log('日期', `========== ${date} ==========`);

    // ── 1. 情绪指标 + 状态机 ──
    const metrics = calcMetrics(date, prevDate);
    if (metrics) {
      saveSentiment(metrics);
      const series = [];
      if (prevDate) { const pm = loadMetrics(prevDate); if (pm) series.push(pm); }
      series.push(metrics);
      const stateResult = evaluateState(series, currentState);
      writeStateRecord({
        date, state: stateResult.state, positionLimit: stateResult.positionLimit,
        changed: stateResult.changed, previousState: currentState, ...stateResult.snapshot,
      });
      const prev = currentState;
      currentState = stateResult.state;
      currentHeatScore = stateResult.snapshot.heatScore ?? 50;
      log('情绪', `${prev} → ${currentState}${stateResult.changed ? ' ⚡' : ''}  仓位上限=${(stateResult.positionLimit * 100).toFixed(0)}%  涨停=${metrics.ztCount}家  热度分=${currentHeatScore}`);
    } else {
      log('情绪', '⚠️  无涨停池数据，跳过情绪计算');
    }

    // ── 2. 熔断检查 ──
    const cb = checkCircuitBreaker(date);
    if (cb.active) {
      log('熔断', `熔断中，剩余${cb.remainingDays}日，跳过开仓`);
    }

    // ── 3. 追踪持仓 ──
    const closedToday = trackPositions(date);
    for (const t of closedToday) {
      recordTradeResult({ date, code: t.code, returnPct: t.returnPct });
    }

    // ── 4. 选股 + 开仓 ──
    if (!cb.active) {
      const candidates = buildCandidatesFromZtpool(date, currentState);
      log('选股', `候选 ${candidates.length} 只（情绪：${currentState}）`);

      for (const c of candidates) {
        const attempt = tryOpenPosition(currentState, positions, {
          code: c.code, channel: 'A', positionCap: c.positionCap,
        });
        if (!attempt.ok) {
          log('开仓', `${c.name}(${c.code}) 跳过：${attempt.reason}`);
          continue;
        }
        const { shares, amount } = calcOpenAmount(TOTAL_CAPITAL, attempt.allocatedRatio, c.price);
        if (shares <= 0) continue;

        await paperOrder({
          date, time: '14:50:00', code: c.code, name: c.name,
          action: 'buy', price: c.price, shares, channel: 'A',
          reason: `首板 封板${c.firstSealTime} 情绪${currentState}`,
        });

        const sealRatio = (c.sealAmount > 0 && c.circMv > 0) ? c.sealAmount / c.circMv : 0;
        const { tpPct, breakdown } = calcDynamicTP(
          { firstSealTime: c.firstSealTime, sealRatio },
          { emotionState: currentState, heatScore: currentHeatScore, baseTpPct: TAKE_PROFIT_PCT },
        );
        positions.push({
          code: c.code, name: c.name, tsCode: c.tsCode, channel: 'A',
          entryDate: date, entryPrice: c.price,
          positionRatio: attempt.allocatedRatio,
          holdDays: 0, tpPct,
        });
        log('开仓', `买入 ${c.name}(${c.code}) @${c.price} ${shares}股 仓位${(attempt.allocatedRatio * 100).toFixed(1)}%  动态止盈=${tpPct}%（市场×${breakdown.marketMultiplier} 个股×${breakdown.stockMultiplier}）`);
      }
    }

    // ── 5. 每日复盘 ──
    const prevStateForReport = readStateHistory().filter((r) => r.date < date).pop()?.state ?? '冰点';
    const report = generateReviewReport(date, {
      trades: closedToday, openPositions: positions,
      emotionState: currentState, prevEmotionState: prevStateForReport,
      mainlineSectors: [], weeklyTrades: allTrades,
    });
    saveReviewReport(report);

    log('持仓', `当前持仓${positions.length}只  今日平仓${closedToday.length}笔  累计交易${allTrades.length}笔`);
    console.log('');
  }

  // ── 强制平仓剩余持仓（场景结束）──
  if (positions.length) {
    log('收尾', `场景结束，强制平仓剩余 ${positions.length} 只`);
    const lastDate = SCENARIO_DATES[SCENARIO_DATES.length - 1];
    for (const pos of positions) {
      const exitPrice = getKlineClose(pos.tsCode, lastDate) ?? pos.entryPrice;
      const returnPct = (exitPrice - pos.entryPrice) / pos.entryPrice * 100;
      const trade = {
        code: pos.code, name: pos.name, channel: pos.channel,
        sector: '未知', entryDate: pos.entryDate, exitDate: lastDate,
        entryPrice: pos.entryPrice, exitPrice, returnPct,
        holdDays: pos.holdDays, exitReason: '场景结束',
      };
      allTrades.push(trade);
      log('收尾', `${pos.name}(${pos.code}) ${pct(returnPct)} 持${pos.holdDays}日`);
    }
    positions = [];
  }

  // ── 最终统计 ──
  console.log('');
  log('统计', '========== 最终统计 ==========');
  log('统计', `出场参数：exitPlan=${exitPlan.name}  止损=${STOP_LOSS_PCT}%  止盈=${TAKE_PROFIT_PCT}%  最长持仓=${MAX_HOLD_DAYS}日`);
  log('统计', `总交易笔数：${allTrades.length}`);

  if (!allTrades.length) {
    log('统计', '无已平仓交易（情绪状态全程冰点/退潮，未触发开仓）');
    return;
  }

  const wins   = allTrades.filter((t) => t.returnPct > 0);
  const losses = allTrades.filter((t) => t.returnPct <= 0);
  const winRate   = wins.length / allTrades.length;
  const avgReturn = allTrades.reduce((s, t) => s + t.returnPct, 0) / allTrades.length;
  const avgWin    = wins.length   ? wins.reduce((s, t) => s + t.returnPct, 0) / wins.length     : 0;
  const avgLoss   = losses.length ? losses.reduce((s, t) => s + t.returnPct, 0) / losses.length : 0;
  const grossWin  = wins.reduce((s, t) => s + t.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.returnPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  log('统计', `胜率：${wins.length}/${allTrades.length} = ${(winRate * 100).toFixed(1)}%`);
  log('统计', `平均收益：${avgReturn.toFixed(2)}%`);
  log('统计', `平均盈利：+${avgWin.toFixed(2)}%  平均亏损：${avgLoss.toFixed(2)}%`);
  log('统计', `盈亏比：${isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}`);
  log('统计', `期望收益：${expectancy.toFixed(2)}%`);

  // 与 optimizer 验证集对比
  const valResult = batchResult.bestResult?.validation;
  if (valResult) {
    console.log('');
    log('对比', `── 与 optimizer 验证集对比 ──`);
    log('对比', `胜率：场景=${(winRate*100).toFixed(1)}%  验证集=${(valResult.winRate*100).toFixed(1)}%`);
    log('对比', `均收益：场景=${avgReturn.toFixed(2)}%  验证集=${(valResult.avgReturn*100).toFixed(2)}%`);
    log('对比', `盈亏比：场景=${isFinite(profitFactor)?profitFactor.toFixed(2):'∞'}  验证集=${valResult.profitFactor?.toFixed(2)??'N/A'}`);
  }

  console.log('');
  log('统计', '── 逐笔明细 ──');
  console.log('买入日      卖出日      代码      收益%     持仓  出场');
  for (const t of allTrades) {
    const ret = t.returnPct >= 0 ? `+${t.returnPct.toFixed(2)}` : t.returnPct.toFixed(2);
    console.log(`${t.entryDate}  ${t.exitDate}  ${t.code.padEnd(8)}  ${ret.padEnd(8)}  ${t.holdDays}日    ${t.exitReason}`);
  }

  console.log('');
  log('统计', '── 出场原因分布 ──');
  const reasons = {};
  for (const t of allTrades) {
    reasons[t.exitReason] = (reasons[t.exitReason] ?? 0) + 1;
  }
  for (const [reason, count] of Object.entries(reasons)) {
    log('统计', `  ${reason}：${count}笔 (${(count/allTrades.length*100).toFixed(0)}%)`);
  }

  log('统计', '==============================');
}

runScenario().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
