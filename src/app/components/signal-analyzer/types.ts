export type StockItem = {
  code: string;
  name: string;
  industry: string;
  successRate: number;
};

export type KLinePoint = {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  k: number;
  d: number;
  j: number;
  dif: number;
  dea: number;
  macd: number;
  rsi: number;
  rsi2?: number;
  rsi6?: number;
  rsi12?: number;
  rsi24?: number;
  ma5: number;
  ma10: number;
  ma20: number;
  ma60?: number;
  bollMid?: number;
  bollUpper?: number;
  bollLower?: number;
  adx?: number;
  wr14?: number;
  roc12?: number;
  obv?: number;
  volumeRatio?: number;
};

export type TradeRecord = {
  id: string;
  buyDate: string;
  buyPrice: number;
  sellDate: string;
  sellPrice: number;
  returnPct: number;
  returnAmount: number;
  result: 'success' | 'failure';
};

export type StrategyOption = {
  id: string;
  label: string;
  kind: 'composite' | 'base';
  score: number;
};

export type SignalMarker = {
  date: string;
  type: 'buy' | 'sell';
  price: number;
  label: 'B' | 'S';
  strategyId?: string;
  count?: number;
};

export type ActiveStrategyContext = {
  strategyId: string;
  strategyName: string;
  currentSignal: 'buy' | 'sell' | 'hold';
  signalStrength: number;
  kind: 'composite' | 'base';
};


export type OptimizerLeaderboardItem = {
  rank: number;
  config: {
    minZoneCapture: number;
    zoneForward: number;
    zoneBackward: number;
    envFilter: string;
  };
  result: {
    stopLossRate: number;
    avgReturn: number;
    totalTrades: number;
    winRate: number;
    maxDrawdown: number;
    skippedByEnvironment?: number;
    buyCount?: number;
    trades?: Array<{
      buyDate: string;
      sellDate: string;
      buyPrice: number;
      sellPrice: number;
      return: number;
      holdingDays: number;
      confidence: number;
      exitReason: string;
    }>;
  };
};

export type OptimizerSummary = {
  stockCode: string;
  stockName?: string;
  stockType?: string;
  regime?: string;
  regimeConfidence?: number;
  regimeHistory?: Array<{ date: string; regime: string }>;
  bestConfig: OptimizerLeaderboardItem['config'] | null;
  bestResult: (OptimizerLeaderboardItem['result'] & { sharpe?: number }) | null;
  bestModel?: {
    featureSet: string;
    model: string;
    precision: number;
    recall: number;
    f1: number;
  };
  plateau?: {
    passed: boolean;
    ratio: number;
    neighborCount: number;
  };
  modelStore?: {
    action: string;
    reason: string;
    version: number;
    fallbackToVersion?: number;
  };
  usedFallback?: boolean;
  leaderboard: OptimizerLeaderboardItem[];
  stats: {
    totalCombinations: number;
    validCombinations: number;
    scanDurationMs: number;
  };
};

export type LiveStockResponse = {
  stock: StockItem;
  candles: KLinePoint[];
  trades: TradeRecord[];
  strategyOptions?: StrategyOption[];
  signalMarkers?: SignalMarker[];
  activeStrategy?: ActiveStrategyContext;
  features?: StrategyFeatures;
  regime?: RegimeDecision;
  strategies?: CandidateStrategyResult[];
  bestStrategy?: AdaptiveStrategyDecision;
};

export type ChartTab = 'price' | 'momentum' | 'risk';
export type PriceViewPreset = '20' | '60' | '120' | 'all';

export type MetricCard = {
  label: string;
  value: string;
  sub: string;
};

export type RiskLevel = {
  label: string;
  accent: string;
  badge: string;
};

export type StrategyFeatures = {
  trend: {
    direction: string;
    strength: string;
    adx: number;
    maAlignment: string;
    bollingerPosition: string;
    bollingerWidth: number;
    maSlope20: number;
    maSlope60: number;
  };
  momentum: {
    macdSignal: string;
    macdHistogram: number;
    rsiSignal: string;
    rsi6: number;
    rsi12: number;
    rsi24: number;
    kdjSignal: string;
    k: number;
    d: number;
    j: number;
    wrSignal: string;
    wr14: number;
    roc12: number;
  };
  volume: {
    priceVolumePattern: string;
    obvTrend: string;
    volumeRatio: number;
    turnoverSpike: boolean;
  };
  volatility: number;
  autocorr5: number;
  autocorr20: number;
  liquidityScore: number;
};

