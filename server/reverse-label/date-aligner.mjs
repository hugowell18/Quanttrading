/**
 * 日期对齐器 — 将 N 只股票的一维时间序列组装为二维日期×股票快照
 *
 * 输出结构：
 *   Map<date, Map<stockCode, { features, score, regime, ... }>>
 *
 * 用途：
 *   PortfolioBacktester 在每个交易日横截面扫描所有股票并排序
 */

import { DataEngine } from './data-engine.mjs';
import { SignalLabeler } from './signal-labeler.mjs';
import { ModelSelector } from './model-selector.mjs';
import { RegimeDetector } from './regime-detector.mjs';
import { loadCachedStock, loadCachedIndex } from './stock-data-cache.mjs';
import { STOCK_UNIVERSE } from './stock-universe.mjs';

/**
 * 加载所有股票并计算特征 + 标签
 * @returns {{ stockDataMap: Map<code, rows[]>, indexRows: rows[], tradeDates: string[] }}
 */
export function buildAlignedUniverse(stockCodes = null) {
  const codes = stockCodes ?? STOCK_UNIVERSE.map((s) => s.code);

  // 1. 加载指数
  const indexCandles = loadCachedIndex('000300.SH');
  let indexRows = null;
  if (indexCandles && indexCandles.length) {
    indexRows = new DataEngine(indexCandles).computeAllFeatures();
  }

  // 2. 加载每只股票
  const stockDataMap = new Map();
  const allDatesSet = new Set();
  const stockMeta = new Map();

  for (const code of codes) {
    const candles = loadCachedStock(code);
    if (!candles || candles.length < 200) {
      console.log(`  [Align] ${code}: 数据不足 (${candles?.length ?? 0} 行), 跳过`);
      continue;
    }

    try {
      const rows = new DataEngine(candles).computeAllFeatures(indexRows);
      const meta = STOCK_UNIVERSE.find((s) => s.code === code);
      stockMeta.set(code, meta ?? { code, name: code, sector: '未知' });

      // 构建 date→row 索引
      const dateMap = new Map();
      for (const row of rows) {
        dateMap.set(row.date, row);
        allDatesSet.add(row.date);
      }
      stockDataMap.set(code, { rows, dateMap });
    } catch (err) {
      console.log(`  [Align] ${code}: 特征计算失败 (${err.message}), 跳过`);
    }
  }

  // 3. 对齐日期 — 所有交易日按升序排列
  const tradeDates = [...allDatesSet].sort();

  console.log(`[Align] ${stockDataMap.size} 只股票对齐完成, 交易日 ${tradeDates.length} 天`);

  return { stockDataMap, indexRows, tradeDates, stockMeta };
}

/**
 * 构建每日快照 — 横截面数据
 * @param {string} date
 * @param {Map} stockDataMap
 * @returns {Map<code, row>}
 */
export function getDailySnapshot(date, stockDataMap) {
  const snapshot = new Map();
  for (const [code, { dateMap }] of stockDataMap) {
    const row = dateMap.get(date);
    if (row) snapshot.set(code, row);
  }
  return snapshot;
}

/**
 * 为每只股票训练模型（使用截止到 trainEndDate 的数据）
 * 返回每只股票的 predictor + threshold
 */
export function trainPerStockModels(stockDataMap, trainEndDate, options = {}) {
  const models = new Map();
  const minTrainRows = options.minTrainRows ?? 200;

  for (const [code, { rows }] of stockDataMap) {
    // 只用 trainEndDate 之前的数据训练
    const trainRows = rows.filter((r) => r.date <= trainEndDate);
    if (trainRows.length < minTrainRows) continue;

    try {
      // 检测 regime — downtrend 直接跳过，不浪费训练资源
      const detector = new RegimeDetector();
      const regimeResult = detector.detect(trainRows);
      const regime = regimeResult.regime;

      const labeler = new SignalLabeler(trainRows, {
        minZoneCapture: options.minZoneCapture ?? 0.5,
        zoneForward: options.zoneForward ?? 3,
        zoneBackward: options.zoneBackward ?? 2,
      });
      const labeledRows = labeler.getLabeledRows();
      const buyCount = labeledRows.filter((r) => r.isBuyPoint === 1).length;
      if (buyCount < 8) continue; // 提高标签最低数量要求

      const selector = new ModelSelector(labeledRows);
      selector.run();
      const best = selector.bestModel();
      if (!best?.predictor) continue;

      // 训练集内质量过滤：precision 太低的模型不用
      if (best.precision < 0.4) continue;

      models.set(code, {
        predictor: best.predictor,
        threshold: best.predictor.threshold ?? 0,
        featureSet: best.featureSet,
        modelName: best.model,
        precision: best.precision,
        regime,
        buyCount,
      });
    } catch {
      // skip
    }
  }

  return models;
}
