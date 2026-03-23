import { AlertCircle, CandlestickChart, Search, SlidersHorizontal } from 'lucide-react';
import { stockDatabase, type OptimizedStrategyResult, type OptimizerSummary, type StockItem, type StrategyOption } from './types';

const zh = {
  scanner: '股票扫描',
  code: '证券代码',
  placeholder: '输入股票代码，例如 600519',
  loading: '加载中...',
  runAnalysis: '运行分析',
  pool: '预设股票池',
  params: '策略参数',
  strategyType: '策略类型',
  period: '回测周期',
  recent3m: '近 3 个月',
  recent6m: '近 6 个月',
  recent1y: '近 1 年',
  recent3y: '近 3 年',
  capital: '初始资金',
  stopLoss: '止损线',
  takeProfit: '止盈线',
  runBacktest: '运行回测',
  optimizedHint: '优化模型',
  optimizedFallback: '未找到更优参数，当前采用基础最优模型',
  baseModel: '基础模型',
  improveWinRate: '胜率提升',
  improveReturn: '收益提升',
  scanStats: '扫描结果',
  stockType: '股票类型',
  bestConfig: '最优配置',
  envFilter: '环境过滤',
  scanReturn: '平均收益',
  scanStopLoss: '止损率',
  scanTrades: '交易数',
  scanValid: '有效组合',
};

type StrategyControlsProps = {
  backtestPeriod: string;
  capital: number;
  dataSource: 'live' | 'fallback';
  errorMessage: string;
  handleSearch: (nextCode?: string, nextStrategyType?: string) => Promise<void>;
  isLoading: boolean;
  riskBadgeClass: string;
  searchCode: string;
  selectedStock: StockItem;
  setBacktestPeriod: (value: string) => void;
  setCapital: (value: number) => void;
  setSearchCode: (value: string) => void;
  setStopLossPercent: (value: number) => void;
  setStrategyType: (value: string) => void;
  setTakeProfitPercent: (value: number) => void;
  stopLossPercent: number;
  strategyOptions: StrategyOption[];
  strategyType: string;
  takeProfitPercent: number;
  optimizedStrategy?: OptimizedStrategyResult;
  optimizerSummary: OptimizerSummary | null;
};

