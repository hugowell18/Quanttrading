import { useState, useRef, useCallback, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';

interface FilterA {
  pass: boolean;
  ma60: number | null;
  ma250: number | null;
  aboveMa60: boolean;
  aboveMa250: boolean;
}

interface FilterB {
  pass: boolean | null;
  status: 'confirmed' | 'rejected' | 'pending';
  t1Close?: number;
  t1Pct?: number;
}

interface ScanHit {
  tsCode: string;
  code: string;
  name: string;
  date: string;
  divergenceScore: number;
  largeNet: number | null;
  pctChange: number | null;
  filterA: FilterA;
  filterB: FilterB;
  confirmed: boolean;
  pending: boolean;
  ret3d: number | null;
  ret5d: number | null;
  ret10d: number | null;
  // 第三层因子
  t3LargeNetSum:    number | null;   // T-3~T-1 大单净流入合计（万元）
  t3Trend:          'accumulating' | 'distributing' | 'mixed' | null;
  lowerShadowRatio: number | null;   // 下影线/振幅 [0,1]
  closePosition:    number | null;   // 收盘位置 [0,1]
  marketBreadth:    number | null;   // 当日全市场触发金柱数
}

interface AdvFilters {
  t3: 'all' | 'positive';   // 前3日大单方向：全部 | 仅净买入
  minClosePos: number;       // 最低收盘位置 [0, 0.7]
  minBreadth: number;        // 最低市场宽度（只在日期层面过滤）
}

function passFilterC(hit: ScanHit, f: AdvFilters): boolean {
  if (f.t3 === 'positive' && (hit.t3LargeNetSum === null || hit.t3LargeNetSum <= 0)) return false;
  if (hit.closePosition !== null && hit.closePosition < f.minClosePos) return false;
  return true;
}

interface DateGroup {
  date: string;
  hits: ScanHit[];
  confirmed: ScanHit[];      // filterA + filterB 通过
  confirmedC: ScanHit[];     // filterA + filterB + filterC 通过
  marketBreadth: number;     // 当日全市场金柱数
  avg3d: number | null;
  avg5d: number | null;
  avg10d: number | null;
  winRate5d: number | null;
  // filterC 过滤后的统计
  cAvg5d: number | null;
  cWinRate5d: number | null;
  confAvg5d: number | null;
  confWinRate5d: number | null;
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

function FilterABadge({ fa }: { fa: FilterA }) {
  if (!fa) return <span className="text-muted-foreground/30 font-mono text-[10px]">—</span>;
  if (fa.pass) {
    return <span className="rounded px-1.5 py-0.5 font-mono text-[10px] bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20">MA60+250✓</span>;
  }
  // 显示具体哪条没过
  const label = !fa.aboveMa60 && !fa.aboveMa250 ? '双线下' : !fa.aboveMa60 ? 'MA60下' : 'MA250下';
  return <span className="rounded px-1.5 py-0.5 font-mono text-[10px] bg-[#ff3366]/10 text-[#ff3366]/70 border border-[#ff3366]/20">{label}</span>;
}

function T3Badge({ trend, sum }: { trend: ScanHit['t3Trend']; sum: number | null }) {
  if (trend === null) return <span className="text-muted-foreground/30 font-mono text-[10px]">—</span>;
  const cfg = {
    accumulating: { label: '建仓↑', bg: 'bg-[#00ff88]/10', text: 'text-[#00ff88]', border: 'border-[#00ff88]/25' },
    distributing: { label: '出货↓', bg: 'bg-[#ff3366]/10', text: 'text-[#ff3366]', border: 'border-[#ff3366]/25' },
    mixed:        { label: '震荡~', bg: 'bg-secondary',     text: 'text-muted-foreground', border: 'border-border/30' },
  }[trend];
  const sumStr = sum !== null ? ` ${sum >= 0 ? '+' : ''}${(sum/10000).toFixed(1)}亿` : '';
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cfg.bg} ${cfg.text} border ${cfg.border}`}
      title={`前3日累计大单净流入：${sum ?? '—'}万`}>
      {cfg.label}{sumStr}
    </span>
  );
}

function ClosePosBar({ pos }: { pos: number | null }) {
  if (pos === null) return <span className="text-muted-foreground/30 font-mono text-[10px]">—</span>;
  const color = pos >= 0.4 ? '#00ff88' : pos >= 0.2 ? '#f59e0b' : '#ff3366';
  return (
    <div className="flex items-center gap-1.5" title={`收盘位置 ${(pos*100).toFixed(0)}%（≥40%为有效承接）`}>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full" style={{ width: `${pos*100}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[10px]" style={{ color }}>{(pos*100).toFixed(0)}%</span>
    </div>
  );
}

