import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  chartTabs,
  priceViewOptions,
  type ActiveStrategyContext,
  type ChartTab,
  type KLinePoint,
  type PriceViewPreset,
  type SignalMarker,
  type StockItem,
} from './types';

const zh = {
  currentStrategy: '\u5f53\u524d\u7b56\u7565',
  currentSignal: '\u5f53\u524d\u4fe1\u53f7',
  defaultView: '\u9ed8\u8ba4\u89c6\u56fe',
  latestCount: '\u6700\u8fd1',
  kline: '\u6839 K \u7ebf',
  openClose: '\u5f00 / \u6536',
  highLow: '\u9ad8 / \u4f4e',
  changeVolume: '\u6da8\u8dcc / \u6210\u4ea4\u91cf',
  window: '\u89c6\u7a97\u6ed1\u52a8',
  strategyState: '\u7b56\u7565\u72b6\u6001',
  volumePulse: 'Volume Pulse',
  executionPlan: 'Execution Plan',
  liveText: '\u6570\u636e\u6e90 LIVE\uff0c\u5f53\u524d K \u7ebf\u5df2\u6309\u8be5\u7b56\u7565\u6253\u51fa B / S \u70b9\u3002',
  fallbackText: '\u6570\u636e\u6e90 FALLBACK\uff0c\u5f53\u524d K \u7ebf\u5df2\u6309\u8be5\u7b56\u7565\u6253\u51fa B / S \u70b9\u3002',
  currentVolume: '\u5f53\u524d\u6210\u4ea4\u91cf / \u5747\u91cf',
  riskBrief: 'Risk Brief',
  boundaryLevels: 'Boundary Levels',
  stopLoss: '\u6b62\u635f',
  takeProfit: '\u6b62\u76c8',
  suitableTrack: '\u4e3b\u52a8\u8ddf\u8e2a',
  waitConfirm: '\u7b49\u5f85\u786e\u8ba4',
};

type KLineWorkspaceProps = {
  activeStrategy: ActiveStrategyContext;
  activeTab: ChartTab;
  averageVolume: number;
  candleBodyWidth: number;
  candleSlotWidth: number;
  chartHeight: number;
  chartPadding: { top: number; right: number; bottom: number; left: number };
  chartWidth: number;
  clampedWindowStart: number;
  dataSource: 'live' | 'fallback';
  drawableHeight: number;
  handleTabChange: (tab: ChartTab) => void;
  hoveredCandleIndex: number | null;
  hoveredPoint?: KLinePoint;
  hoveredPriceChange: number;
  hoveredPriceChangePct: number;
  klineData: KLinePoint[];
  latestVolume: number;
  priceView: PriceViewPreset;
  selectedStock: StockItem;
  setHoveredCandleIndex: (index: number | null) => void;
  setPriceView: (view: PriceViewPreset) => void;
  setPriceWindowStart: (value: number) => void;
  signalMarkers: SignalMarker[];
  stopLoss: string;
  successRate: number;
  takeProfit: string;
  visibleKlineData: KLinePoint[];
  visibleMaxPrice: number;
  visiblePriceSpan: number;
  visibleWindowSize: number;
  volatility: string;
  winRate: string;
  yOfVisiblePrice: (price: number) => number;
};

const signalTone = {
  buy: 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff9ab0]',
  sell: 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]',
  hold: 'border-[#ffaa00]/30 bg-[#ffaa00]/10 text-[#ffaa00]',
};

