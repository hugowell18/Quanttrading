import { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import type { EmotionStateEntry, EmotionState } from '../../types/api';

interface BestConfig {
  minZoneCapture?: number;
  zoneForward?: number;
  zoneBackward?: number;
  envFilter?: string;
  trendProfile?: string;
  rsiThreshold?: number;
  jThreshold?: number;
  oversoldMinCount?: number;
  bollPosThreshold?: number;
  exitPlan?: { name: string; stopLoss: number; maxHoldingDays: number };
}

interface BestResult {
  winRate?: number;
  avgReturn?: number;
  stopLossRate?: number;
  totalTrades?: number;
  maxDrawdown?: number;
  avgStopLossPct?: number;
  buyCount?: number;
  skippedByEnvironment?: number;
  skippedByMarket?: number;
  [key: string]: unknown;
}

interface AnalyzeResult {
  stockCode: string;
  stockName?: string;
  bestConfig?: BestConfig;
  bestResult?: BestResult;
  currentSignal?: {
    signal: 'buy' | 'sell' | 'hold';
    confidence: number;
    date?: string;
    score?: number;
    threshold?: number;
  } | null;
  strictPass?: boolean;
}

interface FactorCheckCardProps {
  analyzeResult: AnalyzeResult | null;
}

function fmt(val: number | undefined | null, decimals = 2, suffix = ''): string {
  if (val == null || isNaN(val as number)) return 'N/A';
  return `${val.toFixed(decimals)}${suffix}`;
}

function fmtPct(val: number | undefined | null): string {
  if (val == null || isNaN(val as number)) return 'N/A';
  return `${(val * 100).toFixed(1)}%`;
}

const EMOTION_COLORS: Record<EmotionState, string> = {
  冰点: 'text-[#7a9bb5] border-[#7a9bb5]/30 bg-[#7a9bb5]/10',
  启动: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  主升: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  高潮: 'text-[#ff3366] border-[#ff3366]/30 bg-[#ff3366]/10',
  退潮: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
};

function getPositionAdvice(state: EmotionState | null) {
  if (!state) return { label: '暂无建议', color: 'text-muted-foreground', bg: 'bg-secondary/30' };
  if (state === '冰点' || state === '退潮') return { label: '建议空仓', color: 'text-[#7a9bb5]', bg: 'bg-[#7a9bb5]/10' };
  if (state === '主升' || state === '高潮') return { label: '建议满仓', color: 'text-[#ff3366]', bg: 'bg-[#ff3366]/10' };
  return { label: '轻仓试探', color: 'text-amber-400', bg: 'bg-amber-500/10' };
}

function envFilterLabel(v?: string): string {
  if (!v || v === 'none') return '不限制大盘';
  if (v === 'ma20') return '大盘站上MA20';
  if (v === 'ma20_0.98') return '大盘站上MA20×0.98';
  return v;
}

function trendProfileLabel(v?: string): string {
  if (v === 'A') return 'A — 不限趋势';
  if (v === 'B') return 'B — 大盘MA20上方';
  if (v === 'C') return 'C — 大盘+个股双MA20';
  return v ?? 'N/A';
}

export function FactorCheckCard({ analyzeResult }: FactorCheckCardProps) {
  const { selectedDate } = useAppContext();
  const [emotionState, setEmotionState] = useState<EmotionState | null>(null);

  useEffect(() => {
    if (!selectedDate) return;
    fetch('http://localhost:3001/api/sentiment/state-history')
      .then(r => r.json())
      .then(json => {
        const entries: EmotionStateEntry[] = json?.data ?? [];
        const entry = entries.find(e => e.date === selectedDate);
        setEmotionState(entry?.state ?? null);
      })
      .catch(() => setEmotionState(null));
  }, [selectedDate]);

  if (!analyzeResult) return null;

  const cfg = analyzeResult.bestConfig;
  const br = analyzeResult.bestResult;
  const sig = analyzeResult.currentSignal;
  const posAdvice = getPositionAdvice(emotionState);
  const emotionCls = emotionState ? EMOTION_COLORS[emotionState] : 'text-muted-foreground border-border bg-secondary/30';

  const cell = (label: string, value: string, color = 'text-foreground', hint?: string) => (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-[13px] font-bold ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 font-mono text-[9px] text-muted-foreground/60">{hint}</div>}
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">量化策略体检单</div>

      {/* Section 1: Best config params */}
      {cfg && (
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">最优参数配置</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cfg.trendProfile !== undefined
              ? <>
                  {cell('趋势过滤', trendProfileLabel(cfg.trendProfile))}
                  {cell('RSI阈值', fmt(cfg.rsiThreshold, 0), 'text-primary', '低于此值视为超卖')}
                  {cell('J值阈值', fmt(cfg.jThreshold, 0), 'text-primary', '低于此值视为超卖')}
                  {cell('超卖条件数', fmt(cfg.oversoldMinCount, 0) + ' 项', 'text-primary', '需同时满足的条件数')}
                  {cell('布林阈值', cfg.bollPosThreshold === 999 ? '不限制' : fmt(cfg.bollPosThreshold, 1), 'text-primary')}
                  {cell('出场方案', cfg.exitPlan?.name ?? 'N/A', 'text-foreground', `止损${fmtPct(cfg.exitPlan?.stopLoss)} 最长${cfg.exitPlan?.maxHoldingDays}天`)}
                </>
              : <>
                  {cell('最小区间捕获', fmtPct(cfg.minZoneCapture), 'text-primary')}
                  {cell('前向窗口', fmt(cfg.zoneForward, 0) + ' 天', 'text-primary')}
                  {cell('后向窗口', fmt(cfg.zoneBackward, 0) + ' 天', 'text-primary')}
                  {cell('大盘过滤', envFilterLabel(cfg.envFilter))}
                </>
            }
          </div>
        </div>
      )}

      {/* Section 2: Signal quality stats */}
      {br && (
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">信号质量统计</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cell('买点总数', fmt(br.buyCount, 0) + ' 个', 'text-foreground', '历史满足条件的买点')}
            {cell('平均止损幅', fmtPct(br.avgStopLossPct), 'text-amber-400', '每笔交易止损位')}
            {cell('大盘过滤跳过', fmt(br.skippedByMarket, 0) + ' 次', 'text-muted-foreground', '因大盘不佳跳过')}
            {cell('环境过滤跳过', fmt(br.skippedByEnvironment, 0) + ' 次', 'text-muted-foreground', '因环境过滤跳过')}
          </div>
        </div>
      )}

      {/* Section 3: Current signal */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">当前信号</div>
        {sig ? (
          <div className={`flex items-center justify-between rounded-md border px-4 py-3 ${
            sig.signal === 'buy' ? 'border-[#00ff88]/30 bg-[#00ff88]/10' :
            sig.signal === 'sell' ? 'border-[#ff3366]/30 bg-[#ff3366]/10' :
            'border-border bg-secondary/30'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`font-mono text-[20px] font-bold ${
                sig.signal === 'buy' ? 'text-[#00ff88]' :
                sig.signal === 'sell' ? 'text-[#ff3366]' : 'text-muted-foreground'
              }`}>
                {sig.signal === 'buy' ? '买入信号' : sig.signal === 'sell' ? '卖出信号' : '观望'}
              </span>
              {sig.date && <span className="font-mono text-[11px] text-muted-foreground">{sig.date}</span>}
            </div>
            <div className="text-right font-mono text-[11px] text-muted-foreground">
              {sig.score != null && <div>得分 {sig.score.toFixed(3)}</div>}
              {sig.threshold != null && <div>阈值 {sig.threshold.toFixed(3)}</div>}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-secondary/30 px-4 py-3 font-mono text-[12px] text-muted-foreground">
            暂无信号（该股未在 batch 分析中，或无有效配置）
          </div>
        )}
      </div>

      {/* Section 4: Position advice based on emotion state */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
          仓位建议 · {selectedDate || '--'}
        </div>
        <div className={`flex items-center justify-between rounded-md border px-4 py-3 ${posAdvice.bg}`}>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[18px] font-bold ${posAdvice.color}`}>{posAdvice.label}</span>
            {emotionState && (
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${emotionCls}`}>{emotionState}</span>
            )}
          </div>
          {!emotionState && <span className="font-mono text-[11px] text-muted-foreground">暂无情绪数据</span>}
        </div>
      </div>
    </div>
  );
}
