import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import type { ZtPoolEntry, ZtPoolResponse } from '../../types/api';
import { useAppContext } from '../../context/AppContext';

function qualityScore(entry: ZtPoolEntry): number {
  // Higher seal_amount and fewer failed_seals = better quality
  return entry.seal_amount / Math.max(1, entry.failed_seals + 1);
}

function QualityBadge({ entry }: { entry: ZtPoolEntry }) {
  const score = qualityScore(entry);
  const label = score > 5e7 ? '强' : score > 1e7 ? '中' : '弱';
  const cls =
    label === '强'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : label === '中'
      ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
      : 'bg-red-500/15 text-red-400 border-red-500/30';
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{label}</span>;
}

function EntryRow({
  entry,
  isLeader,
}: {
  entry: ZtPoolEntry;
  isLeader: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0 text-[11px] font-mono">
      <span className="w-16 text-primary/80 shrink-0">{entry.code}</span>
      <span className="flex-1 truncate text-foreground">{entry.name}</span>
      {isLeader && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 border-yellow-500/40 text-yellow-400 shrink-0">
          龙头
        </Badge>
      )}
      <QualityBadge entry={entry} />
      <span className="w-20 truncate text-muted-foreground text-right shrink-0" title={entry.concepts}>
        {entry.concepts?.split(',')[0] ?? '—'}
      </span>
    </div>
  );
}

function PoolSection({
  title,
  entries,
  maxDays,
}: {
  title: string;
  entries: ZtPoolEntry[];
  maxDays: number;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {title}（{entries.length}）
      </div>
      {entries.map((e) => (
        <EntryRow key={e.code} entry={e} isLeader={e.continuous_days === maxDays && e.continuous_days > 1} />
      ))}
    </div>
  );
}

export function ZtPoolTracker() {
  const { selectedDate } = useAppContext();
  const [data, setData] = useState<ZtPoolResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    setEmpty(false);

    fetch(`http://localhost:3001/api/ztpool?date=${selectedDate}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          setData(json.data as ZtPoolResponse);
          const total =
            (json.data.ztpool?.count ?? 0) +
            (json.data.zbgcpool?.count ?? 0);
          setEmpty(total === 0);
        } else {
          setData(null);
          setEmpty(true);
        }
      })
      .catch(() => {
        setData(null);
        setEmpty(true);
        toast.error('加载涨停池数据失败', { description: `日期：${selectedDate}` });
      })
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const ztRows: ZtPoolEntry[] = data?.ztpool?.rows ?? [];
  const zbRows: ZtPoolEntry[] = data?.zbgcpool?.rows ?? [];

  // Separate first-board (continuous_days === 1) and multi-board
  const firstBoard = ztRows.filter((e) => e.continuous_days <= 1);
  const multiBoard = ztRows.filter((e) => e.continuous_days > 1).sort((a, b) => b.continuous_days - a.continuous_days);
  const maxDays = multiBoard[0]?.continuous_days ?? 0;

  return (
    <Card className="border-border/40 bg-card/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
          涨停板热点
          {selectedDate && <span className="ml-2 text-primary/70">{selectedDate}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading && (
          <div className="text-center font-mono text-[11px] text-muted-foreground animate-pulse py-4">
            加载中…
          </div>
        )}

        {!loading && empty && (
          <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
            <span className="font-mono text-[12px] text-muted-foreground">该日无涨停数据</span>
          </div>
        )}

        {!loading && !empty && (
          <div className="flex flex-col gap-4 max-h-80 overflow-y-auto pr-1">
            <PoolSection title="连板" entries={multiBoard} maxDays={maxDays} />
            <PoolSection title="首板" entries={firstBoard} maxDays={0} />
            {zbRows.length > 0 && (
              <PoolSection title="炸板回封" entries={zbRows} maxDays={0} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
