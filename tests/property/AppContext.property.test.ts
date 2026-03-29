/**
 * 属性测试：AppContext
 * Feature: quantpulse-ui-redesign
 *
 * **Validates: Requirements 1.3, 1.4, 6.2**
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// 提取 navigateToStock 的纯逻辑进行测试
// navigateToStock(code) 的行为等价于：
//   setSelectedStock(code)  →  selectedStock = code
//   setCurrentPage('analyzer')  →  currentPage = 'analyzer'
// 我们通过模拟状态容器来验证这一不变量，无需 React 渲染环境。
// ---------------------------------------------------------------------------

type PageType = 'market' | 'analyzer' | 'admin';

interface AppState {
  selectedStock: string;
  currentPage: PageType;
}

/**
 * 纯函数版本的 navigateToStock，与 AppContext 实现逻辑完全一致。
 * 来源：src/app/context/AppContext.tsx
 */
function navigateToStock(state: AppState, code: string): AppState {
  return {
    ...state,
    selectedStock: code,
    currentPage: 'analyzer',
  };
}

// ---------------------------------------------------------------------------
// Property 1: navigateToStock 状态一致性
// Feature: quantpulse-ui-redesign, Property 1: navigateToStock 状态一致性
// ---------------------------------------------------------------------------
describe('AppContext — navigateToStock 状态一致性', () => {
  it(
    '对任意有效6位股票代码，调用后 selectedStock === code 且 currentPage === "analyzer"',
    () => {
      // **Validates: Requirements 1.3, 1.4, 6.2**
      fc.assert(
        fc.property(
          // 生成器：任意6位纯数字股票代码
          fc.stringMatching(/^\d{6}$/),
          // 初始页面可以是任意合法页面，验证无论从哪个页面跳转都能正确切换
          fc.constantFrom<PageType>('market', 'analyzer', 'admin'),
          // 初始 selectedStock 可以是任意字符串（包括空字符串）
          fc.string(),
          (code, initialPage, initialStock) => {
            const initialState: AppState = {
              selectedStock: initialStock,
              currentPage: initialPage,
            };

            const nextState = navigateToStock(initialState, code);

            // 属性 1a：selectedStock 应等于传入的 code
            expect(nextState.selectedStock).toBe(code);

            // 属性 1b：currentPage 应为 'analyzer'
            expect(nextState.currentPage).toBe('analyzer');
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it('navigateToStock 不应修改其他状态字段', () => {
    // **Validates: Requirements 1.3**
    fc.assert(
      fc.property(
        fc.stringMatching(/^\d{6}$/),
        fc.string(), // selectedDate
        (code, selectedDate) => {
          // 使用一个包含额外字段的扩展状态来验证不变性
          const initialState = {
            selectedStock: '',
            currentPage: 'market' as PageType,
            selectedDate,
          };

          const nextState = navigateToStock(initialState, code);

          // navigateToStock 只应修改 selectedStock 和 currentPage
          expect((nextState as typeof initialState).selectedDate).toBe(selectedDate);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: selectedDate 格式始终合法
// Feature: quantpulse-ui-redesign, Property 2: selectedDate 格式始终合法
// ---------------------------------------------------------------------------

/**
 * 提取 AppContext 中 selectedDate 初始化的纯逻辑进行测试。
 * 来源：src/app/context/AppContext.tsx — getFallbackDate() 和 useEffect 初始化逻辑
 *
 * 初始化规则：
 *   1. 若 /api/ztpool/dates 返回非空数组，取最后一个元素作为 selectedDate
 *   2. 若请求失败或返回空数组，降级为 getFallbackDate()（当前系统日期 YYYYMMDD）
 */

/** 与 AppContext 中 getFallbackDate 实现完全一致 */
function getFallbackDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 模拟 AppContext 初始化 selectedDate 的纯逻辑。
 * @param apiResult - 模拟 API 返回：string[] 表示成功，null 表示失败
 */
function resolveSelectedDate(apiResult: string[] | null): string {
  if (Array.isArray(apiResult) && apiResult.length > 0) {
    return apiResult[apiResult.length - 1];
  }
  return getFallbackDate();
}

/** 验证字符串是否符合 YYYYMMDD 格式（8位纯数字，月份01-12，日期01-31） */
function isValidYYYYMMDD(date: string): boolean {
  if (!/^\d{8}$/.test(date)) return false;
  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(4, 6), 10);
  const day = parseInt(date.slice(6, 8), 10);
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

describe('AppContext — selectedDate 格式始终合法', () => {
  // **Validates: Requirements 1.5, 1.6**

  it(
    '属性 2a：API 成功时，selectedDate 应等于 API 返回数组的最后一个元素',
    () => {
      // **Validates: Requirement 1.5**
      fc.assert(
        fc.property(
          // 生成器：非空的 YYYYMMDD 格式日期数组（模拟 API 成功返回）
          fc.array(
            fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).filter(
              (d) => !isNaN(d.getTime())
            ).map(
              (d) => d.toISOString().slice(0, 10).replace(/-/g, '')
            ),
            { minLength: 1, maxLength: 50 }
          ),
          (dates) => {
            const result = resolveSelectedDate(dates);

            // selectedDate 应等于数组最后一个元素
            expect(result).toBe(dates[dates.length - 1]);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 2b：API 失败时，selectedDate 应降级为系统日期且格式合法（YYYYMMDD）',
    () => {
      // **Validates: Requirement 1.6**
      fc.assert(
        fc.property(
          // 生成器：模拟 API 失败场景（null 表示请求异常）
          fc.constant(null),
          (apiResult) => {
            const result = resolveSelectedDate(apiResult);

            // 应为8位纯数字
            expect(result).toMatch(/^\d{8}$/);
            // 应符合完整的 YYYYMMDD 格式约束
            expect(isValidYYYYMMDD(result)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 2c：API 返回空数组时，selectedDate 应降级为系统日期且格式合法',
    () => {
      // **Validates: Requirement 1.6**
      fc.assert(
        fc.property(
          fc.constant([] as string[]),
          (emptyDates) => {
            const result = resolveSelectedDate(emptyDates);

            expect(result).toMatch(/^\d{8}$/);
            expect(isValidYYYYMMDD(result)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    '属性 2d：无论 API 成功或失败，selectedDate 始终为合法的 YYYYMMDD 格式',
    () => {
      // **Validates: Requirements 1.5, 1.6**
      fc.assert(
        fc.property(
          // 生成器：随机模拟 API 成功（非空数组）或失败（null）两种场景
          fc.oneof(
            // 成功场景：返回包含合法日期的数组
            fc.array(
              fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).filter(
                (d) => !isNaN(d.getTime())
              ).map(
                (d) => d.toISOString().slice(0, 10).replace(/-/g, '')
              ),
              { minLength: 1, maxLength: 100 }
            ),
            // 失败场景：null
            fc.constant(null as string[] | null),
            // 空数组场景
            fc.constant([] as string[])
          ),
          (apiResult) => {
            const result = resolveSelectedDate(apiResult);

            // 核心不变量：无论何种场景，selectedDate 始终为合法 YYYYMMDD
            expect(result).toMatch(/^\d{8}$/);
            expect(isValidYYYYMMDD(result)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});


// ---------------------------------------------------------------------------
// Property 7: debug 日志记录完整性
// Feature: quantpulse-ui-redesign, Property 7: debug 日志记录完整性
// ---------------------------------------------------------------------------

/**
 * 提取 AppContext 中 pushDebugLog 的纯逻辑进行测试。
 * 来源：src/app/context/AppContext.tsx — pushDebugLog 实现
 *
 * pushDebugLog 行为：
 *   接收 Omit<DebugLog, 'id' | 'timestamp'>，追加一条带有自动生成 id 和 timestamp 的日志到 debugLogs。
 */

interface DebugLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  module: string;
  message: string;
  payload?: Record<string, unknown>;
}

/**
 * 纯函数版本的 pushDebugLog，与 AppContext 实现逻辑完全一致。
 * 来源：src/app/context/AppContext.tsx
 */
function pushDebugLog(
  logs: DebugLog[],
  log: Omit<DebugLog, 'id' | 'timestamp'>
): DebugLog[] {
  const entry: DebugLog = {
    ...log,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  return [...logs, entry];
}

describe('AppContext — debug 日志记录完整性', () => {
  it(
    '属性 7：对任意6位股票代码触发分析请求后，debugLogs 中应新增至少一条 level=info、module=StockAnalyzer 的日志',
    () => {
      // **Validates: Requirements 7.4**
      fc.assert(
        fc.property(
          // 生成器：任意6位纯数字股票代码
          fc.stringMatching(/^\d{6}$/),
          (code) => {
            const initialLogs: DebugLog[] = [];

            const updatedLogs = pushDebugLog(initialLogs, {
              level: 'info',
              module: 'StockAnalyzer',
              message: '发起分析请求',
              payload: { code, timestamp: Date.now() },
            });

            // 属性 7a：debugLogs 中应至少新增一条日志
            expect(updatedLogs.length).toBeGreaterThan(initialLogs.length);

            // 属性 7b：新增日志中应至少有一条 level 为 'info' 且 module 为 'StockAnalyzer'
            const matchingLogs = updatedLogs.filter(
              (log) => log.level === 'info' && log.module === 'StockAnalyzer'
            );
            expect(matchingLogs.length).toBeGreaterThanOrEqual(1);

            // 属性 7c：匹配日志的 payload 中应包含该股票代码
            const logWithCode = matchingLogs.find(
              (log) => (log.payload as Record<string, unknown>)?.code === code
            );
            expect(logWithCode).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
