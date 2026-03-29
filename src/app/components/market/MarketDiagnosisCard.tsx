import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { KLinePoint } from '../signal-analyzer/types';
import type { EmotionState, EmotionStateEntry } from '../../types/api';

interface MarketDiagnosisCardProps {
  klineData: KLinePoint[];
  emotionEntry: EmotionStateEntry | null;
}

function getMaTrend(klineData: KLinePoint[]): { ma20: 'bull' | 'bear' | 'neutral'; ma60: 'bull' | 'bear' | 'neutral' } {
  if (klineData.length < 2) return { ma20: 'neutral', ma60: 'neutral' };
  const last = klineData[klineData.length - 1];
  const prev = klineData[klineData.length - 2];

  const ma20Status =
    last.ma20 > prev.ma20 ? 'bull' : last.ma20 < prev.ma20 ? 'bear' : 'neutral';
  const ma60Status =
    last.ma60 !== undefined && prev.ma60 !== undefined
      ? last.ma60 > prev.ma60 ? 'bull' : last.ma60 < prev.ma60 ? 'bear' : 'neutral'
      : 'neutral';

  return { ma20: ma20Status, ma60: ma60Status };
}

const EMOTION_COLOR: Record<EmotionState, string> = {
  冰点: 'text-blue-400',
  启动: 'text-yellow-400',
  主升: 'text-orange-400',
  高潮: 'text-red-400',
  退潮: 'text-purple-400',
};

const POSITION_ADVICE: Record<EmotionState, string> = {
  冰点: '建议空仓观望',
  启动: '轻仓试探（≤30%）',
  主升: '积极持仓（≤80%）',
  高潮: '满仓但注意风险',
  退潮: '减仓至空仓',
};

function TrendBadge({ trend }: { trend: 'bull' | 'bear' | 'neutral' }) {
  const cls =
    trend === 'bull'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : trend === 'bear'
      ? 'bg-red-500/15 text-red-400 border-red-500/30'
      : 'bg-muted/30 text-muted-foreground border-border/40';
  const label = trend === 'bull' ? '多头' : trend === 'bear' ? '空头' : '中性';
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[11px] ${cls}`}>{label}</span>
  );
}

export function MarketDiagnosisCard({ klineData, emotionEntry }: MarketDiagnosisCardProps) {
  const { ma20, ma60 } = getMaTrend(klineData);
  const state = emotionEntry?.state ?? null;
  const positionLimit = emotionEntry?.positionLimit ?? null;

  return (
    <Card className="border-border/40 bg-card/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
          大盘诊断
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-3">
        {/* MA trend */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-muted-foreground">MA20</span>
            <TrendBadge trend={ma20} />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-muted-foreground">MA60</span>
            <TrendBadge trend={ma60} />
          </div>
        </div>

        <div className="border-t border-border/30" />

        {/* Emotion state */}
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-muted-foreground">当日情绪</span>
          {state ? (
            <span className={`font-mono text-[15px] font-semibold ${EMOTION_COLOR[state]}`}>
              {state}
            </span>
          ) : (
            <span className="font-mono text-[13px] text-muted-foreground">—</span>
          )}
        </div>

        <div className="border-t border-border/30" />

        {/* Position advice */}
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-muted-foreground">仓位建议</span>
          <span className="font-mono text-[12px] text-foreground">
            {state ? POSITION_ADVICE[state] : '—'}
          </span>
          {positionLimit !== null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              上限 {Math.round(positionLimit * 100)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
