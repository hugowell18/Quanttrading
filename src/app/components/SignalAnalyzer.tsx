import { useEffect, useState } from 'react';
import { Search, TrendingUp, TrendingDown, AlertCircle, Sparkles, SlidersHorizontal, CandlestickChart } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area,
} from 'recharts';

type StockItem = {
  code: string;
  name: string;
  industry: string;
  successRate: number;
};

type KLinePoint = {
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

type TradeRecord = {
  id: string;
  buyDate: string;
  buyPrice: number;
  sellDate: string;
  sellPrice: number;
  returnPct: number;
  returnAmount: number;
  result: 'success' | 'failure';
};

type LiveStockResponse = {
  stock: StockItem;
  candles: KLinePoint[];
  trades: TradeRecord[];
};

type ChartTab = 'price' | 'momentum' | 'risk';
type PriceViewPreset = '20' | '60' | '120' | 'all';

const stockDatabase: StockItem[] = [
  { code: '600519', name: '贵州茅台', industry: '白酒', successRate: 78.5 },
  { code: '000858', name: '五粮液', industry: '白酒', successRate: 72.3 },
  { code: '601318', name: '中国平安', industry: '保险', successRate: 68.9 },
  { code: '600036', name: '招商银行', industry: '银行', successRate: 71.2 },
  { code: '000001', name: '平安银行', industry: '银行', successRate: 65.4 },
  { code: '601012', name: '隆基绿能', industry: '光伏', successRate: 82.1 },
  { code: '300750', name: '宁德时代', industry: '新能源', successRate: 85.7 },
];

const chartTabs: Array<{ id: ChartTab; label: string }> = [
  { id: 'price', label: '价格结构' },
  { id: 'momentum', label: '动量指标' },
  { id: 'risk', label: '风险画像' },
];

const fallbackTrades: TradeRecord[] = [
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

const periodToQuery: Record<string, string> = {
  '近3个月': '3m',
  '近6个月': '6m',
  '近1年': '1y',
  '近3年': '3y',
};

const generateKLineData = (stockCode: string): KLinePoint[] => {
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

const buildKlineSvg = (data: KLinePoint[]) => {
  if (!data.length) {
    return '<svg viewBox="0 0 800 260" style="width:100%;height:100%" preserveAspectRatio="none"></svg>';
  }

  const width = 800;
  const height = 260;
  const topPadding = 18;
  const bottomPadding = 22;
  const chartHeight = height - topPadding - bottomPadding;
  const minPrice = Math.min(...data.map((item) => item.low));
  const maxPrice = Math.max(...data.map((item) => item.high));
  const priceSpan = Math.max(maxPrice - minPrice, 1);
  const candleStep = width / data.length;
  const candleWidth = Math.max(5, Math.min(9.333333333333334, candleStep * 0.7));
  const yOf = (price: number) => topPadding + ((maxPrice - price) / priceSpan) * chartHeight;

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const y = topPadding + (chartHeight / 4) * index;
    return `<line x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="rgba(26,45,66,0.8)" stroke-width="1"></line>`;
  }).join('');

  const candles = data
    .map((item, index) => {
      const xCenter = candleStep * index + candleStep / 2;
      const x = xCenter - candleWidth / 2;
      const openY = yOf(item.open);
      const closeY = yOf(item.close);
      const highY = yOf(item.high);
      const lowY = yOf(item.low);
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(openY - closeY), 1);
      const isUp = item.close >= item.open;
      const color = isUp ? '#ff3366' : '#00ff88';

      return `<line x1="${xCenter}" x2="${xCenter}" y1="${highY}" y2="${lowY}" stroke="${color}" stroke-width="1"></line><rect x="${x}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" fill="${color}" opacity="0.85" rx="1"></rect>`;
    })
    .join('');

  return `<svg viewBox="0 0 800 260" style="width:100%;height:100%;" preserveAspectRatio="none">${gridLines}${candles}</svg>`;
};

