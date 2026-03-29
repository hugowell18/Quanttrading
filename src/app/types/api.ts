// 指数/个股 K 线数据点（来自 /api/market/kline/:code）
export interface IndexKLinePoint {
  date: string;    // YYYYMMDD 格式
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 情绪指标数据（来自 /api/sentiment/metrics?date=）
export interface SentimentMetrics {
  date: string;              // YYYYMMDD
  ztCount: number;           // 涨停家数
  yiziCount: number;         // 一字板数量
  nonYiziCount: number;      // 非一字板数量
  zbCount: number;           // 炸板数量
  dtCount: number;           // 跌停数量
  maxContinuousDays: number; // 连板高度（最高连板天数）
  zbRate: number;            // 炸板率（0-1）
  ztDtRatio: number;         // 涨跌停比
  sealRate: number;          // 封板率（0-1）
  prevZtPremium: number;     // 昨日涨停溢价（%）
  premiumCoverage?: number;  // 溢价覆盖率
}

// 情绪状态枚举
export type EmotionState = '冰点' | '启动' | '主升' | '高潮' | '退潮';

// 情绪状态历史条目（来自 /api/sentiment/state-history）
export interface EmotionStateEntry {
  date: string;              // YYYYMMDD
  state: EmotionState;
  positionLimit: number;     // 建议仓位上限（0-1）
  changed: boolean;          // 是否发生状态切换
  previousState: EmotionState | null;
  heatScore: number;         // 热度分（0-100）
  rawToday: EmotionState;
  rawYesterday: EmotionState | null;
  ztCount: number;
  ztDtRatio: number | null;
  zbRate: number | null;
  maxContinuousDays: number;
  prevZtPremium: number | null;
}

// 涨停池单条记录（来自 /api/ztpool?date=）
export interface ZtPoolEntry {
  code: string;              // 股票代码
  name: string;              // 股票名称
  pct_chg: number;           // 涨跌幅（%）
  price: number;             // 现价
  amount: number;            // 成交额（万元）
  seal_amount: number;       // 封单金额
  first_seal_time: string;   // 首次封板时间
  seal_count: number;        // 封板次数
  failed_seals: number;      // 炸板次数
  continuous_days: number;   // 连板天数
  concepts: string;          // 概念板块
}

// 涨停池完整响应
export interface ZtPoolResponse {
  ok: boolean;
  date: string;
  fetchTime: string;
  ztpool: { rows: ZtPoolEntry[]; count: number; source: string };
  zbgcpool: { rows: ZtPoolEntry[]; count: number; source: string };
  dtpool: { rows: ZtPoolEntry[]; count: number; source: string };
}

// 批量回测汇总条目（来自 /api/batch/summary）
export interface BatchSummaryItem {
  stockCode: string;
  stockName?: string;
  strictPass: boolean;
  avgReturn: number;
  winRate: number;
  currentSignal?: 'buy' | 'sell' | 'hold';
  regime?: string;
}

// 统一 API 响应包装
export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
}

// 类型守卫函数
export function isApiResponse<T>(val: unknown): val is ApiResponse<T> {
  return (
    typeof val === 'object' &&
    val !== null &&
    (val as Record<string, unknown>).ok === true &&
    (val as Record<string, unknown>).data !== undefined
  );
}

export function isApiErrorResponse(val: unknown): val is ApiErrorResponse {
  return (
    typeof val === 'object' &&
    val !== null &&
    (val as Record<string, unknown>).ok === false &&
    typeof (val as Record<string, unknown>).error === 'string'
  );
}

// 页面类型
export type PageType = 'market' | 'analyzer' | 'admin';

// Debug 日志条目
export interface DebugLog {
  id: string;           // 唯一 ID（时间戳 + 随机数）
  timestamp: number;    // Unix 毫秒时间戳
  level: 'info' | 'warn' | 'error';
  module: string;       // 来源模块名，如 'StockAnalyzer'
  message: string;
  payload?: unknown;    // 可选的结构化数据
}

// Context 值接口
export interface AppContextValue {
  // 状态
  selectedDate: string;        // YYYYMMDD 格式
  selectedStock: string;       // 6位股票代码，如 '600519'
  debugLogs: DebugLog[];
  currentPage: PageType;

  // 更新函数
  setSelectedDate: (date: string) => void;
  setSelectedStock: (code: string) => void;
  setCurrentPage: (page: PageType) => void;
  pushDebugLog: (log: Omit<DebugLog, 'id' | 'timestamp'>) => void;
  clearDebugLogs: () => void;

  // 联动导航
  navigateToStock: (code: string) => void;
}
