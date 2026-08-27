---
description: 商业与财会专题：金融学、会计学、公司金融、计量经济学等 19 门课程，按知识依赖顺序组织
---

## 商业与财会简介

本专题覆盖货币银行、会计、微观与宏观、公司金融、计量与量化、固定收益与金融工程等 **19 门课 · 193 篇**，按知识依赖顺序排列。每门课一个目录，内含课程索引与全部文章。

对 AI 产品从业者，这是金融与财务的领域知识底座：做金融、量化或投研类产品，需要货币、利率、市场与估值的语言；做商业化与定价，会计与公司金融给出成本、收益与资本结构的判断框架；Agent 在投研、风控、合规等场景落地，则需要宏观、固定收益与金融工程的底子。它与本站其他专题的分工：[产品方法论](../pm/index.md)回答「怎么判断、怎么设计」，[AI 基础](../ai/index.md)回答「模型能做什么」，本专题回答「金融与财务领域是怎么运转的」。

## 课程列表

| 课程 | 文章数 | 类别定位 |
| --- | --- | --- |
| [金融学](01-finance/index.md) | 15 | 货币银行学入门：货币制度、信用、利率、金融机构、金融市场、货币政策 |
| [会计学](02-accounting/index.md) | 10 | 会计基础：会计假设与要素、复式记账、主要资产科目核算 |
| [中级微观经济学](03-intermediate-microeconomics/index.md) | 12 | 消费者与生产者理论、市场结构、一般均衡 |
| [宏观经济学](04-macroeconomics/index.md) | 10 | 国民收入核算、IS-LM、AD-AS、开放经济、增长 |
| [公司金融](05-corporate-finance/index.md) | 13 | 公司治理、项目评估、估值、资本成本与资本结构、股利政策 |
| [商业银行经营与管理](06-commercial-banking/index.md) | 10 | 银行资本、负债与资产业务、信用分析、资产负债管理 |
| [政治经济学](07-political-economy/index.md) | 10 | 剩余价值理论、中国经济史与经济发展道路、经济转轨、共同富裕 |
| [计量经济学](08-econometrics/index.md) | 9 | 线性回归、多重共线性与异方差、工具变量、时间序列平稳性 |
| [国际金融学](09-international-finance/index.md) | 11 | 国际收支、外汇与汇率、汇率决定理论、国际货币体系 |
| [证券投资学](10-securities-investment/index.md) | 11 | 投资工具、资产组合理论、估值、宏观行业公司分析、技术分析 |
| [中级财务会计学](11-intermediate-financial-accounting/index.md) | 14 | 金融工具、长期股权投资、固定资产、负债、收入确认、财务报表 |
| [中级宏观经济学](12-intermediate-macroeconomics/index.md) | 9 | 动态宏观：代表性行为人、动态规划、RBC、OLG |
| [随机过程](13-stochastic-processes/index.md) | 7 | 泊松过程、马尔可夫链、平稳过程、布朗运动 |
| [金融计量模型](14-financial-econometrics/index.md) | 8 | 时间序列：ARMA、ARCH/GARCH、单位根、VAR、协整 |
| [量化投资](15-quantitative-investing/index.md) | 7 | 因子投资、多因子选股、风险模型、另类数据、大模型应用 |
| [金融学论文写作](16-finance-writing/index.md) | 9 | 论文九步法、实证方法与 Stata、稳健性与内生性、数字金融研究 |
| [固定收益证券分析和模型](17-fixed-income/index.md) | 9 | 债券定价、久期与凸性、利率衍生品、利率树模型 |
| [金融工程学](18-financial-engineering/index.md) | 9 | 远期期货、互换、期权定价与数值方法、交易策略、奇异期权 |
| [前沿金融实务专题](19-frontier-finance-practice/index.md) | 10 | 公募基金、券商业务、交易所机制、股权投资、北交所、期货实务 |

## 课程地图

19 门课不是 19 个互不相干的目录，而是围绕四条依赖链展开的知识网络：**数学链**（计量与量化）、**财会链**（会计与报表）、**宏观链**（基础到研究生）、**金融链**（货币、国际与证券）。本专题虽按知识依赖顺序排列，但**不是**一条必须从头走到尾的线——下面按「前置依赖 → 难度阶梯 → 按角色选课 → 可跳过 → 跨区块衔接」五步组织，帮助 AI 产品从业者按需取用。

