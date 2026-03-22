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
  ma5: number;
  ma10: number;
  ma20: number;
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

export type LiveStockResponse = {
  stock: StockItem;
  candles: KLinePoint[];
  trades: TradeRecord[];
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

export const stockDatabase: StockItem[] = [
  { code: '600519', name: '贵州茅台', industry: '白酒', successRate: 78.5 },
  { code: '000858', name: '五粮液', industry: '白酒', successRate: 72.3 },
  { code: '601318', name: '中国平安', industry: '保险', successRate: 68.9 },
  { code: '600036', name: '招商银行', industry: '银行', successRate: 71.2 },
  { code: '000001', name: '平安银行', industry: '银行', successRate: 65.4 },
  { code: '601012', name: '隆基绿能', industry: '光伏', successRate: 82.1 },
  { code: '300750', name: '宁德时代', industry: '新能源', successRate: 85.7 },
];

export const chartTabs: Array<{ id: ChartTab; label: string }> = [
  { id: 'price', label: '价格结构' },
  { id: 'momentum', label: '动量指标' },
  { id: 'risk', label: '风险画像' },
];

export const priceViewOptions: Array<{ id: PriceViewPreset; label: string }> = [
  { id: '20', label: '20D' },
  { id: '60', label: '60D' },
  { id: '120', label: '120D' },
  { id: 'all', label: '全部' },
];

export const fallbackTrades: TradeRecord[] = [
  {
    id: 'fallback-1',
    buyDate: '2026-02-27',
    buyPrice: 1588.9,
    sellDate: '2026-03-11',
    sellPrice: 1632.4,
    returnPct: 2.74,
    returnAmount: 27385.77,
    result: 'success',
  },
  {
    id: 'fallback-2',
    buyDate: '2026-03-18',
    buyPrice: 1685.2,
    sellDate: '2026-03-22',
    sellPrice: 1633.1,
    returnPct: -3.09,
    returnAmount: -30915.03,
    result: 'failure',
  },
];

export const periodToQuery: Record<string, string> = {
  '近3个月': '3m',
  '近6个月': '6m',
  '近1年': '1y',
  '近3年': '3y',
};

export const generateKLineData = (stockCode: string): KLinePoint[] => {
  const basePrice = stockCode === '600519' ? 1680 : stockCode === '300750' ? 340 : stockCode === '000858' ? 145 : 120;
  const data: KLinePoint[] = [];
  let prevClose = basePrice;

  for (let i = 0; i < 60; i += 1) {
    const change = (Math.random() - 0.48) * basePrice * 0.03;
    const open = prevClose;
    const close = open + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.02);
    const low = Math.min(open, close) * (1 - Math.random() * 0.02);
    const volume = Math.floor(Math.random() * 500000 + 100000);
    const k = 50 + Math.sin(i * 0.3) * 30 + Math.random() * 10;
    const d = 50 + Math.sin(i * 0.3 - 0.2) * 28 + Math.random() * 8;
    const j = 3 * k - 2 * d;
    const dif = Math.sin(i * 0.2) * 5 + Math.random() * 2;
    const dea = Math.sin(i * 0.2 - 0.3) * 4 + Math.random() * 1.5;
    const macd = (dif - dea) * 2;
    const rsi = 50 + Math.sin(i * 0.25) * 25 + Math.random() * 10;

    data.push({
      date: new Date(2026, 0, i + 1).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
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
      ma5: Number((close * (0.98 + Math.random() * 0.04)).toFixed(2)),
      ma10: Number((close * (0.97 + Math.random() * 0.06)).toFixed(2)),
      ma20: Number((close * (0.96 + Math.random() * 0.08)).toFixed(2)),
    });

    prevClose = close;
  }

  return data;
};

export const getRiskLevel = (successRate: number): RiskLevel => {
  if (successRate >= 80) {
    return { label: '低风险', accent: 'text-[#00ff88]', badge: 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' };
  }

  if (successRate >= 70) {
    return { label: '中风险', accent: 'text-[#ffaa00]', badge: 'border-[#ffaa00]/30 bg-[#ffaa00]/10 text-[#ffaa00]' };
  }

  return { label: '高波动', accent: 'text-[#ff3366]', badge: 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]' };
};

export const toFetchErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) {
    return '实时数据加载失败，请检查代理服务和网络连接。';
  }

  const message = error.message || '';
  if (message === 'Failed to fetch' || message.includes('fetch')) {
    return '无法连接本地代理 http://localhost:3030 。请先启动 npm run dev:api。';
  }

  if (message.includes('Missing TUSHARE_TOKEN')) {
    return '代理已启动，但未读取到 TUSHARE_TOKEN。请检查项目根目录 .env.local。';
  }

  if (message.includes('Tushare upstream error')) {
    return `Tushare 上游接口请求失败: ${message}`;
  }

  if (message.includes('Tushare returned a non-zero code') || message.includes('Tushare 代理返回异常')) {
    return `Tushare 返回异常: ${message}`;
  }

  if (message.includes('No listed stock found')) {
    return '未找到该股票代码对应的上市股票，请确认输入的是 6 位 A 股代码。';
  }

  return message;
};
