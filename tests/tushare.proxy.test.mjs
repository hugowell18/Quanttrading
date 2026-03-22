import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const serverSource = readFileSync(resolve(repoRoot, 'server/tushare-proxy.mjs'), 'utf8');
const componentSource = readFileSync(resolve(repoRoot, 'src/app/components/SignalAnalyzer.tsx'), 'utf8');

assert.equal(packageJson.scripts['dev:api'], 'node server/tushare-proxy.mjs');
assert.match(serverSource, /TUSHARE_TOKEN/);
assert.match(serverSource, /stock_basic/);
assert.match(serverSource, /daily/);
assert.match(serverSource, /computeIndicators/);
assert.match(serverSource, /generateTrades/);
assert.match(componentSource, /api\/tushare\/stock/);
assert.match(componentSource, /setTradeRecords/);
assert.match(componentSource, /isLoading/);

console.log('tushare.proxy.test.mjs passed');