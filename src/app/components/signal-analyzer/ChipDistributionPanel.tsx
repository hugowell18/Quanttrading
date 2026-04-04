/**
 * 筹码分布面板 (Chip Distribution Panel)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 与 KLineChart 共享价格轴（Y 轴），实现同花顺风格的筹码峰展示。
 *
 * 设计：
 *   - 独立 SVG，宽度 ~140px，高度与 KLineChart 完全相同（420px）
 *   - 水平条形图：条形从右向左延伸（价格轴在右侧，条形向左）
 *   - 绿色 = 获利盘（当前价以下），红色 = 套牢盘（当前价以上）
 *   - 标注：当前价（青色实线）、均成本（黄色虚线）、主峰价格标签
 *   - 成本带：70% 区间的蓝色半透明背景
 *
 * 用法（在 KLineChart 旁边使用）：
 *   <div className="flex gap-0">
 *     <KLineChart ... />
 *     <ChipDistributionPanel
 *       stockCode="300059"
 *       date={selectedDate}
 *       visibleMinPrice={visibleMinPrice}
 *       visibleMaxPrice={visibleMaxPrice}
 *       chartHeight={420}
 *       chartPadding={{ top: 24, right: 0, bottom: 34, left: 8 }}
 *     />
 *   </div>
 */

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

interface Peak {
  price: number;
  share: number;
  weight: number;
  bucketIdx: number;
}

interface Band {
  low: number;
  high: number;
}

interface ChipData {
  tsCode: string;
  date: string;
  gridMin: number;
  gridMax: number;
  dp: number;
  nBuckets: number;
  distribution: number[];
  avgCost: number;
  profitRatio: number;
  currentPrice: number;
  peaks: Peak[];
  band70: Band | null;
  band90: Band | null;
  cyqMaturity: number;
  windowDays: number;
  lookback: number;
}

