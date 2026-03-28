/**
 * 统一综合评分引擎
 * Phase 2E.1 / 需求 9 / 需求 10
 *
 * 5 维权重：
 *   板块集中度  25%  — 主线板块内涨停家数占比
 *   量价强度    25%  — 量比 + 涨幅位置
 *   封单质量    20%  — 封成比 + 首封时间 + 封流比（首板专用；非首板给基础分）
 *   市值弹性    15%  — 流通市值越小弹性越大，但过小流动性差
 *   技术共振    15%  — MACD金叉+5 / RSI>50+3 / 收盘>5日均线+2 / 收盘>布林中轨+2
 *
 * 用法（模块导入）：
 *   import { computeScore, computeTechResonance, computeFirstBoardScore }
 *     from './scoring-engine.mjs';
 */

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

// ──────────────────────────────────────────────
// 需求 9：技术共振加分（0–12 分，非否决项）
// ──────────────────────────────────────────────

/**
 * 计算技术共振加分
 *
 * @param {object} tech
 * @param {number|null} tech.macdDif      MACD DIF 值
 * @param {number|null} tech.macdDea      MACD DEA 值
 * @param {number|null} tech.prevMacdDif  前日 DIF（用于判断金叉）
 * @param {number|null} tech.prevMacdDea  前日 DEA
 * @param {number|null} tech.rsi          RSI(14) 或 RSI(6)
 * @param {number|null} tech.close        当日收盘价
 * @param {number|null} tech.ma5          5 日均线
 * @param {number|null} tech.bollMid      布林带中轨
 * @returns {{ score: number, items: string[] }}
 */
export function computeTechResonance({ macdDif, macdDea, prevMacdDif, prevMacdDea, rsi, close, ma5, bollMid } = {}) {
  let score = 0;
  const items = [];

  // MACD 金叉：前日 DIF <= DEA，今日 DIF > DEA
  const macdGolden =
    prevMacdDif != null && prevMacdDea != null &&
    macdDif != null && macdDea != null &&
    prevMacdDif <= prevMacdDea && macdDif > macdDea;
  // 或者已在金叉后（DIF > DEA）
  const macdBullish = macdDif != null && macdDea != null && macdDif > macdDea;

  if (macdGolden) {
    score += 5;
    items.push('MACD金叉(+5)');
  } else if (macdBullish) {
    score += 3;
    items.push('MACD多头(+3)');
  }

  if (rsi != null && rsi > 50) {
    score += 3;
    items.push(`RSI>${rsi.toFixed(0)}(+3)`);
  }

  if (close != null && ma5 != null && close > ma5) {
    score += 2;
    items.push('收盘>MA5(+2)');
  }

  if (close != null && bollMid != null && close > bollMid) {
    score += 2;
    items.push('收盘>布林中轨(+2)');
  }

  return { score: clamp(score, 0, 12), items };
}

// ──────────────────────────────────────────────
// 需求 6：首板质量评分（0–100）
// 封成比 40% + 首封时间 30% + 封流比 30%
// ──────────────────────────────────────────────

/**
 * 首封时间得分（0–30）：越早越好
 */
function firstSealTimeScore(firstSealTime) {
  if (!firstSealTime) return 0;
  const [hh, mm] = firstSealTime.split(':').map(Number);
  const minutes = hh * 60 + mm;
  if (minutes <= 9 * 60 + 26)  return 30;  // 竞价封板 / 一字板
  if (minutes <= 9 * 60 + 35)  return 25;  // 开盘5分钟内
  if (minutes <= 10 * 60)      return 20;  // 10:00 前
  if (minutes <= 11 * 60 + 30) return 12;  // 上午盘
  if (minutes <= 13 * 60 + 30) return 6;   // 午后开盘
  return 2;                                // 尾盘封板
}

/**
 * 计算首板质量综合评分（0–100）
 *
 * @param {object} params
 * @param {number} params.sealAmount    封板资金（元）
 * @param {number} params.circMv        流通市值（元）
 * @param {number} params.amount        今日成交额（元）
 * @param {string} params.firstSealTime 首次封板时间 "HH:MM:SS"
 * @returns {{ score: number, isHighQuality: boolean, detail: object }}
 */
export function computeFirstBoardScore({ sealAmount = 0, circMv = 0, amount = 0, firstSealTime = '' } = {}) {
  // 封成比 = 封板资金 / 流通市值（10% = 满分 40）
  const sealRatio = (circMv > 0 && sealAmount > 0) ? sealAmount / circMv : 0;
  const sealRatioPts = clamp(sealRatio * 400, 0, 40);

  // 首封时间（0–30）
  const timePts = firstSealTimeScore(firstSealTime);

  // 封流比 = 封板资金 / 成交额（20% = 满分 30）
  const sealFlowRatio = (amount > 0 && sealAmount > 0) ? sealAmount / amount : 0;
  const sealFlowPts = clamp(sealFlowRatio * 150, 0, 30);

  const score = Math.round(sealRatioPts + timePts + sealFlowPts);
  return {
    score,
    isHighQuality: score >= 60,
    detail: {
      sealRatio:    round2(sealRatio),
      sealRatioPts: round2(sealRatioPts),
      timePts,
      sealFlowRatio: round2(sealFlowRatio),
      sealFlowPts:  round2(sealFlowPts),
    },
  };
}

// ──────────────────────────────────────────────
// 各维度子评分（均归一化到 0–100）
// ──────────────────────────────────────────────

