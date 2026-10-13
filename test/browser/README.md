# 浏览器用例

用例使用真实构建产物、Chromium、Agent 服务和批注服务。模型请求经记录代理发送到明确授权的 HTTPS 端点，响应按原始字节转发。工具参数要求通过用户消息提交给模型，断言检查模型的实际行为。

```bash
uv sync --group browser
uv run playwright install chromium
mkdir -p meta/r
TMPDIR=meta/r uv run python3 test/browser/run.py
TMPDIR=meta/r uv run python3 test/browser/run.py draft_real
TMPDIR=meta/r uv run python3 test/browser/run.py --group independent --report meta/browser/independent.json
TMPDIR=meta/r uv run python3 test/browser/run.py --group model --report meta/browser/model.json
TMPDIR=meta/r uv run python3 test/browser/run.py --group oauth --report meta/browser/oauth.json
```

## 模型配置

运行模型相关用例需要显式提供以下环境变量。运行器按照用例所需配置检查完整清单，缺少配置的用例逐项记录为 `not_run`，对应组返回非零退出码。独立检查组覆盖草稿、缓存升级与异常过滤。

| 环境变量 | 用途 |
| --- | --- |
| `AIPM_REAL_MODEL_API_KEY` | 已获授权的模型凭据 |
| `AIPM_REAL_MODEL_BASE_URL` | Anthropic Messages 兼容的 HTTPS 端点，不含 `/v1` |
| `AIPM_REAL_MODEL_NAME` | 获授权的模型名称 |
| `AIPM_REAL_TEXT_ONLY_MODEL` | 图像拒收用例使用的真实模型 |

真实 GitHub OAuth 用例需要 `AIPM_REAL_GITHUB_CLIENT_ID`、`AIPM_REAL_GITHUB_CLIENT_SECRET` 和 `AIPM_REAL_GITHUB_ID`，并需要对应账号完成浏览器授权。批注服务的开发登录接口只用于隔离服务的许可与持久化检查；该结果不覆盖 GitHub OAuth。

## 端口与数据

静态站点通过操作系统分配回环端口。Agent、批注记录代理与服务端口均可由环境变量指定，缺省使用操作系统分配的端口。绑定失败即终止，测试不停止已有服务。

| 环境变量 | 用途 |
| --- | --- |
| `AIPM_TEST_AGENT_PORT` | Agent 服务 |
| `AIPM_TEST_ANNOTATION_PORT` | 批注请求记录代理 |
| `AIPM_TEST_MODEL_PROXY_PORT` | 模型请求记录代理 |
| `AIPM_TEST_ANNOTATION_SERVICE_PORT` | 公共底座的真实批注服务 |
| `AIPM_TEST_CONFIRMATION_SERVICE_PORT` | 确认流程的真实批注服务 |
| `AIPM_TEST_DRAFT_SERVICE_PORT` | 草稿流程的真实批注服务 |
| `AIPM_TEST_LEGACY_ANNOTATION_PORT` | 历史构建内的 URL，用浏览器请求转发到隔离服务 |

前端在回环页面读取 `window.__aipmLocalApi` 中的 `agent` 和 `annotation`。测试通过页面初始化脚本提供配置，生产 URL 保持现有设置。新目录与日志保存在忽略的 `meta/browser/` 中。

响应中断检查使用代理转发真实服务结果，然后中断连接。持久化故障检查在隔离数据目录制造文件系统故障。两类检查都保留原始 HTTP 状态和服务数据。

## 结果范围

本地确认回归通过生产 `createAgentEntry` 入口、受保护确认界面、真实批注服务和本机存储运行，不需要模型凭据。持续断言核对一次写入、通知／标记／确认时序、零许可请求、各 origin 的批注业务请求、已观察 fetch 的明文本机正文，以及十次重复通知后的存储、标记和请求数量。

每次完整运行使用新的隔离输出目录。运行中的继续操作使用该目录保存的浏览器空间 ID。在两个终端运行，下面的绝对路径使用当前候选副本的位置：

```bash
mkdir -p meta/local-confirmation/local-tmp
TMPDIR="$PWD/meta/local-confirmation/local-tmp" uv run mkdocs build -q -d meta/local-confirmation/site
TMPDIR="$PWD/meta/local-confirmation/local-tmp" uv run python3 test/browser/local_confirmation_stack.py --site meta/local-confirmation/site --output-dir meta/local-confirmation
```

```javascript
const { checkLocalConfirmation } = await import('/absolute/repo/test/browser/check_local_confirmation_ego.mjs');
await checkLocalConfirmation({ directory: '/absolute/repo/meta/local-confirmation', taskSpace });
```

