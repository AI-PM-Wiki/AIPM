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

PR 审查回归使用 `review_acceptance_stack.py` 启动真实服务和构建站点。输出目录必须全新；模型组需要上表中的三项模型配置。

```bash
mkdir -p meta/review/runtime
TMPDIR="$PWD/meta/review/runtime" uv run mkdocs build -q
TMPDIR="$PWD/meta/review/runtime" uv run python3 test/browser/review_acceptance_stack.py --site site --output meta/review/acceptance --model
```

将以下调用保存为忽略目录中的 JavaScript 文件，通过 `ego-browser nodejs < 脚本路径` 执行。首次运行后保存返回的 `spaceId`，后续调用传入同一个 ID。

```javascript
const { checkReviewAcceptance } = await import('/absolute/repo/test/browser/check_review_acceptance_ego.mjs');
let spaceId;
for (const phase of ['local', 'normalized', 'rejected', 'unknown', 'manual', 'upload', 'navigation', 'controls', 'integrity', 'model']) {
  const result = await checkReviewAcceptance({ directory: '/absolute/repo/meta/review/acceptance', phase, taskSpace, spaceId });
  spaceId = result.spaceId;
}
```

各阶段分别保存 JSON 结果：本机空正文高亮、公开／私有正文规范化及刷新恢复、真实 429 后重新确认、保存响应中断后的只读查询、手写私有评论、本机批注上传、延迟取图期间导航、匿名／管理员页头操作、资源不可用时的完整性失败，以及正常聊天入口产生的真实模型建议。Agent 建议使用受保护界面的原生键盘确认，手写评论与上传使用对应产品按钮。身份检查使用隔离服务的开发会话，GitHub OAuth 单独验收。

服务关闭时，向 `runtime.json` 的 `control` 地址追加 `/stop` 发送 POST；服务记录保存为 `service-results.json`。浏览器结束时，对相同任务空间执行一次 `task.finish({ keep: [] })`。不带 `--model` 可以执行前九个阶段。测试 sitemap 使用当前回环地址，导航阶段同时核对原文档未刷新。

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

`StaticSite.set_local_api()` 在每份测试 HTML 的 head 中提供专用回环端点，覆盖首次加载、导航和刷新。建议确认使用正常产品入口。

上传结果分别登记：批注业务请求与已观察 fetch 的明文正文检查；外部 recorder 的 sendBeacon、XHR、编码载荷仍为 `not_run`。本脚本结果不覆盖完整录制上传链路。真实模型工具建议的端到端证据需要单独记录候选提交和请求用量。

## 交互界面检查

`check_confirmation_ui_ego.mjs` 与 `check_editor_ui_ego.mjs` 在 1280、390、320 CSS 像素宽度下操作明暗主题。检查覆盖受保护确认区、范围选中与锁定、原生鼠标／键盘确认、本机批注编辑、评论错误提示、评论及回复保存／刷新，以及菜单的方向键、Escape 和焦点返回。可见范围与保存按钮的布局由浏览器核对实际几何尺寸、触控尺寸和菜单边界。

确认脚本默认使用 4000 字符以内、含 1200 次换行的正文。六组尺寸／主题通过原生 Enter 打开真实建议卡，分别执行取消与确认入口。正文区域记录 Home、ArrowDown、PageDown、End 的可信键盘事件、实际滚动位置及末行可见几何数据，Tab 依次访问确认与取消。确认入口保持程序点击零写入、可信确认单次写入及刷新恢复断言。

每次取消记录独立的起始事件数量，等待新增事件后要求恰好一次本组可信取消，同时检查本机批注的原始存储值、实际 setItem 次数、标记及后端业务写入／许可。相同的断言必须拒绝尚未新增事件的快照。完整入口与展示组件分别保存逐组 `*-cancel.json`、`*-result.json`、键盘滚动采样及截图；展示组件保留 30 项状态矩阵。`denseBody: false` 运行常规正文；`presentationOnly: true` 仅运行展示状态与取消矩阵，不能计为完整确认回归。每次复跑使用独立 origin，并提供同一个浏览器 `spaceId`。

键盘滚动逐键等待子文档的两次 requestAnimationFrame 并采集实际画面，再以三秒上限等待真实位置符合断言；按键持续 100ms，事件与滚动数据原样保存。取消及确认状态截图也等待子文档绘制。`scene: '390-slate'` 等六个标准组合可单独执行完整入口；该参数不运行展示状态矩阵。每个组合只执行一次并分别保存失败，不能将其他组合的结果计入本组，也不能用逐组通过覆盖整轮失败记录。

本机写入观测器在每份文档中幂等安装，调用原生 Storage 方法并计数，不替换其行为。`pageLabel` 可指定同一任务空间中的验收页面，默认值为 `p1`。

