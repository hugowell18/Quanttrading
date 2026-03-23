import { useEffect, useState } from 'react';

interface StockSummary {
  code: string;
  name: string;
  sector: string;
  bestResult: {
    avgReturn: number;
    winRate: number;
    stopLossRate: number;
    totalTrades: number;
    maxDrawdown: number;
  };
  bestConfig: {
    envFilter: string;
  };
  validCombinations: number;
}

interface BatchSummaryResponse {
  strictPassed?: StockSummary[];
}

interface Props {
  onSelectStock: (code: string, name: string) => void;
}

export function StockLeaderboard({ onSelectStock }: Props) {
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3030/api/tushare/batch/summary')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<BatchSummaryResponse>;
      })
      .then((data) => {
        setStocks(data.strictPassed ?? []);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card">
        <div className="animate-pulse font-mono text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">
        加载失败：{error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
          <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
          可交易标的池
        </div>
        <span className="rounded border border-primary/20 bg-primary/10 px-2 py-[2px] font-mono text-[10px] text-primary">
          {stocks.length} 只严格通过
        </span>
      </div>

      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        <span>股票</span>
        <span className="text-right">平均收益</span>
        <span className="text-right">胜率</span>
        <span className="text-right">止损率</span>
        <span className="text-right">交易数</span>
        <span className="text-right">有效组合</span>
      </div>

      {stocks.map((stock) => {
        const metrics = stock.bestResult;
        const returnClass =
          metrics.avgReturn >= 0.05 ? 'text-emerald-400' : metrics.avgReturn >= 0.02 ? 'text-primary' : 'text-amber-400';
        const winRateClass =
          metrics.winRate >= 0.7 ? 'text-emerald-400' : metrics.winRate >= 0.6 ? 'text-primary' : 'text-foreground';
        const stopLossClass =
          metrics.stopLossRate < 0.15 ? 'text-emerald-400' : metrics.stopLossRate < 0.25 ? 'text-primary' : 'text-amber-400';

        return (
          <button
            key={stock.code}
            type="button"
            onClick={() => onSelectStock(stock.code, stock.name)}
            className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 rounded-lg border border-border bg-card px-3 py-3 text-left transition-all duration-150 hover:border-primary/30 hover:bg-secondary/40"
          >
            <div>
              <div className="font-mono text-[11px] text-primary">{stock.code}</div>
              <div className="mt-[2px] text-[12px] text-foreground">{stock.name}</div>
              <div className="mt-[1px] font-mono text-[10px] text-muted-foreground">{stock.sector}</div>
            </div>

            <div className="self-center text-right">
              <span className={`font-mono text-[14px] font-bold ${returnClass}`}>+{(metrics.avgReturn * 100).toFixed(1)}%</span>
            </div>

            <div className="self-center text-right">
              <span className={`font-mono text-[13px] font-bold ${winRateClass}`}>{(metrics.winRate * 100).toFixed(0)}%</span>
            </div>

            <div className="self-center text-right">
              <span className={`font-mono text-[13px] ${stopLossClass}`}>{(metrics.stopLossRate * 100).toFixed(0)}%</span>
            </div>

            <div className="self-center text-right">
              <span className="font-mono text-[13px] text-foreground">{metrics.totalTrades}</span>
            </div>

            <div className="self-center text-right">
              <span className="font-mono text-[11px] text-muted-foreground">{stock.validCombinations}/180</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
