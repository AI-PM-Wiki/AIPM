# CLAUDE.md

本文件为在 AI-PM 仓库工作的 Claude Code 会话提供项目事实、门禁与开发约定。
以 `.claude/workflow.json`、`docs/intro/format.md` 与仓库实际为准,不沿用任何上游模板。

## 项目概述

**AI-PM** 是一个中文 AI 产品管理知识 wiki(https://hyc.ac/aipm/),用 MkDocs 构建、
定制 Material for MkDocs 主题(主题为 git 子模块 `mkdocs-material`;fork 链:
squidfunk/mkdocs-material → oi-wiki 深度定制 → Hi-Yincan/mkdocs-material,基线 9.6.15)。
站内搜索使用**官方本地搜索**(`site/search/search_index.json`),已不是 oi-wiki 时代的远程服务端搜索。
该仓库继承自 oi-wiki 深度 fork,曾遭 oi-wiki 残留污染(远程搜索端点、上游域名、CI 与脚本引用等),
2026-08 已彻查清理并建立防残留检查(见「门禁」)。
纯静态站点,无后端、无数据库。内容为协作维护的原创中文资料,覆盖 AI 产品方法论、LLM 能力与工具、
提示词工程、Agent 工作流、评测与求职专题等。

### 搜索架构与主题维护(2026-08 定案:不装包、深定制 fork)

- 主题经 `custom_dir` 加载(`theme.name: null`),**不安装** `material` Python 包,故 mkdocs.yml 的
  `- search:` 解析为 **mkdocs 内置 search 插件**(`config.plugins` 键为 `search`,非 `material/search`)。
- 兼容契约:主题 `partials/header.html` 的搜索检查用双键
  `"material/search" in config.plugins or "search" in config.plugins`(子模块已改,勿改回单键)。
- `hooks/on_env.py` 的 `on_config` 摘除内置插件注入的 `search/main.js`(经典主题死代码,依赖
  `base_url`,每页抛 ReferenceError)。
- 主题子模块改动一律**提交后立即推送**子模块远端,防止 gitlink 指向远端不存在的 commit
  导致 clone/CI/submodule update 失败(2026-08-23 踩过:主题 4 个 commit 未推,整链断裂)。
- 规模思考:搜索引擎可换(换 mkdocs 插件即可,内容零改动);真正的长期投资在内容结构
  (锚点稳定、frontmatter/tags、区块目录),不锁定任何搜索方案。

## 文档结构

`docs/` 按主题分为六个区块 + 求职专题:

- `intro/`:简介(关于、如何参与、格式手册、FAQ、产品经理黑话速查、能力模型)
- `pm/`:产品方法论(需求分析、用户研究、设计、项目管理、AI 生命周期、PRD、商业化)
- `ai/`:AI 基础(LLM 能力、多模态、提示词工程、RAG、Agent、评测、架构)
- `practice/`:AI 产品实战(对话助手、知识库问答、Agent 产品、Copilot、工作流、合规)
- `tools/`:工具与平台(LLM API、成本测算、框架、提示词与评测工具、数据、效率工具)
- `case/`:案例与资源(产品拆解、自学、学习路线、学习资源、读书笔记、信息源索引、面试)
- `job/`:求职专题(大厂与架构、岗位与 JD、面经、真实感悟)
- `_static/` 与根目录站点文件:站点资源(favicon、manifest、CSS/JS、robots.txt、service-worker.js 等)

导航结构以 `mkdocs.yml` 的 `nav` 为准;新增页面必须登记进去。

## 信息源与外部资料

- 需要外部资料时,先读 `docs/case/info-sources.md`(信息源索引):校内 CC98、中文社区(linux.do、知乎)、
  微信公众号检索、国内外产品经理博客与 Newsletter、X 与海外社区、教程类(人人都是产品经理、GitHub 教程),
  每类注明访问方式(含登录墙等门槛)与 Agent 使用提示。
- **CC98**(浙大校内论坛,高质量一手信息:实习/校招、课程、技术讨论):本机已配置 CC98 MCP
  (`mcp__cc98__*` 工具),直接搜索、读帖;访问需校内网络或 WebVPN。
- **微信公众号文章**检索用搜狗微信搜索,模板 `https://weixin.sogou.com/weixin?type=2&query=%s`
  (`%s` 替换为 URL 编码后的关键词),不要用通用网页搜索代替。
- **linux.do 等论坛**:用浏览器访问(Playwright MCP)。
- **登录墙**(X、知乎等):只能读公开页面;登录态内容请用户协助。
- 外部资料获取与门禁的本地事实见下两节。

## 开发命令

Python 依赖由 uv 管理(`pyproject.toml` + `uv.lock`,仓库根已有 `.venv/`):

```bash
# 安装 Python 依赖(国内网络可加 --index-url https://pypi.tuna.tsinghua.edu.cn/simple/)
uv sync

# 安装主题与资源(确保 mkdocs-material 子模块检出并安装 vendor 资源)
./scripts/pre-build/install-theme.sh

# 本地预览
uv run mkdocs serve -v

# 构建静态站点(产物在 site/)
uv run mkdocs build -v
```

> `package.json` 有 4 个 scripts(`docs:format:check` 等,依赖 ts-node 与 remark),需先
> `yarn install` 装 node_modules 才能用——当前未安装且被 .gitignore,**不可用**;
> 门禁刻意只选零 Node 依赖的命令(见下)。

## 门禁

本地门禁以 `.claude/workflow.json` 的 `gates` 为准,改动提交前必须全过:

```bash
git diff --check                       # 无空白错误
uv run mkdocs build -q                 # 站点能构建(-q 只留告警)
python3 scripts/check-characters.py    # 无问题字符
bash scripts/check-upstream-remnants.sh  # 无上游 fork 残留(2026-08 新增,防 oi-wiki 残留回流)
```

- CI(GitHub Actions)现有工作流:check-characters.yml、check-upstream-remnants.yml(上游残留检查,
  2026-08 新增)、lint_pr_title.yml、build.yml(构建 + gh-pages 部署)、suggest-pr-reopen.yml、
  check-scripts.yml(视清理结果保留与否)等;其中门禁项(git diff --check、mkdocs build、
  check-characters.py、check-upstream-remnants.sh)本地零 Node 依赖可复现。
- CI 另有 htmltest 外链校验:配置见 `.htmltest.yml`,忽略 `^/aipm/` 前缀与
  空 href——站点部署于 `/aipm/` 子路径,htmltest 无法识别 base path。
- Netlify 用于 PR 预览(`netlify.toml`,构建脚本 `scripts/netlify/build.sh`)。

## 开发工作流

- **worktree-first 并行开发**(parallel-development skill):每个 workstream 从 `dev` 切出
  独立 worktree(命名 `aipm-wt-<ws>`);worktree 缺依赖时:`.venv` symlink 主仓库的
  (uv 的 .venv 可跨目录用),子模块用 `git submodule update --init --recursive` 检出;
  完成后由 merger 按序 `--no-ff` 合并回 `dev`。
- **分支**:`dev` = 集成分支;`main` = 发布分支,**绝不直接 push,只走 PR**
  (main 上的 push 触发 GitHub Actions 构建并部署到 gh-pages)。
- **批次/扫描目录**:在 `meta/development/`(parallel-sessions 与 quality-scans,已 gitignore),
  不放 `.claude/`——headless 会话的 Write 拒绝 `.claude/` 等敏感路径。
- **提交**:小步 Conventional Commit(如 `docs(ai): ...`);`git add` 只加当前 workstream
  拥有的文件,不碰他人文件。
- 开发 worker 绝不 push/merge/操作 worktree,由 merger/boss 统一执行。

## 内容约定

- 写作规范见 `docs/intro/format.md`:frontmatter、标题从 `##` 起、中文全角标点、中英文之间
  留空格、admonition(`note`/`warning`/`tip`/`example`)、站内链接用相对路径、图片放文章同级
  `images/` 子目录(小写英文、下划线命名)并带 alt 文本、代码块指明语言。
- 新增页面/系列必须登记 `mkdocs.yml` 的 `nav`;新增外部信息渠道时登记到
  `docs/case/info-sources.md`(与 `resources.md` 互补:那页是内容精选,本页是渠道索引)。
- 引用规范:以官方文档、作者原书、一手博客、linux.do、woshipm 等为权威来源;正文就近行内引用,
  文末附「来源说明」;原创撰写,禁止大段照抄;事实标注「以官方页面为准」并附引用日期。
- 锚点稳定:部分页面是全站引用枢纽(如 `docs/ai/evaluation.md` 被 6+ 岗位页引用),
  其 H2/H3 标题不做改动,只扩正文。

## 环境

- Python 3.10+(uv 管理,`uv sync` 装依赖;`.venv/` 在仓库根)
- Node.js 20+(package.json 声明;当前项目脚本未用,node_modules 未装)
- Git 子模块:`mkdocs-material`(定制主题,见「开发命令」)
- 站点部署于 `/aipm/` 子路径(site_url: https://hyc.ac/aipm/),根目录有 CNAME、
  robots.txt 等发布文件
