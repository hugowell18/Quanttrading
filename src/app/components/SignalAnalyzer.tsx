import { useState } from 'react';
import { Search, TrendingUp, TrendingDown, AlertCircle, Sparkles } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

// Generate K-line data with technical indicators
const generateKLineData = (stockCode: string) => {
  const basePrice = stockCode === '600519' ? 1680 : stockCode === '300750' ? 340 : stockCode === '000858' ? 145 : 120;
  const data = [];
  let prevClose = basePrice;

  for (let i = 0; i < 60; i++) {
    const change = (Math.random() - 0.48) * basePrice * 0.03;
    const open = prevClose;
    const close = open + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.02);
    const low = Math.min(open, close) * (1 - Math.random() * 0.02);
    const volume = Math.floor(Math.random() * 500000 + 100000);

    // Calculate KDJ
    const k = 50 + Math.sin(i * 0.3) * 30 + Math.random() * 10;
    const d = 50 + Math.sin(i * 0.3 - 0.2) * 28 + Math.random() * 8;
    const j = 3 * k - 2 * d;

    // Calculate MACD
    const dif = Math.sin(i * 0.2) * 5 + Math.random() * 2;
    const dea = Math.sin(i * 0.2 - 0.3) * 4 + Math.random() * 1.5;
    const macd = (dif - dea) * 2;

    // Calculate RSI
    const rsi = 50 + Math.sin(i * 0.25) * 25 + Math.random() * 10;

    data.push({
      date: new Date(2026, 0, i + 1).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      open: parseFloat(open.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      volume,
      k: parseFloat(k.toFixed(2)),
      d: parseFloat(d.toFixed(2)),
      j: parseFloat(j.toFixed(2)),
      dif: parseFloat(dif.toFixed(2)),
      dea: parseFloat(dea.toFixed(2)),
      macd: parseFloat(macd.toFixed(2)),
      rsi: parseFloat(rsi.toFixed(2)),
      ma5: parseFloat((close * (0.98 + Math.random() * 0.04)).toFixed(2)),
      ma10: parseFloat((close * (0.97 + Math.random() * 0.06)).toFixed(2)),
      ma20: parseFloat((close * (0.96 + Math.random() * 0.08)).toFixed(2)),
    });

    prevClose = close;
  }

  return data;
};

const stockDatabase = [
  { code: '600519', name: '贵州茅台', industry: '白酒', successRate: 78.5 },
  { code: '000858', name: '五粮液', industry: '白酒', successRate: 72.3 },
  { code: '601318', name: '中国平安', industry: '保险', successRate: 68.9 },
  { code: '600036', name: '招商银行', industry: '银行', successRate: 71.2 },
  { code: '000001', name: '平安银行', industry: '银行', successRate: 65.4 },
  { code: '601012', name: '隆基绿能', industry: '光伏', successRate: 82.1 },
  { code: '300750', name: '宁德时代', industry: '新能源', successRate: 85.7 },
];

