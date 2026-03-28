# A股短线量化交易系统重构 — 阶段性任务书 v3.0

> **版本说明：** 基于 v2.0 任务书，结合现有代码库实际状态（截至2026-03-28）全面更新。已完成项以 ✅ 标注，部分完成以 🔶 标注，未开始以 ❌ 标注。
>
> **重要背景：** 现有代码库已有一套成熟的**蓝筹股超卖反弹策略**（reverse-label ML系统），经36支A股主要蓝筹股验证，strictPass率>70%。v3.0任务书在此基础上叠加构建**涨停板情绪驱动系统**，两套策略共用底层数据层。
>
> **技术栈：** Node.js（主逻辑）+ Python（AKShare/实时数据）+ Tushare Pro（2000-5000积分）+ AKShare（免费）

---

## 现有代码库状态总览

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| K线数据层 | `server/data/csv-manager.mjs` | ✅ 完成 | Tushare日线+前复权，增量更新，本地CSV缓存 |
| 技术指标计算 | `server/reverse-label/data-engine.mjs` | ✅ 完成 | MA/RSI/KDJ/ATR/ADX/BOLL全套 |
| 超卖信号标注 | `server/reverse-label/signal-labeler.mjs` | ✅ 完成 | 6选3超卖规则，后验5日收益验证 |
| 市场制度识别 | `server/reverse-label/regime-detector.mjs` | ✅ 完成 | 5状态（ADX/ATR驱动），防闪烁确认 |
| ML模型选择 | `server/reverse-label/model-selector.mjs` | ✅ 完成 | 精准率优先评分，precision*0.65+F1*0.35 |
| 前向验证器 | `server/reverse-label/validator.mjs` | ✅ 完成 | 滑动窗口回测，全局预训练模型打分 |
| 参数优化器 | `server/reverse-label/optimizer.mjs` | ✅ 完成 | 216信号×4出场=864组，期望收益过滤 |
| 批量扫描 | `server/reverse-label/batch-runner.mjs` | ✅ 完成 | 50支蓝筹，strictPass标准，结果保存 |
| 信号刷新 | `server/reverse-label/refresh-signals.mjs` | ✅ 完成 | 更新数据+重跑optimizer，输出今日信号 |
| 实时行情抓取 | `server/signal/fetch_realtime.py` | 🔶 框架完成 | AKShare+EastMoney双源，有涨停池接口，无入库流程 |
| 实时信号扫描 | `server/signal/realtime-scanner.mjs` | 🔶 框架完成 | 多模式扫描，板块监控框架，无选股逻辑 |
| 板块数据研究 | `server/research/akshare_fetch.py` | 🔶 框架完成 | 行业历史数据，可获涨停池/成分股 |
| 行业信号验证 | `server/research/industry-signal-verify.mjs` | 🔶 研究用途 | 人工研究案例，非生产模块 |
| 诊断探针 | `server/reverse-label/probe.mjs` | ✅ 完成 | 快速单配置诊断工具 |

**当前蓝筹股超卖策略战绩（2026-03-28）：**
- 已测试50支主要A股蓝筹，**strictPassed 36支（72%）**
- 最强：阳光电源(300274) 胜率90.9%，用友网络(600588) avgReturn 8.5%
- 数据截至3月27日，大盘目前在MA20下方，当前信号全部为HOLD/SELL

---

## Phase 1：情绪监控系统（第1-2周）

> **状态调整：** 数据基础层和状态机框架已有，主要补齐涨停板数据接入和情绪指标计算。预计2周完成（原3周）。

### 1.1 涨停池数据采集

| 项目 | 状态 | 说明 |
|------|------|------|
| AKShare接口调用 | 🔶 | `fetch_realtime.py`已有`stock_zt_pool_em()`调用，字段解析完整 |
| 本地持久化存储 | ❌ | 无CSV/数据库入库，只有临时JSON缓存 |
| 异常处理+日志 | 🔶 | 有基础try/catch，缺日志记录 |
| 非交易日跳过 | ❌ | 未做 |

