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
  currentStrategy: '当前策略',
  currentSignal: '当前信号',
  defaultView: '默认视图',
  latestCount: '最近',
  kline: '根 K 线',
  openClose: '开 / 收',
  highLow: '高 / 低',
  changeVolume: '涨跌 / 成交量',
  window: '视窗滑动',
  strategyState: '策略状态',
  volumePulse: 'Volume Pulse',
  executionPlan: 'Execution Plan',
  liveText: '数据源 LIVE，当前 K 线已按该策略打出 B / S 点。',
  fallbackText: '数据源 FALLBACK，当前 K 线已按该策略打出 B / S 点。',
  currentVolume: '当前成交量 / 均量',
  riskBrief: 'Risk Brief',
  boundaryLevels: 'Boundary Levels',
  stopLoss: '止损',
  takeProfit: '止盈',
  suitableTrack: '主动跟踪',
  waitConfirm: '等待确认',
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
            {selectedStock.code} {' · '} {selectedStock.name} {' · '} {'日K'}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <div className="rounded border border-border bg-secondary/40 px-3 py-1.5 text-muted-foreground">
              {zh.currentStrategy}{': '}<span className="font-mono text-foreground">{activeStrategy.strategyName}</span>
            </div>
            <div className={`rounded border px-3 py-1.5 font-mono uppercase tracking-[0.12em] ${signalTone[activeStrategy.currentSignal]}`}>
              {zh.currentSignal}{': '}{activeStrategy.currentSignal}
            </div>
            <div className="rounded border border-border bg-secondary/40 px-3 py-1.5 font-mono text-muted-foreground">
              {'强度 '}{activeStrategy.signalStrength}
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
                    {hoveredPoint ? `${hoveredPoint.date} · ${selectedStock.code}` : `${selectedStock.code} · 日K`}
                  </div>
                </div>
                <div className="grid min-w-[300px] grid-cols-3 gap-2 text-[12px]">
                  <div className="rounded border border-border bg-card/60 px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{zh.openClose}</div>
                    <div className="mt-1 font-mono text-foreground">{hoveredPoint ? `¥${hoveredPoint.open.toFixed(2)} / ¥${hoveredPoint.close.toFixed(2)}` : '--'}</div>
                  </div>
                  <div className="rounded border border-border bg-card/60 px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{zh.highLow}</div>
                    <div className="mt-1 font-mono text-foreground">{hoveredPoint ? `¥${hoveredPoint.high.toFixed(2)} / ¥${hoveredPoint.low.toFixed(2)}` : '--'}</div>
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
                      {'◀'}
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
                      {'▶'}
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
                {activeStrategy.currentSignal} {' · '} {activeStrategy.signalStrength}
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
                <p>{'胜率 '}{winRate}{'，波动率 '}{volatility}{'，当前适合 '}{successRate >= 80 ? zh.suitableTrack : zh.waitConfirm}{' 节奏。'}</p>
                <p>{'跌破 '}{stopLoss}{' 触发减仓，靠近 '}{takeProfit}{' 分批止盈。'}</p>
                <p>{'若量能连续两日回落至均值下方，停止追价并观察新信号。'}</p>
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
              <div className="mt-2 text-sm text-muted-foreground">{'胜率 '}{winRate}{'，波动率 '}{volatility}{'，适合 '}{successRate >= 80 ? zh.suitableTrack : zh.waitConfirm}{' 节奏。'}</div>
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
