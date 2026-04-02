/**
 * 通道 B：龙头二板接力策略（竞价 9:25 窗口）
 * Phase 2B.1 / 2B.2 / 2B.3
 *
 * 选股逻辑：
 *   候选池 = 前日首板（continuous_days == 1）股票
 *   过滤条件：
 *     1. 今日竞价涨幅   3%–5%（高开幅度适中，不过度追高）
 *     2. 竞昨比        4%–20%（竞价量 / 昨日全日量，过低=无人关注，过高=已被炒作）
 *     3. 竞价换手率    0.6%–1.5%（相对成熟的资金参与，非散户哄抬）
 *     4. 前日封成比    ≥ 3%（昨日封板资金占流通市值，越高越安全）
 *     5. 流通市值      15–150 亿
 *     6. 非 ST
 *     7. 情绪状态      不为"冰点"或"退潮"
 *     8. 所属主线板块  （可选；传空数组则不过滤）
 *
 * 评分（0–100）：
 *   竞价质量 50% + 昨日首板质量 50%
 *   竞价质量：竞昨比得分 + 竞价换手率得分
 *   首板质量：复用 computeFirstBoardScore（来自 channel-a-selector）
 *
 * 用法（模块导入）：
 *   import { scanChannelB } from './channel-b-selector.mjs';
 *
 * 用法（CLI 验证）：
 *   node server/signal/channel-b-selector.mjs --date 20260327
 *   （--date 为今日，昨日首板从 cache/ztpool 读取）
 */
import { readZtpool } from '../sentiment/ztpool-collector.mjs';
import { readStateHistory } from '../sentiment/sentiment-state-machine.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('channel-b');
import { computeFirstBoardScore, getPositionCapByMarketCap } from './channel-a-selector.mjs';

// ──────────────────────────────────────────────
// 过滤阈值（可按需调整）
// ──────────────────────────────────────────────

const THRESHOLDS = {
  auctionPctMin:     3,      // 竞价涨幅下限 %
  auctionPctMax:     5,      // 竞价涨幅上限 %
  auctionVolRatioMin: 0.04,  // 竞昨比下限（4%）
  auctionVolRatioMax: 0.20,  // 竞昨比上限（20%）
  auctionTurnoverMin: 0.006, // 竞价换手率下限（0.6%）
  auctionTurnoverMax: 0.015, // 竞价换手率上限（1.5%）
  prevSealRatioMin:  0.03,   // 前日封成比下限（3%）
  circMvMinYi:       15,     // 流通市值下限（亿）
  circMvMaxYi:       150,    // 流通市值上限（亿）
};

// ──────────────────────────────────────────────
// 竞价质量评分（0–50 分）
// ──────────────────────────────────────────────

/**
 * 竞价量质量：竞昨比越接近 8%-12% 越好（说明有增量资金但未过热）
 * 0–25 分
 */
function auctionVolRatioScore(ratio) {
  // 最优区间 [0.06, 0.12]，满分 25
  const center = 0.09;
  const dist = Math.abs(ratio - center);
  return Math.max(0, Math.round(25 * (1 - dist / 0.12)));
}

/**
 * 竞价换手率质量：越接近 1% 越好
 * 0–25 分
 */
function auctionTurnoverScore(turnover) {
  const center = 0.01;
  const dist = Math.abs(turnover - center);
  return Math.max(0, Math.round(25 * (1 - dist / 0.01)));
}

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

/** 将前一个工作日：简单向前偏移，不考虑节假日（仅用于缓存文件查找） */
function prevTradingDay(yyyymmdd) {
  const d = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);  // 跳周末
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────
// 主扫描函数
// ──────────────────────────────────────────────

/**
 * 通道 B 竞价扫描（9:25 调用）
 *
 * @param {object}   params
 * @param {string}   params.date              今日 YYYYMMDD
 * @param {object[]} params.auctionData       9:25 竞价快照数组，每条包含：
 *   { code, name, auctionPrice, preClose, auctionVol, auctionAmount, circMv }
 *   - auctionPrice:  竞价撮合价（元）
 *   - preClose:      昨收价（元）
 *   - auctionVol:    竞价成交量（股）
 *   - auctionAmount: 竞价成交额（元）；若无可由 auctionPrice*auctionVol 估算
 *   - circMv:        流通市值（元）
 * @param {string[]} [params.mainlineSectors] 主线板块（Phase 3 提供；空数组不过滤）
 * @param {string}   [params.emotionState]    当前情绪状态（不传则自动读取）
 * @returns {object[]} CandidateStock 列表（按综合评分降序）
 */
