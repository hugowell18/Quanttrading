/**
 * 龙头首阴反包策略
 * Phase 2C.1 / 需求 8
 *
 * 识别条件：
 *   1. 近期连板天数 >= 3（强势龙头）
 *   2. 当日收阴线（close < open，即首阴）
 *   3. 当日跌幅 < 5%（非核按钮式暴跌，仍有反包价值）
 *   4. 情绪状态不为"冰点"或"退潮"
 *
 * 输出窗口：
 *   - 次日竞价（9:25）：适合竞价低开 < 3% 时介入
 *   - 次日尾盘（14:30）：适合盘中走强确认后介入
 *
 * 用法（模块导入）：
 *   import { scanDragonReversal } from './dragon-reversal.mjs';
 *
 * 用法（CLI 验证）：
 *   node server/signal/dragon-reversal.mjs --date 20260327
 */
import { readZtpool } from '../sentiment/ztpool-collector.mjs';
import { readStateHistory } from '../sentiment/sentiment-state-machine.mjs';
import { computeFirstBoardScore } from './scoring-engine.mjs';

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────

const MIN_CONTINUOUS_DAYS = 3;   // 连板天数下限
const MAX_DROP_PCT = 5;          // 首阴跌幅上限（%），超过视为核按钮不介入

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

/** 向前偏移一个工作日（跳周末，不处理节假日） */
function prevTradingDay(yyyymmdd) {
  const d = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 从近期涨停池历史中，统计某只股票的连板天数
 * 向前追溯，直到某日不在涨停池为止
 *
 * @param {string}   code       股票代码
 * @param {string}   beforeDate 从该日期的前一日开始向前追溯（YYYYMMDD）
 * @param {number}   maxLookback 最多追溯天数（默认 15）
 * @returns {number} 连板天数（0 = 前日未涨停）
 */
function countContinuousDays(code, beforeDate, maxLookback = 15) {
  let days = 0;
  let date = prevTradingDay(beforeDate);

  for (let i = 0; i < maxLookback; i++) {
    const pool = readZtpool(date);
    if (!pool) break;

    const ztRows = pool.ztpool?.rows ?? [];
    const found = ztRows.find((r) => r.code === code);

    if (!found) break;  // 该日未涨停，连板中断

    // 优先使用涨停池自带的 continuous_days 字段
    if (found.continuous_days != null) {
      return found.continuous_days;
    }

    days++;
    date = prevTradingDay(date);
  }

  return days;
}

// ──────────────────────────────────────────────
// 主扫描函数
// ──────────────────────────────────────────────

/**
 * 扫描龙头首阴反包候选
 *
 * @param {object}   params
 * @param {string}   params.date           今日日期 YYYYMMDD（首阴发生日）
 * @param {object[]} params.liveStocks     今日实时行情（fetch_realtime.py --type stocks）
 *   每条需包含：code, name, pct_chg, open, close（或 price）, circ_mv
 * @param {string}   [params.emotionState] 当前情绪状态（不传则自动读取）
 * @returns {object[]} 反包候选列表（按连板天数降序）
 */
export async function scanDragonReversal({
  date,
  liveStocks = [],
  emotionState = null,
}) {
  // ── 情绪门控 ──
  const state = emotionState ?? (() => {
    const history = readStateHistory();
    return history.filter((r) => r.date <= date).pop()?.state ?? '冰点';
  })();

  if (state === '冰点' || state === '退潮') return [];

  // ── 读取今日涨停池（用于判断今日是否涨停，首阴必须不在涨停池）──
  const todayPool = readZtpool(date);
  const todayZtCodes = new Set(
    (todayPool?.ztpool?.rows ?? []).map((r) => r.code),
  );

  // ── 读取前日涨停池（用于确认前日是连板股）──
  const prevDate = prevTradingDay(date);
  const prevPool = readZtpool(prevDate);
  if (!prevPool) return [];

  // 前日涨停池：连板天数 >= MIN_CONTINUOUS_DAYS 的股票
  const prevZtRows = prevPool.ztpool?.rows ?? [];
  const dragonCandidates = prevZtRows.filter(
    (r) => (r.continuous_days ?? 1) >= MIN_CONTINUOUS_DAYS,
  );

  if (dragonCandidates.length === 0) return [];

  // ── 构建今日行情 Map ──
  const liveMap = new Map(
    liveStocks.map((s) => [String(s.code || '').trim(), s]),
  );

  const results = [];

  for (const prevRow of dragonCandidates) {
    const code = prevRow.code;
    const name = prevRow.name ?? '';

    // 今日不能在涨停池（首阴条件：今日未涨停）
    if (todayZtCodes.has(code)) continue;

    const live = liveMap.get(code);
    if (!live) continue;

    const close = Number(live.close ?? live.price ?? 0);
    const open  = Number(live.open ?? 0);
    const pctChg = Number(live.pct_chg ?? 0);
    const circMv = Number(live.circ_mv ?? 0);
    const circYi = circMv / 1e8;

    if (close <= 0 || open <= 0) continue;

    // 首阴条件：收盘 < 开盘（阴线）
    const isYinLine = close < open;
    if (!isYinLine) continue;

    // 跌幅不超过上限（非核按钮）
    const dropPct = Math.abs(Math.min(pctChg, 0));
    if (dropPct >= MAX_DROP_PCT) continue;

    // 确认连板天数（优先用涨停池字段，否则向前追溯）
    const continuousDays = prevRow.continuous_days != null
      ? prevRow.continuous_days
      : countContinuousDays(code, date);

    if (continuousDays < MIN_CONTINUOUS_DAYS) continue;

    // ── 昨日首板质量评分（用于排序参考）──
    const prevBoardScore = computeFirstBoardScore({
      sealAmount:    prevRow.seal_amount ?? 0,
      circMv,
      amount:        prevRow.amount ?? 0,
      firstSealTime: prevRow.first_seal_time ?? '',
    });

    // ── 反包强度评分（0–100）──
    // 连板天数越多越强（3板=40分，5板=70分，7板+=100分）
    const continuityPts = clamp(Math.round((continuousDays - 2) * 15), 0, 60);
    // 跌幅越小越好（0%=40分，5%=0分）
    const dropPts = Math.round((1 - dropPct / MAX_DROP_PCT) * 40);
    const reversalScore = clamp(continuityPts + dropPts, 0, 100);

    results.push({
      code,
      name,
      type: '龙头首阴反包',
      // 今日数据
      pctChg:         +pctChg.toFixed(2),
      dropPct:        +dropPct.toFixed(2),
      close,
      open,
      circMvYi:       +circYi.toFixed(1),
      // 连板信息
      continuousDays,
      prevFirstSealTime: prevRow.first_seal_time ?? '',
      prevBoardScore:    prevBoardScore.score,
      prevBoardHighQuality: prevBoardScore.isHighQuality,
      // 评分
      reversalScore,
      // 介入窗口建议
      entryWindows: ['竞价(9:25)', '尾盘(14:30)'],
      emotionState: state,
    });
  }

  // 按反包强度降序，连板天数相同时按跌幅升序
  return results.sort((a, b) =>
    b.reversalScore - a.reversalScore || a.dropPct - b.dropPct,
  );
}

// ──────────────────────────────────────────────
// 工具函数（供外部使用）
// ──────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));


