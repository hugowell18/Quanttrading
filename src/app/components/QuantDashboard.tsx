import { useState } from 'react';
import { StockAnalyzer } from './StockAnalyzer';
import { SignalAnalyzer } from './SignalAnalyzer';

export function QuantDashboard() {
  const [selectedCode, setSelectedCode] = useState('');

  return (
    <div className="flex flex-col gap-6">
      {/* 主入口：股票分析器（含输入框 + 历史记录 + 结果展示） */}
      <StockAnalyzer
        onResolvedStock={(code) => {
          setSelectedCode(code);
        }}
      />

      {/* 选中股票后展示 K 线高级分析 */}
      {selectedCode && <SignalAnalyzer initialCode={selectedCode} />}
    </div>
  );
}
