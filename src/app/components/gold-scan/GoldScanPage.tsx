import { useState, useRef, useCallback, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';

interface ScanHit {
  tsCode: string;
  code: string;
  name: string;
  date: string;
  divergenceScore: number;
  largeNet: number | null;  // 万元
  pctChange: number | null;
  ret3d: number | null;
  ret5d: number | null;
  ret10d: number | null;
}

interface DateGroup {
  date: string;
  hits: ScanHit[];
  avg3d: number | null;
  avg5d: number | null;
  avg10d: number | null;
  winRate5d: number | null;
}

function todayCompact() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function pct(v: number | null, digits = 2) {
  if (v === null) return <span className="text-muted-foreground/30">—</span>;
  const p = v * 100;
  const c = p > 0 ? 'text-[#ff3366]' : p < 0 ? 'text-[#00ff88]' : 'text-muted-foreground';
  return <span className={`font-mono text-[12px] ${c}`}>{p >= 0 ? '+' : ''}{p.toFixed(digits)}%</span>;
}

function wan(v: number | null) {
  if (v === null) return <span className="text-muted-foreground/30">—</span>;
  // largeNet 已经是万元单位，直接显示
  const c = v > 0 ? 'text-[#ff3366]' : 'text-[#00ff88]';
  return <span className={`font-mono text-[12px] ${c}`}>{v >= 0 ? '+' : ''}{v.toFixed(0)}万</span>;
}

function DsBar({ score }: { score: number }) {
  const color = score >= 0.9 ? '#ffd60a' : '#ff8c00';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full" style={{ width: `${Math.min(score*100,100)}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[11px]" style={{ color }}>{score.toFixed(4)}</span>
    </div>
  );
}

// ─── 按日期聚合 ───────────────────────────────────────────────────────────────

function groupByDate(hits: ScanHit[]): DateGroup[] {
  const map = new Map<string, ScanHit[]>();
  for (const h of hits) {
    if (!map.has(h.date)) map.set(h.date, []);
    map.get(h.date)!.push(h);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayHits]) => {
      const with5 = dayHits.filter(h => h.ret5d !== null);
      const with3 = dayHits.filter(h => h.ret3d !== null);
      const with10 = dayHits.filter(h => h.ret10d !== null);
      return {
        date,
        hits: [...dayHits].sort((a, b) => b.divergenceScore - a.divergenceScore),
        avg3d:  with3.length  ? with3.reduce((s,h)=>s+h.ret3d!,0)/with3.length   : null,
        avg5d:  with5.length  ? with5.reduce((s,h)=>s+h.ret5d!,0)/with5.length   : null,
        avg10d: with10.length ? with10.reduce((s,h)=>s+h.ret10d!,0)/with10.length : null,
        winRate5d: with5.length ? with5.filter(h=>h.ret5d!>0).length/with5.length : null,
      };
    });
}

// ─── 日期行（可折叠）─────────────────────────────────────────────────────────

