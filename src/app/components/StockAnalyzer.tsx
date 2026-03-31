import { useCallback, useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────

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
  stockName?: string;
  stockType?: string;
  regime?: string;
  regimeConfidence?: number;
  regimeHistory?: Array<{ date: string; regime: string }>;
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
    sharpe?: number;
  };
  bestModel?: {
    featureSet: string;
    model: string;
    precision: number;
    recall: number;
    f1: number;
  };
  plateau?: { passed: boolean; ratio: number; neighborCount: number };
  modelStore?: { action: string; reason: string; version: number; fallbackToVersion?: number };
  usedFallback?: boolean;
  leaderboard?: Array<{
    rank: number;
    config: { minZoneCapture: number; zoneForward: number; zoneBackward: number; envFilter: string };
    bestModel?: { featureSet: string; model: string };
    result: { avgReturn: number; winRate: number; stopLossRate: number; totalTrades: number };
  }>;
  stats: { totalCombinations?: number; validCombinations: number; scanDurationMs: number };
}

interface HistoryEntry {
  code: string;
  name: string;
  regime: string;
  avgReturn: number;
  winRate: number;
  signal: string;
  timestamp: number;
  result: AnalyzeResult;
}

interface Props {
  initialCode?: string;
  initialName?: string;
  onResolvedStock?: (code: string, name: string) => void;
}

// ─── Helpers ───────────────────────────────────────────────

const HISTORY_KEY = 'stock_analyzer_history';
const MAX_HISTORY = 20;

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
  localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory().filter((h) => h.code !== code)));
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return `${Math.floor(seconds / 86400)}天前`;
}

const SIGNAL_CONFIG = {
  buy:  { label: '买入', color: 'text-[#00ff88]', border: 'border-[#00ff88]/30', bg: 'bg-[#00ff88]/5',  bar: '#00ff88' },
  sell: { label: '卖出', color: 'text-[#ff3366]', border: 'border-[#ff3366]/30', bg: 'bg-[#ff3366]/5',  bar: '#ff3366' },
  hold: { label: '观望', color: 'text-muted-foreground', border: 'border-border', bg: 'bg-card', bar: '#6b7280' },
} as const;

