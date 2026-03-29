/**
 * 属性测试：API 响应格式
 * Feature: quantpulse-ui-redesign
 *
 * **Validates: Requirements 14.1, 14.2, 14.5, 3.7, 4.6**
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { isApiResponse, isApiErrorResponse } from '../../src/app/types/api.ts';

// ---------------------------------------------------------------------------
// 属性 3：API 成功响应格式统一性（真实 HTTP 请求）
// Feature: quantpulse-ui-redesign, Property 3: API 成功响应格式统一性
//
// 对任意新增 API 端点的成功请求，响应体应包含 ok: true 字段和 data 字段，
// 且 data 不为 undefined。
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3001';

/** 检查服务器是否在线，不在线则跳过集成测试 */
async function isServerOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/status`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// 已知存在于 cache/kline/ 的指数代码（4个主要指数）
const KNOWN_KLINE_CODES = ['000300.SH', '000001.SH', '399001.SZ', '399006.SZ'];

// 已知存在于 cache/sentiment/ 和 cache/ztpool/ 的日期（取近期几个）
const KNOWN_DATES = [
  '20260327', '20260326', '20260325', '20260324', '20260320',
  '20260319', '20260318', '20260317', '20260316', '20260313',
];

describe('属性 3：API 成功响应格式统一性（真实 HTTP 请求）', () => {
  // **Validates: Requirements 14.1, 3.7, 4.6**

  let serverOnline = false;

  beforeAll(async () => {
    serverOnline = await isServerOnline();
  });

  it(
    '属性 3：对任意新增端点的成功请求，响应应包含 ok: true 和非 undefined 的 data 字段',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 3] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      // 构建所有端点 URL 列表（使用真实存在的数据）
      const endpoints = [
        `/api/market/kline/000300.SH`,
        `/api/sentiment/metrics?date=20260327`,
        `/api/sentiment/state-history`,
        `/api/ztpool?date=20260327`,
        `/api/ztpool/dates`,
        `/api/admin/kline/list`,
        `/api/admin/kline/000300.SH`,
        `/api/admin/ztpool/list`,
        `/api/admin/sentiment/list`,
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...endpoints),
          async (endpoint) => {
            const res = await fetch(`${BASE_URL}${endpoint}`, {
              signal: AbortSignal.timeout(5000),
            });

            // 属性 3a：HTTP 状态码应为 2xx（成功）
            expect(res.status).toBeGreaterThanOrEqual(200);
            expect(res.status).toBeLessThan(300);

            const body = await res.json() as unknown;

            // 属性 3b：响应体应通过 isApiResponse 检查（ok: true 且 data !== undefined）
            expect(isApiResponse(body)).toBe(true);

            if (isApiResponse(body)) {
              // 属性 3c：data 字段不为 undefined
              expect(body.data).not.toBeUndefined();
            }
          }
        ),
        { numRuns: 50 }
      );
    },
    30000 // 30秒超时，允许多次 HTTP 请求
  );

  it(
    '属性 3（扩展）：使用随机选取的 kline 代码，响应格式应统一',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 3 扩展] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...KNOWN_KLINE_CODES),
          async (code) => {
            const res = await fetch(`${BASE_URL}/api/market/kline/${code}`, {
              signal: AbortSignal.timeout(5000),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as unknown;
            expect(isApiResponse(body)).toBe(true);

            if (isApiResponse(body)) {
              expect(body.data).not.toBeUndefined();
              // data 应为数组（K 线数据点列表）
              expect(Array.isArray(body.data)).toBe(true);
            }
          }
        ),
        { numRuns: 20 }
      );
    },
    30000
  );

  it(
    '属性 3（扩展）：使用随机选取的 sentiment 日期，响应格式应统一',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 3 扩展] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...KNOWN_DATES),
          async (date) => {
            const res = await fetch(`${BASE_URL}/api/sentiment/metrics?date=${date}`, {
              signal: AbortSignal.timeout(5000),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as unknown;
            expect(isApiResponse(body)).toBe(true);

            if (isApiResponse(body)) {
              expect(body.data).not.toBeUndefined();
            }
          }
        ),
        { numRuns: 20 }
      );
    },
    30000
  );

  it(
    '属性 3（扩展）：使用随机选取的 ztpool 日期，响应格式应统一',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 3 扩展] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...KNOWN_DATES),
          async (date) => {
            const res = await fetch(`${BASE_URL}/api/ztpool?date=${date}`, {
              signal: AbortSignal.timeout(5000),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as unknown;
            expect(isApiResponse(body)).toBe(true);

            if (isApiResponse(body)) {
              expect(body.data).not.toBeUndefined();
            }
          }
        ),
        { numRuns: 20 }
      );
    },
    30000
  );
});

// ---------------------------------------------------------------------------
// 属性 3：API 成功响应格式统一性
// Feature: quantpulse-ui-redesign, Property 3: API 成功响应格式统一性
//
// 对任意成功响应对象，isApiResponse 应返回 true，且对象包含 ok: true 和非 undefined 的 data。
// ---------------------------------------------------------------------------

describe('API — 成功响应格式统一性', () => {
  // **Validates: Requirements 14.1, 3.7, 4.6**

  it(
    '属性 3：对任意合法的成功响应对象，isApiResponse 应返回 true',
    () => {
      fc.assert(
        fc.property(
          // 生成器：任意数据载荷（排除 undefined，因为 data 必须非 undefined）
          fc.anything().filter((v) => v !== undefined),
          (data) => {
            const response = { ok: true as const, data };

            // 核心属性：isApiResponse 应识别合法的成功响应
            expect(isApiResponse(response)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 3b：缺少 data 字段的对象不应通过 isApiResponse 检查',
    () => {
      fc.assert(
        fc.property(
          fc.anything(),
          (_payload) => {
            const noData = { ok: true };
            expect(isApiResponse(noData)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 3c：ok 不为 true 的对象不应通过 isApiResponse 检查',
    () => {
      fc.assert(
        fc.property(
          fc.anything().filter((v) => v !== undefined),
          (data) => {
            const wrongOk = { ok: false, data };
            expect(isApiResponse(wrongOk)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// 属性 4：API 错误响应格式统一性
// Feature: quantpulse-ui-redesign, Property 4: API 错误响应格式统一性
//
// 对任意错误响应对象，isApiErrorResponse 应返回 true，且包含 ok: false 和非空 error 字符串。
// ---------------------------------------------------------------------------

describe('API — 错误响应格式统一性', () => {
  // **Validates: Requirement 14.2**

  it(
    '属性 4：对任意合法的错误响应对象，isApiErrorResponse 应返回 true',
    () => {
      fc.assert(
        fc.property(
          // 生成器：非空错误消息字符串
          fc.string({ minLength: 1 }),
          (error) => {
            const response = { ok: false as const, error };

            // 核心属性：isApiErrorResponse 应识别合法的错误响应
            expect(isApiErrorResponse(response)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 4b：ok 不为 false 的对象不应通过 isApiErrorResponse 检查',
    () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          (error) => {
            const wrongOk = { ok: true, error };
            expect(isApiErrorResponse(wrongOk)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 4c：error 字段为非字符串类型时不应通过 isApiErrorResponse 检查',
    () => {
      fc.assert(
        fc.property(
          // 生成器：非字符串值（数字、布尔、对象、null 等）
          fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
          (nonStringError) => {
            const badError = { ok: false, error: nonStringError };
            expect(isApiErrorResponse(badError)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// 属性 5：K 线数据字段完整性
// Feature: quantpulse-ui-redesign, Property 5: K 线数据字段完整性
//
// 对任意合法的 CSV 行，parseKlineCsvLine 应返回包含全部6个字段的对象，
// 且所有数值字段均为有效数字（非 NaN、非 null）。
// ---------------------------------------------------------------------------

/**
 * 提取 server/api.mjs 中 parseKlineCsv 的单行解析逻辑为纯函数。
 * CSV 格式：date,open,high,low,close,?,volume（volume 在索引 6）
 * 来源：server/api.mjs — parseKlineCsv 内部 map 逻辑
 */
function parseKlineCsvLine(line: string): {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
} {
  const parts = line.split(',');
  return {
    date: parts[0],
    open: Number(parts[1]),
    high: Number(parts[2]),
    low: Number(parts[3]),
    close: Number(parts[4]),
    volume: Number(parts[6]),
  };
}

// fast-check 生成器：生成合法的 K 线 CSV 行
const klineCsvLineArb = fc
  .record({
    date: fc.stringMatching(/^\d{8}$/),
    open: fc.double({ min: 0.01, max: 9999.99, noNaN: true }),
    high: fc.double({ min: 0.01, max: 9999.99, noNaN: true }),
    low: fc.double({ min: 0.01, max: 9999.99, noNaN: true }),
    close: fc.double({ min: 0.01, max: 9999.99, noNaN: true }),
    extra: fc.double({ min: 0, max: 100, noNaN: true }), // 索引5，忽略字段
    volume: fc.double({ min: 0, max: 1e10, noNaN: true }),
  })
  .map(({ date, open, high, low, close, extra, volume }) =>
    `${date},${open},${high},${low},${close},${extra},${volume}`
  );

describe('K 线数据 — 字段完整性', () => {
  // **Validates: Requirements 14.5, 3.7**

  it(
    '属性 5：对任意合法 CSV 行，解析结果应包含全部6个字段且数值均为有效数字',
    () => {
      fc.assert(
        fc.property(
          klineCsvLineArb,
          (csvLine) => {
            const point = parseKlineCsvLine(csvLine);

            // 属性 5a：所有字段均存在（非 undefined）
            expect(point.date).toBeDefined();
            expect(point.open).toBeDefined();
            expect(point.high).toBeDefined();
            expect(point.low).toBeDefined();
            expect(point.close).toBeDefined();
            expect(point.volume).toBeDefined();

            // 属性 5b：date 为8位纯数字字符串
            expect(point.date).toMatch(/^\d{8}$/);

            // 属性 5c：所有数值字段均为有效数字（非 NaN、非 null）
            expect(Number.isNaN(point.open)).toBe(false);
            expect(Number.isNaN(point.high)).toBe(false);
            expect(Number.isNaN(point.low)).toBe(false);
            expect(Number.isNaN(point.close)).toBe(false);
            expect(Number.isNaN(point.volume)).toBe(false);

            // 属性 5d：数值字段类型为 number
            expect(typeof point.open).toBe('number');
            expect(typeof point.high).toBe('number');
            expect(typeof point.low).toBe('number');
            expect(typeof point.close).toBe('number');
            expect(typeof point.volume).toBe('number');
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 5b：解析结果中 volume 对应 CSV 第7列（索引6），而非第6列',
    () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 9999, noNaN: true }),
          fc.double({ min: 1, max: 9999, noNaN: true }),
          (col5Value, col6Value) => {
            // 构造一行 CSV，明确区分索引5和索引6的值
            const csvLine = `20240101,10,11,9,10.5,${col5Value},${col6Value}`;
            const point = parseKlineCsvLine(csvLine);

            // volume 应取索引6（col6Value），而非索引5（col5Value）
            expect(point.volume).toBeCloseTo(col6Value, 3);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// 属性 4：API 错误响应格式统一性（真实 HTTP 请求）
// Feature: quantpulse-ui-redesign, Property 4: API 错误响应格式统一性
//
// 对任意请求不存在资源的 API 端点，响应应返回 HTTP 404 状态码，
// 且响应体包含 ok: false 和非空的 error 字符串字段。
// ---------------------------------------------------------------------------

describe('属性 4：API 错误响应格式统一性（真实 HTTP 请求）', () => {
  // **Validates: Requirements 14.2**

  let serverOnline = false;

  beforeAll(async () => {
    serverOnline = await isServerOnline();
  });

  it(
    '属性 4：对任意不存在的 kline 股票代码，响应应为 HTTP 404 + { ok: false, error: string }',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 4] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      // 生成器：随机不存在的股票代码（使用 XXXXXX.XX 格式，但内容随机确保不存在）
      // 使用 ZZ 后缀确保不匹配任何真实交易所代码（.SH / .SZ）
      const nonExistentCodeArb = fc
        .tuple(
          fc.stringMatching(/^\d{6}$/),
          fc.constantFrom('ZZ', 'XX', 'QQ', 'WW')
        )
        .map(([digits, suffix]) => `${digits}.${suffix}`);

      await fc.assert(
        fc.asyncProperty(
          nonExistentCodeArb,
          async (code) => {
            const res = await fetch(`${BASE_URL}/api/market/kline/${code}`, {
              signal: AbortSignal.timeout(5000),
            });

            // 属性 4a：HTTP 状态码应为 404
            expect(res.status).toBe(404);

            const body = await res.json() as unknown;

            // 属性 4b：响应体应通过 isApiErrorResponse 检查（ok: false 且 error 为非空字符串）
            expect(isApiErrorResponse(body)).toBe(true);

            if (isApiErrorResponse(body)) {
              // 属性 4c：error 字段应为非空字符串
              expect(typeof body.error).toBe('string');
              expect(body.error.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    60000
  );

  it(
    '属性 4（扩展）：对任意不存在的 sentiment 日期，响应应为 HTTP 404 + { ok: false, error: string }',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 4 扩展] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      // 生成器：随机不存在的日期（使用遥远的未来年份，如 2099 年）
      const nonExistentDateArb = fc
        .tuple(
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 })
        )
        .map(([month, day]) => {
          const mm = String(month).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          return `20991${mm}${dd}`; // 2099 年，必然不存在于缓存
        });

      await fc.assert(
        fc.asyncProperty(
          nonExistentDateArb,
          async (date) => {
            const res = await fetch(`${BASE_URL}/api/sentiment/metrics?date=${date}`, {
              signal: AbortSignal.timeout(5000),
            });

            expect(res.status).toBe(404);

            const body = await res.json() as unknown;
            expect(isApiErrorResponse(body)).toBe(true);

            if (isApiErrorResponse(body)) {
              expect(typeof body.error).toBe('string');
              expect(body.error.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    60000
  );

  it(
    '属性 4（扩展）：对任意不存在的 ztpool 日期，响应应为 HTTP 404 + { ok: false, error: string }',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 4 扩展] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      // 生成器：随机不存在的日期（使用遥远的未来年份，如 2099 年）
      const nonExistentDateArb = fc
        .tuple(
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 })
        )
        .map(([month, day]) => {
          const mm = String(month).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          return `20991${mm}${dd}`; // 2099 年，必然不存在于缓存
        });

      await fc.assert(
        fc.asyncProperty(
          nonExistentDateArb,
          async (date) => {
            const res = await fetch(`${BASE_URL}/api/ztpool?date=${date}`, {
              signal: AbortSignal.timeout(5000),
            });

            expect(res.status).toBe(404);

            const body = await res.json() as unknown;
            expect(isApiErrorResponse(body)).toBe(true);

            if (isApiErrorResponse(body)) {
              expect(typeof body.error).toBe('string');
              expect(body.error.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    60000
  );

  it(
    '属性 4（扩展）：对任意不存在的 admin/kline 股票代码，响应应为 HTTP 404 + { ok: false, error: string }',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 4 扩展] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }

      // 生成器：随机不存在的股票代码（ZZ 后缀确保不存在）
      const nonExistentCodeArb = fc
        .tuple(
          fc.stringMatching(/^\d{6}$/),
          fc.constantFrom('ZZ', 'XX', 'QQ', 'WW')
        )
        .map(([digits, suffix]) => `${digits}.${suffix}`);

      await fc.assert(
        fc.asyncProperty(
          nonExistentCodeArb,
          async (code) => {
            const res = await fetch(`${BASE_URL}/api/admin/kline/${code}`, {
              signal: AbortSignal.timeout(5000),
            });

            expect(res.status).toBe(404);

            const body = await res.json() as unknown;
            expect(isApiErrorResponse(body)).toBe(true);

            if (isApiErrorResponse(body)) {
              expect(typeof body.error).toBe('string');
              expect(body.error.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    60000
  );
});

// ---------------------------------------------------------------------------
// 属性 5（真实文件）：K 线数据字段完整性 — 随机选取 cache/kline/ 中的文件
// Feature: quantpulse-ui-redesign, Property 5: K 线数据字段完整性
//
// 通过 /api/admin/kline/list 获取所有可用文件列表，随机选取后调用
// /api/admin/kline/:code 获取解析后的数据，验证每个数据点包含全部6个字段
// 且所有数值字段均为有效数字（非 NaN、非 null）。
// **Validates: Requirements 14.5, 3.7**
// ---------------------------------------------------------------------------

describe('属性 5（真实文件）：K 线数据字段完整性', () => {
  // **Validates: Requirements 14.5, 3.7**

  let serverOnline = false;
  let availableCodes: string[] = [];

  beforeAll(async () => {
    serverOnline = await isServerOnline();
    if (!serverOnline) return;

    try {
      const res = await fetch(`${BASE_URL}/api/admin/kline/list`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = await res.json() as unknown;
      if (isApiResponse(body) && Array.isArray(body.data)) {
        // Strip .csv suffix to get codes like "000300.SH"
        availableCodes = (body.data as string[])
          .filter((f: string) => f.endsWith('.csv'))
          .map((f: string) => f.replace(/\.csv$/, ''));
      }
    } catch {
      // server offline or error — tests will be skipped
    }
  });

  it(
    '属性 5（真实文件）：随机选取 cache/kline/ 中的文件，每个数据点应包含6个字段且数值均有效',
    async () => {
      if (!serverOnline) {
        console.warn('[属性 5] 服务器未运行（localhost:3001），跳过集成测试');
        return;
      }
      if (availableCodes.length === 0) {
        console.warn('[属性 5] 未获取到任何 kline 文件列表，跳过测试');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...availableCodes),
          async (code) => {
            const res = await fetch(`${BASE_URL}/api/admin/kline/${code}`, {
              signal: AbortSignal.timeout(5000),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as unknown;
            expect(isApiResponse(body)).toBe(true);

            if (!isApiResponse(body)) return;

            const points = body.data as Array<{
              date: string;
              open: number;
              high: number;
              low: number;
              close: number;
              volume: number;
            }>;

            // 属性 5a：返回数组应至少包含一个数据点
            expect(Array.isArray(points)).toBe(true);
            expect(points.length).toBeGreaterThan(0);

            for (const point of points) {
              // 属性 5b：date 字段存在且为8位纯数字（YYYYMMDD）
              expect(point.date).toBeDefined();
              expect(point.date).toMatch(/^\d{8}$/);

              // 属性 5c：所有数值字段均存在（非 undefined）
              expect(point.open).toBeDefined();
              expect(point.high).toBeDefined();
              expect(point.low).toBeDefined();
              expect(point.close).toBeDefined();
              expect(point.volume).toBeDefined();

              // 属性 5d：所有数值字段均为有效数字（非 NaN）
              expect(Number.isNaN(point.open)).toBe(false);
              expect(Number.isNaN(point.high)).toBe(false);
              expect(Number.isNaN(point.low)).toBe(false);
              expect(Number.isNaN(point.close)).toBe(false);
              expect(Number.isNaN(point.volume)).toBe(false);

              // 属性 5e：数值字段类型为 number
              expect(typeof point.open).toBe('number');
              expect(typeof point.high).toBe('number');
              expect(typeof point.low).toBe('number');
              expect(typeof point.close).toBe('number');
              expect(typeof point.volume).toBe('number');

              // 属性 5f：价格字段应为正数（open/high/low/close > 0）
              expect(point.open).toBeGreaterThan(0);
              expect(point.high).toBeGreaterThan(0);
              expect(point.low).toBeGreaterThan(0);
              expect(point.close).toBeGreaterThan(0);

              // 属性 5g：volume 应为非负数
              expect(point.volume).toBeGreaterThanOrEqual(0);

              // 属性 5h：high >= low（K 线基本约束）
              expect(point.high).toBeGreaterThanOrEqual(point.low);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    60000
  );
});
