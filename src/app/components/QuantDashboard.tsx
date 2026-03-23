import { useState } from 'react';
import { StockAnalyzer } from './StockAnalyzer';
import { StockLeaderboard } from './StockLeaderboard';
import { SignalAnalyzer } from './SignalAnalyzer';

export function QuantDashboard() {
  const [view, setView] = useState<'list' | 'analyze'>('list');
  const [selectedCode, setSelectedCode] = useState('');
  const [selectedName, setSelectedName] = useState('');

  const handleSelect = (code: string, name: string) => {
    setSelectedCode(code);
    setSelectedName(name);
    setView('analyze');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1">
        {[
          { key: 'list', label: '标的池 · 36只' },
          { key: 'analyze', label: '个股分析' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key as 'list' | 'analyze')}
            className={`rounded border px-4 py-[6px] font-mono text-[11px] uppercase tracking-[1px] transition-all duration-150 ${
              view === tab.key
                ? 'border-primary/20 bg-primary/10 text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'list' && <StockLeaderboard onSelectStock={handleSelect} />}
      {view === 'analyze' && (
        <div className="space-y-6">
          <StockAnalyzer
            initialCode={selectedCode}
            initialName={selectedName}
            onResolvedStock={(code, name) => {
              setSelectedCode(code);
              setSelectedName(name);
            }}
          />
          <SignalAnalyzer initialCode={selectedCode} />
        </div>
      )}
    </div>
  );
}
