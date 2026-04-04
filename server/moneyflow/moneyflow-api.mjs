/**
 * GET /api/vmf/:code
 * 返回 VMF 背离得分数据（基于 Tushare moneyflow 真实大单数据）
 *
 * Query params:
 *   start_date  YYYYMMDD  起始日期（可选）
 *   end_date    YYYYMMDD  截止日期（可选，默认今日）
 */

import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '../logger.mjs';
import { ensureMoneyflow } from './moneyflow-fetcher.mjs';
import { calculateDivergenceScores } from './moneyflow-calculator.mjs';

const log      = createLogger('vmf-api');
const KLINE_DIR = resolve(process.cwd(), 'cache', 'kline');

export const vmfRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function toTsCode(raw) {
  const code = raw.trim().replace(/\.(SH|SZ)$/i, '').slice(0, 6);
  return /^6/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

function readKline(tsCode) {
  const fp = resolve(KLINE_DIR, `${tsCode}.csv`);
  if (!existsSync(fp)) return [];
  const [, ...lines] = readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  return lines.filter(Boolean).map(line => {
    const p = line.split(',');
    const d = p[0]; // YYYYMMDD
    return {
      date:   `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      open:   Number(p[1]),
      high:   Number(p[2]),
      low:    Number(p[3]),
      close:  Number(p[4]),
      volume: Number(p[6]),
    };
  });
}

// ─── route ──────────────────────────────────────────────────────────────────

vmfRouter.get('/:code', async (req, res) => {
  try {
    const tsCode     = toTsCode(req.params.code);
    const { start_date, end_date } = req.query;
    const endCompact = end_date || new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // 1. Load full kline (need history for 60-day window even if filtering output)
    const klineData = readKline(tsCode);
    if (!klineData.length) {
      return res.status(404).json({ ok: false, error: '无K线数据' });
    }

    // 2. Ensure moneyflow CSV up-to-date
    const mfData = await ensureMoneyflow(tsCode, endCompact);

    // 3. Calculate divergence scores (full history, rolling window)
    const allScores = calculateDivergenceScores(klineData, mfData);

    // 4. Filter to requested date range
    const startComp = start_date || '00000000';
    const filtered  = allScores.filter(d => d.date >= startComp && d.date <= endCompact);

    log.info(`${tsCode} VMF served`, { records: filtered.length });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, data: filtered });

  } catch (err) {
    log.error('VMF error', { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});
