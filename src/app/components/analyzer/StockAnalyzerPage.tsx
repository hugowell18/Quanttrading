import { useEffect, useRef, useState } from 'react';
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
  currentSignal?: { signal: 'buy' | 'sell' | 'hold'; confidence: number; date?: string; score?: number; threshold?: number } | null;
  bestConfig?: Record<string, unknown>;
  bestResult?: {
    avgReturn: number;
    winRate: number;
    stopLossRate: number;
    totalTrades: number;
    maxDrawdown: number;
    avgStopLossPct?: number;
    buyCount?: number;
    skippedByEnvironment?: number;
    skippedByMarket?: number;
    trades?: AnalyzeTrade[];
    [key: string]: unknown;
  };
  strictPass?: boolean;
  kline?: KLinePoint[];
}

interface HistoryEntry {
  code: string;
  name: string;
  winRate: number;
  avgReturn: number;
  timestamp: number;
  result: AnalyzeResult;
  kline: KLinePoint[];
  markers: SignalMarker[];
}

// ─── Helpers ───────────────────────────────────────────────

const HISTORY_KEY = 'stock_analyzer_history_v2';
const MAX_HISTORY = 20;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch { return []; }
}

function saveToHistory(entry: HistoryEntry) {
  const list = loadHistory().filter(h => h.code !== entry.code);
  list.unshift(entry);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function removeFromHistory(code: string) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory().filter(h => h.code !== code)));
}

function formatTimeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

/** Extract and normalize OOS trades from raw API response */
function extractOosTrades(raw: any): AnalyzeTrade[] {
  const br = raw?.bestResult;
  if (!br) return [];
  // Flat format (from batch summary fast path): bestResult.trades directly
  if (Array.isArray(br.trades)) {
    return [...br.trades].sort((a, b) => b.buyDate.localeCompare(a.buyDate));
  }
  // Nested format (from optimizer slow path): validation/stress/final
  const v: AnalyzeTrade[] = br.validation?.trades ?? [];
  const s: AnalyzeTrade[] = br.stress?.trades ?? [];
  const f: AnalyzeTrade[] = Array.isArray(br.final?.trades) ? br.final.trades : [];
  return [...v, ...s, ...f].sort((a, b) => b.buyDate.localeCompare(a.buyDate));
}

/** Build normalized bestResult for display */
function buildBestResult(raw: any, trades: AnalyzeTrade[]): AnalyzeResult['bestResult'] {
  const br = raw?.bestResult;
  if (!br) return { avgReturn: 0, winRate: 0, stopLossRate: 0, totalTrades: 0, maxDrawdown: 0, trades };
  // Flat format — keep all original fields, just replace trades with sorted version
  if (typeof br.winRate === 'number' && typeof br.avgReturn === 'number') {
    return { ...br, totalTrades: trades.length, trades };
  }
  // Nested format — compute from validation
  const vv = br.validation;
  if (!vv) return { avgReturn: 0, winRate: 0, stopLossRate: 0, totalTrades: 0, maxDrawdown: 0, trades };
  const wins = trades.filter(t => t.return > 0);
  return {
    ...vv,
    avgReturn: trades.length ? trades.reduce((s, t) => s + t.return, 0) / trades.length : (vv.avgReturn ?? 0),
    winRate: trades.length ? wins.length / trades.length : (vv.winRate ?? 0),
    stopLossRate: vv.stopLossRate ?? 0,
    totalTrades: trades.length,
    maxDrawdown: Math.min(vv.maxDrawdown ?? 0, br?.stress?.maxDrawdown ?? 0),
    trades,
  };
}

// ─── Summary Card ──────────────────────────────────────────

