import { useCallback, useEffect, useState } from 'react';
import { KLineChart } from './signal-analyzer/KLineChart';
import { TradeLedger } from './signal-analyzer/TradeLedger';
import { DebugLogTab } from './signal-analyzer/DebugLogTab';
import { ModelConfigTab } from './signal-analyzer/ModelConfigTab';
import {
  type KLinePoint,
  type SignalMarker,
  type TradeRecord,
  toFetchErrorMessage,
} from './signal-analyzer/types';

// ─── Types ─────────────────────────────────────────────────

type TabId = 'signal' | 'debug' | 'model';

interface AnalyzeResult {
  stockCode: string;
  stockName?: string;
  regime?: string;
  regimeConfidence?: number;
  regimeHistory?: Array<{ date: string; regime: string }>;
  currentSignal?: {
    signal: 'buy' | 'sell' | 'hold';
    confidence: number;
    score?: number;
    threshold?: number;
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
    trades?: Array<{
      buyDate: string;
      sellDate: string;
      buyPrice: number;
      sellPrice: number;
      return: number;
      holdingDays: number;
      confidence: number;
      exitReason: string;
    }>;
  };
  bestModel?: { featureSet: string; model: string; precision: number; recall: number; f1: number };
  plateau?: { passed: boolean; ratio: number; neighborCount: number };
  modelStore?: { action: string; reason: string; version: number; fallbackToVersion?: number };
  usedFallback?: boolean;
  leaderboard?: Array<{
    rank: number;
    config: { minZoneCapture: number; zoneForward: number; zoneBackward: number; envFilter: string };
    bestModel?: { featureSet: string; model: string };
    result: { avgReturn: number; winRate: number; stopLossRate: number; totalTrades: number };
  }>;
  stats?: { totalCombinations?: number; validCombinations: number; scanDurationMs: number };
}

interface HistoryEntry {
  code: string;
  name: string;
  regime: string;
  avgReturn: number;
  winRate: number;
  signal: string;
  timestamp: number;
  optimizerResult: AnalyzeResult;
}

// ─── Constants ─────────────────────────────────────────────

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'signal', label: '信号分析' },
  { id: 'debug', label: 'Debug' },
  { id: 'model', label: '模型配置' },
];

