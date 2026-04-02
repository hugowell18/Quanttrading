/**
 * 通道 A：跟风补涨选股（尾盘 14:30–14:50 窗口）
 * Phase 2A.1 / 2A.2 / 2A.3
 *
 * 过滤条件：
 *   1. 涨幅 5%–9.5%（补涨区间，未涨停）
 *   2. 流通市值 15–150 亿
 *   3. 非 ST / *ST / 退市整理
 *   4. 量比 > 2（今日成交量 / 20 日均量）
 *   5. 前 5 日累涨 < 15%（未过度追高）
 *   6. 情绪状态不为"冰点"或"退潮"（仓位上限 > 0）
 *   7. 所属主线板块（可选；传空数组则不过滤）
 *
 * 评分（0–100）：
 *   - 若当日在涨停池（首板）：封成比 40% + 首封时间 30% + 封流比 30%
 *   - 否则：仅根据量价强度给基础分
 *
 * 仓位上限（按流通市值分档）：
 *   < 50 亿 → 20%
 *   50–100 亿 → 18%
 *   100–150 亿 → 15%
 *
 * 用法（模块导入）：
 *   import { scanChannelA, getPositionCapByMarketCap, computeFirstBoardScore }
 *     from './channel-a-selector.mjs';
 *
 * 用法（CLI 回测）：
 *   node server/signal/channel-a-selector.mjs --date 20260327
 */
import { resolve } from 'node:path';
import { readDaily } from '../data/csv-manager.mjs';
import { readZtpool } from '../sentiment/ztpool-collector.mjs';
import { readStateHistory } from '../sentiment/sentiment-state-machine.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('channel-a');

const ROOT = process.cwd();

// ──────────────────────────────────────────────
// 2A.2：市值分档仓位上限
// ──────────────────────────────────────────────

/**
 * 按流通市值（亿元）返回单股仓位上限
 * @param {number} circMvYi 流通市值（亿）
 * @returns {number} 0–1
 */
export function getPositionCapByMarketCap(circMvYi) {
  if (circMvYi < 50)  return 0.20;
  if (circMvYi < 100) return 0.18;
  return 0.15;
}

// ──────────────────────────────────────────────
// 2A.3：首板质量评分
// ──────────────────────────────────────────────

/**
 * 首封时间得分（0–30 分）：越早封板越优质
 * @param {string} firstSealTime "HH:MM:SS" 或 ""
 */
function firstSealTimeScore(firstSealTime) {
  if (!firstSealTime) return 0;
  const [hh, mm] = firstSealTime.split(':').map(Number);
  const minutes = hh * 60 + mm;   // 分钟数（从 00:00 起算）
  if (minutes <= 9 * 60 + 26)  return 30;   // ≤09:26 一字板 / 竞价封板
  if (minutes <= 9 * 60 + 35)  return 25;   // 开盘5分钟内
  if (minutes <= 10 * 60)      return 20;   // 10:00 前
  if (minutes <= 11 * 60 + 30) return 12;   // 上午盘
  if (minutes <= 13 * 60 + 30) return 6;    // 午后开盘
  return 2;                                 // 尾盘封板
}

/**
 * 计算首板质量综合评分（0–100）
 * 仅适用于当日在涨停池的股票（首板）
 *
 * @param {object} params
 * @param {number} params.sealAmount    封板资金（元）
 * @param {number} params.circMv        流通市值（元）
 * @param {number} params.amount        今日成交额（元）
 * @param {string} params.firstSealTime 首次封板时间 "HH:MM:SS"
 * @returns {{ score: number, isHighQuality: boolean, detail: object }}
 */
export function computeFirstBoardScore({ sealAmount, circMv, amount, firstSealTime }) {
  // 封成比 = 封板资金 / 流通市值（越大越安全）
  const sealRatio = (circMv > 0 && sealAmount > 0) ? sealAmount / circMv : 0;
  const sealRatioPts = Math.min(40, sealRatio * 400);   // 10% 封成比 = 满分

  // 首封时间得分（0–30 分）
  const timePts = firstSealTimeScore(firstSealTime);

  // 封流比 = 封板资金 / 成交额（越大说明资金意愿越强）
  const sealFlowRatio = (amount > 0 && sealAmount > 0) ? sealAmount / amount : 0;
  const sealFlowPts = Math.min(30, sealFlowRatio * 150);  // 20% 封流比 = 满分

  const score = Math.round(sealRatioPts + timePts + sealFlowPts);
  return {
    score,
    isHighQuality: score >= 60,
    detail: {
      sealRatio:     +sealRatio.toFixed(4),
      sealRatioPts:  +sealRatioPts.toFixed(1),
      timePts,
      sealFlowRatio: +sealFlowRatio.toFixed(4),
      sealFlowPts:   +sealFlowPts.toFixed(1),
    },
  };
}

