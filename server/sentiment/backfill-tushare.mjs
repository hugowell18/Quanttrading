/**
 * 用 Tushare limit_list_d 补填历史涨停/跌停数据
 *
 * 功能：
 *  1. 找出 cache/ztpool/ 下涨停池为空的日期（ztpool.count === 0）
 *  2. 逐日调用 tushare_limit_fetcher.py 拉取数据并写入缓存
 *  3. 全部完成后重算所有日期的 continuous_days（连板数）
 *
 * 用法：
 *   node server/sentiment/backfill-tushare.mjs               # 补全所有空日期
 *   node server/sentiment/backfill-tushare.mjs --force       # 覆盖所有已有缓存
 *   node server/sentiment/backfill-tushare.mjs --dry-run     # 只列出目标日期
 *   node server/sentiment/backfill-tushare.mjs --start 20240101 --end 20240630
 *   node server/sentiment/backfill-tushare.mjs --rebuild-continuous  # 仅重算连板数
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CACHE_DIR = resolve(ROOT, 'cache', 'ztpool');
const PYTHON_SCRIPT = resolve(ROOT, 'server', 'sentiment', 'tushare_limit_fetcher.py');
const PYTHON_BIN = process.env.PYTHON || 'python';
const DELAY_MS = 300;   // Tushare 2000积分限速较宽松

// ──────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cachePath(date) {
  return resolve(CACHE_DIR, `${date}.json`);
}

function readCache(date) {
  const p = cachePath(date);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** 获取所有已缓存的日期（按升序） */
function getCachedDates() {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter((f) => /^\d{8}\.json$/.test(f))
    .map((f) => f.replace('.json', ''))
    .sort();
}

/** 判断一个缓存文件是否有实际数据（涨停 > 0 或 跌停 > 0） */
function hasData(data) {
  if (!data) return false;
  return (data.ztpool?.count ?? 0) > 0 || (data.dtpool?.count ?? 0) > 0;
}

// ──────────────────────────────────────────────
// Tushare 拉取
// ──────────────────────────────────────────────

function fetchTushare(date) {
  const stdout = execFileSync(PYTHON_BIN, [PYTHON_SCRIPT, '--date', date], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

// ──────────────────────────────────────────────
// 连板数重算
// 规则：若股票在 date[i] 的 ztpool 中，且也在 date[i-1] 的 ztpool 中，
//       则 continuous_days[i] = continuous_days[i-1] + 1，否则 = 1
// ──────────────────────────────────────────────

function rebuildContinuousDays(allDates) {
  console.log(`[backfill-tushare] 重算连板数 (共 ${allDates.length} 个交易日)...`);
  /** Map<code, continuous_days> — 滚动更新 */
  let prevZtSet = new Map();   // code → continuous_days

  let updated = 0;
  for (const date of allDates) {
    const data = readCache(date);
    if (!data) continue;

    const ztRows = data.ztpool?.rows ?? [];
    if (ztRows.length === 0) {
      prevZtSet = new Map();
      continue;
    }

    let changed = false;
    const newZtSet = new Map();
    for (const row of ztRows) {
      const prev = prevZtSet.get(row.code);
      const cd = prev != null ? prev + 1 : 1;
      if (row.continuous_days !== cd) {
        row.continuous_days = cd;
        changed = true;
      }
      newZtSet.set(row.code, cd);
    }

    if (changed) {
      writeFileSync(cachePath(date), JSON.stringify(data, null, 2), 'utf8');
      updated++;
    }
    prevZtSet = newZtSet;
  }

  console.log(`[backfill-tushare] 连板重算完成，更新了 ${updated} 个文件`);
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const force    = args.includes('--force');
const dryRun   = args.includes('--dry-run');
const rebuildOnly = args.includes('--rebuild-continuous');
const startIdx = args.indexOf('--start');
const endIdx   = args.indexOf('--end');
const startFilter = startIdx >= 0 ? args[startIdx + 1] : null;
const endFilter   = endIdx   >= 0 ? args[endIdx + 1]   : null;

const allDates = getCachedDates();

if (rebuildOnly) {
  rebuildContinuousDays(allDates);
  process.exit(0);
}

// 确定目标日期：空文件（或 --force 全覆盖）
const targetDates = allDates.filter((d) => {
  if (startFilter && d < startFilter) return false;
  if (endFilter   && d > endFilter)   return false;
  if (force) return true;
  const data = readCache(d);
  return !hasData(data);
});

console.log(`[backfill-tushare] 总缓存日期=${allDates.length} 目标日期=${targetDates.length}${force ? ' (force)' : ''}`);

if (targetDates.length === 0) {
  console.log('[backfill-tushare] 无需补填');
  process.exit(0);
}

if (dryRun) {
  console.log('[backfill-tushare] dry-run，目标日期：');
  targetDates.forEach((d) => console.log(' ', d));
  process.exit(0);
}

let done = 0, failed = 0;
for (const date of targetDates) {
  try {
    const data = fetchTushare(date);
    if (data.ok === false && data.errors?.fetch) {
      failed++;
      console.error(`\n[backfill-tushare] ${date} 失败: ${data.errors.fetch}`);
    } else {
      // 合并到已有缓存（保留 AKShare 的 zbgcpool 如果存在）
      const existing = readCache(date);
      const merged = {
        ...data,
        // 若既有缓存有 zbgcpool 数据则保留
        zbgcpool: (existing?.zbgcpool?.count ?? 0) > 0 ? existing.zbgcpool : data.zbgcpool,
        // 标记数据来源
        source_override: 'tushare',
      };
      writeFileSync(cachePath(date), JSON.stringify(merged, null, 2), 'utf8');
      done++;
    }
  } catch (err) {
    failed++;
    console.error(`\n[backfill-tushare] ${date} 异常: ${err.message}`);
  }

  const total = targetDates.length;
  const pct = (((done + failed) / total) * 100).toFixed(0);
  process.stdout.write(
    `\r[backfill-tushare] 进度 ${done + failed}/${total} (${pct}%) 成功=${done} 失败=${failed}  `,
  );

  if (done + failed < total) await sleep(DELAY_MS);
}

process.stdout.write('\n');
console.log(`[backfill-tushare] 拉取完成 — 成功=${done} 失败=${failed}`);

// 重算连板数
if (done > 0) {
  rebuildContinuousDays(allDates);
}

if (failed > 0) {
  console.log('[backfill-tushare] 提示：失败日期可用 --force 重跑');
  process.exitCode = 1;
}