> **快速上手**：时间紧张时，先按「哪些课可跳过」砍掉 12/13/16，再按「按角色选课」选一条路径；遇到看不懂的术语，用对应课程目录反查即可。

### 前置依赖链

四条链的递进关系可先看这张总览：

| 依赖链 | 起点 | 递进 | 落点 |
| --- | --- | --- | --- |
| 数学链 | 概率统计基础（站内无独立统计课） | 08-econometrics → 14-financial-econometrics | 13-stochastic-processes → 17-固定收益、18-金融工程 |
| 财会链 | 02-accounting | 11-intermediate-financial-accounting | 05-corporate-finance的报表分析与估值 |
| 宏观链 | 04-macroeconomics | 12-intermediate-macroeconomics（研究生水平） | — |
| 金融链 | 01-finance | 09-international-finance、10-securities-investment | 10 与 05 交叉（估值） |

**① 数学链（计量与量化）**：从概率统计出发，分岔为「回归 → 时间序列」与「随机过程 → 定价模型」两支，是量化的数理底座。

- [08-计量经济学](08-econometrics/index.md)：线性回归、多重共线性与异方差、工具变量、时间序列平稳性。**需要统计学/概率基础**——站内没有独立统计课，建议先补概率统计基础（正态分布、假设检验、线性回归）再进入；学完可读懂实证论文的识别策略与回归表。
- [14-金融计量模型](14-financial-econometrics/index.md)：ARMA、ARCH/GARCH、单位根、VAR、协整。**依赖 08**：时间序列是截面回归的接续，08 打底后学 14 才顺；学完可上手金融与宏观数据的建模。
- [13-随机过程](13-stochastic-processes/index.md)：泊松过程、马尔可夫链、平稳过程、布朗运动。是 [17-固定收益证券分析和模型](17-fixed-income/index.md)（连续时间利率模型）与 [18-金融工程学](18-financial-engineering/index.md)（BSM 期权定价）的**真实依赖**——三者共用布朗运动与伊藤引理；但 17/18 各自就地速成所需部分，不必先完整读完 13。

**② 财会链（会计与报表）**：

- [02-会计学](02-accounting/index.md)（基础）→ [11-中级财务会计学](11-intermediate-financial-accounting/index.md)（深入）：02 讲会计假设、会计要素与复式记账，11 在金融工具、长期股权投资、收入确认上加深，并含现金流量表编制、合并报表等前置要求。
- [02-会计学](02-accounting/index.md) 的报表分析是 [05-公司金融](05-corporate-finance/index.md)「财务报表分析与财务模型」章的前置：02 建立报表阅读能力，05 拿来算财务比率、做杜邦分析与估值。

**③ 宏观链（基础到研究生）**：

- [04-宏观经济学](04-macroeconomics/index.md)（基础 IS-LM 水平）→ [12-中级宏观经济学](12-intermediate-macroeconomics/index.md)（研究生水平）：12 以动态最优化、RBC、OLG 为主线，**远超普通本科，按需选读**；只想理解宏观政策与周期的读者读 04 即可。

**④ 金融链（货币、国际与证券）**：

- [01-金融学](01-finance/index.md)（货币银行入门）为 [09-国际金融学](09-international-finance/index.md)（国际收支、外汇与汇率、国际货币体系）与 [10-证券投资学](10-securities-investment/index.md)（投资工具、资产组合、估值）打底。
- [10-证券投资学](10-securities-investment/index.md) 与 [05-公司金融](05-corporate-finance/index.md) 有交叉：两者都讲估值，10 的股票估值章（DDM、市盈率口径）与 05 的债券/股票估值章互补，先读其一即可互相参照。

### 难度阶梯表

