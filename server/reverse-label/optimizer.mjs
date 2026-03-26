import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataEngine } from './data-engine.mjs';
import { SignalLabeler } from './signal-labeler.mjs';
import { ModelSelector } from './model-selector.mjs';
import { WalkForwardValidator } from './validator.mjs';
import { RegimeDetector } from './regime-detector.mjs';
import { buildRegimeGrid, getExitParams, getFeaturePool, getModelPref, REGIME_CONFIGS } from './regime-config.mjs';
import { ModelStore, checkParameterPlateau } from './model-store.mjs';
import { checkFundamental } from './fundamental-filter.mjs';

const ENV_LOCAL_PATH = resolve(process.cwd(), '.env.local');
const TUSHARE_API = 'http://api.tushare.pro';

const average = (arr) => (arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : 0);

async function fetchWithRetry(fetchFn, maxRetries = 3, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchFn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        process.stdout.write(` [retry ${attempt}/${maxRetries}]`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

const readEnvLocalToken = () => {
  if (!existsSync(ENV_LOCAL_PATH)) return '';
  const sourceText = readFileSync(ENV_LOCAL_PATH, 'utf8');
  for (const rawLine of sourceText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (key !== 'TUSHARE_TOKEN') continue;
    return line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
};

const fetchTushare = async (token, apiName, params, fields) => {
  const response = await fetch(TUSHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
  });
  if (!response.ok) {
    throw new Error(`Tushare upstream error: ${response.status}`);
  }
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.msg || 'Tushare returned a non-zero code');
  }
  return payload.data;
};

const mapRows = ({ fields, items }) => items.map((item) => fields.reduce((record, field, index) => ({ ...record, [field]: item[index] }), {}));
const formatTradeDate = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const loadStockInfo = async (token, symbol) => {
  const guesses = /^6/.test(symbol) ? [`${symbol}.SH`, `${symbol}.SZ`] : [`${symbol}.SZ`, `${symbol}.SH`];
  for (const tsCode of guesses) {
    const rows = mapRows(await fetchTushare(token, 'stock_basic', { ts_code: tsCode, list_status: 'L' }, 'ts_code,symbol,name,industry'));
    if (rows[0]) return rows[0];
  }
  const fallbackRows = mapRows(await fetchTushare(token, 'stock_basic', { symbol, list_status: 'L' }, 'ts_code,symbol,name,industry'));
  if (!fallbackRows[0]) throw new Error(`No listed stock found for symbol ${symbol}`);
  return fallbackRows[0];
};

const normalizeCandles = (rows) => rows
  .map((item) => ({
    date: formatTradeDate(item.trade_date),
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close: Number(item.close),
    volume: Math.round(Number(item.vol ?? 0)),
    pct_chg: Number(item.pct_chg ?? 0),
  }))
  .sort((left, right) => left.date.localeCompare(right.date));

const loadDailyCandles = async (token, tsCode, startDate, endDate) => {
  const rows = mapRows(await fetchTushare(token, 'daily', { ts_code: tsCode, start_date: startDate, end_date: endDate }, 'trade_date,open,high,low,close,vol,pct_chg'));
  return normalizeCandles(rows);
};

const loadIndexCandles = async (token, tsCode, startDate, endDate) => {
  const rows = mapRows(await fetchTushare(token, 'index_daily', { ts_code: tsCode, start_date: startDate, end_date: endDate }, 'trade_date,open,high,low,close,vol,pct_chg'));
  return normalizeCandles(rows);
};


// ─── 评分函数 ──────────────────────────────────────────────

function scoreResult(result) {
  if (!result) return null;
  if (result.stopLossRate >= 0.25) return null;
  if (result.totalTrades < 8) return null;
  if (!Number.isFinite(result.avgReturn)) return null;
  if ((result.winRate ?? 0) < 0.50) return null;

  // 建议5：Profit Factor 门槛 — 盈亏比 < 1.2 的策略在算上滑点后必亏
  const pf = result.profitFactor ?? 0;
  if (pf < 1.2) return null;

  // 建议5：期望值驱动评分
  // compositeScore = profitFactor × sharpe × log(1+trades)
  // 兼顾盈亏质量、风险调整收益、统计显著性
  const sharpe = Math.max(result.sharpe ?? 0, 0.01);
  const tradeSignificance = Math.log1p(result.totalTrades);
  const compositeScore = pf * sharpe * tradeSignificance;

  return {
    primary: compositeScore,
    secondary: pf,
    tertiary: result.avgReturn,
    trades: result.totalTrades,
  };
}


