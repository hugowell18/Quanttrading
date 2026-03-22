import { type TradeRecord } from './types';

type TradeLedgerProps = {
  tradeRecords: TradeRecord[];
};

export function TradeLedger({ tradeRecords }: TradeLedgerProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">买卖信号记录</div>
        <div className="text-xs text-muted-foreground">按完整交易对展示真实买入与卖出结果</div>
      </div>
      <div className="space-y-4">
        {tradeRecords.map((trade, index) => {
          const success = trade.result === 'success';
          return (
            <div key={trade.id} className="rounded-lg border border-border bg-secondary/30 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">交易 {String(index + 1).padStart(2, '0')}</div>
                <div className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${success ? 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' : 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]'}`}>
                  {success ? '成功' : '失败'}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border bg-card/50 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">买入</div>
                  <div className="mt-2 text-sm text-foreground">时间：{trade.buyDate}</div>
                  <div className="mt-1 font-mono text-base text-[#ff3366]">价格：¥{trade.buyPrice.toFixed(2)}</div>
                </div>
                <div className="rounded-md border border-border bg-card/50 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">卖出</div>
                  <div className="mt-2 text-sm text-foreground">时间：{trade.sellDate}</div>
                  <div className="mt-1 font-mono text-base text-[#00ff88]">价格：¥{trade.sellPrice.toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <div className="text-muted-foreground">
                  收益率
                  <span className={`ml-2 font-mono ${success ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                    {trade.returnPct >= 0 ? '+' : ''}{trade.returnPct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-muted-foreground">
                  收益额
                  <span className={`ml-2 font-mono ${success ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                    {trade.returnAmount >= 0 ? '+' : '-'}¥{Math.abs(trade.returnAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
