/**
 * 主力资金流指标 (Main Force Money Flow - MFMF)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * KVO (Klinger量能振荡器) + CMF (Chaikin资金流) 双确认系统
 * 
 * 核心功能：
 *   - 识别主力抄底行为（窄幅缩量建仓）
 *   - 识别主力出货行为（宽幅放量出货）
 *   - 自动标注背离信号
 *   - 双确认过滤假信号
 */

import { useMemo, useState } from 'react';
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { KLinePoint } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

export type MFMFSignalType = 'bottom' | 'top' | 'breakthrough' | 'bullish_div' | 'bearish_div';

export interface MFMFSignal {
  date: string;
  type: MFMFSignalType;
  label: string;
  kvo: number;
}

export interface MFMFDataPoint {
  date: string;
  kvo: number;
  signal: number;
  histogram: number;
  cmf: number;
  signal_marker?: MFMFSignal;
}

interface MainForceMoneyFlowProps {
  klineData: KLinePoint[];
  mfmfData?: MFMFDataPoint[];  // 预先计算好的 MFMF 数据
  visibleSignals?: MFMFSignal[];  // 可见窗口的信号（用于时间轴）
  chartHeight?: number;
}

// 导出信号类型配置
export const MFMF_SIGNAL_CONFIG: Record<MFMFSignalType, { color: string; bg: string; border: string; icon: string; label: string }> = {
  bottom: { color: '#00ff88', bg: 'rgba(0,255,136,0.15)', border: 'rgba(0,255,136,0.4)', icon: '▲', label: '主力抄底' },
  top: { color: '#ff3366', bg: 'rgba(255,51,102,0.15)', border: 'rgba(255,51,102,0.4)', icon: '▼', label: '主力出货' },
  breakthrough: { color: '#00d4ff', bg: 'rgba(0,212,255,0.15)', border: 'rgba(0,212,255,0.4)', icon: '⚡', label: '强力介入' },
  bullish_div: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)', icon: '⚠️底', label: '底背离' },
  bearish_div: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)', icon: '⚠️顶', label: '顶背离' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 计算工具
// ─────────────────────────────────────────────────────────────────────────────

function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  let prev = 0;
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (i === period - 1) {
      const sum = data.slice(0, period).reduce((a, b) => a + b, 0);
      prev = sum / period;
      result.push(prev);
    } else {
      prev = (data[i] - prev) * multiplier + prev;
      result.push(prev);
    }
  }
  return result;
}

