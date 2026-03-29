import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { useAppContext } from '../../context/AppContext';
import type { BatchSummaryItem, IndexKLinePoint, SentimentMetrics, ZtPoolEntry } from '../../types/api';

// ─── K线数据浏览器 ──────────────────────────────────────────

function KlineBrowser() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [rows, setRows] = useState<IndexKLinePoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('http://localhost:3001/api/admin/kline/list')
      .then((r) => r.json())
      .then((json) => {
        const list: string[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        setFiles(list);
      })
      .catch(() => setFiles([]));
  }, []);

  const handleSelect = (code: string) => {
    setSelected(code);
    setLoading(true);
    fetch(`http://localhost:3001/api/admin/kline/${code}`)
      .then((r) => r.json())
      .then((json) => {
        const data: IndexKLinePoint[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        setRows(data.slice(-30));
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-muted-foreground shrink-0">选择文件</span>
        <Select value={selected} onValueChange={handleSelect}>
          <SelectTrigger className="h-8 w-[220px] font-mono text-[11px] border-border/50 bg-card/50">
            <SelectValue placeholder="请选择 CSV 文件…" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {files.map((f) => (
              <SelectItem key={f} value={f} className="font-mono text-[11px]">{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {files.length === 0 && (
          <span className="font-mono text-[10px] text-muted-foreground/60">暂无文件</span>
        )}
      </div>

      {loading && (
        <div className="text-center font-mono text-[11px] text-muted-foreground animate-pulse py-6">加载中…</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="rounded-md border border-border/30 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/30 hover:bg-transparent">
                {['日期', '开盘', '最高', '最低', '收盘', '成交量'].map((h) => (
                  <TableHead key={h} className="font-mono text-[10px] text-muted-foreground h-8 px-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.date} className="border-border/20">
                  <TableCell className="font-mono text-[11px] px-3 py-1.5 text-muted-foreground">{r.date}</TableCell>
                  <TableCell className="font-mono text-[11px] px-3 py-1.5">{r.open.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-[11px] px-3 py-1.5 text-green-400">{r.high.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-[11px] px-3 py-1.5 text-red-400">{r.low.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-[11px] px-3 py-1.5">{r.close.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-[11px] px-3 py-1.5 text-muted-foreground">{r.volume.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && selected && rows.length === 0 && (
        <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
          <span className="font-mono text-[12px] text-muted-foreground">暂无数据</span>
        </div>
      )}
    </div>
  );
}

// ─── 涨停池数据浏览器 ───────────────────────────────────────

function ZtPoolBrowser() {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [entries, setEntries] = useState<ZtPoolEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('http://localhost:3001/api/admin/ztpool/list')
      .then((r) => r.json())
      .then((json) => {
        const list: string[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        setDates(list.sort());
      })
      .catch(() => setDates([]));
  }, []);

  const handleDateClick = (date: string) => {
    setSelectedDate(date);
    setLoading(true);
    fetch(`http://localhost:3001/api/ztpool?date=${date}`)
      .then((r) => r.json())
      .then((json) => {
        const pool = json?.ztpool?.rows ?? json?.data ?? [];
        setEntries(Array.isArray(pool) ? pool : []);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-4">
      {dates.length === 0 ? (
        <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
          <span className="font-mono text-[12px] text-muted-foreground">暂无涨停池数据</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <Button
              key={d}
              variant={selectedDate === d ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleDateClick(d)}
              className={`h-7 font-mono text-[10px] px-2 ${
                selectedDate === d
                  ? 'bg-primary text-primary-foreground'
                  : 'border-border/50 text-muted-foreground hover:text-foreground'
              }`}
            >
              {d}
            </Button>
          ))}
        </div>
      )}

      {loading && (
        <div className="text-center font-mono text-[11px] text-muted-foreground animate-pulse py-6">加载中…</div>
      )}

      {!loading && selectedDate && entries.length > 0 && (
        <div className="rounded-md border border-border/30 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/30 font-mono text-[11px] text-muted-foreground">
            {selectedDate} 涨停池 ({entries.length} 只)
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-border/30 hover:bg-transparent">
                {['代码', '名称', '连板天数', '概念'].map((h) => (
                  <TableHead key={h} className="font-mono text-[10px] text-muted-foreground h-8 px-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.code} className="border-border/20">
                  <TableCell className="font-mono text-[11px] px-3 py-1.5 text-primary/80">{e.code}</TableCell>
                  <TableCell className="font-mono text-[11px] px-3 py-1.5">{e.name}</TableCell>
                  <TableCell className="font-mono text-[11px] px-3 py-1.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      e.continuous_days >= 3 ? 'bg-orange-500/20 text-orange-400' :
                      e.continuous_days >= 2 ? 'bg-yellow-500/20 text-yellow-400' :
                      'text-muted-foreground'
                    }`}>
                      {e.continuous_days}板
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] px-3 py-1.5 text-muted-foreground max-w-[200px] truncate">{e.concepts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && selectedDate && entries.length === 0 && (
        <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
          <span className="font-mono text-[12px] text-muted-foreground">该日期暂无涨停池数据</span>
        </div>
      )}
    </div>
  );
}

// ─── 情绪指标浏览器 ─────────────────────────────────────────

function SentimentBrowser() {
  const [metrics, setMetrics] = useState<SentimentMetrics[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('http://localhost:3001/api/admin/sentiment/list')
      .then((r) => r.json())
      .then((json) => {
        const data: SentimentMetrics[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        setMetrics(data.slice(-60));
      })
      .catch(() => setMetrics([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center font-mono text-[11px] text-muted-foreground animate-pulse py-6">加载中…</div>;
  }

  if (metrics.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
        <span className="font-mono text-[12px] text-muted-foreground">暂无情绪指标数据</span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/30 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border/30 hover:bg-transparent">
            {['日期', '涨停数', '炸板率', '封板率', '连板高度'].map((h) => (
              <TableHead key={h} className="font-mono text-[10px] text-muted-foreground h-8 px-3">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...metrics].reverse().map((m) => (
            <TableRow key={m.date} className="border-border/20">
              <TableCell className="font-mono text-[11px] px-3 py-1.5 text-muted-foreground">{m.date}</TableCell>
              <TableCell className="font-mono text-[11px] px-3 py-1.5 text-green-400">{m.ztCount}</TableCell>
              <TableCell className={`font-mono text-[11px] px-3 py-1.5 ${m.zbRate > 0.3 ? 'text-red-400' : 'text-foreground'}`}>
                {(m.zbRate * 100).toFixed(1)}%
              </TableCell>
              <TableCell className={`font-mono text-[11px] px-3 py-1.5 ${m.sealRate > 0.7 ? 'text-green-400' : 'text-foreground'}`}>
                {(m.sealRate * 100).toFixed(1)}%
              </TableCell>
              <TableCell className="font-mono text-[11px] px-3 py-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                  m.maxContinuousDays >= 5 ? 'bg-orange-500/20 text-orange-400' :
                  m.maxContinuousDays >= 3 ? 'bg-yellow-500/20 text-yellow-400' :
                  'text-muted-foreground'
                }`}>
                  {m.maxContinuousDays}板
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── 回测结果浏览器 ─────────────────────────────────────────

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

function BacktestBrowser() {
  const { navigateToStock } = useAppContext();
  const [items, setItems] = useState<BatchSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('http://localhost:3001/api/batch/summary')
      .then((r) => r.json())
      .then((json) => {
        const data: BatchSummaryItem[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        setItems(data);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center font-mono text-[11px] text-muted-foreground animate-pulse py-6">加载中…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 rounded-lg border border-border/30 bg-muted/10">
        <span className="font-mono text-[12px] text-muted-foreground">暂无回测数据</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] text-muted-foreground/60">双击行跳转至个股分析</p>
      <div className="rounded-md border border-border/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/30 hover:bg-transparent">
              {['代码', '名称', '胜率', '均收益', '信号'].map((h) => (
                <TableHead key={h} className="font-mono text-[10px] text-muted-foreground h-8 px-3">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.stockCode}
                onDoubleClick={() => navigateToStock(item.stockCode)}
                className="border-border/20 cursor-pointer hover:bg-white/3 transition-colors"
              >
                <TableCell className="font-mono text-[11px] px-3 py-1.5 text-primary/80">{item.stockCode}</TableCell>
                <TableCell className="font-mono text-[11px] px-3 py-1.5">{item.stockName ?? '—'}</TableCell>
                <TableCell className="font-mono text-[11px] px-3 py-1.5">{(item.winRate * 100).toFixed(1)}%</TableCell>
                <TableCell className={`font-mono text-[11px] px-3 py-1.5 ${item.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {item.avgReturn >= 0 ? '+' : ''}{(item.avgReturn * 100).toFixed(2)}%
                </TableCell>
                <TableCell className="font-mono text-[11px] px-3 py-1.5">
                  <SignalBadge signal={item.currentSignal} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────

export function AdminDataBrowser() {
  return (
    <Card className="border-border/40 bg-card/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
          数据浏览器
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <Tabs defaultValue="kline">
          <TabsList className="h-8 bg-muted/20 border border-border/30 mb-4">
            <TabsTrigger value="kline" className="font-mono text-[11px] h-7 px-3 data-[state=active]:bg-card">
              K线数据
            </TabsTrigger>
            <TabsTrigger value="ztpool" className="font-mono text-[11px] h-7 px-3 data-[state=active]:bg-card">
              涨停池
            </TabsTrigger>
            <TabsTrigger value="sentiment" className="font-mono text-[11px] h-7 px-3 data-[state=active]:bg-card">
              情绪指标
            </TabsTrigger>
            <TabsTrigger value="backtest" className="font-mono text-[11px] h-7 px-3 data-[state=active]:bg-card">
              回测结果
            </TabsTrigger>
          </TabsList>

          <TabsContent value="kline">
            <KlineBrowser />
          </TabsContent>
          <TabsContent value="ztpool">
            <ZtPoolBrowser />
          </TabsContent>
          <TabsContent value="sentiment">
            <SentimentBrowser />
          </TabsContent>
          <TabsContent value="backtest">
            <BacktestBrowser />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