**待开发：** 将`fetch_realtime.py`的涨停池抓取结果持久化到`cache/ztpool/YYYYMMDD.json`，补全炸板池`stock_zt_pool_zbgc_em()`和跌停池`stock_zt_pool_dtgc_em()`字段。

### 1.2 炸板池+跌停池采集

| 项目 | 状态 | 说明 |
|------|------|------|
| AKShare接口 | ❌ | `fetch_realtime.py`有ztpool，炸板/跌停未接入 |
| 与涨停池同步存储 | ❌ | 无 |

### 1.3 Tushare Pro冗余备份层

| 项目 | 状态 | 说明 |
|------|------|------|
| Tushare日线/资金流 | ✅ | `csv-manager.mjs`已完整实现 |
| `kpl_list`涨停板列表（5000积分） | ❌ | 未接入 |
| `limit_list_d`涨跌停汇总（2000积分） | ❌ | 未接入 |
| AKShare异常自动切换Tushare | ❌ | 未实现fallback逻辑 |

### 1.4 情绪核心指标计算引擎

| 项目 | 状态 | 说明 |
|------|------|------|
| 涨停家数（含一字板/非一字板） | ❌ | 未开发 |
| 连板高度（全市场最高连板数） | ❌ | 未开发 |
| 炸板率 = 炸板数/(涨停数+炸板数) | ❌ | 未开发 |
| 涨跌停比 | ❌ | 未开发 |
| 封板率 | ❌ | 未开发 |
| 昨日涨停溢价 | ❌ | 未开发 |

**待开发：** 新建`server/sentiment/sentiment-engine.mjs`，读取1.1-1.3数据，输出上述6项指标。

### 1.5 5状态情绪周期状态机

| 项目 | 状态 | 说明 |
|------|------|------|
| 状态机框架 | ✅ | `regime-detector.mjs`已有5状态框架+防闪烁机制 |
| 状态定义 | 🔶 | **现有状态基于ADX/ATR**（uptrend/downtrend/breakout/high_vol/range），与任务书要求的涨停板驱动不同 |
| 涨停板驱动状态切换 | ❌ | 需新建基于1.4情绪指标的状态机：冰点/启动/主升/高潮/退潮 |
| 仓位上限绑定 | ❌ | 未做 |
| 连续2日滞后确认 | ✅ | `regime-detector.mjs`已有`confirmDays`防闪烁 |

**注意：** 现有`regime-detector.mjs`服务于蓝筹反弹策略，继续保留。新建`server/sentiment/sentiment-state-machine.mjs`实现涨停板情绪状态机，两者并存。

### 1.6 历史数据回填

| 项目 | 状态 | 说明 |
|------|------|------|
| K线历史数据 | ✅ | `csv-manager.mjs`已支持2022年起全量拉取 |
| 涨停池历史数据（2023-至今） | ❌ | AKShare历史接口未对接，无存储 |

### 1.7 可视化仪表盘+推送

| 项目 | 状态 | 说明 |
|------|------|------|
| 情绪状态报告 | ❌ | 未开发 |
| 微信/钉钉webhook推送 | ❌ | 未开发 |

### 阶段交付物

**新增文件：**
- `server/sentiment/sentiment-engine.mjs` — 情绪指标计算
- `server/sentiment/sentiment-state-machine.mjs` — 涨停板5状态机
- `server/sentiment/ztpool-collector.mjs` — 涨停/炸板/跌停池每日收集
- `server/sentiment/push-notifier.mjs` — 推送通知

**改造文件：**
- `server/signal/fetch_realtime.py` — 补充炸板池/跌停池，加入持久化

---

## Phase 2：双通道选股引擎（第3-5周）

> **状态调整：** realtime-scanner.mjs已有扫描框架和板块监控，选股逻辑、评分体系全部待开发。预计3周（原4周）。

### 通道A：跟风补涨策略（尾盘14:30-14:50窗口）