export function KLineWorkspace(props: KLineWorkspaceProps) {
  const {
    activeStrategy,
    activeTab,
    averageVolume,
    candleBodyWidth,
    candleSlotWidth,
    chartHeight,
    chartPadding,
    chartWidth,
    clampedWindowStart,
    dataSource,
    drawableHeight,
    handleTabChange,
    hoveredCandleIndex,
    hoveredPoint,
    hoveredPriceChange,
    hoveredPriceChangePct,
    klineData,
    latestVolume,
    priceView,
    selectedStock,
    setHoveredCandleIndex,
    setPriceView,
    setPriceWindowStart,
    signalMarkers,
    stopLoss,
    successRate,
    takeProfit,
    visibleKlineData,
    visibleMaxPrice,
    visiblePriceSpan,
    visibleWindowSize,
    volatility,
    winRate,
    yOfVisiblePrice,
  } = props;

  const visibleMarkerMap = new Map(
    signalMarkers
      .map((marker) => {
        const markerIndex = visibleKlineData.findIndex((item) => item.date === marker.date);
        return markerIndex >= 0 ? [marker.date, { ...marker, index: markerIndex }] : null;
      })
      .filter(Boolean)
      .map((entry) => entry as [string, SignalMarker & { index: number }]),
  );

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-mono text-[15px] font-semibold tracking-[0.08em] text-foreground">
            {selectedStock.code} {' \u00b7 '} {selectedStock.name} {' \u00b7 '} {'\u65e5K'}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <div className="rounded border border-border bg-secondary/40 px-3 py-1.5 text-muted-foreground">
              {zh.currentStrategy}{': '}<span className="font-mono text-foreground">{activeStrategy.strategyName}</span>
            </div>
            <div className={`rounded border px-3 py-1.5 font-mono uppercase tracking-[0.12em] ${signalTone[activeStrategy.currentSignal]}`}>
              {zh.currentSignal}{': '}{activeStrategy.currentSignal}
            </div>
            <div className="rounded border border-border bg-secondary/40 px-3 py-1.5 font-mono text-muted-foreground">
              {'\u5f3a\u5ea6 '}{activeStrategy.signalStrength}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {chartTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`rounded-md border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                activeTab === tab.id
                  ? 'border-primary/30 bg-primary/12 text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'price' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {priceViewOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPriceView(option.id)}
                    className={`rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                      priceView === option.id
                        ? 'border-primary/30 bg-primary/12 text-primary'
                        : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {zh.defaultView}{': '}{zh.latestCount} {visibleWindowSize || 0} {zh.kline}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">KLine Inspector</div>
                  <div className="mt-2 font-mono text-sm text-foreground">
                    {hoveredPoint ? `${hoveredPoint.date} \u00b7 ${selectedStock.code}` : `${selectedStock.code} \u00b7 \u65e5K`}
                  </div>
                </div>
                <div className="grid min-w-[300px] grid-cols-3 gap-2 text-[12px]">
                  <div className="rounded border border-border bg-card/60 px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{zh.openClose}</div>
                    <div className="mt-1 font-mono text-foreground">{hoveredPoint ? `\u00a5${hoveredPoint.open.toFixed(2)} / \u00a5${hoveredPoint.close.toFixed(2)}` : '--'}</div>
                  </div>
                  <div className="rounded border border-border bg-card/60 px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{zh.highLow}</div>
                    <div className="mt-1 font-mono text-foreground">{hoveredPoint ? `\u00a5${hoveredPoint.high.toFixed(2)} / \u00a5${hoveredPoint.low.toFixed(2)}` : '--'}</div>
                  </div>
                  <div className="rounded border border-border bg-card/60 px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{zh.changeVolume}</div>
                    <div className={`mt-1 font-mono ${hoveredPriceChange >= 0 ? 'text-[#ff3366]' : 'text-[#00ff88]'}`}>
                      {hoveredPoint ? `${hoveredPriceChange >= 0 ? '+' : ''}${hoveredPriceChange.toFixed(2)} (${hoveredPriceChangePct.toFixed(2)}%)` : '--'}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">{hoveredPoint ? hoveredPoint.volume.toLocaleString('en-US') : '--'}</div>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-lg border border-border bg-[#08121c]">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="block h-[360px] w-full" preserveAspectRatio="none">
                  {Array.from({ length: 5 }, (_, index) => {
                    const y = chartPadding.top + (drawableHeight / 4) * index;
                    const axisPrice = visibleMaxPrice - (visiblePriceSpan / 4) * index;
                    return (
                      <g key={`grid-${index}`}>
                        <line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} stroke="rgba(26,45,66,0.8)" strokeWidth={1} />
                        <text x={chartWidth - chartPadding.right + 10} y={y + 4} fill="#7a9bb5" fontSize="11" fontFamily="JetBrains Mono">{axisPrice.toFixed(2)}</text>
                      </g>
                    );
                  })}

                  {visibleKlineData.map((item, index) => {
                    const xCenter = chartPadding.left + candleSlotWidth * index + candleSlotWidth / 2;
                    const x = xCenter - candleBodyWidth / 2;
                    const openY = yOfVisiblePrice(item.open);
                    const closeY = yOfVisiblePrice(item.close);
                    const highY = yOfVisiblePrice(item.high);
                    const lowY = yOfVisiblePrice(item.low);
                    const bodyTop = Math.min(openY, closeY);
                    const bodyHeight = Math.max(Math.abs(openY - closeY), 1);
                    const isRising = item.close >= item.open;
                    const color = isRising ? '#ff3366' : '#00ff88';
                    const isHovered = hoveredCandleIndex === index;
                    const marker = visibleMarkerMap.get(item.date);

                    return (
                      <g key={`${item.date}-${index}`}>
                        {marker ? (
                          <rect
                            x={chartPadding.left + candleSlotWidth * index + Math.max((candleSlotWidth - 20) / 2, 0)}
                            y={Math.max(highY - 10, chartPadding.top)}
                            width={Math.min(candleSlotWidth, 20)}
                            height={Math.min(Math.max(lowY - highY + 20, 30), drawableHeight)}
                            fill="rgba(255, 214, 10, 0.18)"
                            stroke="rgba(255, 214, 10, 0.62)"
                            strokeWidth={1}
                            rx={4}
                          />
                        ) : null}
                        <line x1={xCenter} x2={xCenter} y1={highY} y2={lowY} stroke={color} strokeWidth={1} />
                        <rect x={x} y={bodyTop} width={candleBodyWidth} height={bodyHeight} fill={isRising ? 'rgba(255,51,102,0.18)' : 'rgba(0,255,136,0.18)'} stroke={color} strokeWidth={isHovered ? 1.6 : 1} rx={1} />
                        {marker ? (
                          <g>
                            {marker.type === 'buy' ? (
                              <polygon
                                points={`${xCenter},${Math.min(lowY + 3, chartHeight - chartPadding.bottom - 14)} ${xCenter - 8},${Math.min(lowY + 18, chartHeight - chartPadding.bottom)} ${xCenter + 8},${Math.min(lowY + 18, chartHeight - chartPadding.bottom)}`}
                                fill="#ffd60a"
                                stroke="#b88900"
                                strokeWidth={1}
                              />
                            ) : (
                              <polygon
                                points={`${xCenter},${Math.max(highY - 3, chartPadding.top + 14)} ${xCenter - 8},${Math.max(highY - 18, chartPadding.top)} ${xCenter + 8},${Math.max(highY - 18, chartPadding.top)}`}
                                fill="#ffd60a"
                                stroke="#b88900"
                                strokeWidth={1}
                              />
                            )}
                            <text
                              x={xCenter}
                              y={marker.type === 'buy' ? Math.min(lowY + 15, chartHeight - chartPadding.bottom - 3) : Math.max(highY - 9, chartPadding.top + 12)}
                              textAnchor="middle"
                              fill="#08121c"
                              fontSize="10"
                              fontFamily="JetBrains Mono"
                              fontWeight="700"
                            >
                              {marker.label}{(marker.count ?? 1) > 1 ? marker.count : ''}
                            </text>
                          </g>
                        ) : null}
                        <rect x={chartPadding.left + candleSlotWidth * index} y={chartPadding.top} width={Math.max(candleSlotWidth, 8)} height={drawableHeight} fill="transparent" onMouseEnter={() => setHoveredCandleIndex(index)} onMouseMove={() => setHoveredCandleIndex(index)} />
                      </g>
                    );
                  })}

                  {hoveredPoint && hoveredCandleIndex !== null ? (
                    <>
                      <line x1={chartPadding.left + candleSlotWidth * hoveredCandleIndex + candleSlotWidth / 2} x2={chartPadding.left + candleSlotWidth * hoveredCandleIndex + candleSlotWidth / 2} y1={chartPadding.top} y2={chartHeight - chartPadding.bottom} stroke="rgba(0,212,255,0.45)" strokeDasharray="4 4" />
                      <line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={yOfVisiblePrice(hoveredPoint.close)} y2={yOfVisiblePrice(hoveredPoint.close)} stroke="rgba(0,212,255,0.35)" strokeDasharray="4 4" />
                    </>
                  ) : null}

                  {visibleKlineData.map((item, index) => {
                    if (index % Math.max(Math.floor(visibleKlineData.length / 6), 1) !== 0 && index !== visibleKlineData.length - 1) {
                      return null;
                    }
                    const xCenter = chartPadding.left + candleSlotWidth * index + candleSlotWidth / 2;
                    return (
                      <text key={`label-${item.date}-${index}`} x={xCenter} y={chartHeight - 10} textAnchor="middle" fill="#7a9bb5" fontSize="11" fontFamily="JetBrains Mono">{item.date}</text>
                    );
                  })}
                </svg>
              </div>

              {visibleWindowSize < klineData.length ? (
                <div className="mt-4 rounded-md border border-border bg-card/40 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <span>{zh.window}</span>
                    <span>{clampedWindowStart + 1} - {Math.min(clampedWindowStart + visibleWindowSize, klineData.length)} / {klineData.length}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPriceWindowStart(Math.max(clampedWindowStart - Math.max(Math.floor(visibleWindowSize / 4), 1), 0));
                        setHoveredCandleIndex(null);
                      }}
                      className="h-8 rounded border border-border px-3 font-mono text-[11px] text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
                    >
                      {'\u25c0'}
                    </button>
                    <input type="range" min="0" max={String(Math.max(klineData.length - visibleWindowSize, 0))} value={clampedWindowStart} onChange={(event) => { setPriceWindowStart(Number(event.target.value)); setHoveredCandleIndex(null); }} className="h-1 w-full cursor-pointer appearance-none rounded bg-border" />
                    <button
                      type="button"
                      onClick={() => {
                        setPriceWindowStart(Math.min(clampedWindowStart + Math.max(Math.floor(visibleWindowSize / 4), 1), Math.max(klineData.length - visibleWindowSize, 0)));
                        setHoveredCandleIndex(null);
                      }}
                      className="h-8 rounded border border-border px-3 font-mono text-[11px] text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
                    >
                      {'\u25b6'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{zh.strategyState}</div>
              <div className="mt-3 text-lg text-foreground">{activeStrategy.strategyName}</div>
              <div className={`mt-3 inline-flex rounded border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${signalTone[activeStrategy.currentSignal]}`}>
                {activeStrategy.currentSignal} {' \u00b7 '} {activeStrategy.signalStrength}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{dataSource === 'live' ? zh.liveText : zh.fallbackText}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{zh.volumePulse}</div>
              <div className="mt-3 text-2xl font-mono text-foreground">{latestVolume.toLocaleString('en-US')}</div>
              <div className="mt-1 text-xs text-muted-foreground">{zh.currentVolume} {averageVolume.toLocaleString('en-US')}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{zh.executionPlan}</div>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>{'\u80dc\u7387 '}{winRate}{'\uff0c\u6ce2\u52a8\u7387 '}{volatility}{'\uff0c\u5f53\u524d\u9002\u5408 '}{successRate >= 80 ? zh.suitableTrack : zh.waitConfirm}{' \u8282\u594f\u3002'}</p>
                <p>{'\u8dcc\u7834 '}{stopLoss}{' \u89e6\u53d1\u51cf\u4ed3\uff0c\u9760\u8fd1 '}{takeProfit}{' \u5206\u6279\u6b62\u76c8\u3002'}</p>
                <p>{'\u82e5\u91cf\u80fd\u8fde\u7eed\u4e24\u65e5\u56de\u843d\u81f3\u5747\u503c\u4e0b\u65b9\uff0c\u505c\u6b62\u8ffd\u4ef7\u5e76\u89c2\u5bdf\u65b0\u4fe1\u53f7\u3002'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'momentum' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-secondary/40 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">MACD / Trend</div>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={klineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2d42" opacity={0.45} />
                <XAxis dataKey="date" stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                <YAxis stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0c1520', border: '1px solid #1a2d42', borderRadius: '8px' }} />
                <ReferenceLine y={0} stroke="#7a9bb5" strokeDasharray="2 2" />
                <Bar dataKey="macd" fill="#00d4ff" opacity={0.6} name="MACD" />
                <Line type="monotone" dataKey="dif" stroke="#ff3366" strokeWidth={2} dot={false} name="DIF" />
                <Line type="monotone" dataKey="dea" stroke="#00ff88" strokeWidth={2} dot={false} name="DEA" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">KDJ / RSI</div>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={klineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2d42" opacity={0.45} />
                <XAxis dataKey="date" stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                <YAxis stroke="#7a9bb5" tick={{ fontSize: 11 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#0c1520', border: '1px solid #1a2d42', borderRadius: '8px' }} />
                <ReferenceLine y={80} stroke="#ff3366" strokeDasharray="3 3" />
                <ReferenceLine y={20} stroke="#00ff88" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="k" stroke="#00d4ff" strokeWidth={2} dot={false} name="K" />
                <Line type="monotone" dataKey="d" stroke="#ff3366" strokeWidth={2} dot={false} name="D" />
                <Line type="monotone" dataKey="j" stroke="#ffaa00" strokeWidth={2} dot={false} name="J" />
                <Line type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={2} dot={false} name="RSI" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'risk' && (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{zh.riskBrief}</div>
              <div className="mt-3 font-mono text-sm text-foreground">{dataSource === 'live' ? 'LIVE' : 'FALLBACK'}</div>
              <div className="mt-2 text-sm text-muted-foreground">{'\u80dc\u7387 '}{winRate}{'\uff0c\u6ce2\u52a8\u7387 '}{volatility}{'\uff0c\u9002\u5408 '}{successRate >= 80 ? zh.suitableTrack : zh.waitConfirm}{' \u8282\u594f\u3002'}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{zh.boundaryLevels}</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border px-3 py-3">
                  <div className="text-xs text-muted-foreground">{zh.stopLoss}</div>
                  <div className="mt-1 font-mono text-lg text-[#ff3366]">{stopLoss}</div>
                </div>
                <div className="rounded-md border border-border px-3 py-3">
                  <div className="text-xs text-muted-foreground">{zh.takeProfit}</div>
                  <div className="mt-1 font-mono text-lg text-[#00ff88]">{takeProfit}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Volatility Envelope</div>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={klineData}>
                <defs>
                  <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ffaa00" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#ffaa00" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2d42" opacity={0.45} />
                <XAxis dataKey="date" stroke="#7a9bb5" tick={{ fontSize: 11 }} />
                <YAxis stroke="#7a9bb5" tick={{ fontSize: 11 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#0c1520', border: '1px solid #1a2d42', borderRadius: '8px' }} />
                <ReferenceLine y={70} stroke="#ff3366" strokeDasharray="3 3" />
                <ReferenceLine y={30} stroke="#00ff88" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="rsi" stroke="#ffaa00" strokeWidth={2} fill="url(#riskFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