// ─── 单配置运行（接受 regime 参数）────────────────────────

function runOneConfig(rows, config, indexRows, regimeOptions = {}) {
  try {
    const labeler = new SignalLabeler(rows, {
      minZoneCapture: config.minZoneCapture,
      zoneForward: config.zoneForward,
      zoneBackward: config.zoneBackward,
    });
    const labeledRows = labeler.getLabeledRows();
    const buyCount = labeledRows.filter((row) => row.isBuyPoint === 1).length;
    if (buyCount < 8) return null;

    // 第二层：传入 regime featurePool 和 modelPref
    const selector = new ModelSelector(labeledRows);
    selector.run({
      featurePool: regimeOptions.featurePool ?? null,
      modelPref: regimeOptions.modelPref ?? null,
    });
    const best = selector.bestModel();
    if (!best) return null;

    // 第二层：传入 regime exitParams
    const exitParams = regimeOptions.exitParams ?? {};
    // 传入完整退出参数（建议1：按regime解耦退出风格）
    const validator = new WalkForwardValidator(labeledRows, {
      envFilter: config.envFilter,
      indexRows,
      maxHoldingDays: exitParams.maxHoldingDays,
      trailingStopMultiplier: exitParams.trailingStopMultiplier,
      takeProfitStyle: exitParams.takeProfitStyle,
      targetProfitPct: exitParams.targetProfitPct,
      bollUpperExit: exitParams.bollUpperExit,
      featurePool: regimeOptions.featurePool,
      modelPref: regimeOptions.modelPref,
      regime: regimeOptions.regime,
    });
    const result = validator.validate(best);

    return {
      bestModel: {
        featureSet: best.featureSet,
        model: best.model,
        precision: best.precision,
        recall: best.recall,
        f1: best.f1,
      },
      validation: result,
      buyCount,
    };
  } catch {
    return null;
  }
}


// ─── 信号生成 ──────────────────────────────────────────────

function generateCurrentSignal(rows, indexRows, bestConfig, bestResult, regimeOptions = {}) {
  if (!bestConfig || !bestResult) {
    return { signal: 'hold', confidence: 0, reason: '无有效配置，无法生成信号' };
  }

  try {
    const labeler = new SignalLabeler(rows, {
      minZoneCapture: bestConfig.minZoneCapture,
      zoneForward: bestConfig.zoneForward,
      zoneBackward: bestConfig.zoneBackward,
    });
    const labeledRows = labeler.getLabeledRows();

    const selector = new ModelSelector(labeledRows);
    selector.run({
      featurePool: regimeOptions.featurePool ?? null,
      modelPref: regimeOptions.modelPref ?? null,
    });
    const best = selector.bestModel();
    if (!best?.predictor) {
      return { signal: 'hold', confidence: 0, reason: '模型训练失败' };
    }

    const latest = labeledRows[labeledRows.length - 1];
    if (!latest) {
      return { signal: 'hold', confidence: 0, reason: '缺少最新K线' };
    }

    const scores = best.predictor.scoreRows([latest]);
    const score = scores[0] ?? 0;
    const threshold = best.predictor.threshold ?? 0;
    const confidence = threshold > 0 ? Math.min(1, Math.max(0, score / threshold)) : 0;

    const isBuyZone = latest.isBuyPoint === 1;
    const isSellZone = latest.isSellPoint === 1;
    const scoreAbove = score >= threshold;

    let signal = 'hold';
    const reasons = [];

    if (isSellZone) {
      signal = 'sell';
      reasons.push('当前K线处于历史卖点区间');
    } else if (isBuyZone && scoreAbove && confidence >= 0.5) {
      signal = 'buy';
      reasons.push(`模型打分 ${score.toFixed(3)} 超过阈值 ${threshold.toFixed(3)}`);
      reasons.push('处于历史高质量买点区间');
    } else if (scoreAbove && confidence >= 0.5) {
      signal = 'buy';
      reasons.push(`模型打分 ${score.toFixed(3)} 超过阈值 ${threshold.toFixed(3)}`);
    } else {
      reasons.push(`模型打分 ${score.toFixed(3)} 未超过阈值 ${threshold.toFixed(3)}`);
      if (isBuyZone) reasons.push('虽在买点区间，但置信度不足');
    }

    if (indexRows && indexRows.length) {
      const latestIdx = indexRows[indexRows.length - 1];
      const idxMa20 = latestIdx?.ma20 ?? null;
      if (Number.isFinite(idxMa20) && latestIdx.close < idxMa20) {
        reasons.push('当前大盘在 MA20 下方，信号仅供参考');
        if (signal === 'buy') signal = 'hold';
      }
    }

    return {
      signal,
      confidence: Number(confidence.toFixed(3)),
      score: Number(score.toFixed(3)),
      threshold: Number(threshold.toFixed(3)),
      reason: reasons.join('；'),
      date: latest.date,
      close: latest.close,
      isBuyZone,
      isSellZone,
    };
  } catch (error) {
    return { signal: 'hold', confidence: 0, reason: `信号生成失败：${error.message}` };
  }
}


