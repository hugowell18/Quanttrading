/**
 * 每日自动复盘报告生成器
 * Phase 4.6 / 需求 17 / 任务书 4.6
 *
 * 报告内容：
 *   - 当日盈亏明细（通道A/B分别统计）
 *   - 盈亏归因（板块贡献 / 个股贡献 / 择时贡献）
 *   - 情绪状态准确度（预测状态 vs 实际行情）
 *   - 主线板块识别准确度
 *   - 本周累计收益与夏普比滚动值
 *
 * 报告持久化：cache/risk/review/YYYYMMDD.json
 * 推送：通过 push-notifier.mjs（若已配置）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const REVIEW_DIR = resolve(ROOT, 'cache', 'risk', 'review');
mkdirSync(REVIEW_DIR, { recursive: true });

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

// ──────────────────────────────────────────────
// 核心：生成复盘报告
// ──────────────────────────────────────────────

/**
 * 生成当日复盘报告
 *
 * @param {string} date  YYYYMMDD
 * @param {object} data
 *   {
 *     trades:         TradeRecord[],     // 当日已平仓交易
 *     openPositions:  Position[],        // 当日收盘时持仓
 *     emotionState:   string,            // 当日情绪状态
 *     prevEmotionState: string,          // 前日情绪状态
 *     mainlineSectors: string[],         // 当日识别的主线板块
 *     actualTopSectors?: string[],       // 实际表现最好的板块（可选，用于准确度评估）
 *     weeklyTrades?:  TradeRecord[],     // 本周全部交易（用于周度统计）
 *   }
 * @returns {ReviewReport}
 */
export function generateReviewReport(date, data) {
  const {
    trades = [],
    openPositions = [],
    emotionState = '未知',
    prevEmotionState = '未知',
    mainlineSectors = [],
    actualTopSectors = [],
    weeklyTrades = [],
  } = data;

  // ── 当日盈亏统计 ──
  const channelA = trades.filter((t) => t.channel === 'A');
  const channelB = trades.filter((t) => t.channel === 'B');

  const calcChannelStats = (channelTrades) => {
    if (!channelTrades.length) return { count: 0, winCount: 0, winRate: 0, totalReturn: 0, avgReturn: 0 };
    const wins = channelTrades.filter((t) => (t.returnPct ?? 0) > 0);
    const totalReturn = round2(channelTrades.reduce((s, t) => s + (t.returnPct ?? 0), 0));
    return {
      count:       channelTrades.length,
      winCount:    wins.length,
      winRate:     round4(wins.length / channelTrades.length),
      totalReturn,
      avgReturn:   round2(totalReturn / channelTrades.length),
    };
  };

  const allStats = calcChannelStats(trades);
  const aStats   = calcChannelStats(channelA);
  const bStats   = calcChannelStats(channelB);

  // ── 盈亏归因 ──
  // 板块贡献：各板块内交易的平均收益
  const sectorContrib = {};
  for (const trade of trades) {
    const sector = trade.sector ?? '未知板块';
    if (!sectorContrib[sector]) sectorContrib[sector] = [];
    sectorContrib[sector].push(trade.returnPct ?? 0);
  }
  const sectorAttribution = Object.entries(sectorContrib).map(([sector, returns]) => ({
    sector,
    avgReturn: round2(mean(returns)),
    count: returns.length,
  })).sort((a, b) => b.avgReturn - a.avgReturn);

  // ── 情绪状态准确度 ──
  // 简单规则：主升/启动状态下当日有盈利交易 = 准确；退潮/冰点下无新开仓 = 准确
  let emotionAccuracy = null;
  if (emotionState === '主升' || emotionState === '启动') {
    emotionAccuracy = allStats.winRate >= 0.5 ? 'accurate' : 'inaccurate';
  } else if (emotionState === '冰点' || emotionState === '退潮') {
    emotionAccuracy = trades.length === 0 ? 'accurate' : 'inaccurate';
  }

  // ── 主线板块识别准确度 ──
  let sectorAccuracy = null;
  if (mainlineSectors.length > 0 && actualTopSectors.length > 0) {
    const hits = mainlineSectors.filter((s) => actualTopSectors.includes(s)).length;
    sectorAccuracy = round4(hits / mainlineSectors.length);
  }

  // ── 周度统计 ──
  const weekStats = calcChannelStats(weeklyTrades);
  const weekReturns = weeklyTrades.map((t) => t.returnPct ?? 0);
  const weekSharpe = weekReturns.length >= 2
    ? round4(mean(weekReturns) / (std(weekReturns) || 1) * Math.sqrt(252 / 5))
    : null;

  // ── 持仓快照 ──
  const positionSnapshot = openPositions.map((p) => ({
    code:         p.code,
    name:         p.name ?? p.code,
    channel:      p.channel,
    entryPrice:   p.entryPrice,
    entryDate:    p.entryDate,
    positionRatio: p.positionRatio,
  }));

  const report = {
    date,
    generatedAt: new Date().toISOString(),
    emotionState,
    prevEmotionState,
    emotionStateChanged: emotionState !== prevEmotionState,

    // 当日交易统计
    daily: {
      all:     allStats,
      channelA: aStats,
      channelB: bStats,
    },

    // 盈亏归因
    attribution: {
      bySector: sectorAttribution,
    },

    // 准确度评估
    accuracy: {
      emotion: emotionAccuracy,
      sector:  sectorAccuracy,
      mainlineSectors,
      actualTopSectors,
    },

    // 周度统计
    weekly: {
      ...weekStats,
      sharpe: weekSharpe,
    },

    // 持仓快照
    openPositions: positionSnapshot,
  };

  return report;
}

