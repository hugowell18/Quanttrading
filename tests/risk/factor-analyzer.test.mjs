/**
 * 因子分析器测试
 * 运行：node tests/risk/factor-analyzer.test.mjs
 */
import assert from 'node:assert/strict';
import {
  computeWeeklyFactor,
  computeIC,
  computeRollingIC,
  detectFactorDegradation,
  checkFrequencyConsistency,
} from '../../server/risk/factor-analyzer.mjs';

// ── computeWeeklyFactor ──
{
  const daily = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const weekly = computeWeeklyFactor(daily);
  assert.equal(weekly.length, daily.length);
  // 第5个元素（index=4）= mean([1,2,3,4,5]) = 3
  assert.equal(weekly[4], 3);
  // 第10个元素（index=9）= mean([6,7,8,9,10]) = 8
  assert.equal(weekly[9], 8);
  console.log('✓ computeWeeklyFactor：5日滚动均值正确');
}
{
  // 不足5日时取已有数据均值
  const daily = [2, 4];
  const weekly = computeWeeklyFactor(daily);
  assert.equal(weekly[0], 2);   // 只有1个值
  assert.equal(weekly[1], 3);   // mean([2,4]) = 3
  console.log('✓ computeWeeklyFactor：不足5日取已有均值');
}

// ── computeIC ──
{
  // 完全正相关：IC = 1
  const f = [1, 2, 3, 4, 5];
  const r = [1, 2, 3, 4, 5];
  const ic = computeIC(f, r);
  assert.equal(ic, 1);
  console.log('✓ computeIC：完全正相关 IC=1');
}
{
  // 完全负相关：IC = -1
  const f = [1, 2, 3, 4, 5];
  const r = [5, 4, 3, 2, 1];
  const ic = computeIC(f, r);
  assert.equal(ic, -1);
  console.log('✓ computeIC：完全负相关 IC=-1');
}
{
  // 数据不足：返回 null
  const ic = computeIC([1], [1]);
  assert.equal(ic, null);
  console.log('✓ computeIC：数据不足返回 null');
}
{
  // 长度不等：返回 null
  const ic = computeIC([1, 2], [1]);
  assert.equal(ic, null);
  console.log('✓ computeIC：长度不等返回 null');
}

// ── computeRollingIC ──
{
  // 构造完全正相关序列，IC 应全为 1
  const n = 30;
  const f = Array.from({ length: n }, (_, i) => i + 1);
  const r = Array.from({ length: n }, (_, i) => i + 1);
  const { icSeries, icMean, icir } = computeRollingIC(f, r, 20);
  assert.ok(icSeries.length > 0);
  assert.ok(icSeries.every((ic) => Math.abs(ic - 1) < 0.001));
  assert.ok(Math.abs(icMean - 1) < 0.001);
  console.log(`✓ computeRollingIC：完全正相关 icMean=${icMean}, icir=${icir}`);
}

// ── detectFactorDegradation ──
{
  // IC 序列全部 > 0.01，因子有效
  const icSeries = Array.from({ length: 15 }, () => 0.05);
  const r = detectFactorDegradation(icSeries);
  assert.equal(r.degraded, false);
  console.log('✓ detectFactorDegradation：IC=0.05 因子有效');
}
{
  // 近10日 IC 均值 < 0.01，触发预警
  const icSeries = [
    ...Array.from({ length: 5 }, () => 0.08),   // 早期有效
    ...Array.from({ length: 10 }, () => 0.005),  // 近期失效
  ];
  const r = detectFactorDegradation(icSeries);
  assert.equal(r.degraded, true);
  assert.ok(r.message.includes('失效预警'));
  console.log('✓ detectFactorDegradation：近10日IC<0.01 触发预警');
}
{
  // 数据不足
  const r = detectFactorDegradation([0.05, 0.03]);
  assert.equal(r.degraded, false);
  assert.ok(r.message.includes('数据不足'));
  console.log('✓ detectFactorDegradation：数据不足不预警');
}

// ── checkFrequencyConsistency ──
{
  // 日频和周频同向（均大于基准）
  const r = checkFrequencyConsistency(0.8, 0.6, 0);
  assert.equal(r.consistent, true);
  assert.equal(r.bonus, 0.10);
  console.log('✓ checkFrequencyConsistency：同向，加权10%');
}
{
  // 日频和周频反向
  const r = checkFrequencyConsistency(0.8, -0.2, 0);
  assert.equal(r.consistent, false);
  assert.equal(r.bonus, 0);
  console.log('✓ checkFrequencyConsistency：反向，无加权');
}

console.log('\n所有测试通过 ✓');