// ─── 核心优化入口（v2.0 三层架构）──────────────────────────

export async function optimize(stockCode, startDate, endDate) {
  const startTime = Date.now();
  const token = readEnvLocalToken() || process.env.TUSHARE_TOKEN || '';
  if (!token) {
    throw new Error('Missing TUSHARE_TOKEN environment variable');
  }

  // ──── [1/5] 加载数据 ────
  console.log(`\n[1/5] 加载数据 ${stockCode} ...`);
  const stock = await fetchWithRetry(() => loadStockInfo(token, stockCode));
  const candles = await fetchWithRetry(() => loadDailyCandles(token, stock.ts_code, startDate, endDate));

  // 建议3：先加载指数数据，再传给股票DataEngine计算RS因子
  let indexRows = null;
  try {
    const indexCandles = await fetchWithRetry(() => loadIndexCandles(token, '000300.SH', startDate, endDate));
    indexRows = new DataEngine(indexCandles).computeAllFeatures();
    console.log(`      指数数据：${indexRows.length} 行`);
  } catch (error) {
    console.warn(`      指数数据拉取失败，大盘过滤将跳过：${error.message}`);
    indexRows = null;
  }

  const rows = new DataEngine(candles).computeAllFeatures(indexRows);
  console.log(`      ${rows.length} 根K线已加载（含RS因子）`);

  // ──── 方向6：基本面过滤 ────
  let fundamental = { qualified: true, scores: {}, warnings: [] };
  try {
    fundamental = await checkFundamental(token, stock.ts_code);
    if (fundamental.qualified) {
      console.log(`      基本面：合格`);
    } else {
      console.log(`      基本面：警告 — ${fundamental.warnings.join('; ')}`);
    }
  } catch (error) {
    console.warn(`      基本面检查失败：${error.message}`);
  }

  // ──── [2/5] 第一层：Regime Detection ────
  const detector = new RegimeDetector();
  const regimeResult = detector.detect(rows);
  const regime = regimeResult.regime;
  const regimeConf = regimeResult.confidence;
  const regimeHistory = detector.detectHistory(rows);
  console.log(`[2/5] Regime 识别：${regime}（置信度 ${regimeConf}）`);
  if (regimeConf < 1) {
    console.log(`      近期状态序列：${regimeResult.raw.join(' → ')}`);
  }

  // ──── [3/5] 第二层：Regime 驱动的缩窄扫描 ────
  const regimeConfig = REGIME_CONFIGS[regime] ?? REGIME_CONFIGS.range;
  const grid = buildRegimeGrid(regime);
  const featurePool = getFeaturePool(regime);
  const modelPref = getModelPref(regime);
  const exitParams = getExitParams(regime);

  console.log(`[3/5] ${regimeConfig.label} 模式 → 扫描 ${grid.length} 组配置（特征池 ${featurePool.length} 个）`);

  // 扫描函数（可复用于 fallback）
  const runScan = (scanGrid, regimeOpts, label) => {
    const results = [];
    let scanDone = 0;
    for (const config of scanGrid) {
      const run = runOneConfig(rows, config, indexRows, regimeOpts);
      const result = run?.validation ?? null;
      const score = scoreResult(result);

      scanDone += 1;
      if (scanDone % 10 === 0 || scanDone === scanGrid.length) {
        process.stdout.write(`      ${label} 进度：${scanDone}/${scanGrid.length}\r`);
      }

      if (score === null) continue;

      results.push({
        config,
        result,
        score,
        bestModel: run.bestModel,
        buyCount: run.buyCount,
      });
    }
    return results;
  };

  let scanResults = runScan(grid, { featurePool, modelPref, exitParams, regime }, 'regime');
  console.log(`\n      Regime 扫描完成，有效配置：${scanResults.length}/${grid.length}`);

  // Fallback：regime 网格无有效结果 → 回退到全量网格（不限特征池，不限模型偏好）
  let usedFallback = false;
  if (scanResults.length === 0) {
    console.log(`      Regime 扫描无有效结果，启动 Fallback 全量扫描...`);
    const FALLBACK_GRID = [];
    for (const minZoneCapture of [0.5, 0.6, 0.7, 0.8])
      for (const zoneForward of [3, 5, 10, 15])
        for (const zoneBackward of [2, 3, 5])
          for (const envFilter of ['none', 'ma20', 'ma20_0.98', 'ma60_rising'])
            FALLBACK_GRID.push({ minZoneCapture, zoneForward, zoneBackward, envFilter });

    scanResults = runScan(FALLBACK_GRID, { exitParams }, 'fallback');
    usedFallback = true;
    console.log(`\n      Fallback 扫描完成，有效配置：${scanResults.length}/${FALLBACK_GRID.length}`);
  }

  scanResults.sort((left, right) => {
    if (right.score.primary !== left.score.primary) return right.score.primary - left.score.primary;
    if (right.score.secondary !== left.score.secondary) return right.score.secondary - left.score.secondary;
    return right.score.tertiary - left.score.tertiary;
  });

  // ──── [4/5] 第三层：参数高原检验 ────
  const bestEntry = scanResults[0] ?? null;
  let plateau = { passed: false, bestScore: 0, neighborAvg: 0, neighborCount: 0 };
  let effectiveBest = bestEntry;

  if (bestEntry) {
    plateau = checkParameterPlateau(bestEntry.config, scanResults);
    console.log(`[4/5] 参数高原检验：${plateau.passed ? '通过' : '未通过'}`
      + ` (邻域比 ${plateau.ratio ?? 0}, 邻域数 ${plateau.neighborCount}${plateau.hasDisaster ? ', 存在邻域灾难' : ''})`);

    if (!plateau.passed && scanResults.length > 1) {
      // 尖峰作废，尝试第二名
      for (let idx = 1; idx < scanResults.length; idx += 1) {
        const fallbackPlateau = checkParameterPlateau(scanResults[idx].config, scanResults);
        if (fallbackPlateau.passed) {
          effectiveBest = scanResults[idx];
          plateau = fallbackPlateau;
          console.log(`      尖峰作废，回退到第 ${idx + 1} 名配置（高原通过）`);
          break;
        }
      }
    }
  }

  const leaderboard = scanResults.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    config: item.config,
    bestModel: item.bestModel,
    result: {
      stopLossRate: item.result.stopLossRate,
      avgReturn: item.result.avgReturn,
      totalTrades: item.result.totalTrades,
      winRate: item.result.winRate,
      maxDrawdown: item.result.maxDrawdown,
      sharpe: item.result.sharpe,
      skippedByEnvironment: item.result.skippedByEnvironment,
      skippedByMarket: item.result.skippedByMarket,
      avgStopLossPct: item.result.avgStopLossPct,
      buyCount: item.buyCount,
      trades: item.result.trades,
    },
  }));

  const summary = {
    stockCode,
    stockName: stock.name,
    regime,
    regimeConfidence: regimeConf,
    regimeHistory,
    bestConfig: effectiveBest?.config ?? null,
    bestResult: effectiveBest ? {
      stopLossRate: effectiveBest.result.stopLossRate,
      avgReturn: effectiveBest.result.avgReturn,
      totalTrades: effectiveBest.result.totalTrades,
      winRate: effectiveBest.result.winRate,
      maxDrawdown: effectiveBest.result.maxDrawdown,
      sharpe: effectiveBest.result.sharpe,
      skippedByEnvironment: effectiveBest.result.skippedByEnvironment,
      skippedByMarket: effectiveBest.result.skippedByMarket,
      avgStopLossPct: effectiveBest.result.avgStopLossPct,
      buyCount: effectiveBest.buyCount,
      trades: effectiveBest.result.trades,
    } : null,
    bestModel: effectiveBest?.bestModel ?? null,
    plateau: {
      passed: plateau.passed,
      ratio: plateau.ratio ?? 0,
      neighborCount: plateau.neighborCount,
    },
    leaderboard,
    usedFallback,
    stats: {
      totalCombinations: usedFallback ? 192 : grid.length,
      validCombinations: scanResults.length,
      scanDurationMs: Date.now() - startTime,
    },
  };

  // ──── [5/5] 第三层：ModelStore 持久化 + 替换阈值熔断 ────
  const store = new ModelStore();
  const newRecord = {
    regime,
    config: summary.bestConfig,
    metrics: summary.bestResult ? {
      sharpe: summary.bestResult.sharpe ?? 0,
      avgReturn: summary.bestResult.avgReturn,
      winRate: summary.bestResult.winRate,
      stopLossRate: summary.bestResult.stopLossRate,
      maxDrawdown: summary.bestResult.maxDrawdown,
    } : null,
    featureSet: summary.bestModel?.featureSet ?? null,
    model: summary.bestModel?.model ?? null,
    plateau: summary.plateau,
  };

  if (summary.bestConfig) {
    const storeResult = store.saveWithCheck(stockCode, newRecord);
    summary.modelStore = {
      action: storeResult.action,
      reason: storeResult.reason,
      version: storeResult.record?.version ?? 0,
    };
    console.log(`[5/5] 模型存储：${storeResult.action} — ${storeResult.reason}`);

    // 如果被熔断拒绝，用旧模型的配置覆盖
    if (!storeResult.saved && storeResult.record?.config) {
      console.log(`      熔断生效：沿用旧模型 v${storeResult.record.version}`);
      summary.bestConfig = storeResult.record.config;
      summary.modelStore.fallbackToVersion = storeResult.record.version;
    }
  } else {
    summary.modelStore = { action: 'skip', reason: '无有效配置', version: 0 };
    console.log(`[5/5] 模型存储：跳过（无有效配置）`);
  }

  summary.fundamental = fundamental;
  summary.currentSignal = generateCurrentSignal(rows, indexRows, summary.bestConfig, summary.bestResult, { featurePool, modelPref });

  // 建议4：基本面过滤与 regime 联动
  // downtrend 抄底：严格执行基本面过滤（垃圾股无底）
  // breakout 突破：放宽基本面（资金已用脚投票）
  // 其他：正常执行
  if (!fundamental.qualified && summary.currentSignal.signal === 'buy') {
    if (regime === 'breakout') {
      // 突破状态：仅警告，不降级
      summary.currentSignal.reason += '；基本面弱势但处于突破状态，保留信号';
    } else {
      summary.currentSignal.signal = 'hold';
      summary.currentSignal.reason += '；基本面不合格，信号降级为hold';
    }
  }

  return summary;
}


