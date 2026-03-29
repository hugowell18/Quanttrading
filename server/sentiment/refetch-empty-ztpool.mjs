/**
 * 重新拉取 cache/ztpool/ 中所有空文件（count=0 的日期）
 * 用法：node server/sentiment/refetch-empty-ztpool.mjs
 *       node server/sentiment/refetch-empty-ztpool.mjs --from 20260309  # 只拉取指定日期之后
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectZtpool } from './ztpool-collector.mjs';

const ZTPOOL_DIR = resolve(process.cwd(), 'cache', 'ztpool');

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const fromDate = fromIdx >= 0 ? args[fromIdx + 1] : '';

const files = readdirSync(ZTPOOL_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

const emptyDates = [];
for (const f of files) {
  const date = f.replace('.json', '');
  if (fromDate && date < fromDate) continue;
  try {
    const d = JSON.parse(readFileSync(resolve(ZTPOOL_DIR, f), 'utf8'));
    const total = (d.ztpool?.count || 0) + (d.zbgcpool?.count || 0);
    if (total === 0) emptyDates.push(date);
  } catch {}
}

console.log(`发现 ${emptyDates.length} 个空文件需要重新拉取: ${emptyDates.join(', ')}\n`);

let success = 0, failed = 0;
for (const date of emptyDates) {
  process.stdout.write(`拉取 ${date}... `);
  try {
    const result = await collectZtpool(date, { force: true });
    if (result.skipped) {
      console.log(`跳过 (${result.reason})`);
    } else if (result.ok) {
      console.log(`✓ 涨停=${result.ztCount} 炸板=${result.zbCount}`);
      success++;
    } else {
      console.log(`✗ 失败: ${result.error}`);
      failed++;
    }
  } catch (err) {
    console.log(`✗ 异常: ${err.message}`);
    failed++;
  }
}

console.log(`\n完成: 成功=${success} 失败=${failed}`);
