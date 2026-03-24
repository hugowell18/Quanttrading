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
  plateau?: {
    passed: boolean;
    ratio: number;
    neighborCount: number;
  };
  modelStore?: {
    action: string;
    reason: string;
    version: number;
    fallbackToVersion?: number;
  };
  usedFallback?: boolean;
  leaderboard?: Array<{
    rank: number;
    config: { minZoneCapture: number; zoneForward: number; zoneBackward: number; envFilter: string };
    bestModel?: { featureSet: string; model: string };
    result: { avgReturn: number; winRate: number; stopLossRate: number; totalTrades: number };
  }>;
  stats: {
    totalCombinations?: number;
    validCombinations: number;
    scanDurationMs: number;
  };
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

const SIGNAL_CONFIG = {
  buy: { label: '买入', colorClass: 'text-rose-400', bgClass: 'bg-rose-500/10', borderClass: 'border-rose-500/30' },
  sell: { label: '卖出', colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10', borderClass: 'border-emerald-500/30' },
  hold: { label: '观望', colorClass: 'text-amber-400', bgClass: 'bg-amber-500/10', borderClass: 'border-amber-500/30' },
} as const;

const REGIME_LABELS: Record<string, { label: string; colorClass: string }> = {
  uptrend: { label: '上升趋势', colorClass: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
  downtrend: { label: '下降趋势', colorClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  range: { label: '震荡区间', colorClass: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  breakout: { label: '突破前夕', colorClass: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  high_vol: { label: '高波动', colorClass: 'text-orange-400 border-orange-500/30 bg-orange-500/10' },
};

const HISTORY_KEY = 'stock_analyzer_history';
const MAX_HISTORY = 20;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
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

export function StockAnalyzer({ initialCode = '', initialName = '', onResolvedStock }: Props) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

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
    if (!targetCode.trim()) return;
    if (targetName) setName(targetName);
    setLoading(true);
    setError(null);
    setResult(null);
    setShowHistory(false);

    try {
      const response = await fetch(`http://localhost:3030/api/tushare/optimizer/${targetCode.trim()}?period=3y`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as AnalyzeResult;
      setResult(data);
      onResolvedStock?.(data.stockCode, targetName || data.stockName || data.stockCode);

      const entry: HistoryEntry = {
        code: data.stockCode,
        name: data.stockName || targetName || data.stockCode,
        regime: data.regime || 'unknown',
        avgReturn: data.bestResult?.avgReturn ?? 0,
        winRate: data.bestResult?.winRate ?? 0,
        signal: data.currentSignal?.signal ?? 'hold',
        timestamp: Date.now(),
        result: data,
      };
      saveToHistory(entry);
      setHistory(loadHistory());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
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

  const handleRemoveHistory = (entryCode: string) => {
    removeFromHistory(entryCode);
    setHistory(loadHistory());
  };

  useEffect(() => {
    if (initialCode) void analyze(initialCode, initialName);
  }, [analyze, initialCode, initialName]);

  const signal = result?.currentSignal;
  const signalConfig = SIGNAL_CONFIG[signal?.signal ?? 'hold'];
  const regimeInfo = REGIME_LABELS[result?.regime ?? ''] ?? { label: result?.regime ?? '-', colorClass: 'text-muted-foreground border-border bg-secondary/40' };

  return (
    <div className="flex flex-col gap-4">
      {/* 输入区：代码输入 + 历史按钮 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            className="w-full rounded-md border border-border bg-card px-4 py-2 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
            placeholder="输入股票代码，如 600519"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void analyze(code);
            }}
          />
        </div>
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

      {/* 历史记录面板 */}
      {showHistory && history.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">分析历史</div>
          <div className="flex flex-col gap-1">
            {history.map((entry) => {
              const entryRegime = REGIME_LABELS[entry.regime] ?? { label: entry.regime, colorClass: 'text-muted-foreground' };
              const entrySignal = SIGNAL_CONFIG[entry.signal as keyof typeof SIGNAL_CONFIG] ?? SIGNAL_CONFIG.hold;
              const timeAgo = formatTimeAgo(entry.timestamp);
              return (
                <div
                  key={entry.code}
                  className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-all hover:bg-secondary/60"
                  onClick={() => loadFromHistory(entry)}
                >
                  <span className="w-[52px] font-mono text-[12px] font-bold text-foreground">{entry.code}</span>
                  <span className="w-[72px] truncate font-mono text-[11px] text-muted-foreground">{entry.name}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${entryRegime.colorClass}`}>{entryRegime.label}</span>
                  <span className={`font-mono text-[11px] font-bold ${entrySignal.colorClass}`}>{entrySignal.label}</span>
                  <span className="font-mono text-[11px] text-rose-400">+{(entry.avgReturn * 100).toFixed(1)}%</span>
                  <span className="font-mono text-[11px] text-primary">{(entry.winRate * 100).toFixed(0)}%</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{timeAgo}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveHistory(entry.code); }}
                    className="ml-1 hidden rounded px-1 text-[10px] text-muted-foreground/40 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:inline-block"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 扫描进度 */}
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

      {/* 错误提示 */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 结果展示 */}
      {result && !loading && (
        <>
          {/* 第一行：Regime 状态 + 信号 */}
          <div className={`rounded-lg border p-5 ${signalConfig.bgClass} ${signalConfig.borderClass}`}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">当前信号 · {signal?.date}</span>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <span>{result.stockCode}</span>
                  <span>·</span>
                  <span>{result.stockName || name || result.stockCode}</span>
                  <span>·</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${regimeInfo.colorClass}`}>
                    {regimeInfo.label}
                    {result.regimeConfidence !== undefined && ` ${(result.regimeConfidence * 100).toFixed(0)}%`}
                  </span>
                  {result.usedFallback && (
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

          {/* 核心指标卡片：6列（新增 Sharpe） */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            {[
              { label: '平均收益', value: `${result.bestResult.avgReturn >= 0 ? '+' : ''}${(result.bestResult.avgReturn * 100).toFixed(1)}%`, colorClass: 'text-rose-400' },
              { label: '胜率', value: `${(result.bestResult.winRate * 100).toFixed(0)}%`, colorClass: 'text-primary' },
              { label: '止损率', value: `${(result.bestResult.stopLossRate * 100).toFixed(0)}%`, colorClass: 'text-emerald-400' },
              { label: '交易数', value: `${result.bestResult.totalTrades}`, colorClass: 'text-amber-400' },
              { label: '最大回撤', value: `${(result.bestResult.maxDrawdown * 100).toFixed(1)}%`, colorClass: 'text-slate-400' },
              { label: 'Sharpe', value: result.bestResult.sharpe !== undefined ? result.bestResult.sharpe.toFixed(2) : 'N/A', colorClass: 'text-violet-400' },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border bg-card p-3 text-center">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{metric.label}</div>
                <div className={`font-mono text-[18px] font-bold ${metric.colorClass}`}>{metric.value}</div>
              </div>
            ))}
          </div>

          {/* 三层架构状态 */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {/* 参数高原检验 */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">参数高原检验</div>
              {result.plateau ? (
                <>
                  <div className={`font-mono text-[16px] font-bold ${result.plateau.passed ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {result.plateau.passed ? '通过' : '未通过'}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    邻域比 {result.plateau.ratio} · 邻域数 {result.plateau.neighborCount}
                  </div>
                </>
              ) : (
                <div className="font-mono text-[14px] text-muted-foreground">-</div>
              )}
            </div>

            {/* 模型版本 */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">模型版本</div>
              {result.modelStore ? (
                <>
                  <div className="font-mono text-[16px] font-bold text-primary">v{result.modelStore.version}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {result.modelStore.action === 'accept' ? '已更新' : result.modelStore.action === 'reject' ? '已熔断' : result.modelStore.action === 'regime_switch' ? 'Regime切换' : result.modelStore.action}
                  </div>
                </>
              ) : (
                <div className="font-mono text-[14px] text-muted-foreground">-</div>
              )}
            </div>

            {/* 最优模型 */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">最优模型</div>
              {result.bestModel ? (
                <>
                  <div className="font-mono text-[14px] font-bold text-primary">{result.bestModel.model}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {result.bestModel.featureSet} · P{result.bestModel.precision.toFixed(2)} R{result.bestModel.recall.toFixed(2)}
                  </div>
                </>
              ) : (
                <div className="font-mono text-[14px] text-muted-foreground">-</div>
              )}
            </div>
          </div>

          {/* 最优配置 */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
              <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
              最优配置
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
              有效组合 {result.stats.validCombinations}/{result.stats.totalCombinations ?? '?'} · 耗时 {(result.stats.scanDurationMs / 1000).toFixed(1)}s
            </div>
          </div>

          {/* Regime 历史时间线 */}
          {result.regimeHistory && result.regimeHistory.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
                <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
                Regime 演变
              </div>
              <div className="flex flex-wrap gap-1">
                {result.regimeHistory.slice(-8).map((item, idx) => {
                  const rInfo = REGIME_LABELS[item.regime] ?? { label: item.regime, colorClass: 'text-muted-foreground border-border bg-secondary/40' };
                  return (
                    <div key={idx} className="flex items-center gap-1">
                      {idx > 0 && <span className="font-mono text-[10px] text-muted-foreground/40">→</span>}
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${rInfo.colorClass}`}>
                        {item.date.slice(5)} {rInfo.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 排行榜 Top5 */}
          {result.leaderboard && result.leaderboard.length > 1 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
                <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
                配置排行 Top {Math.min(5, result.leaderboard.length)}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-3">#</th>
                      <th className="pb-2 pr-3">capture</th>
                      <th className="pb-2 pr-3">fwd</th>
                      <th className="pb-2 pr-3">bwd</th>
                      <th className="pb-2 pr-3">envFilter</th>
                      <th className="pb-2 pr-3 text-right">收益</th>
                      <th className="pb-2 pr-3 text-right">胜率</th>
                      <th className="pb-2 text-right">交易</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.leaderboard.slice(0, 5).map((item) => (
                      <tr key={item.rank} className={`border-b border-border/30 ${item.rank === 1 ? 'text-primary' : 'text-foreground'}`}>
                        <td className="py-1.5 pr-3">{item.rank}</td>
                        <td className="py-1.5 pr-3">{item.config.minZoneCapture}</td>
                        <td className="py-1.5 pr-3">{item.config.zoneForward}</td>
                        <td className="py-1.5 pr-3">{item.config.zoneBackward}</td>
                        <td className="py-1.5 pr-3">{item.config.envFilter}</td>
                        <td className="py-1.5 pr-3 text-right text-rose-400">{(item.result.avgReturn * 100).toFixed(2)}%</td>
                        <td className="py-1.5 pr-3 text-right">{(item.result.winRate * 100).toFixed(0)}%</td>
                        <td className="py-1.5 text-right">{item.result.totalTrades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 模型存储详情 */}
          {result.modelStore && result.modelStore.reason && (
            <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3">
              <div className="font-mono text-[10px] text-muted-foreground">
                <span className="mr-2 uppercase tracking-[1px]">模型存储</span>
                {result.modelStore.reason}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}