// ─── CLI 入口 ──────────────────────────────────────────────

const [, , stockCode = '600519', startDate = '20220101', endDate = '20260322'] = process.argv;

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('optimizer.mjs')) {
  optimize(stockCode, startDate, endDate)
    .then((summary) => {
      console.log('\n' + '='.repeat(70));
      console.log(`  扫描报告 · ${summary.stockCode} · ${summary.regime}（置信度 ${summary.regimeConfidence}）`);
      console.log('='.repeat(70));

      if (!summary.bestConfig) {
        console.log('\n  没有找到任何满足条件的配置');
        console.log('  建议：放宽 stopLossRate 或 totalTrades 下限');
        return;
      }

      console.log('\n  最优配置');
      console.log(`    minZoneCapture : ${summary.bestConfig.minZoneCapture}`);
      console.log(`    zoneForward    : ${summary.bestConfig.zoneForward}`);
      console.log(`    zoneBackward   : ${summary.bestConfig.zoneBackward}`);
      console.log(`    envFilter      : ${summary.bestConfig.envFilter}`);

      console.log('\n  最优结果');
      console.log(`    avgReturn      : ${(summary.bestResult.avgReturn * 100).toFixed(2)}%`);
      console.log(`    stopLossRate   : ${(summary.bestResult.stopLossRate * 100).toFixed(1)}%`);
      console.log(`    winRate        : ${(summary.bestResult.winRate * 100).toFixed(1)}%`);
      console.log(`    totalTrades    : ${summary.bestResult.totalTrades}`);
      console.log(`    maxDrawdown    : ${(summary.bestResult.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`    sharpe         : ${summary.bestResult.sharpe ?? 'N/A'}`);

      console.log('\n  参数高原');
      console.log(`    通过           : ${summary.plateau.passed}`);
      console.log(`    邻域比         : ${summary.plateau.ratio}`);
      console.log(`    邻域数         : ${summary.plateau.neighborCount}`);

      console.log('\n  模型存储');
      console.log(`    操作           : ${summary.modelStore.action}`);
      console.log(`    原因           : ${summary.modelStore.reason}`);
      console.log(`    版本           : v${summary.modelStore.version}`);

      console.log('\n  Current Signal');
      console.log(`    signal         : ${summary.currentSignal.signal}`);
      console.log(`    confidence     : ${summary.currentSignal.confidence}`);
      console.log(`    score          : ${summary.currentSignal.score ?? 0}`);
      console.log(`    threshold      : ${summary.currentSignal.threshold ?? 0}`);
      console.log(`    date           : ${summary.currentSignal.date ?? '-'}`);
      console.log(`    reason         : ${summary.currentSignal.reason}`);

      console.log('\n  前 5 名排行');
      console.log('  rank  capture  fwd  bwd  envFilter                 return   stopLoss  trades');
      console.log('  ' + '-'.repeat(82));
      summary.leaderboard.slice(0, 5).forEach((item) => {
        const c = item.config;
        const r = item.result;
        console.log(
          `  #${String(item.rank).padEnd(4)}`
          + `${String(c.minZoneCapture).padEnd(9)}`
          + `${String(c.zoneForward).padEnd(5)}`
          + `${String(c.zoneBackward).padEnd(5)}`
          + `${c.envFilter.padEnd(26)}`
          + `${(r.avgReturn * 100).toFixed(2).padStart(7)}%  `
          + `${(r.stopLossRate * 100).toFixed(1).padStart(7)}%  `
          + `${String(r.totalTrades).padStart(6)}`
        );
      });

      console.log('\n  Regime 历史');
      const hist = summary.regimeHistory ?? [];
      const histStr = hist.slice(-6).map((h) => `${h.date.slice(5)}:${h.regime}`).join(' → ');
      console.log(`    ${histStr || '无'}`);

      console.log('\n  扫描统计');
      console.log(`    总组合数  : ${summary.stats.totalCombinations}`);
      console.log(`    有效组合  : ${summary.stats.validCombinations}`);
      console.log(`    耗时      : ${summary.stats.scanDurationMs}ms`);
      console.log();
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
