import { runReverseLabelPipeline } from './pipeline.mjs';

const symbol = process.argv[2] || '600519';
const startDate = process.argv[3] || '20220101';
const endDate = process.argv[4] || '20260322';

const result = await runReverseLabelPipeline({ symbol, startDate, endDate });
console.log(JSON.stringify(result, null, 2));
