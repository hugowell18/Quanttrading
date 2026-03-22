import { type AdaptiveStrategyDecision, type CandidateStrategyResult, type RegimeDecision, type StrategyFeatures } from './types';

type StrategyIntelligencePanelProps = {
  bestStrategy: AdaptiveStrategyDecision;
  features: StrategyFeatures;
  regime: RegimeDecision;
  strategies: CandidateStrategyResult[];
};

const signalTone = {
  buy: 'border-[#ff3366]/30 bg-[#ff3366]/10 text-[#ff808f]',
  sell: 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]',
  hold: 'border-[#ffaa00]/30 bg-[#ffaa00]/10 text-[#ffaa00]',
};

export function StrategyIntelligencePanel({
  bestStrategy,
  features,
  regime,
  strategies,
}: StrategyIntelligencePanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Strategy Intelligence</div>
          <div className="mt-2 text-sm text-muted-foreground">按 4 步流程展示特征提取、分类判断、候选回测与 E 合成策略结果</div>
        </div>
        <div className={`rounded border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${signalTone[bestStrategy.currentSignal]}`}>
          E 信号: {bestStrategy.currentSignal}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Step 1 · 特征提取</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">趋势层</div>
              <div className="mt-2 text-sm text-foreground">方向: {features.trend.direction}</div>
              <div className="mt-1 text-sm text-foreground">强度: {features.trend.strength}</div>
              <div className="mt-1 font-mono text-sm text-primary">ADX {features.trend.adx}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">动量层</div>
              <div className="mt-2 text-sm text-foreground">MACD: {features.momentum.macdSignal}</div>
              <div className="mt-1 text-sm text-foreground">RSI12: {features.momentum.rsi12}</div>
              <div className="mt-1 text-sm text-foreground">KDJ: {features.momentum.kdjSignal}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">量能层</div>
              <div className="mt-2 text-sm text-foreground">量价: {features.volume.priceVolumePattern}</div>
              <div className="mt-1 text-sm text-foreground">量比: {features.volume.volumeRatio}</div>
              <div className="mt-1 text-sm text-foreground">OBV: {features.volume.obvTrend}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">全局特征</div>
              <div className="mt-2 text-sm text-foreground">波动率: {(features.volatility * 100).toFixed(2)}%</div>
              <div className="mt-1 text-sm text-foreground">自相关20: {features.autocorr20}</div>
              <div className="mt-1 text-sm text-foreground">流动性: {features.liquidityScore}</div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Step 2 · 股票分类</div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="rounded border border-primary/30 bg-primary/10 px-3 py-2 font-mono text-sm text-primary">
              {regime.type}
            </div>
            <div className="font-mono text-sm text-foreground">置信度 {Math.round(regime.confidence * 100)}%</div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Trend</div>
              <div className="mt-2 font-mono text-lg text-foreground">{regime.scores.trend}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Range</div>
              <div className="mt-2 font-mono text-lg text-foreground">{regime.scores.range}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Speculative</div>
              <div className="mt-2 font-mono text-lg text-foreground">{regime.scores.speculative}</div>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            {regime.reasons.map((reason) => (
              <div key={reason}>{reason}</div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-secondary/30 p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Step 3 · 候选策略回测</div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {strategies.map((strategy) => (
            <div key={strategy.strategyId} className="rounded border border-border bg-card/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm text-foreground">{strategy.strategyName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{strategy.strategyId}</div>
                </div>
                <div className="font-mono text-lg text-primary">{strategy.score}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Sharpe</div>
                  <div className="mt-1 font-mono text-foreground">{strategy.sharpe}</div>
                </div>
                <div className="rounded border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">最大回撤</div>
                  <div className="mt-1 font-mono text-foreground">{strategy.maxDrawdown}%</div>
                </div>
                <div className="rounded border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">胜率</div>
                  <div className="mt-1 font-mono text-foreground">{strategy.winRate}%</div>
                </div>
                <div className="rounded border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">盈亏比</div>
                  <div className="mt-1 font-mono text-foreground">{strategy.profitFactor}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Step 4 · E 合成策略</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="text-lg text-foreground">{bestStrategy.strategyName}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <div className={`rounded border px-3 py-2 font-mono ${signalTone[bestStrategy.currentSignal]}`}>{bestStrategy.currentSignal}</div>
              <div className="rounded border border-border px-3 py-2 font-mono text-foreground">强度 {bestStrategy.signalStrength}</div>
              <div className="rounded border border-border px-3 py-2 font-mono text-foreground">风险模式 {bestStrategy.riskBias}</div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              {bestStrategy.reasons.map((reason) => (
                <div key={reason}>{reason}</div>
              ))}
            </div>
          </div>
          <div className="grid gap-2 text-sm">
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">MA Cross 权重</div>
              <div className="mt-1 font-mono text-foreground">{bestStrategy.weights.maCross}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">MACD+RSI 权重</div>
              <div className="mt-1 font-mono text-foreground">{bestStrategy.weights.macdRsi}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Boll+Volume 权重</div>
              <div className="mt-1 font-mono text-foreground">{bestStrategy.weights.bollVolume}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Multi Factor 权重</div>
              <div className="mt-1 font-mono text-foreground">{bestStrategy.weights.multiFactor}</div>
            </div>
            <div className="rounded border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">最佳基底策略</div>
              <div className="mt-1 font-mono text-foreground">{bestStrategy.benchmark.bestBaseStrategyId}</div>
              <div className="mt-1 text-xs text-muted-foreground">Score {bestStrategy.benchmark.bestBaseStrategyScore}</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
