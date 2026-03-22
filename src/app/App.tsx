import { useState } from 'react';
import { LayoutDashboard, TrendingUp, BarChart3 } from 'lucide-react';
import { MarketDashboard } from './components/MarketDashboard';
import { SignalAnalyzer } from './components/SignalAnalyzer';
import { IndustryTrends } from './components/IndustryTrends';

type PageType = 'dashboard' | 'analyzer' | 'trends';

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');

  const navigation = [
    { id: 'dashboard' as PageType, name: '市场总览', icon: LayoutDashboard },
    { id: 'analyzer' as PageType, name: '信号分析', icon: TrendingUp },
    { id: 'trends' as PageType, name: '行业趋势', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-lg p-2">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg">A股量化交易系统</h1>
                <div className="text-xs text-muted-foreground">Quant Trading Platform</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>实时数据</span>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentPage(item.id)}
                  className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-all ${
                    currentPage === item.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentPage === 'dashboard' && <MarketDashboard />}
        {currentPage === 'analyzer' && <SignalAnalyzer />}
        {currentPage === 'trends' && <IndustryTrends />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-sm text-muted-foreground">
            <p>⚠️ 本系统仅供学习研究使用，不构成投资建议。投资有风险，入市需谨慎。</p>
            <p className="mt-2">© 2026 A股量化交易系统 · 数据更新时间: {new Date().toLocaleString('zh-CN')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}