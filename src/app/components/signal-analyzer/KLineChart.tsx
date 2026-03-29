import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type KLinePoint, type SignalMarker, priceViewOptions } from './types';

type PriceViewPreset = '20' | '60' | '120' | 'all';

interface KLineChartProps {
  klineData: KLinePoint[];
  signalMarkers: SignalMarker[];
  stockCode: string;
  stockName: string;
  onCandleClick?: (date: string) => void;
}

export function KLineChart({ klineData, signalMarkers, stockCode, stockName, onCandleClick }: KLineChartProps) {
  const [priceView, setPriceView] = useState<PriceViewPreset>('120');
  const [priceWindowStart, setPriceWindowStart] = useState(0);
  const [hoveredCandleIndex, setHoveredCandleIndex] = useState<number | null>(null);

  const visibleWindowSize = priceView === 'all' ? klineData.length : Math.min(Number(priceView), klineData.length);
  const clampedWindowStart = Math.min(priceWindowStart, Math.max(klineData.length - visibleWindowSize, 0));
  const visibleKlineData = klineData.slice(clampedWindowStart, clampedWindowStart + visibleWindowSize);
  const hoveredPoint = hoveredCandleIndex !== null ? visibleKlineData[hoveredCandleIndex] : visibleKlineData[visibleKlineData.length - 1];

  // Reset window when data or view changes
  useEffect(() => {
    setPriceWindowStart(Math.max(klineData.length - visibleWindowSize, 0));
    setHoveredCandleIndex(null);
  }, [klineData.length, visibleWindowSize]);

  // Chart dimensions
  const chartWidth = 1200;
  const chartHeight = 420;
  const chartPadding = { top: 24, right: 72, bottom: 34, left: 16 };
  const drawableWidth = chartWidth - chartPadding.left - chartPadding.right;
  const drawableHeight = chartHeight - chartPadding.top - chartPadding.bottom;

  const visibleLows = visibleKlineData.map((d) => d.low);
  const visibleHighs = visibleKlineData.map((d) => d.high);
  const visibleMinPrice = visibleLows.length ? Math.min(...visibleLows) : 0;
  const visibleMaxPrice = visibleHighs.length ? Math.max(...visibleHighs) : 1;
  const visiblePriceSpan = Math.max(visibleMaxPrice - visibleMinPrice, 1);
  const candleSlotWidth = visibleKlineData.length ? drawableWidth / visibleKlineData.length : drawableWidth;
  const candleBodyWidth = Math.max(4, Math.min(14, candleSlotWidth * 0.62));
  const yOfPrice = (price: number) => chartPadding.top + ((visibleMaxPrice - price) / visiblePriceSpan) * drawableHeight;

  // Signal marker lookup
  const markerMap = new Map(
    signalMarkers
      .map((m) => {
        const idx = visibleKlineData.findIndex((d) => d.date === m.date);
        return idx >= 0 ? [m.date, { ...m, index: idx }] as const : null;
      })
      .filter(Boolean)
      .map((e) => e as [string, SignalMarker & { index: number }]),
  );

  const hoveredPriceChange = hoveredPoint ? hoveredPoint.close - hoveredPoint.open : 0;
  const hoveredPriceChangePct = hoveredPoint?.open ? (hoveredPriceChange / hoveredPoint.open) * 100 : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-[15px] font-semibold tracking-[0.08em] text-foreground">
          {stockCode} · {stockName} · 日K
        </h3>
        <div className="flex flex-wrap gap-2">
          {priceViewOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPriceView(opt.id)}
              className={`rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                priceView === opt.id
                  ? 'border-primary/30 bg-primary/12 text-primary'
                  : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/30 hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inspector */}
      <div className="mb-3 grid min-w-0 grid-cols-4 gap-2 text-[12px]">
        <div className="rounded border border-border bg-secondary/30 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">日期</div>
          <div className="mt-1 font-mono text-foreground">{hoveredPoint?.date ?? '--'}</div>
        </div>
        <div className="rounded border border-border bg-secondary/30 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">开 / 收</div>
          <div className="mt-1 font-mono text-foreground">
            {hoveredPoint ? `¥${hoveredPoint.open.toFixed(2)} / ¥${hoveredPoint.close.toFixed(2)}` : '--'}
          </div>
        </div>
        <div className="rounded border border-border bg-secondary/30 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">高 / 低</div>
          <div className="mt-1 font-mono text-foreground">
            {hoveredPoint ? `¥${hoveredPoint.high.toFixed(2)} / ¥${hoveredPoint.low.toFixed(2)}` : '--'}
          </div>
        </div>
        <div className="rounded border border-border bg-secondary/30 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">涨跌 / 成交量</div>
          <div className={`mt-1 font-mono ${hoveredPriceChange >= 0 ? 'text-[#ff3366]' : 'text-[#00ff88]'}`}>
            {hoveredPoint ? `${hoveredPriceChange >= 0 ? '+' : ''}${hoveredPriceChange.toFixed(2)} (${hoveredPriceChangePct.toFixed(2)}%)` : '--'}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">{hoveredPoint ? hoveredPoint.volume.toLocaleString('en-US') : ''}</div>
        </div>
      </div>

      {/* K-Line SVG */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-[#08121c]">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="block h-[420px] w-full" preserveAspectRatio="none">
          {/* Grid lines */}
          {Array.from({ length: 5 }, (_, i) => {
            const y = chartPadding.top + (drawableHeight / 4) * i;
            const price = visibleMaxPrice - (visiblePriceSpan / 4) * i;
            return (
              <g key={`grid-${i}`}>
                <line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} stroke="rgba(26,45,66,0.8)" strokeWidth={1} />
                <text x={chartWidth - chartPadding.right + 10} y={y + 4} fill="#7a9bb5" fontSize="11" fontFamily="JetBrains Mono">{price.toFixed(2)}</text>
              </g>
            );
          })}

          {/* Candles + B/S markers */}
          {visibleKlineData.map((item, i) => {
            const xCenter = chartPadding.left + candleSlotWidth * i + candleSlotWidth / 2;
            const x = xCenter - candleBodyWidth / 2;
            const openY = yOfPrice(item.open);
            const closeY = yOfPrice(item.close);
            const highY = yOfPrice(item.high);
            const lowY = yOfPrice(item.low);
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(openY - closeY), 1);
            const isRising = item.close >= item.open;
            const color = isRising ? '#ff3366' : '#00ff88';
            const isHovered = hoveredCandleIndex === i;
            const marker = markerMap.get(item.date);

            return (
              <g key={`${item.date}-${i}`}>
                {marker && (
                  <rect
                    x={chartPadding.left + candleSlotWidth * i + Math.max((candleSlotWidth - 20) / 2, 0)}
                    y={Math.max(highY - 10, chartPadding.top)}
                    width={Math.min(candleSlotWidth, 20)}
                    height={Math.min(Math.max(lowY - highY + 20, 30), drawableHeight)}
                    fill="rgba(255, 214, 10, 0.18)"
                    stroke="rgba(255, 214, 10, 0.62)"
                    strokeWidth={1}
                    rx={4}
                  />
                )}
                <line x1={xCenter} x2={xCenter} y1={highY} y2={lowY} stroke={color} strokeWidth={1} />
                <rect x={x} y={bodyTop} width={candleBodyWidth} height={bodyHeight} fill={isRising ? 'rgba(255,51,102,0.18)' : 'rgba(0,255,136,0.18)'} stroke={color} strokeWidth={isHovered ? 1.6 : 1} rx={1} />
                {marker && (
                  <g>
                    {marker.type === 'buy' ? (
                      <polygon
                        points={`${xCenter},${Math.min(lowY + 3, chartHeight - chartPadding.bottom - 14)} ${xCenter - 8},${Math.min(lowY + 18, chartHeight - chartPadding.bottom)} ${xCenter + 8},${Math.min(lowY + 18, chartHeight - chartPadding.bottom)}`}
                        fill="#ffd60a" stroke="#b88900" strokeWidth={1}
                      />
                    ) : (
                      <polygon
                        points={`${xCenter},${Math.max(highY - 3, chartPadding.top + 14)} ${xCenter - 8},${Math.max(highY - 18, chartPadding.top)} ${xCenter + 8},${Math.max(highY - 18, chartPadding.top)}`}
                        fill="#ffd60a" stroke="#b88900" strokeWidth={1}
                      />
                    )}
                    <text
                      x={xCenter}
                      y={marker.type === 'buy' ? Math.min(lowY + 15, chartHeight - chartPadding.bottom - 3) : Math.max(highY - 9, chartPadding.top + 12)}
                      textAnchor="middle" fill="#08121c" fontSize="10" fontFamily="JetBrains Mono" fontWeight="700"
                    >
                      {marker.label}{(marker.count ?? 1) > 1 ? marker.count : ''}
                    </text>
                  </g>
                )}
                <rect x={chartPadding.left + candleSlotWidth * i} y={chartPadding.top} width={Math.max(candleSlotWidth, 8)} height={drawableHeight} fill="transparent"
                  onMouseEnter={() => setHoveredCandleIndex(i)} onMouseMove={() => setHoveredCandleIndex(i)}
                  onClick={() => onCandleClick?.(item.date)} style={{ cursor: onCandleClick ? 'pointer' : 'default' }} />
              </g>
            );
          })}

          {/* Crosshair */}
          {hoveredPoint && hoveredCandleIndex !== null && (
            <>
              <line x1={chartPadding.left + candleSlotWidth * hoveredCandleIndex + candleSlotWidth / 2} x2={chartPadding.left + candleSlotWidth * hoveredCandleIndex + candleSlotWidth / 2} y1={chartPadding.top} y2={chartHeight - chartPadding.bottom} stroke="rgba(0,212,255,0.45)" strokeDasharray="4 4" />
              <line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={yOfPrice(hoveredPoint.close)} y2={yOfPrice(hoveredPoint.close)} stroke="rgba(0,212,255,0.35)" strokeDasharray="4 4" />
            </>
          )}

          {/* X-axis labels */}
          {visibleKlineData.map((item, i) => {
            if (i % Math.max(Math.floor(visibleKlineData.length / 6), 1) !== 0 && i !== visibleKlineData.length - 1) return null;
            const xCenter = chartPadding.left + candleSlotWidth * i + candleSlotWidth / 2;
            return <text key={`label-${item.date}`} x={xCenter} y={chartHeight - 10} textAnchor="middle" fill="#7a9bb5" fontSize="11" fontFamily="JetBrains Mono">{item.date}</text>;
          })}
        </svg>
      </div>

      {/* Window slider */}
      {visibleWindowSize < klineData.length && (
        <div className="mt-3 rounded-md border border-border bg-card/40 px-3 py-2">
          <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span>视窗</span>
            <span>{clampedWindowStart + 1} - {Math.min(clampedWindowStart + visibleWindowSize, klineData.length)} / {klineData.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { setPriceWindowStart(Math.max(clampedWindowStart - Math.max(Math.floor(visibleWindowSize / 4), 1), 0)); setHoveredCandleIndex(null); }}
              className="h-7 rounded border border-border px-3 font-mono text-[11px] text-muted-foreground transition hover:border-primary/30 hover:text-foreground">◀</button>
            <input type="range" min="0" max={String(Math.max(klineData.length - visibleWindowSize, 0))} value={clampedWindowStart}
              onChange={(e) => { setPriceWindowStart(Number(e.target.value)); setHoveredCandleIndex(null); }}
              className="h-1 w-full cursor-pointer appearance-none rounded bg-border" />
            <button type="button" onClick={() => { setPriceWindowStart(Math.min(clampedWindowStart + Math.max(Math.floor(visibleWindowSize / 4), 1), Math.max(klineData.length - visibleWindowSize, 0))); setHoveredCandleIndex(null); }}
              className="h-7 rounded border border-border px-3 font-mono text-[11px] text-muted-foreground transition hover:border-primary/30 hover:text-foreground">▶</button>
          </div>
        </div>
      )}

      {/* MACD Subplot */}
      <div className="mt-3 rounded-lg border border-border bg-[#08121c] p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">MACD</div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={visibleKlineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2d42" opacity={0.45} />
            <XAxis dataKey="date" stroke="#7a9bb5" tick={{ fontSize: 9 }} interval={Math.max(Math.floor(visibleKlineData.length / 6), 1)} />
            <YAxis stroke="#7a9bb5" tick={{ fontSize: 9 }} width={40} />
            <Tooltip contentStyle={{ backgroundColor: '#0c1520', border: '1px solid #1a2d42', borderRadius: '6px', fontSize: '11px' }} />
            <ReferenceLine y={0} stroke="#7a9bb5" strokeDasharray="2 2" />
            <Bar dataKey="macd" fill="#00d4ff" opacity={0.6} name="MACD" />
            <Line type="monotone" dataKey="dif" stroke="#ff3366" strokeWidth={1.5} dot={false} name="DIF" />
            <Line type="monotone" dataKey="dea" stroke="#00ff88" strokeWidth={1.5} dot={false} name="DEA" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// React imports needed
import { useEffect, useState } from 'react';