| 编号 | 任务 | 状态 | 说明 |
|:---:|------|------|------|
| 2A.1 | 跟风补涨选股模型 | 🔶 | `realtime-scanner.mjs`有板块监控框架，筛选逻辑（涨幅5%-9%/量比/市值/累涨）未实现 |
| 2A.2 | 市值分档仓位控制 | ❌ | 未开发（<50亿20%/50-100亿18%/100-150亿15%） |
| 2A.3 | 首板质量评分 | ❌ | 封成比/首封时间/封流比三维评分未开发；`akshare_fetch.py`可拿涨停池字段作为数据源 |

### 通道B：龙头二板接力策略（竞价9:25窗口）

| 编号 | 任务 | 状态 | 说明 |
|:---:|------|------|------|
| 2B.1 | 二板接力候选识别 | ❌ | 前日首板+今日竞价3-5%高开筛选，未开发 |
| 2B.2 | 竞价质量筛选 | ❌ | 竞昨比/竞价换手率/昨日封成比/市值/板块，未开发 |
| 2B.3 | 竞价介入信号 | ❌ | 9:25信号输出，未开发 |

### 龙头首阴反包模型

| 编号 | 任务 | 状态 | 说明 |
|:---:|------|------|------|
| 2C.1 | 龙头首阴反包 | ❌ | 连板≥3后首阴识别，竞价/尾盘介入逻辑，未开发 |

### 共振过滤层

| 编号 | 任务 | 状态 | 说明 |
|:---:|------|------|------|
| 2D.1 | 技术指标共振加分 | 🔶 | `data-engine.mjs`已有MACD/RSI/MA/BOLL全部指标计算；需新建加分逻辑集成到选股引擎 |

### 综合评分与输出

| 编号 | 任务 | 状态 | 说明 |
|:---:|------|------|------|
| 2E.1 | 综合评分体系 | 🔶 | `optimizer.mjs`有成熟的评分框架，需重新设计针对短线选股的5维评分（板块集中度25%/量价强度25%/封单质量20%/市值弹性15%/技术共振15%） |
| 2E.2 | 信号输出与推送 | ❌ | 双窗口推送未开发；`realtime-scanner.mjs`有JSON输出框架可复用 |

### 阶段交付物

**新增文件：**
- `server/signal/channel-a-selector.mjs` — 跟风补涨选股
- `server/signal/channel-b-selector.mjs` — 龙头二板接力
- `server/signal/ipo-reversal.mjs` — 首阴反包模型
- `server/signal/scoring-engine.mjs` — 统一评分引擎

**改造文件：**
- `server/signal/realtime-scanner.mjs` — 集成通道A/B，接入评分引擎

---

## Phase 3：主线板块识别模块（第6-7周）

> **状态调整：** `akshare_fetch.py`和`industry-signal-verify.mjs`提供了研究框架，生产级实现全部待开发。预计2周（原3周）。

| 编号 | 任务 | 状态 | 说明 |
|:---:|------|------|------|
| 3.1 | 板块涨停集中度计算 | 🔶 | `akshare_fetch.py`能拿涨停池板块字段，集中度统计逻辑未封装为生产模块 |
| 3.2 | 主线确认规则引擎 | 🔶 | `industry-signal-verify.mjs`有研究原型，生产级连续2日确认+板块指数MA5过滤未开发 |
| 3.3 | 板块RPS排名系统 | ❌ | 3日/10日/20日RPS计算，未开发 |
| 3.4 | 龙头-跟风映射 | ❌ | 连板数+封单强度识别龙头，关联跟风候选，未开发 |
| 3.5 | 板块轮动预警 | ❌ | 双类型轮动信号，未开发 |

### 阶段交付物

**新增文件：**
- `server/sector/sector-engine.mjs` — 板块识别主模块
- `server/sector/rps-calculator.mjs` — RPS排名计算
- `server/sector/rotation-detector.mjs` — 轮动预警

---

## Phase 4：风控集成与实盘切换（第8-10周）

> **所有子任务均未开发**。现有`optimizer.mjs`的止损逻辑仅用于历史回测，非实时风控。

