import { useState } from 'react';
import { LayoutDashboard, TrendingUp, BarChart3 } from 'lucide-react';
import { MarketDashboard } from './components/MarketDashboard';
import { SignalAnalyzer } from './components/SignalAnalyzer';
import { IndustryTrends } from './components/IndustryTrends';

type PageType = 'dashboard' | 'analyzer' | 'trends';

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const nowLabel = new Date().toLocaleString('zh-CN');

  const navigation = [
    { id: 'dashboard' as PageType, name: '市场总览', icon: LayoutDashboard },
    { id: 'analyzer' as PageType, name: '信号分析', icon: TrendingUp },
    { id: 'trends' as PageType, name: '行业趋势', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(rgba(0,212,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(0,212,255,0.025)_1px,transparent_1px)] bg-[size:40px_40px]" />

      <header className="sticky top-0 z-50 border-b border-border/90 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[52px] max-w-[1600px] items-center gap-6 px-6">
          <div className="min-w-fit font-mono text-[15px] font-bold tracking-[0.2em] text-primary [text-shadow:0_0_20px_rgba(0,212,255,0.4)]">
            QUANTPULSE <span className="font-normal text-muted-foreground">CN</span>
          </div>

          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentPage(item.id)}
                  className={`flex min-w-fit items-center gap-2 rounded-md border px-4 py-1.5 font-mono text-[12px] uppercase tracking-[0.12em] transition-all ${
                    currentPage === item.id
                      ? 'border-primary/30 bg-primary/12 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-white/3 hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-w-fit items-center gap-4 font-mono text-[11px]">
            <div className="flex items-center gap-2 text-[#00ff88]">
              <div className="h-1.5 w-1.5 rounded-full bg-[#00ff88] shadow-[0_0_0_0_rgba(0,255,136,0.4)] animate-pulse" />
              <span>LIVE</span>
            </div>
            <div className="text-muted-foreground">{nowLabel}</div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1600px] px-6 py-6">
        {currentPage === 'dashboard' && <MarketDashboard />}
        {currentPage === 'analyzer' && <SignalAnalyzer />}
        {currentPage === 'trends' && <IndustryTrends />}
      </main>

      <footer className="relative z-10 mt-8 border-t border-border bg-background/90">
        <div className="mx-auto max-w-[1600px] px-6 py-6">
          <div className="text-center text-sm text-muted-foreground">
            <p>⚠️ 本系统仅供学习研究使用，不构成投资建议。投资有风险，入市需谨慎。</p>
            <p className="mt-2">© 2026 A股量化交易系统 · 数据更新时间: {nowLabel}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
