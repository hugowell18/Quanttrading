/**
 * 单元测试：ApiResponse<T> 与 ApiErrorResponse 类型守卫函数
 * 验证：需求 14.1、14.2
 */
import { describe, it, expect } from 'vitest';
import { isApiResponse, isApiErrorResponse } from '../../src/app/types/api';

describe('isApiResponse', () => {
  it('对有效的 { ok: true, data: ... } 对象返回 true', () => {
    expect(isApiResponse({ ok: true, data: { value: 42 } })).toBe(true);
    expect(isApiResponse({ ok: true, data: [] })).toBe(true);
    expect(isApiResponse({ ok: true, data: 'hello' })).toBe(true);
    expect(isApiResponse({ ok: true, data: 0 })).toBe(true);
  });

  it('对 { ok: false, error: ... } 对象返回 false', () => {
    expect(isApiResponse({ ok: false, error: 'not found' })).toBe(false);
  });

  it('对缺少 data 字段的对象返回 false', () => {
    expect(isApiResponse({ ok: true })).toBe(false);
  });

  it('对 ok 不为 true 的对象返回 false', () => {
    expect(isApiResponse({ ok: 1, data: {} })).toBe(false);
    expect(isApiResponse({ ok: 'true', data: {} })).toBe(false);
    expect(isApiResponse({ data: {} })).toBe(false);
  });

  it('对 null 和 undefined 返回 false', () => {
    expect(isApiResponse(null)).toBe(false);
    expect(isApiResponse(undefined)).toBe(false);
  });

  it('对非对象类型返回 false', () => {
    expect(isApiResponse(42)).toBe(false);
    expect(isApiResponse('string')).toBe(false);
    expect(isApiResponse(true)).toBe(false);
    expect(isApiResponse([])).toBe(false);
  });
});

describe('isApiErrorResponse', () => {
  it('对有效的 { ok: false, error: string } 对象返回 true', () => {
    expect(isApiErrorResponse({ ok: false, error: 'not found' })).toBe(true);
    expect(isApiErrorResponse({ ok: false, error: '' })).toBe(true);
    expect(isApiErrorResponse({ ok: false, error: '资源不存在' })).toBe(true);
  });

  it('对 { ok: true, data: ... } 对象返回 false', () => {
    expect(isApiErrorResponse({ ok: true, data: {} })).toBe(false);
  });

  it('对缺少 error 字段的对象返回 false', () => {
    expect(isApiErrorResponse({ ok: false })).toBe(false);
  });

  it('对 error 不为 string 的对象返回 false', () => {
    expect(isApiErrorResponse({ ok: false, error: 404 })).toBe(false);
    expect(isApiErrorResponse({ ok: false, error: null })).toBe(false);
    expect(isApiErrorResponse({ ok: false, error: { msg: 'err' } })).toBe(false);
  });

  it('对 ok 不为 false 的对象返回 false', () => {
    expect(isApiErrorResponse({ ok: true, error: 'oops' })).toBe(false);
    expect(isApiErrorResponse({ ok: 0, error: 'oops' })).toBe(false);
    expect(isApiErrorResponse({ error: 'oops' })).toBe(false);
  });

  it('对 null 和 undefined 返回 false', () => {
    expect(isApiErrorResponse(null)).toBe(false);
    expect(isApiErrorResponse(undefined)).toBe(false);
  });

  it('对非对象类型返回 false', () => {
    expect(isApiErrorResponse(42)).toBe(false);
    expect(isApiErrorResponse('error')).toBe(false);
  });
});

describe('判别联合类型收窄', () => {
  it('isApiResponse 通过后 TypeScript 应收窄为 ApiResponse<T>', () => {
    const val: unknown = { ok: true, data: { price: 100 } };
    if (isApiResponse<{ price: number }>(val)) {
      // 编译通过即证明类型收窄正确
      expect(val.ok).toBe(true);
      expect(val.data.price).toBe(100);
    } else {
      throw new Error('应通过 isApiResponse 检查');
    }
  });

  it('isApiErrorResponse 通过后 TypeScript 应收窄为 ApiErrorResponse', () => {
    const val: unknown = { ok: false, error: '404 Not Found' };
    if (isApiErrorResponse(val)) {
      expect(val.ok).toBe(false);
      expect(val.error).toBe('404 Not Found');
    } else {
      throw new Error('应通过 isApiErrorResponse 检查');
    }
  });

  it('同一值只能匹配其中一个守卫', () => {
    const success: unknown = { ok: true, data: [1, 2, 3] };
    const failure: unknown = { ok: false, error: 'oops' };

    expect(isApiResponse(success)).toBe(true);
    expect(isApiErrorResponse(success)).toBe(false);

    expect(isApiResponse(failure)).toBe(false);
    expect(isApiErrorResponse(failure)).toBe(true);
  });
});
