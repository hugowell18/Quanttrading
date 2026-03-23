import { useCallback, useEffect, useState } from 'react';

interface CurrentSignal {
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  score: number;
  threshold: number;
  reason: string;
  date: string;
  close: number;
  isBuyZone: boolean;
  isSellZone: boolean;
}

interface AnalyzeResult {
  stockCode: string;
  stockType: string;
  currentSignal: CurrentSignal;
  bestConfig: {
    minZoneCapture: number;
    zoneForward: number;
    zoneBackward: number;
    envFilter: string;
  };
  bestResult: {
    avgReturn: number;
    winRate: number;
    stopLossRate: number;
    totalTrades: number;
    maxDrawdown: number;
  };
  stats: {
    validCombinations: number;
    scanDurationMs: number;
  };
}

interface Props {
  initialCode?: string;
  initialName?: string;
  onResolvedStock?: (code: string, name: string) => void;
}

const SIGNAL_CONFIG = {
  buy: { label: '买入', colorClass: 'text-rose-400', bgClass: 'bg-rose-500/10', borderClass: 'border-rose-500/30' },
  sell: { label: '卖出', colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10', borderClass: 'border-emerald-500/30' },
  hold: { label: '观望', colorClass: 'text-amber-400', bgClass: 'bg-amber-500/10', borderClass: 'border-amber-500/30' },
} as const;

export function StockAnalyzer({ initialCode = '', initialName = '', onResolvedStock }: Props) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setCode(initialCode);
    setName(initialName);
  }, [initialCode, initialName]);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return undefined;
    }
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const analyze = useCallback(async (targetCode: string, targetName?: string) => {
    if (!targetCode.trim()) {
      return;
    }
    if (targetName) {
      setName(targetName);
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`http://localhost:3030/api/tushare/optimizer/${targetCode.trim()}?period=3y`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as AnalyzeResult;
      setResult(data);
      onResolvedStock?.(data.stockCode, targetName || data.stockCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [onResolvedStock]);

  useEffect(() => {
    if (initialCode) {
      void analyze(initialCode, initialName);
    }
  }, [analyze, initialCode, initialName]);

  const signal = result?.currentSignal;
  const signalConfig = SIGNAL_CONFIG[signal?.signal ?? 'hold'];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-card px-4 py-2 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
          placeholder="输入股票代码，如 600519"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void analyze(code);
            }
          }}
        />
        <button
          type="button"
          onClick={() => void analyze(code)}
          disabled={loading}
          className="rounded-md bg-primary px-5 py-2 font-mono text-sm font-bold text-primary-foreground transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(0,212,255,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '扫描中...' : '分析'}
        </button>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <div className="font-mono text-sm text-muted-foreground">正在扫描 180 组参数配置...</div>
          <div className="font-mono text-[11px] text-muted-foreground">已用时 {elapsed}s，预计约 45s</div>
          <div className="h-[2px] w-full overflow-hidden rounded bg-secondary">
            <div className="h-full animate-pulse bg-primary" style={{ width: `${Math.min(100, Math.max(15, elapsed * 2))}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">
          {error}
        </div>
      )}

      {result && !loading && (
        <>
          <div className={`rounded-lg border p-5 ${signalConfig.bgClass} ${signalConfig.borderClass}`}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">当前信号 · {signal?.date}</span>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {result.stockCode} ? {name || result.stockCode} ? <span className="text-primary">{result.stockType}</span>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-[28px] font-bold ${signalConfig.colorClass}`}>{signalConfig.label}</div>
                <div className={`mt-1 font-mono text-[12px] ${signalConfig.colorClass}`}>置信度 {((signal?.confidence ?? 0) * 100).toFixed(0)}%</div>
              </div>
            </div>

            <div className="mb-3 h-[3px] overflow-hidden rounded bg-border/50">
              <div
                className={`h-full rounded transition-all duration-500 ${signal?.signal === 'buy' ? 'bg-rose-400' : signal?.signal === 'sell' ? 'bg-emerald-400' : 'bg-amber-400'}`}
                style={{ width: `${(signal?.confidence ?? 0) * 100}%` }}
              />
            </div>

            <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">{signal?.reason}</div>

            {signal?.close !== undefined && (
              <div className="mt-3 font-mono text-[12px] text-muted-foreground">
                最新收盘价：<span className="font-bold text-foreground">¥{signal.close.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
            {[
              { label: '平均收益', value: `+${(result.bestResult.avgReturn * 100).toFixed(1)}%`, colorClass: 'text-rose-400' },
              { label: '胜率', value: `${(result.bestResult.winRate * 100).toFixed(0)}%`, colorClass: 'text-primary' },
              { label: '止损率', value: `${(result.bestResult.stopLossRate * 100).toFixed(0)}%`, colorClass: 'text-emerald-400' },
              { label: '交易数', value: `${result.bestResult.totalTrades}`, colorClass: 'text-amber-400' },
              { label: '最大回撤', value: `${(result.bestResult.maxDrawdown * 100).toFixed(1)}%`, colorClass: 'text-slate-400' },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border bg-card p-3 text-center">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{metric.label}</div>
                <div className={`font-mono text-[18px] font-bold ${metric.colorClass}`}>{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
              <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
              最优配置
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {[
                { key: 'minZoneCapture', value: result.bestConfig.minZoneCapture },
                { key: 'zoneForward', value: result.bestConfig.zoneForward },
                { key: 'zoneBackward', value: result.bestConfig.zoneBackward },
                { key: 'envFilter', value: result.bestConfig.envFilter },
              ].map((item) => (
                <div key={item.key} className="flex justify-between rounded bg-secondary/40 px-3 py-2 font-mono text-[12px]">
                  <span className="text-muted-foreground">{item.key}</span>
                  <span className="text-primary">{String(item.value)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-right font-mono text-[10px] text-muted-foreground">
              有效组合 {result.stats.validCombinations}/180 · 耗时 {(result.stats.scanDurationMs / 1000).toFixed(1)}s
            </div>
          </div>
        </>
      )}
    </div>
  );
}