export function StrategyControls(props: StrategyControlsProps) {
  const {
    backtestPeriod,
    capital,
    dataSource,
    errorMessage,
    handleSearch,
    isLoading,
    riskBadgeClass,
    searchCode,
    selectedStock,
    setBacktestPeriod,
    setCapital,
    setSearchCode,
    setStopLossPercent,
    setStrategyType,
    setTakeProfitPercent,
    stopLossPercent,
    strategyOptions,
    strategyType,
    takeProfitPercent,
    optimizedStrategy,
    optimizerSummary,
  } = props;

  return (
    <aside className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Scanner</div>
            <h3 className="mt-2 flex items-center gap-2 font-mono text-base text-foreground">
              <Search className="h-4 w-4 text-primary" />
              {zh.scanner}
            </h3>
          </div>
          <div className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${riskBadgeClass}`}>
            {dataSource === 'live' ? 'LIVE' : 'FALLBACK'}
          </div>
        </div>

        <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{zh.code}</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchCode}
            onChange={(event) => setSearchCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setStrategyType('adaptive_composite_e');
                void handleSearch(searchCode, 'adaptive_composite_e');
              }
            }}
            placeholder={zh.placeholder}
            className="h-11 w-full rounded-md border border-border bg-secondary pl-10 pr-4 font-mono text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSearch(searchCode, strategyType)}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-mono text-[12px] uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110"
        >
          <CandlestickChart className="h-4 w-4" />
          {isLoading ? zh.loading : zh.runAnalysis}
        </button>

        {errorMessage ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-[#ff3366]/30 bg-[#ff3366]/8 px-3 py-2 text-xs text-[#ffb1c2]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <div className="mt-5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{zh.pool}</div>
          <div className="grid grid-cols-2 gap-2">
            {stockDatabase.map((stock) => (
              <button
                key={stock.code}
                type="button"
                onClick={() => {
                  setSearchCode(stock.code);
                  setStrategyType('adaptive_composite_e');
                  void handleSearch(stock.code, 'adaptive_composite_e');
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
          {zh.params}
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{zh.strategyType}</div>
            <select
              value={strategyType}
              onChange={(event) => setStrategyType(event.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none"
            >
              {strategyOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {strategyType === 'adaptive_composite_e' && optimizedStrategy ? (
              <div className="mt-3 rounded-md border border-primary/20 bg-primary/8 px-3 py-3 text-xs text-muted-foreground">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">{zh.optimizedHint}</div>
                <div className="mt-2 text-foreground">{optimizedStrategy.strategyName}</div>
                <div className="mt-1">{zh.baseModel}{': '}{optimizedStrategy.baseModelName}</div>
                {!optimizedStrategy.isOptimized ? (
                  <div className="mt-2 text-[#ffaa00]">{zh.optimizedFallback}</div>
                ) : null}
                <div className="mt-1">
                  {zh.improveWinRate}{': '}
                  <span className={optimizedStrategy.improvement.winRateDelta >= 0 ? 'text-[#00ff88]' : 'text-[#ff3366]'}>
                    {optimizedStrategy.improvement.winRateDelta >= 0 ? '+' : ''}
                    {optimizedStrategy.improvement.winRateDelta.toFixed(2)}%
                  </span>
                </div>
                <div className="mt-1">
                  {zh.improveReturn}{': '}
                  <span className={optimizedStrategy.improvement.annualReturnDelta >= 0 ? 'text-[#00ff88]' : 'text-[#ff3366]'}>
                    {optimizedStrategy.improvement.annualReturnDelta >= 0 ? '+' : ''}
                    {optimizedStrategy.improvement.annualReturnDelta.toFixed(2)}%
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{zh.period}</div>
            <select
              value={backtestPeriod}
              onChange={(event) => setBacktestPeriod(event.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none"
            >
              <option>{zh.recent3m}</option>
              <option>{zh.recent6m}</option>
              <option>{zh.recent1y}</option>
              <option>{zh.recent3y}</option>
            </select>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
              <span>{zh.capital}</span>
              <span className="text-primary">{capital}?</span>
            </div>
            <input type="range" min="10" max="500" value={capital} onChange={(event) => setCapital(Number(event.target.value))} className="h-1 w-full cursor-pointer appearance-none rounded bg-border" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
              <span>{zh.stopLoss}</span>
              <span className="text-[#ff3366]">-{stopLossPercent}%</span>
            </div>
            <input type="range" min="2" max="20" value={stopLossPercent} onChange={(event) => setStopLossPercent(Number(event.target.value))} className="h-1 w-full cursor-pointer appearance-none rounded bg-border" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
              <span>{zh.takeProfit}</span>
              <span className="text-[#00ff88]">+{takeProfitPercent}%</span>
            </div>
            <input type="range" min="5" max="50" value={takeProfitPercent} onChange={(event) => setTakeProfitPercent(Number(event.target.value))} className="h-1 w-full cursor-pointer appearance-none rounded bg-border" />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleSearch(searchCode, strategyType)}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-mono text-[12px] uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110"
        >
          {zh.runBacktest}
        </button>

        {optimizerSummary?.bestConfig && optimizerSummary.bestResult ? (
          <div className="mt-4 rounded-md border border-border bg-secondary/40 px-3 py-3 text-xs text-muted-foreground">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">{zh.scanStats}</div>
            <div className="mt-2">{zh.stockType}{': '}{optimizerSummary.stockType}</div>
            <div className="mt-1">{zh.bestConfig}{': '}capture={optimizerSummary.bestConfig.minZoneCapture}, fwd={optimizerSummary.bestConfig.zoneForward}, bwd={optimizerSummary.bestConfig.zoneBackward}</div>
            <div className="mt-1">{zh.envFilter}{': '}{optimizerSummary.bestConfig.envFilter}</div>
            <div className="mt-2">{zh.scanReturn}{': '}<span className="text-[#00ff88]">{(optimizerSummary.bestResult.avgReturn * 100).toFixed(2)}%</span></div>
            <div className="mt-1">{zh.scanStopLoss}{': '}<span className="text-foreground">{(optimizerSummary.bestResult.stopLossRate * 100).toFixed(1)}%</span></div>
            <div className="mt-1">{zh.scanTrades}{': '}<span className="text-foreground">{optimizerSummary.bestResult.totalTrades}</span></div>
            <div className="mt-1">{zh.scanValid}{': '}<span className="text-foreground">{optimizerSummary.stats.validCombinations}/{optimizerSummary.stats.totalCombinations}</span></div>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
