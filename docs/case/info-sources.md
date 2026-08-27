---
description: 高质量信息渠道索引：CC98、中文社区、博客、Newsletter 与读书笔记。
---

## 信息源索引

本页汇总 AI 产品经理主题的高质量信息渠道：校内一手（CC98）、中文社区、微信公众号检索、国内外产品经理博客与 Newsletter、X 与海外社区、教程类站点，以及本站原创的 [读书笔记](books/index.md) 系列。每类注明访问方式（含门槛）与 Agent 使用提示。与 [学习资源](resources.md) 互补：那页是内容精选，本页是渠道索引。

### 使用说明

| 场景 | 首选渠道 | 访问方式 | Agent 提示 |
| --- | --- | --- | --- |
| 微信文章 | 搜狗微信搜索 | 模板 URL（见下） | 关键词 percent-encode 后填入模板 |
| 中文 AI 开发者社区 | linux.do | 浏览器访问，部分板块需登录 | Playwright |
| 中文问答 | 知乎 | 需登录，公开页可读 | WebFetch 公开页 |
| 海外产品/增长一手 | X、Newsletter、博客 | X 需登录 | 登录态需用户协助 |
| 教程与文档 | 人人都是产品经理、GitHub Docs、awesome 列表 | 公开 | WebFetch |
| 经典书籍精读 | 本站 [读书笔记](books/index.md) 系列 | 本仓库 `docs/case/books/`，已读原书全文 | 可直接引用；引用前核对原书章节 |

### 校内一手信息（CC98）

浙大校内论坛，一手信息质量高（实习/校招、课程、技术讨论）。访问：校内网络直连或 WebVPN；本机已配置 CC98 MCP（mcp__cc98__*），Agent 优先用 MCP 搜索与读帖。

版面链接需校内网络，本页暂未实采。检索路径：用 MCP 搜索版面名，如「人工智能」「大模型」「产品经理」「实习求职」；人类用户可在论坛内搜索同名词条。

### 中文社区与论坛

| 名称 | 链接 | 内容定位 | 访问方式 | Agent 提示 |
| --- | --- | --- | --- | --- |
| linux.do | https://linux.do | AI 开发者社区，应用/工具/教程讨论质量高 | 部分板块需登录 | Playwright |
| 知乎 | https://www.zhihu.com | 中文问答，产品经理话题 | 需登录，公开页可读 | WebFetch 公开页 |
| V2EX | https://www.v2ex.com | 技术社区，产品讨论 | 公开 | WebFetch |

### 微信公众号文章检索

-   搜狗微信搜索（微信公众号文章检索）：模板 `https://weixin.sogou.com/weixin?type=2&query=%s`，`%s` 替换为 URL 编码后的关键词
    -   Agent 用法：关键词做 URL 编码后填入模板再访问，不要用通用网页搜索代替
-   公众号直达：在微信客户端内搜索名称订阅（具体公众号见下一节）

### 国内产品经理博客与公众号

| 名称 | 入口 | 内容定位 | 访问方式 |
| --- | --- | --- | --- |
| 苏杰（《人人都是产品经理》作者） | 微信内搜索「苏杰思行」 | 产品方法与职业成长 | 微信内订阅 |
| 刘飞（《从点子到产品》作者） | 微信内搜索「刘言飞语」 | 产品方法论 | 微信内订阅 |
| 少楠 | 产品沉思录（小报童订阅） https://xiaobot.net/p/pmthinking2023 | 产品思考知识库 Newsletter | 小报童公开订阅（付费） |
| 俞军 | 《俞军产品方法论》 | 产品经理能力体系 | 公开书籍 |
| 梁宁 | 《产品思维 30 讲》（得到课程） | 产品思维框架 | 得到 App 课程 |
| 王诗沐 | 《幕后产品》 | 产品与设计 | 公开书籍 |
| 范冰 | 公众号「增长官研究院」；《增长黑客》 | 增长方法 | 微信内订阅；书籍公开 |
| 纯银 | 微信内搜索「纯银V」；微博 @纯银V | 产品方法论与行业观察 | 微信/微博需登录 |