function BreadthBadge({ breadth, minBreadth }: { breadth: number; minBreadth: number }) {
  const pass = breadth >= minBreadth;
  const color = breadth >= 20 ? '#00ff88' : breadth >= 5 ? '#f59e0b' : 'rgba(122,155,181,0.5)';
  return (
    <span className="font-mono text-[11px] font-bold" style={{ color }}
      title={`当日全市场触发 ${breadth} 只金柱${pass ? '' : `（过滤阈值 ${minBreadth}，本日不通过）`}`}>
      {breadth}只
    </span>
  );
}

function FilterBBadge({ fb }: { fb: FilterB }) {
  if (!fb) return <span className="text-muted-foreground/30 font-mono text-[10px]">—</span>;
  if (fb.status === 'pending') return (
    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] bg-[#ffd60a]/10 text-[#ffd60a] border border-[#ffd60a]/20">待确认</span>
  );
  if (fb.status === 'confirmed') return (
    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20" title={`T+1: ${fb.t1Pct !== undefined ? (fb.t1Pct*100).toFixed(2)+'%' : ''}`}>
      确认✓
    </span>
  );
  return <span className="rounded px-1.5 py-0.5 font-mono text-[10px] bg-secondary text-muted-foreground/50 border border-border/30">阴跌✗</span>;
}

// ─── 按日期聚合 ───────────────────────────────────────────────────────────────

function groupByDate(hits: ScanHit[], advF: AdvFilters): DateGroup[] {
  const map = new Map<string, ScanHit[]>();
  for (const h of hits) {
    if (!map.has(h.date)) map.set(h.date, []);
    map.get(h.date)!.push(h);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayHits]) => {
      const breadth    = dayHits[0]?.marketBreadth ?? dayHits.length;
      const confirmed  = dayHits.filter(h => h.confirmed);
      // filterC 过滤（个股级别：t3 + 收盘位置）
      const confirmedC = confirmed.filter(h => passFilterC(h, advF));

      const avg = (arr: ScanHit[], key: 'ret3d'|'ret5d'|'ret10d') => {
        const v = arr.filter(h => h[key] !== null);
        return v.length ? v.reduce((s, h) => s + h[key]!, 0) / v.length : null;
      };
      const wr = (arr: ScanHit[]) => {
        const v = arr.filter(h => h.ret5d !== null);
        return v.length ? v.filter(h => h.ret5d! > 0).length / v.length : null;
      };

      const base = breadth >= advF.minBreadth ? confirmed  : [];
      const baseC = breadth >= advF.minBreadth ? confirmedC : [];

      return {
        date,
        hits:         [...dayHits].sort((a, b) => b.divergenceScore - a.divergenceScore),
        confirmed:    [...confirmed].sort((a, b) => b.divergenceScore - a.divergenceScore),
        confirmedC:   [...confirmedC].sort((a, b) => b.divergenceScore - a.divergenceScore),
        marketBreadth: breadth,
        avg3d:        avg(base, 'ret3d'),
        avg5d:        avg(base, 'ret5d'),
        avg10d:       avg(base, 'ret10d'),
        winRate5d:    wr(base),
        cAvg5d:       avg(baseC, 'ret5d'),
        cWinRate5d:   wr(baseC),
        confAvg5d:    null,
        confWinRate5d: null,
      };
    });
}

// ─── 日期行（可折叠）─────────────────────────────────────────────────────────

