import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CACHE_DIR = resolve(process.cwd(), 'cache', 'research');
const COST_PCT = 0;
const TARGET_PCT = 0.03;

const CASES = [
  {
    name: 'AI算力',
    boardType: 'concept',
    boardCode: 'BK1136',
    boardName: '光通信模块',
    windowStart: '20240920',
    windowEnd: '20240930',
  },
  {
    name: 'ChatGPT',
    boardType: 'industry',
    boardCode: '801750',
    boardName: '计算机',
    windowStart: '20230130',
    windowEnd: '20230210',
  },
  {
    name: '低空经济',
    boardType: 'concept',
    boardCode: 'BK1166',
    boardName: '低空经济',
    windowStart: '20240319',
    windowEnd: '20240329',
  },
];

const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const fmt = (value) => value == null ? '-' : `${value.toFixed(2)}`;

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  const text = readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function loadBoardRows(boardType, boardCode) {
  if (boardType === 'industry') {
    const rows = readCsv(resolve(CACHE_DIR, `sw_daily_${boardCode}_2018_now.csv`))
      .map((row) => ({ trade_date: row.trade_date, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), vol: Number(row.vol) }))
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    return enrichBoardRows(rows);
  }
  const filePath = resolve(CACHE_DIR, `concept_hist_${boardCode}_20180101_20260328.json`);
  const json = JSON.parse(readFileSync(filePath, 'utf8'));
  const rows = (json?.data?.klines || []).map((line) => {
    const [tradeDate, open, close, high, low, vol] = line.split(',');
    return { trade_date: tradeDate.replace(/-/g, ''), open: Number(open), high: Number(high), low: Number(low), close: Number(close), vol: Number(vol) };
  });
  return enrichBoardRows(rows);
}

function enrichBoardRows(rows) {
  const closes = [];
  const vols = [];
  let prevClose = 0;
  return rows.map((row) => {
    closes.push(row.close);
    vols.push(row.vol);
    const ma20 = closes.length >= 20 ? avg(closes.slice(-20)) : 0;
    const avgVol20 = vols.length > 1 ? avg(vols.slice(Math.max(0, vols.length - 21), -1)) : 0;
    const pctChg = prevClose > 0 ? ((row.close - prevClose) / prevClose) * 100 : 0;
    prevClose = row.close;
    return { ...row, ma20, pctChg, volRatio20: avgVol20 > 0 ? row.vol / avgVol20 : 0 };
  });
}

function findLaunchRow(rows, windowStart, windowEnd) {
  return rows.find((row) => row.trade_date >= windowStart && row.trade_date <= windowEnd && row.pctChg > 2 && row.volRatio20 > 1.5 && row.close > row.ma20) || null;
}

function loadMembers(boardType, boardCode) {
  if (boardType === 'industry') {
    return readCsv(resolve(CACHE_DIR, `index_member_${boardCode}.csv`)).map((row) => ({ code: row.con_code, name: null, in_date: row.in_date || '00000000', out_date: row.out_date || '99999999' }));
  }
  const json = JSON.parse(readFileSync(resolve(CACHE_DIR, `concept_cons_${boardCode}.json`), 'utf8'));
  return (json?.data?.diff || []).map((row) => ({ code: String(row.f12), name: row.f14, in_date: '00000000', out_date: '99999999' }));
}

const dailyCache = new Map();
const basicCache = new Map();
const nameCache = new Map();
const basicDates = readdirSync(CACHE_DIR)
  .filter((name) => /^daily_basic_\d{8}\.csv$/.test(name))
  .map((name) => name.match(/(\d{8})/)[1])
  .sort();

function loadDaily(date) {
  if (dailyCache.has(date)) return dailyCache.get(date);
  const filePath = resolve(CACHE_DIR, `daily_${date}.csv`);
  if (!existsSync(filePath)) {
    dailyCache.set(date, null);
    return null;
  }
  const rows = readCsv(filePath).map((row) => ({
    ts_code: row.ts_code,
    trade_date: row.trade_date,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    vol: Number(row.vol),
  }));
  const map = new Map(rows.map((row) => [row.ts_code, row]));
  dailyCache.set(date, map);
  return map;
}

function loadDailyBasic(date) {
  if (basicCache.has(date)) return basicCache.get(date);
  const filePath = resolve(CACHE_DIR, `daily_basic_${date}.csv`);
  if (!existsSync(filePath)) {
    basicCache.set(date, null);
    return null;
  }
  const rows = readCsv(filePath).map((row) => ({ ts_code: row.ts_code, circ_mv: Number(row.circ_mv) }));
  const map = new Map(rows.map((row) => [row.ts_code, row]));
  basicCache.set(date, map);
  return map;
}