// 导出计算函数供 KLineChart 使用
export function calculateMFMF(klineData: KLinePoint[]): { data: MFMFDataPoint[]; signals: MFMFSignal[] } {
  if (klineData.length < 60) return { data: [], signals: [] };

  const n = klineData.length;
  
  // ── 步骤 1: 计算 KVO 组件 ──
  const kp: number[] = klineData.map(d => (d.high + d.low + d.close) / 3);
  const trend: number[] = [];
  const dm: number[] = klineData.map(d => d.high - d.low);
  const cm: number[] = [];
  const vf: number[] = [];

  // 趋势方向
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      trend.push(1);
    } else {
      trend.push(kp[i] > kp[i - 1] ? 1 : -1);
    }
  }

  // 累计振幅
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      cm.push(dm[i]);
    } else if (trend[i] === trend[i - 1]) {
      cm.push(cm[i - 1] + dm[i]);
    } else {
      cm.push(dm[i - 1] + dm[i]);
    }
  }

  // 量因子
  for (let i = 0; i < n; i++) {
    if (cm[i] === 0) {
      vf.push(0);
    } else {
      vf.push(klineData[i].volume * Math.abs(2 * (dm[i] / cm[i]) - 1) * trend[i] * 100);
    }
  }

  // KVO线 = EMA(VF, 34) - EMA(VF, 55)
  const ema34 = ema(vf, 34);
  const ema55 = ema(vf, 55);
  const kvoLine: number[] = [];
  for (let i = 0; i < n; i++) {
    if (isNaN(ema34[i]) || isNaN(ema55[i])) {
      kvoLine.push(NaN);
    } else {
      kvoLine.push(ema34[i] - ema55[i]);
    }
  }

  // Signal线 = EMA(KVO, 13)
  const validKVO = kvoLine.filter(v => !isNaN(v));
  const signalLine: number[] = ema(validKVO, 13);
  
  // 对齐信号线到原始数据长度
  const signalAligned: number[] = [];
  let sigIdx = 0;
  for (let i = 0; i < n; i++) {
    if (isNaN(kvoLine[i])) {
      signalAligned.push(NaN);
    } else {
      signalAligned.push(signalLine[sigIdx] ?? NaN);
      sigIdx++;
    }
  }

  // ── 步骤 2: 计算 CMF (20日) ──
  const cmfPeriod = 20;
  const mfm: number[] = klineData.map(d => {
    const hl = d.high - d.low;
    if (hl === 0) return 0;
    return ((2 * d.close - d.high - d.low) / hl);
  });

  const cmfLine: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < cmfPeriod - 1) {
      cmfLine.push(NaN);
    } else {
      const sliceMFM = mfm.slice(i - cmfPeriod + 1, i + 1);
      const sliceVol = klineData.slice(i - cmfPeriod + 1, i + 1).map(d => d.volume);
      const numerator = sliceMFM.reduce((sum, v, idx) => sum + v * sliceVol[idx], 0);
      const denominator = sliceVol.reduce((a, b) => a + b, 0);
      cmfLine.push(denominator === 0 ? 0 : numerator / denominator);
    }
  }

  // ── 步骤 3: 检测信号 ──
  const signals: MFMFSignal[] = [];
  const startIdx = 55; // 等待 EMA 稳定

  for (let i = startIdx + 1; i < n; i++) {
    const prevKVO = kvoLine[i - 1];
    const currKVO = kvoLine[i];
    const prevSig = signalAligned[i - 1];
    const currSig = signalAligned[i];
    const currCMF = cmfLine[i];

    if (isNaN(prevKVO) || isNaN(currKVO) || isNaN(prevSig) || isNaN(currSig) || isNaN(currCMF)) continue;

    // 🟢 主力抄底: KVO上穿Signal 且 CMF > +0.05
    if (prevKVO <= prevSig && currKVO > currSig && currCMF > 0.05) {
      signals.push({
        date: klineData[i].date,
        type: 'bottom',
        label: '主力抄底',
        kvo: currKVO,
      });
    }

    // 🔴 主力出货: KVO下穿Signal 且 CMF < -0.05
    if (prevKVO >= prevSig && currKVO < currSig && currCMF < -0.05) {
      signals.push({
        date: klineData[i].date,
        type: 'top',
        label: '主力出货',
        kvo: currKVO,
      });
    }

    // ⚡ 强力介入: KVO由负转正
    if (prevKVO <= 0 && currKVO > 0) {
      signals.push({
        date: klineData[i].date,
        type: 'breakthrough',
        label: '强力介入',
        kvo: currKVO,
      });
    }
  }

  // ── 步骤 4: 检测背离 ──
  // 找价格高点和 KVO 高点
  const windowSize = 20;
  for (let i = startIdx + windowSize; i < n - windowSize; i++) {
    const isLocalHighPrice = klineData.slice(i - windowSize, i + windowSize + 1)
      .every((d, idx) => idx === windowSize ? d.close >= klineData[i - windowSize + idx].close : true);
    
    const isLocalLowPrice = klineData.slice(i - windowSize, i + windowSize + 1)
      .every((d, idx) => idx === windowSize ? d.close <= klineData[i - windowSize + idx].close : true);

    if (!isNaN(kvoLine[i])) {
      // 顶背离: 价格新高但 KVO 低于前高
      if (isLocalHighPrice && i > startIdx + windowSize * 2) {
        const prevHighIdx = klineData.slice(startIdx, i - windowSize)
          .reduce((maxIdx, d, idx) => d.close > klineData[maxIdx].close ? idx : maxIdx, startIdx);
        
        if (klineData[i].close > klineData[prevHighIdx].close && kvoLine[i] < kvoLine[prevHighIdx]) {
          signals.push({
            date: klineData[i].date,
            type: 'bearish_div',
            label: '顶背离',
            kvo: kvoLine[i],
          });
        }
      }

      // 底背离: 价格新低但 KVO 高于前低
      if (isLocalLowPrice && i > startIdx + windowSize * 2) {
        const prevLowIdx = klineData.slice(startIdx, i - windowSize)
          .reduce((minIdx, d, idx) => d.close < klineData[minIdx].close ? idx : minIdx, startIdx);
        
        if (klineData[i].close < klineData[prevLowIdx].close && kvoLine[i] > kvoLine[prevLowIdx]) {
          signals.push({
            date: klineData[i].date,
            type: 'bullish_div',
            label: '底背离',
            kvo: kvoLine[i],
          });
        }
      }
    }
  }

  // ── 步骤 5: 组装数据 ──
  const signalMap = new Map(signals.map(s => [s.date, s]));
  const data: MFMFDataPoint[] = klineData.map((d, i) => {
    const hist = (isNaN(kvoLine[i]) || isNaN(signalAligned[i])) ? 0 : kvoLine[i] - signalAligned[i];
    return {
      date: d.date,
      kvo: isNaN(kvoLine[i]) ? 0 : kvoLine[i],
      signal: isNaN(signalAligned[i]) ? 0 : signalAligned[i],
      histogram: hist,
      histogramPos: hist > 0 ? hist : 0,
      histogramNeg: hist < 0 ? hist : 0,
      cmf: isNaN(cmfLine[i]) ? 0 : cmfLine[i],
      signal_marker: signalMap.get(d.date),
    };
  });

  return { data, signals };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

const CHART_HEIGHT = 280;
const ZERO_LINE = 0;

