import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { KLineChart } from '../signal-analyzer/KLineChart';
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
  // NOTE: result/kline/markers are NOT persisted to avoid LocalStorage quota overflow.
  // They are populated in-memory after re-fetch when user clicks a history item.
  result?: AnalyzeResult;
  kline?: KLinePoint[];
  markers?: SignalMarker[];
}

// ─── Helpers ───────────────────────────────────────────────

const HISTORY_KEY = 'stock_analyzer_history_v3';
const MAX_HISTORY = 20;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch { return []; }
}

function saveToHistory(entry: HistoryEntry) {
  const list = loadHistory().filter(h => h.code !== entry.code);
  // Only persist lightweight metadata — never kline/result/markers (too large)
  const { result: _r, kline: _k, markers: _m, ...meta } = entry;
  list.unshift(meta);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // If quota still exceeded (e.g. other keys), trim to 10 and retry
    list.length = Math.min(list.length, 10);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* give up */ }
  }
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

function extractOosTrades(raw: any): AnalyzeTrade[] {
  const br = raw?.bestResult;
  if (!br) return [];
  if (Array.isArray(br.trades)) {
    return [...br.trades].sort((a, b) => b.buyDate.localeCompare(a.buyDate));
  }
  const v: AnalyzeTrade[] = br.validation?.trades ?? [];
  const s: AnalyzeTrade[] = br.stress?.trades ?? [];
  const f: AnalyzeTrade[] = Array.isArray(br.final?.trades) ? br.final.trades : [];
  return [...v, ...s, ...f].sort((a, b) => b.buyDate.localeCompare(a.buyDate));
}