| 分档 | 课程 | 适合读者 |
| --- | --- | --- |
| **商科主干**（零基础起点） | [01-金融学](01-finance/index.md)、[02-会计学](02-accounting/index.md)、[03-中级微观经济学](03-intermediate-microeconomics/index.md)、[04-宏观经济学](04-macroeconomics/index.md)、[05-公司金融](05-corporate-finance/index.md)、[07-政治经济学](07-political-economy/index.md) | 建议全学，是商业与金融的语言底座；07 提供中国经济语境 |
| **数学密集**（需较强数理功底） | [08-计量经济学](08-econometrics/index.md)、[12-中级宏观经济学](12-intermediate-macroeconomics/index.md)、[13-随机过程](13-stochastic-processes/index.md)、[14-金融计量模型](14-financial-econometrics/index.md)、[17-固定收益证券分析和模型](17-fixed-income/index.md)、[18-金融工程学](18-financial-engineering/index.md) | 做量化、风控、投研类产品者优先读 08/14；12/13 面向学术与研究，按需选读 |
| **专业进阶**（在主干上深入） | [06-商业银行经营与管理](06-commercial-banking/index.md)、[09-国际金融学](09-international-finance/index.md)、[10-证券投资学](10-securities-investment/index.md)、[11-中级财务会计学](11-intermediate-financial-accounting/index.md) | 做支付、证券、会计、银行类产品者重点；10/11 对 AI 产品从业者可直接使用 |
| **应用/研究/实务**（面向落地与产出） | [15-量化投资](15-quantitative-investing/index.md)、[16-金融学论文写作](16-finance-writing/index.md)、[19-前沿金融实务专题](19-frontier-finance-practice/index.md) | 15/19 与业务场景强相关；16 面向学术研究，按需 |

> **对 AI 产品从业者**：10/11/19 可直接使用；15 的 [大模型在量化投资中的应用](15-quantitative-investing/06-llms-in-quantitative-investing.md) 是最佳桥梁——直接展示 LLM、RAG 与强化学习在量化场景的落地；12/13/16 大概率超纲，按需跳过。

### 按角色选课

- **金融/量化产品 PM**（投研、风控、量化、交易类产品）：01 → 10 → 08 → 14 打底，再按场景进 15（量化投资）或 19（金融实务）；涉及衍生品定价时补 17/18。
- **商业化/定价 PM**（SaaS 或 AI 产品定价与单位经济）：主攻 02 → 05（成本、估值与资本结构），配合 [商业化与增长](../pm/monetization.md) 使用。
- **通用 AI PM**（领域知识储备）：读 01、02、10、11、19 打底，其余按需查阅；时间有限时直接参考「哪些课可跳过」。
- **研究/学术向读者**（学生、研究员）：完整走 01 → 04 → 08 → 14 → 16 主线，配合 12/13/17/18 做数理纵深。

### 哪些课可跳过

对目标读者「AI 产品经理」，以下三门可按需跳过，不影响主线：

- **[12-中级宏观经济学](12-intermediate-macroeconomics/index.md)**：研究生水平（动态最优化、RBC、OLG），远超普通本科与 AI 产品日常所需；对宏观议题感兴趣，读 [04-宏观经济学](04-macroeconomics/index.md) 的基础版即可。
- **[16-金融学论文写作](16-finance-writing/index.md)**：面向学术研究者（论文九步法、实证方法与 Stata）；其中的 [07-数字金融研究专题](16-finance-writing/07-digital-finance-research.md)（数字金融概念边界、DeFi、稳定币、RWA 代币化）对金融科技 PM 可用，其余可按需略过。
- **[13-随机过程](13-stochastic-processes/index.md)**：纯数学方法课；除非做量化、风控或期权定价类产品，否则可跳过——真需要时，17/18 会就地补齐布朗运动与伊藤引理。

### 跨区块指引

business 与 AI 主线的衔接点：

- **商业化与定价**：做 AI 产品的定价与单位经济，需要成本、收益与资本结构的判断框架——[05-公司金融](05-corporate-finance/index.md) 的估值与资本成本、[02-会计学](02-accounting/index.md) 的报表分析，配合 [商业化与增长](../pm/monetization.md) 使用。
- **数据分析**：[08-计量经济学](08-econometrics/index.md) 与 [14-金融计量模型](14-financial-econometrics/index.md) 的统计与因果思维，可落到 [数据分析入门](../pm/data-analysis.md) 的指标分层与漏斗分析。
- **评测与评估**：做金融、量化类 AI 产品时，模型输出质量的三层评估方法见 [评估与评测](../ai/evaluation.md)。
- **实战落地**：把领域知识做成具体 AI 产品形态（投研助手、风控助手等），可到 [AI 产品实战](../practice/index.md) 找对应场景。
