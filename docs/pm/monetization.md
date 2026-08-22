---
## AI 产品商业化与定价

商业化回答"产品如何赚钱"，增长回答"如何让更多用户用起来"。与 SaaS 不同，AI 产品的商业化有三大特殊性：**边际成本不为零**——每次推理都在消耗 GPU 与 token，用的人越多成本越高；**护栏成本**——安全、合规、评测要持续投入；**评估成本**——模型输出质量无法靠测试用例自动验收，需要评测集与人工抽检持续维护。本文结论均标注来源（截至 2026-08-23 验证可达的官方定价页），价格类信息以官方页面为准。

## 商业模式全景

主流模式有四类：订阅制、按量计费、混合模式、企业定制与私有化。

### 订阅制

按月/年收费、按能力分层（免费/个人/团队/企业），是消费级 AI 产品的主流。ChatGPT 提供免费版、Go（8 美元/月）、Plus（20 美元/月）、Pro（100 美元/月起）四档个人订阅，团队与企业另有按席位计费方案（以 [ChatGPT 官方定价页](https://chatgpt.com/zh-Hans-CN/pricing/) 为准）。Claude 同样采用免费 + Pro（20 美元/月）+ Max（100 美元/月起）+ 团队/企业席位制（以 [Claude 官方定价页](https://claude.com/pricing) 为准）。

-   优点：收入可预测、现金流稳定，用户按"价值感知"而非"用量"付费
-   缺点：必须持续提供"值得续费"的新能力；免费层成本与付费转化率的平衡难把握

### 按量计费

按 token/调用量/处理量计费，是 API 与工具类产品的主流。主流模型厂商均提供按量 API：Google [Gemini API](https://ai.google.dev/pricing) 按每百万 token 计费且 Batch 档位半价；[DeepSeek API](https://api-docs.deepseek.com/quick_start/pricing) 按 token 计费并区分高峰/非高峰价；字节[火山方舟](https://docs.volcengine.com/docs/82379/1544106)豆包模型按 token 计费，部分模型按输入长度分段计价。

-   优点：成本与收入同向变动，天然对冲推理成本风险；对低频/开发类用户友好
-   缺点：收入随用量波动；用户对"计费不可预期"敏感，需要用量预估与预算护栏

### 混合模式

订阅 + 按量的混合越来越常见。Notion 以席位订阅为主，AI 功能（Custom Agents）按"信用点（credits）"用量计费（以 [Notion 官方定价页](https://www.notion.com/pricing) 为准）；Perplexity 在订阅套餐之外提供按量付费的 API 平台（以 [Perplexity 官方帮助中心](https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you) 为准）。混合模式让"订阅保底 + 用量变现"同时成立。

### 企业定制与私有化

面向大客户的定制部署、私有化与合规定制。ChatGPT 的 Business 套餐按席位计费（按年 20 美元/用户/月，2 人起），Enterprise 为自定义价格并支持按 Token 计费（以 [ChatGPT 官方定价页](https://chatgpt.com/zh-Hans-CN/pricing/) 为准）；Claude Enterprise 采用"席位费 + API 用量费"结构（以 [Claude 官方定价页](https://claude.com/pricing) 为准）。企业市场客单价高、谈判空间大，但销售周期长、定制成本高。

### 交易抽成与收入分成

平台撮合类产品按结果抽成。Perplexity 的出版商计划（Publishers' Program）是代表性案例：当用户的互动引用了某家出版商的内容并产生广告收入时，该出版商获得分成，首批合作方包括 TIME、Fortune、Der Spiegel 等媒体（[Perplexity 官方博客](https://www.perplexity.ai/hub/blog/introducing-the-perplexity-publishers-program)）。这类模式把内容方变成利益共同体，是 AI 搜索与内容平台缓解版权争议、共建生态的商业化尝试。

### 模式小结

| 模式 | 计费单位 | 适用场景 | 代表案例 |
| --- | --- | --- | --- |
| 订阅制 | 月/年、席位 | 消费级对话产品、团队协作 | ChatGPT、Claude、Perplexity |
| 按量计费 | token、调用次数 | API、内容处理、Agent 调用 | Gemini API、DeepSeek、豆包 |
| 混合模式 | 订阅 + 用量 | 工具类产品 AI 加购 | Notion AI、Perplexity API |
| 交易抽成 | 收入分成 | 平台型产品、内容生态 | Perplexity 出版商计划 |
| 企业定制 | 合同价 | 大客户、合规敏感行业 | ChatGPT Enterprise、Claude Enterprise |

## 定价模型与 unit economics

### 两种定价锚点

-   **成本加成**：以推理成本为底价加毛利。DeepSeek 长期贴着成本底线定价（涨价前 10 元充值可用约 1 亿 token），最终因算力供给紧张大幅提价——成本结构一变价格必须跟着变，是成本加成定价的脆弱性（[人人都是产品经理](https://www.woshipm.com/ai/6451866.html)）
-   **价值定价**：按"帮用户省下/赚到的钱"定价。ChatGPT Plus 20 美元/月、Pro 100 美元/月起，定价明显高于边际成本，对应的是时间节省与生产力价值（以 [ChatGPT 官方定价页](https://chatgpt.com/zh-Hans-CN/pricing/) 为准）

### unit economics 的 AI 变体

范冰《增长黑客》提出的 LTV（用户生命周期价值）与 CAC（用户获取成本）平衡仍是根基："增长黑客就是低成本甚至零成本地用'技术'来让产品获得有效增长"（[爱范儿专访](https://www.ifanr.com/621422)）。AI 产品在此基础上多出两个必须算清的科目：

-   **推理成本/用户**：每位用户的月均 token 消耗 × 单价。它随使用深度上升——用户越"上瘾"成本越高，这是与 SaaS 最大的差异
-   **毛利率** =（收入 − 推理及算力成本）/ 收入。AI 产品毛利比传统 SaaS 更难守，三个杠杆见下

### 成本优化的三个杠杆

-   **模型选型**：简单任务用更小、更便宜的档位（如 Gemini Flash 系列标准输入 0.75 美元/百万 token 促销价，远低于 Pro 系列，以 [Gemini 官方定价页](https://ai.google.dev/pricing) 为准）
-   **缓存与批处理**：上下文缓存命中输入价约为标准输入价的 1/10（缓存存储 1 美元/百万 token/小时），Batch API 半价（以 [Gemini 官方定价页](https://ai.google.dev/pricing) 为准）
-   **峰谷计价**：DeepSeek 非高峰时段价格减半，并自 2026-08-23 起周末全天按非高峰计价（以 [DeepSeek 官方定价页](https://api-docs.deepseek.com/quick_start/pricing) 为准）——用价格杠杆把负载平移到低谷，是算力生意的典型做法

???+ note "成本预算是 PRD 的一节"
    单次调用成本、月成本与成本护栏（超限降级/关停）应写进 PRD，方法见 [LLM 成本估算](../tools/llm-cost.md)。

???+ example "单位经济演练"
    一位重度用户每月消耗 100 万输出 token：按 Gemini 3.7 Flash 标准输出价 3.75 美元/百万 token（促销价）计，直接推理成本约 3.75 美元/月，20 美元订阅毛利可观；若换成 Pro 级模型（输出 12 美元/百万 token 起），同用量成本约 12 美元/月，毛利被吃掉大半（价格以 [Gemini 官方定价页](https://ai.google.dev/pricing) 为准）——**模型选型直接决定 unit economics**。

## 真实定价案例

### ChatGPT：分层订阅 + 企业双轨

个人免费版之外，Go 8 美元/月、Plus 20 美元/月、Pro 100 美元/月起；团队 Business 按年 20 美元/用户/月（2 人起）、按月 25 美元；Enterprise 自定义价格并支持按 Token 计费（以 [ChatGPT 官方定价页](https://chatgpt.com/zh-Hans-CN/pricing/) 为准，2026-08-23 引用）。低门槛免费/低价层承担拉新，高价层承担重度用户变现，企业双轨承担大客户收入。

### Claude：订阅 + API 双轨

Pro 20 美元/月（年付约 17 美元/月）、Max 从 100 美元/月起（5 倍/20 倍用量）、Team 25 美元/席位/月（年付 20 美元）、Enterprise 自服务版从 20 美元/席位起、销售协助版为席位费 + API 用量费（以 [Claude 官方定价页](https://claude.com/pricing) 为准，2026-08-23 引用）。订阅面向终端用户、API 面向开发者，两条收入曲线互不挤占。

### Gemini API：免费层 + 按量 + 缓存

Google 为 Gemini API 提供免费层（免费输入输出 token，适合开发者与小型项目起步），付费层按量计费且数据不用于改进产品，Batch/Flex 档位半价，上下文缓存大幅降低重复前缀成本（以 [Gemini 官方定价页](https://ai.google.dev/pricing) 为准，2026-08-23 引用）。免费层是典型的"开发者漏斗"：先零成本试用，再随用量自然付费。

### DeepSeek：低价 API 与 2026 涨价

DeepSeek 的差异化是极低的 API 价格与"无订阅"策略——没有会员与增值服务，收入几乎全靠 API（[人人都是产品经理](https://www.woshipm.com/ai/6451866.html)）。2026-08-17 起大幅提价：V4 Pro 峰时缓存命中单价涨约 12 倍（0.003625 → 0.044 美元/百万 token）、输出涨约 4.5 倍（0.87 → 3.96 美元），当前官方结构为"高峰价 = 非高峰价 × 2"（以 [DeepSeek 官方定价页](https://api-docs.deepseek.com/quick_start/pricing) 为准）。行业影响：国产模型"低价换规模"阶段宣告终结，竞品集体跟涨（Kimi K3 输出涨约 3.5 倍、智谱年内三次提价累计 83%、腾讯混元单项接口最高涨 463%）；但涨价立即带来用户流失——OpenCode 平台上 DeepSeek 调用量次日下降约 55%–59%（[人人都是产品经理](https://www.woshipm.com/ai/6451866.html)）。教训：**价格是用户迁移的触发器，低价策略退出时必须同时准备好留存手段**。

### 豆包：免费额度 + 按量计费

字节火山方舟的豆包模型按 token 计费，部分模型按输入长度分段计价（如某次请求输入 20 万 token、输出 1.4 万 token 时，按"输入长度（128, 256] 千 token"档位计费：输入 2.4 元/百万 token、输出 24 元/百万 token）；同时以免费额度拉新：Managed Agents 首次开通赠送 30 小时运行时 + 500 次联网搜索、联网资源每月 2 万次免费、文生图首张免费（以 [火山方舟模型价格页](https://docs.volcengine.com/docs/82379/1544106) 为准，2026-08-23 引用）。火山引擎托管版 DeepSeek 模型也在 2026-08-21 同步上调价格，与官方涨价口径一致。

### Notion AI 与 Perplexity：产品级 AI 加购

-   **Notion**：免费/Plus 10 美元/商务 20 美元（每人每月）之上，AI 能力按"信用点"计费——Custom Agents 免费试用后 10 美元/1000 信用点/月（以 [Notion 官方定价页](https://www.notion.com/pricing) 为准，2026-08-23 引用）
-   **Perplexity**：免费版（每日 3 次 Pro 搜索）之上提供 Pro、Education Pro（10 美元/月）、Max、Enterprise 多档，另设独立按量计费的 API 平台；数据隐私随档位升级——Enterprise 数据不用于训练（以 [Perplexity 官方帮助中心](https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you) 为准，2026-08-23 引用）

社区对定价的反应很真实：阿里通义灵码开始收费后，linux.do 用户普遍表示"免费额度本来就少""按月收费就不用，走 API 按 token 消费还能接受"（[linux.do 讨论帖](https://linux.do/t/topic/2191129)）——**免费额度收紧与收费模式切换的窗口期，是留存最脆弱的时刻**。

### 案例速查

| 产品 | 免费档 | 个人付费档 | 企业/开发者 |
| --- | --- | --- | --- |
| ChatGPT | 免费版 | Go 8、Plus 20、Pro 100 美元/月起 | Business 20 美元/用户/月（按年）起，Enterprise 定制 |
| Claude | Free | Pro 20、Max 100 美元/月起 | Team 25 美元/席位/月起，Enterprise 席位 + 用量 |
| Gemini API | 免费层 | 按量计费（Flash 类输入 0.75、输出 3.75 美元/百万 token，促销价） | Batch 半价，企业版有专属支持 |
| DeepSeek | 无会员订阅 | 按量计费，非高峰半价 | 收入几乎全靠 API（[woshipm](https://www.woshipm.com/ai/6451866.html)） |
| 豆包（火山方舟） | 免费额度（联网 2 万次/月等） | 按 token、部分分段计价 | 资源包、TPM 保障包、精调付费 |
| Perplexity | Free（每日 3 次 Pro 搜索） | Pro、Education Pro 10、Max 美元/月 | Enterprise Pro/Max，API 按量 |

> 表中价格均以对应官方页面为准（2026-08-23 引用），详见上文各小节。

## 增长与变现指标

### 北极星指标与留存

增长黑客的经典框架 AARRR（获取、激活、留存、变现、传播）在 AI 产品中依然适用（[爱范儿专访范冰](https://www.ifanr.com/621422)）。AI 产品留存的核心是持续创造"不可替代的价值"：私有数据沉淀、工作流集成、个性化记忆——替代品多、切换成本低的品类尤其如此。DeepSeek 涨价后调用量次日即下滑约 55%–59%（[人人都是产品经理](https://www.woshipm.com/ai/6451866.html)），说明**价格弹性在低切换成本品类中极高**。

### 收入指标

| 指标 | 含义 | 说明 |
| --- | --- | --- |
| MRR / ARR | 月/年经常性收入 | 订阅制产品的核心收入指标 |
| 付费转化率 | 免费 → 付费的转化比例 | 衡量免费层质量与付费点设计 |
| 毛利率 | （收入 − 直接成本）/ 收入 | AI 产品需重点监控推理成本 |
| LTV / CAC | 生命周期价值 / 获客成本 | 两者要平衡，而非单看增长（[范冰专访](https://www.ifanr.com/621422)） |
| 收入分成 | 平台与内容方/渠道方分润比例 | 平台型产品与生态共享收益（如 [Perplexity 出版商计划](https://www.perplexity.ai/hub/blog/introducing-the-perplexity-publishers-program)） |

### AI 产品的特殊指标

-   **上下文成本**：输入 token 随上下文增长，长对话/长文档场景成本非线性上升——这正是上下文缓存存在的原因（以 [Gemini 官方定价页](https://ai.google.dev/pricing) 为准）
-   **评估成本**：模型输出质量需持续评测（评测集 + 人工抽检，方法见[评估与评测](../ai/evaluation.md)），是"看不见"的持续投入
-   **API 毛利率**：提供 API 的产品需单独核算模型调用成本与收入，避免"卖得越多亏得越多"
-   **护栏成本**：安全、合规、审核的隐性支出——如火山方舟视频生成"仅对成功生成的视频计费，审核失败不收费"（[火山方舟模型价格页](https://docs.volcengine.com/docs/82379/1544106)），把失败成本留在提供方一侧

## 来源说明

> 以下来源均于 2026-08-23 验证可达；价格与日期类信息以官方页面为准，页面可能随时更新。

-   [ChatGPT 官方定价页](https://chatgpt.com/zh-Hans-CN/pricing/)（OpenAI 官方）
-   [Claude 官方定价页](https://claude.com/pricing)（Anthropic 官方，anthropic.com/pricing 301 重定向至此）
-   [Gemini API 定价](https://ai.google.dev/pricing)（Google 官方）
-   [DeepSeek API 定价](https://api-docs.deepseek.com/quick_start/pricing)（DeepSeek 官方）
-   [Notion 官方定价页](https://www.notion.com/pricing)（Notion 官方）
-   [Perplexity 官方帮助中心：套餐对比](https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you)（Perplexity 官方）
-   [Perplexity 出版商计划](https://www.perplexity.ai/hub/blog/introducing-the-perplexity-publishers-program)（Perplexity 官方博客，收入分成案例）
-   [火山方舟模型价格](https://docs.volcengine.com/docs/82379/1544106)（字节跳动/火山引擎官方）
-   [DeepSeek 涨价 12 倍，梁文锋不撒钱了](https://www.woshipm.com/ai/6451866.html)（人人都是产品经理）
-   [《增长黑客》范冰：低成本实现用户增长的秘密是？](https://www.ifanr.com/621422)（爱范儿专访，AARRR 与 LTV/CAC 出处）
-   [通义灵码要收费了](https://linux.do/t/topic/2191129)（linux.do 社区讨论，对定价策略的用户反应）
