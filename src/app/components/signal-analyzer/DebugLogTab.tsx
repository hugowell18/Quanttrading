interface DebugLogTabProps {
  requestLog: string[];
  priceView: string;
  tradeCount: number;
  markerCount: number;
}

export function DebugLogTab({ requestLog, priceView, tradeCount, markerCount }: DebugLogTabProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">Debug Log</div>
      <div className="space-y-2 font-mono text-[11px] text-muted-foreground">
        <div className="break-all rounded border border-border bg-secondary/30 px-3 py-2">
          {`[view] priceView=${priceView} trades=${tradeCount} markers=${markerCount}`}
        </div>
        {requestLog.map((line, index) => (
          <div key={`${line.slice(0, 40)}-${index}`} className="break-all rounded border border-border bg-secondary/30 px-3 py-2">
            {line}
          </div>
        ))}
        {requestLog.length === 0 && (
          <div className="py-8 text-center text-muted-foreground/50">暂无请求日志</div>
        )}
      </div>
    </div>
  );
}
