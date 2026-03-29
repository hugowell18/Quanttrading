import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { BatchSummaryItem } from '../../types/api';
import { useAppContext } from '../../context/AppContext';

function SignalBadge({ signal }: { signal?: 'buy' | 'sell' | 'hold' }) {
  if (!signal) return <span className="font-mono text-[10px] text-muted-foreground">—</span>;
  const map = {
    buy: 'text-green-400 bg-green-500/10 border-green-500/30',
    sell: 'text-red-400 bg-red-500/10 border-red-500/30',
    hold: 'text-muted-foreground bg-muted/10 border-border/30',
  };
  const label = { buy: 'BUY', sell: 'SELL', hold: 'HOLD' };
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${map[signal]}`}>
      {label[signal]}
    </span>
  );
}

export function StockLeaderboard() {
  const { navigateToStock } = useAppContext();
  const [items, setItems] = useState<BatchSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('http://localhost:3001/api/batch/summary')
      .then((r) => r.json())
      .then((json) => {
        const raw: BatchSummaryItem[] = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json)
          ? json
          : [];
        // winRate/avgReturn live inside bestResult — normalize to top level
        const normalized = raw
          .filter((item) => item.strictPass === true)
          .map((item) => ({
            ...item,
            winRate: item.winRate ?? (item as any).bestResult?.winRate ?? 0,
            avgReturn: item.avgReturn ?? (item as any).bestResult?.avgReturn ?? 0,
            currentSignal: item.currentSignal ?? (item as any).currentSignal ?? undefined,
          }));
        setItems(normalized);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card className="border-border/40 bg-card/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
          量化龙虎榜
          <span className="ml-2 text-[10px] text-muted-foreground/60">双击跳转复盘</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading && (
          <div className="text-center font-mono text-[11px] text-muted-foreground animate-pulse py-4">
            加载中…
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
            <span className="font-mono text-[12px] text-muted-foreground">暂无通过严格筛选的个股</span>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="flex flex-col max-h-72 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center gap-2 py-1 border-b border-border/40 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              <span className="w-16 shrink-0">代码</span>
              <span className="flex-1">名称</span>
              <span className="w-12 text-right shrink-0">胜率</span>
              <span className="w-14 text-right shrink-0">均收益</span>
              <span className="w-14 text-right shrink-0">信号</span>
            </div>
            {items.map((item) => (
              <div
                key={item.stockCode}
                onDoubleClick={() => navigateToStock(item.stockCode)}
                className="flex items-center gap-2 py-1.5 border-b border-border/15 last:border-0 font-mono text-[11px] cursor-pointer hover:bg-white/3 rounded transition-colors"
              >
                <span className="w-16 text-primary/80 shrink-0">{item.stockCode}</span>
                <span className="flex-1 truncate text-foreground">{item.stockName ?? '—'}</span>
                <span className="w-12 text-right shrink-0 text-foreground">
                  {(item.winRate * 100).toFixed(1)}%
                </span>
                <span
                  className={`w-14 text-right shrink-0 ${
                    item.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {item.avgReturn >= 0 ? '+' : ''}
                  {(item.avgReturn * 100).toFixed(2)}%
                </span>
                <span className="w-14 flex justify-end shrink-0">
                  <SignalBadge signal={item.currentSignal} />
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