function tsCodeOf(code) {
  if (code.includes('.')) return code;
  return code.startsWith('6') || code.startsWith('9') ? `${code}.SH` : `${code}.SZ`;
}

function secidOf(tsCode) {
  const code = tsCode.split('.')[0];
  return /^(60|68|90)/.test(code) ? `1.${code}` : `0.${code}`;
}

async function getStockName(tsCode) {
  if (nameCache.has(tsCode)) return nameCache.get(tsCode);
  const cachePath = resolve(CACHE_DIR, `name_${tsCode}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    nameCache.set(tsCode, cached.name);
    return cached.name;
  }
  const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secidOf(tsCode)}&fields=f58`, { headers: { Referer: 'https://quote.eastmoney.com/' } });
  if (!res.ok) return tsCode;
  const json = await res.json();
  const name = json?.data?.f58 || tsCode;
  writeFileSync(cachePath, JSON.stringify({ name }), 'utf8');
  nameCache.set(tsCode, name);
  return name;
}

function isActive(member, tradeDate) {
  return member.in_date <= tradeDate && tradeDate <= member.out_date;
}

function findBasicRow(tsCode, tradeDate) {
  for (let i = basicDates.length - 1; i >= 0; i -= 1) {
    const date = basicDates[i];
    if (date > tradeDate) continue;
    const map = loadDailyBasic(date);
    const row = map?.get(tsCode);
    if (row) return row;
  }
  return null;
}

function turnoverPct(dayRow, basicRow) {
  if (!basicRow || !basicRow.circ_mv) return 0;
  return (dayRow.vol * dayRow.close) / basicRow.circ_mv;
}

function buildStockWindow(tsCode, calendar, currentIndex) {
  const rows = [];
  for (let i = Math.max(0, currentIndex - 25); i <= currentIndex + 3 && i < calendar.length; i += 1) {
    const date = calendar[i];
    const row = loadDaily(date)?.get(tsCode);
    if (row) rows.push({ ...row, index: i });
  }
  return rows;
}

function calcMa5(windowRows, currentIndex) {
  const prior = windowRows.filter((row) => row.index <= currentIndex).slice(-5);
  return prior.length === 5 ? avg(prior.map((row) => row.close)) : null;
}

function calcMa20Vol(windowRows, currentIndex) {
  const prior = windowRows.filter((row) => row.index < currentIndex).slice(-20);
  return prior.length >= 5 ? avg(prior.map((row) => row.vol)) : 0;
}

function calcLeaderCumGain(launchRow, dayRow) {
  return (dayRow.close - launchRow.close) / launchRow.close;
}

function simulate3Day(tsCode, buyDate, buyPrice, calendar) {
  const buyIndex = calendar.indexOf(buyDate);
  if (buyIndex < 0 || buyIndex + 3 >= calendar.length) return null;
  const future = [];
  for (let i = 1; i <= 3; i += 1) {
    const row = loadDaily(calendar[buyIndex + i])?.get(tsCode);
    if (!row) return null;
    future.push(row);
  }
  const highest = Math.max(...future.map((row) => row.high));
  const lowest = Math.min(...future.map((row) => row.low));
  return {
    highestGain: (highest - buyPrice) / buyPrice,
    maxDrawdown: (lowest - buyPrice) / buyPrice,
    hit3pct: (highest - buyPrice) / buyPrice >= TARGET_PCT,
  };
}