// ──────────────────────────────────────────────
// 持久化
// ──────────────────────────────────────────────

/**
 * 保存复盘报告到本地
 */
export function saveReviewReport(report) {
  const path = resolve(REVIEW_DIR, `${report.date}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
  return path;
}

/**
 * 读取指定日期的复盘报告
 */
export function loadReviewReport(date) {
  const path = resolve(REVIEW_DIR, `${date}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * 格式化报告为可读文本（用于推送）
 */
export function formatReportText(report) {
  const d = report.daily;
  const lines = [
    `📊 ${report.date} 每日复盘`,
    `情绪状态：${report.prevEmotionState} → ${report.emotionState}${report.emotionStateChanged ? ' ⚡变化' : ''}`,
    '',
    `【当日交易】共 ${d.all.count} 笔`,
    `  胜率：${(d.all.winRate * 100).toFixed(1)}%  平均收益：${d.all.avgReturn > 0 ? '+' : ''}${d.all.avgReturn}%`,
    `  通道A：${d.channelA.count}笔 胜率${(d.channelA.winRate * 100).toFixed(1)}%`,
    `  通道B：${d.channelB.count}笔 胜率${(d.channelB.winRate * 100).toFixed(1)}%`,
  ];

  if (report.attribution.bySector.length > 0) {
    lines.push('', '【板块贡献 TOP3】');
    report.attribution.bySector.slice(0, 3).forEach((s) => {
      lines.push(`  ${s.sector}：${s.avgReturn > 0 ? '+' : ''}${s.avgReturn}% (${s.count}笔)`);
    });
  }

  if (report.accuracy.emotion) {
    lines.push('', `【情绪准确度】${report.accuracy.emotion === 'accurate' ? '✓ 准确' : '✗ 偏差'}`);
  }

  if (report.weekly.count > 0) {
    lines.push('', `【本周累计】${report.weekly.count}笔 胜率${(report.weekly.winRate * 100).toFixed(1)}% 夏普${report.weekly.sharpe ?? 'N/A'}`);
  }

  if (report.openPositions.length > 0) {
    lines.push('', `【持仓】${report.openPositions.length}只`);
    report.openPositions.forEach((p) => {
      lines.push(`  ${p.name}(${p.code}) 通道${p.channel} ${(p.positionRatio * 100).toFixed(1)}%`);
    });
  }

  return lines.join('\n');
}
