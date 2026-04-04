/**
 * 本地快速扫描：找出所有历史金柱信号
 * 用法: node server/scripts/find-gold-signals.mjs [threshold] [topN]
 * 示例: node server/scripts/find-gold-signals.mjs 0.81 50
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateDivergenceScores } from '../moneyflow/moneyflow-calculator.mjs';

const KLINE_DIR = resolve(process.cwd(), 'cache', 'kline');
const MF_DIR    = resolve(process.cwd(), 'cache', 'moneyflow');
const threshold = parseFloat(process.argv[2] ?? '0.81');
const topN      = parseInt(process.argv[3] ?? '100');

// ─── 读文件 ───────────────────────────────────────────────────────────────────

function readKline(tsCode) {
  const fp = resolve(KLINE_DIR, `${tsCode}.csv`);
  if (!existsSync(fp)) return [];
  const [, ...lines] = readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  return lines.filter(Boolean).map(line => {
    const p = line.split(',');
    const d = p[0];
    return {
      date:   `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`,
      open:   Number(p[1]), high: Number(p[2]),
      low:    Number(p[3]), close: Number(p[4]),
      volume: Number(p[6]),
    };
  });
}

function readMoneyflow(tsCode) {
  const fp = resolve(MF_DIR, `${tsCode}.csv`);
  if (!existsSync(fp)) return [];
  const [, ...lines] = readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  return lines.filter(Boolean).map(line => {
    const [trade_date, buy_elg_amount, sell_elg_amount, buy_lg_amount,
           sell_lg_amount, buy_sm_amount, sell_sm_amount] = line.split(',');
    return {
      trade_date,
      buy_elg_amount:  Number(buy_elg_amount),
      sell_elg_amount: Number(sell_elg_amount),
      buy_lg_amount:   Number(buy_lg_amount),
      sell_lg_amount:  Number(sell_lg_amount),
      buy_sm_amount:   Number(buy_sm_amount),
      sell_sm_amount:  Number(sell_sm_amount),
    };
  });
}

function calcForwardReturn(kline, dateCompact, days) {
  const idx = kline.findIndex(k => k.date.replace(/-/g, '') === dateCompact);
  if (idx < 0 || idx + days >= kline.length) return null;
  return (kline[idx + days].close - kline[idx].close) / kline[idx].close;
}

// ─── 主扫描 ───────────────────────────────────────────────────────────────────

const stocks = readdirSync(MF_DIR)
  .filter(f => /^\d{6}\.(SH|SZ)\.csv$/.test(f))
  .map(f => f.replace('.csv', ''));

console.log(`扫描 ${stocks.length} 只股票，DS >= ${threshold} ...\n`);

const allHits = [];
let done = 0;

for (const tsCode of stocks) {
  const kline = readKline(tsCode);
  const mf    = readMoneyflow(tsCode);
  if (!kline.length || !mf.length) { done++; continue; }

  const scores = calculateDivergenceScores(kline, mf);
  for (const s of scores) {
    if (s.divergence_score < threshold) continue;
    const idx     = kline.findIndex(k => k.date.replace(/-/g, '') === s.date);
    const prevIdx = idx - 1;
    const pct     = (idx > 0 && kline[prevIdx].close > 0)
      ? (kline[idx].close - kline[prevIdx].close) / kline[prevIdx].close
      : null;
    allHits.push({
      tsCode,
      date:  `${s.date.slice(0,4)}-${s.date.slice(4,6)}-${s.date.slice(6,8)}`,
      ds:    s.divergence_score,
      pct,
      r3:    calcForwardReturn(kline, s.date, 3),
      r5:    calcForwardReturn(kline, s.date, 5),
      r10:   calcForwardReturn(kline, s.date, 10),
    });
  }

  done++;
  if (done % 200 === 0) process.stdout.write(`  ${done}/${stocks.length}...\r`);
}

// ─── 输出 ─────────────────────────────────────────────────────────────────────

allHits.sort((a, b) => b.ds - a.ds);

const p = v => v === null ? '  —   ' : `${v >= 0 ? '+' : ''}${(v*100).toFixed(2)}%`;

console.log(`\n找到 ${allHits.length} 条金柱信号（DS >= ${threshold}）\n`);
console.log('代码        日期         DS      当日    3日     5日     10日');
console.log('─'.repeat(70));

for (const h of allHits.slice(0, topN)) {
  console.log(
    `${h.tsCode.padEnd(12)}${h.date}  ${h.ds.toFixed(4)}  ${p(h.pct).padStart(8)}  ${p(h.r3).padStart(7)}  ${p(h.r5).padStart(7)}  ${p(h.r10).padStart(7)}`
  );
}

// ─── 统计 ─────────────────────────────────────────────────────────────────────

const with5 = allHits.filter(h => h.r5 !== null);
if (with5.length) {
  const wins    = with5.filter(h => h.r5 > 0).length;
  const avg5    = with5.reduce((s, h) => s + h.r5, 0) / with5.length;
  const with3   = allHits.filter(h => h.r3 !== null);
  const avg3    = with3.reduce((s, h) => s + h.r3, 0) / with3.length;
  console.log('\n' + '─'.repeat(70));
  console.log(`总信号数: ${allHits.length}  |  有效样本(5日): ${with5.length}`);
  console.log(`5日胜率: ${(wins/with5.length*100).toFixed(1)}%  |  5日均涨: ${p(avg5)}  |  3日均涨: ${p(avg3)}`);
}

// ─── 按日期统计哪天信号最多 ──────────────────────────────────────────────────

const byDate = {};
for (const h of allHits) {
  byDate[h.date] = (byDate[h.date] || 0) + 1;
}
const topDates = Object.entries(byDate)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

console.log('\n信号最密集的日期（可能是市场底部）:');
console.log('日期         信号数');
console.log('─'.repeat(30));
for (const [date, cnt] of topDates) {
  console.log(`${date}   ${cnt} 只`);
}
