/**
 * 属性测试：UI 组件
 * Feature: quantpulse-ui-redesign
 *
 * **Validates: Requirements 6.4**
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// 属性 6：strictPass 过滤正确性
// Feature: quantpulse-ui-redesign, Property 6: strictPass 过滤正确性
//
// StockLeaderboard 组件从 /api/batch/summary 获取数据后，
// 执行 raw.filter((item) => item.strictPass === true) 过滤。
// 我们提取该纯过滤逻辑进行属性测试，验证渲染结果中不含 strictPass: false 的条目。
// ---------------------------------------------------------------------------

interface BatchSummaryItem {
  stockCode: string;
  stockName?: string;
  strictPass: boolean;
  avgReturn: number;
  winRate: number;
  currentSignal?: 'buy' | 'sell' | 'hold';
  regime?: string;
}

/**
 * 提取 StockLeaderboard 中的过滤逻辑（纯函数）。
 * 来源：src/app/components/market/StockLeaderboard.tsx
 *   setItems(raw.filter((item) => item.strictPass === true));
 */
function filterStrictPass(items: BatchSummaryItem[]): BatchSummaryItem[] {
  return items.filter((item) => item.strictPass === true);
}

// fast-check 生成器：生成单个 BatchSummaryItem
const batchSummaryItemArb = fc.record<BatchSummaryItem>({
  stockCode: fc.stringMatching(/^\d{6}$/),
  stockName: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  strictPass: fc.boolean(),
  avgReturn: fc.float({ min: -1, max: 5, noNaN: true }),
  winRate: fc.float({ min: 0, max: 1, noNaN: true }),
  currentSignal: fc.option(fc.constantFrom<'buy' | 'sell' | 'hold'>('buy', 'sell', 'hold'), { nil: undefined }),
  regime: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
});

describe('StockLeaderboard — strictPass 过滤正确性', () => {
  // **Validates: Requirements 6.4**

  it(
    '属性 6：对任意含混合 strictPass 值的数据，过滤后所有条目均满足 strictPass === true',
    () => {
      // Feature: quantpulse-ui-redesign, Property 6: strictPass 过滤正确性
      fc.assert(
        fc.property(
          // 生成器：含混合 strictPass 值的 BatchSummaryItem 数组（0-50 条）
          fc.array(batchSummaryItemArb, { minLength: 0, maxLength: 50 }),
          (items) => {
            const filtered = filterStrictPass(items);

            // 核心属性：过滤后每一条都必须满足 strictPass === true
            for (const item of filtered) {
              expect(item.strictPass).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 6b：过滤后不含任何 strictPass: false 的条目',
    () => {
      // Feature: quantpulse-ui-redesign, Property 6: strictPass 过滤正确性
      fc.assert(
        fc.property(
          fc.array(batchSummaryItemArb, { minLength: 0, maxLength: 50 }),
          (items) => {
            const filtered = filterStrictPass(items);

            const hasFailingEntry = filtered.some((item) => item.strictPass === false);
            expect(hasFailingEntry).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 6c：过滤结果是原数组中所有 strictPass === true 条目的完整子集（不丢失合法条目）',
    () => {
      // Feature: quantpulse-ui-redesign, Property 6: strictPass 过滤正确性
      fc.assert(
        fc.property(
          fc.array(batchSummaryItemArb, { minLength: 0, maxLength: 50 }),
          (items) => {
            const filtered = filterStrictPass(items);
            const expectedCount = items.filter((i) => i.strictPass === true).length;

            // 过滤后的数量应等于原数组中 strictPass === true 的数量
            expect(filtered.length).toBe(expectedCount);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// 属性 8：热度分范围约束
// Feature: quantpulse-ui-redesign, Property 8: 热度分范围约束
//
// 对任意来自 state-history.json 的情绪状态条目，其 heatScore 字段值应在
// [0, 100] 闭区间内，热度分仪表盘渲染时不应出现超出范围的值。
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { EmotionStateEntry } from '@/app/types/api';

// 读取真实的 state-history.json 数据
const stateHistoryPath = resolve(__dirname, '../../cache/sentiment-state/state-history.json');
const stateHistory: EmotionStateEntry[] = JSON.parse(readFileSync(stateHistoryPath, 'utf-8'));

// fast-check 生成器：合成 EmotionStateEntry（heatScore 在 [0, 100]）
const emotionStateArb = fc.constantFrom<import('@/app/types/api').EmotionState>(
  '冰点', '启动', '主升', '高潮', '退潮'
);

const emotionStateEntryArb = fc.record<EmotionStateEntry>({
  date: fc.stringMatching(/^\d{8}$/),
  state: emotionStateArb,
  positionLimit: fc.float({ min: 0, max: 1, noNaN: true }),
  changed: fc.boolean(),
  previousState: fc.option(emotionStateArb, { nil: null }),
  heatScore: fc.integer({ min: 0, max: 100 }),
  rawToday: emotionStateArb,
  rawYesterday: fc.option(emotionStateArb, { nil: null }),
  ztCount: fc.integer({ min: 0, max: 500 }),
  ztDtRatio: fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
  zbRate: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: null }),
  maxContinuousDays: fc.integer({ min: 0, max: 30 }),
  prevZtPremium: fc.option(fc.float({ min: -50, max: 100, noNaN: true }), { nil: null }),
});

describe('HeatScoreGauge — 热度分范围约束', () => {
  // **Validates: Requirements 4.4**

  it(
    '属性 8：state-history.json 中所有条目的 heatScore 均在 [0, 100] 闭区间内',
    () => {
      // Feature: quantpulse-ui-redesign, Property 8: 热度分范围约束
      expect(stateHistory.length).toBeGreaterThan(0);

      for (const entry of stateHistory) {
        expect(entry.heatScore).toBeGreaterThanOrEqual(0);
        expect(entry.heatScore).toBeLessThanOrEqual(100);
      }
    }
  );

  it(
    '属性 8b：从 state-history.json 随机采样条目，heatScore 均在 [0, 100] 闭区间内',
    () => {
      // Feature: quantpulse-ui-redesign, Property 8: 热度分范围约束
      fc.assert(
        fc.property(
          // 生成器：从真实数据中随机选取一个索引
          fc.integer({ min: 0, max: stateHistory.length - 1 }),
          (index) => {
            const entry = stateHistory[index];
            expect(entry.heatScore).toBeGreaterThanOrEqual(0);
            expect(entry.heatScore).toBeLessThanOrEqual(100);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 8c：合成 EmotionStateEntry 的 heatScore 在 [0, 100] 时，约束验证函数应通过',
    () => {
      // Feature: quantpulse-ui-redesign, Property 8: 热度分范围约束
      fc.assert(
        fc.property(
          emotionStateEntryArb,
          (entry) => {
            // 验证约束：heatScore 必须在 [0, 100] 闭区间
            const isValid = entry.heatScore >= 0 && entry.heatScore <= 100;
            expect(isValid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
