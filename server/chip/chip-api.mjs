/**
 * 筹码分布 API 路由 (Chip Distribution API Router)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 挂载到主 Express 应用：
 *   import { chipRouter } from './chip/chip-api.mjs';
 *   app.use('/api/chip', chipRouter);
 *
 * 端点列表：
 *   GET /api/chip/:code                   — 单日筹码分布（默认 lookback=120）
 *   GET /api/chip/:code/multi             — 三窗口筹码分布（60/120/250）
 *   GET /api/chip/:code/features          — 筹码特征向量
 *   GET /api/chip/:code/series            — 筹码特征时间序列（供图表展示趋势）
 *
 * 参数：
 *   code      : 股票代码，如 300059 或 300059.SZ（支持无后缀自动推断）
 *   date      : query, YYYYMMDD，默认最新交易日
 *   lookback  : query, 正整数，默认 120
 *   buckets   : query, 正整数，默认 200
 */

import express from 'express';
import { createLogger } from '../logger.mjs';
import { computeChipDistribution, computeChipMultiWindow } from './chip-engine.mjs';
import { extractChipFeatures, extractMultiWindowFeatures } from './chip-features.mjs';
import { readDaily } from '../data/csv-manager.mjs';

const log = createLogger('chip-api');

// ─────────────────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────────────────

/** 6位纯数字代码 → ts_code（300xxx → .SZ，6xxx → .SH） */
function toTsCode(raw) {
  if (!raw) return '';
  const code = String(raw).trim().toUpperCase();
  if (code.includes('.')) return code;
  return /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

/** 从已缓存 K 线找最新可用日期 */
function latestAvailableDate(tsCode) {
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const startLookup = shiftDate(today, -30);
    const rows = readDaily(tsCode, startLookup, today);
    return rows.length > 0 ? rows[rows.length - 1].trade_date : today;
  } catch {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }
}

function shiftDate(yyyymmdd, days) {
  const d = new Date(`${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`);
  d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('');
}

function parsePositiveInt(val, defaultVal) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const chipRouter = express.Router();

// ── GET /api/chip/:code ──────────────────────────────────────────────────────
// 返回单日筹码分布（含 distribution 数组，可直接用于前端绘图）

