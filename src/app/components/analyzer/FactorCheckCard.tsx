import { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import type { EmotionStateEntry, EmotionState } from '../../types/api';

// ─── Types ─────────────────────────────────────────────────

interface AnalyzeResult {
  stockCode: string;
  stockName?: string;
  bestResult?: {
    winRate: number;
    avgReturn: number;
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
      exitReason: string;
    }>;
  };
  // Micro-structure indicators from /api/analyze/:code response
  rsi?: number;
  jValue?: number;
  bollPct?: number;
  profitFactor?: number;
}

interface FactorCheckCardProps {
  analyzeResult: AnalyzeResult | null;
}

// ─── Helpers ───────────────────────────────────────────────

function fmt(val: number | undefined | null, decimals = 2, suffix = ''): string {
  if (val === undefined || val === null || isNaN(val as number)) return 'N/A';
  return `${val.toFixed(decimals)}${suffix}`;
}

function fmtPct(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val as number)) return 'N/A';
  return `${(val * 100).toFixed(1)}%`;
}

// Derive average holding days from trades
function avgHoldingDays(trades: AnalyzeResult['bestResult'] extends undefined ? never : NonNullable<AnalyzeResult['bestResult']>['trades']): string {
  if (!trades || trades.length === 0) return 'N/A';
  const total = trades.reduce((sum, t) => sum + (t.holdingDays ?? 0), 0);
  return `${(total / trades.length).toFixed(1)}天`;
}

// Position recommendation based on emotion state
function getPositionAdvice(state: EmotionState | null): { label: string; color: string; bg: string } {
  if (!state) return { label: '暂无建议', color: 'text-muted-foreground', bg: 'bg-secondary/30' };
  if (state === '冰点' || state === '退潮') {
    return { label: '建议空仓', color: 'text-[#7a9bb5]', bg: 'bg-[#7a9bb5]/10' };
  }
  if (state === '主升' || state === '高潮') {
    return { label: '建议满仓', color: 'text-[#ff3366]', bg: 'bg-[#ff3366]/10' };
  }
  // 启动 → neutral
  return { label: '轻仓试探', color: 'text-amber-400', bg: 'bg-amber-500/10' };
}

const EMOTION_STATE_COLORS: Record<EmotionState, string> = {
  冰点: 'text-[#7a9bb5] border-[#7a9bb5]/30 bg-[#7a9bb5]/10',
  启动: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  主升: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  高潮: 'text-[#ff3366] border-[#ff3366]/30 bg-[#ff3366]/10',
  退潮: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
};

// ─── Component ─────────────────────────────────────────────

export function FactorCheckCard({ analyzeResult }: FactorCheckCardProps) {
  const { selectedDate } = useAppContext();
  const [emotionState, setEmotionState] = useState<EmotionState | null>(null);

  // Fetch emotion state for selectedDate
  useEffect(() => {
    if (!selectedDate) return;
    fetch(`http://localhost:3001/api/sentiment/state-history`)
      .then((r) => r.json())
      .then((json) => {
        const entries: EmotionStateEntry[] = json?.data ?? [];
        const entry = entries.find((e) => e.date === selectedDate);
        setEmotionState(entry?.state ?? null);
      })
      .catch(() => setEmotionState(null));
  }, [selectedDate]);

  const best = analyzeResult?.bestResult;
  const trades = best?.trades;
  const positionAdvice = getPositionAdvice(emotionState);
  const emotionColorClass = emotionState ? EMOTION_STATE_COLORS[emotionState] : 'text-muted-foreground border-border bg-secondary/30';

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">量化因子体检单</div>

      {/* Section 1: Micro-structure indicators */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">微观结构指标</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">RSI</div>
            <div className="mt-1 font-mono text-[16px] font-bold text-primary">
              {fmt(analyzeResult?.rsi, 1)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">J 值</div>
            <div className="mt-1 font-mono text-[16px] font-bold text-primary">
              {fmt(analyzeResult?.jValue, 1)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">布林带分位</div>
            <div className="mt-1 font-mono text-[16px] font-bold text-primary">
              {fmt(analyzeResult?.bollPct, 2)}
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: OOS backtest performance */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">OOS 回测表现</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">胜率</div>
            <div className="mt-1 font-mono text-[16px] font-bold text-[#00ff88]">
              {fmtPct(best?.winRate)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">PF</div>
            <div className="mt-1 font-mono text-[16px] font-bold text-[#00ff88]">
              {fmt(analyzeResult?.profitFactor, 2)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">均持仓周期</div>
            <div className="mt-1 font-mono text-[16px] font-bold text-[#00ff88]">
              {avgHoldingDays(trades)}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Position recommendation */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
          仓位建议 · {selectedDate || '--'}
        </div>
        <div className={`flex items-center justify-between rounded-md border px-4 py-3 ${positionAdvice.bg}`}>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[18px] font-bold ${positionAdvice.color}`}>
              {positionAdvice.label}
            </span>
            {emotionState && (
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${emotionColorClass}`}>
                {emotionState}
              </span>
            )}
          </div>
          {!emotionState && (
            <span className="font-mono text-[11px] text-muted-foreground">暂无情绪数据</span>
          )}
        </div>
      </div>
    </div>
  );
}
