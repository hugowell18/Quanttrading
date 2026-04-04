/**
 * VMF · 量价资金流面板 (Volume-Weighted Money Flow Panel)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 三层叠加式 SVG 副图，替换原 MACD/MFMF 面板：
 *
 *   底层：Volume 柱（30%透明度，涨绿跌红）+ MA5/MA20 均量线
 *   中层：NMF 资金流曲线（围绕零轴上下）— 基于 TrueRange 修正
 *   顶层：背离得分突刺（来自 Tushare moneyflow 真实大单数据）+ 信号标注
 *
 * NMF 公式（A股跳空修正版）：
 *   TrueRange = max(High, PreClose) - min(Low, PreClose)
 *   NMF_raw   = TrueRange === 0 ? 0 : (Close - PreClose) / TrueRange × Volume
 *   NMF       = EMA(NMF_raw, 20)
 *
 * 信号：
 *   ✅ breakout    — 价格创10日新高 + 成交量 > MA20 × 1.5
 *   🔴 stagnation  — 连续3日涨幅<0.5% + 成交量 < MA20 × 0.6
 *   ⚡ divergence  — 价跌机构逆买（DS > 0.81），来自后端 moneyflow 数据
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { KLinePoint } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────────

interface DivergencePoint {
  date: string;            // YYYYMMDD
  large_net: number | null;
  small_net: number | null;
  divergence_score: number;
  signal: 'divergence' | null;
}

interface VMFPoint {
  date: string;            // YYYY-MM-DD
  volume: number;
  ma5_vol: number | null;
  ma20_vol: number | null;
  nmf: number | null;      // EMA(NMF_raw, 20)
  isUp: boolean;           // close > preClose
  signal: 'breakout' | 'stagnation' | 'divergence' | null;
  divergenceScore: number;
}

interface VMFPanelProps {
  visibleKlineData: KLinePoint[];   // 当前可见窗口（用于渲染）
  fullKlineData: KLinePoint[];      // 完整历史（用于 EMA warmup）
  stockCode: string;
  chartHeight?: number;
  /** 信号回调：将 breakout/stagnation/divergence 信号提升到父组件（KLineChart）渲染 */
  onSignals?: (signals: Map<string, 'breakout' | 'stagnation' | 'divergence'>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

const SVG_W    = 1200;
const PAD      = { top: 14, right: 52, bottom: 24, left: 8 };
const COLOR_UP   = '#ff3366';
const COLOR_DOWN = '#00ff88';
const COLOR_NMF  = '#00d4ff';
const COLOR_MA5  = 'rgba(160,160,160,0.8)';
const COLOR_MA20 = 'rgba(255,140,0,0.9)';
const COLOR_DIV  = '#ff8c00';

// ─────────────────────────────────────────────────────────────────────────────
// 数学工具
// ─────────────────────────────────────────────────────────────────────────────

function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;

  for (let i = 0; i < data.length; i++) {
    if (prev === null) {
      if (i < period - 1) { result.push(null); continue; }
      // seed: SMA of first `period` values
      const seed = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
      prev = seed;
      result.push(seed);
    } else {
      prev = (data[i] - prev) * k + prev;
      result.push(prev);
    }
  }
  return result;
}

function rollingMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((s, v) => s + v, 0) / period;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心计算（纯 OHLCV，前端本地）
// ─────────────────────────────────────────────────────────────────────────────

function computeVMF(klineData: KLinePoint[]): Omit<VMFPoint, 'signal' | 'divergenceScore'>[] {
  if (klineData.length < 2) return [];

  const n = klineData.length;
  const volumes = klineData.map(d => d.volume);
  const nmfRaw: number[] = [];

  for (let i = 0; i < n; i++) {
    const k         = klineData[i];
    const preClose  = i > 0 ? klineData[i - 1].close : k.open;
    const trueHigh  = Math.max(k.high, preClose);
    const trueLow   = Math.min(k.low, preClose);
    const trueRange = trueHigh - trueLow;
    nmfRaw.push(trueRange === 0 ? 0 : ((k.close - preClose) / trueRange) * k.volume);
  }

  const nmfEma  = ema(nmfRaw, 20);
  const ma5Vol  = rollingMA(volumes, 5);
  const ma20Vol = rollingMA(volumes, 20);

  return klineData.map((k, i) => ({
    date:    k.date,
    volume:  k.volume,
    ma5_vol: ma5Vol[i],
    ma20_vol: ma20Vol[i],
    nmf:     nmfEma[i],
    isUp:    k.close >= (i > 0 ? klineData[i - 1].close : k.open),
  }));
}

