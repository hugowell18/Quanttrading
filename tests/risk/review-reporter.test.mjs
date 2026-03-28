/**
 * 复盘报告生成器测试
 * 运行：node tests/risk/review-reporter.test.mjs
 */
import assert from 'node:assert/strict';
import { generateReviewReport, formatReportText } from '../../server/risk/review-reporter.mjs';

const DATE = '20260327';

// 构造测试数据
const trades = [
  { code: '000001', name: '平安银行', channel: 'A', sector: '银行', returnPct: 3.2,  entryDate: '20260325' },
  { code: '000002', name: '万科A',    channel: 'A', sector: '地产', returnPct: -1.5, entryDate: '20260325' },
  { code: '000003', name: '宁德时代', channel: 'B', sector: '新能源', returnPct: 4.8, entryDate: '20260326' },
  { code: '000004', name: '比亚迪',   channel: 'B', sector: '新能源', returnPct: 2.1, entryDate: '20260326' },
];

const openPositions = [
  { code: '000005', name: '贵州茅台', channel: 'A', entryPrice: 1500, entryDate: '20260327', positionRatio: 0.15 },
];

// ── 基础报告生成 ──
{
  const report = generateReviewReport(DATE, {
    trades,
    openPositions,
    emotionState: '主升',
    prevEmotionState: '启动',
    mainlineSectors: ['新能源', '银行'],
    actualTopSectors: ['新能源', '半导体'],
    weeklyTrades: trades,
  });

  assert.equal(report.date, DATE);
  assert.equal(report.emotionState, '主升');
  assert.equal(report.emotionStateChanged, true);
  console.log('✓ 基础报告生成：字段正确');
}

// ── 通道统计 ──
{
  const report = generateReviewReport(DATE, { trades });

  // 通道A：2笔，1胜1负，胜率50%
  assert.equal(report.daily.channelA.count, 2);
  assert.equal(report.daily.channelA.winCount, 1);
  assert.equal(report.daily.channelA.winRate, 0.5);

  // 通道B：2笔，2胜，胜率100%
  assert.equal(report.daily.channelB.count, 2);
  assert.equal(report.daily.channelB.winRate, 1);

  // 全部：4笔，3胜，胜率75%
  assert.equal(report.daily.all.count, 4);
  assert.equal(report.daily.all.winRate, 0.75);
  console.log('✓ 通道统计：A/B/全部胜率正确');
}

// ── 板块归因 ──
{
  const report = generateReviewReport(DATE, { trades });
  const sectors = report.attribution.bySector;

  // 新能源板块：2笔，平均 (4.8+2.1)/2 = 3.45%
  const newEnergy = sectors.find((s) => s.sector === '新能源');
  assert.ok(newEnergy);
  assert.equal(newEnergy.count, 2);
  assert.equal(newEnergy.avgReturn, 3.45);
  console.log('✓ 板块归因：新能源平均收益3.45%');
}

// ── 情绪准确度 ──
{
  // 主升状态，胜率75% >= 50%，准确
  const report = generateReviewReport(DATE, { trades, emotionState: '主升' });
  assert.equal(report.accuracy.emotion, 'accurate');
  console.log('✓ 情绪准确度：主升+胜率75% = accurate');
}
{
  // 冰点状态，有交易 = 不准确
  const report = generateReviewReport(DATE, { trades, emotionState: '冰点' });
  assert.equal(report.accuracy.emotion, 'inaccurate');
  console.log('✓ 情绪准确度：冰点+有交易 = inaccurate');
}
{
  // 冰点状态，无交易 = 准确
  const report = generateReviewReport(DATE, { trades: [], emotionState: '冰点' });
  assert.equal(report.accuracy.emotion, 'accurate');
  console.log('✓ 情绪准确度：冰点+无交易 = accurate');
}

// ── 板块识别准确度 ──
{
  const report = generateReviewReport(DATE, {
    trades,
    mainlineSectors: ['新能源', '银行'],
    actualTopSectors: ['新能源', '半导体'],
  });
  // 命中1个（新能源），共2个主线，准确度 = 0.5
  assert.equal(report.accuracy.sector, 0.5);
  console.log('✓ 板块识别准确度：命中1/2 = 0.5');
}

// ── 周度统计 ──
{
  const report = generateReviewReport(DATE, { trades, weeklyTrades: trades });
  assert.equal(report.weekly.count, 4);
  assert.ok(report.weekly.sharpe != null);
  console.log(`✓ 周度统计：夏普比=${report.weekly.sharpe}`);
}

// ── 无交易时的空报告 ──
{
  const report = generateReviewReport(DATE, {});
  assert.equal(report.daily.all.count, 0);
  assert.equal(report.daily.all.winRate, 0);
  assert.equal(report.openPositions.length, 0);
  console.log('✓ 无交易：空报告正常生成');
}

// ── 格式化文本 ──
{
  const report = generateReviewReport(DATE, {
    trades,
    openPositions,
    emotionState: '主升',
    prevEmotionState: '启动',
    weeklyTrades: trades,
  });
  const text = formatReportText(report);
  assert.ok(text.includes('20260327'));
  assert.ok(text.includes('主升'));
  assert.ok(text.includes('通道A'));
  assert.ok(text.includes('通道B'));
  console.log('✓ 格式化文本：包含关键字段');
}

console.log('\n所有测试通过 ✓');
