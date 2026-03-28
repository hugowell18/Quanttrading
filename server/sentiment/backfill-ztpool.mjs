/**
 * 历史涨停池数据回填
 * 从 start_date 到 end_date，逐日采集并缓存到 cache/ztpool/YYYYMMDD.json
 *
 * 用法：
 *   node server/sentiment/backfill-ztpool.mjs                          # 2023-01-01 至今
 *   node server/sentiment/backfill-ztpool.mjs --start 20240101         # 自定义起始
 *   node server/sentiment/backfill-ztpool.mjs --start 20240101 --end 20240630
 *   node server/sentiment/backfill-ztpool.mjs --force                  # 覆盖已有缓存
 *   node server/sentiment/backfill-ztpool.mjs --dry-run                # 只列出缺失日期不实际采集
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectZtpool } from './ztpool-collector.mjs';

const ROOT = process.cwd();
const CACHE_DIR = resolve(ROOT, 'cache', 'ztpool');
const PYTHON_BIN = process.env.PYTHON || 'python';

mkdirSync(CACHE_DIR, { recursive: true });

// ──────────────────────────────────────────────
// 交易日历（从 AKShare 拉一次，缓存在内存）
// ──────────────────────────────────────────────

function getTradingDates(startDate, endDate) {
  const script = `
import akshare as ak, json, sys
df = ak.tool_trade_date_hist_sina()
dates = [str(d).replace('-','') for d in df['trade_date'].tolist()]
start, end = sys.argv[1], sys.argv[2]
filtered = [d for d in dates if start <= d <= end]
print(json.dumps(filtered))
`;
  const tmpScript = resolve(ROOT, 'cache', '_tmp_cal.py');
  writeFileSync(tmpScript, script);
  try {
    const out = execFileSync(PYTHON_BIN, [tmpScript, startDate, endDate], {
      encoding: 'utf8', timeout: 30_000,
    });
    return JSON.parse(out.trim());
  } finally {
    try { unlinkSync(tmpScript); } catch {}
  }
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────

function todayCompact() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

const args = process.argv.slice(2);
const startIdx = args.indexOf('--start');
const endIdx   = args.indexOf('--end');
const force    = args.includes('--force');
const dryRun   = args.includes('--dry-run');

const startDate = startIdx >= 0 ? args[startIdx + 1] : '20230101';
const endDate   = endIdx   >= 0 ? args[endIdx + 1]   : todayCompact();

console.log(`[backfill] 回填范围 ${startDate} → ${endDate}${force ? ' (force)' : ''}${dryRun ? ' (dry-run)' : ''}`);
console.log('[backfill] 获取交易日历...');

const tradingDates = getTradingDates(startDate, endDate);
console.log(`[backfill] 共 ${tradingDates.length} 个交易日`);

// 找出缺失的日期
const missing = tradingDates.filter(d => force || !existsSync(resolve(CACHE_DIR, `${d}.json`)));
const cached  = tradingDates.length - missing.length;
console.log(`[backfill] 已缓存=${cached} 待采集=${missing.length}`);

if (missing.length === 0) {
  console.log('[backfill] 全部已缓存，无需采集');
  process.exit(0);
}

if (dryRun) {
  console.log('[backfill] dry-run 模式，缺失日期：');
  missing.forEach(d => console.log(' ', d));
  process.exit(0);
}

// 逐日采集，每次间隔 800ms 避免限流
let done = 0, failed = 0;
const DELAY_MS = 800;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

for (const date of missing) {
  const result = await collectZtpool(date, { force });
  if (result.ok === false && !result.skipped) {
    failed++;
    console.error(`[backfill] ${date} 失败: ${result.error}`);
  } else {
    done++;
  }

  // 进度
  const total = missing.length;
  const pct = ((done + failed) / total * 100).toFixed(0);
  process.stdout.write(
    `\r[backfill] 进度 ${done + failed}/${total} (${pct}%) 成功=${done} 失败=${failed}`
  );

  if (done + failed < total) await sleep(DELAY_MS);
}

process.stdout.write('\n');
console.log(`[backfill] 完成 — 成功=${done} 失败=${failed} 总交易日=${tradingDates.length}`);

if (failed > 0) {
  console.log('[backfill] 提示：失败的日期可用 --force 重跑');
  process.exitCode = 1;
}