chipRouter.get('/:code', (req, res) => {
  const tsCode   = toTsCode(req.params.code);
  const date     = req.query.date ?? latestAvailableDate(tsCode);
  const lookback = parsePositiveInt(req.query.lookback, 120);
  const nBuckets = parsePositiveInt(req.query.buckets, 200);

  if (!tsCode) return res.status(400).json({ ok: false, error: 'Invalid code' });
  if (!/^\d{8}$/.test(date)) return res.status(400).json({ ok: false, error: 'date must be YYYYMMDD' });

  log.debug('GET chip', { tsCode, date, lookback });

  try {
    const result = computeChipDistribution(tsCode, date, { lookback, nBuckets });
    if (!result) {
      return res.status(404).json({
        ok: false,
        error: '数据不足或 K 线未缓存，请先调用 /api/market/kline/:code 拉取数据',
      });
    }

    // 前端直接可用格式
    res.json({
      ok: true,
      data: {
        tsCode:       result.tsCode,
        date:         result.date,
        lookback:     result.lookback,
        gridMin:      result.gridMin,
        gridMax:      result.gridMax,
        dp:           result.dp,
        nBuckets:     result.nBuckets,
        distribution: result.distribution,    // number[], length=nBuckets
        avgCost:      result.avgCost,
        profitRatio:  result.profitRatio,
        currentPrice: result.currentPrice,
        peaks:        result.peaks,
        band70:       result.band70,
        band90:       result.band90,
        cyqMaturity:  result.cyqMaturity,
        windowDays:   result.windowDays,
        atr14:        result.atr14,
      },
    });
  } catch (err) {
    log.error('chip 计算失败', { tsCode, date, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/chip/:code/multi ─────────────────────────────────────────────────
// 返回 60/120/250 三窗口筹码分布摘要（不含 distribution 数组，减小响应体积）

chipRouter.get('/:code/multi', (req, res) => {
  const tsCode   = toTsCode(req.params.code);
  const date     = req.query.date ?? latestAvailableDate(tsCode);
  const nBuckets = parsePositiveInt(req.query.buckets, 200);

  if (!tsCode) return res.status(400).json({ ok: false, error: 'Invalid code' });
  if (!/^\d{8}$/.test(date)) return res.status(400).json({ ok: false, error: 'date must be YYYYMMDD' });

  log.debug('GET chip/multi', { tsCode, date });

  try {
    const multi = computeChipMultiWindow(tsCode, date, { nBuckets });
    const summary = {};
    for (const [key, r] of Object.entries(multi)) {
      if (!r) { summary[key] = null; continue; }
      summary[key] = {
        date:         r.date,
        lookback:     r.lookback,
        avgCost:      r.avgCost,
        profitRatio:  r.profitRatio,
        currentPrice: r.currentPrice,
        peaks:        r.peaks,
        band70:       r.band70,
        band90:       r.band90,
        cyqMaturity:  r.cyqMaturity,
        // 为主窗口（cyq_120）附带完整分布数组，供主图展示
        distribution: key === 'cyq_120' ? r.distribution : undefined,
        gridMin:      key === 'cyq_120' ? r.gridMin : undefined,
        gridMax:      key === 'cyq_120' ? r.gridMax : undefined,
        dp:           key === 'cyq_120' ? r.dp : undefined,
        nBuckets:     key === 'cyq_120' ? r.nBuckets : undefined,
      };
    }
    res.json({ ok: true, tsCode, date, data: summary });
  } catch (err) {
    log.error('chip/multi 计算失败', { tsCode, date, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/chip/:code/features ──────────────────────────────────────────────
// 返回单日筹码特征向量（15 个特征）

chipRouter.get('/:code/features', (req, res) => {
  const tsCode   = toTsCode(req.params.code);
  const date     = req.query.date ?? latestAvailableDate(tsCode);
  const lookback = parsePositiveInt(req.query.lookback, 120);

  if (!tsCode) return res.status(400).json({ ok: false, error: 'Invalid code' });
  if (!/^\d{8}$/.test(date)) return res.status(400).json({ ok: false, error: 'date must be YYYYMMDD' });

  try {
    const curr = computeChipDistribution(tsCode, date, { lookback });
    if (!curr) return res.status(404).json({ ok: false, error: '数据不足' });

    // 获取 5 日前分布（用于时序特征）
    const prevDate = shiftDate(date, -7);   // 日历 7 天 ≈ 5 交易日
    const prev     = computeChipDistribution(tsCode, prevDate, { lookback });

    const features = extractChipFeatures(curr, prev);
    res.json({ ok: true, data: features });
  } catch (err) {
    log.error('chip/features 失败', { tsCode, date, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/chip/:code/series ────────────────────────────────────────────────
// 返回某段时间内的筹码特征时间序列（每隔 step 个交易日取一个点）
// 用于前端展示 profitRatio / avgCost 随时间的变化趋势

chipRouter.get('/:code/series', (req, res) => {
  const tsCode   = toTsCode(req.params.code);
  const endDate  = req.query.date ?? latestAvailableDate(tsCode);
  const lookback = parsePositiveInt(req.query.lookback, 120);
  const days     = parsePositiveInt(req.query.days, 60);      // 要覆盖的交易日数
  const step     = parsePositiveInt(req.query.step, 5);       // 每隔多少天取一个点

  if (!tsCode) return res.status(400).json({ ok: false, error: 'Invalid code' });

  log.debug('GET chip/series', { tsCode, endDate, days, step });

  try {
    // 读取 K 线，取足够长的日期列表
    const fetchStart = shiftDate(endDate, -(lookback + days) * 2);
    const klineRows  = readDaily(tsCode, fetchStart, endDate);
    if (klineRows.length < 10) {
      return res.status(404).json({ ok: false, error: '数据不足' });
    }

    // 取最近 days 个交易日的日期，每 step 个取一次
    const tradeDates = klineRows.map((r) => r.trade_date);
    const sampleDates = [];
    for (let i = tradeDates.length - 1; i >= 0 && sampleDates.length < Math.ceil(days / step); i -= step) {
      sampleDates.unshift(tradeDates[i]);
    }

    const series = [];
    for (const d of sampleDates) {
      try {
        const result   = computeChipDistribution(tsCode, d, { lookback });
        if (!result) continue;
        series.push({
          date:         result.date,
          avgCost:      result.avgCost,
          profitRatio:  result.profitRatio,
          currentPrice: result.currentPrice,
          peakCount:    result.peaks.length,
          dominantPeak: result.peaks[0]?.price ?? null,
          band70Width:  result.band70 ? result.band70.high - result.band70.low : null,
          cyqMaturity:  result.cyqMaturity,
        });
      } catch { /* 跳过单点错误 */ }
    }

    res.json({ ok: true, tsCode, lookback, data: series });
  } catch (err) {
    log.error('chip/series 失败', { tsCode, endDate, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});
