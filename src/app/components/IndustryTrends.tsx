import { Flame, Zap, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from 'recharts';

const industryRotation = [
  { name: '半导体', status: 'hot', change: '+3.2%', momentum: 95 },
  { name: '人工智能', status: 'hot', change: '+2.8%', momentum: 88 },
  { name: '新能源汽车', status: 'warming', change: '+1.5%', momentum: 65 },
  { name: '生物医药', status: 'warming', change: '+0.8%', momentum: 52 },
  { name: '消费电子', status: 'neutral', change: '+0.2%', momentum: 35 },
  { name: '金融服务', status: 'cooling', change: '-0.3%', momentum: 28 },
  { name: '传统制造', status: 'cooling', change: '-1.2%', momentum: 15 },
  { name: '房地产', status: 'cold', change: '-1.8%', momentum: 8 },
];

const bubbleData = [
  { sector: '半导体', momentum: 95, volume: 2500, return: 3.2 },
  { sector: 'AI', momentum: 88, volume: 2200, return: 2.8 },
  { sector: '新能源', momentum: 65, volume: 1800, return: 1.5 },
  { sector: '医疗', momentum: 52, volume: 1200, return: 0.8 },
  { sector: '消费', momentum: 35, volume: 900, return: 0.2 },
  { sector: '金融', momentum: 28, volume: 1500, return: -0.3 },
  { sector: '地产', momentum: 8, volume: 600, return: -1.8 },
];

const radarData = [
  { category: '市场热度', 半导体: 95, 新能源: 65, 医疗: 52 },
  { category: '资金流入', 半导体: 88, 新能源: 72, 医疗: 45 },
  { category: '政策支持', 半导体: 92, 新能源: 85, 医疗: 78 },
  { category: '技术创新', 半导体: 90, 新能源: 80, 医疗: 70 },
  { category: '盈利增长', 半导体: 75, 新能源: 68, 医疗: 55 },
  { category: '估值水平', 半导体: 60, 新能源: 50, 医疗: 65 },
];

const capitalFlow = [
  { sector: '半导体', inflow: 125.8, color: '#22c55e' },
  { sector: '人工智能', inflow: 98.5, color: '#22c55e' },
  { sector: '新能源', inflow: 67.2, color: '#22c55e' },
  { sector: '医疗', inflow: 32.5, color: '#3b82f6' },
  { sector: '消费', inflow: -15.8, color: '#ef4444' },
  { sector: '金融', inflow: -42.3, color: '#ef4444' },
  { sector: '房地产', inflow: -68.5, color: '#ef4444' },
];

export function IndustryTrends() {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'hot': return 'text-red-500 bg-red-500/10 border-red-500/30';
      case 'warming': return 'text-orange-500 bg-orange-500/10 border-orange-500/30';
      case 'neutral': return 'text-blue-500 bg-blue-500/10 border-blue-500/30';
      case 'cooling': return 'text-cyan-500 bg-cyan-500/10 border-cyan-500/30';
      case 'cold': return 'text-gray-500 bg-gray-500/10 border-gray-500/30';
      default: return 'text-gray-500 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'hot': return <Flame className="w-4 h-4" />;
      case 'warming': return <Zap className="w-4 h-4" />;
      case 'neutral': return <TrendingUp className="w-4 h-4" />;
      default: return <TrendingDown className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Summary Banner */}
      <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <div className="bg-purple-500 text-white rounded-full p-2">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1">AI市场洞察</div>
            <div className="leading-relaxed">
              本周，<span className="text-purple-400 font-medium">人工智能 + 半导体</span> 板块显示强劲上涨动能。
              政策利好叠加技术突破，资金持续流入。建议关注芯片设计、AI算力相关龙头企业。
              新能源板块保持温和上涨，中长期配置价值显现。
            </div>
          </div>
        </div>
      </div>

      {/* Industry Rotation Panel */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="mb-4">行业轮动态势</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {industryRotation.map((industry) => (
            <div
              key={industry.name}
              className={`p-4 rounded-lg border ${getStatusColor(industry.status)}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(industry.status)}
                  <span>{industry.name}</span>
                </div>
                <span className={industry.change.startsWith('+') ? 'text-green-500' : 'text-red-500'}>
                  {industry.change}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-current rounded-full transition-all"
                    style={{ width: `${industry.momentum}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{industry.momentum}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bubble Chart - Sector Activity */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="mb-4">板块活跃度矩阵</h3>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.1} />
            <XAxis
              type="number"
              dataKey="momentum"
              name="动量"
              stroke="#888"
              label={{ value: '市场动量', position: 'insideBottom', offset: -5 }}
            />
            <YAxis
              type="number"
              dataKey="return"
              name="收益率"
              stroke="#888"
              label={{ value: '涨跌幅 (%)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
              formatter={(value: number, name: string) => {
                if (name === '成交量') return `¥${value}亿`;
                if (name === '收益率') return `${value}%`;
                return value;
              }}
            />
            <Scatter name="行业板块" data={bubbleData}>
              {bubbleData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.return > 1 ? '#22c55e' : entry.return < 0 ? '#ef4444' : '#3b82f6'}
                  fillOpacity={0.6}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="text-xs text-muted-foreground mt-2">
          * 气泡大小代表成交量，颜色代表涨跌趋势（绿色上涨/红色下跌）
        </div>
      </div>

      {/* Radar Chart & Capital Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar Chart */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="mb-4">热门板块综合评分</h3>
          <ResponsiveContainer width="100%" height={350}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#333" />
              <PolarAngleAxis dataKey="category" stroke="#888" />
              <PolarRadiusAxis stroke="#888" />
              <Radar name="半导体" dataKey="半导体" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
              <Radar name="新能源" dataKey="新能源" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
              <Radar name="医疗" dataKey="医疗" stroke="#a855f7" fill="#a855f7" fillOpacity={0.3} />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Capital Flow */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            资金流向趋势
          </h3>
          <div className="space-y-3">
            {capitalFlow.map((item) => (
              <div key={item.sector} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{item.sector}</span>
                  <span className={item.inflow > 0 ? 'text-green-500' : 'text-red-500'}>
                    {item.inflow > 0 ? '+' : ''}{item.inflow}亿
                  </span>
                </div>
                <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.abs(item.inflow) / 125.8 * 100}%`,
                      backgroundColor: item.color,
                      marginLeft: item.inflow < 0 ? 'auto' : '0'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>资金净流入</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span>资金净流出</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trending Concepts */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="mb-4">概念题材热度榜</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { name: 'ChatGPT', heat: 98, trend: 'up' },
            { name: '算力租赁', heat: 92, trend: 'up' },
            { name: '固态电池', heat: 85, trend: 'up' },
            { name: '低空经济', heat: 78, trend: 'up' },
            { name: '脑机接口', heat: 72, trend: 'neutral' },
            { name: '量子计算', heat: 65, trend: 'neutral' },
            { name: '卫星互联网', heat: 58, trend: 'down' },
            { name: '元宇宙', heat: 42, trend: 'down' },
          ].map((concept) => (
            <div key={concept.name} className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">{concept.name}</span>
                {concept.trend === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : concept.trend === 'down' ? (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                ) : (
                  <div className="w-4 h-4" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      concept.heat >= 80 ? 'bg-red-500' :
                      concept.heat >= 60 ? 'bg-orange-500' :
                      'bg-blue-500'
                    }`}
                    style={{ width: `${concept.heat}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{concept.heat}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