interface ChipDistributionPanelProps {
  stockCode: string;                     // 6位代码或 ts_code（如 300059 或 300059.SZ）
  date?: string;                         // YYYYMMDD，不传则后端取最新日期
  lookback?: number;                     // 默认 120
  // Y 轴对齐参数（与 KLineChart 保持一致）
  visibleMinPrice: number;
  visibleMaxPrice: number;
  chartHeight?: number;                  // 默认 420
  chartPadding?: { top: number; right: number; bottom: number; left: number };
  // 面板宽度
  panelWidth?: number;                   // 默认 140
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHART_HEIGHT  = 420;
const DEFAULT_PANEL_WIDTH   = 140;
const DEFAULT_PADDING       = { top: 24, right: 4, bottom: 34, left: 8 };

// 颜色方案
const COLOR_PROFIT    = '#00c853';   // 获利盘（绿）
const COLOR_LOSS      = '#ff3d3d';   // 套牢盘（红）
const COLOR_CURRENT   = '#00d4ff';   // 当前价（青）
const COLOR_AVG_COST  = '#ffd600';   // 均成本（黄）
const COLOR_BAND70    = 'rgba(100, 160, 255, 0.15)';  // 70% 成本带
const COLOR_PEAK_LABEL = '#e8eaed';

// ─────────────────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────────────────

function toTsCode(raw: string): string {
  const code = raw.trim().replace('.', '').slice(0, 6);
  return /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

export function ChipDistributionPanel({
  stockCode,
  date,
  lookback = 120,
  visibleMinPrice,
  visibleMaxPrice,
  chartHeight = DEFAULT_CHART_HEIGHT,
  chartPadding = DEFAULT_PADDING,
  panelWidth = DEFAULT_PANEL_WIDTH,
  className = '',
}: ChipDistributionPanelProps) {
  const [chipData, setChipData] = useState<ChipData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 数据拉取 ──
  useEffect(() => {
    if (!stockCode) return;
    const code = toTsCode(stockCode);
    const params = new URLSearchParams({ lookback: String(lookback) });
    if (date) params.set('date', date);

    setLoading(true);
    setError(null);

    fetch(`http://localhost:3001/api/chip/${code}?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setChipData(json.data);
        } else {
          setError(json.error ?? '无数据');
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [stockCode, date, lookback]);

  // ── Y 轴映射（与 KLineChart 完全一致）──
  const drawableHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const priceSpan = Math.max(visibleMaxPrice - visibleMinPrice, 1);

  const yOfPrice = (price: number): number =>
    chartPadding.top + ((visibleMaxPrice - price) / priceSpan) * drawableHeight;

  // ── 有效显示宽度 ──
  const barAreaWidth = panelWidth - chartPadding.left - chartPadding.right;

  // ── 骨架渲染（仅在没有任何数据时显示，有旧数据时继续展示旧数据）──
  if (!chipData) {
    return (
      <div
        style={{ width: panelWidth, height: chartHeight }}
        className={`flex flex-col items-center justify-center bg-[#08121c] border border-border/50 rounded-r-lg ${className}`}
      >
        <div className="text-[10px] text-muted-foreground rotate-90 whitespace-nowrap select-none">
          {loading ? '筹码加载中...' : error ? '无筹码数据' : '筹码峰'}
        </div>
      </div>
    );
  }

  const { distribution, gridMin, dp, nBuckets, currentPrice, avgCost, peaks, band70, cyqMaturity } = chipData;

  // ── 筹码条最大宽度归一化 ──
  const maxDensity = Math.max(...distribution, 1e-9);

  // ── 筹码桶价格中心 ──
  const bucketPrice = (k: number) => gridMin + (k + 0.5) * dp;

  // ── 找主峰（最大权重）──
  const primaryPeak = peaks[0] ?? null;
  const secondaryPeak = peaks[1] ?? null;

  return (
    <div
      style={{ width: panelWidth, height: chartHeight }}
      className={`bg-[#08121c] border-l border-border/50 rounded-r-lg overflow-hidden select-none ${className}`}
    >
      <svg
        viewBox={`0 0 ${panelWidth} ${chartHeight}`}
        width={panelWidth}
        height={chartHeight}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {/* ── 背景 ── */}
        <rect x={0} y={0} width={panelWidth} height={chartHeight} fill="#08121c" />

        {/* ── 70% 成本带高亮 ── */}
        {band70 && (() => {
          const y1 = yOfPrice(band70.high);
          const y2 = yOfPrice(band70.low);
          if (!isFinite(y1) || !isFinite(y2)) return null;
          return (
            <rect
              x={chartPadding.left}
              y={Math.min(y1, y2)}
              width={barAreaWidth}
              height={Math.abs(y2 - y1)}
              fill={COLOR_BAND70}
            />
          );
        })()}

        {/* ── 筹码条形图 ── */}
        {distribution.map((density, k) => {
          const price = bucketPrice(k);
          // 只绘制可见价格范围内的桶
          if (price < visibleMinPrice - dp || price > visibleMaxPrice + dp) return null;

          const barWidth = (density / maxDensity) * barAreaWidth;
          if (barWidth < 0.3) return null;

          const y = yOfPrice(price);
          const barHeight = Math.max(1, (dp / priceSpan) * drawableHeight - 0.5);
          const isProfit = price <= currentPrice;
          const fill = isProfit ? COLOR_PROFIT : COLOR_LOSS;

          return (
            <rect
              key={k}
              x={chartPadding.left}
              y={y - barHeight / 2}
              width={barWidth}
              height={barHeight}
              fill={fill}
              opacity={0.75}
            />
          );
        })}

        {/* ── 均成本线（黄色虚线）── */}
        {isFinite(yOfPrice(avgCost)) && (
          <line
            x1={chartPadding.left}
            x2={panelWidth - chartPadding.right}
            y1={yOfPrice(avgCost)}
            y2={yOfPrice(avgCost)}
            stroke={COLOR_AVG_COST}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.8}
          />
        )}

        {/* ── 当前价线（青色实线）── */}
        {isFinite(yOfPrice(currentPrice)) && (
          <line
            x1={chartPadding.left}
            x2={panelWidth - chartPadding.right}
            y1={yOfPrice(currentPrice)}
            y2={yOfPrice(currentPrice)}
            stroke={COLOR_CURRENT}
            strokeWidth={1.5}
            opacity={0.9}
          />
        )}

        {/* ── 主峰标签 ── */}
        {primaryPeak && isFinite(yOfPrice(primaryPeak.price)) && (
          <g>
            <rect
              x={chartPadding.left + 2}
              y={yOfPrice(primaryPeak.price) - 9}
              width={36}
              height={11}
              fill="rgba(0,0,0,0.55)"
              rx={2}
            />
            <text
              x={chartPadding.left + 4}
              y={yOfPrice(primaryPeak.price) - 1}
              fill={COLOR_PEAK_LABEL}
              fontSize={8}
              fontFamily="JetBrains Mono, monospace"
            >
              {primaryPeak.price.toFixed(2)}
            </text>
          </g>
        )}

        {/* ── 次峰标签 ── */}
        {secondaryPeak && isFinite(yOfPrice(secondaryPeak.price)) && (
          <g>
            <rect
              x={chartPadding.left + 2}
              y={yOfPrice(secondaryPeak.price) - 9}
              width={36}
              height={11}
              fill="rgba(0,0,0,0.55)"
              rx={2}
            />
            <text
              x={chartPadding.left + 4}
              y={yOfPrice(secondaryPeak.price) - 1}
              fill="rgba(232,234,237,0.7)"
              fontSize={8}
              fontFamily="JetBrains Mono, monospace"
            >
              {secondaryPeak.price.toFixed(2)}
            </text>
          </g>
        )}

        {/* ── 顶部标题 ── */}
        <text
          x={panelWidth / 2}
          y={chartPadding.top - 8}
          textAnchor="middle"
          fill="rgba(122,155,181,0.9)"
          fontSize={9}
          fontFamily="system-ui, sans-serif"
        >
          筹码峰 {lookback}日
        </text>

        {/* ── 底部元数据：获利盘 / 成熟度 ── */}
        <text
          x={chartPadding.left + 2}
          y={chartHeight - chartPadding.bottom + 12}
          fill="rgba(0,200,83,0.85)"
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
        >
          {(chipData.profitRatio * 100).toFixed(0)}%↑
        </text>
        <text
          x={panelWidth - chartPadding.right - 2}
          y={chartHeight - chartPadding.bottom + 12}
          textAnchor="end"
          fill="rgba(122,155,181,0.7)"
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
        >
          {(cyqMaturity * 100).toFixed(0)}%
        </text>

        {/* ── 均成本标签（仅当在可视范围内）── */}
        {avgCost >= visibleMinPrice && avgCost <= visibleMaxPrice && (
          <text
            x={panelWidth - chartPadding.right - 2}
            y={yOfPrice(avgCost) - 3}
            textAnchor="end"
            fill={COLOR_AVG_COST}
            fontSize={8}
            fontFamily="JetBrains Mono, monospace"
          >
            均{avgCost.toFixed(2)}
          </text>
        )}

        {/* ── 右侧竖线分隔 ── */}
        <line
          x1={chartPadding.left}
          y1={chartPadding.top}
          x2={chartPadding.left}
          y2={chartHeight - chartPadding.bottom}
          stroke="rgba(26,45,66,0.8)"
          strokeWidth={1}
        />

        {/* ── 加载中蒙层（保留旧数据，半透明遮盖）── */}
        {loading && (
          <rect x={0} y={0} width={panelWidth} height={chartHeight} fill="rgba(8,18,28,0.45)" />
        )}
      </svg>
    </div>
  );
}