function DateRow({ group, onNavigate }: { group: DateGroup; onNavigate: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const wr = group.winRate5d;
  const wrColor = wr === null ? '' : wr >= 0.6 ? 'text-[#00ff88]' : wr >= 0.4 ? 'text-[#f59e0b]' : 'text-[#ff3366]';

  return (
    <div className="border-b border-border/50 last:border-0">
      {/* 日期摘要行 */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
      >
        <span className="w-[100px] font-mono text-[13px] font-bold text-foreground">{group.date}</span>
        <span className="w-[52px] text-center font-mono text-[12px] text-[#ffd60a]">{group.hits.length} 只</span>
        <span className="w-[80px] text-right font-mono text-[11px] text-muted-foreground">
          胜率 <span className={`font-bold ${wrColor}`}>
            {wr !== null ? `${(wr*100).toFixed(0)}%` : '—'}
          </span>
        </span>
        <span className="w-[80px] text-right font-mono text-[11px] text-muted-foreground">
          3日 {pct(group.avg3d, 1)}
        </span>
        <span className="w-[80px] text-right font-mono text-[11px] text-muted-foreground">
          5日 {pct(group.avg5d, 1)}
        </span>
        <span className="w-[80px] text-right font-mono text-[11px] text-muted-foreground">
          10日 {pct(group.avg10d, 1)}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/50">{open ? '▲' : '▼'}</span>
      </button>

      {/* 展开：个股明细 */}
      {open && (
        <div className="border-t border-border/30 bg-secondary/10">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                {['名称', '代码', '当日跌幅', '大单净流入', 'DS', '3日', '5日', '10日', ''].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.hits.map((hit, i) => (
                <tr key={`${hit.tsCode}-${i}`} className="border-b border-border/20 hover:bg-secondary/20">
                  <td className="px-3 py-2 font-mono text-[12px] font-semibold text-foreground">{hit.name}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{hit.code}</td>
                  <td className="px-3 py-2">{pct(hit.pctChange)}</td>
                  <td className="px-3 py-2">{wan(hit.largeNet)}</td>
                  <td className="px-3 py-2"><DsBar score={hit.divergenceScore} /></td>
                  <td className="px-3 py-2">{pct(hit.ret3d)}</td>
                  <td className="px-3 py-2">{pct(hit.ret5d)}</td>
                  <td className="px-3 py-2">{pct(hit.ret10d)}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onNavigate(hit.code)}
                      className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary hover:bg-primary/20">
                      K线
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 总体统计 ─────────────────────────────────────────────────────────────────

function GlobalStats({ hits }: { hits: ScanHit[] }) {
  const with5 = hits.filter(h => h.ret5d !== null);
  if (!with5.length) return null;
  const wr = with5.filter(h => h.ret5d! > 0).length / with5.length;
  const avg5 = with5.reduce((s,h)=>s+h.ret5d!,0)/with5.length;
  const with3 = hits.filter(h => h.ret3d !== null);
  const avg3 = with3.length ? with3.reduce((s,h)=>s+h.ret3d!,0)/with3.length : 0;
  return (
    <div className="grid grid-cols-4 gap-3">
      {[
        { label: '总信号数', value: String(hits.length), color: '#ffd60a' },
        { label: '5日胜率',  value: `${(wr*100).toFixed(1)}%`, color: wr>=0.6?'#00ff88':wr>=0.4?'#f59e0b':'#ff3366' },
        { label: '5日均涨',  value: `${avg5>=0?'+':''}${(avg5*100).toFixed(2)}%`, color: avg5>=0?'#ff3366':'#00ff88' },
        { label: '3日均涨',  value: `${avg3>=0?'+':''}${(avg3*100).toFixed(2)}%`, color: avg3>=0?'#ff3366':'#00ff88' },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="mt-1 font-mono text-[22px] font-bold" style={{ color }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── 进度条 ───────────────────────────────────────────────────────────────────

function ProgressBar({ scanned, total, hits }: { scanned: number; total: number; hits: number }) {
  const pct = total > 0 ? (scanned / total) * 100 : 0;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
        <span className="text-muted-foreground">扫描中… <span className="text-foreground">{scanned}</span> / {total}</span>
        <span>命中 <span className="font-bold text-[#ffd60a]">{hits}</span> 条</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-[#ffd60a] transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function GoldScanPage() {
  const { navigateToStock } = useAppContext();

  const [date, setDate]           = useState(todayCompact);
  const [threshold, setThreshold] = useState(0.81);
  const [mode, setMode]           = useState<'single' | 'history'>('single');
  const [scanning, setScanning]   = useState(false);
  const [progress, setProgress]   = useState({ scanned: 0, total: 0, hits: 0 });
  const [hits, setHits]           = useState<ScanHit[]>([]);
  const [done, setDone]           = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const groups = useMemo(() => groupByDate(hits), [hits]);

  const stopScan = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setScanning(false);
  }, []);

  const startScan = useCallback(() => {
    esRef.current?.close();
    setHits([]);
    setDone(false);
    setFromCache(false);
    setError(null);
    setProgress({ scanned: 0, total: 0, hits: 0 });
    setScanning(true);

    const url = mode === 'single'
      ? `http://localhost:3001/api/gold-scan?date=${date}&threshold=${threshold}`
      : `http://localhost:3001/api/gold-scan/history?threshold=${threshold}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('start', (e) => {
      const d = JSON.parse(e.data);
      setProgress(p => ({ ...p, total: d.total }));
      if (d.fromCache) setFromCache(true);
    });
    es.addEventListener('hit', (e) => {
      setHits(prev => [...prev, JSON.parse(e.data)]);
    });
    es.addEventListener('progress', (e) => {
      const d = JSON.parse(e.data);
      setProgress({ scanned: d.scanned, total: d.total, hits: d.hits });
    });
    es.addEventListener('done', (e) => {
      const d = JSON.parse(e.data);
      if (d.fromCache) setFromCache(true);
      setDone(true);
      setScanning(false);
      es.close();
      esRef.current = null;
    });
    es.onerror = () => {
      setError('连接中断，请重试');
      setScanning(false);
      es.close();
      esRef.current = null;
    };
  }, [date, threshold, mode]);

  return (
    <div className="flex flex-col gap-4">
      {/* 控制栏 */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="font-mono text-[13px] font-bold tracking-[0.12em] text-[#ffd60a]">◆ 金柱选股</span>
          <span className="font-mono text-[10px] text-muted-foreground">底背离扫描 · 全量 1825 只 · DS ≥ {threshold.toFixed(2)}</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(['single', 'history'] as const).map(m => (
              <button key={m} type="button" onClick={() => !scanning && setMode(m)}
                className={`px-4 py-2 font-mono text-[11px] transition ${mode===m?'bg-primary/15 text-primary':'text-muted-foreground hover:text-foreground'} ${scanning?'cursor-not-allowed opacity-50':''}`}>
                {m === 'single' ? '指定日期' : '全历史统计'}
              </button>
            ))}
          </div>

          {mode === 'single' && (
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-muted-foreground">扫描日期</label>
              <input type="text" maxLength={8} placeholder="YYYYMMDD" value={date}
                onChange={e => setDate(e.target.value.replace(/\D/g,''))} disabled={scanning}
                className="w-[120px] rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[12px] outline-none focus:border-primary disabled:opacity-50" />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] text-muted-foreground">
              DS 阈值 <span className="text-[#ffd60a]">{threshold.toFixed(2)}</span>
              <span className="ml-1 text-muted-foreground/50">{threshold>=0.81?'严格':'宽松'}</span>
            </label>
            <input type="range" min="0.5" max="0.95" step="0.01" value={threshold}
              onChange={e => setThreshold(Number(e.target.value))} disabled={scanning}
              className="w-[140px] cursor-pointer disabled:opacity-50" />
          </div>

          {!scanning ? (
            <button type="button" onClick={startScan}
              className="rounded-md bg-[#ffd60a] px-6 py-2 font-mono text-[12px] font-bold text-[#08121c] hover:bg-[#ffe040]">
              开始扫描
            </button>
          ) : (
            <button type="button" onClick={stopScan}
              className="rounded-md border border-destructive/50 bg-destructive/10 px-6 py-2 font-mono text-[12px] text-destructive hover:bg-destructive/20">
              停止
            </button>
          )}
        </div>
      </div>

      {scanning && <ProgressBar scanned={progress.scanned} total={progress.total} hits={progress.hits} />}
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">{error}</div>}

      {hits.length > 0 && (
        <div className="flex flex-col gap-3">
          <GlobalStats hits={hits} />

          {fromCache && (
            <div className="flex items-center justify-between rounded-lg border border-[#ffd60a]/20 bg-[#ffd60a]/5 px-4 py-2">
              <span className="font-mono text-[11px] text-[#ffd60a]/80">已从本地缓存加载，无需重新计算</span>
              <button type="button"
                onClick={() => {
                  const url = `http://localhost:3001/api/gold-scan/history?threshold=${threshold}&force=1`;
                  esRef.current?.close();
                  setHits([]); setDone(false); setFromCache(false);
                  setProgress({ scanned: 0, total: 0, hits: 0 });
                  setScanning(true);
                  const es = new EventSource(url);
                  esRef.current = es;
                  es.addEventListener('hit', (e) => setHits(prev => [...prev, JSON.parse(e.data)]));
                  es.addEventListener('progress', (e) => { const d=JSON.parse(e.data); setProgress({scanned:d.scanned,total:d.total,hits:d.hits}); });
                  es.addEventListener('done', () => { setDone(true); setScanning(false); es.close(); });
                  es.onerror = () => { setScanning(false); es.close(); };
                }}
                className="font-mono text-[10px] text-muted-foreground underline hover:text-foreground">
                强制重新计算
              </button>
            </div>
          )}

          {/* 历史模式：按日期折叠 */}
          {mode === 'history' ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center gap-4 border-b border-border bg-secondary/40 px-4 py-2.5">
                <span className="w-[100px] font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">日期</span>
                <span className="w-[52px] font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">命中</span>
                <span className="w-[80px] text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">5日胜率</span>
                <span className="w-[80px] text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">3日均涨</span>
                <span className="w-[80px] text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">5日均涨</span>
                <span className="w-[80px] text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">10日均涨</span>
              </div>
              {groups.map(g => (
                <DateRow key={g.date} group={g} onNavigate={navigateToStock} />
              ))}
            </div>
          ) : (
            /* 单日模式：直接展示个股表格 */
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    {['名称', '代码', '当日跌幅', '大单净流入', 'DS', '3日', '5日', '10日', ''].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...hits].sort((a,b)=>b.divergenceScore-a.divergenceScore).map((hit, i) => (
                    <tr key={`${hit.tsCode}-${i}`} className="border-b border-border/40 hover:bg-secondary/30">
                      <td className="px-3 py-2.5 font-mono text-[12px] font-semibold text-foreground">{hit.name}</td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{hit.code}</td>
                      <td className="px-3 py-2.5">{pct(hit.pctChange)}</td>
                      <td className="px-3 py-2.5">{wan(hit.largeNet)}</td>
                      <td className="px-3 py-2.5"><DsBar score={hit.divergenceScore} /></td>
                      <td className="px-3 py-2.5">{pct(hit.ret3d)}</td>
                      <td className="px-3 py-2.5">{pct(hit.ret5d)}</td>
                      <td className="px-3 py-2.5">{pct(hit.ret10d)}</td>
                      <td className="px-3 py-2.5">
                        <button type="button" onClick={() => navigateToStock(hit.code)}
                          className="rounded border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] text-primary hover:bg-primary/20">
                          K线 →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {done && hits.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center font-mono text-[12px] text-muted-foreground">
          {mode === 'single' ? `${date} 无金柱信号（DS ≥ ${threshold}）` : '历史无触发记录'}
        </div>
      )}

      {!scanning && !done && (
        <div className="rounded-lg border border-border/40 bg-card/50 p-5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <div className="mb-2 font-semibold text-[#ffd60a]">◆ 金柱信号说明</div>
          <p>DS = 价格跌幅分位 × 大单净流入分位，两者均在过去60日排名前10%时触发（DS &gt; 0.81）。</p>
          <p className="mt-1 text-muted-foreground/60">全历史统计：首次计算约需30秒，结果自动缓存到本地，下次秒开。</p>
        </div>
      )}
    </div>
  );
}
