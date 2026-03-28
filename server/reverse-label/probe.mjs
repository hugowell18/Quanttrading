// 快速探针：只跑1个信号配置，打印真实交易次数和胜率
import { readDaily } from '../data/csv-manager.mjs';
import { DataEngine } from './data-engine.mjs';
import { ModelSelector } from './model-selector.mjs';
import { WalkForwardValidator } from './validator.mjs';

const formatDate = (v) => `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
const toTsCode = (code) => (/^6/.test(code) ? `${code}.SH` : `${code}.SZ`);
const NO_BOLL_LIMIT = 999;

const stockRows = readDaily(toTsCode('600519'), '20050101', '99991231');
const indexRows = readDaily('000300.SH', '20050101', '99991231');

const normalize = (rows) => rows.map((row) => {
  const raw = Number(row.close ?? 0);
  const adj = Number(row.close_adj ?? row.close ?? 0);
  const f = raw > 0 ? adj / raw : 1;
  return {
    date: formatDate(row.trade_date),
    open: Number(row.open) * f, high: Number(row.high) * f,
    low: Number(row.low) * f, close: adj, close_adj: adj,
    open_adj: Number(row.open) * f, high_adj: Number(row.high) * f, low_adj: Number(row.low) * f,
    volume: Math.round(Number(row.volume ?? 0)),
    amount: Number(row.amount ?? 0), turnover_rate: Number(row.turnover_rate ?? 0),
  };
});

const stockCandles = normalize(stockRows);
const indexCandles = normalize(indexRows);
const indexFeatures = new DataEngine(indexCandles).computeAllFeatures();
const stockFeatures = new DataEngine(stockCandles).computeAllFeatures(indexFeatures);
const indexMap = new Map(indexFeatures.map((r) => [r.date, r]));

// 取训练集 2005-2015
const trainRows = stockFeatures.filter((r) => r.date <= '2015-12-31');
const validRows = stockFeatures.filter((r) => r.date >= '2016-01-01' && r.date <= '2019-12-31');

// 打标签（最宽松条件：RSI45, J30, 超卖2个）
const COST = 0.007;
const labeled = (rows) => {
  const out = rows.map((r) => ({
    ...r, close_adj: Number(r.close_adj ?? r.close),
    open_adj: Number(r.open_adj ?? r.open), high_adj: Number(r.high_adj ?? r.high), low_adj: Number(r.low_adj ?? r.low),
    ma20: Number(r.ma20 ?? 0), ma60: Number(r.ma60 ?? 0),
    rsi6: Number(r.rsi6 ?? 0), kdj_j: Number(r.j ?? r.kdj_j ?? 0),
    boll_pos: Number(r.bollPos ?? r.boll_pos ?? 1),
    isBuyPoint: 0, isSellPoint: 0,
  }));
  let buys = 0;
  for (let i = 4; i < out.length - 5; i++) {
    const row = out[i];
    if (!row.ma60 || row.close_adj <= row.ma60) continue;
    let cnt = 0;
    if (row.rsi6 < 45) cnt++;
    if (row.kdj_j < 30) cnt++;
    if (row.boll_pos < 0.3) cnt++;
    let neg = 0; for (let k=i-3;k<=i;k++) if(out[k].close_adj<out[k].open_adj) neg++;
    if (neg >= 3) cnt++;
    const drop = (row.close_adj - out[i-3].close_adj) / out[i-3].close_adj;
    if (drop < -0.02) cnt++;
    if (out[i].volume < out[i-1].volume && out[i-1].volume < out[i-2].volume) cnt++;
    if (cnt < 2) continue;

    const bp = row.close_adj * (1 + COST);
    let ok = false;
    let dd = 0;
    for (let k=i+1; k<=i+5 && k<out.length; k++) {
      if (out[k].low_adj < bp) dd = Math.max(dd, (bp - out[k].low_adj)/bp);
      if ((out[k].high_adj - bp)/bp >= 0.045) { ok = true; break; }
    }
    if (ok && dd <= 0.025) { row.isBuyPoint = 1; buys++; }
  }
  console.log(`  标注完成: ${out.length}行, 买点=${buys} (${(buys/out.length*100).toFixed(2)}%)`);
  return out;
};

console.log('=== 训练集 ===');
const trainLabeled = labeled(trainRows);
console.log('=== 验证集 ===');
const validLabeled = labeled(validRows);

// 跑 ModelSelector
console.log('\n=== ModelSelector 训练 ===');
const sel = new ModelSelector(trainLabeled);
sel.run();
const best = sel.bestModel();
console.log(`bestModel: ${best?.featureSet}/${best?.model}, f1=${best?.f1}, precision=${best?.precision}, recall=${best?.recall}`);
console.log(`predictor threshold: ${best?.predictor?.threshold}`);

if (!best?.predictor) { console.log('无模型，退出'); process.exit(1); }

// 跑 WalkForwardValidator（宽松出场B方案）
const runValidator = (rows, label) => {
  const v = new WalkForwardValidator(rows, {
    trainSize: 180, testSize: 60, forwardDays: 5,
    stopLoss: 0.025, maxHoldingDays: 5,
    takeProfitStyle: 'target', targetProfitPct: 0.045,
    tradingCost: 0.007, envFilter: 'none',
  });
  const result = v.validate(best);
  console.log(`\n=== ${label} ===`);
  console.log(`  totalTrades=${result.totalTrades}, winRate=${(result.winRate*100).toFixed(1)}%, avgWin=${result.avgWin}, avgLoss=${result.avgLoss}`);
  console.log(`  maxDrawdown=${(result.maxDrawdown*100).toFixed(2)}%, avgHoldingDays=${result.avgHoldingDays}`);
};

runValidator(trainLabeled, '训练集验证');
runValidator(validLabeled, '验证集验证');
