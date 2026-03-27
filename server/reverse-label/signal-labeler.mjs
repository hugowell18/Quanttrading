export class SignalLabeler {
  constructor(rows, options = {}) {
    // 强制使用前复权数据进行内部计算
    this.rows = rows.map((row) => ({ ...row }));
    
    // 严格落实 Task 2 规定的新参数
    this.forwardDays = options.forwardDays ?? 5;       // 后5个交易日
    this.minReturn = options.minReturn ?? 0.045;       // 最高涨幅达到4.5%以上
    this.maxDrawdown = options.maxDrawdown ?? 0.025;   // 最大回撤不超过2.5%
    this.tradingCost = options.tradingCost ?? 0.007;   // 0.7% 双边交易成本
    
    // 诊断计数器
    this.diagnostics = {
      totalRows: this.rows.length,
      trendFilteredCount: 0,
      oversoldCandidateCount: 0,
      buyPointCount: 0,
      sellPointCount: 0, // 历史标注重构后，传统的单纯"卖点"概念弱化，主要看买点
    };
  }

  // 检查是否符合短线超卖（6选3）
  _checkOversoldConditions(index) {
    if (index < 4) return false; // 数据不足
    
    let conditionCount = 0;
    const row = this.rows[index];

    // 1. RSI(6) < 42
    if (row.rsi6 != null && row.rsi6 < 42) conditionCount++;

    // 2. KDJ 的 J < 25
    if (row.kdj_j != null && row.kdj_j < 25) conditionCount++;

    // 3. 布林带相对位置 < 0.25 (假设 data-engine 算出了 boll_pos)
    if (row.boll_pos != null && row.boll_pos < 0.25) conditionCount++;

    // 4. 近4日内至少3根阴线 (收盘价 < 开盘价，用复权价比较更准)
    let negativeLines = 0;
    for (let i = index - 3; i <= index; i++) {
      if (this.rows[i].close_adj < this.rows[i].open_adj) negativeLines++;
    }
    if (negativeLines >= 3) conditionCount++;

    // 5. 近4日累计跌幅 > 2%
    const price4DaysAgo = this.rows[index - 3].close_adj;
    const dropPct = (row.close_adj - price4DaysAgo) / price4DaysAgo;
    if (dropPct < -0.02) conditionCount++;

    // 6. 近3日成交量萎缩
    const vol0 = row.volume;
    const vol1 = this.rows[index - 1].volume;
    const vol2 = this.rows[index - 2].volume;
    if (vol0 < vol1 && vol1 < vol2) conditionCount++;

    return conditionCount >= 3;
  }

  getLabeledRows() {
    // 遍历所有数据，寻找合规的均值回归买点
    for (let i = 0; i < this.rows.length - this.forwardDays; i++) {
      const row = this.rows[i];
      
      // 初始化标签
      row.isBuyPoint = 0;

      // === 条件组一：大趋势过滤 ===
      // 个股 MA60 多头 (确保存在 ma60 且 close_adj > ma60)
      const stockTrendOk = row.ma60 != null && row.close_adj > row.ma60;
      // 大盘过滤：这需要依赖外部注入 index_ma20_ok 字段，或在此处默认通过让外部验证器处理
      // 假设 data-engine 已经对齐了数据并注入了 indexTrendOk 标志
      const indexTrendOk = row.indexTrendOk !== false; 

      if (!stockTrendOk || !indexTrendOk) continue;
      this.diagnostics.trendFilteredCount++;

      // === 条件组二：短期超卖特征 ===
      if (!this._checkOversoldConditions(i)) continue;
      this.diagnostics.oversoldCandidateCount++;

      // === 条件组三：结果验证 (历史打标) ===
      // 以当日前复权收盘价为买入价，扣除0.7%成本
      const baseBuyPrice = row.close_adj;
      const effectiveBuyPrice = baseBuyPrice * (1 + this.tradingCost); // 算上成本的持仓均价
      
      let maxHigh = -Infinity;
      let minLow = Infinity;

      // 往后看 forwardDays (5天)
      for (let j = i + 1; j <= i + this.forwardDays; j++) {
        const futureRow = this.rows[j];
        if (futureRow.high_adj > maxHigh) maxHigh = futureRow.high_adj;
        if (futureRow.low_adj < minLow) minLow = futureRow.low_adj;
      }

      // 计算真实最高收益和最大回撤
      const realizedMaxReturn = (maxHigh - effectiveBuyPrice) / effectiveBuyPrice;
      const realizedMaxDrawdown = (effectiveBuyPrice - minLow) / effectiveBuyPrice;

      // 判断是否达标
      if (realizedMaxReturn >= this.minReturn && realizedMaxDrawdown <= this.maxDrawdown) {
        row.isBuyPoint = 1;
        this.diagnostics.buyPointCount++;
        row.targetReturn = realizedMaxReturn;
        row.maxDrawdown = realizedMaxDrawdown;
        // 找到第一个触达目标收益的日期作为卖点
        for (let j = i + 1; j <= i + this.forwardDays; j++) {
          const futureRow = this.rows[j];
          const futureReturn = (futureRow.high_adj - effectiveBuyPrice) / effectiveBuyPrice;
          if (futureReturn >= this.minReturn) {
            if (!futureRow.isSellPoint) {
              futureRow.isSellPoint = 1;
              this.diagnostics.sellPointCount++;
            }
            break;
          }
        }
      }
    }

    return this.rows;
  }

  getDiagnostics() {
    const d = this.diagnostics;
    console.log('\n--- 均值回归标注诊断报告 ---');
    console.log(`总K线数量: ${d.totalRows}`);
    console.log(`满足大趋势过滤: ${d.trendFilteredCount}`);
    console.log(`满足超卖条件候选: ${d.oversoldCandidateCount}`);
    console.log(`最终打标为买点: ${d.buyPointCount} (占比: ${((d.buyPointCount / d.totalRows) * 100).toFixed(2)}%)`);
    console.log('----------------------------\n');
    return d;
  }
}