const SIGNAL_CONFIG = {
  buy: { label: '买入', colorClass: 'text-rose-400', bgClass: 'bg-rose-500/10', borderClass: 'border-rose-500/30', barColor: 'bg-rose-400' },
  sell: { label: '卖出', colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10', borderClass: 'border-emerald-500/30', barColor: 'bg-emerald-400' },
  hold: { label: '观望', colorClass: 'text-amber-400', bgClass: 'bg-amber-500/10', borderClass: 'border-amber-500/30', barColor: 'bg-amber-400' },
} as const;

const REGIME_LABELS: Record<string, { label: string; colorClass: string }> = {
  uptrend: { label: '上升趋势', colorClass: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
  downtrend: { label: '下降趋势', colorClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  range: { label: '震荡区间', colorClass: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  breakout: { label: '突破前夕', colorClass: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  high_vol: { label: '高波动', colorClass: 'text-orange-400 border-orange-500/30 bg-orange-500/10' },
};

const HISTORY_KEY = 'quant_dashboard_history';
const MAX_HISTORY = 20;

// ─── History helpers ───────────────────────────────────────

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
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

export function QuantDashboard() {
  // Input state
  const [code, setCode] = useState('');
  const [stockName, setStockName] = useState('');
  const [tab, setTab] = useState<TabId>('signal');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  // Data state
  const [optimizerResult, setOptimizerResult] = useState<AnalyzeResult | null>(null);
  const [klineData, setKlineData] = useState<KLinePoint[]>([]);
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>([]);
  const [signalMarkers, setSignalMarkers] = useState<SignalMarker[]>([]);
  const [requestLog, setRequestLog] = useState<string[]>([]);

  // Timer
  useEffect(() => {
    if (!loading) { setElapsed(0); return undefined; }
    const timer = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  // ─── Analyze ───────────────────────────────────────────

  const analyze = useCallback(async (targetCode: string) => {
    const normalized = targetCode.trim();
    if (!/^\d{6}$/.test(normalized)) return;

    setLoading(true);
    setError(null);
    setTab('signal');
    setShowHistory(false);
    setRequestLog((cur) => [`[request] stock=${normalized} period=3y`, ...cur].slice(0, 12));

    try {
      // Parallel fetch: K-line data + optimizer
      const [stockRes, optimizerRes] = await Promise.all([
        fetch(`http://localhost:3030/api/tushare/stock/${normalized}?period=3y&strategyMode=adaptive_composite_e`),
        fetch(`http://localhost:3030/api/tushare/optimizer/${normalized}?period=3y`),
      ]);

      // K-line data
      let candles: KLinePoint[] = [];
      if (stockRes.ok) {
        const stockPayload = await stockRes.json();
        candles = stockPayload.candles ?? [];
        setStockName(stockPayload.stock?.name ?? normalized);
      }

      // Optimizer result
      if (!optimizerRes.ok) throw new Error(`Optimizer HTTP ${optimizerRes.status}`);
      const optPayload = (await optimizerRes.json()) as AnalyzeResult;
      setOptimizerResult(optPayload);
      setStockName((prev) => optPayload.stockName || prev || normalized);

      // K-line: prefer stock API candles, fallback to empty
      if (candles.length > 0) {
        setKlineData(candles);
      } else {
        setKlineData([]);
      }

      // Derive trade records and signal markers from optimizer trades
      const optTrades = optPayload.bestResult?.trades ?? [];
      const derivedTrades: TradeRecord[] = optTrades.map((t, i) => ({
        id: `opt-${t.buyDate}-${i}`,
        buyDate: t.buyDate,
        buyPrice: Number(t.buyPrice.toFixed(2)),
        sellDate: t.sellDate,
        sellPrice: Number(t.sellPrice.toFixed(2)),
        returnPct: Number((t.return * 100).toFixed(2)),
        returnAmount: Number((t.return * 10000).toFixed(2)),
        result: t.return >= 0 ? 'success' as const : 'failure' as const,
      }));
      const derivedMarkers: SignalMarker[] = optTrades.flatMap((t) => [
        { date: t.buyDate, type: 'buy' as const, price: Number(t.buyPrice.toFixed(2)), label: 'B' as const },
        { date: t.sellDate, type: 'sell' as const, price: Number(t.sellPrice.toFixed(2)), label: 'S' as const },
      ]);
      setTradeRecords(derivedTrades.sort((a, b) => b.buyDate.localeCompare(a.buyDate)));
      setSignalMarkers(derivedMarkers);

      // Logs
      setRequestLog((cur) => [
        `[response] source=live stock=${optPayload.stockCode} regime=${optPayload.regime ?? '-'} trades=${optTrades.length}`,
        ...cur,
      ].slice(0, 12));

      // Save to history
      const entry: HistoryEntry = {
        code: optPayload.stockCode,
        name: optPayload.stockName || normalized,
        regime: optPayload.regime || 'unknown',
        avgReturn: optPayload.bestResult?.avgReturn ?? 0,
        winRate: optPayload.bestResult?.winRate ?? 0,
        signal: optPayload.currentSignal?.signal ?? 'hold',
        timestamp: Date.now(),
        optimizerResult: optPayload,
      };
      saveToHistory(entry);
      setHistory(loadHistory());
      setCode(optPayload.stockCode);
    } catch (err) {
      setError(toFetchErrorMessage(err));
      setRequestLog((cur) => [`[error] ${err instanceof Error ? err.message : String(err)}`, ...cur].slice(0, 12));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load most recent history entry on mount
  useEffect(() => {
    const hist = loadHistory();
    if (hist.length > 0) void analyze(hist[0].code);
  }, [analyze]);

  const loadFromHistory = (entry: HistoryEntry) => {
    setCode(entry.code);
    setShowHistory(false);
    void analyze(entry.code);
  };

  // ─── Derived state ────────────────────────────────────

  const signal = optimizerResult?.currentSignal;
  const signalConfig = SIGNAL_CONFIG[signal?.signal ?? 'hold'];
  const regimeInfo = REGIME_LABELS[optimizerResult?.regime ?? ''] ?? { label: optimizerResult?.regime ?? '-', colorClass: 'text-muted-foreground border-border bg-secondary/40' };
  const hasResult = optimizerResult && !loading;

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* ── Input bar ── */}
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
          {loading ? '扫描中...' : '分析'}
        </button>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`rounded-md border px-3 py-2 font-mono text-xs transition-all duration-200 ${showHistory ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
          >
            历史 ({history.length})
          </button>
        )}
      </div>

      {/* ── History panel ── */}
      {showHistory && history.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">分析历史</div>
          <div className="flex flex-col gap-1">
            {history.map((entry) => {
              const eRegime = REGIME_LABELS[entry.regime] ?? { label: entry.regime, colorClass: 'text-muted-foreground' };
              const eSignal = SIGNAL_CONFIG[entry.signal as keyof typeof SIGNAL_CONFIG] ?? SIGNAL_CONFIG.hold;
              return (
                <div key={entry.code} className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-all hover:bg-secondary/60" onClick={() => loadFromHistory(entry)}>
                  <span className="w-[52px] font-mono text-[12px] font-bold text-foreground">{entry.code}</span>
                  <span className="w-[72px] truncate font-mono text-[11px] text-muted-foreground">{entry.name}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${eRegime.colorClass}`}>{eRegime.label}</span>
                  <span className={`font-mono text-[11px] font-bold ${eSignal.colorClass}`}>{eSignal.label}</span>
                  <span className="font-mono text-[11px] text-rose-400">+{(entry.avgReturn * 100).toFixed(1)}%</span>
                  <span className="font-mono text-[11px] text-primary">{(entry.winRate * 100).toFixed(0)}%</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{formatTimeAgo(entry.timestamp)}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeFromHistory(entry.code); setHistory(loadHistory()); }}
                    className="ml-1 hidden rounded px-1 text-[10px] text-muted-foreground/40 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:inline-block">×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <div className="font-mono text-sm text-muted-foreground">Regime 驱动扫描中...</div>
          <div className="font-mono text-[11px] text-muted-foreground">已用时 {elapsed}s</div>
          <div className="h-[2px] w-full overflow-hidden rounded bg-secondary">
            <div className="h-full animate-pulse bg-primary" style={{ width: `${Math.min(100, Math.max(15, elapsed * 3))}%` }} />
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">{error}</div>
      )}

      {/* ── Tabs ── */}
      {hasResult && (
        <>
          <div className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-t-md border-b-2 px-5 py-2 font-mono text-[12px] uppercase tracking-[0.14em] transition ${
                  tab === t.id
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Signal ── */}
          {tab === 'signal' && (
            <div className="flex flex-col gap-4">
              {/* Signal card */}
              <div className={`rounded-lg border p-5 ${signalConfig.bgClass} ${signalConfig.borderClass}`}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">当前信号 · {signal?.date}</span>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span>{optimizerResult.stockCode}</span>
                      <span>·</span>
                      <span>{stockName || optimizerResult.stockCode}</span>
                      <span>·</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${regimeInfo.colorClass}`}>
                        {regimeInfo.label}
                        {optimizerResult.regimeConfidence !== undefined && ` ${(optimizerResult.regimeConfidence * 100).toFixed(0)}%`}
                      </span>
                      {optimizerResult.usedFallback && (
                        <span className="rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[9px] text-orange-400">FALLBACK</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono text-[28px] font-bold ${signalConfig.colorClass}`}>{signalConfig.label}</div>
                    <div className={`mt-1 font-mono text-[12px] ${signalConfig.colorClass}`}>置信度 {((signal?.confidence ?? 0) * 100).toFixed(0)}%</div>
                  </div>
                </div>
                <div className="mb-3 h-[3px] overflow-hidden rounded bg-border/50">
                  <div className={`h-full rounded transition-all duration-500 ${signalConfig.barColor}`} style={{ width: `${(signal?.confidence ?? 0) * 100}%` }} />
                </div>
                <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">{signal?.reason}</div>
                {signal?.close !== undefined && (
                  <div className="mt-3 font-mono text-[12px] text-muted-foreground">
                    最新收盘价：<span className="font-bold text-foreground">¥{signal.close.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Metrics */}
              {optimizerResult.bestResult && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                  {[
                    { label: '平均收益', value: `${optimizerResult.bestResult.avgReturn >= 0 ? '+' : ''}${(optimizerResult.bestResult.avgReturn * 100).toFixed(1)}%`, colorClass: 'text-rose-400' },
                    { label: '胜率', value: `${(optimizerResult.bestResult.winRate * 100).toFixed(0)}%`, colorClass: 'text-primary' },
                    { label: '止损率', value: `${(optimizerResult.bestResult.stopLossRate * 100).toFixed(0)}%`, colorClass: 'text-emerald-400' },
                    { label: '交易数', value: `${optimizerResult.bestResult.totalTrades}`, colorClass: 'text-amber-400' },
                    { label: '最大回撤', value: `${(optimizerResult.bestResult.maxDrawdown * 100).toFixed(1)}%`, colorClass: 'text-slate-400' },
                    { label: 'Sharpe', value: optimizerResult.bestResult.sharpe?.toFixed(2) ?? 'N/A', colorClass: 'text-violet-400' },
                  ].map((m) => (
                    <div key={m.label} className="rounded-lg border border-border bg-card p-3 text-center">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{m.label}</div>
                      <div className={`font-mono text-[18px] font-bold ${m.colorClass}`}>{m.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* K-Line Chart */}
              {klineData.length > 0 && (
                <KLineChart
                  klineData={klineData}
                  signalMarkers={signalMarkers}
                  stockCode={optimizerResult.stockCode}
                  stockName={stockName || optimizerResult.stockCode}
                />
              )}

              {/* Trade Ledger */}
              {tradeRecords.length > 0 && (
                <TradeLedger tradeRecords={tradeRecords} />
              )}
            </div>
          )}

          {/* ── Tab: Debug ── */}
          {tab === 'debug' && (
            <DebugLogTab
              requestLog={requestLog}
              priceView="120"
              tradeCount={tradeRecords.length}
              markerCount={signalMarkers.length}
            />
          )}

          {/* ── Tab: Model Config ── */}
          {tab === 'model' && (
            <ModelConfigTab result={optimizerResult} />
          )}
        </>
      )}
    </div>
  );
}