编辑菜单输入之前，夹具在三秒上限内等待面板动画结束，并要求按钮在连续三个渲染采样中保持相同几何数据。该等待只读取浏览器状态。`*-editor-layout.json` 保存逐帧数据；`*-input-trace.json` 保存实际 pointerdown／pointerup／click 目标及路径、当时的按钮矩形、焦点转移、编辑器节点身份、菜单 hidden／aria-expanded 变化和面板动画。断言要求恰好一次可信按钮输入，pointerdown 与 pointerup 均命中同一节点及其当时的矩形，选中的 local 选项收到焦点。原有方向键、Escape、确认和写入断言保持完整。

`check_editor_menu_ego.mjs` 提供 390 暗色菜单的独立探针。在全新的隔离 origin 中，通过原有本机存储创建非敏感长正文批注，执行标记、编辑及菜单的原生输入。默认在布局稳定后采样按钮中心并点击；`sampledPointer: false` 使用语义选择器。`synchronize: false` 用于记录动画期间采样坐标与输入发生时矩形的差异，结果继续使用相同失败断言。该探针检查菜单输入，确认及单次写入由完整矩阵覆盖。历史失败缺少输入时序时，应保留其根因限制。

```javascript
const { checkEditorMenu } = await import('/absolute/repo/test/browser/check_editor_menu_ego.mjs');
await checkEditorMenu({ directory: '/absolute/repo/meta/menu', taskSpace, spaceId });
```

每次探针使用新的隔离服务与 origin，输出菜单截图、`menu-input-trace.json`、`editor-layout.json`、`pointer-sample.json` 和成功时的 `menu-result.json`。`assertEditorMenuInput` 可直接核验保留的原始事件；失败事件与通过事件分别保存。

建议卡使用非敏感组件输入，通过条件 Debugger 观察点调用原有生产渲染函数。提供的 `sourceDirectory` 指向对应构建目录，脚本会比对实际服务资源字节。确认、存储和编辑检查使用生产入口、原生 localStorage 及独立批注服务。展示状态检查向生产 `createConfirmationView` 提交明确的组件状态输入，单独核对加载、警告、错误、取消、禁用和最大长度布局；该组不代表对应后端状态已经发生。断言映射见 `confirmation-ui-assertions.json`。

为修改前、修改后构建分别启动 `local_confirmation_stack.py`，每组使用新的隔离站点 origin，在同一个浏览器任务空间中顺序运行。脚本保留非敏感本机内容检查并只清理当前隔离 origin 中匹配的测试记录，遇到其他内容立即终止。首次创建任务空间后，后续检查必须提供同一个 `spaceId`。

```javascript
const { checkConfirmationUi } = await import('/absolute/repo/test/browser/check_confirmation_ui_ego.mjs');
const result = await checkConfirmationUi({ directory: '/absolute/repo/meta/ui-after', sourceDirectory: '/absolute/repo/meta/ui/site', taskSpace, spaceId });
const { checkEditorUi } = await import('/absolute/repo/test/browser/check_editor_ui_ego.mjs');
await checkEditorUi({ directory: '/absolute/repo/meta/ui-after', taskSpace, spaceId: result.spaceId });
```

界面检查阻断模型端点和外部录制上传，模型生成、Jev、GitHub OAuth、图像拒收及原生 recorder 发送继续分别登记。截图、`ui-results.json` 和 `editor-results.json` 保存在各组输出目录。受影响回归继续运行本机确认时序和真实 recorder 检查。

## 定位与限流反馈检查

`check_passage_feedback_ego.mjs` 使用同一条本机批注跨越两个正文段落和行内元素，要求产生多个真实 mark。鼠标点击及原生 Enter 在 1280、390、320 宽度下必须同时提示全部片段，保留一条本机记录和录制阻断标记，重复定位后的计时器正常结束。沿用独立 `local_confirmation_stack.py`，传入同一个 `spaceId`。

`rate_feedback_stack.py` 使用真实 Agent `createApp` 和索引，模型进程地址固定为不可连接的回环端口，自动重试为零。私有环境文件由 Node 在进程内读取，日志只记录方法、路径、状态。浏览器提交之前立即发送两条无效请求填满真实窗口，断言原生提交返回 429 并显示服务窗口提示。累计额度检查读取现有回环网关的实际计数，在独立站点设置更严格的本地上限，要求额度耗尽提示出现且没有新增 Agent POST；原网关额度与计数保持不变。该组没有上游成功响应，不能计为模型连通验收。

```bash
TMPDIR="$PWD/meta/r" uv run python3 test/browser/rate_feedback_stack.py --site site --output-dir meta/rate-feedback --env-file ~/.config/ai-pm-wiki/test.env --gateway http://127.0.0.1:8786
```

