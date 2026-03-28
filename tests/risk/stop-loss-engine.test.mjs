/**
 * 三层止损引擎测试
 * 运行：node tests/risk/stop-loss-engine.test.mjs
 */
import assert from 'node:assert/strict';
import { checkStopLoss, checkAllStopLoss } from '../../server/risk/stop-loss-engine.mjs';

const positions = [
  { code: '000001', name: '平安银行', entryPrice: 10.00, entryDate: '20260320', channel: 'A' },
  { code: '000002', name: '万科A',    entryPrice: 8.00,  entryDate: '20260321', channel: 'B' },
  { code: '000003', name: '测试股C',  entryPrice: 20.00, entryDate: '20260322', channel: 'A' },
];

// ── 第一层：竞价止损 ──
{
  const r = checkStopLoss({ code: '000001', entryPrice: 10 }, { auctionPct: -4.5 });
  assert.equal(r.triggered, true);
  assert.equal(r.layer, 1);
  console.log('✓ 第一层：竞价低开4.5%触发');
}
{
  const r = checkStopLoss({ code: '000001', entryPrice: 10 }, { auctionPct: -2.9 });
  assert.equal(r.triggered, false);
  console.log('✓ 第一层：竞价低开2.9%不触发');
}
// 边界：恰好3%不触发（> 而非 >=）
{
  const r = checkStopLoss({ code: '000001', entryPrice: 10 }, { auctionPct: -3.0 });
  assert.equal(r.triggered, false);
  console.log('✓ 第一层：竞价低开3.0%边界不触发');
}

// ── 第二层：盘中止损 ──
{
  const r = checkStopLoss({ code: '000002', entryPrice: 8.00 }, { currentPrice: 7.58 });
  assert.equal(r.triggered, true);
  assert.equal(r.layer, 2);
  console.log('✓ 第二层：盘中跌5.25%触发');
}
{
  const r = checkStopLoss({ code: '000002', entryPrice: 8.00 }, { currentPrice: 7.62 });
  assert.equal(r.triggered, false);
  console.log('✓ 第二层：盘中跌4.75%不触发');
}

// ── 第三层：情绪止损 ──
{
  const r = checkStopLoss({ code: '000003', entryPrice: 20 }, { emotionState: '退潮' });
  assert.equal(r.triggered, true);
  assert.equal(r.layer, 3);
  console.log('✓ 第三层：情绪退潮触发');
}
{
  const r = checkStopLoss({ code: '000003', entryPrice: 20 }, { emotionState: '主升' });
  assert.equal(r.triggered, false);
  console.log('✓ 第三层：情绪主升不触发');
}

// ── 优先级：第一层 > 第二层 ──
{
  // 同时满足第一层和第二层，应返回第一层
  const r = checkStopLoss(
    { code: '000001', entryPrice: 10 },
    { auctionPct: -4.0, currentPrice: 9.40 },
  );
  assert.equal(r.layer, 1);
  console.log('✓ 优先级：第一层优先于第二层');
}

// ── 批量检查 ──
{
  const results = checkAllStopLoss(positions, {
    auctionMap:   new Map([['000001', -4.5]]),
    priceMap:     new Map([['000002', 7.58]]),
    emotionState: '主升',
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].stopLoss.layer, 1);  // 第一层排前面
  assert.equal(results[1].stopLoss.layer, 2);
  console.log('✓ 批量检查：正确识别2只止损，层级排序正确');
}
{
  // 情绪退潮：全部触发
  const results = checkAllStopLoss(positions, { emotionState: '退潮' });
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.stopLoss.layer === 3));
  console.log('✓ 批量检查：情绪退潮全部3只触发第三层');
}
{
  // 正常行情：无触发
  const results = checkAllStopLoss(positions, {
    auctionMap:   new Map([['000001', 1.2]]),
    priceMap:     new Map([['000001', 10.5]]),
    emotionState: '主升',
  });
  assert.equal(results.length, 0);
  console.log('✓ 批量检查：正常行情无止损');
}

console.log('\n所有测试通过 ✓');
