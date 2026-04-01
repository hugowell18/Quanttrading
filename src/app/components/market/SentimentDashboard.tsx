import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { SentimentMetrics, EmotionStateEntry, EmotionState } from '../../types/api';
import { useAppContext } from '../../context/AppContext';

const EMOTION_BG: Record<EmotionState, string> = {
  冰点: 'bg-blue-500/70',
  启动: 'bg-yellow-400/70',
  主升: 'bg-orange-400/70',
  高潮: 'bg-red-500/70',
  退潮: 'bg-purple-500/70',
};

const EMOTION_TEXT: Record<EmotionState, string> = {
  冰点: 'text-blue-300',
  启动: 'text-yellow-300',
  主升: 'text-orange-300',
  高潮: 'text-red-300',
  退潮: 'text-purple-300',
};

function HeatGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  // SVG arc gauge: half-circle from 180° to 0°
  const r = 44;
  const cx = 56;
  const cy = 56;
  const startAngle = Math.PI; // 180°
  const endAngle = 0;
  const totalAngle = Math.PI;
  const angle = startAngle - (clamped / 100) * totalAngle;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  const largeArc = clamped > 50 ? 1 : 0;

  const trackPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fillPath = clamped === 0
    ? ''
    : `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`;

  const color =
    clamped < 30 ? '#60a5fa' : clamped < 60 ? '#facc15' : clamped < 80 ? '#fb923c' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="112" height="64" viewBox="0 0 112 64">
        <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round" />
        {fillPath && (
          <path d={fillPath} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="18" fontWeight="bold" fontFamily="monospace">
          {clamped}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">
          热度分
        </text>
      </svg>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/20 last:border-0">
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[12px] text-foreground">{value}</span>
    </div>
  );
}

export function SentimentDashboard() {
  const { selectedDate } = useAppContext();
  const [metrics, setMetrics] = useState<SentimentMetrics | null>(null);
  const [history, setHistory] = useState<EmotionStateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    setEmpty(false);

    Promise.all([
      fetch(`http://localhost:3001/api/sentiment/metrics?date=${selectedDate}`).then((r) => r.json()),
      fetch('http://localhost:3001/api/sentiment/state-history').then((r) => r.json()),
    ])
      .then(([metricsJson, historyJson]) => {
        if (metricsJson.ok && metricsJson.data) {
          setMetrics(metricsJson.data as SentimentMetrics);
        } else {
          setMetrics(null);
          setEmpty(true);
        }
        if (historyJson.ok && Array.isArray(historyJson.data)) {
          setHistory(historyJson.data as EmotionStateEntry[]);
        }
      })
      .catch(() => {
        setMetrics(null);
        setEmpty(true);
        toast.error('加载情绪数据失败', { description: `日期：${selectedDate}` });
      })
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const recentHistory = history.slice(-20);
  const currentEntry = history.find((e) => e.date === selectedDate) ?? null;
  const heatScore = currentEntry?.heatScore ?? 0;

  return (
    <Card className="border-border/40 bg-card/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
          情绪仪表盘
          {selectedDate && (
            <span className="ml-2 text-primary/70">{selectedDate}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-4">
        {loading && (
          <div className="text-center font-mono text-[11px] text-muted-foreground animate-pulse py-4">
            加载中…
          </div>
        )}

        {!loading && empty && (
          <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
            <span className="font-mono text-[12px] text-muted-foreground">暂无该日情绪数据</span>
          </div>
        )}

        {!loading && metrics && (
          <>
            {/* Heat gauge */}
            <div className="flex justify-center">
              <HeatGauge score={heatScore} />
            </div>

            {/* 6 metrics */}
            <div className="flex flex-col">
              <MetricRow label="涨停家数" value={`${metrics.ztCount}（一字${metrics.yiziCount} / 非一字${metrics.nonYiziCount}）`} />
              <MetricRow label="连板高度" value={`${metrics.maxContinuousDays} 板`} />
              <MetricRow label="炸板率" value={`${((metrics.zbRate ?? 0) * 100).toFixed(1)}%`} />
              <MetricRow label="涨跌停比" value={`${(metrics.ztDtRatio ?? 0).toFixed(2)}`} />
              <MetricRow label="封板率" value={`${((metrics.sealRate ?? 0) * 100).toFixed(1)}%`} />
              <MetricRow label="昨日涨停溢价" value={`${(metrics.prevZtPremium ?? 0).toFixed(2)}%`} />
            </div>
          </>
        )}

        {/* 20-day emotion timeline */}
        {recentHistory.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              近20日情绪时间轴
            </span>
            <div className="flex gap-0.5 flex-wrap">
              {recentHistory.map((entry) => (
                <div
                  key={entry.date}
                  title={`${entry.date} ${entry.state} 热度${entry.heatScore}`}
                  className={`h-5 w-5 rounded-sm ${EMOTION_BG[entry.state]} ${
                    entry.date === selectedDate ? 'ring-1 ring-white/60' : ''
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-3 flex-wrap mt-1">
              {(Object.keys(EMOTION_BG) as EmotionState[]).map((s) => (
                <div key={s} className="flex items-center gap-1">
                  <div className={`h-2.5 w-2.5 rounded-sm ${EMOTION_BG[s]}`} />
                  <span className={`font-mono text-[10px] ${EMOTION_TEXT[s]}`}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
