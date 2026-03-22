import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const componentPath = resolve(repoRoot, 'src/app/components/SignalAnalyzer.tsx');
const source = readFileSync(componentPath, 'utf8');
const buffer = readFileSync(componentPath);
const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;

assert.match(source, /tradeRecords/);
assert.match(source, /setTradeRecords/);
assert.match(source, /api\/tushare\/stock/);
assert.match(source, /periodToQuery/);
assert.match(source, /activeTab === 'price'/);
assert.match(source, /activeTab === 'momentum'/);
assert.match(source, /activeTab === 'risk'/);
assert.match(source, /strategyType/);
assert.match(source, /backtestPeriod/);
assert.match(source, /stopLossPercent/);
assert.match(source, /takeProfitPercent/);
assert.match(source, /LIVE/);
assert.equal(hasBom, false);

console.log('signalAnalyzer.page.test.mjs passed');