import { useEffect, useState } from 'react';
import {
  fallbackActiveStrategy,
  fallbackBestStrategy,
  fallbackFeatures,
  fallbackRegime,
  fallbackSignalMarkers,
  fallbackStrategies,
  fallbackStrategyOptions,
  fallbackTrades,
  generateKLineData,
  getRiskLevel,
  periodToQuery,
  stockDatabase,
  toFetchErrorMessage,
  type ActiveStrategyContext,
  type AdaptiveStrategyDecision,
  type CandidateStrategyResult,
  type ChartTab,
  type KLinePoint,
  type LiveStockResponse,
  type MetricCard,
  type OptimizerSummary,
  type PriceViewPreset,
  type RegimeDecision,
  type SignalMarker,
  type StockItem,
  type StrategyFeatures,
  type StrategyOption,
  type TradeRecord,
} from './types';

export function useSignalAnalyzer(initialCode?: string, initialStrategyType = 'adaptive_composite_e') {
  const bootCode = initialCode && /^\d{6}$/.test(initialCode) ? initialCode : '600519';
  const initialStock = stockDatabase.find((item) => item.code === bootCode) ?? stockDatabase[0];
  const [searchCode, setSearchCode] = useState(bootCode);
  const [selectedStock, setSelectedStock] = useState<StockItem>(initialStock);
  const [klineData, setKlineData] = useState<KLinePoint[]>(generateKLineData(bootCode));
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>(fallbackTrades);
  const [signalMarkers, setSignalMarkers] = useState<SignalMarker[]>(fallbackSignalMarkers);
  const [activeStrategy, setActiveStrategy] = useState<ActiveStrategyContext>(fallbackActiveStrategy);
  const [strategyOptions, setStrategyOptions] = useState<StrategyOption[]>(fallbackStrategyOptions);
  const [activeTab, setActiveTab] = useState<ChartTab>('price');
  const [capital, setCapital] = useState(100);
  const [stopLossPercent, setStopLossPercent] = useState(8);
  const [takeProfitPercent, setTakeProfitPercent] = useState(20);
  const [strategyType, setStrategyType] = useState('adaptive_composite_e');
  const [backtestPeriod, setBacktestPeriod] = useState('近1年');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [dataSource, setDataSource] = useState<'live' | 'fallback'>('fallback');
  const [features, setFeatures] = useState<StrategyFeatures>(fallbackFeatures);
  const [regime, setRegime] = useState<RegimeDecision>(fallbackRegime);
  const [strategies, setStrategies] = useState<CandidateStrategyResult[]>(fallbackStrategies);
  const [bestStrategy, setBestStrategy] = useState<AdaptiveStrategyDecision>(fallbackBestStrategy);
  const [priceView, setPriceView] = useState<PriceViewPreset>('60');
  const [priceWindowStart, setPriceWindowStart] = useState(0);
  const [hoveredCandleIndex, setHoveredCandleIndex] = useState<number | null>(null);
  const [requestLog, setRequestLog] = useState<string[]>([]);
  const [optimizerSummary, setOptimizerSummary] = useState<OptimizerSummary | null>(null);

  const handleSearch = async (nextCode?: string, nextStrategyType?: string) => {
    const normalizedCode = (nextCode ?? searchCode).trim();
    const requestedStrategyType = nextStrategyType ?? strategyType;

    if (!/^\d{6}$/.test(normalizedCode)) {
      setErrorMessage('请输入 6 位股票代码。');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setRequestLog((current) => [
      `[request] stock=${normalizedCode} strategy=${requestedStrategyType} period=${periodToQuery[backtestPeriod] || '1y'} capital=${capital} stopLoss=${stopLossPercent} takeProfit=${takeProfitPercent}`,
      ...current,
    ].slice(0, 8));

    try {
      const query = new URLSearchParams({
        period: periodToQuery[backtestPeriod] || '1y',
        capital: String(capital),
        stopLoss: String(stopLossPercent),
        takeProfit: String(takeProfitPercent),
        strategyMode: requestedStrategyType,
      });
      const optimizerQuery = new URLSearchParams({
        period: '3y',
      });
      const [response, optimizerResponse] = await Promise.all([
        fetch(`http://localhost:3030/api/tushare/stock/${normalizedCode}?${query.toString()}`, { cache: 'no-store' }),
        fetch(`http://localhost:3030/api/tushare/optimizer/${normalizedCode}?${optimizerQuery.toString()}`, { cache: 'no-store' }),
      ]);
      const payload = (await response.json()) as LiveStockResponse & { error?: string };
      const optimizerPayload = optimizerResponse.ok
        ? (await optimizerResponse.json()) as OptimizerSummary
        : null;

      if (!response.ok) {
        throw new Error(payload.error || 'Tushare 代理返回异常');
      }

      if (!payload.strategyOptions || !payload.activeStrategy || !payload.signalMarkers) {
        throw new Error('Outdated proxy response');
      }

      const optimizerTrades = optimizerPayload?.bestResult?.trades ?? [];
      const optimizerTradeRecords = optimizerTrades.map((trade, index) => ({
        id: `optimizer-${trade.buyDate}-${trade.sellDate}-${index + 1}`,
        buyDate: trade.buyDate,
        buyPrice: Number(trade.buyPrice.toFixed(2)),
        sellDate: trade.sellDate,
        sellPrice: Number(trade.sellPrice.toFixed(2)),
        returnPct: Number((trade.return * 100).toFixed(2)),
        returnAmount: Number((trade.return * capital * 10000).toFixed(2)),
        result: trade.return >= 0 ? 'success' : 'failure',
      }));
      const optimizerSignalMarkers = optimizerTrades.flatMap((trade) => ([
        { date: trade.buyDate, type: 'buy', price: Number(trade.buyPrice.toFixed(2)), label: 'B', strategyId: 'adaptive_composite_e' },
        { date: trade.sellDate, type: 'sell', price: Number(trade.sellPrice.toFixed(2)), label: 'S', strategyId: 'adaptive_composite_e' },
      ]));
      const useOptimizerFlow = requestedStrategyType === 'adaptive_composite_e' && optimizerTradeRecords.length > 0;
      const nextStrategyOptions = payload.strategyOptions?.length ? payload.strategyOptions : fallbackStrategyOptions;
      const nextActiveStrategy = payload.activeStrategy ?? fallbackActiveStrategy;
      console.log('[SignalAnalyzer] fetch success', {
        stock: payload.stock.code,
        strategyMode: requestedStrategyType,
        activeStrategy: nextActiveStrategy.strategyId,
        strategyOptions: nextStrategyOptions.map((item) => `${item.id}:${item.score}`),
        tradeCount: payload.trades.length,
        markerCount: payload.signalMarkers?.length ?? 0,
        regime: payload.regime?.type,
      });
      setRequestLog((current) => [
        `[response] source=live stock=${payload.stock.code} active=${nextActiveStrategy.strategyId} options=${nextStrategyOptions.map((item) => item.id).join(',')} trades=${payload.trades.length} markers=${payload.signalMarkers?.length ?? 0}${payload.bestStrategy?.optimized ? ` optimizedBase=${payload.bestStrategy.optimized.baseModel}` : ''}`,
        ...current,
      ].slice(0, 8));

      setSearchCode(payload.stock.code);
      setSelectedStock(payload.stock);
      setKlineData(payload.candles.length ? payload.candles : generateKLineData(payload.stock.code));
      setTradeRecords(useOptimizerFlow ? optimizerTradeRecords : (payload.trades.length ? payload.trades : fallbackTrades));
      setSignalMarkers(useOptimizerFlow ? optimizerSignalMarkers : (payload.signalMarkers?.length ? payload.signalMarkers : fallbackSignalMarkers));
      setStrategyOptions(nextStrategyOptions);
      setActiveStrategy(useOptimizerFlow ? { ...nextActiveStrategy, strategyName: `Optimizer · ${optimizerPayload?.bestConfig?.envFilter ?? 'best'}` } : nextActiveStrategy);
      setStrategyType(nextActiveStrategy.strategyId);
      setFeatures(payload.features ?? fallbackFeatures);
      setRegime(payload.regime ?? fallbackRegime);
      setStrategies(payload.strategies?.length ? payload.strategies : fallbackStrategies);
      setBestStrategy(payload.bestStrategy ?? fallbackBestStrategy);
      setDataSource('live');
      setOptimizerSummary(optimizerPayload);
    } catch (error) {
      console.warn('[SignalAnalyzer] fetch fallback', {
        stock: normalizedCode,
        strategyMode: requestedStrategyType,
        error: error instanceof Error ? error.message : String(error),
      });
      setRequestLog((current) => [
        `[response] source=fallback stock=${normalizedCode} strategy=${requestedStrategyType} error=${error instanceof Error ? error.message : String(error)}`,
        ...current,
      ].slice(0, 8));
      const stock = stockDatabase.find((item) => item.code === normalizedCode) ?? stockDatabase[0];
      setSearchCode(stock.code);
      setSelectedStock(stock);
      setKlineData(generateKLineData(stock.code));
      setTradeRecords(fallbackTrades);
      setSignalMarkers(fallbackSignalMarkers);
      setStrategyOptions(fallbackStrategyOptions);
      setActiveStrategy(fallbackActiveStrategy);
      setStrategyType(nextStrategyType ?? 'adaptive_composite_e');
      setFeatures(fallbackFeatures);
      setRegime(fallbackRegime);
      setStrategies(fallbackStrategies);
      setBestStrategy(fallbackBestStrategy);
      setOptimizerSummary(null);
      setDataSource('fallback');
      setErrorMessage(toFetchErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void handleSearch(searchCode, initialStrategyType);
  }, []);

  useEffect(() => {
    if (initialCode && /^\d{6}$/.test(initialCode) && initialCode !== searchCode) {
      void handleSearch(initialCode, initialStrategyType);
    }
  }, [initialCode, initialStrategyType, searchCode]);

  const currentPoint = klineData[klineData.length - 1];
  const previousPoint = klineData[klineData.length - 2];
  const currentPrice = currentPoint?.close ?? 0;
  const previousClose = previousPoint?.close ?? currentPrice ?? 1;
  const priceChange = currentPrice - previousClose;
  const priceChangePercent = previousClose ? (priceChange / previousClose) * 100 : 0;
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
  const actionLabel =
    activeStrategy.currentSignal === 'buy'
      ? '优先观察买点'
      : activeStrategy.currentSignal === 'sell'
        ? '卖点已触发'
        : '等待确认信号';
  const metricCards: MetricCard[] = [
    { label: '年化收益', value: cagr, sub: `回测周期 ${backtestPeriod}` },
    { label: 'Sharpe', value: sharpe, sub: '收益风险比' },
    { label: '胜率', value: winRate, sub: `${selectedStock.industry} 样本表现` },
    { label: '最大回撤', value: maxDrawdown, sub: '历史回撤峰值' },
    { label: '波动率', value: volatility, sub: '近 60 日估算' },
  ];

  const visibleWindowSize = priceView === 'all' ? klineData.length : Math.min(Number(priceView), klineData.length);
  const clampedWindowStart = Math.min(priceWindowStart, Math.max(klineData.length - visibleWindowSize, 0));
  const visibleKlineData = klineData.slice(clampedWindowStart, clampedWindowStart + visibleWindowSize);
  const hoveredPoint = hoveredCandleIndex !== null ? visibleKlineData[hoveredCandleIndex] : visibleKlineData[visibleKlineData.length - 1];
  const visibleStartDate = visibleKlineData[0]?.date;
  const visibleEndDate = visibleKlineData[visibleKlineData.length - 1]?.date;
  const dedupedTradeRecords = Array.from(
    tradeRecords
      .reduce((map, trade) => {
        const key = `${trade.buyDate}|${trade.sellDate}|${trade.buyPrice.toFixed(2)}|${trade.sellPrice.toFixed(2)}`;
        if (!map.has(key)) {
          map.set(key, trade);
        }
        return map;
      }, new Map<string, TradeRecord>())
      .values(),
  );
  const dedupedSignalMarkers = Array.from(
    signalMarkers
      .reduce((map, marker) => {
        const key = `${marker.date}|${marker.type}`;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, { ...marker, count: 1 });
          return map;
        }

        map.set(key, {
          ...existing,
          price: marker.type === 'buy' ? Math.min(existing.price, marker.price) : Math.max(existing.price, marker.price),
          count: (existing.count ?? 1) + 1,
        });
        return map;
      }, new Map<string, SignalMarker>())
      .values(),
  );
  const visibleTradeRecords = [...dedupedTradeRecords]
    .filter((trade) => {
      if (!visibleStartDate || !visibleEndDate || priceView === 'all') {
        return true;
      }

      return (
        (trade.buyDate >= visibleStartDate && trade.buyDate <= visibleEndDate) ||
        (trade.sellDate >= visibleStartDate && trade.sellDate <= visibleEndDate)
      );
    })
    .sort((left, right) => {
      const buyCompare = right.buyDate.localeCompare(left.buyDate);
      if (buyCompare !== 0) {
        return buyCompare;
      }

      return right.sellDate.localeCompare(left.sellDate);
    });
  const visibleSignalMarkerCount = dedupedSignalMarkers.filter((marker) => {
    if (!visibleStartDate || !visibleEndDate || priceView === 'all') {
      return true;
    }

    return marker.date >= visibleStartDate && marker.date <= visibleEndDate;
  }).reduce((sum, marker) => sum + (marker.count ?? 1), 0);
  const optimizedStrategy = bestStrategy.optimized;

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
    activeStrategy,
    activeTab,
    averageVolume,
    backtestPeriod,
    bestStrategy,
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
    features,
    handleSearch,
    hoveredCandleIndex,
    hoveredPoint,
    hoveredPriceChange,
    hoveredPriceChangePct,
    isLoading,
    klineData,
    latestVolume,
    metricCards,
    optimizedStrategy,
    optimizerSummary,
    priceChange,
    priceChangePercent,
    priceTrendUp,
    priceView,
    requestLog,
    regime,
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
    signalMarkers: dedupedSignalMarkers,
    stopLoss,
    stopLossPercent,
    strategies,
    strategyOptions,
    strategyType,
    successRate,
    takeProfit,
    takeProfitPercent,
    tradeRecords: visibleTradeRecords,
    visibleSignalMarkerCount,
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
