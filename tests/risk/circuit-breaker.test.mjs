/**
 * 连续亏损熔断机制测试
 * 运行：node tests/risk/circuit-breaker.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkCircuitBreaker,
  recordTradeResult,
  resetCircuitBreaker,
} from '../../server/risk/circuit-breaker.mjs';

// 测试前清除状态文件
const CB_PATH = resolve(process.cwd(), 'cache', 'risk', 'circuit-breaker.json');
if (existsSync(CB_PATH)) unlinkSync(CB_PATH);

// ── 初始状态：无熔断 ──
{
  const r = checkCircuitBreaker('20260327');
  assert.equal(r.active, false);
  assert.equal(r.triggeredAt, null);
  console.log('✓ 初始状态：无熔断');
}

// ── 连续2笔亏损，不触发 ──
{
  resetCircuitBreaker();
  recordTradeResult({ date: '20260320', code: '000001', returnPct: -2.5 });
  recordTradeResult({ date: '20260321', code: '000002', returnPct: -1.8 });
  const r = checkCircuitBreaker('20260321');
  assert.equal(r.active, false);
  console.log('✓ 连续2笔亏损：不触发熔断');
}

// ── 连续3笔亏损，触发熔断 ──
{
  resetCircuitBreaker();
  recordTradeResult({ date: '20260320', code: '000001', returnPct: -2.5 });
  recordTradeResult({ date: '20260321', code: '000002', returnPct: -1.8 });
  const r3 = recordTradeResult({ date: '20260324', code: '000003', returnPct: -3.1 });
  assert.equal(r3.triggered, true);
  assert.equal(r3.consecutiveLosses, 3);
  assert.equal(r3.triggeredAt, '20260324');
  console.log('✓ 连续3笔亏损：触发熔断');
}

// ── 熔断期间：active=true ──
{
  const r = checkCircuitBreaker('20260325');
  assert.equal(r.active, true);
  assert.ok(r.remainingDays > 0);
  console.log(`✓ 熔断期间：active=true，剩余${r.remainingDays}天`);
}

// ── 熔断期满：自动恢复 ──
{
  // 触发日 20260324，+2个交易日 = 20260326
  const r = checkCircuitBreaker('20260326');
  assert.equal(r.active, false);
  console.log('✓ 熔断期满（20260326）：自动恢复');
}

// ── 中间有盈利，连续亏损计数重置 ──
{
  resetCircuitBreaker();
  recordTradeResult({ date: '20260320', code: '000001', returnPct: -2.5 });
  recordTradeResult({ date: '20260321', code: '000002', returnPct: -1.8 });
  recordTradeResult({ date: '20260324', code: '000003', returnPct: 3.2 });  // 盈利，重置
  const r4 = recordTradeResult({ date: '20260325', code: '000004', returnPct: -1.0 });
  assert.equal(r4.triggered, false);
  assert.equal(r4.consecutiveLosses, 1);
  console.log('✓ 中间有盈利：连续亏损计数重置');
}

// ── 重置熔断 ──
{
  resetCircuitBreaker();
  recordTradeResult({ date: '20260320', code: '000001', returnPct: -2.5 });
  recordTradeResult({ date: '20260321', code: '000002', returnPct: -1.8 });
  recordTradeResult({ date: '20260324', code: '000003', returnPct: -3.1 });
  resetCircuitBreaker();
  const r = checkCircuitBreaker('20260325');
  assert.equal(r.active, false);
  console.log('✓ 手动重置：熔断清除');
}

// 清理测试产生的状态文件
if (existsSync(CB_PATH)) unlinkSync(CB_PATH);

console.log('\n所有测试通过 ✓');