export async function scanChannelB({
  date,
  auctionData = [],
  mainlineSectors = [],
  emotionState = null,
}) {
  // ── 情绪门控 ──
  const state = emotionState ?? (() => {
    const history = readStateHistory();
    return history.filter((r) => r.date <= date).pop()?.state ?? '冰点';
  })();

  if (state === '冰点' || state === '退潮') return [];

  // ── 读取前日涨停池 ──
  const prevDate = prevTradingDay(date);
  const prevPool = readZtpool(prevDate);
  if (!prevPool) return [];

  // 前日首板（continuous_days == 1 且非炸板）
  const prevZtRows = prevPool.ztpool?.rows ?? [];
  const prevFirstBoard = new Map(
    prevZtRows
      .filter((r) => (r.continuous_days ?? 1) === 1)
      .map((r) => [r.code, r]),
  );

  if (prevFirstBoard.size === 0) return [];

  // ── 构建竞价数据 Map ──
  const auctionMap = new Map(
    auctionData.map((a) => [String(a.code || '').trim(), a]),
  );

  const candidates = [];

  for (const [code, prevRow] of prevFirstBoard) {
    const name   = prevRow.name ?? '';
    const auction = auctionMap.get(code);

    // 无竞价数据 → 跳过
    if (!auction) continue;

    const auctionPrice  = Number(auction.auctionPrice  ?? 0);
    const preClose      = Number(auction.preClose       ?? prevRow.price ?? 0);
    const auctionVol    = Number(auction.auctionVol     ?? 0);
    const auctionAmount = Number(auction.auctionAmount  ?? auctionPrice * auctionVol);
    const circMv        = Number(auction.circMv ?? 0);
    const circYi        = circMv / 1e8;

    if (preClose <= 0 || auctionPrice <= 0) continue;

    // ── 计算竞价衍生指标 ──
    const auctionPct      = (auctionPrice / preClose - 1) * 100;  // 竞价涨幅 %
    const prevDayVol      = Number(prevRow.amount ?? 0) / preClose;  // 昨日估算成交量（以元/价估算）
    const auctionVolRatio = prevDayVol > 0 ? auctionVol / prevDayVol : null;
    // 竞价换手率 = 竞价成交量 * 竞价价格 / 流通市值
    const auctionTurnover = circMv > 0 ? auctionAmount / circMv : null;

    // ── 基础过滤 ──
    if (auctionPct < THRESHOLDS.auctionPctMin || auctionPct > THRESHOLDS.auctionPctMax) continue;
    if (circYi < THRESHOLDS.circMvMinYi || circYi > THRESHOLDS.circMvMaxYi) continue;
    if (/ST|退市/i.test(name)) continue;

    if (auctionVolRatio !== null &&
        (auctionVolRatio < THRESHOLDS.auctionVolRatioMin ||
         auctionVolRatio > THRESHOLDS.auctionVolRatioMax)) continue;

    if (auctionTurnover !== null &&
        (auctionTurnover < THRESHOLDS.auctionTurnoverMin ||
         auctionTurnover > THRESHOLDS.auctionTurnoverMax)) continue;

    // 前日封成比 ≥ 3%
    const prevSealRatio = (circMv > 0 && (prevRow.seal_amount ?? 0) > 0)
      ? prevRow.seal_amount / circMv
      : null;
    if (prevSealRatio !== null && prevSealRatio < THRESHOLDS.prevSealRatioMin) continue;

    // ── 主线板块过滤 ──
    if (mainlineSectors.length > 0) {
      const concept = prevRow.concepts ?? '';
      if (!mainlineSectors.some((s) => concept.includes(s))) continue;
    }

    // ── 评分 ──
    // 昨日首板质量（0–100）
    const prevBoardScore = computeFirstBoardScore({
      sealAmount:    prevRow.seal_amount ?? 0,
      circMv,
      amount:        prevRow.amount ?? 0,
      firstSealTime: prevRow.first_seal_time ?? '',
    });

    // 竞价质量（0–50）
    const auctionScore =
      (auctionVolRatio  != null ? auctionVolRatioScore(auctionVolRatio)   : 12) +
      (auctionTurnover  != null ? auctionTurnoverScore(auctionTurnover)   : 12);

    // 综合评分：竞价质量 50% + 昨日首板质量 50%
    const totalScore = Math.round(auctionScore * 0.5 + prevBoardScore.score * 0.5);

    candidates.push({
      code,
      name,
      // 今日竞价
      auctionPct:       +auctionPct.toFixed(2),
      auctionVolRatio:  auctionVolRatio != null ? +auctionVolRatio.toFixed(3) : null,
      auctionTurnover:  auctionTurnover != null ? +(auctionTurnover * 100).toFixed(3) + '%' : null,
      // 昨日数据
      prevSealRatio:    prevSealRatio != null ? +(prevSealRatio * 100).toFixed(2) + '%' : null,
      prevContinuousDays: prevRow.continuous_days ?? 1,
      prevFirstSealTime:  prevRow.first_seal_time ?? '',
      // 市值 & 仓位
      circMvYi:         +circYi.toFixed(1),
      positionCap:      getPositionCapByMarketCap(circYi),
      // 评分
      prevBoardScore:   prevBoardScore.score,
      auctionScore,
      totalScore,
      emotionState:     state,
    });
  }

  return candidates.sort((a, b) => b.totalScore - a.totalScore);
}

