---
---
description: LLM 框架与平台选型速查：低代码平台、开发框架、Agent 编排与 RAG 数据框架。
---

## 框架与平台选型速查

主流 LLM 应用框架与平台大致分四类：低代码平台（可视化搭建）、开发框架（代码灵活可控）、Agent 编排（有状态多步骤）、RAG 数据框架（知识库问答）。选型先定「demo 快速验证 → 内部工具 → 面向客户的产品」的路径，再选层：平台省人力，库换自由度。产品经理视角的选型标准是「多快能跑出 demo、多好维护、多活跃」，而不是功能最多；以下对比速查表与选型建议为本站原创整理，每个条目的能力描述以官方文档为准。

随着 Agent 工程走向成熟，框架版图已超出上述四类：多 Agent 协作框架（角色分工、对话式编排）、企业级 SDK（多语言、与云生态绑定）、前端 AI 层（流式 UI 与应用内助手）、可视化构建工具（拖拽出可迁移代码）都成为常见选型。理解这些条目的关系，建议先用「原语库 → 编排框架 → 低代码平台」的分层模型（见后文「Agent 框架全景与分层」一节）定位它们各自站在哪一层，再回到速查表逐项对比；架构模式本身在 [Agent 架构与多智能体](../ai/agent-architecture.md) 讲解，本页只谈工具选型。

本页结构：对比速查表（一眼定位）→ 条目要点（逐项对比）→ 按场景选型（决策路径）→ 分层与 MCP 生态（理解框架关系）→ 权威实践与综述（选型依据）。

### 主流框架/平台一览(对比速查表)

