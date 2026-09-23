# 浏览器用例

跑真实浏览器的用例,覆盖那些静态断言看不出来的东西:渲染时序、缓存、真实的网络
请求、页面上到底执行了哪份脚本。

```bash
uv sync --group browser                       # 装 Playwright(默认安装不含它)
uv run playwright install chromium            # 下载 Chromium,约 150 MB,一次性
uv run python3 test/browser/run.py            # 全部
uv run python3 test/browser/run.py chart      # 只跑文件名里带 chart 的那个文件
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
  同一个 origin,Service Worker 与 Cache Storage 都留着 —— 这正是「老用户升级」与
  「开个新端口再看一眼」的区别。HTTP 缓存也照**项目部署约定**活着
  (`harness.CACHE_CONTROL`:生产站 GitHub Pages 把响应钉成 `max-age=600`),校验符
  只由内容定(`ETag`,不发 `Last-Modified`)—— 两份构建的 mtime 先后与谁新谁旧无关,
  按 mtime 回来一问就会答 304,新的那份字节永远换不上。测试里没有哪一处统一关掉
  HTTP 缓存。
- **链路**:一个假的模型 API(把收到的请求体抄下来)加一个真的 agent-server
  (`SEARCH_INDEX_URL` 指向本地站点自己的索引,`ANTHROPIC_BASE_URL` 指向假 API)。
  不联网,也不需要真的 `ANTHROPIC_API_KEY`。聊天 widget 在 localhost 上写死请求
  `127.0.0.1:8787`,agent-server 因此固定跑在那个端口上。
- **异常分拣**:页面上的报错按**出处**分成「这条通路自己的」与「别人的」。出处按
  协议+主机+端口严格比,不看消息里出现了什么网址;拿不准的(堆栈里没有帧)计入
  失败。挡下来的记录由 `assert_no_page_errors` 逐条核对,并与用例声明的对齐。

## 三个文件

- `check_chart_flow.py` —— 图表语境。21 条,分两类。`ChartContextFlowTest` 那 16 条
  把 Service Worker 关掉(站点那个按地址做 cache-first,会把「读不完的响应」第二次
  请求挡回第一次的响应,两分量根本到不了服务端,见 `_Stream`):位图送的是图像本身
  且模型确实收到了、取图的三道限制(来源 / 类型 / 体积,含跨源重定向与读取中途取消)、
  Mermaid 取源时序、SVG 取不到时的回落、不可信 SVG 不执行、「仅本机」那条边界、配额
  降级之后重新生成、模型不收图时的反馈。`ServiceWorkerReadLimitTest` 那 5 条不关 SW,
  量的是同一件事在四种处境下还成不成立:这次读没命中缓存、缓存里已经有那张图、
  **放行范围只认取源那条请求的标记头**(同一地址发一条没带标记、只声明了
  `cache: "no-store"` 的请求作反例)、以及老用户带着旧缓存升到新构建。
- `check_cache_upgrade.py` —— 缓存升级:老用户在**同一个浏览器、同一个端口**上带着
  旧缓存刷新,必须换到新脚本,而且旧缓存不必被清掉;顺带断言这一下刷新把新的
  `service-worker.js` 取了回来。
- `check_error_filter.py` —— 异常分拣本身:本站脚本抛错时消息里带着别人的网址照样
  算我们的(哪怕形状与主题那句 `Invalid script: <地址>` 一模一样)、别人家的资源
  真没加载成时那两条记录才挡得下、出处拿不准的按失败计入、声明的「弄坏的地址」
  必须与浏览器实际报出来的一致。