| 编号 | 任务 | 状态 | 说明 |
|:---:|------|------|------|
| 4.1 | 仓位管理模块 | ❌ | 情绪状态机→总仓位上限，通道A 70%/通道B 30% |
| 4.2 | 三层止损规则引擎 | ❌ | 竞价止损/盘中止损/情绪止损 |
| 4.3 | 连续亏损暂停机制 | ❌ | 3连亏→暂停2日 |
| 4.4 | 核心因子周频版本 | ❌ | 日频/周频双版本，IC监控 |
| 4.5 | 监管合规模块 | ❌ | 撤单次数/交易间隔/程序化申报 |
| 4.6 | 每日自动复盘报告 | ❌ | 16:00前推送，含盈亏归因 |
| 4.7 | 因子有效性监控 | ❌ | 滚动IC/ICIR，连续2周IC<1%预警 |
| 4.8 | 模拟盘运行30交易日 | ❌ | Paper Trading，参数锁定 |
| 4.9 | 实盘切换 | ❌ | QMT/MiniQMT接入，首月半仓 |

---

## 总览

### 时间线（更新版）

| 阶段 | 周期 | 核心交付 | 状态 | 节省原因 |
|:---:|:---:|--------|:---:|--------|
| Phase 0（已完成） | — | 蓝筹超卖ML策略，50股验证，数据层，技术指标 | ✅ | 现有代码 |
| Phase 1 | 第1-2周 | 涨停板数据层+情绪状态机 | ❌ | 状态机框架/数据接口已有，省1周 |
| Phase 2 | 第3-5周 | 双通道选股引擎 | ❌ | 扫描框架/指标已有，省1周 |
| Phase 3 | 第6-7周 | 主线板块识别 | ❌ | 研究原型/数据源已有，省1周 |
| Phase 4 | 第8-10周 | 风控集成+模拟盘30日 | ❌ | — |

**总周期：约10周（原13周），节省3周。**

### 复用关系说明

| 现有模块 | 被哪些新模块复用 |
|---------|----------------|
| `csv-manager.mjs` K线缓存 | Phase 2/3 选股引擎的K线数据 |
| `data-engine.mjs` 技术指标 | Phase 2 共振过滤层（2D.1） |
| `regime-detector.mjs` 制度识别 | 继续服务蓝筹策略；Phase 1新情绪机独立并行 |
| `optimizer.mjs` 评分框架 | Phase 2 综合评分体系设计参考 |
| `realtime-scanner.mjs` 扫描框架 | Phase 2 通道A/B直接在此扩展 |
| `akshare_fetch.py` 数据源 | Phase 1 涨停池，Phase 3 板块数据 |

### 两套策略并行架构

```
                  ┌─────────────────────────────────┐
                  │         共用数据层               │
                  │  csv-manager + data-engine       │
                  └──────────┬──────────────┬────────┘
                             │              │
          ┌──────────────────▼──┐    ┌──────▼───────────────────┐
          │   蓝筹超卖反弹策略   │    │    涨停板情绪驱动策略      │
          │  (Phase 0 已完成)   │    │    (Phase 1-4 待开发)     │
          │                     │    │                           │
          │ signal-labeler      │    │ sentiment-engine          │
          │ regime-detector     │    │ sentiment-state-machine   │
          │ optimizer           │    │ channel-a/b-selector      │
          │ batch-runner        │    │ sector-engine             │
          │ refresh-signals     │    │ risk-manager              │
          └──────────┬──────────┘    └──────────┬────────────────┘
                     │                          │
                     └──────────┬───────────────┘
                                │
                        ┌───────▼────────┐
                        │  信号推送输出   │
                        │  微信/钉钉     │
                        └────────────────┘
```

### 数据源成本预算（不变）

| 数据源 | 用途 | 年化成本 |
|:---|:---|:---:|
| AKShare | 涨停池/炸板池/跌停池/实时快照/板块异动 | 免费 |
| Tushare Pro 2000积分 | 日线/资金流/龙虎榜/北向资金/板块日线 | ~200元/年 |
| Tushare Pro 5000积分（推荐） | 以上全部 + 竞价数据 + 涨停板列表 | ~500元/年 |
| **合计** | — | **~500元/年** |
