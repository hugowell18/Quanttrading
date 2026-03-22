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
  guizhouMoutai: '\u8d35\u5dde\u8305\u53f0',
  wuliangye: '\u4e94\u7cae\u6db2',
  pingAn: '\u4e2d\u56fd\u5e73\u5b89',
  cmb: '\u62db\u5546\u94f6\u884c',
  pab: '\u5e73\u5b89\u94f6\u884c',
  longi: '\u9686\u57fa\u7eff\u80fd',
  catl: '\u5b81\u5fb7\u65f6\u4ee3',
  liquor: '\u767d\u9152',
  insurance: '\u4fdd\u9669',
  bank: '\u94f6\u884c',
  pv: '\u5149\u4f0f',
  newEnergy: '\u65b0\u80fd\u6e90',
  price: '\u4ef7\u683c\u7ed3\u6784',
  momentum: '\u52a8\u91cf\u6307\u6807',
  risk: '\u98ce\u9669\u753b\u50cf',
  all: '\u5168\u90e8',
  recent3m: '\u8fd13\u4e2a\u6708',
  recent6m: '\u8fd16\u4e2a\u6708',
  recent1y: '\u8fd11\u5e74',
  recent3y: '\u8fd13\u5e74',
  lowRisk: '\u4f4e\u98ce\u9669',
  midRisk: '\u4e2d\u98ce\u9669',
  highVol: '\u9ad8\u6ce2\u52a8',
  trendReason1: 'ADX 27.4\uff0c\u9ad8\u4e8e\u8d8b\u52bf\u9608\u503c',
  trendReason2: '\u5747\u7ebf\u6392\u5217\u4e3a bullish',
  trendReason3: '\u91cf\u4ef7\u5173\u7cfb\u4e3a confirm_up',
  qualityStack: '\u9ad8\u8d28\u91cf\u4fe1\u53f7\u53e0\u52a0',
  macdRsi: 'MACD + RSI \u8282\u594f\u786e\u8ba4',
  maCross: 'MA20/60 \u53cc\u5747\u7ebf\u4ea4\u53c9',
  compositeE: '\u4f18\u5316\u6a21\u578b E2',
  errorFetch: '\u5b9e\u65f6\u6570\u636e\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u4ee3\u7406\u670d\u52a1\u548c\u7f51\u7edc\u8fde\u63a5\u3002',
  errorProxy: '\u65e0\u6cd5\u8fde\u63a5\u672c\u5730\u4ee3\u7406 http://localhost:3030\u3002\u8bf7\u5148\u542f\u52a8 npm run dev:api\u3002',
  errorToken: '\u4ee3\u7406\u5df2\u542f\u52a8\uff0c\u4f46\u672a\u8bfb\u53d6\u5230 TUSHARE_TOKEN\u3002\u8bf7\u68c0\u67e5\u9879\u76ee\u6839\u76ee\u5f55 .env.local\u3002',
  errorCode: '\u672a\u627e\u5230\u8be5\u80a1\u7968\u4ee3\u7801\u5bf9\u5e94\u7684\u4e0a\u5e02\u80a1\u7968\uff0c\u8bf7\u786e\u8ba4\u8f93\u5165\u7684\u662f 6 \u4f4d A \u80a1\u4ee3\u7801\u3002',
  errorOutdatedProxy: '\u672c\u5730\u4ee3\u7406\u8fd8\u5728\u8fd0\u884c\u65e7\u7248\u672c\uff0c\u8bf7\u91cd\u542f npm run dev:api \u540e\u518d\u8bd5\u3002',
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
  reasons: ['\u5f53\u524d\u80a1\u7968\u7c7b\u578b\u4e3a trend\uff0c\u5206\u7c7b\u7f6e\u4fe1\u5ea6 0.78', '\u5f53\u524d ADX \u504f\u5f3a\uff0c\u63d0\u5347\u8d8b\u52bf\u4e0e\u52a8\u91cf\u5bb6\u65cf\u6743\u91cd', '\u7ec4\u5408\u4fe1\u53f7\u4e3a buy\uff0c\u5f53\u524d\u4ecd\u53ef\u8ddf\u8e2a'],
  benchmark: { bestBaseStrategyId: 'macd_rsi_confirm', bestBaseStrategyScore: 33.5 },
};

export const fallbackStrategyOptions: StrategyOption[] = [
  { id: 'adaptive_composite_e', label: '\u4f18\u5316\u6a21\u578b E2 (Recommended)', kind: 'composite', score: 80 },
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
    return `Tushare \u4e0a\u6e38\u63a5\u53e3\u8bf7\u6c42\u5931\u8d25: ${message}`;
  }

  if (message.includes('Tushare returned a non-zero code') || message.includes('Tushare \u4ee3\u7406\u8fd4\u56de\u5f02\u5e38')) {
    return `Tushare \u8fd4\u56de\u5f02\u5e38: ${message}`;
  }

  if (message.includes('No listed stock found')) {
    return zh.errorCode;
  }

  if (message.includes('Outdated proxy response')) {
    return zh.errorOutdatedProxy;
  }

  return message;
};