export type RegimeDecision = {
  type: 'trend' | 'range' | 'speculative';
  confidence: number;
  scores: {
    trend: number;
    range: number;
    speculative: number;
  };
  reasons: string[];
};

export type CandidateStrategyResult = {
  strategyId: string;
  strategyName: string;
  category?: string;
  weightBucket?: string;
  regimeFit?: string[];
  params: Record<string, number | string>;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  annualReturn: number;
  trades: number;
  score: number;
};

export type AdaptiveStrategyDecision = {
  strategyId: 'adaptive_composite_e';
  strategyName: string;
  regime: 'trend' | 'range' | 'speculative';
  confidence: number;
  weights: {
    maCross: number;
    macdRsi: number;
    bollVolume: number;
    multiFactor: number;
  };
  currentSignal: 'buy' | 'sell' | 'hold';
  signalStrength: number;
  riskBias: 'aggressive' | 'balanced' | 'defensive';
  reasons: string[];
  benchmark: {
    bestBaseStrategyId: string;
    bestBaseStrategyScore: number;
  };
  optimized?: OptimizedStrategyResult;
};

export type OptimizedStrategyResult = {
  strategyId: 'adaptive_composite_e';
  strategyName: string;
  isOptimized?: boolean;
  baseModel: string;
  baseModelName: string;
  params: Record<string, number | string>;
  metrics: {
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    annualReturn: number;
    trades: number;
    score: number;
  };
  improvement: {
    winRateDelta: number;
    annualReturnDelta: number;
    maxDrawdownDelta: number;
    sharpeDelta: number;
  };
};

const zh = {
  guizhouMoutai: '贵州茅台',
  wuliangye: '五粮液',
  pingAn: '中国平安',
  cmb: '招商银行',
  pab: '平安银行',
  longi: '隆基绿能',
  catl: '宁德时代',
  liquor: '白酒',
  insurance: '保险',
  bank: '银行',
  pv: '光伏',
  newEnergy: '新能源',
  price: '价格结构',
  momentum: '动量指标',
  risk: '风险画像',
  all: '全部',
  recent3m: '近3个月',
  recent6m: '近6个月',
  recent1y: '近1年',
  recent3y: '近3年',
  lowRisk: '低风险',
  midRisk: '中风险',
  highVol: '高波动',
  trendReason1: 'ADX 27.4，高于趋势阈值',
  trendReason2: '均线排列为 bullish',
  trendReason3: '量价关系为 confirm_up',
  qualityStack: '高质量信号叠加',
  macdRsi: 'MACD + RSI 节奏确认',
  maCross: 'MA20/60 双均线交叉',
  compositeE: '优化模型 E2',
  errorFetch: '实时数据加载失败，请检查代理服务和网络连接。',
  errorProxy: '无法连接本地代理 http://localhost:3030。请先启动 npm run dev:api。',
  errorToken: '代理已启动，但未读取到 TUSHARE_TOKEN。请检查项目根目录 .env.local。',
  errorCode: '未找到该股票代码对应的上市股票，请确认输入的是 6 位 A 股代码。',
  errorOutdatedProxy: '本地代理还在运行旧版本，请重启 npm run dev:api 后再试。',
};

export const stockDatabase: StockItem[] = [
  { code: '600519', name: zh.guizhouMoutai, industry: zh.liquor, successRate: 78.5 },
  { code: '000858', name: zh.wuliangye, industry: zh.liquor, successRate: 72.3 },
  { code: '601318', name: zh.pingAn, industry: zh.insurance, successRate: 68.9 },
  { code: '600036', name: zh.cmb, industry: zh.bank, successRate: 71.2 },
  { code: '000001', name: zh.pab, industry: zh.bank, successRate: 65.4 },
  { code: '601012', name: zh.longi, industry: zh.pv, successRate: 82.1 },
  { code: '300750', name: zh.catl, industry: zh.newEnergy, successRate: 85.7 },
];

export const chartTabs: Array<{ id: ChartTab; label: string }> = [
  { id: 'price', label: zh.price },
  { id: 'momentum', label: zh.momentum },
  { id: 'risk', label: zh.risk },
];

