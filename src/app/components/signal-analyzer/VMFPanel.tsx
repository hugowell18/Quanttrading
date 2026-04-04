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

import { useEffect, useMemo, useRef, useState } from 'react';
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

  for (let i = 10; i < n; i++) {
    const b      = base[i];
    const k      = klineData[i];
    const ma20   = b.ma20_vol;
    if (!ma20) continue;

    // 放量突破: 价格创10日新高 + 量 > MA20 × 1.5
    const max10Close = Math.max(...klineData.slice(i - 10, i).map(d => d.close));
    if (k.close > max10Close && k.volume > ma20 * 1.5) {
      map.set(k.date, 'breakout');
      continue;
    }

    // 缩量滞涨: 连续3日涨幅绝对值<0.5% + 今日量 < MA20 × 0.6
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

export function VMFPanel({ visibleKlineData, fullKlineData, stockCode, chartHeight = 160, onSignals }: VMFPanelProps) {
  const [divData, setDivData] = useState<Map<string, DivergencePoint>>(new Map());
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef('');

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
      {/* ── 标题行 ── */}
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            VMF · 量价资金流
          </span>
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
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: COLOR_DIV }} />
            背离
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

        {/* ── 顶层: 背离突刺（橙色竖柱，从底部冒出）── */}
        {vmfPoints.map((d, i) => {
          if (d.divergenceScore < 0.5) return null;
          const x     = xCenter(i);
          const h     = d.divergenceScore * drawH * 0.55;
          const y     = PAD.top + drawH - h;
          const alpha = Math.min(0.9, d.divergenceScore);
          return (
            <rect
              key={`div-${i}`}
              x={x - 1.5} y={y}
              width={3} height={h}
              fill={COLOR_DIV}
              opacity={alpha}
            />
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
