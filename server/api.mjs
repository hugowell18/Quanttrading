import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { optimize } from './reverse-label/optimizer.mjs';

const app = express();
const PORT = 3001;
const SUMMARY_PATH = resolve(process.cwd(), 'results', 'batch', 'summary.json');

app.use(cors());
app.use(express.json());

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/batch/summary', (_req, res) => {
  if (!existsSync(SUMMARY_PATH)) {
    return res.status(404).json({ error: '批量结果不存在，请先运行 batch-runner。' });
  }

  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
  return res.json(summary);
});

app.get('/api/analyze/:code', async (req, res) => {
  const { code } = req.params;
  const { start, end } = req.query;
  const startDate = typeof start === 'string' && start ? start : '20220101';
  const endDate = typeof end === 'string' && end ? end : new Date().toISOString().slice(0, 10).replace(/-/g, '');

  try {
    console.log(`[analyze] ${code} ${startDate}~${endDate}`);
    const result = await optimize(code, startDate, endDate);
    return res.json(result);
  } catch (error) {
    console.error(`[analyze] ${code} failed: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('\nQuantPulse API started');
  console.log(`  http://localhost:${PORT}/api/status`);
  console.log(`  http://localhost:${PORT}/api/batch/summary`);
  console.log(`  http://localhost:${PORT}/api/analyze/600519`);
});
