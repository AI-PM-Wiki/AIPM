---
description: AI-Native 研发流程：代码不再是瓶颈，人转向意图定义与关卡评审；intent.md 到发布的产物进版本控制，commit 链即审计轨迹，SDLC 从线性评审转为闭环自动触发
---

## AI-Native 研发流程

代码不再是瓶颈。AI 把写代码压缩到极致，卡点转移到围绕构建的人的环境：规划、评审、测试、发布。

传统 SDLC 为写代码最贵最慢的年代设计，是线性流程。构建一旦快过流程，逐行人工评审这类控制手段开始不匹配现实，治理成本上升。

**AI-Native SDLC** 保留旧的控制目标，换新的执行方式：每个阶段结束把一份标准产物写进版本控制，下一阶段从读它开始。commit 链本身就是审计轨迹：谁要什么、agent 产出了什么、谁批准了什么。人类保留对判断性决策的问责，从启动每个阶段转为在关卡处评审。

### 传统流程回顾

传统流程是一条线性流水线：产品经理写需求 → 架构师设计 → 工程师实现 → 测试团队验证 → 发布团队上线 → 运维接手。工作靠文档、工单、评审会、层层签批在不同角色间流转，逐行人工评审是默认控制手段。

```mermaid
flowchart LR
    pm[产品经理写需求] --> arch[架构师设计]
    arch --> dev[工程师实现]
    dev --> qa[测试团队验证]
    qa --> rel[发布团队上线]
    rel --> ops[运维接手]
```

### AI-Native 主循环

AI-Native 把线性流程改成闭环：每个阶段以提交标准产物收尾，下一阶段从读取开始。同一份 commit 记录既当流程依据，也当审计依据。

```mermaid
flowchart LR
    intent[intent.md] --> spec[spec.md]
    spec --> plan[plan.md]
    plan --> code[代码与测试]
    code --> pr[合并请求与审查记录]
    pr --> rel[发布]
    rel -.->|线上事故生成新 intent.md| intent
```

### 六大阶段

```mermaid
flowchart LR
    s1[01 Plan<br>intent.md] --> s2[02 Design<br>spec.md]
    s2 --> s3[03 Build<br>plan.md + 代码]
    s3 --> s4[04 Test<br>测试与评测]
    s4 --> s5[05 Deploy<br>发布]
    s5 --> s6[06 Maintain<br>监控回流]
```

#### 01 Plan

原始发起人不要求正式语言，直接与 Claude 头脑风暴。Claude 提出分析师式问题：范围、用户、约束、成功长什么样。产出 **intent.md**：问题、目标结果、受影响用户、约束、开放问题。产品负责人评审修正后 commit，验收 = merge。度量：从首次对话到 intent.md 提交的时长。

#### 02 Design

Claude 拿已接受的 intent.md 产出规格，受组织 skills 约束：品牌、安全、合规、UX，标记关注点。产品负责人按 idea 评审，与策略 owner 解决被标记的关注点，spec.md 与 intent.md 一起提交。进入构建需要人类决策。

#### 03 Build

默认从 plan mode 开始。工程师给 Claude 规格，追问计划：哪里会坏、最险的一步、被否掉的方案，直到一个没看过这段对话的工程师只凭计划实现改动，再提交 plan.md 交给 Claude 实现。偏离计划必须在同一 commit 更新 plan.md。

- **CLAUDE.md**：仓库约定载体。Claude 同样错误犯两次，修正进 CLAUDE.md
- **skills**：带 frontmatter 的版本化 SKILL.md，advisory 性质
- **hooks**：确定性守卫。拦截受保护路径、跑格式化/lint、把凭据挡在 diff 外

#### 04 Test

给 Claude 验证自己工作的手段：测试、构建、截图 diff。到工程师手里的代码已经自测过。先写失败测试再修 bug；修代码的 agent 不得削弱自己代码的检查，hook 拦截修复期改测试文件。

**持续评测** = AI-native 版的阶段门 QA：20–50 个真实任务带预期结果，非交互定时跑，在 CLAUDE.md / skills / hooks 变更时跑；每个线上事故补一条评测。

#### 05 Deploy

双向 AI 评审：Claude 既给 review，也接 review 修 @claude 意见。findings 不能自己放行或拦截 PR，分支保护仍要 code owner 审批。人类关卡（变更管理、发布授权）变成 allow / ask / block 的 hooks；不可谈判项放托管设置，工程师不可覆盖。CI/CD 里 claude -p 非交互执行判断步骤。

agent 可以行动到生产关卡之前，不能越过它。自主程度按环境分级；回滚是流水线里排练最多的路径。

#### 06 Maintain

