---
name: parallel-development
description: Worktree-first parallel development for AI-PM wiki — every concurrent task or branch (and every parallel subagent) develops in its own git worktree cut from `dev`, then merges back to `dev`. Use when starting a new feature/fix, spawning parallel subagents, resolving branch conflicts, or running the sequential merge orchestration of finished workstreams.
---
> **ADAPT**: 本文件是基座约定,风格源自参考项目 Domain Map。接入本项目(AI-PM wiki,静态 MkDocs 站点)时,路径/门禁/分支命名已按 `workflow.json` 与 `.Codex/workflow-notes.md` 调整;boss 自动化链路以 `workflow.json` 为权威配置。


# Parallel Development (worktree-first)

This wiki may be developed by several agent sessions at once (different
topics, mkdocs.yml nav, build scripts). This skill keeps parallel branches
mergeable and the main working tree stable. Branch flow: `dev` → `feature/…`/`fix/…` → back to `dev`.

## Rules

1. Never develop a parallel task directly on the main working tree — always create a worktree.
2. Branch: `feature/<scope>` / `fix/<scope>` cut from `dev`, merged back to `dev` when green. `main` is user-only release promotion (CI 构建部署到 gh-pages,hyc.ac/aipm)。
3. Subagents each get their own worktree + branch; they return conclusions and evidence, not file dumps — keeps the main agent's context clean.
4. Conflicts are resolved per-worktree (small, reviewable), never by clobbering a shared checkout.

## Create a worktree

A fresh agent session **creates its own worktree** as its first step — do not
ask the user to pre-create it. From the repo root (`/Users/acccan/Repos/Hi-Yincan/ai-pm-wiki`):

```bash
# from repo root, with dev current
git switch dev && git pull --ff-only origin dev
git worktree add -b feature/<scope> ../aipm-wt-<scope> dev
cd ../aipm-wt-<scope>
```

> ⚠️ Cut from `dev`, not the default branch。Codex 的 `EnterWorktree` 工具默认从
> `origin/<default-branch>`(这里 `main`)切分支,会漏掉 dev 上的工作——用上面的显式
> `git worktree add … dev` 命令,或先配置 `dev` 的 `baseRef` 再用 `EnterWorktree`。
> 所有开发和提交都发生在 worktree 内;绝不直接改主工作树。

**worktree 依赖**(本项目的特殊点,缺了门禁跑不过;详见 `.Codex/workflow-notes.md`):

```bash
# .venv:symlink 主仓库的,免去每个 worktree 重新 uv sync
ln -s /Users/acccan/Repos/Hi-Yincan/ai-pm-wiki/.venv ./.venv
# mkdocs-material 是子模块:worktree 里用共享缓存检出(通常不重新下载)
git submodule update --init --recursive
```

## During development

- Keep the branch small and frequently synced — `git merge dev` (or `git rebase dev`) inside the worktree so divergences stay small.
- Run the project gates before merging (`workflow.json` 的 `gates`):
  `git diff --check`;`uv run mkdocs build -q`;`python3 scripts/check-characters.py`。
- Commit on the feature branch with Conventional Commits.
- 纯文档仓库:**没有 npm/yarn 构建脚本**(package.json 的 scripts 为空),不要跑
  `yarn run docs:format:*` 等 AGENTS.md 里已过时的命令。

## Merge back to `dev`

```bash
cd /Users/acccan/Repos/Hi-Yincan/ai-pm-wiki          # back on the main tree
git switch dev && git pull --ff-only origin dev
git merge --no-ff feature/<scope>   # keep a merge commit per feature
git worktree remove ../aipm-wt-<scope>
git push origin dev
```

## Merge orchestration (sequential multi-branch merge)

When several parallel workstreams (`feature/<ws1>`, …, `feature/<wsN>`) have
finished and need to merge back to `dev` one after another, a single session
can run the whole orchestration — a fresh session only needs this skill, no
long prompt。

1. **Preflight** — main tree at repo root, on `dev`:
   ```bash
   git switch dev && git pull --ff-only origin dev
   git worktree list          # every ws branch exists on its own worktree
   git status --short         # main tree clean
   ```
2. **Order = dependency order** (foundation first, consumers last):
   - 依赖序:mkdocs.yml 导航/模板类改动先行,纯新增内容页最独立放最后。
3. **Per workstream — strictly sequential, stop on first red**:
   ```bash
   git merge --no-ff feature/<ws>          # one merge commit per feature
   git diff --check
   uv run mkdocs build -q                  # trust-but-verify post-merge
   python3 scripts/check-characters.py
   ```
   - If the merge fails or gates go red, stop there — never merge past a
     broken branch; report which branch failed and why.
   - Conflicts: file boundaries are mostly disjoint; real conflicts land in
     shared docs (`mkdocs.yml`, `docs/index.md`, 章节 index 文件). Resolve
     them on the dev working tree at merge time, then re-run the full gates.
     Never force-push or clobber。
4. **Finish each merged ws** (tolerate pieces the agent already cleaned up):
   ```bash
   git push origin dev
   git worktree remove ../aipm-wt-<ws> 2>/dev/null || true
   git branch -d feature/<ws> 2>/dev/null || true
   ```
5. **Report** what merged and each merge's gate result. Env-only steps (部署/推送 gh-pages、
   Baidu 提交等)是用户的——不要跑;发布只对 `main` 提 PR。

## Conflict handling

- Conflicts are local to a worktree: resolve there (edit + `git add`), commit, then merge back.
- Because each branch is a separate directory, parallel work never overwrites another branch's files.

## Subagent pattern (main-agent context hygiene)

- Give each parallel subagent its own worktree + branch (`isolation` keeps them disjoint).
- The subagent works only in its worktree, runs its own gates, and returns: what changed, gate results, evidence. It does not paste file contents back.
- The main agent double-checks the returned diffs (trust-but-verify), then merges to `dev`.

## Current repo state (2026-08-22)

`dev` = 集成分支,`main` 只作发布(CI 构建部署 gh-pages)。新 `feature/` / `fix/` 分支一律从
`dev` 切出。仓库有用户进行中的未提交改动(`.gitmodules`、`README.md`、`docs/index.md` 等),
开发时避免在主工作树直接改动这些文件。
