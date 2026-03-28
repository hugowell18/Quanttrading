/**
 * 监管合规约束测试
 * 运行：node tests/risk/compliance-guard.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkCompliance,
  updateComplianceState,
  readComplianceState,
  writeComplianceState,
  processOperation,
} from '../../server/risk/compliance-guard.mjs';

const DATE = '20260327';
const STATE_PATH = resolve(process.cwd(), 'cache', 'risk', `compliance-${DATE}.json`);
if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);

// ── 约束1：撤单次数 ──
{
  const state = readComplianceState(DATE);
  // 模拟已撤单 50 次
  state.cancelCount['000001'] = 50;

  const r = checkCompliance({ type: 'cancel', code: '000001' }, state);
  assert.equal(r.allowed, false);
  assert.ok(r.violations[0].includes('撤单超限'));
  console.log('✓ 撤单超限：拒绝');
}
{
  const state = readComplianceState(DATE);
  state.cancelCount['000001'] = 49;

  const r = checkCompliance({ type: 'cancel', code: '000001' }, state);
  assert.equal(r.allowed, true);
  console.log('✓ 撤单49次：允许');
}

// ── 约束2：交易间隔 ──
{
  const state = readComplianceState(DATE);
  const now = Date.now();
  state.lastTradeTime['000002'] = now - 30_000;  // 30秒前操作过

  const r = checkCompliance({ type: 'buy', code: '000002', timestamp: now }, state);
  assert.equal(r.allowed, false);
  assert.ok(r.violations[0].includes('间隔不足'));
  console.log('✓ 间隔30秒：拒绝');
}
{
  const state = readComplianceState(DATE);
  const now = Date.now();
  state.lastTradeTime['000002'] = now - 61_000;  // 61秒前操作过

  const r = checkCompliance({ type: 'buy', code: '000002', timestamp: now }, state);
  assert.equal(r.allowed, true);
  console.log('✓ 间隔61秒：允许');
}
{
  // 首次操作（无历史记录）：允许
  const state = readComplianceState(DATE);
  const r = checkCompliance({ type: 'buy', code: '000003' }, state);
  assert.equal(r.allowed, true);
  console.log('✓ 首次操作：允许');
}

// ── 约束3：涨跌停附近买入笔数 ──
{
  const state = readComplianceState(DATE);
  state.limitTradeCount = 10;  // 已达上限

  // 价格接近涨停（昨收10元，涨停11元，买入价10.96 在涨停-0.4%内）
  const r = checkCompliance(
    { type: 'buy', code: '000004', price: 10.96, prevClose: 10.0 },
    state,
  );
  assert.equal(r.allowed, false);
  assert.ok(r.violations[0].includes('涨跌停超限'));
  console.log('✓ 涨跌停附近买入超10笔：拒绝');
}
{
  const state = readComplianceState(DATE);
  state.limitTradeCount = 9;

  const r = checkCompliance(
    { type: 'buy', code: '000004', price: 10.96, prevClose: 10.0 },
    state,
  );
  assert.equal(r.allowed, true);
  console.log('✓ 涨跌停附近买入9笔：允许');
}
{
  // 价格不在涨跌停附近：不计入限制
  const state = readComplianceState(DATE);
  state.limitTradeCount = 10;

  const r = checkCompliance(
    { type: 'buy', code: '000005', price: 10.5, prevClose: 10.0 },  // 涨5%，不在±0.5%内
    state,
  );
  assert.equal(r.allowed, true);
  console.log('✓ 价格不在涨跌停附近：不受笔数限制');
}

// ── updateComplianceState ──
{
  const state = readComplianceState(DATE);
  const now = Date.now();

  updateComplianceState(state, { type: 'cancel', code: '000006' });
  assert.equal(state.cancelCount['000006'], 1);

  updateComplianceState(state, { type: 'cancel', code: '000006' });
  assert.equal(state.cancelCount['000006'], 2);

  updateComplianceState(state, { type: 'buy', code: '000006', timestamp: now });
  assert.equal(state.lastTradeTime['000006'], now);

  console.log('✓ updateComplianceState：计数器正确累加');
}

// ── processOperation（一步完成）──
{
  if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);

  // 首次买入：允许，并更新状态
  const r1 = processOperation({ type: 'buy', code: '000007' }, DATE);
  assert.equal(r1.allowed, true);

  // 立即再次买入：间隔不足，拒绝
  const r2 = processOperation({ type: 'buy', code: '000007', timestamp: Date.now() }, DATE);
  assert.equal(r2.allowed, false);

  // 验证违规记录写入了文件
  const state = readComplianceState(DATE);
  assert.ok(state.violations.length > 0);
  console.log('✓ processOperation：允许+拒绝+违规记录均正确');
}

// 清理
if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);

console.log('\n所有测试通过 ✓');