export const priceViewOptions: Array<{ id: PriceViewPreset; label: string }> = [
  { id: '20', label: '20D' },
  { id: '60', label: '60D' },
  { id: '120', label: '120D' },
  { id: 'all', label: zh.all },
];

export const fallbackTrades: TradeRecord[] = [
  { id: 'fallback-1', buyDate: '2026-02-27', buyPrice: 1588.9, sellDate: '2026-03-11', sellPrice: 1632.4, returnPct: 2.74, returnAmount: 27385.77, result: 'success' },
  { id: 'fallback-2', buyDate: '2026-03-18', buyPrice: 1685.2, sellDate: '2026-03-22', sellPrice: 1633.1, returnPct: -3.09, returnAmount: -30915.03, result: 'failure' },
];

export const fallbackSignalMarkers: SignalMarker[] = [
  { date: '2026-02-27', type: 'buy', price: 1588.9, label: 'B', strategyId: 'adaptive_composite_e' },
  { date: '2026-03-11', type: 'sell', price: 1632.4, label: 'S', strategyId: 'adaptive_composite_e' },
  { date: '2026-03-18', type: 'buy', price: 1685.2, label: 'B', strategyId: 'adaptive_composite_e' },
  { date: '2026-03-22', type: 'sell', price: 1633.1, label: 'S', strategyId: 'adaptive_composite_e' },
];

export const fallbackFeatures: StrategyFeatures = {
  trend: { direction: 'up', strength: 'medium', adx: 27.4, maAlignment: 'bullish', bollingerPosition: 'upper', bollingerWidth: 8.6, maSlope20: 1.24, maSlope60: 0.82 },
  momentum: { macdSignal: 'golden_cross', macdHistogram: 1.86, rsiSignal: 'neutral', rsi6: 63.2, rsi12: 58.4, rsi24: 54.1, kdjSignal: 'golden_cross', k: 61.2, d: 56.3, j: 71.0, wrSignal: 'neutral', wr14: -41.6, roc12: 4.8 },
  volume: { priceVolumePattern: 'confirm_up', obvTrend: 'up', volumeRatio: 1.34, turnoverSpike: false },
  volatility: 0.228,
  autocorr5: 0.112,
  autocorr20: 0.236,
  liquidityScore: 0.71,
};

export const fallbackRegime: RegimeDecision = {
  type: 'trend',
  confidence: 0.78,
  scores: { trend: 13, range: 6, speculative: 3 },
  reasons: [zh.trendReason1, zh.trendReason2, zh.trendReason3],
};

export const fallbackStrategies: CandidateStrategyResult[] = [
  { strategyId: 'adaptive_composite_e_base', strategyName: zh.qualityStack, category: 'multi_factor', weightBucket: 'multiFactor', regimeFit: ['trend', 'range'], params: { mode: 'qualityStack', entryScore: 5, exitScore: 2 }, sharpe: 1.68, maxDrawdown: 9.2, winRate: 62.8, profitFactor: 1.96, annualReturn: 24.6, trades: 12, score: 36.8 },
  { strategyId: 'macd_rsi_confirm', strategyName: zh.macdRsi, category: 'momentum', weightBucket: 'macdRsi', regimeFit: ['trend'], params: { rsiEntryMax: 65, rsiExitMin: 75 }, sharpe: 1.42, maxDrawdown: 10.1, winRate: 60.4, profitFactor: 1.73, annualReturn: 20.8, trades: 10, score: 33.5 },
  { strategyId: 'ma20_60_cross', strategyName: zh.maCross, category: 'trend', weightBucket: 'maCross', regimeFit: ['trend'], params: { fast: 20, slow: 60 }, sharpe: 1.28, maxDrawdown: 11.4, winRate: 58.2, profitFactor: 1.62, annualReturn: 18.7, trades: 9, score: 30.9 },
];

export const fallbackBestStrategy: AdaptiveStrategyDecision = {
  strategyId: 'adaptive_composite_e',
  strategyName: 'Adaptive Composite Strategy',
  regime: 'trend',
  confidence: 0.8,
  weights: { maCross: 0.29, macdRsi: 0.27, bollVolume: 0.16, multiFactor: 0.28 },
  currentSignal: 'buy',
  signalStrength: 0.66,
  riskBias: 'aggressive',
  reasons: ['当前股票类型为 trend，分类置信度 0.78', '当前 ADX 偏强，提升趋势与动量家族权重', '组合信号为 buy，当前仍可跟踪'],
  benchmark: { bestBaseStrategyId: 'macd_rsi_confirm', bestBaseStrategyScore: 33.5 },
};