| 名称 | 类别 | 定位（官方表述） | 官方文档/仓库 | 适合场景 |
| --- | --- | --- | --- | --- |
| Dify | 低代码平台 | 开源 LLM 应用开发平台，集成工作流、RAG、Agent 与可观测性 | [官方文档](https://docs.dify.ai/en/)、[仓库](https://github.com/langgenius/dify) | 快速搭应用、自托管知识库问答 |
| Coze（扣子） | 低代码平台 | AI Agent 智能办公平台，以 Bot 为核心，插件/工作流/知识库为组件 | [全球站](https://www.coze.com/docs/)、[国内站](https://www.coze.cn/docs/) | 无代码搭 Bot、对接 IM 与办公场景 |
| LangChain | 开发框架 | Agent 工程平台，提供最小可配置的 Agent harness（Agent = Model + Harness） | [官方文档](https://docs.langchain.com/oss/python/langchain/overview)、[仓库](https://github.com/langchain-ai/langchain) | 代码开发、多模型切换、生产 Agent |
| LangGraph | Agent 编排 | 低层编排框架与运行时，构建可持久化的有状态长时 Agent | [官方文档](https://docs.langchain.com/oss/python/langgraph/overview)、[仓库](https://github.com/langchain-ai/langgraph) | 复杂多步骤流程、断点续跑与人工介入 |
| LlamaIndex | RAG 库 | 「在数据之上构建 LLM Agent」的数据框架，摄取/索引/检索/查询 | [官方文档](https://developers.llamaindex.ai/python/framework/)、[仓库](https://github.com/run-llama/llama_index) | 知识库问答、文档 Agent |
| OpenAI Agents SDK | Agent 编排 | 轻量多 Agent 框架，「很少的抽象」，内置 Guardrails 与 Tracing | [官方文档](https://openai.github.io/openai-agents-python/)、[仓库](https://github.com/openai/openai-agents-python) | OpenAI 生态、快速写生产级 Agent |
| Claude Code 生态 | Agent 工具/平台 | 终端内 agentic 编程工具，配套 Agent SDK 与 GitHub Actions | [官方文档](https://code.claude.com/docs/en/overview)、[仓库](https://github.com/anthropics/claude-code) | 研发效率、自动化编码与 Code Review |
| n8n | 工作流平台 | fair-code 工作流自动化，原生 AI 能力与 400+ 集成 | [官方文档](https://docs.n8n.io/)、[仓库](https://github.com/n8n-io/n8n) | 业务流程自动化、AI 节点接入 |
| Semantic Kernel | 企业级 Agent SDK | Microsoft 开源的跨语言（如 .NET、Python、Java）企业级 Agent 框架，以插件、计划器与记忆为核心概念 | [官方文档](https://learn.microsoft.com/semantic-kernel/)、[仓库](https://github.com/microsoft/semantic-kernel) | 微软/企业技术栈、与 Azure 生态集成 |
| CrewAI | 多 Agent 协作 | 角色化多 Agent 协作框架，以 Crew、Agent、Task、Flow 为核心，「角色扮演」驱动分工 | [官方文档](https://docs.crewai.com/)、[仓库](https://github.com/crewAIInc/crewAI) | 角色分工明确的业务流程、内容与研究类多 Agent |
| AutoGen / AG2 | 多 Agent 协作 | 多 Agent 对话式协作框架，以对话为编排原语；社区延续版本为 AG2 | [AG2 文档](https://docs.ag2.ai/)、[AutoGen 文档](https://microsoft.github.io/autogen/)、[AG2 仓库](https://github.com/ag2ai/ag2) | 研究型多 Agent、代码协作与模拟讨论 |
| Haystack | RAG/检索管道 | deepset 出品的生产级 AI 框架，以可组合的 Pipeline（检索/生成管道）为核心 | [官方文档](https://haystack.deepset.ai/)、[仓库](https://github.com/deepset-ai/haystack) | 生产级 RAG、知识库问答与搜索增强 |
| Vercel AI SDK | 前端/AI 全栈 | TypeScript 生态的 AI 工具包，统一模型调用、流式渲染与工具调用接口 | [官方文档](https://ai-sdk.dev/)、[仓库](https://github.com/vercel/ai) | React/Next.js 前端、流式对话与生成式 UI |
| Pydantic AI | Python 类型安全框架 | 主打类型安全的 Python Agent 框架，以类型化输出、依赖注入与工具为核心 | [官方文档](https://ai.pydantic.dev/)、[仓库](https://github.com/pydantic/pydantic-ai) | Python 后端、强类型输出、对输出结构有严格要求的团队 |
| Flowise | 低代码平台 | 可视化构建 LLM 应用与 Agent 工作流的开源平台，拖拽式串联 LangChain 生态组件 | [官方文档](https://docs.flowiseai.com/)、[仓库](https://github.com/FlowiseAI/Flowise) | 可视化搭建 RAG/Agent 原型、自托管 |
| Langflow | 低代码平台 | 可视化「Agent 与 RAG 编排」的开源平台，组件拖拽加 Python 代码扩展 | [官方文档](https://docs.langflow.org/)、[仓库](https://github.com/langflow-ai/langflow) | 可视化搭建 Agent 流程、与 LangChain 生态协同 |
| CopilotKit | 前端 Agent 框架 | 应用内 AI 助手/副驾驶框架，把 Agent 能力嵌入现有 Web 应用 | [官方文档](https://docs.copilotkit.ai/)、[仓库](https://github.com/CopilotKit/CopilotKit) | 给存量 Web 应用加 AI 助手与操作能力 |
| Claude Agent SDK | Agent SDK | Anthropic 官方 Agent 构建 SDK，用于自建 Agent 与自定义工作流，与 Claude Code 同源技术 | [官方文档](https://docs.claude.com/en/api/agent-sdk/overview) | 自建 Agent 产品、自定义工作流与工具调用 |
| Google ADK | Agent SDK | Google 生态的 Agent 开发工具包，原生支持 A2A 协议 | [官方文档](https://google.github.io/adk-docs/) | Google 生态、需要 A2A 互操作的多 Agent 系统 |

> 表格「定位」一列为官方文档/仓库页面表述的摘译，具体以官方文档为准。star 数为 2026-08-23 从 GitHub 仓库页采集（以仓库页为准）：Dify 约 15.3 万、LangChain 约 14.5 万、LangGraph 约 4 万、LlamaIndex 约 5.2 万、OpenAI Agents SDK 约 2.9 万、Claude Code 约 14.3 万、n8n 约 20.2 万；Coze 为闭源 SaaS，无官方开源仓库。2026-08-24 新增条目的 star 数未采集，以各仓库页为准。

### 条目要点

每个条目给「官方定位 + 核心概念 + 适合场景 + 组内对比」四要素，能力描述以官方文档为准；条目之间按类别分组，同组内可直接对比。

#### 低代码平台:Dify 与 Coze(扣子)

-   **Dify**：官方定位为「开源 LLM 应用开发平台」，名称取自 "Do It For You"，提供可视化工作流编排、RAG 流水线、Agent 能力、模型管理与可观测性；运行形态为 Dify Cloud（含免费 Sandbox 计划）与 Docker Compose 分钟级自托管的社区版，可「从原型到生产」（以[官方文档](https://docs.dify.ai/en/)为准）。
-   **Coze（扣子）**：字节跳动出品的闭源 AI Agent 平台，以 Bot 为核心，插件、工作流、知识库为三大组件，面向业务用户与开发者，定位「用 AI 重塑生产力与工作效率」的智能办公平台；全球站与国内站数据隔离、可用模型不同，按目标市场选站点（以[官方文档](https://www.coze.com/docs/)为准）。
-   组内对比：开放度是核心差异：Dify 开源、可自托管、可私有化，Coze 闭源 SaaS、开箱即用；功能边界相近时，数据主权与定制深度决定取舍。
-   选型要点：低代码平台之间对比看五个维度：部署形态（云/自托管/私有化）、模型接入（可用哪些模型、是否可换）、发布渠道（Web/IM/API）、可观测与评测能力、插件与扩展生态；Dify 与 Coze 在这五项上取舍不同，按团队实际约束逐项打分再定（以官方文档为准）。

#### 低代码构建:Flowise 与 Langflow

-   **Flowise**：官方定位为「可视化构建 LLM 应用与 Agent 工作流」的开源平台，核心交互是拖拽节点串联组件：模型、检索、工具、Agent、条件分支等节点以流程方式连接，内置聊天界面、API 端点与自托管部署方式（以[官方文档](https://docs.flowiseai.com/)为准）。组件生态与 LangChain 深度关联，适合认可代码生态的组件、但团队以业务/产品人员为主的团队；导出与嵌入能力让原型可以继续演进，而不是验证完就丢弃。
-   Flowise 的适合场景：快速做 RAG 问答、客服流程、带工具的 Agent 原型；需要把流程可视化给业务方评审后再固化；有数据不出域要求时可自托管（以官方文档为准）。
-   **Langflow**：官方定位为「Agent 与 RAG 编排」的可视化开源平台，由 DataStax 主导，组件拖拽加 Python 代码扩展，支持以 API、嵌入式组件或完整应用交付；可与 LangChain 生态互通，提供把流程导出到代码工程的衔接能力（以[官方文档](https://docs.langflow.org/)为准）。
-   Langflow 的适合场景：画 Agent 流程（含多步工具调用）并快速交付为服务；团队已有 LangChain 代码、想先用可视化把流程结构定型；需要流程图能迁移成代码维护（以官方文档为准）。
-   组内对比：Flowise 与 Langflow 定位相近，差异在生态侧重（Flowise 更偏 LangChain 组件库，Langflow 更强调 Agent 流程与 DataStax 数据侧）与交付方式；与 Dify/Coze 的区别是可视化 IDE vs 平台：Dify 自带模型管理、可观测、发布渠道，Flowise/Langflow 更轻、更贴近代码工程、产物可迁移；选型看团队要平台省运营还是 IDE 省从零写代码。
-   什么时候不选它们：流程需要复杂状态与人工介入（断点续跑、审批节点）、要面向多租户客户交付、或团队完全无工程能力时，可视化 IDE 的抽象就不够或过度：前者回 Dify/Coze 类平台，后者直接上编排框架（以官方文档为准）。
-   迁移路径：Flowise/Langflow 画出的流程，产品化阶段常被重写为 LangGraph/Pydantic AI 等代码实现；保留节点语义 ↔ 代码模块的映射表可让重写成本可控：提示词与工具定义尽量复用，编排逻辑重写。

#### 开发框架与 Agent 编排:LangChain、LangGraph、LlamaIndex、OpenAI Agents SDK

-   **LangChain**：官方文档以「Agent = Model + Harness」概括，提供 `create_agent` 最小化 Agent harness，通过 middleware 增量叠加能力（护栏、重试、路由、工具策略）；Agent 构建在 LangGraph 之上，并提供跨厂商的模型标准接口；官方另有开箱即用的 Deep Agents（自动上下文压缩、虚拟文件系统、子 Agent 生成）（以[官方文档](https://docs.langchain.com/oss/python/langchain/overview)为准）。
-   **LangGraph**：官方定位为「构建韧性 Agent」的低层编排框架与运行时，专注 Agent 编排本身；节点、边、共享状态为基本原语，支持持久化 checkpoint、断点续跑（durable execution）、人工介入（interrupts）、流式输出与长短记忆，可与 LangChain 解耦单独使用，官方配套 LangSmith 提供可观测、评估与部署支持（以[官方文档](https://docs.langchain.com/oss/python/langgraph/overview)为准）。
-   **LlamaIndex**：官方定位为「在数据之上构建 LLM Agent 的领先框架」，核心是数据连接器、索引、查询/对话引擎与带工具的 Agent，最典型应用是 RAG；高层 API 五行业代码可摄取并查询数据，低层 API 可定制检索与重排模块；提供事件驱动工作流，可组合多 Agent 与多数据源（以[官方文档](https://developers.llamaindex.ai/python/framework/)为准）。
-   **OpenAI Agents SDK**：OpenAI 官方轻量 Python 框架（Swarm 的继任者），「很少的抽象」，设计原则是「值得用的功能足够，原语少到学得快」；核心概念为 Agents、Handoffs、Guardrails、Sessions 与内置 Tracing，与 OpenAI 模型及 Responses API 深度绑定（以[官方文档](https://openai.github.io/openai-agents-python/)为准）。
-   组内对比：LangChain 与 LangGraph 是分层关系而非竞争：前者是高层 Agent harness，后者是低层编排运行时；LlamaIndex 侧重数据接入与 RAG 链路；OpenAI Agents SDK 与 OpenAI 生态绑定最深，换模型成本最高。
-   补充：这类「代码优先」框架的共同点是解决工程问题（状态、持久化、恢复、观测），而不是「模型聪不聪明」；同一种架构（如 ReAct、Plan-and-Execute）在多个框架里都有实现，选型先定架构再看框架：架构模式见 [Agent 架构与多智能体](../ai/agent-architecture.md)。
-   什么时候选「代码框架」：要长期迭代的产品、需要深度定制（权限、多租户、审计）、编排逻辑会成为团队资产：代码框架把控制权留在自己手里；代价是学习与维护成本，团队至少要有一名能读懂框架源码层级的工程师（以官方文档为准）。
-   代码框架的共同特性清单：模型无关性（能否换厂商）、持久化与恢复（checkpoint/断点续跑）、人工介入原语（interrupts/审批）、流式输出、可观测（内置 tracing 或可接 LangSmith 等）、工具与 MCP 接入：用这份清单对比任意两个框架，比看宣传页高效（以官方文档为准）。

#### 企业级 Agent 框架:Semantic Kernel

-   **Semantic Kernel（SK）**：Microsoft 开源的企业级 Agent SDK，官方定位为面向企业的、可跨语言（如 .NET、Python、Java）的 Agent 框架，与 Azure OpenAI / Azure AI Foundry 深度集成（以[官方文档](https://learn.microsoft.com/semantic-kernel/)为准）。
-   核心概念：插件（Plugin，把函数封装成模型可调用的能力）、计划器（Planner，把目标拆成可执行计划）、记忆（Memory，向量化存储与检索），以及后续加入的 Agent 抽象与 MCP 支持：概念与 LangChain 生态大体对应，但强调企业治理、依赖注入与云服务集成（以官方文档为准）。
-   适合场景：已有 .NET/Java 技术栈的企业（金融、制造、政企等）、需要微软生态支持（身份、合规、Azure 部署）的团队；对团队现有语言的适配是 SK 相比 Python 系框架最大的差异化。
-   组内对比：与 LangChain 相比，SK 的多语言支持与微软生态集成是核心差异，社区规模与第三方教程相对少；若团队以 Python 为主且无微软绑定，SK 不是首选；选它通常是技术栈 + 生态 + 合规的综合决定，而不是功能数量。
-   什么时候选它：技术栈已是 .NET/Java；客户或监管要求微软生态的合规与身份体系；团队希望用同一套 Agent 抽象覆盖多个语言产品线；需要与 Azure AI Foundry 的模型、评测与监控服务打通（以官方文档为准）。
-   什么时候不选它：团队是 Python 或 TypeScript 原生、无微软绑定；需要快速跟进社区最新 Agent 实践（第三方教程与集成更少）；开源模型私有化为主、不依赖 Azure：这些场景 Python 系框架更合适。
-   延伸：Microsoft 还推出了整合 AutoGen 与 Semantic Kernel 能力的下一代 Agent 开发方案（Agent Framework 与 Azure AI Foundry Agent Service），方向是把多 Agent 对话与企业级工程化合并；产品名与能力边界变化快，以 Microsoft 官方文档为准。

#### 多 Agent 协作:CrewAI、AutoGen/AG2 与 Google ADK

-   **CrewAI**：官方定位为「角色化多 Agent 协作框架」，核心概念是 Crew（团队）、Agent（角色，含目标与背景）、Task（任务）与 Flow（流程控制），让多个扮演不同角色的 Agent 协作完成业务目标；配套提供 crewAI 平台（AMP）用于部署与可观测（以[官方文档](https://docs.crewai.com/)为准）。
-   CrewAI 的适合场景：角色分工清晰的业务流程（如「研究员 → 分析师 → 文案」的内容流水线）、需要让业务方理解「谁在做什么」的多 Agent 系统；角色即提示词的设计让协作结构直观、易讲解。
-   **AutoGen / AG2**：AutoGen 是 Microsoft Research 提出的多 Agent 对话框架，核心思想是把编排建模为「Agent 之间的对话」，支持代码执行、人类介入与群聊式协作，配套论文阐述了多 Agent 对话的设计空间（以[AutoGen 官方文档](https://microsoft.github.io/autogen/)与[论文](https://arxiv.org/abs/2308.08155)为准）；微软后续把相关能力演进并入新的 Agent 方案后，AutoGen 的社区延续以 **AG2**（ag2ai 组织）名义维护，兼容并扩展原有概念（以[AG2 官方文档](https://docs.ag2.ai/)为准）。
-   AutoGen/AG2 的适合场景：研究型多 Agent（模拟讨论、代码协作、探索性任务）；对话即编排的模型适合需要灵活交互、难以预先画成固定流程的系统。
-   **Google ADK**：Google 生态的 Agent 开发工具包（Python），提供 Agent 定义、工具、记忆与可观测组件，原生支持 A2A 协议（Agent-to-Agent 互操作）（以[官方文档](https://google.github.io/adk-docs/)为准）；适合 Google 生态（Vertex AI / Gemini）与需要 A2A 跨平台协作的场景。
-   组内对比：三者多 Agent 哲学不同：CrewAI 是团队 + 角色自上而下的分工，结构直观、贴近业务流程；AutoGen/AG2 是对话自组织，灵活但调试成本高；Google ADK 与 Google 生态绑定最深。共同提醒：多 Agent 不等于更好，成本与协调复杂度随 Agent 数上升，决定前先看 [Agent 架构与多智能体](../ai/agent-architecture.md) 的「多 Agent 的代价」一节。
-   速选：要讲给业务方听、角色像部门分工 → CrewAI；要做开放式的多 Agent 实验与模拟 → AG2；Google 生态内、要 A2A 互操作 → Google ADK；已有 OpenAI 生态 → OpenAI Agents SDK 的 Handoffs 机制即可，不必引入重型多 Agent 框架（以官方文档为准）。
-   什么时候不选多 Agent 框架：任务由单 Agent 或固定工作流就能完成时，任何多 Agent 框架都是负资产：成本翻倍、调试变难；先单 Agent，评测证明收益后再上多 Agent（原则见 [Agent 架构与多智能体](../ai/agent-architecture.md)）。

#### RAG 与检索管道:Haystack

-   **Haystack**：deepset 出品的开源 AI 框架，官方定位为「生产级」的 RAG/检索增强框架，核心概念是 Pipeline：把组件（文档存储、检索器、重排器、生成器、评估器）连接成可复用、可测试的管道（以[官方文档](https://haystack.deepset.ai/)为准）。
-   核心组件：Document Store（文档存储与检索后端）、Retriever（稀疏/稠密检索）、Ranker（重排）、Generator（生成），以及工具调用与 Agent 能力；配套评估模块与 deepset Cloud 托管服务（以官方文档为准）。
-   适合场景：知识库问答、企业搜索增强、对「管道可调试、可测试、可监控」有要求的生产 RAG 系统；与向量数据库、重排模型的集成是其强项。
-   什么时候选它：检索是核心链路、需要精细控制（分块、混合检索、重排、缓存）、要求每个环节可单独评测与替换的团队；相比直接上 Agent 框架，检索管道 + 薄 Agent 层往往更稳。
-   组内对比：与 LlamaIndex 相比，Haystack 更强调工程化管道（组件契约、测试、监控），LlamaIndex 更强调数据框架 + 高层 API；RAG 想从 demo 走向生产，评估与监控是刚需。Haystack 的管道结构天然适合接评估；两者都支持 Agent 化，但 RAG 重场景下先比管道工程能力，再比 Agent 特性（以官方文档为准）。
-   产品化清单：生产 RAG 的核心链路是「解析与分块 → 索引 → 混合检索 → 重排 → 生成 → 引用溯源」，每一环都要可配置、可评测、可替换；Haystack 的价值在于把这条链路变成显式管道，而不是黑盒。评估指标（检索命中率、重排提升、答案准确率、引用正确率）对应到管道节点逐项优化（以官方文档为准）。
-   生态配合：检索质量还依赖向量数据库（如 Qdrant、Weaviate、Milvus 等）与重排模型的选择，这些在 Haystack 中都是可替换组件；「框架选型 + 存储选型 + 重排选型」三者要一起定，只比框架本身意义有限（以官方文档为准）。

#### Python 类型安全:Pydantic AI

-   **Pydantic AI**：Pydantic 团队出品的 Python Agent 框架，官方定位是「把 TypeScript 的类型体验带给 Python Agent 开发」：类型安全、结构化输出、依赖注入是核心卖点（以[官方文档](https://ai.pydantic.dev/)为准）。
-   核心概念：Agent（模型 + 系统提示 + 工具 + 输出模型）、结构化输出（用 Pydantic 模型约束响应、自动校验重试）、依赖注入（把外部依赖干净地传入 Agent）、类型化工具（以官方文档为准）。
-   适合场景：Python 后端产品、对输出结构与数据校验有严格要求的团队、已有 Pydantic 生态；类型提示让团队协作与重构更安全，适合「模型输出要直接进业务系统」的场景。
-   组内对比：与 OpenAI Agents SDK 相比，Pydantic AI 模型无关、类型安全、不绑定单一供应商；与 LangChain 相比更轻、原语更少、上手更快；与 Semantic Kernel 相比是 Python 专属、无企业云绑定。选它通常因为类型安全 + 轻量 + 模型无关三项同时命中（以官方文档为准）。
-   什么时候选它：模型输出要直接进入业务系统（订单、工单、数据库写入），结构校验失败的成本高；团队重视类型提示与代码可维护性；需要对接多个模型供应商而不想被单一 SDK 绑定（以官方文档为准）。
-   什么时候不选它：需要图式复杂编排（多分支、人工介入、持久化状态机）时，Pydantic AI 的原语偏少，更适合配 LangGraph 等编排层使用，或直接选编排框架（以官方文档为准）。

条目要点速记：低代码平台解决「快」（Dify/Coze/Flowise/Langflow），编排框架解决「稳」（LangGraph、OpenAI Agents SDK），企业 SDK 解决「栈」（Semantic Kernel），多 Agent 框架解决「分工」（CrewAI、AutoGen/AG2、Google ADK），RAG 框架解决「准」（LlamaIndex、Haystack），前端层解决「体验」（Vercel AI SDK、CopilotKit），官方 SDK 解决「绑定」（Claude Agent SDK）。先对号入座，再比细节；跨类别组合（平台验证 + 框架产品化）是常态而不是例外。

#### 前端与全栈 AI:Vercel AI SDK 与 CopilotKit

-   **Vercel AI SDK**：TypeScript/JavaScript 生态的 AI 工具包，官方定位为「类型安全的 AI 开发工具包」：统一模型调用（多家模型供应商）、流式响应、工具调用与前端 UI 组件（React/Vue/Svelte 等框架的 hooks），让流式对话、生成式 UI、工具调用在 Web 前端一站接入（以[官方文档](https://ai-sdk.dev/)为准）。
-   适合场景：React/Next.js 技术栈的产品团队；对话式 UI 是产品核心交互（聊天、Copilot 输入框、流式生成内容）；前端直接调模型或经过自建 BFF/Agent 服务都支持。
-   **CopilotKit**：应用内 AI 助手/副驾驶框架，官方定位是把 Agent 能力嵌入现有 Web 应用：提供可定制的 UI 组件、应用上下文（读写前端状态）、操作执行（actions）与后台 Agent 编排（以[官方文档](https://docs.copilotkit.ai/)为准）。
-   适合场景：给存量 Web 应用加 AI 助手（如后台系统的「帮我筛数据、填表单」）；要求助手能操作应用内对象、而不只是聊天的场景；与前端框架强绑定，通常配一个后端 Agent 服务。
-   组内对比：Vercel AI SDK 是「模型 → UI」的管道（流式、渲染、工具调用标准化），CopilotKit 是「Agent → 应用」的嵌入（应用内上下文与操作）；两者可组合使用，且都不替代后端编排框架。后端仍需要 LangGraph、Pydantic AI 等提供状态与业务逻辑（以官方文档为准）。
-   前端层选型决策：产品核心是「对话式体验」（聊天、流式生成）→ Vercel AI SDK 的 hooks 与流式能力最省事；产品核心是「让助手操作现有界面」（筛选、填表、导航）→ CopilotKit 的应用内动作更贴合；两者都要先确认后端 Agent 服务契约（工具定义、流式协议、错误语义）再动手（以官方文档为准）。
-   前端框架不解决后端问题：状态持久化、权限、审计、多租户仍在后端；「前端一个月、后端三个月」是常见低估，排期时把后端 Agent 服务作为主体。

#### Agent 工具与工作流:Claude Code 生态与 n8n

-   **Claude Code 生态**：Anthropic 官方的 agentic 编程工具，可读代码库、改文件、跑命令，终端/IDE/桌面/网页多端可用；支持 MCP 连接外部工具与数据源，可用 CLI 脚本化进 CI；生态还包括 Agent SDK（自建 Agent 与自定义工作流）与 GitHub Actions（CI 中 `@claude` 触发，自动开 PR、做 Code Review）（以[官方文档](https://code.claude.com/docs/en/overview)为准）。
-   **n8n**：fair-code 许可证的工作流自动化平台，可视化编排与自定义代码结合，原生 AI Agent 聊天、AI 网页抓取摘要等节点，MCP 支持与 400+ 集成，可自托管或云端；其 MCP server 也可被 Claude Code 等编码助手连接（以[官方文档](https://docs.n8n.io/)为准）。
-   组内对比：Claude Code 生态面向研发过程中的 Agent（写代码、改文件、跑 CI），n8n 面向业务过程的自动化（跨系统流转、定时任务）；两者可叠加使用，而非二选一。
-   补充：n8n 的 AI 能力以节点形式提供（聊天、抓取、向量存储、MCP 接入），编排逻辑仍是业务流式；与代码框架相比，它的差异化在集成广度而不是 Agent 控制力（以官方文档为准）。
-   n8n 选型要点：流程以业务事件为驱动（webhook、定时、表单提交）时 n8n 优势明显；Agent 需要长上下文、复杂状态与自主决策时，n8n 只做编排外壳，核心 Agent 逻辑仍建议放代码框架，两者通过 API/Webhook 衔接（以官方文档为准）。

#### 自建 Agent 的官方 SDK:Claude Agent SDK

-   **Claude Agent SDK**：Anthropic 官方的 Agent 构建 SDK，定位是「用 Claude 构建自主 Agent 与自定义工作流」，与 Claude Code 使用同一套底层技术（Claude Code 的架构提炼为 SDK 开放出来），可嵌入自有产品、脚本与 CI（以[官方文档](https://docs.claude.com/en/api/agent-sdk/overview)为准）。
-   核心能力：Agent 循环（模型与工具循环、规划与执行）、MCP 客户端接入外部工具、会话与进程管理、与 Claude 模型能力对齐；相比直接调 Messages API，SDK 把循环、工具调用、上下文管理封装成开箱即用的运行时（以官方文档为准）。
-   与「Claude Code 生态」条目的关系：Claude Code 是「终端内的 agentic 编程产品」，开箱即用、面向编码场景；Agent SDK 是库，开发者自己写宿主、自己定义工具与工作流。前者适合直接用，后者适合自建产品。
-   组内对比：与 OpenAI Agents SDK 对称：两者都是模型厂商的官方 Agent SDK，与自家模型生态绑定最深；选型上「用哪家模型就优先看哪家官方 SDK」，再考虑第三方通用框架（以官方文档为准）。
-   什么时候选它：产品要深度绑定 Claude 模型能力（长任务、工具调用、MCP）；需要精确控制 Agent 循环而不想要重量级框架；要把 Agent 能力嵌入现有代码库与 CI 流程；希望与 Claude Code 生态（编码助手、Actions）共享同一技术栈（以官方文档为准）。
-   什么时候不选它：需要模型无关（多供应商）或团队技术栈与 Anthropic 生态无关；需要图式编排与持久化状态机时，官方 SDK 偏「循环原语」，复杂流程可叠加 LangGraph 等编排层，或直接选编排框架。

### 按场景选型

#### 场景一:demo 快速验证(1-2 周内跑通)

-   **首选 Dify 或 Coze（扣子）**：可视化编排，不写代码即可搭出对话/RAG/工作流 demo；Dify 开源、可先云后自托管，Coze 免部署、分钟级发布到 IM 渠道（以官方文档为准）。
-   想验证「代码路径」时，用 LangChain 或 LlamaIndex 的最小示例；OpenAI 生态内用 OpenAI Agents SDK，几步即可跑通带工具的 Agent（以官方文档为准）。
-   低代码路径再细分：只想「画出来看效果」→ Flowise/Langflow（可视化、产物可导出代码）；想要「平台级能力」（模型管理、发布、观测）→ Dify/Coze（以官方文档为准）。
-   前端团队验证对话体验：Vercel AI SDK 几分钟即可跑通流式聊天 demo，再决定后端要不要接 Agent 框架（以官方文档为准）。
-   多 Agent 概念验证：CrewAI 或 AG2 半天可搭角色协作 demo。但先想清楚「单 Agent 为什么不行」（见 [Agent 架构与多智能体](../ai/agent-architecture.md) 的「多 Agent 的代价」）。
-   最小验证包：平台路径 = 一个知识库 + 一条工作流 + 一个发布渠道；代码路径 = 一个模型调用 + 一个工具 + 一组测试用例。两条路径各留半天试跑，再决定投入方向。
-   代码路径 demo 参考骨架：模型调用（流式）→ 一个真实工具（读文件/查库/调 API）→ 结构化输出（校验）→ 3-5 个用例跑通；Pydantic AI（类型安全）、OpenAI Agents SDK（OpenAI 生态）、Claude Agent SDK（Claude 生态）都是这个骨架的现成实现，半天内可搭完（以官方文档为准）。
-   demo 评估清单：验证结束时回答五个问题：响应质量是否够用、延迟是否可接受、成本量级是否可行、团队能否维护、数据与合规有无硬伤；五个都过再谈产品化，任一不过先换工具，而不是换提示词硬扛。
-   demo 阶段就把「模型 + 成本」记下来：用哪个模型、单次任务 token 与费用、延迟分位值：这些是后续选型与定价的第一手依据，随手记比事后考古省事。
-   「demo 用平台、产品化用代码」的双轨路径很常见：验证阶段用 Dify/Coze，规模化后用 LangGraph 重写编排，提示词与工具定义尽量保持可迁移。
-   demo 阶段的关键变量是想法可行性与用户反馈，平台类工具把工程成本降到最低，避免过早写死技术栈。

#### 场景二:内部工具(团队效率、知识库、流程自动化)

-   **首选 Dify 自托管或 n8n**：数据不出域、费用可控；Dify 适合知识库问答与内部助手，n8n 适合跨系统业务流程自动化（400+ 集成，以官方文档为准）。
-   RAG 类内部知识库：Haystack 或 Dify 自托管都适合：前者工程控制力强（管道可评测），后者运维省心（以官方文档为准）。
-   存量 Web 系统加内部助手：CopilotKit 类前端嵌入方案，或 Vercel AI SDK 接内部 Agent 服务（以官方文档为准）。
-   企业 .NET/Java 技术栈：Semantic Kernel 与微软生态集成最顺（以官方文档为准）。
-   典型内部工具例子：员工手册/政策问答、客服辅助、工单分诊、数据提取与报表生成、跨系统审批流转。
-   研发侧内部工具可上 Claude Code 生态：自动化测试、依赖升级、Code Review 与 CI 流水线（以官方文档为准）。
-   内部工具选型组合建议：知识问答 = Dify/Haystack（按工程资源）；流程自动化 = n8n；存量系统助手 = CopilotKit 嵌入；研发自动化 = Claude Code 生态；企业技术栈 = Semantic Kernel。内部工具通常不是单选，而是按场景组合、共用一套模型与工具治理（以官方文档为准）。
-   内部工具同样要版本管理与评测：提示词、工作流、工具定义进版本库；上线前定义 20-50 条典型用例做回归；内部工具常因「不是对外产品」而跳过治理，实际它离业务数据更近，出错成本不低。
-   内部工具对稳定性要求低于对外产品，但对成本与数据边界敏感，自托管平台与自动化工具组合最省人力。

#### 场景三:面向客户的产品

-   **代码优先**：需要深度定制与生产级控制时，选 LangGraph（有状态、断点续跑、人工介入）或 OpenAI Agents SDK（轻量、少抽象），RAG 重的产品用 LlamaIndex；可观测配合 LangSmith 或 SDK 内置 Tracing（以官方文档为准）。
-   **平台兜底**：工程资源有限的产品团队可用 Dify 自托管社区版支撑首版，编排逻辑与平台 API 保持解耦，保留迁移余地（以官方文档为准）。
-   **产品化补充**：面向客户还需补多租户、权限、审计与 SLA；这些通常不在框架能力清单里，要按产品规划排期。
-   **闭源 SaaS 慎作核心底座**：Coze 类平台适合快速验证与轻量工具，涉及合规、数据出境与深度定制时需先评估，并注意全球站/国内站数据隔离（以官方文档为准）。
-   企业客户与微软技术栈：Semantic Kernel + Azure，身份、合规、部署一体化（以官方文档为准）。
-   RAG 是核心链路的生产产品：Haystack 的管道工程能力（分块、检索、重排、评估逐环节可控）更贴合线上要求（以官方文档为准）。
-   前端体验是竞争力：Vercel AI SDK / CopilotKit 把流式与助手体验做成产品差异；后端状态与业务逻辑仍需编排框架承接（以官方文档为准）。
-   多 Agent 面向客户：先小规模验证再放量：CrewAI 的团队结构直观易评审，AG2 灵活但调试成本高；上线前务必先有评测与成本预算（以官方文档为准）。
-   生产选型矩阵：按产品形态 × 团队构成快速定位：对话优先的 Web 产品 = 编排框架 + Vercel AI SDK；RAG 重产品 = Haystack/LlamaIndex；企业客户 = Semantic Kernel + Azure；轻量内部件 = 低代码平台；多 Agent 产品 = CrewAI/AG2 + 严格评测（均以官方文档为准）。
-   生产选型还有两个「必须补」：可观测与评测（任何框架都要接，选框架无关的工具如 LangSmith/Langfuse，以官方文档为准）与成本治理（按任务预算设上限，多 Agent 尤甚）。这两项不在框架能力表里，但决定产品能否长期运行。
-   生产阶段的评测 + 成本双通道：每轮模型/提示词/框架升级，先跑评测集（准确率、延迟、成本、工具错误率）再放量；把评测结果与成本归因写进迭代评审，避免「感觉变好了」取代数据。

#### 决策清单

-   时间要求：1-2 周出 demo → 平台类（低代码）；按季度迭代的产品 → 代码类（库与编排框架）。
-   数据与合规：数据不出域 → Dify 自托管等可私有化形态；跨境场景 → 评估站点、模型与数据驻留。
-   团队构成：产品/运营为主、工程资源少 → 低代码平台；工程师为主 → 开发框架与编排。
-   团队经验：已有 LangChain/OpenAI 代码基础 → 优先同生态延续，降低学习与维护成本。
-   成本结构：低代码平台多按席位/调用计费，自托管按资源计费；估算 TCO 后再定，避免上线后成本失控。
-   长期绑定：核心编排逻辑与框架 API 保持薄层隔离，任何选型都保留迁移余地。
-   技术栈绑定：.NET/Java 企业 → Semantic Kernel；TypeScript/React → Vercel AI SDK（可加 CopilotKit）；Python → Pydantic AI 或 LangChain 系；Google 生态 → Google ADK（以官方文档为准）。
-   多 Agent 需求：角色分工清晰、要讲给业务听 → CrewAI；对话式研究/模拟 → AG2；决定前先读 [Agent 架构与多智能体](../ai/agent-architecture.md) 的「多 Agent 的代价」。
-   生产 RAG：管道工程能力优先 → Haystack；数据框架与高层 API 优先 → LlamaIndex；两者都支持 Agent 化（以官方文档为准）。
-   供应商绑定：模型厂商官方 SDK（OpenAI Agents SDK、Claude Agent SDK）与自家生态绑定最深，换模型成本最高；第三方框架（如 Pydantic AI、LangChain）模型无关性更好。
-   工具生态与 MCP：要接的工具多且杂 → 优先 MCP 支持成熟的框架/平台，并确认企业工具网关的对接方式（详见 [MCP 生态](#mcp-生态) 一节）。
-   可观测与评测：把「可观测性接入成本」和「评测工具链」列入对比项：内置 tracing（OpenAI Agents SDK、LangSmith）与第三方平台（Langfuse 等）都可，但不能没有（以官方文档为准）。
-   多 Agent 预算：任何多 Agent 选型都要先写「收益证明计划」：评测集、对比基线、成本上限；证明不了收益就不上（原则见 [Agent 架构与多智能体](../ai/agent-architecture.md)）。
-   许可与商业条款：n8n 为 fair-code 许可证（源可用但商业使用有条件，以官方为准）；Coze 等闭源 SaaS 按服务协议；开源框架（如 Dify、LangChain 等，以各仓库 License 为准）也要确认修改与再分发条款：企业选型前让法务过一遍许可与合规，比上线后补救便宜。

三类场景不是固定顺序，也可以并行：demo 验证期间就同步评估生产架构与合规要求，避免验证成功后重新选型返工。

### 从 demo 到生产的注意事项

-   **可观测性先行**：上线前接好 trace 与日志：LangSmith 提供从单条 trace 到生产级性能指标的完整视图（以[官方文档](https://docs.langchain.com/langsmith)为准）；OpenAI Agents SDK 内置 Tracing，自动记录 LLM 调用、工具调用、handoff 与 guardrail（以[官方文档](https://openai.github.io/openai-agents-python/tracing/)为准）；Dify 自带对话/工作流运行日志页，并支持集成 LangSmith、Langfuse 等（以[官方文档](https://docs.dify.ai/en/cloud/use-dify/monitor/logs)为准）。
-   **评估与可观测工具生态**：除 LangSmith 外，Langfuse、Braintrust 等第三方 LLM 可观测/评测平台可作为框架无关的接入选项；多 Agent 系统要保证每个 Agent 的调用链、handoff 与成本都可归因，再谈优化（以各官方文档为准）。
-   **多 Agent 的成本预算**：多 Agent 系统的 token 消耗远高于单 Agent（官方实测量级约为普通对话的 15 倍，以 Anthropic 官方博客为准），上线前按每任务预算 × 并发算成本上限，设置停止条件与预算护栏。
-   **框架 ≠ 产品**：demo 跑通后，产品化还需要权限、监控、灰度、计费等框架之外的工程；「demo 能跑」与「产品可上线」之间隔着完整的工程化补齐。
-   **多 Agent 系统的观测要求更高**：每个 Agent 的提示词版本、工具权限、上下文来源都要可追溯；「谁在什么时候调了什么工具、花了多少钱」的调用链是事故复盘与成本归因的基础（详见 [Agent 架构与多智能体](../ai/agent-architecture.md) 的 AgentOps 一节）。
-   **版本管理**：提示词、工作流、模型参数都要进版本管理；模型与依赖版本锁定，升级走灰度；用 CLAUDE.md 之类的项目约定固化编码标准与评审准则（Claude Code 官方推荐做法，以[官方文档](https://code.claude.com/docs/en/github-actions)为准）。
-   **评估接入**：上线前定义评测集与指标：评测集覆盖典型用户路径与边界 case，指标含答案准确率、幻觉率、工具调用正确率、端到端延迟与成本；LangSmith 提供评估能力，Dify 提供标注系统（人工标注答案、语义命中直接复用，以[官方文档](https://docs.dify.ai/en/cloud/use-dify/monitor/annotation-reply)为准）；把人工反馈 + 自动评测双通道接进迭代节奏，回归跑在每个模型/提示词版本上。
-   **部署与成本**：Dify 社区版可 Docker Compose 自托管（以官方文档为准）；Coze 为 SaaS，按官方定价计费；Claude Code GitHub Actions 中关注 Actions 分钟与 token 成本，用 `--max-turns`、工作流超时与并发控制限制单次任务（以[官方文档](https://code.claude.com/docs/en/github-actions)为准）；选型时把推理、向量库与存储成本一并算进 TCO。
-   **安全与权限**：密钥只入 secrets 不进仓库，工作流只申请所需权限并审查 Agent 改动（Claude Code GitHub Actions 官方安全建议，以[官方文档](https://code.claude.com/docs/en/github-actions)为准）；工具调用做最小权限与审计，敏感数据不出域。
-   **灰度与回滚**：新模型、新提示词以小流量灰度，对比线上指标后再全量；依赖框架持久化能力（如 LangGraph 的 checkpoint 断点续跑）做任务级恢复（以官方文档为准）。
-   **解耦与迁移余地**：核心逻辑与框架 API 保持薄层隔离；框架更新快、教程易过期，一切以官方文档为准；跨厂商模型接口（LangChain 标准接口等）可降低单点绑定风险。

???+ example "上线检查清单"
    demo 转生产前对照逐项打勾，缺一项就先不上线：

    1. 可观测：LLM 调用、工具调用、成本都有 trace 与日志，失败可复现
    2. 评测：评测集与基线指标已定义，回归可自动跑
    3. 安全：密钥入 secrets，工具最小权限，输入/输出护栏生效
    4. 治理：灰度与回滚方案就绪，预算上限与停止条件已设置
    5. 兜底：人工接管路径明确，事故响应预案存在
    6. 合规：数据流向、许可条款、跨境评估已完成

## Agent 框架全景与分层

框架数量多、更新快，与其逐个追新，不如先把「它们站在哪一层」看清楚。把 Agent 技术栈按抽象层次从低到高切分，大部分框架都能对号入座；同一层内的框架互相竞争，不同层之间是「上下叠加」的关系。

### 分层模型:原语库 → 编排框架 → 低代码平台

| 层 | 解决的问题 | 代表条目 | 主要取舍 |
| --- | --- | --- | --- |
| 原语库（L0） | 单点能力：模型调用、工具接入、向量检索 | 模型 API（见 [LLM API 与供应商](llm-api.md)）、Function Calling、MCP、向量数据库 | 灵活，但一切要自己拼 |
| 编排框架（L1） | 把原语组织成「可运行、可恢复、可观测」的 Agent 系统 | LangGraph、OpenAI Agents SDK、Semantic Kernel、Pydantic AI、CrewAI、AutoGen/AG2、Haystack、Claude Agent SDK、Google ADK | 工程能力齐备，但需要写代码 |
| 低代码平台（L2） | 可视化编排 + 托管运行，把工程成本降到最低 | Dify、Coze、Flowise、Langflow、n8n | 省人力，定制与迁移受平台约束 |
| 应用层（叠加在 L1 之上） | 把 Agent 能力接进「产品界面」 | Vercel AI SDK、CopilotKit | 只解决 UI 侧接入，不替代后端编排 |

-   同层竞争、跨层叠加：Flowise/Langflow 竞争的是 Dify/Coze 的「低代码」心智，但常被用来给代码框架做原型；Vercel AI SDK 与 LangGraph 不在同一层，它假设后面已经（或将会）有一个 Agent 服务。
-   选型先定层：团队构成（有没有工程师）、交付形态（内部工具 vs 对外产品）、对定制深度的要求决定站哪一层；层定下来，再在同一层内按生态、活跃度、官方支持度选具体框架。
-   产品化路径通常是跨层迁移：低代码平台验证 → 编排框架重写 → 前端应用层接入。层与层之间用接口衔接（API、MCP、提示词与工具定义），迁移时尽量保住接口不变。
-   分层选型矩阵：按「团队构成 × 交付形态」两维快速定位（见下表）。

|  | 内部工具 | 对外产品 |
| --- | --- | --- |
| 无工程师 | L2 低代码平台 | L2 + 平台托管（谨慎评估定制边界） |
| 少量工程师 | L2 + API 兜底，L1 只做关键链路 | L1 编排框架 + 薄封装 |
| 成熟工程团队 | L1 按需 + 复用现有技术栈 | L1 编排框架 + 应用层 + 完整 AgentOps |

-   常见误区：把「用了框架」当成「有了架构」：框架只提供零件与装配说明，任务拆分、状态设计、失败恢复仍是架构决策；把「换框架」当成「解决问题」：多数线上问题的根因在提示词、评测与数据，不在框架。
-   补充视角：L0 层的 MCP 正在把工具接入从框架特性变成通用能力（见 [MCP 生态](#mcp-生态) 一节），框架的差异化会进一步收缩到编排、状态、可观测。分层越清晰，选型越简单。

### 框架 ≠ 架构

-   **架构是模式组合，框架是模式的实现**：ReAct、Plan-and-Execute、编排者-工作者这些设计模式属于架构层（见 [Agent 架构与多智能体](../ai/agent-architecture.md)）；LangGraph、CrewAI、AutoGen 等框架只是把这些模式做成了可运行的工程形态。
-   同一种架构可以有多个框架实现：ReAct 循环在 LangGraph、Pydantic AI、Claude Agent SDK 里都是模型 + 工具循环的不同封装；编排者-工作者在 CrewAI 里叫 Crew/Task，在 AutoGen 里叫对话，在 LangGraph 里是子图。换框架不等于换架构。
-   反过来说，换架构也不一定换框架：同一个框架内可以表达多种模式（LangGraph 既能画固定工作流，也能做动态 ReAct）。
-   对选型的实际意义：先画架构（任务怎么拆、状态怎么存、失败怎么恢复），再挑实现（哪个框架对这套架构支持最顺、团队最熟）；框架营销常把模式当卖点，判断时把模式主张拆回架构层审视：它解决的是不是你的问题。
-   产品不是框架：Claude Code、Codex、Copilot 这类 Agent 产品是成品：它们内部用了框架与 SDK，但对用户是开箱即用的应用；选型时不要把 Agent 产品与 Agent 框架混为一谈，前者直接给用户用，后者是开发工具（详见 [Agent 工具与工作流](#agent-工具与工作流claude-code-生态与-n8n) 一节）。

### 分层速选

-   没有工程师、纯业务团队 → L2 低代码平台（Dify/Coze 最省事；Flowise/Langflow 若要代码迁移余地）。
-   有 Python 工程师、要长期演进 → L1 编排框架（Pydantic AI 或 LangChain 系起步，复杂流程上 LangGraph）。
-   企业技术栈锁定 → Semantic Kernel（.NET/Java）或 Google ADK（Google 生态）。
-   前端团队、产品形态是 Web 应用 → L1 选一个后端框架 + 应用层（Vercel AI SDK / CopilotKit）。
-   层定先后，再定框架；不要被「功能最多」的框架带跑：多出来的功能通常不是你的问题。

### 选型五步

1.  定义问题：要解决「快/稳/栈/分工/准/体验」中哪些问题：先归类，再找类。
2.  定层：按团队构成与交付形态对照分层选型矩阵，确定目标层。
3.  列候选：同层内选 2-3 个候选，用「代码框架共同特性清单」（模型无关性、持久化、人工介入、流式、可观测、MCP）逐项对比。
4.  跑最小实验：官方文档核对能力边界，再搭一个模型调用 + 一个工具 + 一组用例的最小实验，半天出结果。
5.  评测定案：用自己的评测集度量效果与成本，写选型结论（含「为什么不选其余候选」）。选型文档进仓库，后续换框架时是现成基线。
6.  定期复查：框架每季度都在变，把速查表 + 官方文档复查排进季度节奏；架构与评测体系不动，换层换框架都只是实现替换。

### 跨层迁移的接口清单

-   「平台验证 → 框架产品化」的迁移，保住三类接口即可控：① 模型调用层（尽量走标准接口，少用平台私有 API）；② 工具定义（提示词里的工具描述与参数 Schema 与平台解耦）；③ 数据与评测集（知识库、用例集、标注结果跨平台复用）。
-   MCP 把工具接口进一步标准化后，平台/框架之间迁移时工具侧基本不动，迁移成本集中在编排逻辑与状态管理（见 [MCP 生态](#mcp-生态) 一节）。

### 分层的演进展望

-   短期可见的趋势：厂商官方 SDK（OpenAI、Anthropic、Google）持续加码，框架与 SDK 的边界模糊；MCP 把工具层标准化后，框架差异化收缩到编排与可观测（以官方文档为准）。
-   对选型者的含义：每半年复查一次本页速查表 + 官方文档即可跟上变化；架构与评测体系不变，换层换框架都只是实现替换。
-   对产品的含义：分层越清晰，越能同时享受平台的速度与框架的深度：把演示、内部工具、对外产品放在不同层，共用评测与治理体系，而不是让整个组织绑定单一框架。

## MCP 生态

MCP（Model Context Protocol）的机制、架构与安全在 [工具调用与 MCP](../ai/agent-tools.md) 有完整讲解，这里只回答框架选型视角的三个问题：MCP 对框架层意味着什么、主流框架支持到什么程度、选型时怎么用。

### MCP 对框架层的意义:工具接入标准化

-   在 MCP 出现之前，每个框架都要为每个工具写一套私有连接器，框架数 × 工具数的集成成本随两边增长；MCP 把工具提供方变成标准 Server，框架只需实现一次 Client，即可接入整个工具生态。集成成本从 N×M 变成 N+M（以[官方文档](https://modelcontextprotocol.io/)为准）。
-   对框架选型的影响：框架的 MCP 支持成熟度（客户端管理、工具发现、权限控制、远程 Server 支持）正在成为与模型支持并列的选型维度；MCP 支持好的框架，接入内部系统与第三方工具的成本更低。
-   对产品经理的提醒：MCP 标准化的是工具如何接入，不负责业务权限、工作流编排与多 Agent 协作。这些仍是产品自己的治理体系（见 [工具调用与 MCP](../ai/agent-tools.md) 的「什么时候不用 MCP」）。

### 主流框架/平台的 MCP 支持现状

以下为 2026-08-24 时点的主要情况，支持范围与成熟度以各官方文档为准：

| 类别 | 代表 | MCP 支持形态（以官方文档为准） |
| --- | --- | --- |
| Agent SDK | Claude Code、Claude Agent SDK | 原生支持，配置接入 MCP Server |
| Agent SDK | OpenAI Agents SDK | 提供 MCP 客户端支持 |
| 编排框架 | LangGraph/LangChain | 提供 MCP 集成组件 |
| 编排框架 | Pydantic AI、CrewAI、Haystack、Google ADK | 均有 MCP 接入能力 |
| 低代码平台 | Dify、Coze、n8n | 支持接入 MCP Server |
| 低代码平台 | Flowise/Langflow | 提供 MCP 节点 |
| 前端应用层 | Vercel AI SDK | 提供 MCP 客户端支持，可前后端统一接工具 |

-   **Agent SDK 类**：Claude Code 与 Claude Agent SDK 原生支持 MCP（以[官方文档](https://docs.claude.com/en/api/agent-sdk/overview)为准）；OpenAI Agents SDK 提供 MCP 客户端支持（以[官方文档](https://openai.github.io/openai-agents-python/)为准）。
-   **编排框架类**：LangGraph/LangChain 提供 MCP 集成组件；Pydantic AI、CrewAI、Haystack、Google ADK 均有 MCP 接入能力（以各官方文档为准）。
-   **低代码平台类**：Dify、Coze、n8n 均支持接入 MCP Server；Flowise/Langflow 提供 MCP 节点（以各官方文档为准）。
-   **前端应用层**：Vercel AI SDK 提供 MCP 客户端支持，可在前端/服务端统一接工具（以[官方文档](https://ai-sdk.dev/)为准）。

### 对选型的影响

-   需要接入的工具多且杂（数据库、办公套件、内部系统）→ 优先选 MCP 支持成熟、有工具发现与权限管理的框架/平台。
-   企业自建工具网关（Registry + 权限 + 审计）时，框架的 MCP 客户端只是接入端，治理仍在网关层：选型时确认框架能对接企业网关而不是绕过它。
-   只是应用内的一个简单函数 → 不必为了 MCP 而 MCP，直接 Function Calling 更轻（见 [工具调用与 MCP](../ai/agent-tools.md)）。

### MCP 时代的工具策略

-   工具清单正在从代码资产变成可注册的服务资产：MCP Server 由工具团队（或第三方）维护，应用侧按需接入。对产品经理的意义是，「接一个工具」从数周集成变成配置与权限评审，产品可快速试错多个工具再决定深度集成。
-   选型时把框架的 MCP 客户端能力与平台/框架的工具市场分开看：平台类（Dify、Coze、n8n）的工具市场是内置目录，开箱即用但受平台生态限制；代码框架的 MCP 支持是开放接入，灵活但需要自己治理（以官方文档为准）。
-   风险提示：MCP 降低接入成本的同时也扩大了攻击面：只接入可信 Server、按最小权限授权、审计每次工具调用；企业内最好经工具网关统一接入（见 [工具调用与 MCP](../ai/agent-tools.md) 的工具安全一节）。

### 评估框架 MCP 支持的问题清单

-   支持哪些传输（stdio / Streamable HTTP，远程 Server 是否可用）？
-   工具发现与更新：Server 新增工具后，应用侧如何同步（自动发现还是手动配置）？
-   权限模型：能否对每个 Server/工具做最小权限授权，还是「接了就能全用」？
-   可观测：工具调用是否进入 trace，失败与耗时可否归因？
-   稳定性：多 Server 并发、Server 故障时的降级行为如何？

以上五项在各框架官方文档里都能查到答案；答不上的框架，工具接入成本往往被低估。

???+ warning "MCP 相关选型误区"
    -   误区一：「支持 MCP 就万事大吉」：支持程度差异很大（本地/远程、发现、权限），要按上面的清单逐项确认；
    -   误区二：「为了 MCP 而 MCP」：单一内置工具直接 Function Calling 更轻；
    -   误区三：「MCP 解决编排」：协议只标准化工具接入，状态、权限、编排仍是产品自己的事（详见 [工具调用与 MCP](../ai/agent-tools.md)）。

???+ note "MCP 生态仍在快速演进"
    MCP 的规范版本、远程传输（Streamable HTTP）与企业级能力（认证、审计、Registry）都在演进。

    具体框架支持哪个版本、哪些特性，以各官方文档为准，不要依据第三方教程的旧信息做决策。

## 参考:权威工程实践与综述

框架文档讲「怎么做」，这一节补充「为什么这样做」的权威依据：工程实践博客与学术综述，供选型与向团队说明决策时引用。

### Anthropic《Building Effective Agents》

Anthropic 官方博客（2024-12，[原文](https://www.anthropic.com/engineering/building-effective-agents)）是业界引用最广的 Agent 工程实践指南，核心观点：

-   **工作流 vs Agent 的定义**：工作流（workflow）是「预置代码路径」编排 LLM 与工具；Agent 是「模型动态引导自身流程与工具使用」，自主决定如何完成任务。两者是连续谱系而非对立，先考虑最简单能解决问题的方案。
-   **设计原则**：为任务选择最简单的能力：能工作流就工作流；提升结果质量的顺序是「更好的提示词 → 更好的上下文/检索 → 更复杂的 Agent 结构」；复杂结构要用可观测 + 评测证明收益，避免用复杂度掩盖提示词质量不足。
-   **五类工作流模式与两类 Agent 模式**：提示词链、路由、并行化、编排者-工作者、评估者-优化者，以及自主 Agent 与多 Agent。模式详解见 [Agent 架构与多智能体](../ai/agent-architecture.md)。
-   **原文观点摘引**：官方明确主张「最简单的可用方案几乎总是最好的」（the simplest solutions that work are almost always the best），并建议在公开可验证结果的任务上让 Agent 直接与模型对比、用评测决定取舍；工作流适合可预测、确定的任务，Agent 适合问题空间开放、需要动态决策的任务：选型时对照自己的任务落在哪一侧。
-   **对选型的直接指导**：框架是模式的实现载体；官方反复强调「在简单与可控的前提下加复杂度」，对应到选型就是「低代码能解决就别上框架，单 Agent 能解决就别上多 Agent」。
-   **同源实践的呼应**：OpenAI 官方《A Practical Guide to Building Agents》（2025，[PDF](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)）给出相似结论：「从最简单方案开始、最小化上下文、刻意设计工具、评测与护栏前置」；Google 官方《Agents》白皮书（[Kaggle 白皮书页](https://www.kaggle.com/whitepaper-agents)）从模型、工具、编排层定义 Agent 组件。三家厂商的官方实践在简单优先 + 评测驱动上高度一致。这是跨厂商共识，不是某家营销。

### 学术综述:Agent 与多智能体的研究全景

-   《The Rise and Potential of Large Language Model Based Agents: A Survey》（Xi 等，2023，[arXiv:2309.07864](https://arxiv.org/abs/2309.07864)）：从「大脑-感知-行动」框架梳理 LLM Agent 的架构、应用与展望，是 Agent 研究全景的常用引用。
-   《A Survey on Large Language Model based Autonomous Agents》（Wang 等，2024，[arXiv:2308.11432](https://arxiv.org/abs/2308.11432)）：系统梳理自主 Agent 的构建（规划、记忆、工具使用）与评测；综述的结论之一是 Agent 相关工作爆发式增长，但**统一评测与基准仍然缺乏**，不同工作难以横向比较。这正是以官方文档核对能力、以自己的评测集验证效果的原因。
-   综述中的普遍观察：框架与工具快速涌现且**同质化明显**（组件概念互相借用、定位趋同），同时评测与基准滞后于工程实践。选型时穿透营销词汇、回到能力清单对比，比追新框架更有价值。
-   《AgentBench: Evaluating LLMs as Agents》（Liu 等，2023，[arXiv:2308.03688](https://arxiv.org/abs/2308.03688)）：提出跨 8 个环境的 Agent 评测基准，结论之一：LLM 作为 Agent 的能力与作为聊天机器人的能力存在明显差距：选型前先用小评测集验证，而不是相信模型在聊天榜上的表现。
-   《AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation》（Wu 等，2023，[arXiv:2308.08155](https://arxiv.org/abs/2308.08155)）：多 Agent 对话框架的设计论文，提出对话即编排的设计空间（对话模式、终止条件、人类介入），是理解 AutoGen/AG2 系框架的第一手资料。

### 关于多 Agent 与成本收益的实证

-   《Are More LLM Calls All You Need? Towards Scaling Laws of Compound Inference Systems》（Yue 等，2024，[arXiv:2403.02419](https://arxiv.org/abs/2403.02419)，ICML 2024）：对多调用/多 Agent 系统做规模化实测，结论是收益随调用数增加而递减，且对最优调用策略的选择高度敏感。多 Agent 不是免费的精度提升。
-   Anthropic《How We Built Our Multi-Agent Research System》（官方博客，[原文](https://www.anthropic.com/engineering/multi-agent-research-system)）：实测多 Agent 系统 token 消耗约为普通对话的 15 倍，给出并行子 Agent、只传引用等工程取舍：对应到选型，多 Agent 框架（如 CrewAI、AG2）的收益必须先在自己的评测集上证明。
-   《AI Agents That Matter》（Kambhampati 等，2024，[arXiv:2407.01502](https://arxiv.org/abs/2407.01502)）：批评多数 Agent 评测缺乏与简单基线的对照、忽视成本与延迟，主张「Agent 评测要像科学实验一样公平」。评估方法论见 [评估与评测](../ai/evaluation.md)。

### 工程实践优先于框架营销

-   框架市场同质化明显：概念互相借鉴（Plugin ≈ Tool ≈ Skill，Planner ≈ Agent 循环），各家营销词汇多于实质差异；判断框架要「看官方文档的架构与 API，不看宣传页的功能列表」。
-   三步验证法：① 官方文档核对能力边界与许可；② 用你的任务跑最小实验（一个模型调用 + 一个工具 + 一组测试用例）；③ 用你自己的评测集度量效果与成本，再决定是否引入。
-   框架更新快、教程易过期：任何第三方教程（包括本站）都只作索引，落地前以官方文档为准；把「团队能否维护」放在「功能多不多」之前。
-   怎么用综述：综述的价值是全景与分类（知道有哪些模式、组件、评测维度），不是推荐某个框架。读综述建立坐标系，再回到官方文档确认细节；综述中提到的评测结论（Agent 能力落后于聊天能力、多调用收益递减）用于校准预期与说服团队，不用于具体选型。
-   给评审会的说法：「框架不解决模型聪明与否，只解决工程可控；选型依据 = 官方文档的能力边界 + 我们评测集上的实测，而不是宣传页的功能列表」。这条表述可以直接用于技术选型评审。
-   延伸阅读指引：架构模式与 AgentOps 见 [Agent 架构与多智能体](../ai/agent-architecture.md)；MCP 机制与工具安全见 [工具调用与 MCP](../ai/agent-tools.md)；评估方法论见 [评估与评测](../ai/evaluation.md)；模型与供应商选择见 [模型能力与选型](../ai/capabilities.md) 与 [LLM API 与供应商](llm-api.md)：选型的完整决策链，本站四页闭环。

???+ tip "给产品经理的决策速记"
    选框架先选层，层定了看生态；多 Agent 与复杂模式要用评测证明收益；MCP 支持决定工具接入成本。

    一切以官方文档为准，以你自己的评测集为准。

### 来源说明

> 本文主题综合参考以下来源，内容由本站撰写整理：

-   Dify 官方文档：https://docs.dify.ai/en/ （2026-08-23 验证可达）
-   Dify 官方仓库：https://github.com/langgenius/dify （README 与 star 数，2026-08-23）
-   Coze 全球站官方文档：https://www.coze.com/docs/ （2026-08-23 验证可达）
-   扣子国内站：https://www.coze.cn/docs/ （2026-08-23 验证可达）
-   LangChain 官方文档：https://docs.langchain.com/oss/python/langchain/overview （2026-08-23 验证可达）
-   LangChain 官方仓库：https://github.com/langchain-ai/langchain （README 与 star 数，2026-08-23）
-   LangGraph 官方文档：https://docs.langchain.com/oss/python/langgraph/overview （2026-08-23 验证可达）
-   LangGraph 官方仓库：https://github.com/langchain-ai/langgraph （README 与 star 数，2026-08-23）
-   LlamaIndex 官方文档：https://developers.llamaindex.ai/python/framework/ （2026-08-23 验证可达）
-   LlamaIndex 官方仓库：https://github.com/run-llama/llama_index （README 与 star 数，2026-08-23）
-   OpenAI Agents SDK 官方文档：https://openai.github.io/openai-agents-python/ （含 Tracing 页，2026-08-23 验证可达）
-   OpenAI Agents SDK 官方仓库：https://github.com/openai/openai-agents-python （README 与 star 数，2026-08-23）
-   Claude Code 官方文档：https://code.claude.com/docs/en/overview （含 GitHub Actions 页，2026-08-23 验证可达）
-   Claude Code 官方仓库：https://github.com/anthropics/claude-code （README 与 star 数，2026-08-23）
-   n8n 官方文档：https://docs.n8n.io/ （2026-08-23 验证可达）
-   n8n 官方仓库：https://github.com/n8n-io/n8n （README 与 star 数，2026-08-23）
-   LangSmith 官方文档：https://docs.langchain.com/langsmith （2026-08-23 验证可达）
-   Semantic Kernel 官方文档：https://learn.microsoft.com/semantic-kernel/ （2026-08-24 验证可达）
-   Semantic Kernel 官方仓库：https://github.com/microsoft/semantic-kernel （2026-08-24）
-   CrewAI 官方文档：https://docs.crewai.com/ （2026-08-24 验证可达）
-   CrewAI 官方仓库：https://github.com/crewAIInc/crewAI （2026-08-24）
-   AutoGen 官方文档：https://microsoft.github.io/autogen/ （2026-08-24 验证可达）
-   AG2 官方文档：https://docs.ag2.ai/ （2026-08-24 验证可达）
-   AG2 官方仓库：https://github.com/ag2ai/ag2 （2026-08-24）
-   Google ADK 官方文档：https://google.github.io/adk-docs/ （2026-08-24 验证可达）
-   Haystack 官方文档：https://haystack.deepset.ai/ （2026-08-24 验证可达）
-   Haystack 官方仓库：https://github.com/deepset-ai/haystack （2026-08-24）
-   Vercel AI SDK 官方文档：https://ai-sdk.dev/ （2026-08-24 验证可达）
-   Vercel AI SDK 官方仓库：https://github.com/vercel/ai （2026-08-24）
-   Pydantic AI 官方文档：https://ai.pydantic.dev/ （2026-08-24 验证可达）
-   Pydantic AI 官方仓库：https://github.com/pydantic/pydantic-ai （2026-08-24）
-   Flowise 官方文档：https://docs.flowiseai.com/ （2026-08-24 验证可达）
-   Flowise 官方仓库：https://github.com/FlowiseAI/Flowise （2026-08-24）
-   Langflow 官方文档：https://docs.langflow.org/ （2026-08-24 验证可达）
-   Langflow 官方仓库：https://github.com/langflow-ai/langflow （2026-08-24）
-   CopilotKit 官方文档：https://docs.copilotkit.ai/ （2026-08-24 验证可达）
-   CopilotKit 官方仓库：https://github.com/CopilotKit/CopilotKit （2026-08-24）
-   Claude Agent SDK 官方文档：https://docs.claude.com/en/api/agent-sdk/overview （2026-08-24 验证可达）
-   MCP 官方文档：https://modelcontextprotocol.io/ （2026-08-24 验证可达）
-   Anthropic《Building Effective Agents》：https://www.anthropic.com/engineering/building-effective-agents （2026-08-24）
-   Anthropic《How We Built Our Multi-Agent Research System》：https://www.anthropic.com/engineering/multi-agent-research-system （2026-08-24）
-   OpenAI《A Practical Guide to Building Agents》：https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf （2026-08-24）
-   Google《Agents》白皮书：https://www.kaggle.com/whitepaper-agents （2026-08-24）
-   AutoGen 论文：https://arxiv.org/abs/2308.08155 （2026-08-24）
-   《The Rise and Potential of LLM Based Agents: A Survey》：https://arxiv.org/abs/2309.07864 （2026-08-24）
-   《A Survey on LLM based Autonomous Agents》：https://arxiv.org/abs/2308.11432 （2026-08-24）
-   《AgentBench: Evaluating LLMs as Agents》：https://arxiv.org/abs/2308.03688 （2026-08-24）
-   《Are More LLM Calls All You Need?》：https://arxiv.org/abs/2403.02419 （2026-08-24）
-   《AI Agents That Matter》：https://arxiv.org/abs/2407.01502 （2026-08-24）

> 补充说明：社区选型讨论（如 linux.do 等）不在本文来源范围内：本页能力描述一律以官方文档为准，避免二手信息失真；star 数与版本类事实以仓库页/官方文档为最新口径。

???+ note "时效说明"
    本页内容核对于 2026-08-24（新增框架条目与分层/MCP/综述三节）；2026-08-23 采集的既有内容与 star 数保留原样。

    框架版本、功能与定价演进很快，选型与报价前请以官方文档为准。

## 更新记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-08-24 | 扩写 | 新增 11 个框架条目（速查表与条目要点）、Agent 框架全景与分层、MCP 生态、权威工程实践与综述三节；既有标题与锚点未动 |
| 2026-08-23 | 重写 | 由占位页升级为框架对比速查表 + 按场景选型 + 生产注意事项，兑现「待补充」承诺 |
