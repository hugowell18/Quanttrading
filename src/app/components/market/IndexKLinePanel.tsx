import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { KLineChart } from '../signal-analyzer/KLineChart';
import type { KLinePoint } from '../signal-analyzer/types';
import type { IndexKLinePoint } from '../../types/api';
import { useAppContext } from '../../context/AppContext';

const INDICES = [
  { code: '000300.SH', name: '沪深300' },
  { code: '000001.SH', name: '上证综指' },
  { code: '399001.SZ', name: '深证成指' },
  { code: '399006.SZ', name: '创业板指' },
] as const;

type IndexCode = (typeof INDICES)[number]['code'];

// Convert IndexKLinePoint to KLinePoint (fill optional fields with 0)
function toKLinePoint(p: IndexKLinePoint): KLinePoint {
  return {
    date: p.date,
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: p.volume,
    k: 0, d: 0, j: 0,
    dif: 0, dea: 0, macd: 0,
    rsi: 0, ma5: 0, ma10: 0, ma20: 0,
  };
}

interface IndexKLinePanelProps {
  onKLineData?: (data: KLinePoint[], code: string) => void;
}

export function IndexKLinePanel({ onKLineData }: IndexKLinePanelProps) {
  const { setSelectedDate } = useAppContext();
  const [activeIndex, setActiveIndex] = useState<IndexCode>('000300.SH');
  const [klineData, setKlineData] = useState<KLinePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const lastDataRef = useRef<KLinePoint[]>([]);

  async function fetchKLine(code: IndexCode) {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/market/kline/${code}`);
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        const points = (json.data as IndexKLinePoint[]).map(toKLinePoint);
        setKlineData(points);
        lastDataRef.current = points;
        onKLineData?.(points, code);
      } else {
        throw new Error(json.error ?? '数据格式错误');
      }
    } catch (err) {
      toast.error(`加载 ${code} K线失败`, {
        description: err instanceof Error ? err.message : String(err),
      });
      // Restore last successful data
      if (lastDataRef.current.length > 0) {
        setKlineData(lastDataRef.current);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchKLine(activeIndex);
  }, [activeIndex]);

  function handleIndexSwitch(code: IndexCode) {
    setActiveIndex(code);
  }

  // KLineChart exposes onCandleClick; clicking a candle sets selectedDate in AppContext
  // so that SentimentDashboard and ZtPoolTracker refresh for that date.
  function handleCandleClick(date: string) {
    setSelectedDate(date);
  }

  const activeLabel = INDICES.find((i) => i.code === activeIndex)?.name ?? activeIndex;

  return (
    <div className="flex flex-col gap-3">
      {/* Index switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        {INDICES.map((idx) => (
          <button
            key={idx.code}
            onClick={() => handleIndexSwitch(idx.code)}
            className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-all duration-150 ${
              activeIndex === idx.code
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border/50 bg-card/30 text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            {idx.name}
            <span className="ml-1 opacity-60">{idx.code}</span>
          </button>
        ))}
        {loading && (
          <span className="font-mono text-[11px] text-muted-foreground animate-pulse ml-2">
            加载中…
          </span>
        )}
      </div>

      {/* K-line chart */}
      <div className="rounded-lg border border-border/40 bg-card/20 overflow-hidden">
        {klineData.length > 0 ? (
          <KLineChart
            klineData={klineData}
            signalMarkers={[]}
            stockCode={activeIndex}
            stockName={activeLabel}
            onCandleClick={handleCandleClick}
          />
        ) : (
          <div className="flex items-center justify-center h-48 text-muted-foreground font-mono text-sm">
            {loading ? '加载中…' : '暂无K线数据'}
          </div>
        )}
      </div>
    </div>
  );
}
