---
## Agent 产品设计深度篇

Agent 产品让 AI 不只是"回答"，而是**独立完成任务**：写报告、做调研、管日程、自动化运维。从「聊天助手」到「自主执行」是产品范式转变——决定权、执行权与风险从人转移到系统。
产品经理的设计重心也随之变为设计**代理权、信任与失败恢复**。技术背景见 [Agent 与工作流](../ai/agent.md)；本文结论均有官方文档等权威来源，原创整理。

### Agent 产品的设计空间

#### 产品形态

| 形态 | 自主程度 | 例子 | 设计要点 |
| --- | --- | --- | --- |
| 任务型 Agent | 完成单个明确任务 | 一键生成周报、调研报告 | 结果可验证，一次成功率高 |
| 流程型 Agent | 完成多步固定流程 | 报销流程、简历筛选 | 确认点设在不可逆节点 |
| 陪伴型 Agent | 持续运行、主动行动 | 智能助理、监控机器人 | 预算护栏 + 主动干预路径 |

#### 任务边界：什么任务适合 Agent 化

OpenAI 官方定义：Agent 是「能够规划、调用工具、跨专家协作，并保持足够状态以完成多步工作的应用」([OpenAI Agents 指南](https://developers.openai.com/api/docs/guides/agents))。Anthropic 的 [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) 给出更实用的判断框架，先区分两类系统：

-   **工作流（Workflow）**：LLM 与工具被预先编排的代码路径调度，适合步骤明确、要求稳定的任务
-   **Agent**：LLM 动态决定自己的执行过程与工具使用，适合「无法预测所需步骤数、无法硬编码固定路径」的开放式问题

官方建议「先找最简单的方案，只在确有收益时增加复杂度」——很多应用优化单次 LLM 调用（检索 + 上下文示例）就够了。
判断任务是否值得 Agent 化，依次问三个问题：步骤能否预先枚举？结果能否自动验证？出错能否恢复？三者都答「否」才值得上 Agent。官方点名的两个已验证领域是客服（对话 + 工具，可测解决率）与编码 Agent（可用自动化测试验证）([Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents))。

工程上还有一层边界：想要自己掌控循环、路由与状态，用 Responses API；想让 SDK 管理循环、工具执行、护栏与会话，用 Agents SDK（[OpenAI Agents 指南](https://developers.openai.com/api/docs/guides/agents)）——对应到产品决策，就是「自研编排 vs 用框架」的取舍：自研灵活但成本高，框架快但受制于框架抽象。

#### 自主度分级：辅助 → 半自主 → 全自主

自主度是产品光谱而非开关。参考 Claude Code 的权限模式设计，可分成三级，每级的产品设计含义不同：

| 级别 | 特征 | 产品设计含义 |
| --- | --- | --- |
| 辅助 | 建议、草稿、可覆写 | 无执行风险，重点是内容质量与上下文 |
| 半自主 | Agent 执行 + 关键节点人工确认 | 确认点设在风险点；不可逆操作必须确认 |
| 全自主 | 自动执行、自动纠错 | 必须有验证闭环与预算护栏（步骤上限、成本上限） |

Claude Code 的权限体系是现成的分级参考：Manual 模式默认只读、写操作逐次征求批准；Auto 模式由分类器模型审查动作、拦截风险操作，常规动作不再打扰人；沙箱提供文件系统与网络隔离，让 Agent 在限定边界内自主工作（[Claude Code 安全文档](https://code.claude.com/docs/en/security)）。OpenAI 官方指南同样指出：人在环内的介入点由开发者决定，SDK 内置「可恢复的审批流程」（resumable approval flows）作为标准机制（[OpenAI Agents 指南](https://developers.openai.com/api/docs/guides/agents)）。

分级不是一次性决定，而是随信任增长的动态过程：Claude Code 的 Auto 模式在分类器反复拦截时会把会话回退到更保守的交互方式，避免无人值守运行静默失控（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）——「代理权动态调节」是产品上值得抄的机制。

**全自主的放行条件**：Anthropic 指出 Agent 最适合在「可信环境 + 充分沙箱测试 + 护栏」下运行（[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）；Claude Code 的实践原则更直接——「无法验证的改动不要上线」（trust-then-verify gap 的解法是永远给 Agent 一个可运行的检查）（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）。
放行全自主之前，先回答：错误是否被约束在可回滚范围内？

### 代理权与信任

#### 权限最小化与操作确认点

-   **最小权限**：Agent 能调用什么工具、触碰什么数据，是产品设计的第一决定。Claude Code 默认「非白名单即拒绝」（fail-closed），未匹配的敏感命令必须人工批准；工作目录边界限定 Agent 只能写启动目录及其子目录（[Claude Code 安全文档](https://code.claude.com/docs/en/security)）
-   **确认点设在风险点**：不可逆操作（发消息、付款、删除、写生产数据）必须人工确认，可逆操作不打扰用户。OpenAI Agents SDK 的审批流支持「运行暂停 → 人类批准/拒绝 → 从暂停点恢复」，拒绝结果还会反馈给模型学习（[Running Agents 文档](https://openai.github.io/openai-agents-python/running_agents/)）
-   **护栏与确认并用**：输入/输出护栏（guardrails）在 Agent 执行之外并行校验，用「绊线」（tripwire）快速失败；护栏默认并行运行，代价是触发时模型可能已消耗 token，成本敏感场景应改为阻塞模式（[Guardrails 文档](https://openai.github.io/openai-agents-python/guardrails/)）
-   **提示注入是输入面**：Claude Code 把网页抓取放在独立上下文窗口、网络命令默认需批准、复杂命令附自然语言解释——Agent 读到的第三方内容本身就是攻击面，产品要考虑「内容来自不可信来源」时的隔离（[Claude Code 安全文档](https://code.claude.com/docs/en/security)）

#### 可观测性与信任建立

-   **展示规划步骤**：Anthropic 把「显式展示 Agent 的规划步骤」列为透明度优先项（[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）；执行中的当前步骤、调用的工具、依据都要可见，用户可以中途插入、暂停、接管
-   **回答带来源**：Anthropic 的研究系统专门设计 CitationAgent 为结论溯源；产品上 Agent 产出应可点击回到依据（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）
-   **失败透明**：Agent 反复尝试同一失败路径时如实展示，不要伪装成正常执行；Claude Code 的最佳实践是「给 Agent 一个能自己跑的检查」（测试、构建、截图对比），让验证闭环而不是靠人盯（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）
-   **可回退**：Claude Code 的 checkpoint 机制让对话与代码状态都可回滚到任意历史点，用户一句「撤销」即可回退（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）
-   **系统级可观测**：OpenAI SDK 内置 tracing，把每次工具调用、每轮推理可视化，是 Agent 调试与线上监控的标准设施（[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)）
-   **信任建立在评测上**：Anthropic 建议「先写简单 prompt，用全面评测迭代优化」（[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）——对产品经理，这意味着放权前先有可量化的通过率/解决率基线，信任额度 = 评测证据

#### 代理权要赚取，不要授予

每多给系统一分**代理权**，就少一分控制：建议式回复可以覆写，自动发送就必须确保正确。常见错误是系统还没证明「犯错时可控」就直接上全代理——失去可见性、失去信任、动作无法追溯。正确姿势是**控制交接**：出错时人类能无缝接管，如 Agent 做错了一步，用户能一键纠正并记录，信任和可恢复性从这一步开始。

### 失败恢复与降级

#### 错误处理与重试

Agent 与传统软件的失败模式不同——错误会**有状态地累积**。Anthropic 团队明确指出：Agent 无法简单重启，需要可恢复的检查点与重试逻辑；「原型到生产的差距往往比预想的大，最后一公里常常占了大部分旅程」（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）。产品层面的落地：

-   **持久化执行**：LangGraph 等编排框架的 durable execution 让图跨失败持久化、从断点恢复，长任务不因一次故障从头再来（[LangGraph 文档](https://docs.langchain.com/oss/python/langgraph/)）
-   **重试要有边界**：官方数据表明 Agent 错误会复合累积，不能靠无限重试；要区分「可重试的瞬时错误」与「反复失败的系统性问题」——后者应立即降级或转人工，而不是继续烧 token（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）
-   **可打断**：用户随时能叫停，中断后状态保留可续跑；Claude Code 提供 Esc 中断与 /rewind 回滚（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）
-   **人工接管路径**：任务失败要能无缝转人工，不能静默卡死；Claude Code 的 Plan 模式把「探索 → 计划 → 实施 → 提交」分成四个阶段，人在计划批准点接管（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）

#### 成本失控防护

-   **步骤预算**：OpenAI Agents SDK 的 `max_turns` 限制 Agent 循环步数，超出即抛 `MaxTurnsExceeded`；`max_function_tool_concurrency` 限制并发工具调用（[Running Agents 文档](https://openai.github.io/openai-agents-python/running_agents/)）
-   **按调用链分级**：用廉价模型做护栏、昂贵模型做正事，是官方推荐的省钱模式；护栏阻塞模式在模型启动前拦截，避免无效 token 消耗（[Guardrails 文档](https://openai.github.io/openai-agents-python/guardrails/)）
-   **显式降级路径**：预算用尽或反复失败时，产品应有明确降级——从全自主降为「每一步确认」或转人工；Claude Code 的 Auto 模式在分类器反复拦截时回退到更保守交互，即是「代理权可降级」的参考实现（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）
-   **接受成本换效果**：Anthropic 明示「Agent 的自主意味着更高成本，且错误会叠加」；多 Agent 系统 token 消耗约为普通对话的 15 倍，在 BrowseComp 上 token 用量单独解释了约 80% 的表现差异（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）——预算上限、超时、最大步数必须作为一等设计要素

#### 常见坑

-   **Demo 陷阱**：演示场景可控，真实场景千变万化——上线前用真实数据压测
-   Agent 反复尝试同一失败路径，浪费 token——配合步骤预算与护栏
-   工具权限过宽，出现「AI 把公司文件删了」级事故——最小权限 + 确认点
-   忽略了「结果可验证」：Agent 产出的报告没人核对，比没有更糟——验证闭环
-   多 Agent 之间的「传话游戏」：子 Agent 产出经转述后失真——让子 Agent 直接写产物文件，只传引用（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）
-   框架掩盖底层 prompt 与响应，出问题时无从下手——先直接用 LLM API 起步，用框架前先读懂它（[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）

### 多 Agent 编排与人机协作

#### 单 Agent vs 多 Agent：先看官方实测

Anthropic 的实测给出了目前最权威的取舍数据：以 Claude Opus 4 为主、Sonnet 4 为子 Agent 的多 Agent 系统，在其内部研究评测上比单 Agent Opus 4 好 90.2%，但 token 消耗约为普通对话的 15 倍（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）。因此：

-   **适合多 Agent**：重度并行、信息量超出单一上下文窗口、需要对接大量复杂工具的场景
-   **不适合多 Agent**：需要所有 Agent 共享同一上下文、Agent 间强依赖的领域——官方明示大多数编码任务属于此类
-   **两种委托原语**：OpenAI SDK 提供 handoffs（把控制权完全交给另一个 Agent）与「Agent 即工具」（管理者模式，主 Agent 保持控制）两种编排方式，对应产品上「交接责任 vs 保留监督」两种协作关系（[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)）
-   **编排模式**：官方落地的是 orchestrator-worker（主 Agent 拆任务、子 Agent 并行执行、汇总结果），并强调「把委派写清楚」——子任务描述含糊会导致重复劳动；子 Agent 把产物写入文件系统、只传引用给主 Agent，避免「传话游戏」（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）
-   **社区验证**：linux.do 上有团队复盘自研的 7-Agent 研发流水线（需求分析/架构/审查/编码/测试/部署），结论是链路冗余、职责边界模糊；回复中多名实战者直言「多 Agent 是无效的副作用」——上下文混乱、无效沟通，主张「一个上下文内的 multi mode 比 multi agent 更适合」；另有回复提醒「生产系统不敢用」「这么多 Agent 一个小问题都得跑半天」（[linux.do 讨论帖](https://linux.do/t/topic/2636562)）——与官方「大多数任务先上单 Agent」的建议互相印证

#### 工作流先行：五类官方模式

如果任务还没到需要 Agent 的复杂度，Anthropic 给出五类工作流模式，覆盖大多数确定性流程：**prompt chaining**（链式）、**routing**（路由）、**parallelization**（并行：切分/投票）、**orchestrator-workers**（编排器-工人）、**evaluator-optimizer**（评估-优化循环）——建议先选其一，跑通再加自主度（[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）。简单的先上：**固定工作流 + 单 Agent + 人工复核**。要算清多 Agent 的账：官方数据显示 token 用量单独解释了约 80% 的评测差异（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）——多 Agent 的收益本质是「花钱买并行度与上下文隔离」，先量化收益再决定值不值。

#### 人在环内（Human-in-the-Loop）的设计

-   **检查点式介入**：LangGraph 的中断（interrupt）机制允许在任何节点暂停并**检查、修改 Agent 状态**后再继续，适合「先看再放行」的高风险步骤（[LangGraph 文档](https://docs.langchain.com/oss/python/langgraph/)）
-   **审批流**：OpenAI SDK 的运行器原生支持「暂停等批准 → 恢复」；配 `pre_approval_tool_input_guardrails` 可让护栏先于审批执行（[Running Agents 文档](https://openai.github.io/openai-agents-python/running_agents/)）
-   **对抗式复核**：Claude Code 推荐用独立上下文中的复核子 Agent 审查产出——「干活的人不给自己打分」；写手/审稿分 session 是官方推荐的并行模式（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）
-   **长任务与人协作**：审批可能要等几分钟甚至几小时，Agent 必须能「挂起等待」而非超时失败——OpenAI SDK 文档把 Temporal、Dapr 等持久化执行框架列为 human-in-the-loop 工作流的支撑设施（[Running Agents 文档](https://openai.github.io/openai-agents-python/running_agents/)）
-   **机制要确定**：CLAUDE.md 这类提示是「建议性」的，靠模型自觉；需要零例外保证的动作（如禁止写入某目录）要用 hooks 这类确定性机制实现（[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)）

完整框架见 [AI 产品开发生命周期（CC/CD）](../pm/ai-lifecycle.md)。

### 对 AI 产品经理的清单

设计评审时逐项过：

-   **权限**：工具清单是否最小？有没有工作目录/网络/数据边界？非白名单动作是否默认拒绝？（[Claude Code 安全文档](https://code.claude.com/docs/en/security)）
-   **护栏**：输入/输出/工具三层护栏是否齐备？绊线触发后是否快速失败且不产生副作用？（[Guardrails 文档](https://openai.github.io/openai-agents-python/guardrails/)）
-   **恢复**：是否有持久化检查点？失败后能否从断点续跑？人工能否在任何节点接管？（[LangGraph 文档](https://docs.langchain.com/oss/python/langgraph/)）
-   **成本**：步骤预算（`max_turns`）、并发上限、超时、成本上限是否配置？预算用尽时的降级路径是什么？（[Running Agents 文档](https://openai.github.io/openai-agents-python/running_agents/)）
-   **可观测性**：步骤日志、工具调用、token 消耗是否可见？规划步骤是否对用户透明？（[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）
-   **评测**：先小后大——约 20 个代表性 query 就能发现早期大问题；用 LLM-as-judge 按统一 rubric 打分，但**人工测试会抓到评测抓不到的问题**（如偏好 SEO 内容农场而非权威来源）；对会改状态的 Agent，官方建议评测「终态」而非逐轮打分（[多 Agent 研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)）
-   **工具即产品**：把 Agent 的工具接口（ACI）当 HCI 一样设计——给模型足够的思考 token 再行动、格式贴近模型见惯的自然文本、避免 JSON 转义等格式开销、附上示例与边界、用「防错」（poka-yoke）设计让错误难发生（[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）
-   **信任基线**：回答带来源、失败透明、可回退——没有这三样，不要放大代理权

**总结**：Agent 产品设计的三个不变式——代理权靠评测赚取、失败可恢复、成本有预算；实现顺序永远是「先简单后复杂」：工作流 → 单 Agent → 人工复核 → 逐步加自主度。

???+ example "练习"
    设计一个「AI 会议纪要员」Agent：列出它的工具清单、执行步骤、3 个需要人工确认的节点、成本上限策略。

### 来源说明

> 本文综合参考以下权威来源，内容由本站撰写整理：

-   [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)：工作流与 Agent 的区分、五类工作流模式、透明度与工具设计建议（设计空间、代理权、编排、清单）
-   [Anthropic — How We Built Our Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)：多 Agent 实测数据与架构、成本量级、评测方法（失败恢复、编排、清单）
-   [Anthropic / Claude Code — Best Practices](https://code.claude.com/docs/en/best-practices)：验证闭环、权限模式、checkpoint、对抗式复核（代理权、人机协作、清单）
-   [Anthropic / Claude Code — Security](https://code.claude.com/docs/en/security)：权限架构、工作目录边界、提示注入防护（代理权、清单）
-   [OpenAI — Agents 指南](https://developers.openai.com/api/docs/guides/agents)：Agent 官方定义与能力边界（设计空间）
-   [OpenAI Agents SDK — Overview](https://openai.github.io/openai-agents-python/)：agent/handoff/guardrail/session/tracing 原语（编排）
-   [OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-python/guardrails/)：输入/输出护栏、绊线、阻塞模式（代理权、成本、清单）
-   [OpenAI Agents SDK — Running Agents](https://openai.github.io/openai-agents-python/running_agents/)：`max_turns` 步骤预算、审批流、并发上限（失败恢复、人机协作、清单）
-   [LangGraph — 官方文档](https://docs.langchain.com/oss/python/langgraph/)：有状态图、持久化执行、human-in-the-loop 中断（失败恢复、人机协作、清单）
-   [linux.do — 多 agent 协作，研发流水线交流！](https://linux.do/t/topic/2636562)：社区实测反馈（多 Agent 编排的取舍）
