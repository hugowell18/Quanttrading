/**
 * 情绪指标计算引擎 (Phase 1.4)
 *
 * 计算6项情绪指标：
 *  1. 涨停家数（含一字板/非一字板）
 *  2. 连板高度（全市场最高连板数）
 *  3. 炸板率 = ZB家数 / (ZT家数 + ZB家数)
 *  4. 涨跌停比 = ZT家数 / DT家数
 *  5. 封板率 = failed_seals==0的ZT股 / ZT总家数
 *  6. 昨日涨停溢价 = 昨日ZT股今日平均涨跌幅
 *
 * 用法（模块导入）：
 *   import { calcMetrics, loadMetrics } from './sentiment-engine.mjs';
 *
 * 用法（CLI）：
 *   node server/sentiment/sentiment-engine.mjs --date 20260327
 *   node server/sentiment/sentiment-engine.mjs --backfill        # 补算所有缓存日期
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readZtpool } from './ztpool-collector.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('sentiment-eng');

const ROOT = process.cwd();
const SENTIMENT_DIR = resolve(ROOT, 'cache', 'sentiment');
mkdirSync(SENTIMENT_DIR, { recursive: true });

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * 判断是否为一字板
 * 条件：首封时间 ≤ 09:26:00 且 炸板次数 == 0
 */
function isYiziBoard(row) {
  const ft = row.first_seal_time ?? '';
  return ft !== '' && ft <= '09:26:00' && (row.failed_seals ?? 0) === 0;
}

// ──────────────────────────────────────────────
// 核心计算
// ──────────────────────────────────────────────

/**
 * 计算单日6项情绪指标
 * @param {string} date       当日 YYYYMMDD
 * @param {string} prevDate   前一交易日 YYYYMMDD（用于昨日涨停溢价）
 * @returns {object|null}
 */
export function calcMetrics(date, prevDate = null) {
  const today = readZtpool(date);
  if (!today) return null;

  const ztRows = today.ztpool?.rows ?? [];
  const zbRows = today.zbgcpool?.rows ?? [];
  const dtRows = today.dtpool?.rows ?? [];

  const ztCount = ztRows.length;
  const zbCount = zbRows.length;
  const dtCount = dtRows.length;

  // Tushare-daily 数据缺少 ZB 池和 failed_seals，标记后跳过相关指标
  const isTushareDaily = today.ztpool?.source === 'tushare-daily';

  // ── 指标1：涨停家数 ──────────────────────────
  const yiziCount    = ztRows.filter(isYiziBoard).length;
  const nonYiziCount = ztCount - yiziCount;

  // ── 指标2：连板高度 ──────────────────────────
  const maxContinuousDays = ztCount > 0
    ? Math.max(...ztRows.map((r) => r.continuous_days ?? 1))
    : 0;

  // ── 指标3：炸板率 ────────────────────────────
  // Tushare-daily 无 ZB 池数据，置 null
  const zbRate = isTushareDaily ? null
    : (ztCount + zbCount) > 0
      ? round4(zbCount / (ztCount + zbCount))
      : null;

  // ── 指标4：涨跌停比 ──────────────────────────
  const ztDtRatio = dtCount > 0
    ? round4(ztCount / dtCount)
    : null;

  // ── 指标5：封板率 ────────────────────────────
  // Tushare-daily 的 failed_seals 全部默认为 0，不能反映真实封板情况，置 null
  const sealedCount = ztRows.filter((r) => (r.failed_seals ?? 0) === 0).length;
  const sealRate = (isTushareDaily || ztCount === 0) ? null
    : round4(sealedCount / ztCount);

  // ── 指标6：昨日涨停溢价 ───────────────────────
  // 昨日 ZT_Pool 个股 → 今日涨跌幅均值
  // 数据来源：今日 ztpool + zbgcpool + dtpool 的 pct_chg 字段
  // 注：未出现在今日三池的股票无 pct_chg，只统计有数据的部分并记录覆盖率
  let prevZtPremium = null;
  let premiumCoverage = null;

  if (prevDate) {
    const prev = readZtpool(prevDate);
    if (prev) {
      const prevZtCodes = (prev.ztpool?.rows ?? []).map((r) => r.code);

      // 今日价格映射（三池合并，同 code 取第一条）
      const todayPriceMap = new Map();
      for (const r of [...ztRows, ...zbRows, ...dtRows]) {
        if (!todayPriceMap.has(r.code)) {
          todayPriceMap.set(r.code, r.pct_chg ?? null);
        }
      }

      const found = [];
      for (const code of prevZtCodes) {
        const pct = todayPriceMap.get(code);
        if (pct != null) found.push(pct);
      }

      if (found.length > 0) {
        prevZtPremium = round4(found.reduce((a, b) => a + b, 0) / found.length);
      }
      premiumCoverage = prevZtCodes.length > 0
        ? round4(found.length / prevZtCodes.length)
        : null;
    }
  }

  return {
    date,
    // 涨停
    ztCount,
    yiziCount,
    nonYiziCount,
    // 炸板 / 跌停
    zbCount,
    dtCount,
    // 复合指标
    maxContinuousDays,
    zbRate,
    ztDtRatio,
    sealRate,
    prevZtPremium,
    premiumCoverage,  // 溢价计算覆盖率（<1说明部分股票无今日数据）
    // 数据来源
    source: {
      zt: today.ztpool?.source,
      zb: today.zbgcpool?.source,
      dt: today.dtpool?.source,
    },
  };
}

// ──────────────────────────────────────────────
// 持久化
// ──────────────────────────────────────────────

function sentimentPath(date) {
  return resolve(SENTIMENT_DIR, `${date}.json`);
}

export function saveSentiment(metrics) {
  writeFileSync(sentimentPath(metrics.date), JSON.stringify(metrics, null, 2), 'utf8');
}

export function loadMetrics(date) {
  const p = sentimentPath(date);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ──────────────────────────────────────────────
// 获取已缓存的交易日列表（按日期排序）
// ──────────────────────────────────────────────

function getCachedDates() {
  const ztpoolDir = resolve(ROOT, 'cache', 'ztpool');
  if (!existsSync(ztpoolDir)) return [];
  return readdirSync(ztpoolDir)
    .filter((f) => /^\d{8}\.json$/.test(f))
    .map((f) => f.replace('.json', ''))
    .sort();
}

// ──────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────

if (process.argv[1]?.includes('sentiment-engine')) {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const isBackfill = args.includes('--backfill');
  const force = args.includes('--force');

  if (isBackfill) {
    // 补算所有已缓存的 ztpool 日期
    const dates = getCachedDates();
    log.info(`补算 ${dates.length} 个交易日`);
    let done = 0;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      if (!force && existsSync(sentimentPath(date))) { done++; continue; }
      const prevDate = i > 0 ? dates[i - 1] : null;
      const m = calcMetrics(date, prevDate);
      if (m) { saveSentiment(m); done++; }
    }
    log.info(`补算完成`, { done, total: dates.length });

  } else {
    // 单日计算
    const date = dateIdx >= 0 ? args[dateIdx + 1] : '';
    if (!date) {
      log.error('用法: node sentiment-engine.mjs --date YYYYMMDD');
      process.exit(1);
    }

    const dates = getCachedDates();
    const idx = dates.indexOf(date);
    const prevDate = idx > 0 ? dates[idx - 1] : null;

    const m = calcMetrics(date, prevDate);
    if (!m) {
      log.error(`${date} 无数据`);
      process.exit(1);
    }

    saveSentiment(m);
    console.log(JSON.stringify(m, null, 2));
  }
}