将上述 JavaScript 保存为忽略目录中的脚本，使用 `ego-browser nodejs < 脚本路径` 执行。结果保存在 `after-timing.json`，断言映射见 `local-confirmation-assertions.json`。完成后使用 `browser-space.json` 的 ID 关闭浏览器空间，向 `runtime-config.json` 的 `control` 地址发送 POST 关闭服务。Multica 环境可通过 `--protected-pid` 提供 daemon PID，关闭前校验子进程身份。

`StaticSite.set_local_api()` 在每份测试 HTML 的 head 中提供专用回环端点，覆盖首次加载、导航和刷新。`enable_agent_confirmation=True` 用于该隔离回归。构建产物和生产默认端点保持正常配置。

上传结果分别登记：批注业务请求与已观察 fetch 的明文正文检查；外部 recorder 的 sendBeacon、XHR、编码载荷仍为 `not_run`。本脚本结果不覆盖完整录制上传链路。真实模型工具建议的端到端证据需要单独记录候选提交和请求用量。

## 本机内容的录制保护

`check_recorder_privacy_ego.mjs` 使用真实部署 recorder 检查首次插入、批注／评论创建与编辑、重绘、导航和恢复。`recorder-privacy.json` 保存审查过的脚本摘要、观察点及断言映射。脚本字节发生变化时检查终止，需要重新审查来源及观察点。

沿用上面的隔离服务启动命令，并为本组提供新的输出目录与站点 origin，确保本机存储没有已有记录。模型配置不需要注入。使用以下入口：

```javascript
const { checkRecorderPrivacy } = await import('/absolute/repo/test/browser/check_recorder_privacy_ego.mjs');
await checkRecorderPrivacy({ directory: '/absolute/repo/meta/recorder-privacy', taskSpace });
```

同一浏览器任务继续多个检查时，传入已保存的 `spaceId`。结果为 `recorder-results.json` 与只含非敏感测试内容的 `synthetic-recorder-traces.json`。按照该输出目录的 `browser-space.json` 和 `runtime-config.json` 完成浏览器及服务清理。

所有浏览器夹具在加载前安装 `block_external_uploads.js`，阻断外部 fetch、sendBeacon、XHR 写入。测试通过 Debugger 直接启动未修改的 recorder，并复制实际完整快照和增量事件；在原始发送函数入口，以其原始序列化函数检查真实参数。统计会话和抽样启动门禁、原生发送、sendBeacon／XHR 录制调用及 gzip／Base64 传输载荷分别标为未运行。

断言要求本机节点首次插入前已有 `rr-block`，页面正文及无障碍标签保持可读；完整快照产生无子节点、无敏感属性的尺寸占位；增量事件和完整 JSON 分片重组均排除本机标识。公开非敏感对照必须在完整快照、增量事件和序列化数据中继续出现。保护修复的发布验收需完成独立复核。

完整异常过滤组使用 `uv run python3 test/browser/run.py error`。并发传输检查使用
`uv run python3 test/browser/run.py static_transport`，同时发送 32 条真实 HTTP 请求，
逐条验证状态与资源字节。测试静态服务的监听队列容量为 128。

设置 `AIPM_TEST_HTTP_TRACE` 为忽略目录中的文件路径，可以记录监听端口、PID、
请求接收、响应、连接关闭、handler 异常、浏览器请求失败及服务关闭时序。例如：

```bash
mkdir -p meta/r
TMPDIR="$PWD/meta/r" AIPM_TEST_HTTP_TRACE="$PWD/meta/browser/http.jsonl" uv run python3 test/browser/run.py error
```

批注服务的逐项覆盖映射见 `annotation-server/test/coverage-109.json`，说明与核验命令见
`annotation-server/test/coverage-109.md`。映射分别登记已覆盖、缺配置与缺失检查。

`run.py` 显式发现 `check_*.py`；默认 Python 单测发现 `test_*.py`。完整报告分别记录单测、构建、许可／持久化、模型、OAuth、缓存升级和浏览器结果。失败及缺配置均不能计为通过。

批注服务的 `npm run unit-check` 覆盖纯函数、真实索引及本地 HTTP 许可检查。`npm run durability-check` 覆盖持久化、并发与请求记录。两组使用服务自身的会话签发功能进行权限检查。

`npm run model-check -- llm` 使用上述模型配置检查真实响应、token 计费、部分页面缓存覆盖、重复请求、重启加载及重新生成。`npm run model-check -- jev` 需要独立授权的 `AIPM_REAL_JEV_API_KEY`、`AIPM_REAL_JEV_BASE_URL`、`AIPM_REAL_JEV_MODEL`。缺少配置时输出待验收项目，返回非零退出码。模型限流、输出形状失败、低置信度、provider 切换以及真实 GitHub OAuth 的验收结果需单独提供实际请求证据。
