import { type TradeRecord } from './types';

const zh = {
  ledger: '\u4e70\u5356\u4fe1\u53f7\u8bb0\u5f55',
  ledgerHint: '\u6309\u5b8c\u6574\u4ea4\u6613\u5bf9\u5c55\u793a\u771f\u5b9e\u4e70\u5165\u4e0e\u5356\u51fa\u7ed3\u679c',
  trade: '\u4ea4\u6613',
  success: '\u6210\u529f',
  failure: '\u5931\u8d25',
  buy: '\u4e70\u5165',
  sell: '\u5356\u51fa',
  time: '\u65f6\u95f4',
  price: '\u4ef7\u683c',
  returnPct: '\u6536\u76ca\u7387',
  returnAmount: '\u6536\u76ca\u989d',
};

type TradeLedgerProps = {
  tradeRecords: TradeRecord[];
};

export function TradeLedger({ tradeRecords }: TradeLedgerProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{zh.ledger}</div>
        <div className="text-xs text-muted-foreground">{zh.ledgerHint}</div>
      </div>
      <div className="space-y-4">
        {tradeRecords.map((trade, index) => {
          const success = trade.result === 'success';
          return (
            <div key={trade.id} className="rounded-lg border border-border bg-secondary/30 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {zh.trade} {String(index + 1).padStart(2, '0')}
                </div>
                <div
                  className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
                    success
                      ? 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]'
                      : 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff3366]'
                  }`}
                >
                  {success ? zh.success : zh.failure}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border bg-card/50 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{zh.buy}</div>
                  <div className="mt-2 text-sm text-foreground">
                    {zh.time}
                    {'\uff1a'}
                    {trade.buyDate}
                  </div>
                  <div className="mt-1 font-mono text-base text-[#ff3366]">
                    {zh.price}
                    {'\uff1a'}
                    {'\u00a5'}
                    {trade.buyPrice.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card/50 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{zh.sell}</div>
                  <div className="mt-2 text-sm text-foreground">
                    {zh.time}
                    {'\uff1a'}
                    {trade.sellDate}
                  </div>
                  <div className="mt-1 font-mono text-base text-[#00ff88]">
                    {zh.price}
                    {'\uff1a'}
                    {'\u00a5'}
                    {trade.sellPrice.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <div className="text-muted-foreground">
                  {zh.returnPct}
                  <span className={`ml-2 font-mono ${success ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                    {trade.returnPct >= 0 ? '+' : ''}
                    {trade.returnPct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {zh.returnAmount}
                  <span className={`ml-2 font-mono ${success ? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
                    {trade.returnAmount >= 0 ? '+' : '-'}
                    {'\u00a5'}
                    {Math.abs(trade.returnAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })}
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
