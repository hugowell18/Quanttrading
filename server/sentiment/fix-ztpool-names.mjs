/**
 * 修复 cache/ztpool/ 中有乱码的文件，通过重新采集来修复。
 * 用法：node server/sentiment/fix-ztpool-names.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectZtpool } from './ztpool-collector.mjs';

const ZTPOOL_DIR = resolve(process.cwd(), 'cache', 'ztpool');

function hasGarbled(data) {
  const rows = [
    ...(data.ztpool?.rows || []),
    ...(data.zbgcpool?.rows || []),
    ...(data.dtpool?.rows || []),
  ];
  return rows.some(r => r.name && r.name.includes('\uFFFD'));
}

const files = readdirSync(ZTPOOL_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

const garbled = [];
for (const f of files) {
  try {
    const data = JSON.parse(readFileSync(resolve(ZTPOOL_DIR, f), 'utf8'));
    if (hasGarbled(data)) garbled.push(f.replace('.json', ''));
  } catch {}
}

console.log(`发现 ${garbled.length} 个乱码文件: ${garbled.join(', ')}`);

for (const date of garbled) {
  console.log(`\n重新采集 ${date}...`);
  try {
    const result = await collectZtpool(date, { force: true });
    if (result.ok) {
      console.log(`  ✓ ${date} 修复成功 涨停=${result.ztCount}`);
    } else {
      console.log(`  ✗ ${date} 采集失败: ${result.error}`);
    }
  } catch (err) {
    console.error(`  ✗ ${date} 异常: ${err.message}`);
  }
}

console.log('\n完成');
