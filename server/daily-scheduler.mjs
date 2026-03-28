/**
 * 每日调度入口
 * Phase 1-4 总指挥 / 任务书 1.7 / 2A.1 / 2B.3 / 4.6
 *
 * 调度时间表：
 *   09:15  启动，检查当日是否交易日
 *   09:25  Channel B 竞价扫描
 *   14:30  Channel A 尾盘扫描（初筛）
 *   14:50  Channel A 最终候选输出
 *   15:30  涨停池采集
 *   15:35  情绪指标计算 + 状态机评估
 *   16:00  复盘报告生成
 *
 * 用法：
 *   ZT_MODE=paper node server/daily-scheduler.mjs
 *   ZT_MODE=paper node server/daily-scheduler.mjs --date 20260327  # 指定日期（回测）
 *   ZT_MODE=paper node server/daily-scheduler.mjs --dry-run        # 只打印时间表，不等待
 */

import { readDaily } from './data/csv-manager.mjs';
import { collectZtpool } from './sentiment/ztpool-collector.mjs';
import { calcMetrics, saveSentiment, loadMetrics } from './sentiment/sentiment-engine.mjs';
import { evaluateState, readStateHistory, writeStateRecord } from './sentiment/sentiment-state-machine.mjs';
import { scanChannelA } from './signal/channel-a-selector.mjs';
import { scanChannelB } from './signal/channel-b-selector.mjs';
import { generateReviewReport, saveReviewReport, formatReportText } from './risk/review-reporter.mjs';
import { isPaperMode, isParamsLocked } from './risk/paper-trading.mjs';
import { isLiveMode, recordLiveStart } from './risk/order-router.mjs';

const HS300_CODE = '000300.SH';

// ──────────────────────────────────────────────
// CLI 参数
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const dateArgIdx = args.indexOf('--date');
const forceDateArg = dateArgIdx >= 0 ? args[dateArgIdx + 1] : null;
const isDryRun = args.includes('--dry-run');

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

function todayCompact() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function log(tag, msg) {
  const now = new Date();
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  console.log(`[${t}][${tag}] ${msg}`);
}

/**
 * 判断指定日期是否为交易日（从 HS300 日历判断）
 * @param {string} date - YYYYMMDD
 * @returns {boolean}
 */
export function isTradingDay(date) {
  const rows = readDaily(HS300_CODE, date, date);
  return rows.length > 0 && rows[0].trade_date === date;
}

/**
 * 等待到指定时间点后执行（精度 ±5 秒）
 * @param {string} timeHHMM - 如 '09:25'
 * @param {Function} fn
 */
export async function scheduleAt(timeHHMM, fn) {
  const [hh, mm] = timeHHMM.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);

  const diffMs = target - now;
  if (diffMs > 0) {
    log('调度', `等待至 ${timeHHMM}（${Math.round(diffMs / 1000)} 秒后）`);
    await new Promise((resolve) => setTimeout(resolve, diffMs));
  }
  await fn();
}

/**
 * 获取前一个交易日
 * @param {string} date - YYYYMMDD
 * @returns {string|null}
 */
function prevTradingDay(date) {
  const rows = readDaily(HS300_CODE, '20200101', date).filter((r) => r.trade_date < date);
  return rows.length ? rows[rows.length - 1].trade_date : null;
}

// ──────────────────────────────────────────────
// 各时间点任务
// ──────────────────────────────────────────────

async function task0915(date) {
  log('09:15', `交易日检查 date=${date}`);

  if (!isPaperMode() && !isLiveMode()) {
    log('09:15', '⚠️  ZT_MODE 未设置（paper/live），调度器仅记录日志，不执行下单');
  }

  if (isLiveMode()) {
    recordLiveStart(date);
    log('09:15', '实盘模式：已记录启动日期（首月半仓生效）');
  }

  if (isPaperMode() && !isParamsLocked()) {
    log('09:15', '⚠️  模拟盘模式：参数尚未锁定，建议先调用 lockParams() 锁定策略参数');
  }
}

async function task0925(date, state) {
  log('09:25', 'Channel B 竞价扫描开始');
  // 竞价数据需实时获取，此处为框架占位
  // 实盘/模拟盘接入后，从 fetch_realtime.py --type auction 获取竞价快照
  const candidates = await scanChannelB({
    date,
    auctionData: [],   // TODO: 接入实时竞价数据
    emotionState: state,
  });
  log('09:25', `Channel B 候选 ${candidates.length} 只`);
  candidates.slice(0, 5).forEach((c) => {
    log('09:25', `  ${c.code} ${c.name} 竞价+${c.auctionPct}% 综合分${c.totalScore}`);
  });
  return candidates;
}

async function task1430(date, state) {
  log('14:30', 'Channel A 尾盘初筛开始');
  // 实时行情需从 fetch_realtime.py --type stocks 获取
  const candidates = await scanChannelA({
    date,
    liveStocks: [],    // TODO: 接入实时行情
    emotionState: state,
  });
  log('14:30', `Channel A 初筛候选 ${candidates.length} 只`);
  return candidates;
}