/**
 * 板块集中度得分（0–100）
 * 主线板块内涨停家数越多越好；非主线板块给 0
 *
 * @param {object} params
 * @param {boolean} params.inMainline       是否属于主线板块
 * @param {number}  params.sectorZtCount    所属板块今日涨停家数
 * @param {number}  params.sectorTotalCount 所属板块总成员数
 */
function sectorConcentrationScore({ inMainline = false, sectorZtCount = 0, sectorTotalCount = 1 } = {}) {
  if (!inMainline) return 0;
  const concentration = sectorTotalCount > 0 ? sectorZtCount / sectorTotalCount : 0;
  // 集中度 20% = 满分；线性映射
  return clamp(Math.round(concentration * 500), 0, 100);
}

/**
 * 量价强度得分（0–100）
 * 量比 + 涨幅位置（5%–9% 区间内越靠近 7% 越好）
 *
 * @param {object} params
 * @param {number} params.volRatio  量比（今日量 / 20日均量）
 * @param {number} params.pctChg   今日涨幅（%）
 */
function volumePriceScore({ volRatio = 0, pctChg = 0 } = {}) {
  // 量比：>3 满分 60；线性
  const volPts = clamp(volRatio * 20, 0, 60);

  // 涨幅位置：7% 附近最优（5%–9% 区间）
  const center = 7;
  const dist = Math.abs(pctChg - center);
  const pricePts = clamp(Math.round(40 * (1 - dist / 4)), 0, 40);

  return clamp(Math.round(volPts + pricePts), 0, 100);
}

/**
 * 封单质量得分（0–100）
 * 首板：使用 computeFirstBoardScore；非首板：给基础分（量比替代）
 *
 * @param {object} params
 * @param {boolean} params.isFirstBoard
 * @param {object}  params.firstBoardScore  computeFirstBoardScore 返回值（首板时传入）
 * @param {number}  params.volRatio         量比（非首板时用）
 */
function sealQualityScore({ isFirstBoard = false, firstBoardScore = null, volRatio = 0 } = {}) {
  if (isFirstBoard && firstBoardScore != null) {
    return firstBoardScore.score;  // 已是 0–100
  }
  // 非首板：量比作为资金意愿代理，量比 5 = 满分 60，基础分 20
  return clamp(20 + Math.round(volRatio * 8), 0, 100);
}

/**
 * 市值弹性得分（0–100）
 * 15–50 亿最优（弹性大且流动性足）；过小或过大均扣分
 *
 * @param {number} circMvYi 流通市值（亿元）
 */
function marketCapElasticityScore(circMvYi) {
  if (circMvYi < 15)  return 20;   // 过小，流动性风险
  if (circMvYi <= 50) return 100;  // 最优区间
  if (circMvYi <= 80) return 85;
  if (circMvYi <= 100) return 70;
  if (circMvYi <= 120) return 55;
  if (circMvYi <= 150) return 40;
  return 20;
}

// ──────────────────────────────────────────────
// 需求 10：综合评分主函数
// ──────────────────────────────────────────────

/**
 * 计算候选股 5 维综合评分（0–100）
 *
 * @param {object} candidate  候选股基础信息
 * @param {string} candidate.code
 * @param {number} candidate.pctChg        今日涨幅（%）
 * @param {number} candidate.circMvYi      流通市值（亿元）
 * @param {number} candidate.volRatio      量比
 * @param {boolean} candidate.isFirstBoard 是否首板
 * @param {object|null} candidate.firstBoardScore  computeFirstBoardScore 返回值
 *
 * @param {object} context  外部上下文
 * @param {boolean} context.inMainline          是否属于主线板块
 * @param {number}  context.sectorZtCount       板块涨停家数
 * @param {number}  context.sectorTotalCount    板块总成员数
 * @param {object}  [context.tech]              技术指标（可选）
 *   { macdDif, macdDea, prevMacdDif, prevMacdDea, rsi, close, ma5, bollMid }
 *
 * @returns {{ total: number, breakdown: object }}
 */
export function computeScore(candidate, context = {}) {
  const {
    pctChg = 0,
    circMvYi = 0,
    volRatio = 0,
    isFirstBoard = false,
    firstBoardScore = null,
  } = candidate;

  const {
    inMainline = false,
    sectorZtCount = 0,
    sectorTotalCount = 1,
    tech = {},
  } = context;

  // 各维度原始分（0–100）
  const s1 = sectorConcentrationScore({ inMainline, sectorZtCount, sectorTotalCount });
  const s2 = volumePriceScore({ volRatio, pctChg });
  const s3 = sealQualityScore({ isFirstBoard, firstBoardScore, volRatio });
  const s4 = marketCapElasticityScore(circMvYi);
  const techResult = computeTechResonance(tech);
  // 技术共振满分 12，归一化到 100
  const s5 = Math.round((techResult.score / 12) * 100);

  // 加权合计（权重：25/25/20/15/15）
  const total = Math.round(
    s1 * 0.25 +
    s2 * 0.25 +
    s3 * 0.20 +
    s4 * 0.15 +
    s5 * 0.15,
  );

  return {
    total: clamp(total, 0, 100),
    breakdown: {
      sectorConcentration: { score: s1, weight: '25%' },
      volumePrice:         { score: s2, weight: '25%' },
      sealQuality:         { score: s3, weight: '20%' },
      marketCapElasticity: { score: s4, weight: '15%' },
      techResonance:       { score: s5, weight: '15%', items: techResult.items, rawScore: techResult.score },
    },
  };
}
