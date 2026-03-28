/**
 * 只刷新 strictPassed 股票的数据 + 重跑 optimizer，输出最新信号。
 * 用法：node server/reverse-label/refresh-signals.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureSymbolCsv } from '../data/csv-manager.mjs';
import { optimize } from './optimizer.mjs';

const OUT_DIR = resolve(process.cwd(), 'results', 'batch');
const SUMMARY_PATH = resolve(OUT_DIR, 'summary.json');

const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
const stocks = summary.strictPassed;

// 推断 securityType
const toTsCode = (code) => {
  if (code.includes('.')) return code.toUpperCase();
  return /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;
};
const getType = (code) => (/^(000300|399|0[0-9]{5})/.test(code) ? 'index' : 'stock');

// 先确保大盘指数是最新的
console.log('[refresh] 更新大盘指数 000300.SH ...');
await ensureSymbolCsv('000300.SH', 'index');

console.log(`[refresh] 开始刷新 ${stocks.length} 支 strictPassed 股票\n`);

const buySignals = [];
const watchSignals = []; // score 超过阈值但大盘过滤

for (let i = 0; i < stocks.length; i++) {
  const s = stocks[i];
  const tsCode = toTsCode(s.code);
  const secType = getType(s.code);

  process.stdout.write(`[${i + 1}/${stocks.length}] ${s.code} ${s.name} — 更新数据...`);
  try {
    const csvResult = await ensureSymbolCsv(tsCode, secType);
    process.stdout.write(` rows=${csvResult.rows} latest=${csvResult.latestTradeDate} | 跑优化...`);

    const result = await optimize(s.code);
    writeFileSync(resolve(OUT_DIR, `${s.code}.json`), JSON.stringify(result, null, 2));

    const sig = result.currentSignal;
    const sigStr = sig?.signal ?? 'unknown';
    const conf = sig?.confidence != null ? `conf=${sig.confidence.toFixed(3)}` : '';
    process.stdout.write(` → ${sigStr.toUpperCase()} ${conf}\n`);

    if (sigStr === 'buy') {
      buySignals.push({ code: s.code, name: s.name, ...sig });
    } else if (sigStr === 'hold' && sig?.score != null && sig.score > (sig.threshold ?? 0)) {
      watchSignals.push({ code: s.code, name: s.name, ...sig });
    }
  } catch (err) {
    process.stdout.write(` ERROR: ${err.message}\n`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('  今日信号汇总');
console.log('='.repeat(60));

if (buySignals.length) {
  console.log(`\n【BUY 信号】${buySignals.length} 支:`);
  buySignals
    .sort((a, b) => b.confidence - a.confidence)
    .forEach((s) => console.log(`  ${s.code} ${s.name}  conf=${s.confidence?.toFixed(3)}  score=${s.score?.toFixed(3)}  ${s.reason}`));
} else {
  console.log('\n【BUY 信号】无');
}

if (watchSignals.length) {
  console.log(`\n【Watch — 打分超阈值但大盘/其他过滤】${watchSignals.length} 支:`);
  watchSignals
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .forEach((s) => console.log(`  ${s.code} ${s.name}  score=${s.score?.toFixed(3)} > threshold=${s.threshold?.toFixed(3)}  ${s.reason}`));
}

console.log('\n[refresh] 完成');
