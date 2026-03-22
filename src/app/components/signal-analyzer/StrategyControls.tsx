import { AlertCircle, CandlestickChart, Search, SlidersHorizontal } from 'lucide-react';
import { stockDatabase, type StockItem } from './types';

type StrategyControlsProps = {
  backtestPeriod: string;
  capital: number;
  dataSource: 'live' | 'fallback';
  errorMessage: string;
  handleSearch: (nextCode?: string) => Promise<void>;
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
  strategyType: string;
  takeProfitPercent: number;
};

export function StrategyControls({
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
  strategyType,
  takeProfitPercent,
}: StrategyControlsProps) {
  return (
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
          <div className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${riskBadgeClass}`}>
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
                void handleSearch(searchCode);
              }
            }}
            placeholder="输入股票代码，例如 600519"
            className="h-11 w-full rounded-md border border-border bg-secondary pl-10 pr-4 font-mono text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSearch(searchCode)}
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
                  void handleSearch(stock.code);
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
          onClick={() => void handleSearch(searchCode)}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-mono text-[12px] uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110"
        >
          ▶ 运行回测
        </button>
      </section>
    </aside>
  );
}