const getRiskLevel = (successRate: number) => {
  if (successRate >= 80) {
    return { label: '低风险', accent: 'text-[#00ff88]', badge: 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' };
  }

  if (successRate >= 70) {
    return { label: '中风险', accent: 'text-[#ffaa00]', badge: 'border-[#ffaa00]/30 bg-[#ffaa00]/10 text-[#ffaa00]' };
  }

  return { label: '高波动', accent: 'text-[#ff3366]', badge: 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]' };
};

const toFetchErrorMessage = (error: unknown) => {
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

export function SignalAnalyzer() {
  const [searchCode, setSearchCode] = useState('600519');
  const [selectedStock, setSelectedStock] = useState<StockItem>(stockDatabase[0]);
  const [klineData, setKlineData] = useState<KLinePoint[]>(generateKLineData('600519'));
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>(fallbackTrades);
  const [activeTab, setActiveTab] = useState<ChartTab>('price');
  const [capital, setCapital] = useState(100);
  const [stopLossPercent, setStopLossPercent] = useState(8);
  const [takeProfitPercent, setTakeProfitPercent] = useState(20);
  const [strategyType, setStrategyType] = useState('动量策略 (Momentum)');
  const [backtestPeriod, setBacktestPeriod] = useState('近1年');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [dataSource, setDataSource] = useState<'live' | 'fallback'>('fallback');
  const [priceView, setPriceView] = useState<PriceViewPreset>('60');
  const [priceWindowStart, setPriceWindowStart] = useState(0);
  const [hoveredCandleIndex, setHoveredCandleIndex] = useState<number | null>(null);

  const handleSearch = async () => {
    const normalizedCode = searchCode.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setErrorMessage('请输入 6 位股票代码。');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const query = new URLSearchParams({
        period: periodToQuery[backtestPeriod] || '1y',
        capital: String(capital),
        stopLoss: String(stopLossPercent),
        takeProfit: String(takeProfitPercent),
      });
      const response = await fetch(`http://localhost:3030/api/tushare/stock/${normalizedCode}?${query.toString()}`);
      const payload = (await response.json()) as LiveStockResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Tushare 代理返回异常');
      }

      setSearchCode(payload.stock.code);
      setSelectedStock(payload.stock);
      setKlineData(payload.candles.length ? payload.candles : generateKLineData(payload.stock.code));
      setTradeRecords(payload.trades.length ? payload.trades : fallbackTrades);
      setDataSource('live');
    } catch (error) {
      const stock = stockDatabase.find((item) => item.code === normalizedCode) ?? stockDatabase[0];
      setSelectedStock(stock);
      setKlineData(generateKLineData(stock.code));
      setTradeRecords(fallbackTrades);
      setDataSource('fallback');
      setErrorMessage(toFetchErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void handleSearch();
  }, []);

  const currentPoint = klineData[klineData.length - 1];
  const previousPoint = klineData[klineData.length - 2];
  const currentPrice = currentPoint?.close ?? 0;
  const previousClose = previousPoint?.close ?? currentPrice ?? 1;
  const priceChange = currentPrice - previousClose;
  const priceChangePercent = (priceChange / previousClose) * 100;
  const priceTrendUp = priceChange >= 0;
  const successRate = selectedStock.successRate;
  const winRate = `${successRate.toFixed(1)}%`;
  const sharpe = (1.25 + successRate / 100).toFixed(2);
  const cagr = `${(successRate / 2.7).toFixed(1)}%`;
  const maxDrawdown = `-${(18 - successRate / 10).toFixed(1)}%`;
  const volatility = `${(12 + (100 - successRate) / 2).toFixed(1)}%`;
  const stopLoss = `¥${(currentPrice * (1 - stopLossPercent / 100)).toFixed(2)}`;
  const takeProfit = `¥${(currentPrice * (1 + takeProfitPercent / 100)).toFixed(2)}`;
  const latestVolume = currentPoint?.volume ?? 0;
  const averageVolume = Math.round(klineData.reduce((sum, item) => sum + item.volume, 0) / Math.max(klineData.length, 1));
  const riskLevel = getRiskLevel(successRate);
  const momentumBias = (currentPoint?.dif ?? 0) >= (currentPoint?.dea ?? 0) ? '多头增强' : '空头修复';
  const actionLabel = successRate >= 80 ? '优先观察买点' : successRate >= 70 ? '等待确认信号' : '降低仓位暴露';
  const metricCards = [
    { label: '年化收益', value: cagr, sub: `回测周期 ${backtestPeriod}` },
    { label: 'Sharpe', value: sharpe, sub: '收益风险比' },
    { label: '胜率', value: winRate, sub: `${selectedStock.industry} 策略样本` },
    { label: '最大回撤', value: maxDrawdown, sub: '历史回撤峰值' },
    { label: '波动率', value: volatility, sub: '近 60 日估算' },
  ];

  const dynamicKlineSvg = buildKlineSvg(klineData);
  const visibleWindowSize = priceView === 'all' ? klineData.length : Math.min(Number(priceView), klineData.length);
  const clampedWindowStart = Math.min(priceWindowStart, Math.max(klineData.length - visibleWindowSize, 0));
  const visibleKlineData = klineData.slice(clampedWindowStart, clampedWindowStart + visibleWindowSize);
  const hoveredPoint = hoveredCandleIndex !== null ? visibleKlineData[hoveredCandleIndex] : visibleKlineData[visibleKlineData.length - 1];

  useEffect(() => {
    const nextWindowSize = priceView === 'all' ? klineData.length : Math.min(Number(priceView), klineData.length);
    setPriceWindowStart(Math.max(klineData.length - nextWindowSize, 0));
    setHoveredCandleIndex(null);
  }, [klineData.length, priceView]);

  const chartWidth = 920;
  const chartHeight = 360;
  const chartPadding = { top: 24, right: 72, bottom: 34, left: 16 };
  const drawableWidth = chartWidth - chartPadding.left - chartPadding.right;
  const drawableHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const visibleLows = visibleKlineData.map((item) => item.low);
  const visibleHighs = visibleKlineData.map((item) => item.high);
  const visibleMinPrice = visibleLows.length ? Math.min(...visibleLows) : 0;
  const visibleMaxPrice = visibleHighs.length ? Math.max(...visibleHighs) : 1;
  const visiblePriceSpan = Math.max(visibleMaxPrice - visibleMinPrice, 1);
  const candleSlotWidth = visibleKlineData.length ? drawableWidth / visibleKlineData.length : drawableWidth;
  const candleBodyWidth = Math.max(6, Math.min(18, candleSlotWidth * 0.62));
  const yOfVisiblePrice = (price: number) => chartPadding.top + ((visibleMaxPrice - price) / visiblePriceSpan) * drawableHeight;
  const hoveredPriceChange = hoveredPoint ? hoveredPoint.close - hoveredPoint.open : 0;
  const hoveredPriceChangePct = hoveredPoint && hoveredPoint.open ? (hoveredPriceChange / hoveredPoint.open) * 100 : 0;

  const Candlestick = (props: { x?: number; width?: number; payload?: KLinePoint }) => {
    const { x = 0, width = 0, payload } = props;
    if (!payload || width < 1) return null;

    const lows = klineData.map((item) => item.low);
    const highs = klineData.map((item) => item.high);
    const minY = Math.min(...lows);
    const maxY = Math.max(...highs);
    const span = Math.max(maxY - minY, 1);
    const chartHeight = 360;
    const isRising = payload.close >= payload.open;
    const color = isRising ? '#ff3366' : '#00ff88';
    const convertY = (value: number) => chartHeight - ((value - minY) / span) * chartHeight;
    const highY = convertY(payload.high);
    const lowY = convertY(payload.low);
    const openY = convertY(payload.open);
    const closeY = convertY(payload.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(openY - closeY), 1);

    return (
      <g>
        <line x1={x + width / 2} y1={highY} x2={x + width / 2} y2={lowY} stroke={color} strokeWidth={1} />
        <rect
          x={x + 1}
          y={bodyTop}
          width={Math.max(width - 2, 1)}
          height={bodyHeight}
          fill={isRising ? 'rgba(255,51,102,0.18)' : 'rgba(0,255,136,0.18)'}
          stroke={color}
          strokeWidth={1}
        />
      </g>
    );
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Scanner</div>
              <h3 className="mt-2 flex items-center gap-2 font-mono text-base text-foreground">
                <Search className="h-4 w-4 text-primary" />
                股票扫描
              </h3>
            </div>
            <div className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${riskLevel.badge}`}>
              {dataSource === 'live' ? 'LIVE' : 'FALLBACK'}
            </div>
          </div>

          <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">证券代码</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchCode}
              onChange={(event) => setSearchCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleSearch();
                }
              }}
              placeholder="输入股票代码，例如 600519"
              className="h-11 w-full rounded-md border border-border bg-secondary pl-10 pr-4 font-mono text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleSearch()}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-mono text-[12px] uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110"
          >
            <CandlestickChart className="h-4 w-4" />
            {isLoading ? '加载中...' : '运行分析'}
          </button>

          {errorMessage ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-[#ff3366]/30 bg-[#ff3366]/8 px-3 py-2 text-xs text-[#ffb1c2]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="mt-5">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">预设股票池</div>
            <div className="grid grid-cols-2 gap-2">
              {stockDatabase.map((stock) => (
                <button
                  key={stock.code}
                  type="button"
                  onClick={() => {
                    setSearchCode(stock.code);
                    void handleSearch();
                  }}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    selectedStock.code === stock.code
                      ? 'border-primary/30 bg-primary/12'
                      : 'border-border bg-secondary hover:border-primary/30 hover:bg-primary/6'
                  }`}
                >
                  <div className="font-mono text-[12px] text-primary">{stock.code}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{stock.name}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            策略参数
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">策略类型</div>
              <select
                value={strategyType}
                onChange={(event) => setStrategyType(event.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none"
              >
                <option>动量策略 (Momentum)</option>
                <option>趋势策略 (Trend Following)</option>
                <option>均值回归 (Mean Reversion)</option>
              </select>
            </div>
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">回测周期</div>
              <select
                value={backtestPeriod}
                onChange={(event) => setBacktestPeriod(event.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none"
              >
                <option>近3个月</option>
                <option>近6个月</option>
                <option>近1年</option>
                <option>近3年</option>
              </select>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
                <span>初始资金</span>
                <span className="text-primary">{capital}万</span>
              </div>
              <input
                type="range"
                min="10"
                max="500"
                value={capital}
                onChange={(event) => setCapital(Number(event.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded bg-border"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
                <span>止损线</span>
                <span className="text-[#ff3366]">-{stopLossPercent}%</span>
              </div>
              <input
                type="range"
                min="2"
                max="20"
                value={stopLossPercent}
                onChange={(event) => setStopLossPercent(Number(event.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded bg-border"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
                <span>止盈线</span>
                <span className="text-[#00ff88]">+{takeProfitPercent}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="50"
                value={takeProfitPercent}
                onChange={(event) => setTakeProfitPercent(Number(event.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded bg-border"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSearch()}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-mono text-[12px] uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110"
          >
            ▶ 运行回测
          </button>
        </section>
      </aside>

      <section className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Signal Center</div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="font-mono text-[28px] font-semibold text-foreground">{selectedStock.code}</div>
                <div>
                  <div className="text-lg text-foreground">{selectedStock.name}</div>
                  <div className="text-sm text-muted-foreground">{selectedStock.industry} 行业量化择时模型</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="min-w-[140px] rounded-md border border-border bg-secondary px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Latest Price</div>
                <div className="mt-2 font-mono text-2xl text-foreground">¥{currentPrice.toFixed(2)}</div>
              </div>
              <div className="min-w-[160px] rounded-md border border-border bg-secondary px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Daily Move</div>
                <div className={`mt-2 flex items-center gap-2 font-mono text-xl ${priceTrendUp ? 'text-[#ff3366]' : 'text-[#00ff88]'}`}>
                  {priceTrendUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  <span>
                    {priceChange >= 0 ? '+' : ''}
                    {priceChange.toFixed(2)} ({priceChangePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
              <div className="min-w-[140px] rounded-md border border-border bg-secondary px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Signal Bias</div>
                <div className={`mt-2 text-xl ${riskLevel.accent}`}>{actionLabel}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {metricCards.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{metric.label}</div>
              <div className="mt-3 font-mono text-[24px] text-foreground">{metric.value}</div>
              <div className="mt-2 text-xs text-muted-foreground">{metric.sub}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-mono text-[15px] font-semibold tracking-[0.08em] text-foreground">
                {selectedStock.code} · {selectedStock.name} · 日K
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {chartTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-md border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                    activeTab === tab.id
                      ? 'border-primary/30 bg-primary/12 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'price' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: '20', label: '20D' },
                      { id: '60', label: '60D' },
                      { id: '120', label: '120D' },
                      { id: 'all', label: '全部' },
                    ] as Array<{ id: PriceViewPreset; label: string }>).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setPriceView(option.id)}
                        className={`rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                          priceView === option.id
                            ? 'border-primary/30 bg-primary/12 text-primary'
                            : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    默认视图: 最近 {visibleWindowSize || 0} 根K线
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">KLine Inspector</div>
                      <div className="mt-2 font-mono text-sm text-foreground">
                        {hoveredPoint ? `${hoveredPoint.date} · ${selectedStock.code}` : `${selectedStock.code} · 日K`}
                      </div>
                    </div>
                    <div className="grid min-w-[300px] grid-cols-3 gap-2 text-[12px]">
                      <div className="rounded border border-border bg-card/60 px-3 py-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">开 / 收</div>
                        <div className="mt-1 font-mono text-foreground">
                          {hoveredPoint ? `¥${hoveredPoint.open.toFixed(2)} / ¥${hoveredPoint.close.toFixed(2)}` : '--'}
                        </div>
                      </div>
                      <div className="rounded border border-border bg-card/60 px-3 py-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">高 / 低</div>
                        <div className="mt-1 font-mono text-foreground">
                          {hoveredPoint ? `¥${hoveredPoint.high.toFixed(2)} / ¥${hoveredPoint.low.toFixed(2)}` : '--'}
                        </div>
                      </div>
                      <div className="rounded border border-border bg-card/60 px-3 py-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">涨跌 / 成交量</div>
                        <div className={`mt-1 font-mono ${hoveredPriceChange >= 0 ? 'text-[#ff3366]' : 'text-[#00ff88]'}`}>
                          {hoveredPoint ? `${hoveredPriceChange >= 0 ? '+' : ''}${hoveredPriceChange.toFixed(2)} (${hoveredPriceChangePct.toFixed(2)}%)` : '--'}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {hoveredPoint ? hoveredPoint.volume.toLocaleString('en-US') : '--'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-lg border border-border bg-[#08121c]">
                    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="block h-[360px] w-full" preserveAspectRatio="none">
                      {Array.from({ length: 5 }, (_, index) => {
                        const y = chartPadding.top + (drawableHeight / 4) * index;
                        const axisPrice = visibleMaxPrice - (visiblePriceSpan / 4) * index;

                        return (
                          <g key={`grid-${index}`}>
                            <line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} stroke="rgba(26,45,66,0.8)" strokeWidth={1} />
                            <text x={chartWidth - chartPadding.right + 10} y={y + 4} fill="#7a9bb5" fontSize="11" fontFamily="JetBrains Mono">
                              {axisPrice.toFixed(2)}
                            </text>
                          </g>
                        );
                      })}

                      {visibleKlineData.map((item, index) => {
                        const xCenter = chartPadding.left + candleSlotWidth * index + candleSlotWidth / 2;
                        const x = xCenter - candleBodyWidth / 2;
                        const openY = yOfVisiblePrice(item.open);
                        const closeY = yOfVisiblePrice(item.close);
                        const highY = yOfVisiblePrice(item.high);
                        const lowY = yOfVisiblePrice(item.low);
                        const bodyTop = Math.min(openY, closeY);
                        const bodyHeight = Math.max(Math.abs(openY - closeY), 1);
                        const isRising = item.close >= item.open;
                        const color = isRising ? '#ff3366' : '#00ff88';
                        const isHovered = hoveredCandleIndex === index;

                        return (
                          <g key={`${item.date}-${index}`}>
                            <line x1={xCenter} x2={xCenter} y1={highY} y2={lowY} stroke={color} strokeWidth={1} />
                            <rect
                              x={x}
                              y={bodyTop}
                              width={candleBodyWidth}
                              height={bodyHeight}
                              fill={isRising ? 'rgba(255,51,102,0.18)' : 'rgba(0,255,136,0.18)'}
                              stroke={color}
                              strokeWidth={isHovered ? 1.6 : 1}
                              rx={1}
                            />
                            <rect
                              x={chartPadding.left + candleSlotWidth * index}
                              y={chartPadding.top}
                              width={Math.max(candleSlotWidth, 8)}
                              height={drawableHeight}
                              fill="transparent"
                              onMouseEnter={() => setHoveredCandleIndex(index)}
                              onMouseMove={() => setHoveredCandleIndex(index)}
                            />
                          </g>
                        );
                      })}

                      {hoveredPoint && hoveredCandleIndex !== null ? (
                        <>
                          <line
                            x1={chartPadding.left + candleSlotWidth * hoveredCandleIndex + candleSlotWidth / 2}
                            x2={chartPadding.left + candleSlotWidth * hoveredCandleIndex + candleSlotWidth / 2}
                            y1={chartPadding.top}
                            y2={chartHeight - chartPadding.bottom}
                            stroke="rgba(0,212,255,0.45)"
                            strokeDasharray="4 4"
                          />
                          <line
                            x1={chartPadding.left}
                            x2={chartWidth - chartPadding.right}
                            y1={yOfVisiblePrice(hoveredPoint.close)}
                            y2={yOfVisiblePrice(hoveredPoint.close)}
                            stroke="rgba(0,212,255,0.35)"
                            strokeDasharray="4 4"
                          />
                        </>
                      ) : null}

                      {visibleKlineData.map((item, index) => {
                        if (index % Math.max(Math.floor(visibleKlineData.length / 6), 1) !== 0 && index !== visibleKlineData.length - 1) {
                          return null;
                        }

                        const xCenter = chartPadding.left + candleSlotWidth * index + candleSlotWidth / 2;
                        return (
                          <text
                            key={`label-${item.date}-${index}`}
                            x={xCenter}
                            y={chartHeight - 10}
                            textAnchor="middle"
                            fill="#7a9bb5"
                            fontSize="11"
                            fontFamily="JetBrains Mono"
                          >
                            {item.date}
                          </text>
                        );
                      })}
                    </svg>
                  </div>

                  {visibleWindowSize < klineData.length ? (
                    <div className="mt-4 rounded-md border border-border bg-card/40 px-3 py-3">
                      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        <span>视窗滑动</span>
                        <span>
                          {clampedWindowStart + 1} - {Math.min(clampedWindowStart + visibleWindowSize, klineData.length)} / {klineData.length}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={String(Math.max(klineData.length - visibleWindowSize, 0))}
                        value={clampedWindowStart}
                        onChange={(event) => {
                          setPriceWindowStart(Number(event.target.value));
                          setHoveredCandleIndex(null);
                        }}
                        className="h-1 w-full cursor-pointer appearance-none rounded bg-border"
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-secondary/40 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Volume Pulse</div>
                  <div className="mt-3 text-2xl font-mono text-foreground">{latestVolume.toLocaleString('en-US')}</div>
                  <div className="mt-1 text-xs text-muted-foreground">当前成交量 / 平均 {averageVolume.toLocaleString('en-US')}</div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Execution Plan</div>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <p>建议仓位控制在 30% - 45%，分批介入。</p>
                    <p>跌破 {stopLoss} 触发减仓，靠近 {takeProfit} 分批止盈。</p>
                    <p>若量能连续两日回落至均值下方，停止追价。</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'momentum' && (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-border bg-secondary/40 p-4">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">MACD / Trend</div>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={klineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2d42" opacity={0.45} />
                    <XAxis dataKey="date" stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0c1520',
                        border: '1px solid #1a2d42',
                        borderRadius: '8px',
                      }}
                    />
                    <ReferenceLine y={0} stroke="#7a9bb5" strokeDasharray="2 2" />
                    <Bar dataKey="macd" fill="#00d4ff" opacity={0.6} name="MACD" />
                    <Line type="monotone" dataKey="dif" stroke="#ff3366" strokeWidth={2} dot={false} name="DIF" />
                    <Line type="monotone" dataKey="dea" stroke="#00ff88" strokeWidth={2} dot={false} name="DEA" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-lg border border-border bg-secondary/40 p-4">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">KDJ / RSI</div>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={klineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2d42" opacity={0.45} />
                    <XAxis dataKey="date" stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#7a9bb5" tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0c1520',
                        border: '1px solid #1a2d42',
                        borderRadius: '8px',
                      }}
                    />
                    <ReferenceLine y={80} stroke="#ff3366" strokeDasharray="3 3" />
                    <ReferenceLine y={20} stroke="#00ff88" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="k" stroke="#00d4ff" strokeWidth={2} dot={false} name="K" />
                    <Line type="monotone" dataKey="d" stroke="#ff3366" strokeWidth={2} dot={false} name="D" />
                    <Line type="monotone" dataKey="j" stroke="#ffaa00" strokeWidth={2} dot={false} name="J" />
                    <Line type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={2} dot={false} name="RSI" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTab === 'risk' && (
            <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-secondary/40 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Risk Brief</div>
                  <div className="mt-3 font-mono text-sm text-foreground">{dataSource === 'live' ? 'LIVE' : 'FALLBACK'}</div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    胜率 {winRate}，波动率 {volatility}，适合 {successRate >= 80 ? '主动跟踪' : '等待确认'} 节奏。
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Boundary Levels</div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-border px-3 py-3">
                      <div className="text-xs text-muted-foreground">止损</div>
                      <div className="mt-1 font-mono text-lg text-[#ff3366]">{stopLoss}</div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-3">
                      <div className="text-xs text-muted-foreground">止盈</div>
                      <div className="mt-1 font-mono text-lg text-[#00ff88]">{takeProfit}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/40 p-4">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Volatility Envelope</div>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={klineData}>
                    <defs>
                      <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ffaa00" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#ffaa00" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2d42" opacity={0.45} />
                    <XAxis dataKey="date" stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#7a9bb5" tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0c1520',
                        border: '1px solid #1a2d42',
                        borderRadius: '8px',
                      }}
                    />
                    <ReferenceLine y={70} stroke="#ff3366" strokeDasharray="3 3" />
                    <ReferenceLine y={30} stroke="#00ff88" strokeDasharray="3 3" />
                    <Area type="monotone" dataKey="rsi" stroke="#ffaa00" strokeWidth={2} fill="url(#riskFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">买卖信号记录</div>
            <div className="text-xs text-muted-foreground">按完整交易对展示真实买入与卖出结果</div>
          </div>
          <div className="space-y-4">
            {tradeRecords.map((trade, index) => {
              const success = trade.result === 'success';
              return (
                <div key={trade.id} className="rounded-lg border border-border bg-secondary/30 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">交易 {String(index + 1).padStart(2, '0')}</div>
                    <div className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${success ? 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' : 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]'}`}>
                      {success ? '成功' : '失败'}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-md border border-border bg-card/50 p-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">买入</div>
                      <div className="mt-2 text-sm text-foreground">时间：{trade.buyDate}</div>
                      <div className="mt-1 font-mono text-base text-[#ff3366]">价格：¥{trade.buyPrice.toFixed(2)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-card/50 p-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">卖出</div>
                      <div className="mt-2 text-sm text-foreground">时间：{trade.sellDate}</div>
                      <div className="mt-1 font-mono text-base text-[#00ff88]">价格：¥{trade.sellPrice.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    <div className="text-muted-foreground">
                      收益率
                      <span className={`ml-2 font-mono ${success ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                        {trade.returnPct >= 0 ? '+' : ''}{trade.returnPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      收益额
                      <span className={`ml-2 font-mono ${success ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                        {trade.returnAmount >= 0 ? '+' : '-'}¥{Math.abs(trade.returnAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
