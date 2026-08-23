# AI-PM Agent Server

AI-PM Wiki(https://hyc.ac/aipm)的文档问答 Agent 后端。纯静态 wiki 之上的一层问答服务:
BM25 站内检索 + Claude Agent SDK 驱动回答,SSE 流式输出。

## 架构

```
POST /api/chat ──► server.ts (node:http 路由/CORS/限流/并发)
                      │  SSE: ready → sources* → delta* → done | error
                      ▼
                  agent.ts (runAgent: query() 生成器,块索引增量 diff)
                      │  mcpServers: { wiki } 进程内 MCP,strictMcpConfig
                      ▼
                  tools.ts (search_wiki / read_wiki_page)
                      ▼
                  search.ts (search_index.json 抓取+30min 刷新 / 中文分词 / BM25)
```

- 检索只依赖线上 `search_index.json`(mkdocs 官方搜索索引),**不发活 HTML 请求**;
  索引加载失败即启动失败,后台刷新失败则保留旧索引并在 `/healthz` 标记 `stale`。
- 中文分词:归一化 → 拉丁/数字 token → CJK 连续段 unigram + 字符 bigram
  (「提示词工程」→ 提/示/词/工/程/提示/示词/词工/工程);BM25(k1=1.5, b=0.75, tf 上限 3)。
- 工具面:`tools: []` 禁用全部内置工具,只剩 `mcp__wiki__search_wiki` / `mcp__wiki__read_wiki_page`;
  `disallowedTools` 列 9 项内置工具纵深防御;`strictMcpConfig` + `settingSources: []` 隔离宿主配置。
- SDK 子进程工作目录指向空 scratch 目录(`SCRATCH_DIR`),`persistSession: false`。

## 配置

复制 `.env.example` 为 `.env` 后填写。关键项:

| 键 | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | 必填,缺失时启动快速失败 |
| `MODEL` / `EFFORT` / `MAX_BUDGET_USD` / `MAX_TURNS` | SDK 会话参数(预算与轮数由 SDK 强制) |
| `SEARCH_INDEX_URL` / `INDEX_REFRESH_MS` | 索引地址与后台刷新间隔(默认 30 分钟) |
| `ALLOWED_ORIGINS` | 精确 Origin 白名单,逗号分隔,无通配符、无凭据 |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` / `CONCURRENCY_LIMIT` | 每 IP 滑动窗口限流 + 并发信号量(成本护栏) |
| `QUEUE_LIMIT` / `QUEUE_WAIT_MS` | 并发满时排队深度(默认 10)与等待上限(默认 60s),超限 503 + Retry-After |
| `TRUST_PROXY` | 置 `true` 时从 `Fly-Client-IP` 取客户端 IP(否则 socket 地址) |

## 开发与运行

```bash
npm install          # 装依赖(含 SDK 自带 CLI 原生二进制)
npm run build        # tsc → dist/
npm start            # 起服务,监听 PORT(默认 8787)
npm run smoke        # 检索冒烟:BM25 top-5 目检(零依赖,也可 node src/smoke-search.ts)
npm run cli -- --check-config   # 无 key 断言工具面配置组装正确
npm run cli -- --prompt "什么是 RAG?"   # 真跑一轮 agent
```

健康检查:`curl http://127.0.0.1:8787/healthz` → `{ok, indexDocs, stale, ...}`。

SSE 协议(事件流,15s 心跳注释行 `: ping`):

| event | data | 时机 |
|---|---|---|
| `ready` | `{requestId}` | 流打开 |
| `sources` | `{query, results:[{title,url,snippet}]}` | 每次 search_wiki 返回 |
| `delta` | `{text}` 增量 | 回答 token 块 |
| `done` | `{usage, costUsd, durationMs, numTurns}` | 终帧后关闭 |
| `error` | `{code: rate_limited\|budget_exceeded\|max_turns\|model_error\|internal, message}` | 随后关闭 |

预校验失败(400/403/413/429/503)返回纯 JSON,非 SSE。客户端断连即 abort,停止计费。

## 部署注意

- **单实例假设**:限流与并发信号量是进程内状态,横向扩容需改为共享存储
  (Redis 等);并发上限 4 对应 SDK 子进程数,实例数 × 4 为总并发。并发满时
  请求进入有界队列(`QUEUE_LIMIT`/`QUEUE_WAIT_MS`),不排队失败——这是成本
  护栏而非性能瓶颈:每个槽位背后是实打实的 LLM 调用,宁可让用户稍等也不可
  无上限并发烧穿月度预算。
- **索引刷新滞后**:内容更新后最多 `INDEX_REFRESH_MS`(默认 30 分钟)才会被问答读到;
  刷新失败不重启,`/healthz` 的 `stale` 标记可见。
- 日志不含原始 IP 与明文 prompt(限流事件只记 IP 的 sha256 前缀)。
- 首次启动需要能访问 `SEARCH_INDEX_URL`;SDK 需要能访问 Anthropic API(或配置代理)。
