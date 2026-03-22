import test from 'node:test';
import assert from 'node:assert/strict';
import { DataEngine } from '../server/reverse-label/data-engine.mjs';
import { SignalLabeler } from '../server/reverse-label/signal-labeler.mjs';
import { ModelSelector } from '../server/reverse-label/model-selector.mjs';
import { WalkForwardValidator } from '../server/reverse-label/validator.mjs';

const buildSyntheticRows = () => {
  const rows = [];
  let price = 100;
  for (let index = 0; index < 320; index += 1) {
    const seasonal = Math.sin(index / 10) * 2.5;
    const drift = index % 40 < 20 ? 0.9 : -0.4;
    price = Math.max(20, price + drift + seasonal * 0.15);
    rows.push({
      date: `2024-${String(Math.floor(index / 22) + 1).padStart(2, '0')}-${String((index % 22) + 1).padStart(2, '0')}`,
      open: Number((price - 0.8).toFixed(2)),
      high: Number((price + 1.2).toFixed(2)),
      low: Number((price - 1.4).toFixed(2)),
      close: Number(price.toFixed(2)),
      volume: 100000 + (index % 15) * 7000,
    });
  }
  return rows;
};

test('reverse-label pipeline primitives produce labeled rows and validation output', () => {
  const engine = new DataEngine(buildSyntheticRows());
  const featured = engine.computeAllFeatures();
  assert.ok(featured.length > 200);

  const labeler = new SignalLabeler(featured, { forwardDays: 15, minReturn: 0.04, maxDrawdown: 0.06 });
  const labeled = labeler.getLabeledRows();
  assert.ok(labeled.some((row) => row.isBuyPoint === 1));

  const selector = new ModelSelector(labeled);
  const ranked = selector.run();
  assert.ok(ranked.length > 0);
  assert.ok(selector.bestModel());

  const validator = new WalkForwardValidator(labeled, { forwardDays: 15, takeProfit: 0.04, stopLoss: 0.04, trainSize: 120, testSize: 40 });
  const result = validator.validate(selector.bestModel());
  assert.ok('totalTrades' in result);
  assert.ok(Array.isArray(result.windowStats));
});
