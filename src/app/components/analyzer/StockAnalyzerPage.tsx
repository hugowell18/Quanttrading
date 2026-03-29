import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { KLineChart } from '../signal-analyzer/KLineChart';
import { FactorCheckCard } from './FactorCheckCard';
import { Badge } from '../ui/badge';
import type { KLinePoint, SignalMarker } from '../signal-analyzer/types';

// ─── Types ─────────────────────────────────────────────────

interface AnalyzeTrade {
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  return: number;
  holdingDays: number;
  confidence: number;
  exitReason: string;
}

interface AnalyzeResult {
  stockCode: string;
  stockName?: string;
  regime?: string;
  regimeConfidence?: number;
  currentSignal?: {
    signal: 'buy' | 'sell' | 'hold';
    confidence: number;
    reason?: string;
    date?: string;
    close?: number;
  };
  bestConfig?: {
    minZoneCapture: number;
    zoneForward: number;
    zoneBackward: number;
    envFilter: string;
  };
  bestResult?: {
    avgReturn: number;
    winRate: number;
    stopLossRate: number;
    totalTrades: number;
    maxDrawdown: number;
    sharpe?: number;
    trades?: AnalyzeTrade[];
  };
  // Micro-structure indicators
  rsi?: number;
  jValue?: number;
  bollPct?: number;
  profitFactor?: number;
  // K-line data embedded in response
  kline?: KLinePoint[];
}

interface HistoryEntry {
  code: string;
  name: string;
  winRate: number;
  avgReturn: number;
  timestamp: number;
  result: AnalyzeResult;
}

// ─── Exit reason badge ─────────────────────────────────────

type ExitReason = '止盈' | '止损' | '超时强平' | '场景结束' | string;

function ExitBadge({ reason }: { reason: ExitReason }) {
  if (!reason) return null;

  const normalized = reason.trim();

  if (normalized.includes('止盈') || normalized === 'take_profit' || normalized === 'tp') {
    return (
      <Badge className="border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] font-mono text-[9px] px-1.5 py-0.5">
        止盈
      </Badge>
    );
  }
  if (normalized.includes('止损') || normalized === 'stop_loss' || normalized === 'sl') {
    return (
      <Badge className="border-[#ff3366]/40 bg-[#ff3366]/10 text-[#ff3366] font-mono text-[9px] px-1.5 py-0.5">
        止损
      </Badge>
    );
  }
  if (normalized.includes('超时') || normalized === 'timeout' || normalized === 'time_stop') {
    return (
      <Badge className="border-orange-500/40 bg-orange-500/10 text-orange-400 font-mono text-[9px] px-1.5 py-0.5">
        超时强平
      </Badge>
    );
  }
  if (normalized.includes('场景') || normalized === 'end_of_data' || normalized === 'scenario_end') {
    return (
      <Badge className="border-border bg-secondary/50 text-muted-foreground font-mono text-[9px] px-1.5 py-0.5">
        场景结束
      </Badge>
    );
  }
  // Fallback: show raw reason
  return (
    <Badge className="border-border bg-secondary/50 text-muted-foreground font-mono text-[9px] px-1.5 py-0.5">
      {normalized}
    </Badge>
  );
}

// ─── Enhanced TradeLedger ──────────────────────────────────

interface EnhancedTradeLedgerProps {
  trades: AnalyzeTrade[];
}

function isScenarioEnd(exitReason: string): boolean {
  const r = exitReason.trim();
  return r.includes('场景') || r === 'end_of_data' || r === 'scenario_end';
}

