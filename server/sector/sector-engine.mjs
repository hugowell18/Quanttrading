/**
 * 主线板块识别引擎
 * Phase 3 / 需求 11（主线识别）/ 需求 12（龙头映射）/ 任务书 3.1 / 3.2 / 3.4
 *
 * 主线确认规则：
 *   1. 计算各板块当日涨停集中度 = 板块内涨停家数 / 板块总成员数
 *   2. 连续 2 日涨停集中度排名前 3 → 确认为主线板块
 *   3. 叠加 RPS 判断强弱（由调用方传入）
 *
 * 龙头识别：
 *   主线板块内，连板天数最高 + 封单强度（seal_amount/circ_mv）最大的个股
 *
 * 用法（模块导入）：
 *   import { identifyMainlineSectors, mapLeaderFollower } from './sector-engine.mjs';
 *
 * 用法（CLI 验证）：
 *   node server/sector/sector-engine.mjs --date 20260327
 */
import { readZtpool } from '../sentiment/ztpool-collector.mjs';
import { computeSectorRps } from './rps-calculator.mjs';

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const round4 = (v) => Math.round(v * 10000) / 10000;

/** 向前偏移一个工作日（跳周末） */
function prevTradingDay(yyyymmdd) {
  const d = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
  do { d.setDate(d.getDate() - 1); }
  while (d.getDay() === 0 || d.getDay() === 6);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 从涨停池行数据中提取板块归属
 * 优先使用 concepts 字段（逗号分隔），其次 sector
 */
function extractSectors(row) {
  const raw = row.concepts ?? row.sector ?? '';
  return raw.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}

// ──────────────────────────────────────────────
// 核心：计算单日各板块涨停集中度
// ──────────────────────────────────────────────

/**
 * 计算各板块涨停集中度
 *
 * @param {object[]} ztRows       当日涨停池行数据
 * @param {Map<string, number>}   sectorMemberCount  板块名 → 成员总数（可选；无则用涨停数估算）
 * @returns {Map<string, { ztCount: number, totalCount: number, concentration: number, ztCodes: string[] }>}
 */
function computeSectorConcentration(ztRows, sectorMemberCount = new Map()) {
  // 统计各板块涨停家数
  const ztCountMap = new Map();  // sectorName → { ztCount, ztCodes }

  for (const row of ztRows) {
    const sectors = extractSectors(row);
    for (const sector of sectors) {
      if (!ztCountMap.has(sector)) {
        ztCountMap.set(sector, { ztCount: 0, ztCodes: [] });
      }
      const entry = ztCountMap.get(sector);
      entry.ztCount++;
      entry.ztCodes.push(row.code);
    }
  }

  const result = new Map();
  for (const [sector, { ztCount, ztCodes }] of ztCountMap) {
    const totalCount = sectorMemberCount.get(sector) ?? ztCount;  // 无成员数时用涨停数（集中度=1）
    result.set(sector, {
      ztCount,
      totalCount,
      concentration: totalCount > 0 ? round4(ztCount / totalCount) : 0,
      ztCodes,
    });
  }

  return result;
}

/**
 * 按集中度降序排名，返回前 N 名板块名称
 */
function topNSectors(concentrationMap, n = 3) {
  return [...concentrationMap.entries()]
    .sort((a, b) => b[1].concentration - a[1].concentration)
    .slice(0, n)
    .map(([name]) => name);
}

// ──────────────────────────────────────────────
// 主函数 1：主线板块识别
// ──────────────────────────────────────────────

/**
 * 识别当日主线板块
 *
 * @param {string}   date          当日 YYYYMMDD
 * @param {object}   ztpoolData    当日涨停池（readZtpool 返回值）
 * @param {object}   prevZtpoolData 前日涨停池（用于连续性判断）
 * @param {object}   [options]
 * @param {Map<string,number>} [options.sectorMemberCount]  板块成员总数（可选）
 * @param {Map<string,object>} [options.rpsMap]             computeSectorRps 返回值（可选）
 * @returns {SectorProfile[]}  主线板块列表（按集中度降序）
 *
 * SectorProfile: {
 *   name: string,
 *   date: string,
 *   ztCount: number,
 *   totalCount: number,
 *   concentration: number,
 *   ztCodes: string[],
 *   isMainline: boolean,       // 连续2日前3
 *   isStrongMainline: boolean, // 同时满足 RPS 条件
 *   rps3: number|null,
 *   rps10: number|null,
 *   rps20: number|null,
 * }
 */
export function identifyMainlineSectors(date, ztpoolData, prevZtpoolData, options = {}) {
  const { sectorMemberCount = new Map(), rpsMap = new Map() } = options;

  const todayZtRows = ztpoolData?.ztpool?.rows ?? [];
  const prevZtRows  = prevZtpoolData?.ztpool?.rows ?? [];

  // 今日集中度
  const todayConc = computeSectorConcentration(todayZtRows, sectorMemberCount);
  // 前日集中度
  const prevConc  = computeSectorConcentration(prevZtRows, sectorMemberCount);

  // 今日前3板块
  const todayTop3 = new Set(topNSectors(todayConc, 3));
  // 前日前3板块
  const prevTop3  = new Set(topNSectors(prevConc, 3));

  const profiles = [];

  for (const [name, todayData] of todayConc) {
    const rps = rpsMap.get(name) ?? {};
    // 主线条件：今日前3 且 前日也前3（连续2日）
    const isMainline = todayTop3.has(name) && prevTop3.has(name);
    const isStrongMainline = isMainline && (rps.isStrongMainline ?? false);

    profiles.push({
      name,
      date,
      ztCount:         todayData.ztCount,
      totalCount:      todayData.totalCount,
      concentration:   todayData.concentration,
      ztCodes:         todayData.ztCodes,
      isMainline,
      isStrongMainline,
      rps3:  rps.rps3  ?? null,
      rps10: rps.rps10 ?? null,
      rps20: rps.rps20 ?? null,
    });
  }

  // 主线板块优先，其次按集中度降序
  return profiles.sort((a, b) => {
    if (a.isMainline !== b.isMainline) return a.isMainline ? -1 : 1;
    return b.concentration - a.concentration;
  });
}

// ──────────────────────────────────────────────
// 主函数 2：龙头-跟风映射
// ──────────────────────────────────────────────

/**
 * 识别板块内龙头股与跟风股
 *
 * 龙头判定：连板天数最高，同等连板时封单强度（seal_amount/circ_mv）最大
 * 跟风股：板块内其余涨停股
 *
 * @param {object} sector      SectorProfile（含 ztCodes）
 * @param {object} ztpoolData  当日涨停池
 * @returns {{ leaders: object[], followers: object[] }}
 */
export function mapLeaderFollower(sector, ztpoolData) {
  const ztRows = ztpoolData?.ztpool?.rows ?? [];
  const ztCodeSet = new Set(sector.ztCodes);

  // 取出本板块所有涨停股的详细数据
  const members = ztRows.filter((r) => ztCodeSet.has(r.code));

  if (members.length === 0) return { leaders: [], followers: [] };

  // 计算封单强度（seal_amount / circ_mv）
  const withStrength = members.map((r) => ({
    ...r,
    sealStrength: (r.circ_mv > 0 && r.seal_amount > 0)
      ? round4(r.seal_amount / r.circ_mv)
      : 0,
    continuousDays: r.continuous_days ?? 1,
  }));

  // 按连板天数降序，同等连板按封单强度降序
  withStrength.sort((a, b) =>
    b.continuousDays - a.continuousDays || b.sealStrength - a.sealStrength,
  );

  // 龙头：连板天数最高的前1-2只（同等连板天数都算龙头）
  const maxDays = withStrength[0].continuousDays;
  const leaders   = withStrength.filter((r) => r.continuousDays === maxDays);
  const followers = withStrength.filter((r) => r.continuousDays < maxDays);

  return { leaders, followers };
}