function DateRow({ group, advF, onNavigate }: { group: DateGroup; advF: AdvFilters; onNavigate: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const advActive = advF.t3 !== 'all' || advF.minClosePos > 0 || advF.minBreadth > 1;
  const breadthPass = group.marketBreadth >= advF.minBreadth;
  // 当有高级过滤时，展示 filterC 的胜率；否则展示基础胜率
  const wr = advActive && breadthPass ? group.cWinRate5d : breadthPass ? group.winRate5d : null;
  const wrColor = wr === null ? 'text-muted-foreground/40' : wr >= 0.6 ? 'text-[#00ff88]' : wr >= 0.4 ? 'text-[#f59e0b]' : 'text-[#ff3366]';
  const dimRow = advF.minBreadth > 1 && !breadthPass;

  return (
    <div className={`border-b border-border/50 last:border-0 ${dimRow ? 'opacity-40' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
      >
        <span className="w-[98px] font-mono text-[13px] font-bold text-foreground">{group.date}</span>
        {/* 市场宽度 */}
        <BreadthBadge breadth={group.marketBreadth} minBreadth={advF.minBreadth} />
        {/* 金柱数 / 确认数 */}
        <span className="w-[80px] font-mono text-[11px]">
          <span className="text-[#ffd60a]">{group.hits.length}</span>
          <span className="text-muted-foreground/50"> / </span>
          <span className="text-[#00ff88]">{advActive ? group.confirmedC.length : group.confirmed.length}</span>
          <span className="text-muted-foreground/50 text-[9px] ml-1">确认</span>
        </span>
        <span className="w-[72px] text-right font-mono text-[11px] text-muted-foreground">
          胜率 <span className={`font-bold ${wrColor}`}>
            {wr !== null ? `${(wr*100).toFixed(0)}%` : '—'}
          </span>
        </span>
        <span className="w-[72px] text-right font-mono text-[11px] text-muted-foreground">
          3日 {pct(group.avg3d, 1)}
        </span>
        <span className="w-[72px] text-right font-mono text-[11px] text-muted-foreground">
          5日 {pct(advActive ? group.cAvg5d : group.avg5d, 1)}
        </span>
        <span className="w-[72px] text-right font-mono text-[11px] text-muted-foreground">
          10日 {pct(group.avg10d, 1)}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/50">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-border/30 bg-secondary/10">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                {['名称', '代码', '跌幅', '大单', 'DS', 'MA', 'T+1', '前3日', '收盘位', '3日', '5日', '10日', ''].map(h => (
                  <th key={h} className="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.hits.map((hit, i) => {
                const cPass = passFilterC(hit, advF);
                const allPass = hit.confirmed && cPass;
                return (
                  <tr key={`${hit.tsCode}-${i}`}
                    className={`border-b border-border/20 transition-colors hover:bg-secondary/20
                      ${allPass ? 'bg-[#00ff88]/5' : hit.confirmed ? 'bg-[#00ff88]/2' : hit.pending ? 'bg-[#ffd60a]/3' : ''}
                      ${advActive && !cPass && hit.confirmed ? 'opacity-50' : ''}`}>
                    <td className="px-2 py-2 font-mono text-[12px] font-semibold text-foreground">{hit.name}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">{hit.code}</td>
                    <td className="px-2 py-2">{pct(hit.pctChange)}</td>
                    <td className="px-2 py-2">{wan(hit.largeNet)}</td>
                    <td className="px-2 py-2"><DsBar score={hit.divergenceScore} /></td>
                    <td className="px-2 py-2"><FilterABadge fa={hit.filterA} /></td>
                    <td className="px-2 py-2"><FilterBBadge fb={hit.filterB} /></td>
                    <td className="px-2 py-2"><T3Badge trend={hit.t3Trend} sum={hit.t3LargeNetSum} /></td>
                    <td className="px-2 py-2"><ClosePosBar pos={hit.closePosition} /></td>
                    <td className="px-2 py-2">{pct(hit.ret3d)}</td>
                    <td className="px-2 py-2">{pct(hit.ret5d)}</td>
                    <td className="px-2 py-2">{pct(hit.ret10d)}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onNavigate(hit.code)}
                        className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary hover:bg-primary/20">
                        K线
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 总体统计 ─────────────────────────────────────────────────────────────────

function GlobalStats({ hits, advF }: { hits: ScanHit[]; advF: AdvFilters }) {
  const confirmed  = hits.filter(h => h.confirmed);
  const confirmedC = confirmed.filter(h => {
    if (!passFilterC(h, advF)) return false;
    if (h.marketBreadth !== null && h.marketBreadth < advF.minBreadth) return false;
    return true;
  });

  const statsFor = (arr: ScanHit[]) => {
    const c5 = arr.filter(h => h.ret5d !== null);
    const c3 = arr.filter(h => h.ret3d !== null);
    return {
      n: arr.length,
      wr:   c5.length ? c5.filter(h=>h.ret5d!>0).length/c5.length : 0,
      avg5: c5.length ? c5.reduce((s,h)=>s+h.ret5d!,0)/c5.length  : 0,
      avg3: c3.length ? c3.reduce((s,h)=>s+h.ret3d!,0)/c3.length  : 0,
      valid5: c5.length,
    };
  };

  if (!confirmed.length) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">金柱总数</div>
        <div className="mt-1 font-mono text-[22px] font-bold text-[#ffd60a]">{hits.length}</div>
        <div className="font-mono text-[9px] text-muted-foreground/50">0 已确认（等待T+1）</div>
      </div>
    );
  }

  const base = statsFor(confirmed);
  const filtered = statsFor(confirmedC);
  const advActive = advF.t3 !== 'all' || advF.minClosePos > 0 || advF.minBreadth > 1;

  const StatCard = ({ label, base: b, filtered: f, isAdv }: { label: string; base: { val: string; color: string; sub: string }; filtered: { val: string; color: string } | null; isAdv: boolean }) => (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-bold" style={{ color: b.color }}>{b.val}</div>
      <div className="font-mono text-[9px] text-muted-foreground/50">{b.sub}</div>
      {isAdv && f && (
        <div className="mt-1 border-t border-border/30 pt-1">
          <div className="font-mono text-[9px] text-muted-foreground/40">过滤后</div>
          <div className="font-mono text-[13px] font-bold" style={{ color: f.color }}>{f.val}</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-4 gap-3">
      <StatCard label="金柱/确认"
        base={{ val: `${hits.length} / ${base.n}`, color: '#ffd60a', sub: advActive ? `过滤后 ${filtered.n} 只` : '已确认信号' }}
        filtered={null} isAdv={false} />
      <StatCard label="5日胜率"
        base={{ val: `${(base.wr*100).toFixed(1)}%`, color: base.wr>=0.6?'#00ff88':base.wr>=0.4?'#f59e0b':'#ff3366', sub: `${base.valid5}条有效` }}
        filtered={advActive ? { val: `${(filtered.wr*100).toFixed(1)}%`, color: filtered.wr>=0.6?'#00ff88':filtered.wr>=0.4?'#f59e0b':'#ff3366' } : null}
        isAdv={advActive} />
      <StatCard label="5日均涨"
        base={{ val: `${base.avg5>=0?'+':''}${(base.avg5*100).toFixed(2)}%`, color: base.avg5>=0?'#ff3366':'#00ff88', sub: 'T+1买入起算' }}
        filtered={advActive ? { val: `${filtered.avg5>=0?'+':''}${(filtered.avg5*100).toFixed(2)}%`, color: filtered.avg5>=0?'#ff3366':'#00ff88' } : null}
        isAdv={advActive} />
      <StatCard label="3日均涨"
        base={{ val: `${base.avg3>=0?'+':''}${(base.avg3*100).toFixed(2)}%`, color: base.avg3>=0?'#ff3366':'#00ff88', sub: 'T+1买入起算' }}
        filtered={null} isAdv={false} />
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

  // ── 高级过滤（第三层因子）──────────────────────────────────────────────────
  const [advOpen, setAdvOpen]     = useState(false);
  const [advF, setAdvF]           = useState<AdvFilters>({ t3: 'all', minClosePos: 0, minBreadth: 1 });
  const advActive = advF.t3 !== 'all' || advF.minClosePos > 0 || advF.minBreadth > 1;

  const groups = useMemo(() => groupByDate(hits, advF), [hits, advF]);

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
      // 用 breadthByDate 回填每条 hit 的市场宽度
      if (d.breadthByDate) {
        setHits(prev => prev.map(h => ({
          ...h,
          marketBreadth: d.breadthByDate[h.date] ?? h.marketBreadth ?? 1,
        })));
      }
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

          {/* 高级过滤开关 */}
          <button type="button" onClick={() => setAdvOpen(v => !v)}
            className={`rounded-md border px-3 py-2 font-mono text-[11px] transition
              ${advOpen || advActive
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {advActive ? '⚙ 过滤中' : '⚙ 高级过滤'}
          </button>
        </div>

        {/* 高级过滤面板 */}
        {advOpen && (
          <div className="mt-3 flex flex-wrap items-end gap-5 border-t border-border/40 pt-3">
            {/* T3大单方向 */}
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] text-muted-foreground">
                前3日大单方向
                <span className="ml-1 text-[#ffd60a]">{advF.t3 === 'positive' ? '净买入↑' : '全部'}</span>
              </label>
              <div className="flex overflow-hidden rounded border border-border">
                {(['all', 'positive'] as const).map(v => (
                  <button key={v} type="button"
                    onClick={() => setAdvF(f => ({ ...f, t3: v }))}
                    className={`px-3 py-1.5 font-mono text-[11px] transition
                      ${advF.t3 === v ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                    {v === 'all' ? '全部' : '仅建仓↑'}
                  </button>
                ))}
              </div>
            </div>

            {/* 收盘位置 */}
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] text-muted-foreground">
                最低收盘位置
                <span className="ml-1 text-[#00d4ff]">≥ {(advF.minClosePos*100).toFixed(0)}%</span>
                <span className="ml-1 text-muted-foreground/50">{advF.minClosePos>=0.4?'有效承接':advF.minClosePos>0?'弱承接':'不限'}</span>
              </label>
              <input type="range" min="0" max="0.7" step="0.05" value={advF.minClosePos}
                onChange={e => setAdvF(f => ({ ...f, minClosePos: Number(e.target.value) }))}
                className="w-[140px] cursor-pointer" />
            </div>

            {/* 市场宽度 */}
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] text-muted-foreground">
                市场宽度（当日金柱数）
                <span className="ml-1 text-[#ffd60a]">≥ {advF.minBreadth}</span>
                <span className="ml-1 text-muted-foreground/50">{advF.minBreadth>=20?'集体恐慌':advF.minBreadth>=5?'共振':advF.minBreadth>1?'多股':''}</span>
              </label>
              <input type="range" min="1" max="60" step="1" value={advF.minBreadth}
                onChange={e => setAdvF(f => ({ ...f, minBreadth: Number(e.target.value) }))}
                className="w-[140px] cursor-pointer" />
            </div>

            {/* 重置 */}
            {advActive && (
              <button type="button"
                onClick={() => setAdvF({ t3: 'all', minClosePos: 0, minBreadth: 1 })}
                className="self-end rounded border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                重置
              </button>
            )}
          </div>
        )}
      </div>

      {scanning && <ProgressBar scanned={progress.scanned} total={progress.total} hits={progress.hits} />}
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-sm text-destructive">{error}</div>}

      {hits.length > 0 && (
        <div className="flex flex-col gap-3">
          <GlobalStats hits={hits} advF={advF} />

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
                  es.addEventListener('done', (ev) => {
                    const d = JSON.parse(ev.data);
                    if (d.breadthByDate) {
                      setHits(prev => prev.map(h => ({
                        ...h,
                        marketBreadth: d.breadthByDate[h.date] ?? h.marketBreadth ?? 1,
                      })));
                    }
                    setDone(true); setScanning(false); es.close();
                  });
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
                <DateRow key={g.date} group={g} advF={advF} onNavigate={navigateToStock} />
              ))}
            </div>
          ) : (
            /* 单日模式：直接展示个股表格 */
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    {['名称', '代码', '跌幅', '大单', 'DS', 'MA', 'T+1', '前3日', '收盘位', '3日', '5日', '10日', ''].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...hits].sort((a,b)=>b.divergenceScore-a.divergenceScore).map((hit, i) => {
                    const cPass = passFilterC(hit, advF);
                    const allPass = hit.confirmed && cPass;
                    return (
                    <tr key={`${hit.tsCode}-${i}`}
                      className={`border-b border-border/40 hover:bg-secondary/30
                        ${allPass?'bg-[#00ff88]/5':hit.confirmed?'bg-[#00ff88]/2':hit.pending?'bg-[#ffd60a]/3':''}
                        ${advActive && !cPass && hit.confirmed ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2.5 font-mono text-[12px] font-semibold text-foreground">{hit.name}</td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{hit.code}</td>
                      <td className="px-3 py-2.5">{pct(hit.pctChange)}</td>
                      <td className="px-3 py-2.5">{wan(hit.largeNet)}</td>
                      <td className="px-3 py-2.5"><DsBar score={hit.divergenceScore} /></td>
                      <td className="px-3 py-2.5"><FilterABadge fa={hit.filterA} /></td>
                      <td className="px-3 py-2.5"><FilterBBadge fb={hit.filterB} /></td>
                      <td className="px-3 py-2.5"><T3Badge trend={hit.t3Trend} sum={hit.t3LargeNetSum} /></td>
                      <td className="px-3 py-2.5"><ClosePosBar pos={hit.closePosition} /></td>
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
                    );
                  })}
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
