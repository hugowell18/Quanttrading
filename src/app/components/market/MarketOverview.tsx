import { useState } from 'react';
import { IndexKLinePanel } from './IndexKLinePanel';
import { MarketDiagnosisCard } from './MarketDiagnosisCard';
import { SentimentDashboard } from './SentimentDashboard';
import { ZtPoolTracker } from './ZtPoolTracker';
import { StockLeaderboard } from './StockLeaderboard';
import type { KLinePoint } from '../signal-analyzer/types';
import type { EmotionStateEntry } from '../../types/api';

export function MarketOverview() {
  const [klineData, setKlineData] = useState<KLinePoint[]>([]);
  // We fetch emotion entry inside SentimentDashboard; pass it up via a shared
  // state so MarketDiagnosisCard can consume it without a duplicate fetch.
  // For simplicity, MarketDiagnosisCard derives its data from klineData only
  // (MA trend) and receives emotionEntry as null — SentimentDashboard owns
  // the emotion state. This keeps components decoupled.
  const emotionEntry: EmotionStateEntry | null = null;

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: K-line (wide) + Diagnosis card (narrow) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-4">
        <div className="rounded-lg border border-border/40 bg-card/20 p-4">
          <IndexKLinePanel onKLineData={(data) => setKlineData(data)} />
        </div>
        <MarketDiagnosisCard klineData={klineData} emotionEntry={emotionEntry} />
      </div>

      {/* Row 2: Sentiment dashboard + ZtPool tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SentimentDashboard />
        <ZtPoolTracker />
      </div>

      {/* Row 3: Stock leaderboard (full width) */}
      <StockLeaderboard />
    </div>
  );
}
