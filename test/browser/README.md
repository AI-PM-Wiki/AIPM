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
