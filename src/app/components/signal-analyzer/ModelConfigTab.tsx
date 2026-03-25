interface OptimizerResult {
  regime?: string;
  regimeConfidence?: number;
  regimeHistory?: Array<{ date: string; regime: string }>;
  bestConfig?: {
    minZoneCapture: number;
    zoneForward: number;
    zoneBackward: number;
    envFilter: string;
  };
  bestModel?: {
    featureSet: string;
    model: string;
    precision: number;
    recall: number;
    f1: number;
  };
  plateau?: { passed: boolean; ratio: number; neighborCount: number };
  modelStore?: { action: string; reason: string; version: number; fallbackToVersion?: number };
  usedFallback?: boolean;
  leaderboard?: Array<{
    rank: number;
    config: { minZoneCapture: number; zoneForward: number; zoneBackward: number; envFilter: string };
    bestModel?: { featureSet: string; model: string };
    result: { avgReturn: number; winRate: number; stopLossRate: number; totalTrades: number };
  }>;
  stats?: { totalCombinations?: number; validCombinations: number; scanDurationMs: number };
}

const REGIME_LABELS: Record<string, { label: string; colorClass: string }> = {
  uptrend: { label: '上升趋势', colorClass: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
  downtrend: { label: '下降趋势', colorClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  range: { label: '震荡区间', colorClass: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  breakout: { label: '突破前夕', colorClass: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  high_vol: { label: '高波动', colorClass: 'text-orange-400 border-orange-500/30 bg-orange-500/10' },
};

export function ModelConfigTab({ result }: { result: OptimizerResult | null }) {
  if (!result) {
    return <div className="py-12 text-center font-mono text-sm text-muted-foreground">请先分析一只股票</div>;
  }

  const regimeInfo = REGIME_LABELS[result.regime ?? ''] ?? { label: result.regime ?? '-', colorClass: 'text-muted-foreground border-border bg-secondary/40' };

  return (
    <div className="flex flex-col gap-4">
      {/* 三层架构状态 */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">参数高原检验</div>
          {result.plateau ? (
            <>
              <div className={`font-mono text-[16px] font-bold ${result.plateau.passed ? 'text-emerald-400' : 'text-rose-400'}`}>
                {result.plateau.passed ? '通过' : '未通过'}
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                邻域比 {result.plateau.ratio} · 邻域数 {result.plateau.neighborCount}
              </div>
            </>
          ) : (
            <div className="font-mono text-[14px] text-muted-foreground">-</div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">模型版本</div>
          {result.modelStore ? (
            <>
              <div className="font-mono text-[16px] font-bold text-primary">v{result.modelStore.version}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                {result.modelStore.action === 'accept' ? '已更新' : result.modelStore.action === 'reject' ? '已熔断' : result.modelStore.action === 'regime_switch' ? 'Regime切换' : result.modelStore.action}
              </div>
            </>
          ) : (
            <div className="font-mono text-[14px] text-muted-foreground">-</div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">最优模型</div>
          {result.bestModel ? (
            <>
              <div className="font-mono text-[14px] font-bold text-primary">{result.bestModel.model}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                {result.bestModel.featureSet} · P{result.bestModel.precision.toFixed(2)} R{result.bestModel.recall.toFixed(2)}
              </div>
            </>
          ) : (
            <div className="font-mono text-[14px] text-muted-foreground">-</div>
          )}
        </div>
      </div>

      {/* 最优配置 */}
      {result.bestConfig && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
            <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
            最优配置
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { key: 'minZoneCapture', value: result.bestConfig.minZoneCapture },
              { key: 'zoneForward', value: result.bestConfig.zoneForward },
              { key: 'zoneBackward', value: result.bestConfig.zoneBackward },
              { key: 'envFilter', value: result.bestConfig.envFilter },
            ].map((item) => (
              <div key={item.key} className="flex justify-between rounded bg-secondary/40 px-3 py-2 font-mono text-[12px]">
                <span className="text-muted-foreground">{item.key}</span>
                <span className="text-primary">{String(item.value)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>
              有效组合 {result.stats?.validCombinations ?? '?'}/{result.stats?.totalCombinations ?? '?'} · 耗时 {((result.stats?.scanDurationMs ?? 0) / 1000).toFixed(1)}s
            </span>
            {result.usedFallback && (
              <span className="rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[9px] text-orange-400">FALLBACK</span>
            )}
          </div>
        </div>
      )}

      {/* Regime 历史时间线 */}
      {result.regimeHistory && result.regimeHistory.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
            <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
            Regime 演变
          </div>
          <div className="flex flex-wrap gap-1">
            {result.regimeHistory.slice(-8).map((item, idx) => {
              const rInfo = REGIME_LABELS[item.regime] ?? { label: item.regime, colorClass: 'text-muted-foreground border-border bg-secondary/40' };
              return (
                <div key={idx} className="flex items-center gap-1">
                  {idx > 0 && <span className="font-mono text-[10px] text-muted-foreground/40">→</span>}
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${rInfo.colorClass}`}>
                    {item.date.slice(5)} {rInfo.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 排行榜 */}
      {result.leaderboard && result.leaderboard.length > 1 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
            <span className="inline-block h-3 w-[3px] rounded-sm bg-primary" />
            配置排行 Top {Math.min(5, result.leaderboard.length)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">capture</th>
                  <th className="pb-2 pr-3">fwd</th>
                  <th className="pb-2 pr-3">bwd</th>
                  <th className="pb-2 pr-3">envFilter</th>
                  <th className="pb-2 pr-3 text-right">收益</th>
                  <th className="pb-2 pr-3 text-right">胜率</th>
                  <th className="pb-2 text-right">交易</th>
                </tr>
              </thead>
              <tbody>
                {result.leaderboard.slice(0, 5).map((item) => (
                  <tr key={item.rank} className={`border-b border-border/30 ${item.rank === 1 ? 'text-primary' : 'text-foreground'}`}>
                    <td className="py-1.5 pr-3">{item.rank}</td>
                    <td className="py-1.5 pr-3">{item.config.minZoneCapture}</td>
                    <td className="py-1.5 pr-3">{item.config.zoneForward}</td>
                    <td className="py-1.5 pr-3">{item.config.zoneBackward}</td>
                    <td className="py-1.5 pr-3">{item.config.envFilter}</td>
                    <td className="py-1.5 pr-3 text-right text-rose-400">{(item.result.avgReturn * 100).toFixed(2)}%</td>
                    <td className="py-1.5 pr-3 text-right">{(item.result.winRate * 100).toFixed(0)}%</td>
                    <td className="py-1.5 text-right">{item.result.totalTrades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 模型存储详情 */}
      {result.modelStore && result.modelStore.reason && (
        <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3">
          <div className="font-mono text-[10px] text-muted-foreground">
            <span className="mr-2 uppercase tracking-[1px]">模型存储</span>
            {result.modelStore.reason}
          </div>
        </div>
      )}
    </div>
  );
}
