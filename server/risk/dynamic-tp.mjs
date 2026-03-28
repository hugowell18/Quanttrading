/**
 * 动态止盈计算器
 * 根据市场情绪 + 个股封板质量，动态调整止盈目标
 *
 * 公式：
 *   最终止盈 = clamp(基础止盈 × 市场系数 × 个股系数, MIN_TP, MAX_TP)
 *
 * 市场系数（情绪状态 + 热度分）：
 *   主升/高潮 + heatScore>=80 → 1.8
 *   主升/高潮 + heatScore>=60 → 1.4
 *   启动                      → 1.0
 *   退潮/冰点                 → 0.8
 *
 * 个股系数（封板时间 + 封单强度）：
 *   封板 <=09:35 → +0.3
 *   封板 <=10:00 → +0.15
 *   封板 >13:30  → -0.2
 *   sealRatio>=5% → +0.2
 *   sealRatio>=2% → +0.1
 */

const MIN_TP = 3;   // 最低止盈 3%
const MAX_TP = 15;  // 最高止盈 15%

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

// ──────────────────────────────────────────────
// 市场系数
// ──────────────────────────────────────────────

function marketMultiplier(emotionState, heatScore) {
  if (emotionState === '主升' || emotionState === '高潮') {
    if (heatScore >= 80) return 1.8;
    if (heatScore >= 60) return 1.4;
    return 1.2;
  }
  if (emotionState === '启动') return 1.0;
  return 0.8;  // 退潮 / 冰点
}

// ──────────────────────────────────────────────
// 个股系数
// ──────────────────────────────────────────────

function stockMultiplier(firstSealTime, sealRatio) {
  let adj = 1.0;

  // 封板时间调整
  if (firstSealTime && firstSealTime !== '09:25:00') {
    const [hh, mm] = firstSealTime.split(':').map(Number);
    const minutes = hh * 60 + mm;
    if (minutes <= 9 * 60 + 35)       adj += 0.30;  // 强势早封
    else if (minutes <= 10 * 60)      adj += 0.15;  // 上午封板
    else if (minutes >= 13 * 60 + 30) adj -= 0.20;  // 尾盘弱封
  }

  // 封单强度调整（sealRatio = seal_amount / circ_mv）
  if (sealRatio >= 0.05)      adj += 0.20;
  else if (sealRatio >= 0.02) adj += 0.10;

  return Math.max(adj, 0.6);  // 个股系数最低 0.6
}

// ──────────────────────────────────────────────
// 主函数
// ──────────────────────────────────────────────

/**
 * 计算动态止盈目标
 *
 * @param {object} candidate
 *   { firstSealTime: string, sealRatio: number, continuousDays: number }
 * @param {object} context
 *   { emotionState: string, heatScore: number, baseTpPct: number }
 * @returns {{ tpPct: number, breakdown: object }}
 */
export function calcDynamicTP(candidate, context) {
  const { firstSealTime = '', sealRatio = 0 } = candidate;
  const { emotionState = '冰点', heatScore = 50, baseTpPct = 5 } = context;

  const mMult = marketMultiplier(emotionState, heatScore);
  const sMult = stockMultiplier(firstSealTime, sealRatio);
  const raw   = baseTpPct * mMult * sMult;
  const tpPct = clamp(round2(raw), MIN_TP, MAX_TP);

  return {
    tpPct,
    breakdown: {
      baseTpPct,
      marketMultiplier:  round2(mMult),
      stockMultiplier:   round2(sMult),
      raw:               round2(raw),
      emotionState,
      heatScore,
      firstSealTime,
      sealRatio:         round2(sealRatio),
    },
  };
}
