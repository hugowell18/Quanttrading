import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAppContext } from '../../context/AppContext';
import type { DebugLog } from '../../types/api';

// ─── Level badge ───────────────────────────────────────────

function LevelBadge({ level }: { level: DebugLog['level'] }) {
  if (level === 'error') {
    return (
      <Badge className="border-red-500/40 bg-red-500/10 text-red-400 font-mono text-[9px] px-1.5 py-0.5">
        ERROR
      </Badge>
    );
  }
  if (level === 'warn') {
    return (
      <Badge className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400 font-mono text-[9px] px-1.5 py-0.5">
        WARN
      </Badge>
    );
  }
  return (
    <Badge className="border-blue-500/40 bg-blue-500/10 text-blue-400 font-mono text-[9px] px-1.5 py-0.5">
      INFO
    </Badge>
  );
}

// ─── Log entry row ─────────────────────────────────────────

function LogEntry({ log }: { log: DebugLog }) {
  const [expanded, setExpanded] = useState(false);
  const isError = log.level === 'error';
  const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <div
      className={`rounded-md border px-3 py-2 transition-colors ${
        isError
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-border/30 bg-card/20'
      }`}
    >
      <div
        className={`flex items-start gap-2 ${log.payload !== undefined ? 'cursor-pointer' : ''}`}
        onClick={() => log.payload !== undefined && setExpanded((v) => !v)}
      >
        {/* Timestamp */}
        <span className="font-mono text-[10px] text-muted-foreground/60 shrink-0 mt-0.5 w-[70px]">
          {time}
        </span>

        {/* Level badge */}
        <div className="shrink-0 mt-0.5">
          <LevelBadge level={log.level} />
        </div>

        {/* Module */}
        <span className="font-mono text-[10px] text-primary/70 shrink-0 mt-0.5 w-[100px] truncate">
          {log.module}
        </span>

        {/* Message */}
        <span
          className={`font-mono text-[11px] flex-1 leading-relaxed ${
            isError ? 'text-red-300' : 'text-foreground'
          }`}
        >
          {log.message}
        </span>

        {/* Expand indicator */}
        {log.payload !== undefined && (
          <span className="font-mono text-[10px] text-muted-foreground/40 shrink-0 mt-0.5">
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* Payload */}
      {expanded && log.payload !== undefined && (
        <pre className="mt-2 rounded bg-black/30 p-2 font-mono text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(log.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────

export function DebugLogPanel() {
  const { debugLogs, clearDebugLogs } = useAppContext();

  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  // Derive unique modules from logs
  const modules = useMemo(() => {
    const set = new Set(debugLogs.map((l) => l.module));
    return Array.from(set).sort();
  }, [debugLogs]);

  // Filter + reverse-chronological order
  const filtered = useMemo(() => {
    return [...debugLogs]
      .reverse()
      .filter((l) => levelFilter === 'all' || l.level === levelFilter)
      .filter((l) => moduleFilter === 'all' || l.module === moduleFilter);
  }, [debugLogs, levelFilter, moduleFilter]);

  return (
    <Card className="border-border/40 bg-card/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
            调试日志
            <span className="ml-2 text-primary/70">({debugLogs.length})</span>
          </CardTitle>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Level filter */}
            <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as typeof levelFilter)}>
              <SelectTrigger className="h-7 w-[90px] font-mono text-[11px] border-border/50 bg-card/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="font-mono text-[11px]">全部级别</SelectItem>
                <SelectItem value="info" className="font-mono text-[11px]">INFO</SelectItem>
                <SelectItem value="warn" className="font-mono text-[11px]">WARN</SelectItem>
                <SelectItem value="error" className="font-mono text-[11px]">ERROR</SelectItem>
              </SelectContent>
            </Select>

            {/* Module filter */}
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="h-7 w-[120px] font-mono text-[11px] border-border/50 bg-card/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="font-mono text-[11px]">全部模块</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono text-[11px]">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Clear button */}
            <Button
              variant="outline"
              size="sm"
              onClick={clearDebugLogs}
              className="h-7 font-mono text-[11px] border-border/50 text-muted-foreground hover:text-destructive hover:border-destructive/50"
            >
              清空日志
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8 rounded-lg border border-border/30 bg-muted/10">
            <span className="font-mono text-[12px] text-muted-foreground">
              {debugLogs.length === 0 ? '暂无日志' : '无匹配日志'}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-[600px] overflow-y-auto pr-1">
            {filtered.map((log) => (
              <LogEntry key={log.id} log={log} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