### 海外产品经理博客与 Newsletter

| 名称 | 链接 | 内容定位 | 访问方式 |
| --- | --- | --- | --- |
| Marty Cagan | https://www.svpg.com | 硅谷产品经典（Inspired 作者） | 公开 |
| Julie Zhuo | https://www.juliezhuo.com | 产品与团队管理（The Making of a Manager 作者） | 公开 |
| Lenny Rachitsky | https://www.lennysnewsletter.com | 产品与增长 Newsletter | 公开 |
| Teresa Torres | https://www.producttalk.org | 持续发现方法 | 公开 |
| John Cutler | https://cutlefish.substack.com | 产品流程与实验 | 公开 |
| First Round Review | https://review.firstround.com | 一线实践访谈 | 公开 |
| Andrew Chen | https://andrewchen.com | 增长与网络效应 | 公开 |
| a16z | https://a16z.com | AI 与产品观察 | 公开 |

### X（Twitter）与海外社区

-   X 关注清单（需登录）：@shreyas（Shreyas Doshi，产品管理方法）、@lennysan（Lenny Rachitsky）、@andrewchen（Andrew Chen）、@johncutlefish（John Cutler）
-   Product Hunt | https://www.producthunt.com | 新产品发现 | 公开
-   Hacker News | https://news.ycombinator.com | 全球 AI 与产品动态（亦见[学习资源](resources.md)）

### 教程与文档类

| 名称 | 链接 | 内容定位 | 访问方式 |
| --- | --- | --- | --- |
| 人人都是产品经理 | https://www.woshipm.com | 中文产品经理文章/教程/专栏 | 公开 |
| GitHub Docs | https://docs.github.com | GitHub 官方文档 | 公开 |
| GitHub Skills | https://skills.github.com | GitHub 交互式教程（已并入 GitHub Learn） | 公开 |
| awesome 清单 | https://github.com/sindresorhus/awesome | 各领域精选列表索引 | 公开 |
| Prompt 工程指南 | https://github.com/dair-ai/Prompt-Engineering-Guide | Prompt 教程与资源 | 公开 |
| Awesome-LLM | https://github.com/Hannibal046/Awesome-LLM | 大模型学习资源索引 | 公开 |
| 大模型官方文档（OpenAI/Anthropic 等） | 见 [学习资源](resources.md) 官方文档一节 | 官方能力与定价 | 公开 |

### 读书笔记（本站原创精读）

本站 [读书笔记系列](books/index.md)（`docs/case/books/`）：基于原书全文的原创精读笔记，统一结构含「核心框架 / 关键概念与观点 / 与 AI 产品经理的结合点 / 局限与批判 / 可引用原文」，外文原版注明原文与中文译文。作为本站自有信息源，与上表各渠道互补：渠道解决去哪找，笔记沉淀读什么、怎么读。

| 书 | 笔记 |
| --- | --- |
| 《俞军产品方法论》 | [笔记](books/yujun-product-methodology.md) |
| 《人人都是产品经理 2.0》 | [笔记](books/pm-2-0.md) |
| 《启示录》INSPIRED | [笔记](books/inspired.md) |
| 《精益创业》The Lean Startup | [笔记](books/lean-startup.md) |

### 维护约定

-   条目格式：每条含「名称 / 链接 / 内容定位 / 访问方式」；新来源必须链接可达、注明访问门槛，Agent 提示尽量填
-   失效处理：CI 会以 htmltest 校验构建后站点站内链接与外链；发现失效链接，修正或加「（待核）」标注，按仓库 parallel-development 流程提交修复
-   更新记录：每次变更在下方表格最上方插入一行（最新在上）：

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-08-23 | 新增 | 读书笔记作为本站新信息源（俞军/苏杰/启示录/精益创业四篇原创精读笔记） |
| 2026-08-23 | 建页 | 初版信息源索引 |