const REGIME_LABELS: Record<string, { label: string; cls: string }> = {
  uptrend:  { label: '上升趋势', cls: 'text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/10' },
  downtrend:{ label: '下降趋势', cls: 'text-[#ff3366] border-[#ff3366]/30 bg-[#ff3366]/10' },
  range:    { label: '震荡区间', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  breakout: { label: '突破前夕', cls: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  high_vol: { label: '高波动',   cls: 'text-orange-400 border-orange-500/30 bg-orange-500/10' },
};

// ─── Layer 1: Signal Hero ──────────────────────────────────

function SignalHero({ result }: { result: AnalyzeResult }) {
  const sig = result.currentSignal;
  const sc  = SIGNAL_CONFIG[sig?.signal ?? 'hold'];
  const ri  = REGIME_LABELS[result.regime ?? ''] ?? { label: result.regime ?? '-', cls: 'text-muted-foreground border-border bg-secondary/40' };
  const br  = result.bestResult;

  return (
    <div className={`rounded-lg border ${sc.border} ${sc.bg} p-5`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">当前信号 · {sig?.date}</div>
          <div className={`mt-1 font-mono text-[38px] font-black leading-none ${sc.color}`}>{sc.label}</div>
          {/* badges */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${ri.cls}`}>{ri.label}</span>
            {result.regimeConfidence !== undefined && (
              <span className="font-mono text-[10px] text-muted-foreground/60">{(result.regimeConfidence * 100).toFixed(0)}%置信</span>
            )}
            {result.usedFallback && (
              <span className="rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 font-mono text-[9px] text-orange-400">FALLBACK</span>
            )}
            {sig?.close !== undefined && (
              <span className="font-mono text-[11px] text-muted-foreground">¥{sig.close.toFixed(2)}</span>
            )}
          </div>
        </div>

        {/* Confidence + key stats */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">信心度</span>
            <span className={`font-mono text-[16px] font-bold ${sc.color}`}>{((sig?.confidence ?? 0) * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 w-[120px] overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(sig?.confidence ?? 0) * 100}%`, backgroundColor: sc.bar }} />
          </div>
          {/* 3 inline stats */}
          <div className="flex gap-2 mt-1">
            {[
              { label: '胜率', val: `${(br.winRate * 100).toFixed(0)}%`, ok: br.winRate >= 0.5 },
              { label: '均收益', val: `${br.avgReturn >= 0 ? '+' : ''}${(br.avgReturn * 100).toFixed(1)}%`, ok: br.avgReturn >= 0 },
              { label: '回撤', val: `-${(Math.abs(br.maxDrawdown) * 100).toFixed(1)}%`, ok: Math.abs(br.maxDrawdown) < 0.2 },
            ].map(({ label, val, ok }) => (
              <div key={label} className="rounded border border-border bg-secondary/30 px-2 py-1 text-center">
                <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
                <div className={`font-mono text-[11px] font-bold ${ok ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="mt-3 h-[2px] overflow-hidden rounded bg-border/40">
        <div className="h-full rounded transition-all duration-500" style={{ width: `${(sig?.confidence ?? 0) * 100}%`, backgroundColor: sc.bar }} />
      </div>

      {/* Reason */}
      {sig?.reason && (
        <div className="mt-3 rounded-md border border-border/40 bg-secondary/20 px-3 py-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
          {sig.reason}
        </div>
      )}
    </div>
  );
}

// ─── Layer 2: Indicator Bars ───────────────────────────────

function IndicatorBar({ label, score, desc }: { label: string; score: number; desc: string }) {
  const s = Math.round(Math.max(0, Math.min(100, score)));
  const color = s >= 65 ? '#00ff88' : s >= 40 ? '#f59e0b' : '#ff3366';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold text-foreground">{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{s}/100</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s}%`, backgroundColor: color }} />
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">{desc}</div>
    </div>
  );
}

function IndicatorBars({ result }: { result: AnalyzeResult }) {
  const br  = result.bestResult;
  const sig = result.currentSignal;

  const modelQuality = Math.round(
    br.winRate * 50 +
    (br.avgReturn > 0 ? Math.min(br.avgReturn * 200, 30) : 0) +
    (br.totalTrades >= 15 ? 20 : br.totalTrades >= 8 ? 12 : br.totalTrades >= 4 ? 6 : 0),
  );
  const modelDesc =
    modelQuality >= 65 ? `胜率 ${(br.winRate * 100).toFixed(0)}%，${br.totalTrades} 笔历史交易，表现良好` :
    modelQuality >= 40 ? `胜率 ${(br.winRate * 100).toFixed(0)}%，信号数量偏少，参考价值有限` :
                         '历史表现不稳定，建议降低仓位权重';

  const sigStrength = Math.round((sig?.confidence ?? 0) * 100);
  const sigDesc =
    sigStrength >= 70 ? '高置信度，模型特征与历史买点高度吻合' :
    sigStrength >= 40 ? '中等置信度，建议配合大盘方向确认' :
                        '低置信度，特征与历史买点差异较大，建议观望';

  const dd = Math.abs(br.maxDrawdown);
  const riskScore = Math.round(Math.max(0, (1 - dd / 0.25) * 100));
  const riskDesc =
    riskScore >= 70 ? `最大回撤 ${(dd * 100).toFixed(1)}%，风险控制良好` :
    riskScore >= 40 ? `最大回撤 ${(dd * 100).toFixed(1)}%，存在一定回撤风险` :
                      `最大回撤 ${(dd * 100).toFixed(1)}%，风险较高，严格控制仓位`;

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">量化指标</div>
      <IndicatorBar label="模型质量" score={modelQuality} desc={modelDesc} />
      <IndicatorBar label="信号强度" score={sigStrength}  desc={sigDesc}   />
      <IndicatorBar label="风险系数" score={riskScore}    desc={riskDesc}  />
    </div>
  );
}

// ─── Layer 3: Technical Details (collapsible) ─────────────

function TechDetails({ result }: { result: AnalyzeResult }) {
  const [open, setOpen] = useState(false);
  const br = result.bestResult;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-secondary/30"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">技术详情</span>
        <span className="font-mono text-[12px] text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-border p-5 flex flex-col gap-4">

          {/* 6 core metrics */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              { label: '平均收益', val: `${br.avgReturn >= 0 ? '+' : ''}${(br.avgReturn * 100).toFixed(1)}%` },
              { label: '胜率',     val: `${(br.winRate * 100).toFixed(0)}%` },
              { label: '止损率',   val: `${(br.stopLossRate * 100).toFixed(0)}%` },
              { label: '交易数',   val: String(br.totalTrades) },
              { label: '最大回撤', val: `${(Math.abs(br.maxDrawdown) * 100).toFixed(1)}%` },
              { label: 'Sharpe',   val: br.sharpe != null ? br.sharpe.toFixed(2) : 'N/A' },
            ].map(({ label, val }) => (
              <div key={label} className="rounded-md border border-border bg-secondary/30 px-2 py-2 text-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
                <div className="mt-0.5 font-mono text-[13px] font-bold text-foreground">{val}</div>
              </div>
            ))}
          </div>

          {/* Three small cards: plateau + model version + best model */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground mb-1">参数高原检验</div>
              {result.plateau ? (
                <>
                  <div className={`font-mono text-[14px] font-bold ${result.plateau.passed ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                    {result.plateau.passed ? '通过' : '未通过'}
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground mt-0.5">邻域比 {result.plateau.ratio} · {result.plateau.neighborCount} 个邻域</div>
                </>
              ) : <div className="font-mono text-[12px] text-muted-foreground">-</div>}
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground mb-1">模型版本</div>
              {result.modelStore ? (
                <>
                  <div className="font-mono text-[14px] font-bold text-primary">v{result.modelStore.version}</div>
                  <div className="font-mono text-[9px] text-muted-foreground mt-0.5">{result.modelStore.action}</div>
                </>
              ) : <div className="font-mono text-[12px] text-muted-foreground">-</div>}
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground mb-1">最优模型</div>
              {result.bestModel ? (
                <>
                  <div className="font-mono text-[13px] font-bold text-primary">{result.bestModel.model}</div>
                  <div className="font-mono text-[9px] text-muted-foreground mt-0.5">{result.bestModel.featureSet} · P{result.bestModel.precision.toFixed(2)}</div>
                </>
              ) : <div className="font-mono text-[12px] text-muted-foreground">-</div>}
            </div>
          </div>

          {/* Best config */}
          <div>
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">最优配置</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {Object.entries(result.bestConfig).map(([k, v]) => (
                <div key={k} className="flex justify-between rounded bg-secondary/30 px-2.5 py-1.5 font-mono text-[11px]">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-primary">{String(v)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-right font-mono text-[9px] text-muted-foreground/60">
              有效 {result.stats.validCombinations}/{result.stats.totalCombinations ?? '?'} · {(result.stats.scanDurationMs / 1000).toFixed(1)}s
            </div>
          </div>

          {/* Regime history */}
          {result.regimeHistory && result.regimeHistory.length > 0 && (
            <div>
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Regime 演变（近8期）</div>
              <div className="flex flex-wrap gap-1">
                {result.regimeHistory.slice(-8).map((item, idx) => {
                  const ri = REGIME_LABELS[item.regime] ?? { label: item.regime, cls: 'text-muted-foreground border-border bg-secondary/40' };
                  return (
                    <div key={idx} className="flex items-center gap-1">
                      {idx > 0 && <span className="font-mono text-[9px] text-muted-foreground/40">→</span>}
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${ri.cls}`}>{item.date.slice(5)} {ri.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Leaderboard top 5 */}
          {result.leaderboard && result.leaderboard.length > 1 && (
            <div>
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">配置排行 Top {Math.min(5, result.leaderboard.length)}</div>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-1.5 pr-3">#</th>
                      <th className="pb-1.5 pr-3">cap</th>
                      <th className="pb-1.5 pr-3">fwd</th>
                      <th className="pb-1.5 pr-3">bwd</th>
                      <th className="pb-1.5 pr-3">env</th>
                      <th className="pb-1.5 pr-3 text-right">收益</th>
                      <th className="pb-1.5 text-right">胜率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.leaderboard.slice(0, 5).map((item) => (
                      <tr key={item.rank} className={`border-b border-border/20 ${item.rank === 1 ? 'text-primary' : 'text-foreground'}`}>
                        <td className="py-1 pr-3">{item.rank}</td>
                        <td className="py-1 pr-3">{item.config.minZoneCapture}</td>
                        <td className="py-1 pr-3">{item.config.zoneForward}</td>
                        <td className="py-1 pr-3">{item.config.zoneBackward}</td>
                        <td className="py-1 pr-3">{item.config.envFilter}</td>
                        <td className="py-1 pr-3 text-right text-[#00ff88]">{(item.result.avgReturn * 100).toFixed(2)}%</td>
                        <td className="py-1 text-right">{(item.result.winRate * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Model store note */}
          {result.modelStore?.reason && (
            <div className="rounded border border-border/40 bg-secondary/10 px-3 py-2 font-mono text-[9px] text-muted-foreground">
              <span className="mr-2 uppercase tracking-[0.1em]">模型存储</span>{result.modelStore.reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export function StockAnalyzer({ initialCode = '', initialName = '', onResolvedStock }: Props) {
  const [code, setCode]           = useState(initialCode);
  const [name, setName]           = useState(initialName);
  const [result, setResult]       = useState<AnalyzeResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [elapsed, setElapsed]     = useState(0);
  const [history, setHistory]     = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { setCode(initialCode); setName(initialName); }, [initialCode, initialName]);

  useEffect(() => {
    if (!loading) { setElapsed(0); return undefined; }
    const t = window.setInterval(() => setElapsed(v => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [loading]);

  const analyze = useCallback(async (targetCode: string, targetName?: string) => {
    if (!targetCode.trim()) return;
    if (targetName) setName(targetName);
    setLoading(true);
    setError(null);
    setResult(null);
    setShowHistory(false);

    try {
      const res = await fetch(`http://localhost:3030/api/tushare/optimizer/${targetCode.trim()}?period=3y`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AnalyzeResult;
      setResult(data);
      onResolvedStock?.(data.stockCode, targetName || data.stockName || data.stockCode);
      saveToHistory({ code: data.stockCode, name: data.stockName || targetName || data.stockCode, regime: data.regime || 'unknown', avgReturn: data.bestResult?.avgReturn ?? 0, winRate: data.bestResult?.winRate ?? 0, signal: data.currentSignal?.signal ?? 'hold', timestamp: Date.now(), result: data });
      setHistory(loadHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [onResolvedStock]);

  const loadFromHistory = (entry: HistoryEntry) => {
    setCode(entry.code);
    setName(entry.name);
    setResult(entry.result);
    setError(null);
    setShowHistory(false);
    onResolvedStock?.(entry.code, entry.name);
  };

  useEffect(() => {
    if (initialCode) void analyze(initialCode, initialName);
  }, [analyze, initialCode, initialName]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Input bar ─────────────────────────────────── */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-card px-4 py-2 font-mono text-sm text-foreground outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
          placeholder="输入股票代码，如 600519"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void analyze(code); }}
        />
        <button
          type="button"
          onClick={() => void analyze(code)}
          disabled={loading}
          className="rounded-md bg-primary px-5 py-2 font-mono text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(0,212,255,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? `分析中 ${elapsed}s…` : '分析'}
        </button>
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

      {/* ── History panel ─────────────────────────────── */}
      {showHistory && history.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">分析历史</div>
          <div className="flex flex-col gap-1">
            {history.map(entry => {
              const ri  = REGIME_LABELS[entry.regime] ?? { label: entry.regime, cls: 'text-muted-foreground' };
              const sc2 = SIGNAL_CONFIG[entry.signal as keyof typeof SIGNAL_CONFIG] ?? SIGNAL_CONFIG.hold;
              return (
                <div key={entry.code} className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-all hover:bg-secondary/60" onClick={() => loadFromHistory(entry)}>
                  <span className="w-[52px] font-mono text-[12px] font-bold text-foreground">{entry.code}</span>
                  <span className="w-[72px] truncate font-mono text-[11px] text-muted-foreground">{entry.name}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${ri.cls}`}>{ri.label}</span>
                  <span className={`font-mono text-[11px] font-bold ${sc2.color}`}>{sc2.label}</span>
                  <span className="font-mono text-[11px] text-[#00ff88]">{(entry.avgReturn * 100).toFixed(1)}%</span>
                  <span className="font-mono text-[11px] text-primary">{(entry.winRate * 100).toFixed(0)}%胜率</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{formatTimeAgo(entry.timestamp)}</span>
                  <button type="button" onClick={e => { e.stopPropagation(); removeFromHistory(entry.code); setHistory(loadHistory()); }} className="ml-1 hidden rounded px-1 text-[10px] text-muted-foreground/40 hover:bg-destructive/20 hover:text-destructive group-hover:inline-block">×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loading ────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <div className="font-mono text-sm text-muted-foreground">Regime 驱动扫描中… {elapsed}s</div>
          <div className="h-[2px] w-full overflow-hidden rounded bg-secondary">
            <div className="h-full animate-pulse bg-primary" style={{ width: `${Math.min(100, Math.max(15, elapsed * 3))}%` }} />
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────── */}
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">{error}</div>}

      {/* ── Results ───────────────────────────────────── */}
      {result && !loading && (
        <div className="flex flex-col gap-4">
          {/* Layer 1: Signal hero */}
          <SignalHero result={result} />

          {/* Layer 2: 3 indicator bars */}
          <IndicatorBars result={result} />

          {/* Layer 3: Technical details (collapsed) */}
          <TechDetails result={result} />
        </div>
      )}
    </div>
  );
}