async function task1450(channelACandidates) {
  log('14:50', 'Channel A 最终候选输出');
  const final = channelACandidates.filter((c) => c.sortScore >= 30);
  if (!final.length) {
    log('14:50', '无满足条件的候选股');
    return;
  }
  log('14:50', `最终候选 ${final.length} 只：`);
  final.forEach((c) => {
    log('14:50', `  ${c.code} ${c.name} 涨幅${c.pctChg}% 市值${c.circMvYi}亿 仓位上限${(c.positionCap * 100).toFixed(0)}%`);
  });
}

async function task1530(date) {
  log('15:30', '涨停池采集开始');
  const result = await collectZtpool(date);
  if (result.skipped) {
    log('15:30', '涨停池已有缓存，跳过采集');
  } else if (!result.ok) {
    log('15:30', `⚠️  涨停池采集失败：${result.error}`);
  } else {
    log('15:30', `涨停池采集完成：涨停=${result.ztCount} 炸板=${result.zbCount} 跌停=${result.dtCount}`);
  }
}

async function task1535(date) {
  log('15:35', '情绪指标计算 + 状态机评估');
  const prevDate = prevTradingDay(date);
  const metrics = calcMetrics(date, prevDate);
  if (!metrics) {
    log('15:35', '⚠️  情绪指标计算失败（涨停池数据缺失）');
    return null;
  }
  saveSentiment(metrics);
  log('15:35', `情绪指标：涨停=${metrics.ztCount} 炸板率=${metrics.zbRate ?? 'N/A'} 涨跌停比=${metrics.ztDtRatio ?? 'N/A'}`);

  // 状态机评估
  const history = readStateHistory();
  const prevRecord = history.filter((r) => r.date < date).pop();
  const currentState = prevRecord?.state ?? '冰点';

  const series = [];
  if (prevDate) {
    const prevMetrics = loadMetrics(prevDate);
    if (prevMetrics) series.push(prevMetrics);
  }
  series.push(metrics);

  const result = evaluateState(series, currentState);
  writeStateRecord({
    date,
    state: result.state,
    positionLimit: result.positionLimit,
    changed: result.changed,
    previousState: currentState,
    ...result.snapshot,
  });

  log('15:35', `情绪状态：${currentState} → ${result.state}${result.changed ? ' ⚡' : ''}  仓位上限=${(result.positionLimit * 100).toFixed(0)}%`);
  return result.state;
}

async function task1600(date, emotionState, prevEmotionState) {
  log('16:00', '复盘报告生成');
  const report = generateReviewReport(date, {
    trades: [],           // TODO: 接入当日已平仓交易记录
    openPositions: [],    // TODO: 接入当日持仓
    emotionState:     emotionState ?? '未知',
    prevEmotionState: prevEmotionState ?? '未知',
    mainlineSectors:  [],
    weeklyTrades:     [],
  });
  const path = saveReviewReport(report);
  log('16:00', `复盘报告已保存：${path}`);
  log('16:00', formatReportText(report));
}

// ──────────────────────────────────────────────
// 主调度流程
// ──────────────────────────────────────────────

/**
 * 运行当日完整调度
 * @param {string} date - YYYYMMDD
 */
export async function runDailySchedule(date) {
  log('调度', `========== ${date} 日调度启动 ==========`);

  // 获取前日情绪状态（用于复盘报告对比）
  const history = readStateHistory();
  const prevRecord = history.filter((r) => r.date < date).pop();
  const prevEmotionState = prevRecord?.state ?? '冰点';
  let currentState = prevEmotionState;

  if (isDryRun) {
    log('调度', '[DRY-RUN] 时间表预览：');
    [
      '09:15 交易日检查',
      '09:25 Channel B 竞价扫描',
      '14:30 Channel A 初筛',
      '14:50 Channel A 最终候选',
      '15:30 涨停池采集',
      '15:35 情绪指标+状态机',
      '16:00 复盘报告',
    ].forEach((item) => log('调度', `  ${item}`));
    return;
  }

  let channelACandidates = [];

  await scheduleAt('09:15', () => task0915(date));
  await scheduleAt('09:25', async () => { await task0925(date, currentState); });
  await scheduleAt('14:30', async () => {
    channelACandidates = await task1430(date, currentState);
  });
  await scheduleAt('14:50', async () => {
    await task1450(channelACandidates);
  });
  await scheduleAt('15:30', () => task1530(date));
  await scheduleAt('15:35', async () => {
    const newState = await task1535(date);
    if (newState) currentState = newState;
  });
  await scheduleAt('16:00', () => task1600(date, currentState, prevEmotionState));

  log('调度', `========== ${date} 日调度完成 ==========`);
}

// ──────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────

const date = forceDateArg ?? todayCompact();

if (!isTradingDay(date)) {
  log('调度', `${date} 非交易日，退出`);
  process.exit(0);
}

runDailySchedule(date).catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
