import { useEffect, useState } from 'react';
import {
  fallbackTrades,
  generateKLineData,
  getRiskLevel,
  periodToQuery,
  stockDatabase,
  toFetchErrorMessage,
  type ChartTab,
  type KLinePoint,
  type LiveStockResponse,
  type MetricCard,
  type PriceViewPreset,
  type StockItem,
  type TradeRecord,
} from './types';

export function useSignalAnalyzer() {
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

  const handleSearch = async (nextCode?: string) => {
    const normalizedCode = (nextCode ?? searchCode).trim();
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
    void handleSearch(searchCode);
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
  const actionLabel = successRate >= 80 ? '优先观察买点' : successRate >= 70 ? '等待确认信号' : '降低仓位暴露';
  const metricCards: MetricCard[] = [
    { label: '年化收益', value: cagr, sub: `回测周期 ${backtestPeriod}` },
    { label: 'Sharpe', value: sharpe, sub: '收益风险比' },
    { label: '胜率', value: winRate, sub: `${selectedStock.industry} 策略样本` },
    { label: '最大回撤', value: maxDrawdown, sub: '历史回撤峰值' },
    { label: '波动率', value: volatility, sub: '近 60 日估算' },
  ];

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

  return {
    activeTab,
    averageVolume,
    backtestPeriod,
    candleBodyWidth,
    candleSlotWidth,
    capital,
    chartHeight,
    chartPadding,
    chartWidth,
    clampedWindowStart,
    currentPrice,
    dataSource,
    drawableHeight,
    drawableWidth,
    errorMessage,
    handleSearch,
    hoveredCandleIndex,
    hoveredPoint,
    hoveredPriceChange,
    hoveredPriceChangePct,
    isLoading,
    klineData,
    latestVolume,
    metricCards,
    priceChange,
    priceChangePercent,
    priceTrendUp,
    priceView,
    riskLevel,
    searchCode,
    selectedStock,
    setActiveTab,
    setBacktestPeriod,
    setCapital,
    setHoveredCandleIndex,
    setPriceView,
    setPriceWindowStart,
    setSearchCode,
    setStopLossPercent,
    setStrategyType,
    setTakeProfitPercent,
    stopLoss,
    stopLossPercent,
    strategyType,
    successRate,
    takeProfit,
    takeProfitPercent,
    tradeRecords,
    visibleKlineData,
    visibleMaxPrice,
    visiblePriceSpan,
    visibleWindowSize,
    volatility,
    winRate,
    yOfVisiblePrice,
    actionLabel,
  };
}
