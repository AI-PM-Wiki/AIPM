## 点赞登录回归测试

`annotation-like-login.mjs` 使用 Ego Lite、构建后的站点和本地批注服务，创建公开评论并通过真实 HTTP 接口签发、吊销开发会话。覆盖已登录点赞与取消点赞、匿名点赞、会话失效后点赞与取消点赞，以及回跳地址中的查询参数和锚点。

准备依赖：

```bash
git submodule update --init mkdocs-material annotation-server
uv sync
npm install --prefix annotation-server --package-lock=false
mkdir -p meta/like-login-data meta/tmp
```

分别启动站点与批注服务：

```bash
TMPDIR="$PWD/meta/tmp" uv run mkdocs serve -a 127.0.0.1:8122
```

```bash
DEV_AUTH_BYPASS=true DATA_DIR="$PWD/meta/like-login-data" \
SITE_BASE=http://127.0.0.1:8122 ALLOWED_ORIGINS=http://127.0.0.1:8122 \
SEARCH_INDEX_URL=http://127.0.0.1:8122/search/search_index.json \
node annotation-server/src/server.ts
```

运行测试：

```bash
ego-browser nodejs < test/browser/annotation-like-login.mjs
```

测试成功时关闭其浏览器任务空间，退出前删除测试评论并吊销会话。测试完成后停止上述两个本地服务。

并行开发中端口 `8788` 已被占用时，可给自己的批注服务设置 `PORT=8789`，通过 CDP 将浏览器的 API 请求转发至该服务：

```bash
{ printf "globalThis.annoTestOptions = {api: \"http://127.0.0.1:8789\"};\n"; cat test/browser/annotation-like-login.mjs; } | ego-browser nodejs
```

已有任务空间可在 `annoTestOptions` 中指定 `spaceId`。本地服务无需配置 GitHub OAuth 凭据；测试验证跳转到登录入口及其 `return` 参数，GitHub 授权与回调流程需要另行配置 OAuth App。
