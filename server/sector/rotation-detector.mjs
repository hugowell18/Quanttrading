/**
 * 板块轮动预警检测器
 * Phase 3 / 需求 13 / 任务书 3.5
 *
 * 两级信号：
 *   预警（warning）：当前主线连板高度回落 + 新板块涨停集中度上升
 *   确认（confirmed）：主线龙头断板 + 新板块出现 3 板个股
 *
 * 用法（模块导入）：
 *   import { detectRotation } from './rotation-detector.mjs';
 *
 * 用法（CLI 验证）：
 *   node server/sector/rotation-detector.mjs --date 20260327
 */
import { readZtpool } from '../sentiment/ztpool-collector.mjs';
import { identifyMainlineSectors, mapLeaderFollower } from './sector-engine.mjs';

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

function prevTradingDay(yyyymmdd) {
  const d = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
  do { d.setDate(d.getDate() - 1); }
  while (d.getDay() === 0 || d.getDay() === 6);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 获取板块内最高连板高度
 * @param {object} sector     SectorProfile
 * @param {object} ztpoolData 当日涨停池
 */
function maxContinuousDays(sector, ztpoolData) {
  const ztRows = ztpoolData?.ztpool?.rows ?? [];
  const ztCodeSet = new Set(sector.ztCodes);
  const members = ztRows.filter((r) => ztCodeSet.has(r.code));
  if (members.length === 0) return 0;
  return Math.max(...members.map((r) => r.continuous_days ?? 1));
}

/**
 * 检查板块内是否有龙头断板（前日在涨停池，今日不在）
 * @param {object[]} leaders      前日龙头列表（含 code）
 * @param {object}   todayZtpool  今日涨停池
 */
function hasLeaderBreak(leaders, todayZtpool) {
  const todayCodes = new Set(
    (todayZtpool?.ztpool?.rows ?? []).map((r) => r.code),
  );
  return leaders.some((leader) => !todayCodes.has(leader.code));
}

/**
 * 检查板块内是否出现 N 板以上个股
 */
function hasHighContinuous(sector, ztpoolData, minDays = 3) {
  const ztRows = ztpoolData?.ztpool?.rows ?? [];
  const ztCodeSet = new Set(sector.ztCodes);
  return ztRows
    .filter((r) => ztCodeSet.has(r.code))
    .some((r) => (r.continuous_days ?? 1) >= minDays);
}

// ──────────────────────────────────────────────
// 主函数
// ──────────────────────────────────────────────

/**
 * 检测板块轮动信号
 *
 * @param {object[]} currentMainline  当前主线板块（前日识别的 SectorProfile[]）
 * @param {object[]} todaySectors     今日所有板块（identifyMainlineSectors 返回值）
 * @param {object}   todayZtpool      今日涨停池（readZtpool 返回值）
 * @param {object}   prevZtpool       前日涨停池（用于龙头断板判断）
 * @returns {{
 *   level: 'none' | 'warning' | 'confirmed',
 *   oldSector: string,
 *   newSector: string,
 *   triggers: string[],
 *   detail: object
 * }}
 */
export function detectRotation(currentMainline, todaySectors, todayZtpool, prevZtpool) {
  if (!currentMainline || currentMainline.length === 0) {
    return { level: 'none', oldSector: '', newSector: '', triggers: [], detail: {} };
  }

  const triggers = [];
  let level = 'none';
  let oldSector = '';
  let newSector = '';

  // ── 分析当前主线的今日状态 ──
  const mainlineName = currentMainline[0].name;
  oldSector = mainlineName;

  // 今日该主线板块的数据
  const todayMainline = todaySectors.find((s) => s.name === mainlineName);

  // 前日主线的最高连板高度
  const prevMaxDays = currentMainline[0].ztCodes
    ? maxContinuousDays(currentMainline[0], prevZtpool)
    : (currentMainline[0].maxContinuousDays ?? 0);

  // 今日主线的最高连板高度
  const todayMaxDays = todayMainline
    ? maxContinuousDays(todayMainline, todayZtpool)
    : 0;

  // 前日主线龙头
  const { leaders: prevLeaders } = mapLeaderFollower(currentMainline[0], prevZtpool ?? { ztpool: { rows: [] } });

  // ── 预警条件检查 ──

  // 条件1：主线连板高度回落
  const heightDropped = prevMaxDays > 0 && todayMaxDays < prevMaxDays;
  if (heightDropped) {
    triggers.push(`主线[${mainlineName}]连板高度回落: ${prevMaxDays}板→${todayMaxDays}板`);
  }

  // 条件2：新板块涨停集中度上升（今日非主线板块中集中度最高的）
  const nonMainline = todaySectors.filter((s) => s.name !== mainlineName);
  const risingNew = nonMainline
    .filter((s) => s.concentration > (todayMainline?.concentration ?? 0))
    .sort((a, b) => b.concentration - a.concentration);

  if (risingNew.length > 0) {
    newSector = risingNew[0].name;
    triggers.push(`新板块[${newSector}]集中度(${(risingNew[0].concentration * 100).toFixed(1)}%)超过主线`);
  }

  if (heightDropped && risingNew.length > 0) {
    level = 'warning';
  }

  // ── 确认条件检查（在预警基础上升级）──

  // 条件3：主线龙头断板
  const leaderBroke = prevLeaders.length > 0 && hasLeaderBreak(prevLeaders, todayZtpool);
  if (leaderBroke) {
    const brokeNames = prevLeaders
      .filter((l) => {
        const todayCodes = new Set((todayZtpool?.ztpool?.rows ?? []).map((r) => r.code));
        return !todayCodes.has(l.code);
      })
      .map((l) => `${l.name}(${l.code})`);
    triggers.push(`主线龙头断板: ${brokeNames.join('、')}`);
  }

  // 条件4：新板块出现 3 板以上个股
  const newSectorProfile = risingNew[0];
  const newHas3Board = newSectorProfile
    ? hasHighContinuous(newSectorProfile, todayZtpool, 3)
    : false;

  if (newHas3Board) {
    triggers.push(`新板块[${newSector}]出现3板以上个股`);
  }

  if (level === 'warning' && leaderBroke && newHas3Board) {
    level = 'confirmed';
  }

  return {
    level,
    oldSector,
    newSector,
    triggers,
    detail: {
      prevMaxDays,
      todayMaxDays,
      heightDropped,
      leaderBroke,
      newHas3Board,
      prevLeaders: prevLeaders.map((l) => `${l.name}(${l.code})`),
      risingNewSectors: risingNew.slice(0, 3).map((s) => ({
        name: s.name,
        concentration: (s.concentration * 100).toFixed(1) + '%',
        ztCount: s.ztCount,
      })),
    },
  };
}