export function MainForceMoneyFlow({ klineData, mfmfData, visibleSignals, chartHeight = CHART_HEIGHT }: MainForceMoneyFlowProps) {
  // 如果传入了预计算数据就直接使用，否则自己计算
  const { data } = useMemo(() => {
    if (mfmfData && mfmfData.length > 0) {
      return { data: mfmfData, signals: [] };
    }
    return calculateMFMF(klineData);
  }, [mfmfData, klineData]);
  const [showHelp, setShowHelp] = useState(false);

  // 使用传入的可见信号，或从数据中提取
  const signalsForTimeline = visibleSignals ?? useMemo(() => 
    data.filter(d => d.signal_marker).map(d => d.signal_marker!),
    [data]
  );
  
  // 按日期排序信号
  const sortedSignals = useMemo(() => 
    [...signalsForTimeline].sort((a, b) => b.date.localeCompare(a.date)),
    [signalsForTimeline]
  );

  if (data.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-border bg-[#08121c] p-3" style={{ height: chartHeight }}>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">主力资金流 (MFMF)</div>
        <div className="flex h-[200px] items-center justify-center font-mono text-[11px] text-muted-foreground">
          数据不足，需要至少 60 个交易日
        </div>
      </div>
    );
  }

  // 计算 Y 轴范围
  const kvoValues = data.map(d => Math.max(Math.abs(d.kvo), Math.abs(d.signal), Math.abs(d.histogram))).filter(Boolean);
  const maxKVO = kvoValues.length ? Math.max(...kvoValues) * 1.1 : 100;

  const lastPoint = data[data.length - 1];
  const kvoChange = lastPoint.kvo - (data[data.length - 2]?.kvo ?? 0);

  return (
    <div className="mt-3 rounded-lg border border-border bg-[#08121c] p-3">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            主力资金流 (MFMF)
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="flex h-4 w-4 items-center justify-center rounded-full border border-border/50 bg-secondary/40 font-mono text-[9px] text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            title="查看规则"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-3 font-mono text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-white"></span>
            KVO
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-[#ff8c00]"></span>
            Signal
          </span>
        </div>
      </div>

      {/* 规则说明（可展开） */}
      {showHelp && (
        <div className="mb-2 rounded border border-primary/30 bg-primary/5 px-3 py-2 text-[10px] leading-relaxed">
          <div className="mb-1 font-mono text-[10px] font-bold text-primary">📖 信号规则</div>
          <div className="grid grid-cols-1 gap-1 text-muted-foreground">
            <div><span className="text-[#00ff88]">🟢 主力抄底</span>：KVO上穿Signal <b>且</b> 动能放大</div>
            <div><span className="text-[#ff3366]">🔴 主力出货</span>：KVO下穿Signal <b>且</b> 动能放大</div>
            <div><span className="text-[#00d4ff]">⚡ 强力介入</span>：KVO由负转正（穿越零轴）</div>
            <div><span className="text-yellow-400">⚠️ 背离</span>：价格新高/低但KVO未跟随</div>
          </div>
          <div className="mt-1.5 border-t border-border/30 pt-1.5 text-[9px] text-muted-foreground/70">
            💡 白线=KVO（主力动能），橙线=Signal（平滑确认）。柱状图=两者差值（绿强红弱）。
          </div>
        </div>
      )}

      {/* 指标数值 */}
      <div className="mb-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded border border-border/50 bg-secondary/20 px-2 py-1.5">
          <div className="text-muted-foreground">KVO</div>
          <div className={`font-mono text-[12px] font-bold ${kvoChange >= 0 ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
            {lastPoint.kvo.toFixed(1)}
          </div>
        </div>
        <div className="rounded border border-border/50 bg-secondary/20 px-2 py-1.5">
          <div className="text-muted-foreground">信号</div>
          <div className="font-mono text-[12px] font-bold text-primary">
            {signalsForTimeline.length > 0 ? signalsForTimeline[signalsForTimeline.length - 1].label : '无'}
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={chartHeight - 100}>
        <ComposedChart data={data}>
          <XAxis
            dataKey="date"
            stroke="#7a9bb5"
            tick={{ fontSize: 9 }}
            interval={Math.max(Math.floor(data.length / 6), 1)}
          />
          <YAxis
            stroke="#7a9bb5"
            tick={{ fontSize: 9 }}
            width={50}
            domain={[-maxKVO, maxKVO]}
            tickFormatter={(v) => v.toFixed(0)}
          />
          <ReferenceLine y={ZERO_LINE} stroke="#7a9bb5" strokeDasharray="3 3" />
          
          {/* Histogram - 分正负两个系列绘制 */}
          <Bar
            dataKey="histogramPos"
            name="KVO柱"
            fill="#00ff88"
            barSize={Math.max(1, Math.floor(600 / data.length))}
          />
          <Bar
            dataKey="histogramNeg"
            name="KVO柱"
            fill="#ff3366"
            barSize={Math.max(1, Math.floor(600 / data.length))}
          />
          
          {/* KVO Line */}
          <Line
            type="monotone"
            dataKey="kvo"
            stroke="#ffffff"
            strokeWidth={2}
            dot={false}
            name="KVO"
            isAnimationActive={false}
          />
          
          {/* Signal Line */}
          <Line
            type="monotone"
            dataKey="signal"
            stroke="#ff8c00"
            strokeWidth={1.5}
            dot={false}
            name="Signal"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