async function analyzeSignalDay(caseItem, boardRows, launchRow, signalIndex, members, calendar) {
  const signalDate = calendar[signalIndex];
  const prevDate = calendar[signalIndex - 1];
  const signalDaily = loadDaily(signalDate);
  const prevDaily = loadDaily(prevDate);
  const launchDaily = loadDaily(launchRow.trade_date);
  if (!signalDaily || !prevDaily || !launchDaily) return { leaders: [], candidates: [] };

  const activeMembers = members.filter((member) => isActive(member, signalDate));
  const leaders = [];

  for (const member of activeMembers) {
    const tsCode = tsCodeOf(member.code);
    const dayRow = signalDaily.get(tsCode);
    const baseRow = launchDaily.get(tsCode);
    const basicRow = findBasicRow(tsCode, signalDate);
    if (!dayRow || !baseRow || !basicRow) continue;
    const tPct = turnoverPct(dayRow, basicRow);
    if (tPct <= 5) continue;
    leaders.push({ tsCode, name: member.name || await getStockName(tsCode), cumGain: calcLeaderCumGain(baseRow, dayRow), turnover: tPct });
  }

  leaders.sort((a, b) => b.cumGain - a.cumGain);
  const topLeaders = leaders.slice(0, 3);
  const leaderThreshold = topLeaders.length ? topLeaders[0].cumGain * 0.5 : null;
  const leaderCodes = new Set(topLeaders.map((item) => item.tsCode));

  const candidates = [];
  if (leaderThreshold == null) return { leaders: topLeaders, candidates };

  for (const member of activeMembers) {
    const tsCode = tsCodeOf(member.code);
    if (leaderCodes.has(tsCode)) continue;
    const dayRow = signalDaily.get(tsCode);
    const prevRow = prevDaily.get(tsCode);
    if (!dayRow || !prevRow || prevRow.close <= 0) continue;
    const windowRows = buildStockWindow(tsCode, calendar, signalIndex);
    const ma5 = calcMa5(windowRows, signalIndex);
    const ma20Vol = calcMa20Vol(windowRows, signalIndex);
    const todayPct = (dayRow.close - prevRow.close) / prevRow.close;
    const bullish = dayRow.close > dayRow.open;
    const volRatio = ma20Vol > 0 ? dayRow.vol / ma20Vol : 0;
    const lagging = todayPct < leaderThreshold;
    const aboveMa5 = ma5 != null && dayRow.close > ma5;
    if (!(lagging && volRatio > 1.5 && bullish && aboveMa5)) continue;
    const result3d = simulate3Day(tsCode, signalDate, dayRow.close, calendar);
    if (!result3d) continue;
    candidates.push({
      tsCode,
      name: member.name || await getStockName(tsCode),
      todayPct,
      volRatio,
      highestGain: result3d.highestGain,
      maxDrawdown: result3d.maxDrawdown,
      hit3pct: result3d.hit3pct,
    });
  }

  candidates.sort((a, b) => b.highestGain - a.highestGain);
  return { leaders: topLeaders, candidates };
}

async function analyzeCase(caseItem) {
  const boardRows = loadBoardRows(caseItem.boardType, caseItem.boardCode);
  const launchRow = findLaunchRow(boardRows, caseItem.windowStart, caseItem.windowEnd);
  if (!launchRow) return { caseItem, launchRow: null, day2: null, day3: null };
  const members = loadMembers(caseItem.boardType, caseItem.boardCode);
  const calendar = boardRows.map((row) => row.trade_date);
  const launchIndex = calendar.indexOf(launchRow.trade_date);
  const day2 = await analyzeSignalDay(caseItem, boardRows, launchRow, launchIndex + 2, members, calendar);
  const day3 = await analyzeSignalDay(caseItem, boardRows, launchRow, launchIndex + 3, members, calendar);
  return { caseItem, launchRow, day2, day3, calendar };
}

function printCandidates(title, candidates) {
  console.log(`  ${title}`);
  if (!candidates.length) {
    console.log('    无候选股');
    return { hit: 0, total: 0 };
  }
  console.log('    代码       名称         今日涨幅   量比    3日最高   3日回撤   是否达标');
  let hit = 0;
  for (const item of candidates) {
    if (item.hit3pct) hit += 1;
    console.log(`    ${item.tsCode.padEnd(10)} ${String(item.name).padEnd(10)} ${pct(item.todayPct).padEnd(9)} ${fmt(item.volRatio).padEnd(6)} ${pct(item.highestGain).padEnd(8)} ${pct(item.maxDrawdown).padEnd(8)} ${item.hit3pct ? '是' : '否'}`);
  }
  console.log(`  命中率：${hit}/${candidates.length}只达到+3%`);
  return { hit, total: candidates.length };
}

async function main() {
  let totalHit = 0;
  let totalCount = 0;
  for (const caseItem of CASES) {
    const result = await analyzeCase(caseItem);
    console.log(`案例：${caseItem.name}`);
    if (!result.launchRow) {
      console.log('  未找到满足条件的启动日');
      console.log('');
      continue;
    }
    console.log(`  启动日：${result.launchRow.trade_date}  板块涨幅：${result.launchRow.pctChg.toFixed(2)}%  成交量比：${result.launchRow.volRatio20.toFixed(2)}x`);
    console.log('  龙头股（T+2累计涨幅前3，换手率>5%）：');
    if (!result.day2.leaders.length) {
      console.log('    无满足条件的龙头股');
    } else {
      for (const leader of result.day2.leaders) {
        console.log(`    ${leader.name}(${leader.tsCode}) 2日累计涨幅${pct(leader.cumGain)}  换手率${leader.turnover.toFixed(1)}%`);
      }
    }
    const day2Stats = printCandidates('第2天跟涨候选：', result.day2.candidates);
    const day3Stats = printCandidates('第3天跟涨候选：', result.day3.candidates);
    totalHit += day2Stats.hit + day3Stats.hit;
    totalCount += day2Stats.total + day3Stats.total;
    console.log('');
  }
  console.log(`三案例汇总命中率：${totalHit}/${totalCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
