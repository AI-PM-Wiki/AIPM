# 浏览器用例

跑真实浏览器的用例,覆盖那些静态断言看不出来的东西:渲染时序、缓存、真实的网络
请求、页面上到底执行了哪份脚本。

```bash
uv sync --group browser                       # 装 Playwright(默认安装不含它)
uv run playwright install chromium            # 下载 Chromium,约 150 MB,一次性
uv run python3 test/browser/run.py            # 全部
uv run python3 test/browser/run.py chart      # 只跑名字里带 chart 的
```

## 为什么不在默认门禁里

`uv run python3 -m unittest` 是每次改动都要跑的门禁,那份门禁刻意保持零浏览器依赖
(Playwright 因此单独一组 `browser`,不进 `uv sync` 的默认安装)。这里的文件名不以
`test_` 开头,默认发现也不会碰到它们;要跑就显式跑上面那几条。两者覆盖的东西不同,
不是快慢之分:静态断言锁形状,这里锁行为。

## 底座(`harness.py`)

- **建站**:`mkdocs build` 出一份真的 `site/`,与线上同一条构建路径(hooks 注入的
  `?v=`、Service Worker、主题都在里面)。传 `ref` 时先用 `git archive` 取出那个提交
  的源码树再建 —— 缓存那条用例要靠它造出「用户升级前的那一版」。
- **服务**:一个静态文件服务,`serve(root)` 换根而**不换端口**。对浏览器来说还是
  同一个 origin,缓存与 Service Worker 都留着 —— 这正是「老用户升级」与「开个新
  端口再看一眼」的区别。
- **链路**:一个假的模型 API(把收到的请求体抄下来)加一个真的 agent-server
  (`SEARCH_INDEX_URL` 指向本地站点自己的索引,`ANTHROPIC_BASE_URL` 指向假 API)。
  不联网,也不需要真的 `ANTHROPIC_API_KEY`。聊天 widget 在 localhost 上写死请求
  `127.0.0.1:8787`,agent-server 因此固定跑在那个端口上。

## 两个文件

- `check_chart_flow.py` —— 图表语境:位图送的是图像本身且模型确实收到了、取图的
  三道限制(来源 / 类型 / 体积)、Mermaid 取源时序、SVG 取不到时的回落、不可信 SVG
  不执行、「仅本机」那条边界。
- `check_cache_upgrade.py` —— 缓存升级:老用户在**同一个浏览器、同一个端口**上带着
  旧缓存刷新,必须换到新脚本,而且旧缓存不必被清掉。
