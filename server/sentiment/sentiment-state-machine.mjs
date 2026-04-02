/**
 * 情绪周期状态机 (Phase 1.5)
 *
 * 5 状态：冰点 → 启动 → 主升 → 高潮 → 退潮 → (冰点/启动)
 * 防闪烁：候选状态需连续 2 日确认才切换
 * 退潮快退出：从主升/高潮下滑时仅需 1 日确认
 *
 * 用法（模块导入）：
 *   import { evaluateState, readStateHistory, writeStateRecord } from './sentiment-state-machine.mjs';
 *
 * 用法（CLI）：
 *   node server/sentiment/sentiment-state-machine.mjs --date 20260327
 *   node server/sentiment/sentiment-state-machine.mjs --backfill
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMetrics } from './sentiment-engine.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('state-machine');

const ROOT = process.cwd();
const STATE_DIR = resolve(ROOT, 'cache', 'sentiment-state');
mkdirSync(STATE_DIR, { recursive: true });
const HISTORY_PATH = resolve(STATE_DIR, 'state-history.json');

// ──────────────────────────────────────────────
// 常量（导出供测试/外部使用）
// ──────────────────────────────────────────────

export const EMOTION_STATES = ['冰点', '启动', '主升', '高潮', '退潮'];

/** 各状态对应的仓位上限（0–1） */
export const STATE_POSITION_LIMITS = {
  '冰点': 0,    // 停止交易
  '退潮': 0.3,  // 轻仓观望
  '启动': 0.5,  // 适度参与
  '主升': 0.8,  // 重仓进攻
  '高潮': 0.5,  // 高风险控仓
};

/** 从这些"热状态"下滑进入退潮时，只需 1 日确认 */
const HOT_STATES = new Set(['主升', '高潮']);

// ──────────────────────────────────────────────
// 核心分类：单日指标 → 热度分 + 原始候选状态
// ──────────────────────────────────────────────

/**
 * 计算市场热度分（0–100）
 * 主要依赖 ztCount / ztDtRatio / zbRate / prevZtPremium
 * zbRate / prevZtPremium 为 null（Tushare 历史数据）时给中性分
 */
export function heatScore(m) {
  const zt = m.ztCount ?? 0;

  // 涨停家数：max 40 分（120家=满分）
  const ztPts = Math.min(40, zt / 3);

  // 涨跌停比：max 20 分（比值≥6=满分；null=10分）
  const ratio = m.ztDtRatio ?? null;
  const ratioPts = ratio != null
    ? Math.min(20, Math.max(0, (ratio - 1) * 4))
    : 10;

  // 炸板率：越低越好，max 20 分（null=10分）
  const zbRate = m.zbRate ?? null;
  const zbPts = zbRate != null
    ? Math.min(20, Math.max(0, (0.5 - zbRate) * 67))
    : 10;

  // 昨日涨停溢价：max 20 分（null=10分；+5%=20分；-5%=0分）
  const premium = m.prevZtPremium ?? null;
  const premPts = premium != null
    ? Math.min(20, Math.max(0, (premium + 5) * 2))
    : 10;

  return Math.round(ztPts + ratioPts + zbPts + premPts);
}

/**
 * 将单日情绪指标映射为原始候选状态（不含退潮，退潮由转换逻辑判断）
 */
export function rawClassify(m) {
  if (!m) return '冰点';

  const score = heatScore(m);
  const zt    = m.ztCount ?? 0;
  const cd    = m.maxContinuousDays ?? 1;

  if (zt < 40 || score < 20) return '冰点';
  if (score >= 65 && zt >= 110 && cd >= 6) return '高潮';
  if (score >= 48 && zt >= 75) return '主升';
  if (score >= 28 && zt >= 50) return '启动';
  return '冰点';
}

/**
 * 判断市场质量是否在快速恶化（触发热状态快退）
 */
function isQualityDeterioring(today, yesterday) {
  if (!today || !yesterday) return false;
  const ztDrop = (yesterday.ztCount ?? 0) - (today.ztCount ?? 0) > 20;
  const zbWorsen = today.zbRate != null && yesterday.zbRate != null
    && today.zbRate - yesterday.zbRate > 0.08;
  const premiumCollapse = today.prevZtPremium != null && today.prevZtPremium < -3;
  return ztDrop || zbWorsen || premiumCollapse;
}

// ──────────────────────────────────────────────
// 状态机核心评估
// ──────────────────────────────────────────────

/**
 * 根据最近情绪指标序列，评估当日情绪状态
 *
 * @param {object[]} series       - 按日期升序排列的 DailyEmotionMetrics[]（含当日，至少 1 条）
 * @param {string}   currentState - 当前已确认状态（来自上一交易日的持久化记录）
 * @returns {{ state: string, positionLimit: number, changed: boolean, snapshot: object }}
 */
