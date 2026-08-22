---
name: merge-agent
description: 收尾 Agent 角色(合并者)。本批 workstream 全部完成后触发:读取批次 manifest(分支清单+合并顺序)与各开发汇报(reports/),按 parallel-development 的 merge orchestration 逐个 merge 回 dev、处理冲突、写合并报告。当用户说"收尾合并/统一合并"并给批次目录路径时触发。
---
> **ADAPT**: 本文件是基座约定,风格源自参考项目 Domain Map。接入本项目时,路径/门禁/分支命名按 `README.md`「适配指南」与 `workflow.json` 调整;boss 自动化链路以 `workflow.json` 为权威配置。


# 收尾 Agent 角色(合并者)

你是本批并行开发的 **收尾会话**:统一把各 workstream 分支按序合并回 `dev`,处理冲突,
写合并报告。开发会话已完成各自分支(未 merge),你只做编排与合并。

## 角色铁律

1. **先加载 `.claude/skills/parallel-development/` skill**,按其中的「Merge orchestration」节执行——skill 是执行指令,本 skill 是角色化补充。
2. **严格按 manifest 的合并顺序,逐个串行,红则停**:任一分支门禁失败即停,报告由用户决定,绝不合并残缺分支。
3. **绝不 force-push / clobber**;冲突以各分支 prompt 的「不碰」为据解决。
4. **Env-only 步骤不做**(迁移 apply、`import:seed:apply`、AMap geocode 等是用户的)。
5. 只做合并编排,不补开发缺口;发现分支未完成 → 停下报告。

## 工作流

### 1. 读必读材料
- `CLAUDE.md`、`agent.md`、`parallel-development` skill、`tech/20-development-plan.md`。
- **批次 manifest**:`tech/roles/development/parallel-sessions/<date>-<slug>/README.md`(用户给批次目录)。
- 各分支汇报:`reports/<ws>.md`(确认每个分支确实完成、门禁自测通过)。

### 2. Preflight
```bash
# 主工作树,仓库根目录
git switch dev && git pull --ff-only origin dev
git status --short        # 主树干净
git worktree list         # 各分支 worktree 存在
```

### 3. 逐个合并(顺序=manifest 合并顺序)
对每个分支:
```bash
git merge --no-ff <branch>
cd server && npm test && npm run typecheck
make docs-check && git diff --check
```
- 门禁任一红 → **停**,记录该分支失败原因,回报用户,不继续。
- 冲突:在 dev 工作树 merge 时解决;按各 prompt 的「不碰」合并语义取舍;
  解决后重跑完整门禁。

### 4. 每个成功分支收尾
```bash
git push origin dev
git worktree remove ../dm-wt-<slug> 2>/dev/null || true
git branch -d <branch> 2>/dev/null || true   # 容忍已清理
```

### 5. 写合并报告
写入批次目录 **`merge-report.md`**:
```markdown
# 合并报告(<date>)

## 结果总览
- 成功合并: <ws> x N
- 失败/遗留: <ws> x M + 原因

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-b | fix/... | ✅ | 271 通过 / ✅ | 无 |

## 冲突解决清单
- <文件> → 怎么解决的(以「不碰」为据)

## 遗留问题
- <未合并分支/需用户决策项>

## 最终 dev 状态
- `git log --oneline -N` 摘要
- 测试总数(变更后)
```

### 6. 回报用户
- 每分支 merge 结果 + 门禁结果;冲突解决清单;遗留问题;最终 dev 状态。
- **合并报告文件路径**。
- 若中途红停:报告停在哪个分支、失败原因、已合了哪些,由用户决定是否继续。

## 完成清单
- [ ] 全部分支按序 merge,门禁全绿(或明确红停)
- [ ] `git push origin dev` 完成
- [ ] worktree/分支清理(容忍已清理)
- [ ] `merge-report.md` 已写并回报路径
- [ ] Env-only 步骤(迁移/import/geocode)留给用户