输出目录必须全新。保存以下调用到忽略目录中的脚本，通过 `ego-browser nodejs < 脚本路径` 执行；复用当前任务的 `spaceId`。完成后向 `runtime-config.json` 的 `control` 地址发送 POST 关闭本组服务。结果和映射为 `rate-results.json`、`passage-results.json`、`feedback-assertions.json`。服务限流、累计额度、上游错误分别记录。

```javascript
const { checkRateFeedback } = await import('/absolute/repo/test/browser/check_rate_feedback_ego.mjs');
await checkRateFeedback({ directory: '/absolute/repo/meta/rate-feedback', taskSpace, spaceId });
```

## 本机内容的录制保护

`check_recorder_privacy_ego.mjs` 使用真实部署 recorder 检查首次插入、批注／评论创建与编辑、回复编辑／保存／刷新恢复、已有本机评论的 private／local／public／local 可见性切换、新建公开评论草稿转本机、重绘、导航和恢复。可见性检查使用隔离后端的真实开发登录，GitHub OAuth 单列未运行。`recorder-privacy.json` 保存审查过的脚本摘要、观察点及断言映射。脚本字节发生变化时检查终止，需要重新审查来源及观察点。

沿用上面的隔离服务启动命令，并为本组提供新的输出目录与站点 origin，确保本机存储没有已有记录。模型配置不需要注入。使用以下入口：

```javascript
const { checkRecorderPrivacy } = await import('/absolute/repo/test/browser/check_recorder_privacy_ego.mjs');
await checkRecorderPrivacy({ directory: '/absolute/repo/meta/recorder-privacy', taskSpace });
```

同一浏览器任务继续多个检查时，传入已保存的 `spaceId`。结果为 `recorder-results.json` 与只含非敏感测试内容的 `synthetic-recorder-traces.json`。按照该输出目录的 `browser-space.json` 和 `runtime-config.json` 完成浏览器及服务清理。

所有浏览器夹具在加载前安装 `block_external_uploads.js`，阻断外部 fetch、sendBeacon、XHR 写入。测试通过 Debugger 直接启动未修改的 recorder，并复制实际完整快照和增量事件；在原始发送函数入口，以其原始序列化函数检查真实参数。统计会话和抽样启动门禁、原生发送、sendBeacon／XHR 录制调用及 gzip／Base64 传输载荷分别标为未运行。

断言要求本机节点首次插入前已有 `rr-block`，页面正文及无障碍标签保持可读；完整快照产生无子节点、无敏感属性的尺寸占位；增量事件和完整 JSON 分片重组均排除本机标识。公开非敏感对照必须在完整快照、增量事件和序列化数据中继续出现。保护修复的发布验收需完成独立复核。

映射中的 `requiredInsertionScenes` 要求每个创建、编辑及恢复观察区间的本机节点插入增量大于零；`requiredEditorInsertionScenes` 额外要求实际编辑器插入。观察点覆盖原生 `Node.appendChild`、`Node.insertBefore` 和 `Node.replaceChild`，结果逐项保存累计计数及区间增量。原地修改场景核对阻断、内容和存储状态，单列于 `in_place_scenes`。公开草稿在转本机之前保持公开编辑器状态，切换后核对阻断再输入本机测试内容，保存之前存储保持不变，保存后检查本机记录和 DOM。

分片重组在写入编号映射之前拒绝重复编号，并要求编号连续、分片完整及总数一致。异常检查从真实 recorder 产生的完整分片组构造重复编号、缺片及总数不一致的输入，逐项断言重组终止；这些校验输入单列为解析器异常检查。实际采集、序列化和未运行的原生发送结果继续分别登记。

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

## 界面反馈检查

`review-feedback-assertions.mjs` 提供三个真实浏览器检查入口：

- `checkPassageOutline(page, annotationId)`：打开对应批注面板后，检查跨超链接的本机批注按连续行绘制定位边框。`check_passage_feedback_ego.mjs` 已调用此入口。
- `checkInputFocus(page, selector)`：打开评论、批注或回复编辑器后，检查输入焦点、单层边框与外围光圈状态。
- `checkComposerConsumed(page, question)`：通过页面添加语境和文件附件后，执行真实问答，检查输入区域清空且已发送消息保留对应内容。

这些入口复用当前 ego-browser 任务的 `page`，问答需要已授权的真实 Agent 服务。

`npm run model-check -- llm` 使用上述模型配置检查真实响应、token 计费、部分页面缓存覆盖、重复请求、重启加载及重新生成。`npm run model-check -- jev` 需要独立授权的 `AIPM_REAL_JEV_API_KEY`、`AIPM_REAL_JEV_BASE_URL`、`AIPM_REAL_JEV_MODEL`。缺少配置时输出待验收项目，返回非零退出码。模型限流、输出形状失败、低置信度、provider 切换以及真实 GitHub OAuth 的验收结果需单独提供实际请求证据。
