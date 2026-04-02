import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { optimize } from './optimizer.mjs';
import { STOCK_UNIVERSE } from './stock-universe.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('batch-runner');

const START_DATE = '20220101';
const END_DATE = '20260322';
const OUT_DIR = resolve(process.cwd(), 'results', 'batch');


function isStrictPass(result) {
  if (!result) return false;
  return (
    result.stopLossRate < 0.25        // 更严格止损率（原0.30）
    && result.avgReturn > 0.03        // 平均单笔收益 > 3%（原仅 > 0）
    && result.winRate > 0.60          // 胜率 > 60%（原0.55）
    && result.totalTrades >= 8
    && result.validCombinations >= 5
  );
}


async function runBatch() {
  mkdirSync(OUT_DIR, { recursive: true });

  const summary = [];
  let done = 0;

  for (const stock of STOCK_UNIVERSE) {
    done += 1;
    process.stdout.write(`
[${done}/${STOCK_UNIVERSE.length}] ${stock.code} ${stock.name} ...`);

    try {
      const result = await optimize(stock.code, START_DATE, END_DATE);
      writeFileSync(resolve(OUT_DIR, `${stock.code}.json`), JSON.stringify(result, null, 2));

      const r = result.bestResult;
      const vComb = result.stats.validCombinations;
      const strict = isStrictPass({ ...r, validCombinations: vComb });
      if (r) {
        process.stdout.write(
          ` ${strict ? 'PASS' : 'WEAK'} return=${(r.avgReturn * 100).toFixed(1)}%`
          + ` win=${(r.winRate * 100).toFixed(0)}%`
          + ` trades=${r.totalTrades}`
          + ` valid=${vComb}`,
        );
        summary.push({
          code: stock.code,
          name: stock.name,
          sector: stock.sector,
          valid: true,
          strictPass: strict,
          bestConfig: result.bestConfig,
          bestResult: r,
          validCombinations: vComb,
        });
      } else {
        process.stdout.write(' FAILED no-valid-config');
        summary.push({
          code: stock.code,
          name: stock.name,
          sector: stock.sector,
          valid: false,
        });
      }
    } catch (error) {
      process.stdout.write(` FAILED ${error.message}`);
      summary.push({
        code: stock.code,
        name: stock.name,
        sector: stock.sector,
        valid: false,
        error: error.message,
      });
    }
  }

  const strictPassed = summary
    .filter((item) => item.strictPass)
    .sort((left, right) => right.bestResult.avgReturn - left.bestResult.avgReturn);
  const weakPassed = summary
    .filter((item) => item.valid && !item.strictPass)
    .sort((left, right) => right.bestResult.avgReturn - left.bestResult.avgReturn);
  const failed = summary.filter((item) => !item.valid);

  writeFileSync(
    resolve(OUT_DIR, 'summary.json'),
    JSON.stringify({ strictPassed, weakPassed, failed, total: summary.length }, null, 2),
  );

  console.log(`

${'='.repeat(70)}`);
  console.log('  Batch Scan Summary');
  console.log('='.repeat(70));
  console.log('  #   code    name      sector      return  win  stopLoss  trades  valid');
  console.log(`  ${'-'.repeat(68)}`);

  strictPassed.forEach((item, index) => {
    const r = item.bestResult;
    console.log(
      `  ${String(index + 1).padEnd(4)}`
      + `${item.code}  `
      + `${item.name.padEnd(8)}`
      + `${item.sector.padEnd(10)}`
      + `${(r.avgReturn * 100).toFixed(1).padStart(6)}%`
      + `  ${(r.winRate * 100).toFixed(0).padStart(4)}%`
      + `  ${(r.stopLossRate * 100).toFixed(0).padStart(7)}%`
      + `  ${String(r.totalTrades).padStart(6)}`
      + `  ${String(item.validCombinations).padStart(5)}`,
    );
  });

  console.log(`\n  Passed: ${strictPassed.length}  Weak: ${weakPassed.length}  Failed: ${failed.length}  Total: ${summary.length}`);

  if (failed.length) {
    console.log('\n  Failed Symbols:');
    failed.forEach((item) => console.log(`    ${item.code} ${item.name} ${item.error ?? 'no-valid-config'}`));
  }
}

runBatch().catch((error) => {
  log.fatal('batch run failed', { error: error.message ?? String(error) });
  process.exitCode = 1;
});
