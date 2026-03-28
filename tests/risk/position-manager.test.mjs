/**
 * 仓位管理模块测试
 * 运行：node tests/risk/position-manager.test.mjs
 */
import assert from 'node:assert/strict';
import {
  getAvailablePosition,
  tryOpenPosition,
  calcOpenAmount,
  CHANNEL_ALLOCATION,
  MAX_POSITIONS,
} from '../../server/risk/position-manager.mjs';

// ── getAvailablePosition ──
{
  // 主升状态（80%），无持仓，通道A上限 = 80% * 70% = 56%
  const r = getAvailablePosition('主升', [], 'A');
  assert.equal(r.totalLimit, 0.8);
  assert.equal(r.channelLimit, 0.56);
  assert.equal(r.available, 0.56);
  assert.equal(r.reason, null);
  console.log('✓ 主升无持仓：通道A可用56%');
}
{
  // 冰点状态：禁止开仓
  const r = getAvailablePosition('冰点', [], 'A');
  assert.equal(r.available, 0);
  assert.ok(r.reason?.includes('冰点'));
  console.log('✓ 冰点状态：禁止开仓');
}
{
  // 退潮状态：禁止开仓
  const r = getAvailablePosition('退潮', [], 'B');
  assert.ok(r.reason?.includes('退潮'));
  console.log('✓ 退潮状态：禁止开仓');
}
{
  // 主升，通道A已用20%，还可用36%
  const positions = [{ code: '000001', channel: 'A', positionRatio: 0.20 }];
  const r = getAvailablePosition('主升', positions, 'A');
  assert.equal(r.channelUsed, 0.20);
  assert.equal(r.available, 0.36);
  console.log('✓ 主升通道A已用20%：剩余36%');
}
{
  // 持仓达5只上限
  const positions = Array.from({ length: MAX_POSITIONS }, (_, i) => ({
    code: `00000${i}`, channel: 'A', positionRatio: 0.05,
  }));
  const r = getAvailablePosition('主升', positions, 'A');
  assert.ok(r.reason?.includes('5 只'));
  console.log('✓ 持仓5只：拒绝开仓');
}

// ── tryOpenPosition ──
{
  // 正常开仓
  const r = tryOpenPosition('主升', [], { code: '000001', channel: 'A', positionCap: 0.20 });
  assert.equal(r.ok, true);
  assert.equal(r.allocatedRatio, 0.20);
  console.log('✓ 正常开仓：分配20%');
}
{
  // 重复开仓
  const positions = [{ code: '000001', channel: 'A', positionRatio: 0.20 }];
  const r = tryOpenPosition('主升', positions, { code: '000001', channel: 'A', positionCap: 0.20 });
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes('已持有'));
  console.log('✓ 重复开仓：拒绝');
}
{
  // 可用仓位小于单股上限，取较小值
  const positions = [{ code: '000001', channel: 'B', positionRatio: 0.20 }];
  // 主升通道B上限 = 80%*30% = 24%，已用20%，剩余4%
  const r = tryOpenPosition('主升', positions, { code: '000002', channel: 'B', positionCap: 0.15 });
  assert.equal(r.ok, true);
  assert.equal(r.allocatedRatio, 0.04);
  console.log('✓ 可用仓位不足单股上限：取较小值4%');
}

// ── calcOpenAmount ──
{
  const { amount, shares } = calcOpenAmount(100000, 0.20, 10.5);
  assert.equal(shares % 100, 0);  // 必须是100的整数倍
  assert.ok(amount <= 100000 * 0.20);
  console.log(`✓ 开仓金额计算：${shares}股，${amount}元`);
}

console.log('\n所有测试通过 ✓');
