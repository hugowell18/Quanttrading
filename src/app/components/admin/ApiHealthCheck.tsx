import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';

// ─── Types ─────────────────────────────────────────────────

interface RequestRecord {
  path: string;
  duration: number;
  status: number | null;
}

type HealthStatus = 'online' | 'offline' | 'checking';

// ─── Status badge ───────────────────────────────────────────

function StatusBadge({ status }: { status: HealthStatus }) {
  if (status === 'checking') {
    return (
      <Badge className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400 font-mono text-[11px] px-2 py-0.5">
        检测中…
      </Badge>
    );
  }
  if (status === 'online') {
    return (
      <Badge className="border-green-500/40 bg-green-500/10 text-green-400 font-mono text-[11px] px-2 py-0.5">
        ● 在线
      </Badge>
    );
  }
  return (
    <Badge className="border-red-500/40 bg-red-500/10 text-red-400 font-mono text-[11px] px-2 py-0.5">
      ● 离线
    </Badge>
  );
}

// ─── Main component ────────────────────────────────────────

export function ApiHealthCheck() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('checking');
  const [history, setHistory] = useState<RequestRecord[]>([]);

  const checkHealth = useCallback(async () => {
    setHealthStatus('checking');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const start = Date.now();

    try {
      const res = await fetch('http://localhost:3001/api/status', {
        signal: controller.signal,
      });
      const duration = Date.now() - start;
      clearTimeout(timeoutId);

      const record: RequestRecord = {
        path: '/api/status',
        duration,
        status: res.status,
      };

      setHistory((prev) => [record, ...prev].slice(0, 10));
      setHealthStatus(res.ok ? 'online' : 'offline');
    } catch {
      const duration = Date.now() - start;
      clearTimeout(timeoutId);

      const record: RequestRecord = {
        path: '/api/status',
        duration,
        status: null,
      };

      setHistory((prev) => [record, ...prev].slice(0, 10));
      setHealthStatus('offline');
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return (
    <Card className="border-border/40 bg-card/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <CardTitle className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
              API 健康检测
            </CardTitle>
            <StatusBadge status={healthStatus} />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={checkHealth}
            disabled={healthStatus === 'checking'}
            className="h-7 font-mono text-[11px] border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
          >
            重新检测
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {history.length === 0 ? (
          <div className="flex items-center justify-center py-8 rounded-lg border border-border/30 bg-muted/10">
            <span className="font-mono text-[12px] text-muted-foreground">暂无请求记录</span>
          </div>
        ) : (
          <div className="rounded-md border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="font-mono text-[11px] text-muted-foreground h-8 px-3">路径</TableHead>
                  <TableHead className="font-mono text-[11px] text-muted-foreground h-8 px-3 text-right">耗时(ms)</TableHead>
                  <TableHead className="font-mono text-[11px] text-muted-foreground h-8 px-3 text-right">状态码</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((record, idx) => {
                  const isSlow = record.duration >= 5000;
                  const isFailed = record.status === null || record.status >= 400;
                  const rowBad = isSlow || isFailed;

                  return (
                    <TableRow
                      key={idx}
                      className={`border-border/20 ${rowBad ? 'bg-red-500/5' : ''}`}
                    >
                      <TableCell className="font-mono text-[11px] px-3 py-2 text-foreground/80">
                        {record.path}
                      </TableCell>
                      <TableCell
                        className={`font-mono text-[11px] px-3 py-2 text-right ${
                          isSlow ? 'text-red-400' : 'text-foreground/80'
                        }`}
                      >
                        {record.duration}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] px-3 py-2 text-right">
                        {record.status === null ? (
                          <span className="text-red-400">超时/失败</span>
                        ) : (
                          <span className={record.status >= 400 ? 'text-red-400' : 'text-green-400'}>
                            {record.status}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