// ──────────────────────────────────────────────
// CLI 验证
// ──────────────────────────────────────────────

if (process.argv[1]?.includes('channel-b-selector')) {
  const args    = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const date    = dateIdx >= 0 ? args[dateIdx + 1] : '';

  if (!date) {
    console.error('用法: node server/signal/channel-b-selector.mjs --date YYYYMMDD');
    process.exit(1);
  }

  // 无实时竞价数据时，用昨日首板股票模拟竞价（仅验证逻辑）
  const prevDate = prevTradingDay(date);
  const prevPool = readZtpool(prevDate);
  const prevZt   = prevPool?.ztpool?.rows ?? [];
  const firstBoards = prevZt.filter((r) => (r.continuous_days ?? 1) === 1);

  log.info(`前日首板模拟竞价验证`, { prevDate, firstBoards: firstBoards.length });

  // 构造模拟竞价：假设竞价涨幅 4%（中间值），竞昨比 10%，换手率 1%
  const mockAuction = firstBoards.map((r) => ({
    code:         r.code,
    name:         r.name,
    auctionPrice: +(r.price * 1.04).toFixed(2),  // 竞价+4%
    preClose:     r.price,
    auctionVol:   Math.round((r.amount ?? 1e7) / r.price * 0.10),  // 昨日量的10%
    auctionAmount: (r.amount ?? 1e7) * 0.10,
    circMv:       r.circ_mv ?? 5e9,
  }));

  const results = await scanChannelB({ date, auctionData: mockAuction });

  if (!results.length) {
    log.info(`${date} 无候选`, { emotionState: readStateHistory().filter((r) => r.date <= date).pop()?.state ?? '冰点' });
  } else {
    log.info(`${date} 候选股`, { count: results.length });
    console.log();
    console.table(results.slice(0, 10).map((r) => ({
      代码:       r.code,
      名称:       r.name,
      竞价涨幅:   r.auctionPct + '%',
      竞昨比:     r.auctionVolRatio ?? 'N/A',
      竞价换手:   r.auctionTurnover ?? 'N/A',
      昨封成比:   r.prevSealRatio ?? 'N/A',
      市值:       r.circMvYi + '亿',
      竞价分:     r.auctionScore,
      首板分:     r.prevBoardScore,
      综合分:     r.totalScore,
      仓位上限:   (r.positionCap * 100) + '%',
    })));
  }
}