export function evaluateState(series, currentState = '冰点') {
  if (!series || series.length < 1) {
    return {
      state: currentState,
      positionLimit: STATE_POSITION_LIMITS[currentState] ?? 0,
      changed: false,
      snapshot: {},
    };
  }

  const today     = series[series.length - 1];
  const yesterday = series.length >= 2 ? series[series.length - 2] : null;

  const rawToday     = rawClassify(today);
  const rawYesterday = yesterday ? rawClassify(yesterday) : null;

  let newState = currentState;

  // ── 情形1：热状态（主升/高潮）下滑 → 退潮（1 日快退）──
  if (HOT_STATES.has(currentState)) {
    const dropping = rawToday !== '主升' && rawToday !== '高潮';
    const qualityDrop = isQualityDeterioring(today, yesterday);
    if (dropping || qualityDrop) {
      newState = dropping ? '退潮' : '主升';
    }
  }

  // ── 情形2：退潮中 → 出口判断 ──
  else if (currentState === '退潮') {
    const bothNonIce = rawToday !== '冰点' && rawYesterday != null && rawYesterday !== '冰点';
    const bothIce    = rawToday === '冰点' && rawYesterday === '冰点';
    if (bothNonIce) newState = rawToday;        // 恢复到原始分类
    else if (bothIce) newState = '冰点';         // 下行至冰点
    // 否则维持退潮
  }

  // ── 情形3：普通状态切换（需 2 日连续确认，防闪烁）──
  else {
    // 候选状态：如果质量恶化则候选退潮，否则取原始分类
    const candidate = (currentState !== '冰点' && isQualityDeterioring(today, yesterday))
      ? '退潮'
      : rawToday;

    // 2 日连续确认：今日候选 == 昨日候选 == 不同于当前状态
    if (candidate !== currentState && rawYesterday === candidate) {
      newState = candidate;
    }
  }

  return {
    state: newState,
    positionLimit: STATE_POSITION_LIMITS[newState] ?? 0,
    changed: newState !== currentState,
    snapshot: {
      heatScore:         heatScore(today),
      rawToday,
      rawYesterday:      rawYesterday ?? null,
      ztCount:           today.ztCount ?? null,
      ztDtRatio:         today.ztDtRatio ?? null,
      zbRate:            today.zbRate ?? null,
      maxContinuousDays: today.maxContinuousDays ?? null,
      prevZtPremium:     today.prevZtPremium ?? null,
    },
  };
}

// ──────────────────────────────────────────────
// 持久化：state-history.json
// ──────────────────────────────────────────────

export function readStateHistory() {
  if (!existsSync(HISTORY_PATH)) return [];
  return JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
}

export function writeStateRecord(record) {
  const history = readStateHistory();
  const idx = history.findIndex((r) => r.date === record.date);
  if (idx >= 0) history[idx] = record; else history.push(record);
  history.sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

// ──────────────────────────────────────────────
// 工具：获取情绪缓存中所有已算好的日期
// ──────────────────────────────────────────────

function getSentimentDates() {
  const dir = resolve(ROOT, 'cache', 'sentiment');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{8}\.json$/.test(f))
    .map((f) => f.replace('.json', ''))
    .sort();
}

// ──────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────

if (process.argv[1]?.includes('sentiment-state-machine')) {
  const args        = process.argv.slice(2);
  const dateIdx     = args.indexOf('--date');
  const isBackfill  = args.includes('--backfill');
  const force       = args.includes('--force');

  if (isBackfill) {
    // ── 批量：滚动历史，逐日推进状态 ──
    const dates = getSentimentDates();
    log.info(`批量运行 ${dates.length} 个交易日`);

    let currentState = '冰点';
    let done = 0;

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];

      if (!force) {
        const existing = readStateHistory().find((r) => r.date === date);
        if (existing) { currentState = existing.state; done++; continue; }
      }

      const todayM = loadMetrics(date);
      if (!todayM) continue;

      const series = [];
      if (i > 0) { const prev = loadMetrics(dates[i - 1]); if (prev) series.push(prev); }
      series.push(todayM);

      const result = evaluateState(series, currentState);
      writeStateRecord({
        date,
        state:         result.state,
        positionLimit: result.positionLimit,
        changed:       result.changed,
        previousState: currentState,
        ...result.snapshot,
      });
      currentState = result.state;
      done++;
    }

    log.info(`批量完成`, { done, total: dates.length });

    // 打印最近 10 条
    const recent = readStateHistory().slice(-10);
    console.log('\n最近状态记录：');
    console.table(recent.map((r) => ({
      日期:   r.date,
      状态:   r.state,
      仓位上限: (r.positionLimit * 100).toFixed(0) + '%',
      切换:   r.changed ? '✓' : '',
      热度分: r.heatScore ?? '-',
      涨停数: r.ztCount ?? '-',
    })));

  } else {
    // ── 单日 ──
    const date = dateIdx >= 0 ? args[dateIdx + 1] : '';
    if (!date) {
      log.error('用法: node sentiment-state-machine.mjs --date YYYYMMDD');
      process.exit(1);
    }

    const dates = getSentimentDates();
    const idx   = dates.indexOf(date);
    if (idx < 0) {
      log.error(`${date} 无情绪缓存，请先运行 sentiment-engine.mjs --date`);
      process.exit(1);
    }

    const history      = readStateHistory();
    const prevRecord   = history.filter((r) => r.date < date).pop();
    const currentState = prevRecord?.state ?? '冰点';

    const series = [];
    if (idx > 0) { const prev = loadMetrics(dates[idx - 1]); if (prev) series.push(prev); }
    series.push(loadMetrics(date));

    const result = evaluateState(series, currentState);
    const record = {
      date,
      state:         result.state,
      positionLimit: result.positionLimit,
      changed:       result.changed,
      previousState: currentState,
      ...result.snapshot,
    };
    writeStateRecord(record);
    console.log(JSON.stringify(record, null, 2));
  }
}
