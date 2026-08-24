---
---

## 框架与平台选型速查

主流 LLM 应用框架与平台大致分四类:低代码平台(可视化搭建)、开发框架(代码灵活可控)、Agent 编排(有状态多步骤)、RAG 数据框架(知识库问答)。选型先定「demo 快速验证 → 内部工具 → 面向客户的产品」的路径,再选层:平台省人力,库换自由度。产品经理视角的选型标准是「多快能跑出 demo、多好维护、多活跃」,而不是功能最多;以下对比速查表与选型建议为本站原创整理,每个条目的能力描述以官方文档为准。

### 主流框架/平台一览(对比速查表)

| 名称 | 类别 | 定位(官方表述) | 官方文档/仓库 | 适合场景 |
| --- | --- | --- | --- | --- |
| Dify | 低代码平台 | 开源 LLM 应用开发平台,集成工作流、RAG、Agent 与可观测性 | [官方文档](https://docs.dify.ai/en/)、[仓库](https://github.com/langgenius/dify) | 快速搭应用、自托管知识库问答 |
| Coze(扣子) | 低代码平台 | AI Agent 智能办公平台,以 Bot 为核心,插件/工作流/知识库为组件 | [全球站](https://www.coze.com/docs/)、[国内站](https://www.coze.cn/docs/) | 无代码搭 Bot、对接 IM 与办公场景 |
| LangChain | 开发框架 | Agent 工程平台,提供最小可配置的 Agent harness(Agent = Model + Harness) | [官方文档](https://docs.langchain.com/oss/python/langchain/overview)、[仓库](https://github.com/langchain-ai/langchain) | 代码开发、多模型切换、生产 Agent |
| LangGraph | Agent 编排 | 低层编排框架与运行时,构建可持久化的有状态长时 Agent | [官方文档](https://docs.langchain.com/oss/python/langgraph/overview)、[仓库](https://github.com/langchain-ai/langgraph) | 复杂多步骤流程、断点续跑与人工介入 |
| LlamaIndex | RAG 库 | 「在数据之上构建 LLM Agent」的数据框架,摄取/索引/检索/查询 | [官方文档](https://developers.llamaindex.ai/python/framework/)、[仓库](https://github.com/run-llama/llama_index) | 知识库问答、文档 Agent |
| OpenAI Agents SDK | Agent 编排 | 轻量多 Agent 框架,「很少的抽象」,内置 Guardrails 与 Tracing | [官方文档](https://openai.github.io/openai-agents-python/)、[仓库](https://github.com/openai/openai-agents-python) | OpenAI 生态、快速写生产级 Agent |
| Claude Code 生态 | Agent 工具/平台 | 终端内 agentic 编程工具,配套 Agent SDK 与 GitHub Actions | [官方文档](https://code.claude.com/docs/en/overview)、[仓库](https://github.com/anthropics/claude-code) | 研发效率、自动化编码与 Code Review |
| n8n | 工作流平台 | fair-code 工作流自动化,原生 AI 能力与 400+ 集成 | [官方文档](https://docs.n8n.io/)、[仓库](https://github.com/n8n-io/n8n) | 业务流程自动化、AI 节点接入 |

> 表格「定位」一列为官方文档/仓库页面表述的摘译,具体以官方文档为准。star 数为 2026-08-23 从 GitHub 仓库页采集(以仓库页为准):Dify 约 15.3 万、LangChain 约 14.5 万、LangGraph 约 4 万、LlamaIndex 约 5.2 万、OpenAI Agents SDK 约 2.9 万、Claude Code 约 14.3 万、n8n 约 20.2 万;Coze 为闭源 SaaS,无官方开源仓库。

### 条目要点

#### 低代码平台:Dify 与 Coze(扣子)

-   **Dify**:官方定位为「开源 LLM 应用开发平台」,名称取自 "Do It For You",提供可视化工作流编排、RAG 流水线、Agent 能力、模型管理与可观测性;运行形态为 Dify Cloud(含免费 Sandbox 计划)与 Docker Compose 分钟级自托管的社区版,可「从原型到生产」(以[官方文档](https://docs.dify.ai/en/)为准)。
-   **Coze(扣子)**:字节跳动出品的闭源 AI Agent 平台,以 Bot 为核心,插件、工作流、知识库为三大组件,面向业务用户与开发者,定位「用 AI 重塑生产力与工作效率」的智能办公平台;全球站与国内站数据隔离、可用模型不同,按目标市场选站点(以[官方文档](https://www.coze.com/docs/)为准)。
-   组内对比:开放度是核心差异——Dify 开源、可自托管、可私有化,Coze 闭源 SaaS、开箱即用;功能边界相近时,数据主权与定制深度决定取舍。

#### 开发框架与 Agent 编排:LangChain、LangGraph、LlamaIndex、OpenAI Agents SDK

-   **LangChain**:官方文档以「Agent = Model + Harness」概括,提供 `create_agent` 最小化 Agent harness,通过 middleware 增量叠加能力(护栏、重试、路由、工具策略);Agent 构建在 LangGraph 之上,并提供跨厂商的模型标准接口;官方另有开箱即用的 Deep Agents(自动上下文压缩、虚拟文件系统、子 Agent 生成)(以[官方文档](https://docs.langchain.com/oss/python/langchain/overview)为准)。
-   **LangGraph**:官方定位为「构建韧性 Agent」的低层编排框架与运行时,专注 Agent 编排本身;节点、边、共享状态为基本原语,支持持久化 checkpoint、断点续跑(durable execution)、人工介入(interrupts)、流式输出与长短记忆,可与 LangChain 解耦单独使用,官方配套 LangSmith 提供可观测、评估与部署支持(以[官方文档](https://docs.langchain.com/oss/python/langgraph/overview)为准)。
-   **LlamaIndex**:官方定位为「在数据之上构建 LLM Agent 的领先框架」,核心是数据连接器、索引、查询/对话引擎与带工具的 Agent,最典型应用是 RAG;高层 API 五行业代码可摄取并查询数据,低层 API 可定制检索与重排模块;提供事件驱动工作流,可组合多 Agent 与多数据源(以[官方文档](https://developers.llamaindex.ai/python/framework/)为准)。
-   **OpenAI Agents SDK**:OpenAI 官方轻量 Python 框架(Swarm 的继任者),「很少的抽象」,设计原则是「值得用的功能足够,原语少到学得快」;核心概念为 Agents、Handoffs、Guardrails、Sessions 与内置 Tracing,与 OpenAI 模型及 Responses API 深度绑定(以[官方文档](https://openai.github.io/openai-agents-python/)为准)。
-   组内对比:LangChain 与 LangGraph 是分层关系而非竞争——前者是高层 Agent harness,后者是低层编排运行时;LlamaIndex 侧重数据接入与 RAG 链路;OpenAI Agents SDK 与 OpenAI 生态绑定最深,换模型成本最高。

#### Agent 工具与工作流:Claude Code 生态与 n8n

-   **Claude Code 生态**:Anthropic 官方的 agentic 编程工具,可读代码库、改文件、跑命令,终端/IDE/桌面/网页多端可用;支持 MCP 连接外部工具与数据源,可用 CLI 脚本化进 CI;生态还包括 Agent SDK(自建 Agent 与自定义工作流)与 GitHub Actions(CI 中 `@claude` 触发,自动开 PR、做 Code Review)(以[官方文档](https://code.claude.com/docs/en/overview)为准)。
-   **n8n**:fair-code 许可证的工作流自动化平台,可视化编排与自定义代码结合,原生 AI Agent 聊天、AI 网页抓取摘要等节点,MCP 支持与 400+ 集成,可自托管或云端;其 MCP server 也可被 Claude Code 等编码助手连接(以[官方文档](https://docs.n8n.io/)为准)。
-   组内对比:Claude Code 生态面向「研发过程中的 Agent」(写代码、改文件、跑 CI),n8n 面向「业务过程的自动化」(跨系统流转、定时任务);两者可叠加使用,而非二选一。

### 按场景选型

#### 场景一:demo 快速验证(1-2 周内跑通)

-   **首选 Dify 或 Coze(扣子)**:可视化编排,不写代码即可搭出对话/RAG/工作流 demo;Dify 开源、可先云后自托管,Coze 免部署、分钟级发布到 IM 渠道(以官方文档为准)。
-   想验证「代码路径」时,用 LangChain 或 LlamaIndex 的最小示例;OpenAI 生态内用 OpenAI Agents SDK,几步即可跑通带工具的 Agent(以官方文档为准)。
-   最小验证包:平台路径 = 一个知识库 + 一条工作流 + 一个发布渠道;代码路径 = 一个模型调用 + 一个工具 + 一组测试用例。两条路径各留半天试跑,再决定投入方向。
-   「demo 用平台、产品化用代码」的双轨路径很常见:验证阶段用 Dify/Coze,规模化后用 LangGraph 重写编排,提示词与工具定义尽量保持可迁移。
-   理由:demo 阶段的关键变量是想法可行性与用户反馈,平台类工具把工程成本降到最低,避免过早写死技术栈。

#### 场景二:内部工具(团队效率、知识库、流程自动化)

-   **首选 Dify 自托管或 n8n**:数据不出域、费用可控;Dify 适合知识库问答与内部助手,n8n 适合跨系统业务流程自动化(400+ 集成,以官方文档为准)。
-   典型内部工具例子:员工手册/政策问答、客服辅助、工单分诊、数据提取与报表生成、跨系统审批流转。
-   研发侧内部工具可上 Claude Code 生态:自动化测试、依赖升级、Code Review 与 CI 流水线(以官方文档为准)。
-   理由:内部工具对稳定性要求低于对外产品,但对成本与数据边界敏感,自托管平台与自动化工具组合最省人力。

#### 场景三:面向客户的产品

-   **代码优先**:需要深度定制与生产级控制时,选 LangGraph(有状态、断点续跑、人工介入)或 OpenAI Agents SDK(轻量、少抽象),RAG 重的产品用 LlamaIndex;可观测配合 LangSmith 或 SDK 内置 Tracing(以官方文档为准)。
-   **平台兜底**:工程资源有限的产品团队可用 Dify 自托管社区版支撑首版,编排逻辑与平台 API 保持解耦,保留迁移余地(以官方文档为准)。
-   **产品化补充**:面向客户还需补多租户、权限、审计与 SLA;这些通常不在框架能力清单里,要按产品规划排期。
-   **闭源 SaaS 慎作核心底座**:Coze 类平台适合快速验证与轻量工具,涉及合规、数据出境与深度定制时需先评估,并注意全球站/国内站数据隔离(以官方文档为准)。

#### 决策清单

-   时间要求:1-2 周出 demo → 平台类(低代码);按季度迭代的产品 → 代码类(库与编排框架)。
-   数据与合规:数据不出域 → Dify 自托管等可私有化形态;跨境场景 → 评估站点、模型与数据驻留。
-   团队构成:产品/运营为主、工程资源少 → 低代码平台;工程师为主 → 开发框架与编排。
-   团队经验:已有 LangChain/OpenAI 代码基础 → 优先同生态延续,降低学习与维护成本。
-   成本结构:低代码平台多按席位/调用计费,自托管按资源计费;估算 TCO 后再定,避免上线后成本失控。
-   长期绑定:核心编排逻辑与框架 API 保持薄层隔离,任何选型都保留迁移余地。

三类场景不是固定顺序,也可以并行:demo 验证期间就同步评估生产架构与合规要求,避免验证成功后重新选型返工。

### 从 demo 到生产的注意事项

-   **可观测性先行**:上线前接好 trace 与日志——LangSmith 提供从单条 trace 到生产级性能指标的完整视图(以[官方文档](https://docs.langchain.com/langsmith)为准);OpenAI Agents SDK 内置 Tracing,自动记录 LLM 调用、工具调用、handoff 与 guardrail(以[官方文档](https://openai.github.io/openai-agents-python/tracing/)为准);Dify 自带对话/工作流运行日志页,并支持集成 LangSmith、Langfuse 等(以[官方文档](https://docs.dify.ai/en/cloud/use-dify/monitor/logs)为准)。
-   **框架 ≠ 产品**:demo 跑通后,产品化还需要权限、监控、灰度、计费等框架之外的工程;「demo 能跑」与「产品可上线」之间隔着完整的工程化补齐。
-   **版本管理**:提示词、工作流、模型参数都要进版本管理;模型与依赖版本锁定,升级走灰度;用 CLAUDE.md 之类的项目约定固化编码标准与评审准则(Claude Code 官方推荐做法,以[官方文档](https://code.claude.com/docs/en/github-actions)为准)。
-   **评估接入**:上线前定义评测集与指标——评测集覆盖典型用户路径与边界 case,指标含答案准确率、幻觉率、工具调用正确率、端到端延迟与成本;LangSmith 提供评估能力,Dify 提供标注系统(人工标注答案、语义命中直接复用,以[官方文档](https://docs.dify.ai/en/cloud/use-dify/monitor/annotation-reply)为准);把「人工反馈 + 自动评测」双通道接进迭代节奏,回归跑在每个模型/提示词版本上。
-   **部署与成本**:Dify 社区版可 Docker Compose 自托管(以官方文档为准);Coze 为 SaaS,按官方定价计费;Claude Code GitHub Actions 中关注 Actions 分钟与 token 成本,用 `--max-turns`、工作流超时与并发控制限制单次任务(以[官方文档](https://code.claude.com/docs/en/github-actions)为准);选型时把推理、向量库与存储成本一并算进 TCO。
-   **安全与权限**:密钥只入 secrets 不进仓库,工作流只申请所需权限并审查 Agent 改动(Claude Code GitHub Actions 官方安全建议,以[官方文档](https://code.claude.com/docs/en/github-actions)为准);工具调用做最小权限与审计,敏感数据不出域。
-   **灰度与回滚**:新模型、新提示词以小流量灰度,对比线上指标后再全量;依赖框架持久化能力(如 LangGraph 的 checkpoint 断点续跑)做任务级恢复(以官方文档为准)。
-   **解耦与迁移余地**:核心逻辑与框架 API 保持薄层隔离;框架更新快、教程易过期,一切以官方文档为准;跨厂商模型接口(LangChain 标准接口等)可降低单点绑定风险。

### 来源说明

> 本文主题综合参考以下来源,内容由本站撰写整理:

-   Dify 官方文档:https://docs.dify.ai/en/ (2026-08-23 验证可达)
-   Dify 官方仓库:https://github.com/langgenius/dify (README 与 star 数,2026-08-23)
-   Coze 全球站官方文档:https://www.coze.com/docs/ (2026-08-23 验证可达)
-   扣子国内站:https://www.coze.cn/docs/ (2026-08-23 验证可达)
-   LangChain 官方文档:https://docs.langchain.com/oss/python/langchain/overview (2026-08-23 验证可达)
-   LangChain 官方仓库:https://github.com/langchain-ai/langchain (README 与 star 数,2026-08-23)
-   LangGraph 官方文档:https://docs.langchain.com/oss/python/langgraph/overview (2026-08-23 验证可达)
-   LangGraph 官方仓库:https://github.com/langchain-ai/langgraph (README 与 star 数,2026-08-23)
-   LlamaIndex 官方文档:https://developers.llamaindex.ai/python/framework/ (2026-08-23 验证可达)
-   LlamaIndex 官方仓库:https://github.com/run-llama/llama_index (README 与 star 数,2026-08-23)
-   OpenAI Agents SDK 官方文档:https://openai.github.io/openai-agents-python/ (含 Tracing 页,2026-08-23 验证可达)
-   OpenAI Agents SDK 官方仓库:https://github.com/openai/openai-agents-python (README 与 star 数,2026-08-23)
-   Claude Code 官方文档:https://code.claude.com/docs/en/overview (含 GitHub Actions 页,2026-08-23 验证可达)
-   Claude Code 官方仓库:https://github.com/anthropics/claude-code (README 与 star 数,2026-08-23)
-   n8n 官方文档:https://docs.n8n.io/ (2026-08-23 验证可达)
-   n8n 官方仓库:https://github.com/n8n-io/n8n (README 与 star 数,2026-08-23)
-   LangSmith 官方文档:https://docs.langchain.com/langsmith (2026-08-23 验证可达)

> 补充说明:社区选型讨论(如 linux.do 等)不在本文来源范围内——本页能力描述一律以官方文档为准,避免二手信息失真;star 数与版本类事实以仓库页/官方文档为最新口径。

???+ note "时效说明"
    本页内容核对于 2026-08-23;框架版本、功能与定价演进很快,选型与报价前请以官方文档为准。

## 更新记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-08-23 | 重写 | 由占位页升级为框架对比速查表 + 按场景选型 + 生产注意事项,兑现「待补充」承诺 |
