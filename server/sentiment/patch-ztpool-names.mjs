/**
 * 用 cache/stock-names.json 批量填充 cache/ztpool/ 中所有 name 为空的记录
 * 用法：node server/sentiment/patch-ztpool-names.mjs
 *       node server/sentiment/patch-ztpool-names.mjs --dry-run   # 只预览不写入
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ZTPOOL_DIR = resolve(process.cwd(), 'cache', 'ztpool');
const NAMES_PATH = resolve(process.cwd(), 'cache', 'stock-names.json');

if (!existsSync(NAMES_PATH)) {
  console.error('找不到 cache/stock-names.json，请先运行：node server/data/build-stock-name-map.mjs');
  process.exit(1);
}

const nameMap = JSON.parse(readFileSync(NAMES_PATH, 'utf8'));
console.log(`加载名称映射：${Object.keys(nameMap).length} 条`);

const dryRun = process.argv.includes('--dry-run');
const files = readdirSync(ZTPOOL_DIR).filter(f => f.endsWith('.json')).sort();

let totalPatched = 0, totalMissing = 0, filesChanged = 0;

for (const f of files) {
  const path = resolve(ZTPOOL_DIR, f);
  const data = JSON.parse(readFileSync(path, 'utf8'));

  let changed = false;
  for (const pool of ['ztpool', 'zbgcpool', 'dtpool']) {
    const rows = data[pool]?.rows ?? [];
    for (const row of rows) {
      if (!row.name || row.name.includes('\uFFFD')) {
        const name = nameMap[row.code];
        if (name) {
          row.name = name;
          totalPatched++;
          changed = true;
        } else {
          totalMissing++;
        }
      }
    }
  }

  if (changed) {
    filesChanged++;
    if (!dryRun) {
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    }
    process.stdout.write(`${dryRun ? '[dry] ' : ''}${f} 已修复\n`);
  }
}

console.log(`\n完成: 修复=${totalPatched} 条，找不到名称=${totalMissing} 条，涉及文件=${filesChanged} 个${dryRun ? '（dry-run，未写入）' : ''}`);