// ──────────────────────────────────────────────
// K 线辅助：量比 + 前 5 日累涨
// ──────────────────────────────────────────────

/** 将 6 位纯数字日期 转为 ts_code 格式：'000001' → '000001.SZ' */
function toTsCode(code) {
  if (code.includes('.')) return code.toUpperCase();
  return /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

/**
 * 从缓存 K 线计算量比（当日成交量 / 近 20 日均量）
 * 若 K 线不足，返回 null
 */
function calcVolRatio(tsCode, todayVol, beforeDate) {
  try {
    // 取 beforeDate 之前 60 个交易日（保证能取到 20 条）
    const startDate = shiftDate(beforeDate, -60);
    const rows = readDaily(tsCode, startDate, beforeDate);
    if (rows.length < 10) return null;
    const recent = rows.slice(-20);
    const avgVol = recent.reduce((s, r) => s + (r.volume ?? 0), 0) / recent.length;
    return avgVol > 0 ? +(todayVol / avgVol).toFixed(2) : null;
  } catch {
    return null;
  }
}

/**
 * 前 N 日累涨幅（%）：最近 N 根 K 线（不含今日）的 close 变化率
 * 返回 null 表示数据不足
 */
function calcCumGain(tsCode, beforeDate, nDays = 5) {
  try {
    const startDate = shiftDate(beforeDate, -(nDays + 10));
    const rows = readDaily(tsCode, startDate, beforeDate);
    if (rows.length < 2) return null;
    const tail = rows.slice(-nDays);
    if (tail.length < 2) return null;
    const first = rows[rows.length - tail.length - 1]?.close ?? rows[0].close;
    const last = tail[tail.length - 1].close;
    return first > 0 ? +((last / first - 1) * 100).toFixed(2) : null;
  } catch {
    return null;
  }
}

/** 粗略日期偏移（忽略节假日，仅用于取范围） */
function shiftDate(yyyymmdd, days) {
  const d = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────
// 2A.1：主扫描函数
// ──────────────────────────────────────────────

/**
 * 通道 A 尾盘扫描
 *
 * @param {object}   params
 * @param {string}   params.date              扫描日期 YYYYMMDD
 * @param {object[]} params.liveStocks        实时行情（fetch_realtime.py --type stocks）
 *   每条需包含：code, name, pct_chg, volume, turnover_rate, circ_mv
 * @param {string[]} [params.mainlineSectors] 主线板块名称列表（来自 Phase 3；空数组=不过滤）
 * @param {string}   [params.emotionState]    当前情绪状态（不传则自动读取）
 * @returns {object[]} CandidateStock 列表（按评分降序）
 */
export async function scanChannelA({
  date,
  liveStocks = [],
  mainlineSectors = [],
  emotionState = null,
}) {
  // ── 情绪门控：冰点/退潮不交易 ──
  const state = emotionState ?? (() => {
    const history = readStateHistory();
    return history.filter((r) => r.date <= date).pop()?.state ?? '冰点';
  })();

  if (state === '冰点' || state === '退潮') {
    return [];
  }

  // ── 读取当日涨停池（用于首板评分）──
  const ztpoolData = readZtpool(date);
  const ztMap = new Map(
    (ztpoolData?.ztpool?.rows ?? []).map((r) => [r.code, r]),
  );

  // 昨日日期（用于 K 线查询上界）
  const yesterday = shiftDate(date, -1);

  const candidates = [];

  for (const stock of liveStocks) {
    const code    = String(stock.code || '').trim();
    const name    = String(stock.name || '').trim();
    const pctChg  = Number(stock.pct_chg ?? 0);
    const vol     = Number(stock.volume ?? 0);
    const circMv  = Number(stock.circ_mv ?? 0);   // 元
    const circYi  = circMv / 1e8;                  // 亿

    // ── 基础过滤 ──

    // 涨幅 5%–9.5%
    if (pctChg < 5 || pctChg >= 9.5) continue;

    // 流通市值 15–150 亿
    if (circYi < 15 || circYi > 150) continue;

    // 非 ST
    if (/ST|退市/i.test(name)) continue;

    // ── K 线过滤（量比 + 前 5 日累涨）──
    const tsCode   = toTsCode(code);
    const volRatio = calcVolRatio(tsCode, vol, yesterday);
    const cumGain5 = calcCumGain(tsCode, yesterday, 5);

    // 量比 > 2（有数据才过滤；无数据则放行，后续标注）
    if (volRatio !== null && volRatio < 2) continue;

    // 前 5 日累涨 < 15%
    if (cumGain5 !== null && cumGain5 >= 15) continue;

    // ── 主线板块过滤 ──
    if (mainlineSectors.length > 0) {
      const ztRow = ztMap.get(code);
      const concept = ztRow?.concepts ?? stock.sector ?? '';
      const inMainline = mainlineSectors.some((s) => concept.includes(s));
      if (!inMainline) continue;
    }

    // ── 首板质量评分（若在涨停池）──
    const ztRow = ztMap.get(code);
    let firstBoardScore = null;
    if (ztRow) {
      firstBoardScore = computeFirstBoardScore({
        sealAmount:    ztRow.seal_amount ?? 0,
        circMv,
        amount:        Number(stock.amount ?? ztRow.amount ?? 0),
        firstSealTime: ztRow.first_seal_time ?? '',
      });
    }

    // ── 仓位上限 ──
    const positionCap = getPositionCapByMarketCap(circYi);

    candidates.push({
      code,
      name,
      pctChg:       +pctChg.toFixed(2),
      circMvYi:     +circYi.toFixed(1),
      volRatio,
      cumGain5,
      positionCap,
      isFirstBoard: !!ztRow,
      firstBoardScore,
      // 综合排序分：首板优先，其次量比
      sortScore: (firstBoardScore?.score ?? 0) * 0.6 + (volRatio ?? 2) * 5,
      emotionState: state,
    });
  }

  // 按综合排序分降序
  candidates.sort((a, b) => b.sortScore - a.sortScore);
  return candidates;
}

// ──────────────────────────────────────────────
// CLI 回测模式
// ──────────────────────────────────────────────

if (process.argv[1]?.includes('channel-a-selector')) {
  const { execFileSync } = await import('node:child_process');
  const { resolve: res } = await import('node:path');

  const args    = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const date    = dateIdx >= 0 ? args[dateIdx + 1] : '';

  if (!date) {
    console.error('用法: node server/signal/channel-a-selector.mjs --date YYYYMMDD');
    process.exit(1);
  }

  // 调用 fetch_realtime.py 获取当日实时行情（回测模式下用 AKShare 历史数据）
  let liveStocks = [];
  try {
    const PYTHON_BIN = process.env.PYTHON || 'python';
    const FETCH_SCRIPT = res(ROOT, 'server', 'signal', 'fetch_realtime.py');
    const stdout = execFileSync(PYTHON_BIN, [FETCH_SCRIPT, '--type', 'stocks'], {
      encoding: 'utf8', timeout: 60_000,
    });
    const parsed = JSON.parse(stdout.trim());
    liveStocks = parsed.ok ? parsed.data : [];
  } catch (e) {
    log.error('实时行情获取失败', { error: e.message });
  }

  const results = await scanChannelA({ date, liveStocks });

  if (!results.length) {
    log.info(`${date} 无候选股（情绪状态或过滤条件）`);
  } else {
    log.info(`${date} 找到候选股`, { count: results.length });
    console.log();
    console.table(results.map((r) => ({
      代码: r.code,
      名称: r.name,
      涨幅: r.pctChg + '%',
      市值: r.circMvYi + '亿',
      量比: r.volRatio ?? 'N/A',
      '5日累涨': r.cumGain5 != null ? r.cumGain5 + '%' : 'N/A',
      首板: r.isFirstBoard ? '✓' : '',
      首板评分: r.firstBoardScore?.score ?? '-',
      仓位上限: (r.positionCap * 100) + '%',
    })));
  }
}