function EnhancedTradeLedger({ trades }: EnhancedTradeLedgerProps) {
  if (trades.length === 0) return null;

  const validTrades = trades.filter((t) => !isScenarioEnd(t.exitReason));
  const scenarioTrades = trades.filter((t) => isScenarioEnd(t.exitReason));

  const renderTrade = (t: AnalyzeTrade, index: number, globalIndex: number) => {
    const pnl = t.return;
    const isProfitable = pnl >= 0;
    const rowBg = isProfitable ? 'bg-[#00ff88]/5' : 'bg-[#ff3366]/5';
    const netPnlPct = ((pnl - 0.007) * 100).toFixed(2); // deduct 0.7% friction

    return (
      <div
        key={`${t.buyDate}-${globalIndex}`}
        className={`rounded-lg border border-border p-4 ${rowBg}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            交易 {String(index + 1).padStart(2, '0')}
          </span>
          <div className="flex items-center gap-1.5">
            <ExitBadge reason={t.exitReason} />
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                isProfitable
                  ? 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]'
                  : 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]'
              }`}
            >
              {isProfitable ? '盈利' : '亏损'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-card/50 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">买入</div>
            <div className="mt-1.5 font-mono text-[12px] text-foreground">{t.buyDate}</div>
            <div className="font-mono text-[14px] font-bold text-[#ff3366]">¥{t.buyPrice.toFixed(2)}</div>
          </div>
          <div className="rounded-md border border-border bg-card/50 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">卖出</div>
            <div className="mt-1.5 font-mono text-[12px] text-foreground">{t.sellDate}</div>
            <div className="font-mono text-[14px] font-bold text-[#00ff88]">¥{t.sellPrice.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 font-mono text-[12px]">
          <span className="text-muted-foreground">
            净收益率：
            <span className={isProfitable ? 'text-[#00ff88]' : 'text-[#ff3366]'}>
              {Number(netPnlPct) >= 0 ? '+' : ''}{netPnlPct}%
            </span>
          </span>
          <span className="text-muted-foreground">
            持仓：<span className="text-foreground">{t.holdingDays}天</span>
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">交易账本</div>

      {/* Valid trades group */}
      {validTrades.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            有效交易（{validTrades.length} 笔）
          </div>
          {validTrades.map((t, i) => renderTrade(t, i, i))}
        </div>
      )}

      {/* Scenario-end forced close group */}
      {scenarioTrades.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            场景结束强平（{scenarioTrades.length} 笔）
          </div>
          {scenarioTrades.map((t, i) => renderTrade(t, i, validTrades.length + i))}
        </div>
      )}
    </div>
  );
}

// ─── Constants ─────────────────────────────────────────────

const HISTORY_KEY = 'stock_analyzer_history';
const MAX_HISTORY = 20;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveToHistory(entry: HistoryEntry) {
  const history = loadHistory().filter((h) => h.code !== entry.code);
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function removeFromHistory(code: string) {
  const history = loadHistory().filter((h) => h.code !== code);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

// ─── Main Component ────────────────────────────────────────

export function StockAnalyzerPage() {
  const { selectedStock, pushDebugLog } = useAppContext();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [klineData, setKlineData] = useState<KLinePoint[]>([]);
  const [signalMarkers, setSignalMarkers] = useState<SignalMarker[]>([]);
  const [stockName, setStockName] = useState('');

  // Track last analyzed code to avoid duplicate triggers
  const lastAnalyzedRef = useRef<string>('');

  // Timer
  useEffect(() => {
    if (!loading) { setElapsed(0); return undefined; }
    const timer = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  // ─── Analyze ─────────────────────────────────────────────

  const analyze = useCallback(async (targetCode: string) => {
    const normalized = targetCode.trim();
    if (!/^\d{6}$/.test(normalized)) return;
    if (lastAnalyzedRef.current === normalized && analyzeResult?.stockCode === normalized) return;

    setLoading(true);
    setError(null);
    setShowHistory(false);
    lastAnalyzedRef.current = normalized;

    // Log before request
    pushDebugLog({
      level: 'info',
      module: 'StockAnalyzer',
      message: '发起分析请求',
      payload: { code: normalized, timestamp: new Date().toISOString() },
    });

    try {
      const res = await fetch(`http://localhost:3001/api/analyze/${normalized}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      // Support both { ok: true, data: ... } and direct result
      const result: AnalyzeResult = json?.data ?? json;
      setAnalyzeResult(result);
      setStockName(result.stockName ?? normalized);
      setCode(result.stockCode ?? normalized);

      // K-line data: may be embedded in response or separate field
      const candles: KLinePoint[] = result.kline ?? [];
      setKlineData(candles);

      // Derive signal markers from bestResult.trades
      const trades = result.bestResult?.trades ?? [];
      const markers: SignalMarker[] = trades.flatMap((t) => [
        { date: t.buyDate, type: 'buy' as const, price: t.buyPrice, label: 'B' as const },
        { date: t.sellDate, type: 'sell' as const, price: t.sellPrice, label: 'S' as const },
      ]);
      setSignalMarkers(markers);

      // Save to history
      const entry: HistoryEntry = {
        code: result.stockCode ?? normalized,
        name: result.stockName ?? normalized,
        winRate: result.bestResult?.winRate ?? 0,
        avgReturn: result.bestResult?.avgReturn ?? 0,
        timestamp: Date.now(),
        result,
      };
      saveToHistory(entry);
      setHistory(loadHistory());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      pushDebugLog({
        level: 'error',
        module: 'StockAnalyzer',
        message: '分析请求失败',
        payload: { code: normalized, error: msg },
      });
    } finally {
      setLoading(false);
    }
  }, [analyzeResult, pushDebugLog]);

  // Listen to AppContext.selectedStock — auto-fill and trigger
  useEffect(() => {
    if (!selectedStock) return;
    if (selectedStock === lastAnalyzedRef.current) return;
    setCode(selectedStock);
    void analyze(selectedStock);
  }, [selectedStock, analyze]);

  const loadFromHistory = (entry: HistoryEntry) => {
    setCode(entry.code);
    setStockName(entry.name);
    setAnalyzeResult(entry.result);
    setError(null);
    setShowHistory(false);
    lastAnalyzedRef.current = entry.code;

    const trades = entry.result.bestResult?.trades ?? [];
    setSignalMarkers(trades.flatMap((t) => [
      { date: t.buyDate, type: 'buy' as const, price: t.buyPrice, label: 'B' as const },
      { date: t.sellDate, type: 'sell' as const, price: t.sellPrice, label: 'S' as const },
    ]));
    setKlineData(entry.result.kline ?? []);
  };

  const hasResult = analyzeResult && !loading;

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Input bar */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-card px-4 py-2 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
          placeholder="输入股票代码，如 600519"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void analyze(code); }}
        />
        <button
          type="button"
          onClick={() => void analyze(code)}
          disabled={loading}
          className="rounded-md bg-primary px-5 py-2 font-mono text-sm font-bold text-primary-foreground transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(0,212,255,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '分析中...' : '分析'}
        </button>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`rounded-md border px-3 py-2 font-mono text-xs transition-all duration-200 ${
              showHistory
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
            }`}
          >
            历史 ({history.length})
          </button>
        )}
      </div>

      {/* History panel */}
      {showHistory && history.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">分析历史</div>
          <div className="flex flex-col gap-1">
            {history.map((entry) => (
              <div
                key={entry.code}
                className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-all hover:bg-secondary/60"
                onClick={() => loadFromHistory(entry)}
              >
                <span className="w-[52px] font-mono text-[12px] font-bold text-foreground">{entry.code}</span>
                <span className="w-[72px] truncate font-mono text-[11px] text-muted-foreground">{entry.name}</span>
                <span className="font-mono text-[11px] text-primary">{(entry.winRate * 100).toFixed(0)}%</span>
                <span className="font-mono text-[11px] text-rose-400">
                  {entry.avgReturn >= 0 ? '+' : ''}{(entry.avgReturn * 100).toFixed(1)}%
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{formatTimeAgo(entry.timestamp)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromHistory(entry.code);
                    setHistory(loadHistory());
                  }}
                  className="ml-1 hidden rounded px-1 text-[10px] text-muted-foreground/40 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:inline-block"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <div className="font-mono text-sm text-muted-foreground">量化分析中...</div>
          <div className="font-mono text-[11px] text-muted-foreground">已用时 {elapsed}s</div>
          <div className="h-[2px] w-full overflow-hidden rounded bg-secondary">
            <div
              className="h-full animate-pulse bg-primary"
              style={{ width: `${Math.min(100, Math.max(15, elapsed * 3))}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {hasResult && (
        <div className="flex flex-col gap-4">
          {/* Factor check card */}
          <FactorCheckCard analyzeResult={analyzeResult} />

          {/* K-Line Chart */}
          {klineData.length > 0 && (
            <KLineChart
              klineData={klineData}
              signalMarkers={signalMarkers}
              stockCode={analyzeResult.stockCode}
              stockName={stockName || analyzeResult.stockCode}
            />
          )}

          {/* Enhanced Trade Ledger */}
          {(analyzeResult.bestResult?.trades?.length ?? 0) > 0 && (
            <EnhancedTradeLedger trades={analyzeResult.bestResult!.trades!} />
          )}
        </div>
      )}
    </div>
  );
}