function SummaryCard({ result }: { result: AnalyzeResult }) {
  const best = result.bestResult;
  if (!best) return null;
  const trades = best.trades ?? [];
  const wins = trades.filter(t => t.return > 0);
  const losses = trades.filter(t => t.return <= 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.return, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.return, 0) / losses.length) : 0;
  const pf = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99 : 0;

  const stat = (label: string, value: string, color = 'text-foreground') => (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-[15px] font-bold ${color}`}>{value}</div>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        OOS 回测汇总
        <span className="ml-2 text-[10px] text-muted-foreground/60">验证集 + 压测集</span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stat('交易次数', String(trades.length))}
        {stat('胜率', `${(best.winRate * 100).toFixed(1)}%`, best.winRate >= 0.5 ? 'text-[#00ff88]' : 'text-[#ff3366]')}
        {stat('均收益', `${best.avgReturn >= 0 ? '+' : ''}${(best.avgReturn * 100).toFixed(2)}%`, best.avgReturn >= 0 ? 'text-[#00ff88]' : 'text-[#ff3366]')}
        {stat('盈亏比', pf.toFixed(2), pf >= 1 ? 'text-[#00ff88]' : 'text-[#ff3366]')}
        {stat('最大回撤', `${(Math.abs(best.maxDrawdown ?? 0) * 100).toFixed(1)}%`, 'text-amber-400')}
        {stat('止损率', `${((best.stopLossRate ?? 0) * 100).toFixed(1)}%`, 'text-muted-foreground')}
      </div>
    </div>
  );
}

// ─── Exit Badge ────────────────────────────────────────────

function ExitBadge({ reason }: { reason: string }) {
  const r = reason.trim();
  if (r.includes('止盈') || r === 'take_profit' || r === 'tp')
    return <Badge className="border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] font-mono text-[9px] px-1.5 py-0.5">止盈</Badge>;
  if (r.includes('止损') || r === 'stop_loss' || r === 'sl' || r === 'stopLoss')
    return <Badge className="border-[#ff3366]/40 bg-[#ff3366]/10 text-[#ff3366] font-mono text-[9px] px-1.5 py-0.5">止损</Badge>;
  if (r.includes('超时') || r === 'timeout' || r === 'time_stop')
    return <Badge className="border-orange-500/40 bg-orange-500/10 text-orange-400 font-mono text-[9px] px-1.5 py-0.5">超时强平</Badge>;
  if (r.includes('卖点') || r === 'sellSignal')
    return <Badge className="border-blue-500/40 bg-blue-500/10 text-blue-400 font-mono text-[9px] px-1.5 py-0.5">卖点出场</Badge>;
  return <Badge className="border-border bg-secondary/50 text-muted-foreground font-mono text-[9px] px-1.5 py-0.5">{r}</Badge>;
}

// ─── Trade Ledger ──────────────────────────────────────────

function TradeLedger({ trades }: { trades: AnalyzeTrade[] }) {
  if (trades.length === 0) return (
    <div className="rounded-lg border border-border bg-card p-5 text-center font-mono text-[12px] text-muted-foreground">
      暂无交易记录
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        交易账本（{trades.length} 笔，按时间降序）
      </div>
      {trades.map((t, i) => {
        const profit = t.return >= 0;
        const net = ((t.return - 0.007) * 100).toFixed(2);
        return (
          <div key={`${t.buyDate}-${i}`} className={`rounded-lg border border-border p-3 ${profit ? 'bg-[#00ff88]/5' : 'bg-[#ff3366]/5'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] text-muted-foreground">#{trades.length - i}</span>
              <div className="flex items-center gap-1.5">
                <ExitBadge reason={t.exitReason} />
                <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${profit ? 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' : 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]'}`}>
                  {profit ? '盈利' : '亏损'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="rounded border border-border bg-card/50 p-2">
                <div className="text-[10px] text-muted-foreground">买入</div>
                <div className="text-foreground">{t.buyDate}</div>
                <div className="font-bold text-[#ff3366]">¥{t.buyPrice.toFixed(2)}</div>
              </div>
              <div className="rounded border border-border bg-card/50 p-2">
                <div className="text-[10px] text-muted-foreground">卖出</div>
                <div className="text-foreground">{t.sellDate}</div>
                <div className="font-bold text-[#00ff88]">¥{t.sellPrice.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-2 flex gap-4 font-mono text-[11px] text-muted-foreground">
              <span>净收益：<span className={profit ? 'text-[#00ff88]' : 'text-[#ff3366]'}>{Number(net) >= 0 ? '+' : ''}{net}%</span></span>
              <span>持仓：<span className="text-foreground">{t.holdingDays}天</span></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export function StockAnalyzerPage() {
  const { selectedStock, pushDebugLog } = useAppContext();

  const [inputCode, setInputCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [klineData, setKlineData] = useState<KLinePoint[]>([]);
  const [signalMarkers, setSignalMarkers] = useState<SignalMarker[]>([]);
  const [stockName, setStockName] = useState('');

  // Ref to track what's currently being analyzed — avoids stale closure issues
  const analyzingRef = useRef<string>('');
  // Ref to track last completed analysis — avoids re-triggering same code
  const lastDoneRef = useRef<string>('');

  // Timer
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const t = window.setInterval(() => setElapsed(v => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [loading]);

  // ─── Core analyze function (no useCallback to avoid stale closure) ──────

  const analyze = async (targetCode: string, refresh = false) => {
    const code = targetCode.trim();
    if (!/^\d{6}$/.test(code)) return;
    if (!refresh && lastDoneRef.current === code) return;

    analyzingRef.current = code;
    setLoading(true);
    setError(null);
    setShowHistory(false);

    pushDebugLog({ level: 'info', module: 'StockAnalyzer', message: refresh ? '强制刷新分析（实时信号）' : '发起分析请求', payload: { code, timestamp: new Date().toISOString() } });

    try {
      const url = `http://localhost:3001/api/analyze/${code}${refresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      // If user switched to another code while this was running, discard result
      if (analyzingRef.current !== code) return;

      const raw = json?.data ?? json;
      const trades = extractOosTrades(raw);
      const bestResult = buildBestResult(raw, trades);
      const kline: KLinePoint[] = raw.kline ?? [];
      const markers: SignalMarker[] = trades.flatMap(t => [
        { date: t.buyDate, type: 'buy' as const, price: t.buyPrice, label: 'B' as const },
        { date: t.sellDate, type: 'sell' as const, price: t.sellPrice, label: 'S' as const },
      ]);

      const result: AnalyzeResult = { ...raw, bestResult };

      setAnalyzeResult(result);
      setKlineData(kline);
      setSignalMarkers(markers);
      setStockName(raw.stockName ?? code);
      lastDoneRef.current = code;

      const entry: HistoryEntry = {
        code: raw.stockCode ?? code,
        name: raw.stockName ?? code,
        winRate: bestResult?.winRate ?? 0,
        avgReturn: bestResult?.avgReturn ?? 0,
        timestamp: Date.now(),
        result,
        kline,
        markers,
      };
      saveToHistory(entry);
      setHistory(loadHistory());
    } catch (err) {
      if (analyzingRef.current !== code) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      pushDebugLog({ level: 'error', module: 'StockAnalyzer', message: '分析请求失败', payload: { code, error: msg } });
    } finally {
      if (analyzingRef.current === code) setLoading(false);
    }
  };

  // Listen to AppContext.selectedStock
  useEffect(() => {
    if (!selectedStock) return;
    if (lastDoneRef.current === selectedStock) return;
    setInputCode(selectedStock);
    void analyze(selectedStock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStock]);

  const loadFromHistory = (entry: HistoryEntry) => {
    // Mark as done so selectedStock effect won't re-trigger
    lastDoneRef.current = entry.code;
    analyzingRef.current = entry.code;
    setInputCode(entry.code);
    setStockName(entry.name);
    setAnalyzeResult(entry.result);
    setKlineData(entry.kline);
    setSignalMarkers(entry.markers);
    setError(null);
    setShowHistory(false);
  };

  const hasResult = analyzeResult !== null && !loading;

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Input bar */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-card px-4 py-2 font-mono text-sm text-foreground outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
          placeholder="输入股票代码，如 600519"
          value={inputCode}
          onChange={e => setInputCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { lastDoneRef.current = ''; void analyze(inputCode); } }}
        />
        <button
          type="button"
          onClick={() => { lastDoneRef.current = ''; void analyze(inputCode); }}
          disabled={loading}
          className="rounded-md bg-primary px-5 py-2 font-mono text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(0,212,255,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? `分析中 ${elapsed}s...` : '分析'}
        </button>
        {/* Refresh button — forces re-run of optimizer for real-time signal */}
        {analyzeResult && !loading && (
          <button
            type="button"
            onClick={() => { lastDoneRef.current = ''; void analyze(inputCode, true); }}
            title="强制重新分析，获取最新实时信号（较慢）"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-400 transition-all hover:bg-amber-500/20 hover:border-amber-500/60"
          >
            ↻ 刷新实时信号
          </button>
        )}
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`rounded-md border px-3 py-2 font-mono text-xs transition-all ${showHistory ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/50'}`}
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
            {history.map(entry => (
              <div
                key={entry.code}
                className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-all hover:bg-secondary/60"
                onClick={() => loadFromHistory(entry)}
              >
                <span className="w-[52px] font-mono text-[12px] font-bold text-foreground">{entry.code}</span>
                <span className="w-[72px] truncate font-mono text-[11px] text-muted-foreground">{entry.name}</span>
                <span className="font-mono text-[11px] text-primary">{(entry.winRate * 100).toFixed(0)}%</span>
                <span className={`font-mono text-[11px] ${entry.avgReturn >= 0 ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                  {entry.avgReturn >= 0 ? '+' : ''}{(entry.avgReturn * 100).toFixed(1)}%
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{formatTimeAgo(entry.timestamp)}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeFromHistory(entry.code); setHistory(loadHistory()); }}
                  className="ml-1 hidden rounded px-1 text-[10px] text-muted-foreground/40 hover:bg-destructive/20 hover:text-destructive group-hover:inline-block"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <div className="font-mono text-sm text-muted-foreground">量化分析中... {elapsed}s</div>
          <div className="h-[2px] w-full overflow-hidden rounded bg-secondary">
            <div className="h-full animate-pulse bg-primary" style={{ width: `${Math.min(100, Math.max(10, elapsed * 2))}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">{error}</div>
      )}

      {/* Results */}
      {hasResult && (
        <div className="flex flex-col gap-4">
          <FactorCheckCard analyzeResult={analyzeResult} />
          <SummaryCard result={analyzeResult} />
          {klineData.length > 0
            ? <KLineChart klineData={klineData} signalMarkers={signalMarkers} stockCode={analyzeResult.stockCode} stockName={stockName || analyzeResult.stockCode} />
            : <div className="rounded-lg border border-border bg-card p-6 text-center font-mono text-[12px] text-muted-foreground">K线数据加载中或暂无数据</div>
          }
          <TradeLedger trades={analyzeResult.bestResult?.trades ?? []} />
        </div>
      )}
    </div>
  );
}
