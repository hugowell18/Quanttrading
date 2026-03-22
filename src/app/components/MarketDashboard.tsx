import { TrendingUp, TrendingDown } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, BarChart, Bar } from 'recharts';

const marketIndices = [
  { name: 'CSI 300', value: '3,845.62', change: '+1.24%', trend: 'up', volume: '245.8B' },
  { name: 'SSE Composite', value: '3,102.58', change: '-0.32%', trend: 'down', volume: '328.5B' },
  { name: 'STAR Market', value: '2,756.43', change: '+2.18%', trend: 'up', volume: '89.2B' },
];

const indexData = [
  { time: '09:30', value: 3802 },
  { time: '10:00', value: 3815 },
  { time: '10:30', value: 3808 },
  { time: '11:00', value: 3825 },
  { time: '11:30', value: 3820 },
  { time: '13:00', value: 3830 },
  { time: '13:30', value: 3835 },
  { time: '14:00', value: 3828 },
  { time: '14:30', value: 3840 },
  { time: '15:00', value: 3846 },
];

const sectorPerformance = [
  { sector: '半导体', change: 3.2, color: '#22c55e' },
  { sector: '人工智能', change: 2.8, color: '#22c55e' },
  { sector: '新能源', change: 1.5, color: '#22c55e' },
  { sector: '医疗保健', change: 0.8, color: '#22c55e' },
  { sector: '金融', change: -0.3, color: '#ef4444' },
  { sector: '房地产', change: -1.2, color: '#ef4444' },
  { sector: '消费品', change: -1.8, color: '#ef4444' },
];

const topStocks = {
  gainers: [
    { code: '688981', name: '中芯国际', price: '¥68.52', change: '+10.02%' },
    { code: '300750', name: '宁德时代', price: '¥342.80', change: '+8.45%' },
    { code: '600519', name: '贵州茅台', price: '¥1,685.00', change: '+5.23%' },
  ],
  losers: [
    { code: '000002', name: '万科A', price: '¥8.52', change: '-6.12%' },
    { code: '601988', name: '中国银行', price: '¥3.42', change: '-3.85%' },
    { code: '600036', name: '招商银行', price: '¥32.18', change: '-2.95%' },
  ],
};

export function MarketDashboard() {
  return (
    <div className="space-y-6">
      {/* System Suggestion Banner */}
      <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 text-white rounded-full p-2">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm opacity-70">系统推荐</div>
            <div>本周3只股票回测成功率 &gt;70%: 300750, 688981, 603259</div>
          </div>
        </div>
      </div>

      {/* Market Indices */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {marketIndices.map((index) => (
          <div key={index.name} className="bg-card border border-border rounded-lg p-4">
            <div className="text-sm text-muted-foreground mb-1">{index.name}</div>
            <div className="flex items-baseline justify-between">
              <div className="text-2xl">{index.value}</div>
              <div className={`flex items-center gap-1 ${index.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                {index.trend === 'up' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                <span>{index.change}</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-2">成交量: {index.volume}</div>
          </div>
        ))}
      </div>

      {/* Main Index Chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="mb-4">沪深300指数 - 实时走势</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={indexData}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.1} />
            <XAxis dataKey="time" stroke="#888" />
            <YAxis domain={['dataMin - 10', 'dataMax + 10']} stroke="#888" />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
              labelStyle={{ color: '#fff' }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorValue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Sector Performance & Top Stocks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sector Heatmap */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="mb-4">行业表现</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={sectorPerformance} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.1} />
              <XAxis type="number" stroke="#888" />
              <YAxis dataKey="sector" type="category" stroke="#888" width={80} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                formatter={(value: number) => `${value > 0 ? '+' : ''}${value}%`}
              />
              <Bar dataKey="change" radius={[0, 4, 4, 0]}>
                {sectorPerformance.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Gainers & Losers */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="mb-4">涨跌幅排行</h3>
          <div className="space-y-4">
            <div>
              <div className="text-sm text-muted-foreground mb-2">涨幅榜</div>
              <div className="space-y-2">
                {topStocks.gainers.map((stock) => (
                  <div key={stock.code} className="flex items-center justify-between p-2 bg-green-500/5 rounded border border-green-500/20">
                    <div>
                      <div className="text-sm">{stock.name}</div>
                      <div className="text-xs text-muted-foreground">{stock.code}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">{stock.price}</div>
                      <div className="text-xs text-green-500">{stock.change}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-2">跌幅榜</div>
              <div className="space-y-2">
                {topStocks.losers.map((stock) => (
                  <div key={stock.code} className="flex items-center justify-between p-2 bg-red-500/5 rounded border border-red-500/20">
                    <div>
                      <div className="text-sm">{stock.name}</div>
                      <div className="text-xs text-muted-foreground">{stock.code}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">{stock.price}</div>
                      <div className="text-xs text-red-500">{stock.change}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
