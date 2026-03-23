import { TrendingDown, TrendingUp } from 'lucide-react';
import { KLineWorkspace } from './signal-analyzer/KLineWorkspace';
import { StrategyControls } from './signal-analyzer/StrategyControls';
import { TradeLedger } from './signal-analyzer/TradeLedger';
import { useSignalAnalyzer } from './signal-analyzer/useSignalAnalyzer';

const zh = {
  industryTiming: '行业量化择时模型',
  activeStrategy: '当前策略',
  optimizedSource: '优化来源',
  optimizedParams: '优化参数',
};

interface SignalAnalyzerProps {
  initialCode?: string;
}

export function SignalAnalyzer({ initialCode }: SignalAnalyzerProps = {}) {
  const analyzer = useSignalAnalyzer(initialCode);

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <StrategyControls
        backtestPeriod={analyzer.backtestPeriod}
        capital={analyzer.capital}
        dataSource={analyzer.dataSource}
        errorMessage={analyzer.errorMessage}
        handleSearch={analyzer.handleSearch}
        isLoading={analyzer.isLoading}
        riskBadgeClass={analyzer.riskLevel.badge}
        searchCode={analyzer.searchCode}
        selectedStock={analyzer.selectedStock}
        setBacktestPeriod={analyzer.setBacktestPeriod}
        setCapital={analyzer.setCapital}
        setSearchCode={analyzer.setSearchCode}
        setStopLossPercent={analyzer.setStopLossPercent}
        setStrategyType={analyzer.setStrategyType}
        setTakeProfitPercent={analyzer.setTakeProfitPercent}
        stopLossPercent={analyzer.stopLossPercent}
        strategyOptions={analyzer.strategyOptions}
        strategyType={analyzer.strategyType}
        takeProfitPercent={analyzer.takeProfitPercent}
        optimizedStrategy={analyzer.optimizedStrategy}
        optimizerSummary={analyzer.optimizerSummary}
      />

      <section className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Signal Center</div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="font-mono text-[28px] font-semibold text-foreground">{analyzer.selectedStock.code}</div>
                <div>
                  <div className="text-lg text-foreground">{analyzer.selectedStock.name}</div>
                  <div className="text-sm text-muted-foreground">{analyzer.selectedStock.industry} {zh.industryTiming}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="min-w-[140px] rounded-md border border-border bg-secondary px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Latest Price</div>
                <div className="mt-2 font-mono text-2xl text-foreground">¥{analyzer.currentPrice.toFixed(2)}</div>
              </div>
              <div className="min-w-[160px] rounded-md border border-border bg-secondary px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Daily Move</div>
                <div className={`mt-2 flex items-center gap-2 font-mono text-xl ${analyzer.priceTrendUp ? 'text-[#ff3366]' : 'text-[#00ff88]'}`}>
                  {analyzer.priceTrendUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  <span>
                    {analyzer.priceChange >= 0 ? '+' : ''}
                    {analyzer.priceChange.toFixed(2)} ({analyzer.priceChangePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
              <div className="min-w-[170px] rounded-md border border-border bg-secondary px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{zh.activeStrategy}</div>
                <div className="mt-2 text-base text-foreground">{analyzer.activeStrategy.strategyName}</div>
                <div className="mt-1 text-sm text-muted-foreground">{analyzer.actionLabel}</div>
                {analyzer.activeStrategy.strategyId === 'adaptive_composite_e' && analyzer.optimizedStrategy ? (
                  <>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {zh.optimizedSource}{': '}{analyzer.optimizedStrategy.baseModelName}
                    </div>
                    <div className="mt-1 break-all text-xs text-muted-foreground">
                      {zh.optimizedParams}{': '}
                      {Object.entries(analyzer.optimizedStrategy.params)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(', ')}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {analyzer.metricCards.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{metric.label}</div>
              <div className="mt-3 font-mono text-[24px] text-foreground">{metric.value}</div>
              <div className="mt-2 text-xs text-muted-foreground">{metric.sub}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Debug Log</div>
          <div className="mt-3 space-y-2 font-mono text-[11px] text-muted-foreground">
            <div className="break-all rounded border border-border bg-secondary/30 px-3 py-2">
              {`[view] priceView=${analyzer.priceView} trades=${analyzer.tradeRecords.length} markers=${analyzer.visibleSignalMarkerCount}`}
            </div>
            {analyzer.requestLog.map((line, index) => (
              <div key={`${line}-${index}`} className="break-all rounded border border-border bg-secondary/30 px-3 py-2">
                {line}
              </div>
            ))}
          </div>
        </div>

        <KLineWorkspace
          activeStrategy={analyzer.activeStrategy}
          activeTab={analyzer.activeTab}
          averageVolume={analyzer.averageVolume}
          candleBodyWidth={analyzer.candleBodyWidth}
          candleSlotWidth={analyzer.candleSlotWidth}
          chartHeight={analyzer.chartHeight}
          chartPadding={analyzer.chartPadding}
          chartWidth={analyzer.chartWidth}
          clampedWindowStart={analyzer.clampedWindowStart}
          dataSource={analyzer.dataSource}
          drawableHeight={analyzer.drawableHeight}
          handleTabChange={analyzer.setActiveTab}
          hoveredCandleIndex={analyzer.hoveredCandleIndex}
          hoveredPoint={analyzer.hoveredPoint}
          hoveredPriceChange={analyzer.hoveredPriceChange}
          hoveredPriceChangePct={analyzer.hoveredPriceChangePct}
          klineData={analyzer.klineData}
          latestVolume={analyzer.latestVolume}
          priceView={analyzer.priceView}
          selectedStock={analyzer.selectedStock}
          setHoveredCandleIndex={analyzer.setHoveredCandleIndex}
          setPriceView={analyzer.setPriceView}
          setPriceWindowStart={analyzer.setPriceWindowStart}
          signalMarkers={analyzer.signalMarkers}
          stopLoss={analyzer.stopLoss}
          successRate={analyzer.successRate}
          takeProfit={analyzer.takeProfit}
          visibleKlineData={analyzer.visibleKlineData}
          visibleMaxPrice={analyzer.visibleMaxPrice}
          visiblePriceSpan={analyzer.visiblePriceSpan}
          visibleWindowSize={analyzer.visibleWindowSize}
          volatility={analyzer.volatility}
          winRate={analyzer.winRate}
          yOfVisiblePrice={analyzer.yOfVisiblePrice}
        />

        <TradeLedger tradeRecords={analyzer.tradeRecords} />
      </section>
    </div>
  );
}
