---
name: parallel-development
description: Worktree-first parallel development for Domain Map — every concurrent task or branch (and every parallel subagent) develops in its own git worktree cut from `dev`, then merges back to `dev`. Use when starting a new feature/fix, spawning parallel subagents, resolving branch conflicts, or running the sequential merge orchestration of finished workstreams.
---
> **ADAPT**: 本文件是基座约定,风格源自参考项目 Domain Map。接入本项目时,路径/门禁/分支命名按 `README.md`「适配指南」与 `workflow.json` 调整;boss 自动化链路以 `workflow.json` 为权威配置。


# Parallel Development (worktree-first)

Domain Map may be developed by several agent sessions at once (frontend,
backend, database). This skill keeps parallel branches mergeable and the main
working tree stable. The user's stated principle (2026-08-17): **always develop
inside a git worktree; branch flow is `dev` → `feature/…`/`fix/…` → back to `dev`.**

## Rules

1. Never develop a parallel task directly on the main working tree — always create a worktree.
2. Branch: `feature/<scope>` / `fix/<scope>` cut from `dev`, merged back to `dev` when green. `main` is user-only release promotion.
3. Subagents each get their own worktree + branch; they return conclusions and evidence, not file dumps — keeps the main agent's context clean.
4. Conflicts are resolved per-worktree (small, reviewable), never by clobbering a shared checkout.

## Create a worktree

A fresh agent session **creates its own worktree** as its first step — do not
ask the user to pre-create it. From the repo root:

```bash
# from repo root, with dev current
git switch dev && git pull --ff-only origin dev
git worktree add -b feature/<scope> ../domain-map-wt-<scope> dev
cd ../domain-map-wt-<scope>
```

> ⚠️ Cut from `dev`, not the default branch. Claude Code's `EnterWorktree` tool
> branches from `origin/<default-branch>` (here `main`) by default, which would
> miss all Phase 1/2 work — prefer the explicit `git worktree add … dev`
> command above, or configure a `dev` `baseRef` before using `EnterWorktree`.
> All development and commits for this task happen inside the worktree; never
> edit the main working tree directly.

## During development

- Keep the branch small and frequently synced — `git merge dev` (or `git rebase dev`) inside the worktree so divergences stay small.
- Run the project gates before merging: `cd server && npm test && npm run typecheck`, `make docs-check`, `git diff --check`.
- Commit on the feature branch with Conventional Commits.

## Merge back to `dev`

```bash
cd /Users/acccan/domain-map          # back on the main tree
git switch dev && git pull --ff-only origin dev
git merge --no-ff feature/<scope>   # keep a merge commit per feature
git worktree remove ../domain-map-wt-<scope>
git push origin dev
```

## Merge orchestration (sequential multi-branch merge)

When several parallel workstreams (`feature/<ws1>`, …, `feature/<wsN>`) have
finished and need to merge back to `dev` one after another, a single session
can run the whole orchestration — a fresh session only needs this skill, no
long prompt. Current batch (2026-08-17): **WS1 → WS2 → WS3 → WS4**, contract in
`tech/18-national-scale-plan.md` §3.2.

1. **Preflight** — main tree at repo root, on `dev`:
   ```bash
   git switch dev && git pull --ff-only origin dev
   git worktree list          # every ws branch exists on its own worktree
   git status --short         # main tree clean
   ```
2. **Order = dependency order** (foundation first, frontend last):
   - hard: the schema / read-path workstream merges first (others consume its
     drop shape / API); the frontend workstream merges last (it consumes the
     finished API).
   - current batch: WS1 (schema/read paths) → WS2 (data, consumes WS1's shape)
     → WS3 (LLM validation — independent, soft order) → WS4 (frontend).
3. **Per workstream — strictly sequential, stop on first red**:
   ```bash
   git merge --no-ff feature/<ws>          # one merge commit per feature
   cd server && npm test && npm run typecheck   # trust-but-verify post-merge
   make docs-check && git diff --check
   ```
   - If the merge fails or gates go red, stop there — never merge past a
     broken branch; report which branch failed and why.
   - Conflicts: file boundaries are mostly disjoint; real conflicts land in
     shared docs (`tech/`, `CHANGELOG.md`, `Makefile`, `package.json`). Resolve
     them on the dev working tree at merge time, then re-run the full gates.
     Never force-push or clobber.
4. **Finish each merged ws** (tolerate pieces the agent already cleaned up):
   ```bash
   git push origin dev
   git worktree remove ../dm-wt-<ws> 2>/dev/null || true
   git branch -d feature/<ws> 2>/dev/null || true
   ```
5. **Report** what merged and each merge's gate result. Env-only steps (apply
   the new `db/` migration, `npm run import:seed:apply`) are the user's — do
   not run them.

## Conflict handling

- Conflicts are local to a worktree: resolve there (edit + `git add`), commit, then merge back.
- Because each branch is a separate directory, parallel work never overwrites another branch's files.

## Subagent pattern (main-agent context hygiene)

- Give each parallel subagent its own worktree + branch (`isolation` keeps them disjoint).
- The subagent works only in its worktree, runs its own tests, and returns: what changed, test results, evidence. It does not paste file contents back.
- The main agent double-checks the returned diffs (trust-but-verify per `agent.md`), then merges to `dev`.

## Bulk-labeling fan-out (proven 2026-08-17, 668 companies)

For large mechanical+judgment data work (e.g. company tier/category labeling), fan
out **data-shard** subagents instead of doing it inline (keeps the main context
clean; 5 × ~130 rows in ~4–7 min each):

1. **Anchor set first** — hand-label ~30 diverse cases yourself, get user sign-off.
2. **Shard the input** — one TSV per batch (`slug\tname\thints\tcity`), no overlap.
3. **One prompt per shard** — rules inline (scales → tier bands, industry → category
   map), the anchor file path as reference, output = a strict JSON mapping written
   to `/tmp/label_batch_N.json`. Require: full coverage, no extras, valid values.
4. **Merge + normalize** — main agent merges shards, then applies the anchor bands
   to fix cross-shard drift (expect some: e.g. 京东/美团 labeled 0 vs band 4-5).
5. **QA gate (`server/scripts/qa-labels.mjs`)** — coverage 668/668, value ranges,
   anchor-bands (prefix-match with exclusion, e.g. 京东 ≠ 京东方), same-entity
   variant consistency. Fix drift, re-run, then write back.

Write-back and QA scripts stay in the repo (`apply-company-labels.mjs`,
`qa-labels.mjs`) so the next batch reuses them.

## Current repo state (2026-08-17)

`dev` was synced with `feature/phase-2-multi-mode` (fast-forward merge) — all of
Phase 1/2 lives on `dev`. Cut new `feature/` / `fix/` branches from `dev` and
they carry the full current codebase.
