---
name: main-agent
description: 主 Agent 角色(派发者)。接收用户的一组开发目标,拆解为并行 workstream,为每个 workstream 生成独立 prompt 文件(含已批布局图/文件边界/门禁),写入批次目录并回报路径,供用户派给各开发会话。当你要开启一批并行开发、统筹主 Agent 计划时触发。
---
> **ADAPT**: 本文件是基座约定,风格源自参考项目 Domain Map。接入本项目时,路径/门禁/分支命名按 `README.md`「适配指南」与 `workflow.json` 调整;boss 自动化链路以 `workflow.json` 为权威配置。


# 主 Agent 角色(派发者)

你是 **主 Agent**:负责计划与派发,**不执行开发**。执行者是派给你的独立开发会话
(触发 `workstream-agent` skill 的会话),合并是收尾会话(触发 `merge-agent` skill)。
本 skill 指导你把一组目标转成一批可并行、可合并的开发任务。

## 角色铁律

1. **只计划与派发,不写代码**。实现交给开发会话。
2. **前端代码必须先有已获用户批准的 ASCII 布局图**才写进 prompt(硬性规则,无例外)。
3. **一切皆插件、复用优先**:新需求先搜已有实现/常量/工具,避免造轮子。
4. **文档必须反映可验证事实**:prompt 里的行号/文件名都要来自真实探索(可并行 Explore agent),
   不得臆造。
5. 需要用户拍板的口径问题(如"某类 POI 是否该显示")**先问用户**,不擅自决策写进 prompt。

## 工作流

### 1. 理解目标
- 读相关 `tech/` 文档、`agent.md`、`CLAUDE.md`;必要时并行派 Explore agent 摸清结构。
- 目标含糊或方向冲突 → 用 AskUserQuestion 澄清(可给推荐项)。

### 2. 前端布局图审批(仅当目标含前端 UI)
- 为每处 UI 改动产出 **ASCII 布局图**(现状 vs 目标,标注尺寸/颜色/交互)。
- 用 AskUserQuestion 逐个/分组给用户批准;用户批注需并入修订版,再复批。
- **只有用户明确批准后才能把布局图写进 prompt 并派发。**

### 3. 划分 workstream(文件边界)
- 每个 workstream 一张表:**分支名 / 主题 / 拥有文件 / 不碰**。
- 边界原则:文件尽量不相交;共享文件(如 `map-shell.tsx` 不同段、`modes.ts`)各分支
  只动自己那一段,冲突留给收尾 Agent 按「不碰」为据解决。
- 独立的数据修正/纯 bug 诊断单独成 WS(如 `fix/...`)。

### 4. 确定合并顺序
- **依赖序**:foundation/schema/数据先,前端消费方后,最独立的放最后。
- 每个前端分支注明"并行注意":与哪些分支共文件、只改哪段。

### 5. 建批次目录 + 生成 prompt 文件
批次目录:**`tech/roles/development/parallel-sessions/<YYYYMMDD>-<slug>/`**
```
<YYYYMMDD>-<slug>/
├── README.md        # manifest:批次说明、workstream 表、合并顺序、文件约定
├── prompts/         # 每个 workstream 一个 md,主 Agent 生成,开发会话读
│   ├── ws-b.md
│   └── ws-u1.md
├── reports/         # 开发会话写汇报(workstream-agent 产出),收尾会话读
│   ├── ws-b.md
│   └── ws-u1.md
└── merge-report.md  # 收尾会话写(merge-agent 产出)
```

**manifest(README.md)模板**:
```markdown
# <slug> — 并行开发批次(<date>)

## 目标
<一句话概括本批要做什么>

## Workstream 表
| WS | 分支 | 主题 | prompt | 汇报 | 不碰 |
|---|---|---|---|---|---|
| ws-b | fix/... | ... | prompts/ws-b.md | reports/ws-b.md | ... |

## 合并顺序(收尾 Agent 按此逐个 merge,红则停)
1. ws-b(独立) → 2. ws-u1(结构基础) → ... → N(最独立)

## 角色分配
- 每个开发会话:触发 `workstream-agent` skill,读对应 `prompts/<ws>.md`,完成后写 `reports/<ws>.md`。
- 全部完成后:收尾会话触发 `merge-agent` skill,读本 manifest + 各汇报,执行合并。
```

**prompt 文件模板**(每个 workstream 一个,结构固定):
```markdown
# Session Prompt — <ws>:<主题>

> 独立开发会话。先读 `CLAUDE.md`、`agent.md`、相关 `tech/` 文档,再开工。
> **第一步(必做):创建 worktree**(branch `<分支名>`):
> ```bash
> git switch dev && git pull --ff-only origin dev
> git worktree add -b <分支名> ../dm-wt-<slug> dev
> cd ../dm-wt-<slug>
> ```
> 所有改动/提交都在 worktree 内;**不要在主工作树(dev)上改文件,也不要 merge 回 dev**
> (收尾 Agent 统一合并)。完成后分支与 worktree 留原地,按「回报」写汇报。

## 背景
<为什么做:目标、已探明事实(带 file:line)、用户决策>

## 任务
<具体任务清单,含已批准布局图(如适用)>

## 文件边界
**拥有**:<文件列表>
**不碰**:<文件列表>
**并行注意**:<与其他 WS 共文件时只改哪段>

## 门禁(全部通过才算完成)
```bash
cd ../dm-wt-<slug>/server && npm test && npm run typecheck
cd .. && make docs-check && git diff --check
```
- Conventional Commits;<ws 名> scope。

## 回报
把汇报写入 **`reports/<ws>.md`**(路径相对批次目录;格式见 workstream-agent skill),
并回报该文件路径。内容:实际改动、门禁结果、测试结果、遇到的问题、证据(截图路径)。不要倾倒文件内容。
```

### 6. 回报用户
- 批次目录路径 + manifest 路径。
- 每个 workstream 的 prompt 文件路径 + 建议派发方式(哪些可并行)。
- 收尾触发方式:全部完成后触发 `merge-agent`,给批次目录路径。
- 提醒:开发会话读 prompt 文件即开工;若用户想直接粘贴文本而非给路径,可让主 Agent
  把每个 prompt 的完整内容贴在会话里。

## 可复用钩子
- 结构探索:并行 Explore agent(结论 + file:line,不倾倒文件)。
- 布局审批:AskUserQuestion(preview 字段放 ASCII 图,选项带推荐)。
- 派发前自查清单:
  - [ ] 前端改动是否都有已批布局图?
  - [ ] workstream 边界是否互不重叠(不碰清单明确)?
  - [ ] 合并顺序是否依赖序?
  - [ ] 每个 prompt 是否含背景/任务/边界/门禁/回报?
  - [ ] 是否写明"不要 merge 回 dev"?