export const fallbackStrategyOptions: StrategyOption[] = [
  { id: 'adaptive_composite_e', label: '优化模型 E2 (Recommended)', kind: 'composite', score: 80 },
  { id: 'adaptive_composite_e_base', label: zh.qualityStack, kind: 'base', score: 36.8 },
  { id: 'macd_rsi_confirm', label: zh.macdRsi, kind: 'base', score: 33.5 },
  { id: 'ma20_60_cross', label: zh.maCross, kind: 'base', score: 30.9 },
];

export const fallbackActiveStrategy: ActiveStrategyContext = {
  strategyId: 'adaptive_composite_e',
  strategyName: zh.compositeE,
  currentSignal: 'buy',
  signalStrength: 0.66,
  kind: 'composite',
};

export const periodToQuery: Record<string, string> = {
  [zh.recent3m]: '3m',
  [zh.recent6m]: '6m',
  [zh.recent1y]: '1y',
  [zh.recent3y]: '3y',
};

export const generateKLineData = (stockCode: string): KLinePoint[] => {
  const basePrice = stockCode === '600519' ? 1680 : stockCode === '300750' ? 340 : stockCode === '000858' ? 145 : 120;
  const data: KLinePoint[] = [];
  let prevClose = basePrice;

  for (let index = 0; index < 120; index += 1) {
    const change = (Math.random() - 0.48) * basePrice * 0.02;
    const open = prevClose;
    const close = open + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.012);
    const low = Math.min(open, close) * (1 - Math.random() * 0.012);
    const volume = Math.floor(Math.random() * 500000 + 120000);
    const k = 50 + Math.sin(index * 0.25) * 24 + Math.random() * 8;
    const d = 50 + Math.sin(index * 0.25 - 0.2) * 22 + Math.random() * 7;
    const j = 3 * k - 2 * d;
    const dif = Math.sin(index * 0.18) * 4 + Math.random() * 1.8;
    const dea = Math.sin(index * 0.18 - 0.25) * 3.5 + Math.random() * 1.2;
    const macd = (dif - dea) * 2;
    const rsi = 50 + Math.sin(index * 0.22) * 20 + Math.random() * 9;

    data.push({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      open: Number(open.toFixed(2)),
      close: Number(close.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      volume,
      k: Number(k.toFixed(2)),
      d: Number(d.toFixed(2)),
      j: Number(j.toFixed(2)),
      dif: Number(dif.toFixed(2)),
      dea: Number(dea.toFixed(2)),
      macd: Number(macd.toFixed(2)),
      rsi: Number(rsi.toFixed(2)),
      ma5: Number((close * (0.985 + Math.random() * 0.03)).toFixed(2)),
      ma10: Number((close * (0.98 + Math.random() * 0.04)).toFixed(2)),
      ma20: Number((close * (0.97 + Math.random() * 0.06)).toFixed(2)),
    });

    prevClose = close;
  }

  return data;
};

export const getRiskLevel = (successRate: number): RiskLevel => {
  if (successRate >= 80) {
    return { label: zh.lowRisk, accent: 'text-[#00ff88]', badge: 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' };
  }

  if (successRate >= 70) {
    return { label: zh.midRisk, accent: 'text-[#ffaa00]', badge: 'border-[#ffaa00]/30 bg-[#ffaa00]/10 text-[#ffaa00]' };
  }

  return { label: zh.highVol, accent: 'text-[#ff3366]', badge: 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]' };
};

export const toFetchErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) {
    return zh.errorFetch;
  }

  const message = error.message || '';
  if (message === 'Failed to fetch' || message.includes('fetch')) {
    return zh.errorProxy;
  }

  if (message.includes('Missing TUSHARE_TOKEN')) {
    return zh.errorToken;
  }

  if (message.includes('Tushare upstream error')) {
    return `Tushare 上游接口请求失败: ${message}`;
  }

  if (message.includes('Tushare returned a non-zero code') || message.includes('Tushare 代理返回异常')) {
    return `Tushare 返回异常: ${message}`;
  }

  if (message.includes('No listed stock found')) {
    return zh.errorCode;
  }

  if (message.includes('Outdated proxy response')) {
    return zh.errorOutdatedProxy;
  }

  return message;
};