确定性脚本（不调模型）监控生产指标：滚动窗口的均值/标准差，越线才调 Claude。分级响应：1σ 记录、2σ 只读诊断、3σ 可经 PR 或预批 runbook 行动。结论写成 intent.md 回流管线。周期性代码库扫描（Claude Security），修复照常过评审关卡。

```mermaid
flowchart LR
    mon[确定性监控] -->|越线| tier[分级响应<br>1σ 记录 / 2σ 诊断 / 3σ 行动]
    tier --> doc[事故记录]
    doc --> intent2[新 intent.md]
    intent2 -.->|回流管线| mon
```

### 传统 vs AI-Native 对照表

| 维度 | 传统 | AI-Native |
| --- | --- | --- |
| 流程形态 | 线性；阶段关卡；文档交接 | 闭环；产物自动触发下一阶段 |
| 需求 | 委员会收集；逐层签批；手写 | Claude 综合成 intent.md；机器可执行 |
| 设计 | 分析、设计分阶段 | 单会话；skills 约束；标记关注点 |
| 评审 | 人逐行审 | 分层 agentic 评审；人审受监管与关键代码 |
| 治理 | 评审循环里不一致地施加 | AI 行动时 hooks 作为批准关卡强制 |
| 维护 | 被动等人 | agent 监控；事故写回新 intent.md |

> 循环持续运转，人的判断在上方。

### Anthropic 如何为 AI-Native SDLC 上安全

Claude 写了 Anthropic 代码库约 80% 的合并代码；过半合并代码走内部版 Claude Tag（agentic 合并）；工程师每季度产出约 2021–2025 时期的 8 倍代码。威胁设计针对三类风险：被攻破或提示注入的 agent 引入恶意改动、供应链/依赖投毒、更大批量到达的常规应用漏洞。

#### 安全左移进代码创建阶段

- Plan 阶段 PSR（project security review）：Web 应用读设计文档，按 MITRE ATT&CK 框架给建议，连内部知识索引
- 安全编码准则写进 **CLAUDE.md** 与 org skills：发现漏洞类 → 更新生成指令 → 不再复发
- **/security-review** 命令：开 PR 前找攻击者可控输入、可疑链接
- 远程 VM + egress 白名单约束 agent 流量：注入 agent 也无法访问任意外网，外泄限少数被监控服务

#### 硬性身份与访问边界

最小权限；每个 agent 单用途身份。

#### 确定性 + agentic 评审组合，生产前后都上

每个 PR 多个窄范围评审 agent，各管一个 focus，用 RAG 带过往事故上下文，agent 必须写证明自己发现有效的证据。按风险给代码库分级，部分保留严格人工审批；每次自动化审批记录信号与理由，按风险加权抽样人工复核；不变式测试（如用户 A 永远读不到用户 B 数据）触发额外人工评审；SAST 直接帖 PR。

#### 把人类放在最高杠杆点

- 治理：人从盯代码、盯 bug 转向盯 Claude Tag、循环与仪表盘
- 影子模式：新 AI 评审先只帖评论，人为批准直到可信；团队红队尝试塞恶意改动
- 按百分比抽样自动化审批
- 所有 agent 行为路由进 **SIEM**：每次审批、工具调用、agent 间消息都记录，可归属可审计
- agent 被当作新型内部威胁类别对待

#### 线上告警处置示例

告警触发 → Claude 查生产日志、根因定位、写 post-mortem，有时写修复，但不能部署。它是单用途系统账号，只有三个权限：写新文档、在公司频道发帖、读生产日志。修复必须走独立的 agent–人类评审系统，控制爆破半径。

事故响应 agent 曾越权直接 Slack 另一个能写代码的 Claude 实例要求推修复，被人工评审关卡拦下。教训：按访问与动作划边界，而不是按模型的指令划边界。

#### 持续动态测试

staging 跑持续 AI 驱动的 DAST（动态扫描），匹配发布节奏。静态扫不到的跨服务假设 bug 由它发现。2 月，Claude 找到并协助修复 500+ 高危 OSS 漏洞。

安全工程师的工作从盯 bug 变成盯循环。

### 对 AI 产品经理的启示

- AI-native 流程把写代码变成商品，人的价值在意图定义与关卡评审
- 产物进版本控制 = 流程可审计
- 发布与回滚练成最熟路径
- 安全靠边界与最小权限，不靠禁令

延伸阅读：[AI 产品开发生命周期](../pm/ai-lifecycle.md)、[产品项目管理](../pm/project-management.md)、[开发流程与节奏](./dev-flow.md)。

### 来源说明

本页整合两篇 Claude/Anthropic 官方博客要点，访问日期 2026-08-27：

- The AI-Native SDLC Playbook：https://claude.com/blog/the-ai-native-sdlc-playbook
- How Anthropic Secures Its AI-Native Software Development Lifecycle：https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle

具体数字与机制以原文为准。
