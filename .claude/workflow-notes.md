# claude-boss-workflow 项目适配笔记(AI-PM wiki)

> 本文件记录本项目的适配决定,供后续维护者/boss 会话参考。权威配置在 `workflow.json`。
> 批次/扫描的可拷贝脚手架在 `.claude/template/`(batch 与 quality-scans 两套)。

## 批次目录位置(重要)

批次与扫描目录在 **`meta/development/`**(已 gitignore),**不在 `.claude/` 下**:
headless 会话(`claude -p`)的 Write 工具把 `.claude/` 等点目录视为「敏感路径」拒绝写入,
扫描报告/worker 汇报会因此落不了盘。`meta/` 位于 docs/ 之外,mkdocs 也不会发布它。

## 项目事实(与模板参考项目 Domain Map 的差异)

- **静态站点**:MkDocs + 自定义 Material 主题(主题是 git 子模块 `mkdocs-material`,fork 自
  Hi-Yincan/mkdocs-material)。无后端、无 server 目录、无数据库。
- **Node 脚本存在但依赖未装**:`package.json` 有 4 个 scripts(`docs:format:check` 等,依赖
  ts-node 与 remark),但 `node_modules/` 未安装且被 .gitignore。门禁刻意只选零 Node 依赖的
  命令(见下);将来 `yarn install` 后可在 gates 加回 `yarn run docs:format:check`。
- **Python 依赖**:uv 管理(`pyproject.toml` + `uv.lock`),本仓库根已有 `.venv/`。
- **发布链路**:`main` 分支 → GitHub Actions `build.yml` 构建 → 部署到 `gh-pages`
  (hyc.ac/aipm)。`main` 绝不能直接 push,只走 PR(与 workflow 默认一致)。
- **CI 门禁**(github/workflows):format / test / check-characters / check-quotes / check-scripts。
  本地可复现的是 `python3 scripts/check-characters.py` 与 mkdocs build。

## 本项目的门禁(workflow.json `gates`)

```bash
git diff --check
uv run mkdocs build -q
python3 scripts/check-characters.py
```

- `uv run mkdocs build -q`:真正的静态站门禁(失败=站建不出来,必须修)。`-q` 只留告警。
- 将来 `yarn install` 装好依赖后,可把下面这条加回门禁(链接/引用完整性检查,较慢):
  `yarn run docs:format:check`(即 `node --loader ts-node/esm scripts/checker/checker.ts -i`)

## worktree 依赖处理(DISPATCH 阶段,worktree 缺依赖时)

worktree 是从 `dev` 切出的全新 checkout,缺三样东西,boss 预建 worktree 后按需处理:

```bash
# 1) .venv:直接 symlink 主仓库的(uv 的 .venv 可跨目录用,免去每个 worktree 重新 uv sync)
ln -s <REPO_ROOT>/.venv <WORKTREE>/.venv

# 2) 主题子模块:worktree 里为空目录,用共享模块缓存检出(通常不重新下载)
git -C <WORKTREE> submodule update --init --recursive

# 3) node_modules(当前不存在;将来若安装,yarn 依赖同样 symlink 主仓库的)
ln -s <REPO_ROOT>/node_modules <WORKTREE>/node_modules
```

`.venv` 已 symlink 时,worker 里 `uv run` 直接用主仓库环境,秒级启动。
`mkdocs-material` 子模块在 worktree 里检出后,`git status` 可能显示子模块有未跟踪内容,
worker 用 `git add <具体文件>` 即可,不受影响。

## 分支流

- `dev` = 集成分支(workflow 自动 push);`main` = 发布分支(只提 PR)。
- 仓库原本只有 `main` + `gh-pages`,`dev` 由安装时从 `main` 切出。
- 注意:仓库存在未提交改动(`.gitmodules`、`README.md`、`docs/index.md` 等,属用户进行中
  的编辑),安装提交只包含 `.claude/`,不碰用户改动。

## 已删除的参考项目残留(勿恢复)

- spawn-*.sh / SKILL.md 中的 `npm run import:*`、`npm run geocode:*`、`make db-*`、
  `make crawl-official*`、`make refresh-radar*`、`make geocode-sites*`、`server/` 目录、
  `node_modules` 路径 —— 均属 Domain Map 项目,已在本项目适配中移除。
