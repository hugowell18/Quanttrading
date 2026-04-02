/**
 * 横截面轮动运行器 — 从 "单股择时" 到 "股票池轮动"
 *
 * 完整流程：
 *   1. 从本地缓存加载 50+ 只股票的对齐数据
 *   2. 在训练期（前半段）为每只股票训练模型
 *   3. 在测试期（后半段）运行 PortfolioBacktester
 *   4. 输出组合级回测报告
 *
 * Walk-Forward 模式：
 *   训练窗口滚动推进，每 retrainInterval 天重新训练模型
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAlignedUniverse, trainPerStockModels } from './date-aligner.mjs';
import { PortfolioBacktester } from './portfolio-backtester.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('rotation');

const OUT_DIR = resolve(process.cwd(), 'results', 'portfolio');

/**
 * 运行横截面轮动回测
 */
export async function runRotation(options = {}) {
  const {
    maxPositions = 5,
    retrainInterval = 120,   // 每120个交易日重新训练（约半年）
    trainLookback = 500,     // 训练用最近500根K线
    minTrainRows = 200,
    testStartRatio = 0.5,    // 前50%用于初始训练，后50%用于测试
    stockCodes = null,       // null = 全池
  } = options;

  console.log('\n' + '═'.repeat(70));
  console.log('  横截面轮动回测系统 (Cross-Sectional Rotation)');
  console.log('═'.repeat(70));

  // ── 1. 加载数据 ──
  log.info('[1/4] 加载对齐数据');
  const { stockDataMap, indexRows, tradeDates, stockMeta } = buildAlignedUniverse(stockCodes);

  if (stockDataMap.size < 5) {
    log.error('有效股票不足 5 只，请先运行 server/data/csv-manager.mjs 下载或更新本地CSV数据');
    return null;
  }

  // ── 2. 确定训练/测试分界 ──
  const splitIdx = Math.floor(tradeDates.length * testStartRatio);
  const trainEndDate = tradeDates[splitIdx];
  const testDates = tradeDates.slice(splitIdx);
  log.info('[2/4] 数据分割', { trainEnd: trainEndDate, testDays: testDates.length, stocks: stockDataMap.size, maxPositions });

  // ── 3. Walk-Forward 训练 ──
  log.info('[3/4] Walk-Forward 模型训练');
  const retrainDates = [];
  let models = null;

  // 预计算所有需要重新训练的日期
  for (let i = 0; i < testDates.length; i += retrainInterval) {
    retrainDates.push(testDates[i]);
  }
  if (retrainDates.length === 0) retrainDates.push(testDates[0]);

  // 训练所有时间点的模型（保存到 Map）
  const modelSnapshots = new Map();
  for (let ri = 0; ri < retrainDates.length; ri += 1) {
    const retrainDate = retrainDates[ri];
    process.stdout.write(`      训练 [${ri + 1}/${retrainDates.length}] 截止 ${retrainDate} ...`);

    models = trainPerStockModels(stockDataMap, retrainDate, { minTrainRows });
    modelSnapshots.set(retrainDate, models);
    log.info(`训练完成 [${ri + 1}/${retrainDates.length}]`, { date: retrainDate, validModels: models.size });
  }

  // ── 4. 运行组合回测 ──
  log.info('[4/4] 运行组合回测');

  // 扩展 backtester 以支持 walk-forward 模型切换
  const backtester = new PortfolioBacktester({
    initialCash: 1_000_000,
    maxPositions,
    maxHoldingDays: 15,
    stopLossAtrMul: 0,         // 不使用ATR止损
    trailingAtrMul: 0,         // 不使用ATR追踪
    minProfitToTrail: 1.0,     // 禁用追踪（阈值设为100%）
    hardStopPct: 0.05,         // 固定5%止损（V3策略）
  });

  // 自定义 run：在每个 retrainDate 切换模型
  let currentModels = modelSnapshots.get(retrainDates[0]) ?? new Map();
  let nextRetrainIdx = 1;

  // 使用内部逻辑手动驱动回测
  const indexMap = new Map();
  if (indexRows) {
    for (const r of indexRows) indexMap.set(r.date, r);
  }

  let pendingBuys = [];
  let pendingSells = [];

  for (let dayIdx = 0; dayIdx < testDates.length; dayIdx += 1) {
    const date = testDates[dayIdx];
    const prevDate = dayIdx > 0 ? testDates[dayIdx - 1] : tradeDates[splitIdx - 1];

    // 检查是否需要切换模型
    if (nextRetrainIdx < retrainDates.length && date >= retrainDates[nextRetrainIdx]) {
      currentModels = modelSnapshots.get(retrainDates[nextRetrainIdx]) ?? currentModels;
      nextRetrainIdx += 1;
    }

    // 1. 执行挂单
    backtester._executePendingBuys(pendingBuys, date, stockDataMap, prevDate);
    backtester._executePendingSells(pendingSells, date, stockDataMap, prevDate);
    pendingBuys = [];
    pendingSells = [];

    // 2. 检查持仓退出（V3策略：固定止损5% + 固定止盈4% + 超时）
    for (const [code, pos] of backtester.positions) {
      const row = stockDataMap.get(code)?.dateMap.get(date);
      if (!row) continue;

      const holdDays = dayIdx - pos.buyDateIndex;
      const currentReturn = (row.close - pos.buyPrice) / pos.buyPrice;

      let exitReason = null;
      // 固定止损 5%
      if (currentReturn <= -0.05) {
        exitReason = 'stopLoss';
      }
      // 固定止盈 4%
      else if (currentReturn >= 0.04) {
        exitReason = 'takeProfit';
      }
      // 超时 15天
      else if (holdDays >= backtester.maxHoldingDays) {
        exitReason = 'timeout';
      }

      if (exitReason) pendingSells.push({ code, reason: exitReason });
    }

    // 3. 每天扫描产生信号

    const idxRow = indexMap.get(date);
    // 大盘过滤：MA20 + MA60
    const idxMa20 = idxRow?.ma20;
    const idxMa60 = idxRow?.ma60;
    const marketAboveMa20 = !idxRow || !Number.isFinite(idxMa20) || idxRow.close >= idxMa20;
    const marketAboveMa60 = !idxRow || !Number.isFinite(idxMa60) || idxRow.close >= idxMa60;
    const marketOk = marketAboveMa20 || marketAboveMa60;

    if (marketOk) {
      // ═══ 混合策略：动量因子排序 + 模型信号确认 ═══
      // 动量因子是横截面策略的基石（跨股票天然可比）
      // 模型信号作为二次确认（过滤假突破）
      const candidates = [];
      const heldCodes = new Set([...backtester.positions.keys(), ...pendingBuys.map((b) => b.code)]);

      for (const [code, dataEntry] of stockDataMap) {
        if (heldCodes.has(code)) continue;
        const row = dataEntry.dateMap.get(date);
        if (!row) continue;

        // ── 因子打分（跨股票归一化可比）──
        const roc20 = row.roc20 ?? 0;       // 20日动量
        const rs20 = row.rs20 ?? 0;          // 相对强度（vs 沪深300）
        const rsi6 = row.rsi6 ?? 50;
        const ma20 = row.ma20 ?? 0;
        const ma60 = row.ma60 ?? 0;
        const adx14 = row.adx14 ?? 0;
        const bollPos = row.bollPos ?? 0.5;
        const volRatio5 = row.volRatio5 ?? 1;
        const atr14 = row.atr14 ?? 0;

        // ── 基本过滤（与V3一致，保持宽入场）──
        // 1. 价格在 MA20 之上（趋势向上）
        if (Number.isFinite(ma20) && ma20 > 0 && row.close < ma20) continue;
        // 2. RSI 不在超买区（避免追高）
        if (rsi6 > 75) continue;
        // 3. RSI 不在极度超卖区（避免接刀）
        if (rsi6 < 20) continue;

        // Regime 过滤
        const model = currentModels.get(code);
        if (model && model.regime === 'downtrend') continue;

        // 复合因子分数 = 动量 + 相对强度 + 质量
        const momentumScore = roc20 * 0.4 + rs20 * 0.3;
        const qualityScore = (bollPos > 0.3 && bollPos < 0.8 ? 0.1 : 0)
          + (adx14 > 20 ? 0.1 : 0)
          + (volRatio5 > 1.1 ? 0.1 : 0);

        // 模型信号加成（如果有模型且信号为正）
        let modelBonus = 0;
        if (model?.predictor) {
          try {
            const scores = model.predictor.scoreRows([row]);
            const score = scores[0] ?? 0;
            if (score >= model.threshold) {
              modelBonus = 0.15; // 模型确认加分
            }
          } catch { /* skip */ }
        }

        const totalScore = momentumScore + qualityScore + modelBonus;

        // 最低分数门槛：动量必须为正
        if (roc20 <= 0 && rs20 <= 0) continue;

        candidates.push({ code, score: totalScore, threshold: 0, atr: atr14 });
      }

      // 按总分降序，取 Top-N
      candidates.sort((a, b) => b.score - a.score);
      const slotsAfterSells = backtester.maxPositions - backtester.positions.size + pendingSells.length;
      const availableSlots = Math.max(0, slotsAfterSells - pendingBuys.length);
      const topN = candidates.slice(0, availableSlots);

      pendingBuys.push(...topN);
    }

    // 4. 记录净值
    let positionValue = 0;
    for (const [code, pos] of backtester.positions) {
      const row = stockDataMap.get(code)?.dateMap.get(date);
      positionValue += (row?.close ?? pos.buyPrice) * pos.shares;
    }
    backtester.equityCurve.push({
      date,
      equity: backtester.cash + positionValue,
      cash: backtester.cash,
      positionCount: backtester.positions.size,
    });

    // 进度
    if ((dayIdx + 1) % 50 === 0 || dayIdx === testDates.length - 1) {
      const eq = backtester.cash + positionValue;
      process.stdout.write(
        `      Day ${dayIdx + 1}/${testDates.length} | ${date} | `
        + `净值 ${(eq / 1_000_000).toFixed(4)} | `
        + `持仓 ${backtester.positions.size} | `
        + `交易 ${backtester.trades.length}\r`
      );
    }
  }

  // ── 生成报告 ──
  const report = backtester._buildReport();

  // 补充元信息
  report.config = {
    maxPositions,
    retrainInterval,
    trainLookback,
    stockCount: stockDataMap.size,
    testDays: testDates.length,
    testStart: testDates[0],
    testEnd: testDates[testDates.length - 1],
  };

  // 保存
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, 'rotation-report.json'),
    JSON.stringify(report, null, 2),
  );

  // ── 输出 ──
  console.log('\n\n' + '═'.repeat(70));
  console.log('  横截面轮动回测报告');
  console.log('═'.repeat(70));
  console.log(`\n  组合配置`);
  console.log(`    初始资金      : ¥${(report.initialCash / 10000).toFixed(0)} 万`);
  console.log(`    最大持仓      : ${maxPositions} 只`);
  console.log(`    模型刷新周期  : 每 ${retrainInterval} 交易日`);
  console.log(`    股票池        : ${stockDataMap.size} 只`);
  console.log(`    测试期        : ${testDates[0]} ~ ${testDates[testDates.length - 1]} (${testDates.length} 天)`);

  console.log(`\n  组合级绩效`);
  console.log(`    期末净值      : ¥${(report.finalEquity / 10000).toFixed(2)} 万`);
  console.log(`    总收益率      : ${(report.totalReturn * 100).toFixed(2)}%`);
  console.log(`    年化收益率    : ${(report.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`    年化 Sharpe   : ${report.annualizedSharpe}`);
  console.log(`    最大回撤      : ${(report.maxDrawdown * 100).toFixed(2)}%`);

  console.log(`\n  交易级绩效`);
  console.log(`    总交易笔数    : ${report.totalTrades}`);
  console.log(`    胜率          : ${(report.winRate * 100).toFixed(1)}%`);
  console.log(`    平均收益/笔   : ${(report.avgReturn * 100).toFixed(2)}%`);
  console.log(`    平均持仓天数  : ${report.avgHoldingDays}`);
  console.log(`    止损率        : ${(report.stopLossRate * 100).toFixed(1)}%`);
  console.log(`    追踪止盈率    : ${((report.trailingStopRate ?? 0) * 100).toFixed(1)}%`);
  console.log(`    盈亏比 (PF)   : ${report.profitFactor}`);

  if (report.yearlyBreakdown.length) {
    console.log(`\n  年度明细`);
    console.log('    Year   Trades   WinRate   AvgReturn');
    console.log('    ' + '-'.repeat(40));
    for (const y of report.yearlyBreakdown) {
      console.log(
        `    ${y.year}   ${String(y.trades).padStart(6)}   `
        + `${(y.winRate * 100).toFixed(1).padStart(6)}%   `
        + `${(y.avgReturn * 100).toFixed(2).padStart(8)}%`
      );
    }
  }

  console.log(`\n  报告已保存: results/portfolio/rotation-report.json`);
  console.log();

  return report;
}


// ── CLI 入口 ──
if (process.argv[1]?.endsWith('rotation-runner.mjs')) {
  const maxPositions = parseInt(process.argv[2] ?? '5', 10);
  runRotation({ maxPositions }).catch((err) => {
    log.fatal('rotation run failed', { error: err.message ?? String(err) });
    process.exitCode = 1;
  });
}
