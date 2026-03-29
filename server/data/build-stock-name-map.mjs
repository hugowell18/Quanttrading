/**
 * 从 Tushare 拉取全量股票名称，生成 cache/stock-names.json
 * 格式：{ "600062": "华润双鹤", "000001": "平安银行", ... }
 *
 * 用法：node server/data/build-stock-name-map.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env.local');
const OUT_PATH = resolve(process.cwd(), 'cache', 'stock-names.json');
const TUSHARE_API = 'http://api.tushare.pro';

function readToken() {
  if (!existsSync(ENV_PATH)) return process.env.TUSHARE_TOKEN || '';
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const [k, ...rest] = line.split('=');
    if (k.trim() === 'TUSHARE_TOKEN') return rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return process.env.TUSHARE_TOKEN || '';
}

async function fetchStockBasic(token) {
  const res = await fetch(TUSHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_name: 'stock_basic',
      token,
      params: { list_status: 'L' },
      fields: 'ts_code,name',
    }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.msg);
  const { fields, items } = json.data;
  const codeIdx = fields.indexOf('ts_code');
  const nameIdx = fields.indexOf('name');
  const map = {};
  for (const item of items) {
    const tsCode = item[codeIdx]; // e.g. "600062.SH"
    const code = tsCode.split('.')[0];
    map[code] = item[nameIdx];
  }
  return map;
}

const token = readToken();
if (!token) {
  console.error('缺少 TUSHARE_TOKEN，请在 .env.local 中配置');
  process.exit(1);
}

console.log('正在从 Tushare 拉取股票名称...');
const map = await fetchStockBasic(token);
console.log(`获取到 ${Object.keys(map).length} 只股票名称`);

writeFileSync(OUT_PATH, JSON.stringify(map, null, 2), 'utf8');
console.log(`已写入 ${OUT_PATH}`);
