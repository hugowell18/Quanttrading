/**
 * VMF 背离得分计算
 * ─────────────────────────────────────────────────────
 * 核心思路：价格暴跌 + 机构大单反向净流入 = 极端背离 = 潜在黄金坑
 *
 * price_down_pct  = 今日跌幅在过去 60 日中的分位数（越跌越高）
 * flow_in_pct     = 今日大单净流入在过去 60 日中的分位数（越高越强）
 * DS              = price_down_pct × flow_in_pct
 *
 * 触发条件: price_down_pct > 0.90 AND flow_in_pct > 0.90 → DS > 0.81
 * 日常: DS ≈ 0，只在极端时突刺
 */

const WINDOW = 60;
const DS_THRESHOLD = 0.81; // 0.9 × 0.9

/**
 * 分位数排名（0~1），value在arr中处于第几百分位
 */
function percentileRank(arr, value) {
  if (arr.length === 0) return 0;
  const below = arr.filter(v => v < value).length;
  return below / arr.length;
}

/**
 * klineData: [{ date:'YYYY-MM-DD', open, high, low, close, volume }]
 * moneyflowData: [{ trade_date:'YYYYMMDD', buy_elg_amount, sell_elg_amount,
 *                   buy_lg_amount, sell_lg_amount, buy_sm_amount, sell_sm_amount }]
 *
 * returns: [{ date:'YYYYMMDD', large_net, small_net, divergence_score, signal }]
 */
export function calculateDivergenceScores(klineData, moneyflowData) {
  if (!klineData.length) return [];

  const mfMap = new Map(moneyflowData.map(r => [r.trade_date, r]));
  const results = [];

  for (let i = 0; i < klineData.length; i++) {
    const k         = klineData[i];
    const dateComp  = k.date.replace(/-/g, '');
    const mf        = mfMap.get(dateComp);
    const preClose  = i > 0 ? klineData[i - 1].close : k.open;

    // 当日价格变动率
    const priceChange = preClose > 0 ? (k.close - preClose) / preClose : 0;

    // 机构大单净额（万元）：超大单 + 大单 买入 - 卖出
    const large_net = mf
      ? (mf.buy_elg_amount + mf.buy_lg_amount) - (mf.sell_elg_amount + mf.sell_lg_amount)
      : null;

    // 散户小单净额
    const small_net = mf
      ? mf.buy_sm_amount - mf.sell_sm_amount
      : null;

    // ── 滚动窗口（最多 WINDOW 天）──────────────────────────
    const wStart = Math.max(0, i - WINDOW + 1);

    // 窗口内价格变动
    const windowPriceChanges = [];
    for (let j = wStart; j <= i; j++) {
      const prevClose = j > 0 ? klineData[j - 1].close : klineData[j].open;
      if (prevClose > 0) {
        windowPriceChanges.push((klineData[j].close - prevClose) / prevClose);
      }
    }

    // 窗口内大单净额（只取有 moneyflow 数据的日期）
    const windowLargeNets = [];
    for (let j = wStart; j <= i; j++) {
      const dc  = klineData[j].date.replace(/-/g, '');
      const wmf = mfMap.get(dc);
      if (wmf) {
        windowLargeNets.push(
          (wmf.buy_elg_amount + wmf.buy_lg_amount) - (wmf.sell_elg_amount + wmf.sell_lg_amount)
        );
      }
    }

    // ── 计算背离得分 ─────────────────────────────────────
    let divergence_score = 0;

    if (large_net !== null && windowLargeNets.length >= 20 && windowPriceChanges.length >= 20) {
      // 价格跌幅分位（用负值，下跌越大则 -priceChange 越大，分位越高）
      const negChanges    = windowPriceChanges.map(v => -v);
      const price_down_pct = percentileRank(negChanges, -priceChange);

      // 大单净流入分位
      const flow_in_pct = percentileRank(windowLargeNets, large_net);

      divergence_score = price_down_pct * flow_in_pct;
    }

    results.push({
      date:             dateComp,
      large_net:        large_net !== null ? Number(large_net.toFixed(2)) : null,
      small_net:        small_net !== null ? Number(small_net.toFixed(2)) : null,
      divergence_score: Number(divergence_score.toFixed(4)),
      signal:           divergence_score >= DS_THRESHOLD ? 'divergence' : null,
    });
  }

  return results;
}