export function SignalAnalyzer() {
  const [searchCode, setSearchCode] = useState('600519');
  const [selectedStock, setSelectedStock] = useState(stockDatabase[0]);
  const [klineData, setKlineData] = useState(generateKLineData('600519'));

  const handleSearch = () => {
    const stock = stockDatabase.find(s => s.code === searchCode);
    if (stock) {
      setSelectedStock(stock);
      setKlineData(generateKLineData(searchCode));
    }
  };

  const currentPrice = klineData[klineData.length - 1]?.close || 0;
  const priceChange = klineData.length > 1 ? currentPrice - klineData[klineData.length - 2].close : 0;
  const priceChangePercent = ((priceChange / (currentPrice - priceChange)) * 100).toFixed(2);

  // Trading statistics
  const statistics = {
    cagr: '28.5%',
    sharpe: '1.82',
    winRate: `${selectedStock.successRate}%`,
    maxDrawdown: '-12.3%',
    totalReturn: '156.8%',
    volatility: '18.2%',
  };

  // Custom candlestick component
  const Candlestick = (props: any) => {
    const { x, y, width, payload } = props;
    if (!payload || width < 1) return null;

    const isRising = payload.close >= payload.open;
    const color = isRising ? '#ef4444' : '#22c55e';

    const chartHeight = 400;
    const yDomain = [
      Math.min(...klineData.map(d => d.low)),
      Math.max(...klineData.map(d => d.high))
    ];
    const yRange = yDomain[1] - yDomain[0];

    const getY = (value: number) => {
      return chartHeight - ((value - yDomain[0]) / yRange) * chartHeight;
    };

    const highY = getY(payload.high);
    const lowY = getY(payload.low);
    const openY = getY(payload.open);
    const closeY = getY(payload.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.abs(openY - closeY);

    return (
      <g>
        <line
          x1={x + width / 2}
          y1={highY}
          x2={x + width / 2}
          y2={lowY}
          stroke={color}
          strokeWidth={1}
        />
        <rect
          x={x + 1}
          y={bodyTop}
          width={Math.max(width - 2, 1)}
          height={Math.max(bodyHeight, 1)}
          fill={isRising ? color : color}
          stroke={color}
          strokeWidth={1}
        />
      </g>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search Section */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm mb-2">股票代码</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="输入股票代码 (如: 600519)"
                className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            分析
          </button>
        </div>

        {/* Quick Select */}
        <div className="mt-4 flex flex-wrap gap-2">
          {stockDatabase.map((stock) => (
            <button
              key={stock.code}
              onClick={() => {
                setSearchCode(stock.code);
                setSelectedStock(stock);
                setKlineData(generateKLineData(stock.code));
              }}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                selectedStock.code === stock.code
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              {stock.code} {stock.name}
            </button>
          ))}
        </div>
      </div>

      {/* Stock Info & Signal Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 bg-card rounded-lg border border-border p-4">
          <div className="text-sm text-muted-foreground">当前股票</div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl">{selectedStock.code}</span>
              <span className="text-lg text-muted-foreground">{selectedStock.name}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl">¥{currentPrice.toFixed(2)}</span>
              <span className={`flex items-center gap-1 ${priceChange >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                {priceChange >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-lg border border-blue-500/20 p-4">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <Sparkles className="w-5 h-5" />
            <span>成功率</span>
          </div>
          <div className="text-3xl">{selectedStock.successRate}%</div>
          <div className="text-sm text-muted-foreground mt-1">基于历史回测</div>
        </div>

        <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 rounded-lg border border-green-500/20 p-4">
          <div className="flex items-center gap-2 text-green-600 mb-2">
            <TrendingUp className="w-5 h-5" />
            <span>预期收益</span>
          </div>
          <div className="text-3xl">+8.5%</div>
          <div className="text-sm text-muted-foreground mt-1">未来30天</div>
        </div>

        <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 rounded-lg border border-orange-500/20 p-4">
          <div className="flex items-center gap-2 text-orange-600 mb-2">
            <AlertCircle className="w-5 h-5" />
            <span>风险等级</span>
          </div>
          <div className="text-3xl">中等</div>
          <div className="text-sm text-muted-foreground mt-1">波动率 18.2%</div>
        </div>
      </div>

      {/* K-line Chart with MA */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg mb-4">K线图 & 均线系统</h3>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={klineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: 12 }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              domain={['auto', 'auto']}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
              formatter={(value: number) => value.toFixed(2)}
            />
            <Legend />
            <Bar
              dataKey="close"
              fill="transparent"
              shape={<Candlestick />}
              name="K线"
            />
            <Line type="monotone" dataKey="ma5" stroke="#ef4444" strokeWidth={1.5} dot={false} name="MA5" />
            <Line type="monotone" dataKey="ma10" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="MA10" />
            <Line type="monotone" dataKey="ma20" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="MA20" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume Chart */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg mb-4">成交量</h3>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={klineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: 12 }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
            />
            <Bar
              dataKey="volume"
              fill="#3b82f6"
              opacity={0.7}
              name="成交量"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Technical Indicators */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* KDJ Indicator */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg mb-4">KDJ 随机指标</h3>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={klineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" label="超买" />
              <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" label="超卖" />
              <Line type="monotone" dataKey="k" stroke="#3b82f6" strokeWidth={2} dot={false} name="K" />
              <Line type="monotone" dataKey="d" stroke="#ef4444" strokeWidth={2} dot={false} name="D" />
              <Line type="monotone" dataKey="j" stroke="#8b5cf6" strokeWidth={2} dot={false} name="J" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">K值</div>
              <div className="text-xl text-blue-600">{klineData[klineData.length - 1]?.k}</div>
            </div>
            <div>
              <div className="text-muted-foreground">D值</div>
              <div className="text-xl text-red-600">{klineData[klineData.length - 1]?.d}</div>
            </div>
            <div>
              <div className="text-muted-foreground">J值</div>
              <div className="text-xl text-purple-600">{klineData[klineData.length - 1]?.j}</div>
            </div>
          </div>
        </div>

        {/* MACD Indicator */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg mb-4">MACD 指标</h3>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={klineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
              <Bar
                dataKey="macd"
                fill="#3b82f6"
                name="MACD"
              />
              <Line type="monotone" dataKey="dif" stroke="#ef4444" strokeWidth={2} dot={false} name="DIF" />
              <Line type="monotone" dataKey="dea" stroke="#22c55e" strokeWidth={2} dot={false} name="DEA" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">DIF</div>
              <div className="text-xl text-red-600">{klineData[klineData.length - 1]?.dif}</div>
            </div>
            <div>
              <div className="text-muted-foreground">DEA</div>
              <div className="text-xl text-green-600">{klineData[klineData.length - 1]?.dea}</div>
            </div>
            <div>
              <div className="text-muted-foreground">MACD</div>
              <div className="text-xl text-blue-600">{klineData[klineData.length - 1]?.macd}</div>
            </div>
          </div>
        </div>

        {/* RSI Indicator */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg mb-4">RSI 相对强弱指标</h3>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={klineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" label="超买" />
              <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" label="超卖" />
              <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
              <Line type="monotone" dataKey="rsi" stroke="#f59e0b" strokeWidth={2} dot={false} name="RSI" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-4 text-center">
            <div className="text-sm text-muted-foreground">当前RSI</div>
            <div className="text-3xl text-orange-600 mt-1">{klineData[klineData.length - 1]?.rsi}</div>
          </div>
        </div>

        {/* Trading Statistics */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg mb-4">回测统计</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">年化收益率</div>
              <div className="text-2xl text-green-600 mt-1">{statistics.cagr}</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">夏普比率</div>
              <div className="text-2xl mt-1">{statistics.sharpe}</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">胜率</div>
              <div className="text-2xl text-blue-600 mt-1">{statistics.winRate}</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">最大回撤</div>
              <div className="text-2xl text-red-600 mt-1">{statistics.maxDrawdown}</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">累计收益</div>
              <div className="text-2xl text-green-600 mt-1">{statistics.totalReturn}</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">波动率</div>
              <div className="text-2xl text-orange-600 mt-1">{statistics.volatility}</div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Strategy Explanation */}
      <div className="bg-gradient-to-br from-purple-500/10 to-blue-600/10 rounded-lg border border-purple-500/20 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg">AI 策略分析</h3>
        </div>
        <div className="space-y-3 text-sm">
          <p>
            <strong>技术面分析：</strong>
            {selectedStock.code} ({selectedStock.name}) 当前处于{priceChange > 0 ? '上升' : '下降'}趋势中，MA5{klineData[klineData.length - 1]?.ma5 > klineData[klineData.length - 1]?.ma10 ? '已突破' : '低于'}MA10{klineData[klineData.length - 1]?.ma5 > klineData[klineData.length - 1]?.ma10 ? '形成金叉，短期多头力量较强' : '，短期需谨慎'}。
            KDJ指标显示K值为 {klineData[klineData.length - 1]?.k.toFixed(1)}，处于{klineData[klineData.length - 1]?.k > 80 ? '超买区域，需警惕回调风险' : klineData[klineData.length - 1]?.k < 20 ? '超卖区域，可能存在反弹机会' : '正常区间'}。
          </p>
          <p>
            <strong>交易信号：</strong>
            MACD指标呈现{klineData[klineData.length - 1]?.macd > 0 ? '多头排列' : '空头排列'}，
            DIF线{klineData[klineData.length - 1]?.dif > klineData[klineData.length - 1]?.dea ? '上穿' : '下穿'}DEA线。
            RSI为{klineData[klineData.length - 1]?.rsi.toFixed(1)}，{klineData[klineData.length - 1]?.rsi > 70 ? '已超买' : klineData[klineData.length - 1]?.rsi < 30 ? '已超卖' : '处于正常水平'}。
            建议{selectedStock.successRate > 75 ? '积极关注，可考虑分批建仓' : '谨慎观望，等待更明确信号'}。
          </p>
          <p>
            <strong>风险提示：</strong>
            当前成交量{klineData[klineData.length - 1]?.volume > 300000 ? '放大' : '萎缩'}，
            需注意主力资金动向。建议设置止损位在 ¥{(currentPrice * 0.95).toFixed(2)}，止盈位在 ¥{(currentPrice * 1.12).toFixed(2)}。
            历史成功率为 {selectedStock.successRate}%，属于{selectedStock.successRate > 75 ? '高胜率' : '中等胜率'}策略。
          </p>
        </div>
      </div>
    </div>
  );
}
