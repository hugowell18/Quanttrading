/**
 * 涨停池 / 炸板池 / 跌停池 每日数据收集器
 *
 * 用法：
 *   node server/sentiment/ztpool-collector.mjs              # 采集今日
 *   node server/sentiment/ztpool-collector.mjs --date 20240315  # 采集指定日
 *   node server/sentiment/ztpool-collector.mjs --force      # 强制覆盖已有缓存
 *
 * 输出：cache/ztpool/YYYYMMDD.json
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CACHE_DIR = resolve(ROOT, 'cache', 'ztpool');
const PYTHON_SCRIPT = resolve(ROOT, 'server', 'sentiment', 'ztpool_collector.py');
const PYTHON_BIN = process.env.PYTHON || 'python';

mkdirSync(CACHE_DIR, { recursive: true });

// ──────────────────────────────────────────────
// 日期工具
// ──────────────────────────────────────────────

function todayCompact() {
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** 周六=6，周日=0 */
function isWeekend(dateStr) {
  const d = new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

// ──────────────────────────────────────────────
// 核心采集
// ──────────────────────────────────────────────

/**
 * 调用 Python 脚本采集三个池，返回解析后的对象
 * @param {string} dateStr YYYYMMDD
 * @returns {{ ok, date, fetchTime, ztpool, zbgcpool, dtpool, errors }}
 */
function runPythonCollector(dateStr) {
  const args = [PYTHON_SCRIPT, '--type', 'all'];
  if (dateStr) args.push('--date', dateStr);

  // Strip proxy env vars — inherited proxy settings from the Node process
  // can block akshare's HTTP requests with a ProxyError.
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  delete env.HTTP_PROXY; delete env.HTTPS_PROXY;
  delete env.http_proxy; delete env.https_proxy;

  const stdout = execFileSync(PYTHON_BIN, args, {
    encoding: 'utf8',
    timeout: 120_000,   // 2分钟超时
    maxBuffer: 10 * 1024 * 1024,
    env,
  });

  return JSON.parse(stdout.trim());
}

// ──────────────────────────────────────────────
// 数据验证
// ──────────────────────────────────────────────

function validate(data) {
  const issues = [];
  for (const pool of ['ztpool', 'zbgcpool', 'dtpool']) {
    const rows = data[pool]?.rows ?? [];
    // 检查必填字段完整性
    const missing = rows.filter((r) => !r.code || !r.name);
    if (missing.length) issues.push(`${pool}: ${missing.length} 条缺少 code/name`);
    // 检查价格异常
    const badPrice = rows.filter((r) => r.price <= 0);
    if (badPrice.length) issues.push(`${pool}: ${badPrice.length} 条价格为0`);
  }
  return issues;
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────

function cachePath(dateStr) {
  return resolve(CACHE_DIR, `${dateStr}.json`);
}

export async function collectZtpool(dateStr, { force = false } = {}) {
  const date = dateStr || todayCompact();
  const path = cachePath(date);

  // 跳过周末
  if (isWeekend(date)) {
    console.log(`[ztpool-collector] ${date} 是周末，跳过`);
    return { skipped: true, reason: 'weekend', date };
  }

  // 已有缓存且不强制
  if (!force && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    console.log(
      `[ztpool-collector] ${date} 缓存已存在 — `
      + `涨停=${cached.ztpool?.count ?? 0} 炸板=${cached.zbgcpool?.count ?? 0} 跌停=${cached.dtpool?.count ?? 0}`,
    );
    return { skipped: true, reason: 'cached', date, data: cached };
  }

  console.log(`[ztpool-collector] ${date} 开始采集...`);
  const startMs = Date.now();

  let data;
  try {
    data = runPythonCollector(date);
  } catch (err) {
    const msg = `Python采集失败: ${err.message}`;
    console.error(`[ztpool-collector] ${msg}`);
    return { ok: false, date, error: msg };
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  // 数据验证
  const issues = validate(data);
  if (issues.length) {
    console.warn(`[ztpool-collector] 验证警告: ${issues.join(' | ')}`);
  }

  // 写入缓存
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');

  const ztCount = data.ztpool?.count ?? 0;
  const zbCount = data.zbgcpool?.count ?? 0;
  const dtCount = data.dtpool?.count ?? 0;
  const errorKeys = Object.keys(data.errors ?? {});

  console.log(
    `[ztpool-collector] ${date} 完成 ${elapsed}s — `
    + `涨停=${ztCount} 炸板=${zbCount} 跌停=${dtCount}`
    + (errorKeys.length ? ` ⚠️ 失败池: ${errorKeys.join(',')}` : ''),
  );

  return { ok: data.ok, date, ztCount, zbCount, dtCount, errors: data.errors, issues, elapsed };
}

/**
 * 读取指定日期的缓存（不触发采集）
 * @param {string} dateStr YYYYMMDD
 */
export function readZtpool(dateStr) {
  const path = cachePath(dateStr);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ──────────────────────────────────────────────
// CLI 入口
// ──────────────────────────────────────────────

if (process.argv[1]?.includes('ztpool-collector')) {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const dateArg = dateIdx >= 0 ? args[dateIdx + 1] : '';
  const force = args.includes('--force');

  const result = await collectZtpool(dateArg, { force });

  if (result.skipped) {
    console.log(`跳过: ${result.reason}`);
  } else if (!result.ok) {
    console.error('采集失败:', result.error);
    process.exitCode = 1;
  } else {
    console.log(`涨停=${result.ztCount} 炸板=${result.zbCount} 跌停=${result.dtCount}`);
  }
}