function detectOhlcvSignals(base: Omit<VMFPoint, 'signal' | 'divergenceScore'>[], klineData: KLinePoint[]): Map<string, 'breakout' | 'stagnation'> {
  const map = new Map<string, 'breakout' | 'stagnation'>();
  const n   = base.length;

  for (let i = 20; i < n; i++) {
    const b    = base[i];
    const k    = klineData[i];
    const ma20 = b.ma20_vol;
    if (!ma20) continue;

    // ── 放量突破（盘整底部突破，非趋势延续）────────────────────────────
    // 条件1: 今日收盘创近20日新高
    const max20Close = Math.max(...klineData.slice(i - 20, i).map(d => d.close));
    if (k.close > max20Close && k.volume > ma20 * 2.0) {
      // 条件2: 突破前10日内盘整（价格振幅 < 8%），排除已在上升趋势顶部的情况
      const prior10 = klineData.slice(i - 10, i);
      const priorHigh = Math.max(...prior10.map(d => d.high));
      const priorLow  = Math.min(...prior10.map(d => d.low));
      const rangeRatio = priorLow > 0 ? (priorHigh - priorLow) / priorLow : 1;
      if (rangeRatio < 0.08) {
        map.set(k.date, 'breakout');
        continue;
      }
    }

    // ── 缩量滞涨: 连续3日涨幅绝对值<0.5% + 今日量 < MA20 × 0.6 ──────
    if (i >= 3 && k.volume < ma20 * 0.6) {
      const flat = [0, 1, 2].every(offset => {
        const idx = i - offset;
        const pre = idx > 0 ? klineData[idx - 1].close : klineData[idx].open;
        return pre > 0 && Math.abs(klineData[idx].close - pre) / pre < 0.005;
      });
      if (flat) map.set(k.date, 'stagnation');
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 使用说明弹窗
// ─────────────────────────────────────────────────────────────────────────────

function VMFHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={onClose}
    >
      <div
        className="relative w-[520px] max-h-[80vh] overflow-y-auto rounded-xl border border-border bg-[#0d1a26] p-6 shadow-2xl"
        style={{ boxShadow: '0 0 40px rgba(0,212,255,0.12)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground transition hover:text-foreground"
          aria-label="关闭"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.22 2.22a.75.75 0 0 1 1.06 0L8 6.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L9.06 8l4.72 4.72a.75.75 0 1 1-1.06 1.06L8 9.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L6.94 8 2.22 3.28a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>

        {/* 标题 */}
        <h2 className="mb-4 font-mono text-[13px] font-bold uppercase tracking-widest text-[#00d4ff]">
          VMF · 量价资金流 使用说明
        </h2>

        {/* 指标说明 */}
        <section className="mb-4">
          <h3 className="mb-2 font-mono text-[11px] font-semibold text-foreground/80">📐 指标构成</h3>
          <div className="space-y-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            <p><span className="text-[#ff3366]">■</span> <span className="text-foreground/70">Volume 柱</span> — 涨红跌绿，30%透明度，直观显示当日成交量规模</p>
            <p><span className="text-[rgba(160,160,160,0.8)]">—</span> <span className="text-foreground/70">MA5 均量线</span> — 5日成交量均线，反映近期量能基准</p>
            <p><span className="text-[rgba(255,140,0,0.9)]">—</span> <span className="text-foreground/70">MA20 均量线</span> — 20日成交量均线，判断放量/缩量的参考基准</p>
            <p><span className="text-[#00d4ff]">～</span> <span className="text-foreground/70">NMF 曲线</span> — 修正后的资金流向，围绕零轴上下波动：
              零轴以上 = 资金净流入，零轴以下 = 资金净流出</p>
            <p>
              <span className="text-[#ff8c00]">█</span>{' '}
              <span className="text-foreground/70">底背离突刺柱</span>{' '}
              — <span className="text-[#ff8c00] font-semibold">看涨信号</span>：价格大跌时机构大单反向净买入，
              柱越高说明"价跌量增（机构进场）"的背离强度越大，预示潜在底部
            </p>
          </div>
        </section>

        {/* NMF公式 */}
        <section className="mb-4 rounded-lg border border-border/40 bg-[#08121c] p-3">
          <h3 className="mb-2 font-mono text-[11px] font-semibold text-foreground/80">🔢 NMF 计算公式</h3>
          <div className="space-y-1 font-mono text-[10px] text-muted-foreground">
            <p>TrueRange = max(High, PreClose) − min(Low, PreClose)</p>
            <p>NMF_raw &nbsp;= TrueRange = 0 ? 0 : (Close − PreClose) / TrueRange × Volume</p>
            <p>NMF &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= EMA(NMF_raw, 20)</p>
          </div>
          <p className="mt-2 font-mono text-[9px] text-muted-foreground/60">
            A股跳空修正版：真实波动幅度替代单日振幅，避免一字板时的除零错误
          </p>
        </section>

        {/* 信号说明 */}
        <section className="mb-4">
          <h3 className="mb-2 font-mono text-[11px] font-semibold text-foreground/80">🚦 信号说明</h3>
          <div className="space-y-3">
            {/* 突 */}
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid #00d4ff55' }}>
                <span className="font-mono text-[9px] font-bold text-[#00d4ff]">突</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                <span className="text-[#00d4ff]">盘整底部放量突破</span> — 同时满足：<br />
                &nbsp;① 价格创近20日新高<br />
                &nbsp;② 成交量 &gt; MA20 × 2.0（强力放量）<br />
                &nbsp;③ 突破前10日价格振幅 &lt; 8%（箱体整理过，非趋势顶部延续）<br />
                <span className="text-[9px] text-muted-foreground/60">主力拉升启动信号，可关注追涨或持仓加码时机</span>
              </div>
            </div>
            {/* 滞 */}
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ background: 'rgba(255,107,107,0.15)', border: '1px solid #ff6b6b55' }}>
                <span className="font-mono text-[9px] font-bold text-[#ff6b6b]">滞</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                <span className="text-[#ff6b6b]">缩量滞涨</span> — 连续3日涨幅绝对值 &lt; 0.5%，且今日量 &lt; MA20 × 0.6<br />
                <span className="text-[9px] text-muted-foreground/60">主力控盘观望信号，上涨动能衰减，警惕回调风险</span>
              </div>
            </div>
            {/* ⚡ */}
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ background: 'rgba(255,140,0,0.15)', border: '1px solid #ff8c0055' }}>
                <span className="text-[11px]">⚡</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                <span className="text-[#ff8c00] font-semibold">底背离极值 — 看涨 · 潜在黄金坑</span><br />
                触发条件（同时满足）：<br />
                &nbsp;① 今日跌幅 在过去60日中排名前10%（跌得很惨）<br />
                &nbsp;② 机构大单净买入 在过去60日中排名前10%（主力在抄底）<br />
                背离得分 DS = 价跌分位 × 流入分位 &gt; 0.81<br />
                <span className="text-[9px] text-muted-foreground/60">
                  ⚠️ 这是底背离，不是顶背离。价格越跌、机构买得越猛 → 信号越强 →
                  历史上常对应短期底部反转机会。数据来源：Tushare 超大单+大单（≥20万元）
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 使用建议 */}
        <section>
          <h3 className="mb-2 font-mono text-[11px] font-semibold text-foreground/80">💡 使用建议</h3>
          <ul className="list-disc space-y-1 pl-4 font-mono text-[10px] text-muted-foreground">
            <li>⚡ 信号出现后，配合筹码峰查看主力成本区，判断是否形成「黄金坑」</li>
            <li>突 + NMF 上穿零轴 = 双重确认，入场胜率更高</li>
            <li>滞 + NMF 持续负值 = 主力撤离前兆，优先减仓</li>
            <li>底背离突刺柱 DS &gt; 0.9 为极端信号（价格极跌+机构极买），历史上常对应短期底部反转</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export function VMFPanel({ visibleKlineData, fullKlineData, stockCode, chartHeight = 160, onSignals }: VMFPanelProps) {
  const [divData, setDivData] = useState<Map<string, DivergencePoint>>(new Map());
  const [loading, setLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const fetchedRef = useRef('');
  const toggleHelp = useCallback(() => setHelpOpen(v => !v), []);

  // ── 拉取后端背离得分 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!stockCode || fetchedRef.current === stockCode) return;
    fetchedRef.current = stockCode;
    setLoading(true);

    const code = stockCode.trim().replace('.', '').slice(0, 6);
    const tsCode = /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;

    fetch(`http://localhost:3001/api/vmf/${tsCode}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && Array.isArray(json.data)) {
          const m = new Map<string, DivergencePoint>(
            json.data.map((d: DivergencePoint) => [
              `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`,
              d,
            ])
          );
          setDivData(m);
        }
      })
      .catch(() => { /* 降级到纯OHLCV模式 */ })
      .finally(() => setLoading(false));
  }, [stockCode]);

  // ── 在完整历史上计算 NMF（解决 EMA warmup 问题）──────────────────────
  const fullBase = useMemo(() => computeVMF(fullKlineData), [fullKlineData]);
  const fullBaseMap = useMemo(
    () => new Map(fullBase.map(b => [b.date, b])),
    [fullBase]
  );

  // ── OHLCV 信号在完整数据上计算（窗口移动时信号不会消失）────────────
  const fullOhlcvSignals = useMemo(
    () => detectOhlcvSignals(fullBase, fullKlineData),
    [fullBase, fullKlineData]
  );

  // ── 可见窗口的渲染数据（从完整计算结果中查表）──────────────────────
  const vmfPoints: VMFPoint[] = useMemo(() => {
    return visibleKlineData.map(k => {
      const b        = fullBaseMap.get(k.date);
      const divPoint = divData.get(k.date);
      const ohlcvSig = fullOhlcvSignals.get(k.date) ?? null;
      const divSig   = divPoint?.signal === 'divergence' ? 'divergence' as const : null;
      return {
        date:           k.date,
        volume:         k.volume,
        ma5_vol:        b?.ma5_vol  ?? null,
        ma20_vol:       b?.ma20_vol ?? null,
        nmf:            b?.nmf      ?? null,
        isUp:           b?.isUp     ?? (k.close >= k.open),
        divergenceScore: divPoint?.divergence_score ?? 0,
        signal:         divSig ?? ohlcvSig,
      };
    });
  }, [visibleKlineData, fullBaseMap, divData, fullOhlcvSignals]);

  // ── 将所有信号提升到 KLineChart 渲染 ────────────────────────────────
  useEffect(() => {
    if (!onSignals) return;
    const map = new Map<string, 'breakout' | 'stagnation' | 'divergence'>();
    // OHLCV 信号（全量）
    fullOhlcvSignals.forEach((sig, date) => map.set(date, sig));
    // 背离信号（覆盖，优先级更高）
    divData.forEach((dp, date) => {
      if (dp.signal === 'divergence') map.set(date, 'divergence');
    });
    onSignals(map);
  }, [fullOhlcvSignals, divData, onSignals]);

  // ── SVG 尺寸 ─────────────────────────────────────────────────────────
  const drawW = SVG_W - PAD.left - PAD.right;
  const drawH = chartHeight - PAD.top - PAD.bottom;
  const zeroY = PAD.top + drawH / 2;
  const n     = vmfPoints.length;

  if (n < 2) {
    return (
      <div className="mt-3 rounded-lg border border-border bg-[#08121c] p-3" style={{ height: chartHeight }}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          VMF · 量价资金流
        </div>
        <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground">
          数据不足（需至少 2 个交易日）
        </div>
      </div>
    );
  }

  const slotW   = drawW / n;
  const barW    = Math.max(1, Math.min(12, slotW * 0.65));

  // ── Volume 归一化 ─────────────────────────────────────────────────────
  const maxVol  = Math.max(...vmfPoints.map(d => d.volume), 1);
  const volH    = (v: number) => (v / maxVol) * drawH * 0.75;  // 占下半部分的75%

  // ── NMF 归一化（围绕零轴）────────────────────────────────────────────
  const nmfVals   = vmfPoints.map(d => d.nmf ?? 0);
  const maxNMFAbs = Math.max(...nmfVals.map(Math.abs), 1);
  const nmfY      = (v: number) => zeroY - (v / maxNMFAbs) * (drawH / 2 * 0.85);

  // ── xCenter per slot ──────────────────────────────────────────────────
  const xCenter = (i: number) => PAD.left + slotW * i + slotW / 2;

  // ── NMF 折线路径 ──────────────────────────────────────────────────────
  const nmfPath = vmfPoints
    .map((d, i) => {
      if (d.nmf === null) return null;
      const x = xCenter(i);
      const y = nmfY(d.nmf);
      return `${i === 0 || vmfPoints[i - 1].nmf === null ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  // ── MA 折线 ───────────────────────────────────────────────────────────
  const maPath = (getter: (d: VMFPoint) => number | null, color: string) => {
    const segments: string[] = [];
    let started = false;
    vmfPoints.forEach((d, i) => {
      const v = getter(d);
      const x = xCenter(i);
      if (v === null) { started = false; return; }
      const y = PAD.top + drawH - volH(v);
      segments.push(`${started ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
      started = true;
    });
    return <path d={segments.join(' ')} stroke={color} strokeWidth={1} fill="none" opacity={0.9} />;
  };

  // ── X 轴标签（每 N 个显示一次）──────────────────────────────────────
  const xLabelInterval = Math.max(Math.floor(n / 6), 1);

  return (
    <div className="mt-3 rounded-lg border border-border bg-[#08121c] p-3">
      {helpOpen && <VMFHelpModal onClose={toggleHelp} />}

      {/* ── 标题行 ── */}
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            VMF · 量价资金流
          </span>
          {/* 帮助按钮 */}
          <button
            type="button"
            onClick={toggleHelp}
            title="使用说明"
            className="flex h-4 w-4 items-center justify-center rounded-full border transition"
            style={{
              borderColor: helpOpen ? '#00d4ff' : 'rgba(122,155,181,0.35)',
              color: helpOpen ? '#00d4ff' : 'rgba(122,155,181,0.6)',
              background: helpOpen ? 'rgba(0,212,255,0.1)' : 'transparent',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
              <text x="1" y="9" fontSize="9" fontFamily="serif" fontStyle="italic">?</text>
            </svg>
          </button>
          {loading && (
            <span className="font-mono text-[9px] text-muted-foreground/50">同步资金数据...</span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: COLOR_NMF }} />
            NMF
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: COLOR_MA5 }} />
            MA5
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: COLOR_MA20 }} />
            MA20
          </span>
          <span className="flex items-center gap-1" title="底背离：价跌但机构大单逆势净买入，看涨信号">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: COLOR_DIV }} />
            底背离↑
          </span>
        </div>
      </div>

      {/* ── SVG 主图 ── */}
      <svg
        viewBox={`0 0 ${SVG_W} ${chartHeight}`}
        className="block w-full"
        style={{ height: chartHeight }}
        preserveAspectRatio="none"
      >
        {/* 背景 */}
        <rect x={0} y={0} width={SVG_W} height={chartHeight} fill="#08121c" />

        {/* ── 底层: Volume 柱（30%透明度）── */}
        {vmfPoints.map((d, i) => {
          const h = volH(d.volume);
          const x = xCenter(i) - barW / 2;
          const y = PAD.top + drawH - h;
          return (
            <rect
              key={`vol-${i}`}
              x={x} y={y}
              width={barW} height={h}
              fill={d.isUp ? COLOR_UP : COLOR_DOWN}
              opacity={0.28}
            />
          );
        })}

        {/* MA5 均量线 */}
        {maPath(d => d.ma5_vol, COLOR_MA5)}

        {/* MA20 均量线 */}
        {maPath(d => d.ma20_vol, COLOR_MA20)}

        {/* ── 零轴 ── */}
        <line
          x1={PAD.left} x2={SVG_W - PAD.right}
          y1={zeroY} y2={zeroY}
          stroke="rgba(122,155,181,0.4)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />

        {/* ── 中层: NMF 曲线 ── */}
        {nmfPath && (
          <path
            d={nmfPath}
            stroke={COLOR_NMF}
            strokeWidth={1.5}
            fill="none"
            opacity={0.9}
          />
        )}

        {/* NMF 与零轴之间的填充区域（正值浅蓝，负值浅红）*/}
        {vmfPoints.map((d, i) => {
          if (d.nmf === null) return null;
          const x  = xCenter(i);
          const y  = nmfY(d.nmf);
          const isPos = d.nmf >= 0;
          return (
            <line
              key={`nmf-fill-${i}`}
              x1={x} x2={x}
              y1={Math.min(y, zeroY)} y2={Math.max(y, zeroY)}
              stroke={isPos ? COLOR_NMF : COLOR_DOWN}
              strokeWidth={Math.max(1, barW * 0.4)}
              opacity={0.12}
            />
          );
        })}

        {/* ── 顶层: 背离突刺（橙色竖柱，从底部冒出，带发光描边）── */}
        {vmfPoints.map((d, i) => {
          if (d.divergenceScore < 0.25) return null;
          const x      = xCenter(i);
          const h      = d.divergenceScore * drawH * 0.65;
          const y      = PAD.top + drawH - h;
          const alpha  = 0.5 + d.divergenceScore * 0.5;   // 0.5 ~ 1.0
          const colW   = Math.max(3, Math.min(barW * 0.8, 8));
          return (
            <g key={`div-${i}`}>
              {/* 发光底层（宽、低透明度）*/}
              <rect x={x - colW} y={y} width={colW * 2} height={h}
                fill={COLOR_DIV} opacity={alpha * 0.35} />
              {/* 主柱（窄、高亮）*/}
              <rect x={x - colW / 2} y={y} width={colW} height={h}
                fill={COLOR_DIV} opacity={alpha}
                stroke={d.divergenceScore >= 0.81 ? '#ffe080' : 'none'}
                strokeWidth={1} />
            </g>
          );
        })}

        {/* 信号标注已提升到 KLineChart 渲染，副图只保留背离突刺柱 */}

        {/* ── X 轴标签 ── */}
        {vmfPoints.map((d, i) => {
          if (i % xLabelInterval !== 0 && i !== n - 1) return null;
          return (
            <text
              key={`xl-${i}`}
              x={xCenter(i)}
              y={chartHeight - 6}
              textAnchor="middle"
              fill="#7a9bb5"
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
            >
              {d.date}
            </text>
          );
        })}

        {/* ── Y 轴标注（右侧）── */}
        <text x={SVG_W - PAD.right + 4} y={zeroY + 4} fill="rgba(122,155,181,0.6)" fontSize={8} fontFamily="JetBrains Mono">0</text>
        <text x={SVG_W - PAD.right + 4} y={PAD.top + 10} fill={COLOR_NMF} fontSize={8} fontFamily="JetBrains Mono" opacity={0.7}>
          {maxNMFAbs > 1e6
            ? `${(maxNMFAbs / 1e6).toFixed(1)}M`
            : maxNMFAbs > 1e3
              ? `${(maxNMFAbs / 1e3).toFixed(1)}K`
              : maxNMFAbs.toFixed(0)}
        </text>
      </svg>
    </div>
  );
}