function buildBestResult(raw: any, trades: AnalyzeTrade[]): AnalyzeResult['bestResult'] {
  const br = raw?.bestResult;
  if (!br) return { avgReturn: 0, winRate: 0, stopLossRate: 0, totalTrades: 0, maxDrawdown: 0, trades };
  if (typeof br.winRate === 'number' && typeof br.avgReturn === 'number') {
    return { ...br, totalTrades: trades.length, trades };
  }
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

// ─── Signal Hero Card ──────────────────────────────────────

function signalReason(result: AnalyzeResult): string {
  const sig = result.currentSignal;
  const cfg = result.bestConfig as any;
  const tp = cfg?.trendProfile;
  const profileNote = tp === 'C' ? '双重趋势确认模式，信号精准但稀少' :
                      tp === 'B' ? '大盘MA20以上才入场' :
                      '宽松趋势过滤，信号量较多';

  if (!sig || sig.signal === 'hold') {
    return `当前技术指标无法触发买点条件，建议观望 · ${profileNote}`;
  }
  if (sig.signal === 'buy') {
    return `模型判断当前处于技术超卖区，预期5日内出现均值回归机会 · ${profileNote}`;
  }
  return `超卖条件已解除或趋势偏弱，减仓或等待新的低点信号 · ${profileNote}`;
}

function SignalHeroCard({ result }: { result: AnalyzeResult }) {
  const sig = result.currentSignal;
  const br = result.bestResult;
  if (!br) return null;

  const signal = sig?.signal ?? 'hold';
  const confidence = sig?.confidence ?? 0;

  const signalLabel = signal === 'buy' ? '买入' : signal === 'sell' ? '卖出' : '观望';
  const signalColor =
    signal === 'buy'  ? 'text-[#00ff88]' :
    signal === 'sell' ? 'text-[#ff3366]' :
                        'text-muted-foreground';
  const borderColor =
    signal === 'buy'  ? 'border-[#00ff88]/30' :
    signal === 'sell' ? 'border-[#ff3366]/30' :
                        'border-border';
  const bgColor =
    signal === 'buy'  ? 'bg-[#00ff88]/5' :
    signal === 'sell' ? 'bg-[#ff3366]/5' :
                        'bg-card';

  const winRatePct = (br.winRate * 100).toFixed(1);
  const avgRetPct  = ((br.avgReturn ?? 0) * 100);
  const ddPct      = (Math.abs(br.maxDrawdown ?? 0) * 100).toFixed(1);

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-5`}>
      {/* Top row: signal + confidence */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">当前信号</div>
          <div className={`font-mono text-[36px] font-black leading-none ${signalColor}`}>{signalLabel}</div>
          {sig?.date && (
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">{sig.date}</div>
          )}
        </div>

        {/* Confidence gauge */}
        <div className="flex-1 max-w-[160px]">
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground mb-1">
            <span>信心度</span>
            <span>{(confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${signal === 'buy' ? 'bg-[#00ff88]' : signal === 'sell' ? 'bg-[#ff3366]' : 'bg-muted-foreground/40'}`}
              style={{ width: `${(confidence * 100).toFixed(0)}%` }}
            />
          </div>
          {result.strictPass != null && (
            <div className="mt-1.5 flex justify-end">
              <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${result.strictPass ? 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'}`}>
                {result.strictPass ? '严格通过' : '弱通过'}
              </span>
            </div>
          )}
        </div>

        {/* Key stats */}
        <div className="flex gap-3">
          {[
            { label: '胜率', value: `${winRatePct}%`, ok: br.winRate >= 0.5 },
            { label: '均收益', value: `${avgRetPct >= 0 ? '+' : ''}${avgRetPct.toFixed(2)}%`, ok: br.avgReturn >= 0 },
            { label: '最大回撤', value: `-${ddPct}%`, ok: Math.abs(br.maxDrawdown ?? 0) < 0.2 },
          ].map(({ label, value, ok }) => (
            <div key={label} className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center min-w-[68px]">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
              <div className={`mt-0.5 font-mono text-[14px] font-bold ${ok ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Reason text */}
      <div className="mt-3 rounded-md border border-border/50 bg-secondary/20 px-3 py-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
        {signalReason(result)}
      </div>
    </div>
  );
}

// ─── Indicator Bars ────────────────────────────────────────

interface BarProps {
  label: string;
  score: number;        // 0–100
  description: string;
  color?: string;
}

function IndicatorBar({ label, score, description, color }: BarProps) {
  const s = Math.round(Math.max(0, Math.min(100, score)));
  const barColor = color ?? (s >= 65 ? '#00ff88' : s >= 40 ? '#f59e0b' : '#ff3366');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold text-foreground">{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{s}/100</span>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${s}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">{description}</div>
    </div>
  );
}

function IndicatorBars({ result }: { result: AnalyzeResult }) {
  const br = result.bestResult;
  const sig = result.currentSignal;
  if (!br) return null;

  const winRate = br.winRate ?? 0;
  const avgRet  = br.avgReturn ?? 0;
  const trades  = br.totalTrades ?? 0;
  const dd      = Math.abs(br.maxDrawdown ?? 0);

  // 模型质量: 胜率(50%) + 收益方向(30%) + 交易次数充足(20%)
  const modelQuality = Math.round(
    winRate * 50 +
    (avgRet > 0 ? Math.min(avgRet * 5 * 30, 30) : 0) +
    (trades >= 15 ? 20 : trades >= 8 ? 12 : trades >= 4 ? 6 : 0),
  );
  const modelDesc =
    modelQuality >= 65 ? `胜率${(winRate * 100).toFixed(0)}%，历史${trades}笔交易，表现良好` :
    modelQuality >= 40 ? `胜率${(winRate * 100).toFixed(0)}%，信号数量偏少，参考价值有限` :
                         `历史表现不稳定，建议降低仓位权重`;

  // 信号强度: 直接来自 currentSignal.confidence
  const signalStrength = Math.round((sig?.confidence ?? 0) * 100);
  const signalDesc =
    signalStrength >= 70 ? '模型高置信度，历史标注与当前特征高度吻合' :
    signalStrength >= 40 ? '中等置信度，信号有效但建议配合大盘方向确认' :
                           '低置信度，当前特征与历史买点差异较大，建议观望';

  // 风险系数: 回撤越低越安全 (0回撤=100分, 25%回撤=0分)
  const riskScore  = Math.round(Math.max(0, (1 - dd / 0.25) * 100));
  const riskDesc =
    riskScore >= 70 ? `最大回撤${(dd * 100).toFixed(1)}%，风险控制良好` :
    riskScore >= 40 ? `最大回撤${(dd * 100).toFixed(1)}%，存在一定回撤风险` :
                      `最大回撤${(dd * 100).toFixed(1)}%，风险较高，严格控制仓位`;

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">量化指标</div>
      <IndicatorBar label="模型质量" score={modelQuality} description={modelDesc} />
      <IndicatorBar label="信号强度" score={signalStrength} description={signalDesc} />
      <IndicatorBar
        label="风险系数"
        score={riskScore}
        description={riskDesc}
        color={riskScore >= 65 ? '#00ff88' : riskScore >= 40 ? '#f59e0b' : '#ff3366'}
      />
    </div>
  );
}

// ─── Exit Badge ────────────────────────────────────────────

function ExitBadge({ reason }: { reason: string }) {
  const r = reason.trim();
  if (r.includes('止盈') || r === 'take_profit' || r === 'tp' || r === 'takeProfit')
    return <Badge className="border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] font-mono text-[9px] px-1.5 py-0.5">止盈</Badge>;
  if (r.includes('止损') || r === 'stop_loss' || r === 'sl' || r === 'stopLoss')
    return <Badge className="border-[#ff3366]/40 bg-[#ff3366]/10 text-[#ff3366] font-mono text-[9px] px-1.5 py-0.5">止损</Badge>;
  if (r.includes('超时') || r === 'timeout' || r === 'time_stop')
    return <Badge className="border-orange-500/40 bg-orange-500/10 text-orange-400 font-mono text-[9px] px-1.5 py-0.5">超时强平</Badge>;
  if (r.includes('追踪') || r === 'trailingStop')
    return <Badge className="border-blue-400/40 bg-blue-400/10 text-blue-400 font-mono text-[9px] px-1.5 py-0.5">追踪止损</Badge>;
  if (r.includes('卖点') || r === 'sellSignal')
    return <Badge className="border-purple-400/40 bg-purple-400/10 text-purple-400 font-mono text-[9px] px-1.5 py-0.5">卖点出场</Badge>;
  return <Badge className="border-border bg-secondary/50 text-muted-foreground font-mono text-[9px] px-1.5 py-0.5">{r}</Badge>;
}

// ─── Trade Ledger (collapsible) ────────────────────────────

function TradeLedger({ trades }: { trades: AnalyzeTrade[] }) {
  const [open, setOpen] = useState(false);

  const wins   = trades.filter(t => t.return > 0).length;
  const losses = trades.length - wins;

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-secondary/30"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            历史交易记录
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {trades.length} 笔 · {wins}盈 {losses}亏
          </span>
        </div>
        <span className="font-mono text-[12px] text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-border px-5 py-4 flex flex-col gap-2.5">
          {trades.length === 0 ? (
            <div className="py-4 text-center font-mono text-[12px] text-muted-foreground">暂无交易记录</div>
          ) : trades.map((t, i) => {
            const profit = t.return >= 0;
            const net = ((t.return - 0.007) * 100);
            return (
              <div
                key={`${t.buyDate}-${i}`}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${profit ? 'border-[#00ff88]/20 bg-[#00ff88]/5' : 'border-[#ff3366]/20 bg-[#ff3366]/5'}`}
              >
                {/* Trade number */}
                <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground/50 text-right">
                  {i + 1}
                </span>

                {/* Dates */}
                <div className="flex flex-col min-w-[140px]">
                  <span className="font-mono text-[10px] text-muted-foreground">{t.buyDate} → {t.sellDate}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60">持仓 {t.holdingDays} 天</span>
                </div>

                {/* Return */}
                <span className={`ml-auto font-mono text-[13px] font-bold min-w-[60px] text-right ${profit ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                  {net >= 0 ? '+' : ''}{net.toFixed(2)}%
                </span>

                {/* Exit reason */}
                <ExitBadge reason={t.exitReason} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Strategy Params (collapsible) ────────────────────────

function StrategyParams({ result }: { result: AnalyzeResult }) {
  const [open, setOpen] = useState(false);
  const cfg = result.bestConfig as any;
  if (!cfg) return null;

  const rows: [string, string][] = cfg.trendProfile != null ? [
    ['趋势过滤', cfg.trendProfile === 'A' ? 'A — 不限制' : cfg.trendProfile === 'B' ? 'B — 大盘MA20' : 'C — 双重MA20'],
    ['RSI 超卖阈值', `< ${cfg.rsiThreshold}`],
    ['J 值超卖阈值', `< ${cfg.jThreshold}`],
    ['超卖条件数', `≥ ${cfg.oversoldMinCount} / 6`],
    ['布林带位置', cfg.bollPosThreshold === 999 ? '不限制' : `< ${cfg.bollPosThreshold}`],
    ['出场方案', cfg.exitPlan ? `方案${cfg.exitPlan.name}  止损${(cfg.exitPlan.stopLoss * 100).toFixed(1)}%  最长${cfg.exitPlan.maxHoldingDays}天` : 'N/A'],
  ] : [];

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-secondary/30"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">策略参数详情</span>
        <span className="font-mono text-[12px] text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">{label}</div>
              <div className="font-mono text-[12px] text-foreground mt-0.5">{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export function StockAnalyzerPage() {
  const { selectedStock, pushDebugLog } = useAppContext();

  const [inputCode, setInputCode]       = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [elapsed, setElapsed]           = useState(0);
  const [history, setHistory]           = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory]   = useState(false);

  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [klineData, setKlineData]         = useState<KLinePoint[]>([]);
  const [signalMarkers, setSignalMarkers] = useState<SignalMarker[]>([]);
  const [stockName, setStockName]         = useState('');

  const analyzingRef = useRef<string>('');
  const lastDoneRef  = useRef<string>('');

  // Timer
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const t = window.setInterval(() => setElapsed(v => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [loading]);

  const analyze = async (targetCode: string, refresh = false) => {
    const code = targetCode.trim();
    if (!/^\d{6}$/.test(code)) return;
    if (!refresh && lastDoneRef.current === code) return;

    analyzingRef.current = code;
    setLoading(true);
    setError(null);
    setShowHistory(false);

    pushDebugLog({ level: 'info', module: 'StockAnalyzer', message: refresh ? '强制刷新分析' : '发起分析请求', payload: { code } });

    try {
      const url = `http://localhost:3001/api/analyze/${code}${refresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (analyzingRef.current !== code) return;

      const raw = json?.data ?? json;
      const trades = extractOosTrades(raw);
      const bestResult = buildBestResult(raw, trades);
      const kline: KLinePoint[] = raw.kline ?? [];
      const markers: SignalMarker[] = trades.flatMap(t => [
        { date: t.buyDate, type: 'buy'  as const, price: t.buyPrice,  label: 'B' as const },
        { date: t.sellDate, type: 'sell' as const, price: t.sellPrice, label: 'S' as const },
      ]);

      const result: AnalyzeResult = { ...raw, bestResult };

      setAnalyzeResult(result);
      setKlineData(kline);
      setSignalMarkers(markers);
      setStockName(raw.stockName ?? code);
      lastDoneRef.current = code;

      saveToHistory({ code: raw.stockCode ?? code, name: raw.stockName ?? code, winRate: bestResult?.winRate ?? 0, avgReturn: bestResult?.avgReturn ?? 0, timestamp: Date.now(), result, kline, markers });
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

  useEffect(() => {
    if (!selectedStock) return;
    if (lastDoneRef.current === selectedStock) return;
    setInputCode(selectedStock);
    void analyze(selectedStock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStock]);

  const loadFromHistory = (entry: HistoryEntry) => {
    lastDoneRef.current = '';
    setInputCode(entry.code);
    setStockName(entry.name);
    setShowHistory(false);
    void analyze(entry.code);
  };

  const hasResult = analyzeResult !== null && !loading;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Input bar ─────────────────────────────────────── */}
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
          {loading ? `分析中 ${elapsed}s…` : '分析'}
        </button>
        {analyzeResult && !loading && (
          <button
            type="button"
            onClick={() => { lastDoneRef.current = ''; void analyze(inputCode, true); }}
            title="强制重新分析，获取最新实时信号"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-400 transition-all hover:bg-amber-500/20"
          >
            ↻ 刷新
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

      {/* ── History panel ──────────────────────────────────── */}
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

      {/* ── Loading ────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <div className="font-mono text-sm text-muted-foreground">量化分析中… {elapsed}s</div>
          <div className="h-[2px] w-full overflow-hidden rounded bg-secondary">
            <div className="h-full animate-pulse bg-primary" style={{ width: `${Math.min(100, Math.max(10, elapsed * 2))}%` }} />
          </div>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">{error}</div>
      )}

      {/* ── Results ────────────────────────────────────────── */}
      {hasResult && (
        <div className="flex flex-col gap-4">
          {/* Layer 1: Signal hero — or strategy-not-applicable notice */}
          {analyzeResult.bestResult
            ? <SignalHeroCard result={analyzeResult} />
            : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-5">
                <div className="font-mono text-[13px] font-semibold text-amber-400 mb-1">策略不适用</div>
                <div className="font-mono text-[12px] text-muted-foreground leading-relaxed">
                  本系统基于「超卖反转」策略（RSI低位+KDJ底背离），历史回测未找到符合条件的交易信号。<br/>
                  可能原因：① 此股处于强势上涨（如连板），不会出现超卖 ② 上市时间短，样本不足 ③ 波动率不匹配策略参数。<br/>
                  点击「↻ 刷新」可强制重新分析。
                </div>
              </div>
            )
          }

          {/* Layer 2: Indicator bars */}
          <IndicatorBars result={analyzeResult} />

          {/* Layer 3: K-line chart */}
          {klineData.length > 0
            ? <KLineChart klineData={klineData} signalMarkers={signalMarkers} stockCode={analyzeResult.stockCode} stockName={stockName || analyzeResult.stockCode} />
            : <div className="rounded-lg border border-border bg-card p-6 text-center font-mono text-[12px] text-muted-foreground">K线数据加载中或暂无数据</div>
          }

          {/* Layer 4: Strategy params (collapsed by default) */}
          <StrategyParams result={analyzeResult} />

          {/* Layer 5: Trade ledger (collapsed by default) */}
          <TradeLedger trades={analyzeResult.bestResult?.trades ?? []} />
        </div>
      )}
    </div>
  );
}
