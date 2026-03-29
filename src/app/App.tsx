import { useState, useEffect } from 'react';
import { LayoutDashboard, TrendingUp, Settings } from 'lucide-react';
import { AppProvider, useAppContext } from './context/AppContext';
import { MarketOverview } from './components/market/MarketOverview';
import { StockAnalyzerPage } from './components/analyzer/StockAnalyzerPage';
import { DebugAdminPage } from './components/admin/DebugAdminPage';
import { Toaster } from './components/ui/sonner';
import type { PageType } from './types/api';

const navigation: { id: PageType; name: string; icon: React.ElementType }[] = [
  { id: 'market', name: '大盘全景', icon: LayoutDashboard },
  { id: 'analyzer', name: '个股复盘', icon: TrendingUp },
  { id: 'admin', name: '调试控制台', icon: Settings },
];

function AppShell() {
  const { currentPage, setCurrentPage } = useAppContext();
  const [nowLabel, setNowLabel] = useState(() => new Date().toLocaleString('zh-CN'));

  useEffect(() => {
    const timer = setInterval(() => {
      setNowLabel(new Date().toLocaleString('zh-CN'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
                  className={`flex min-w-fit items-center gap-2 rounded-md border px-4 py-1.5 font-mono text-[12px] uppercase tracking-[0.12em] transition-all duration-200 ${
                    currentPage === item.id
                      ? 'border-primary/30 bg-primary/12 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-white/3 hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-w-fit items-center gap-4 font-mono text-[11px]">
            <div className="flex items-center gap-2 text-[#00ff88]">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00ff88] shadow-[0_0_0_0_rgba(0,255,136,0.4)]" />
              <span>LIVE</span>
            </div>
            <div className="text-muted-foreground">{nowLabel}</div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1600px] px-6 py-6">
        {currentPage === 'market' && <MarketOverview />}
        {currentPage === 'analyzer' && <StockAnalyzerPage />}
        {currentPage === 'admin' && <DebugAdminPage />}
      </main>

      <footer className="relative z-10 mt-8 border-t border-border bg-background/90">
        <div className="mx-auto max-w-[1600px] px-6 py-6">
          <div className="text-center text-sm text-muted-foreground">
            <p>本系统仅供学习研究使用，不构成投资建议。投资有风险，入市需谨慎。</p>
            <p className="mt-2">© 2026 A股量化研究平台 · 最后更新：{nowLabel}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
      <Toaster />
    </AppProvider>
  );
}
