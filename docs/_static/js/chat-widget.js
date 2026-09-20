/*
  AI-PM 文档问答 Agent 助手(chat-widget.js,2026-09-20)

  形态:右下角扁平胶囊按钮(图标 + 「询问助手」引导语)。点开后按视口宽度分三态:
  - 桌面停靠(≥1200px):面板 fixed 贴视口右侧(320–420px),整个 MkDocs 页面
    (页头 + 左侧 nav + 正文 + TOC)整体保留并收窄 —— 页面与面板是两个独立的
    布局区域、两个独立滚动容器;TOC 不再被替换或隐藏
  - 平板浮层(768–1199px):面板浮在页面之上 + 遮罩(页面不收窄,不被完全覆盖)
  - 移动抽屉(<768px):三段式底部抽屉,停靠点 peek(页面优先,18–25vh)/
    half(半开,45–60vh)/ expanded(近全屏,顶部留 --aipm-chat-top-gap 间隙);
    拖拽吸附、点手柄/头部切换、遮罩点击、系统返回、软键盘适配

  工程契约:
  - FAB / 遮罩 / 面板都 append 到 document.body 顶层(与 [data-md-toggle] 复选框
    同级),不在 [data-md-component=container] 内:instant 导航换页整体替换
    container 时三者都不受影响,对话状态(消息、滚动、流式)原样存活,无需观察器
    重挂;桌面收窄靠 html.aipm-chat-open.aipm-chat-mode--dock 给 .md-container 加
    margin-right(CSS 规则跟随新容器自动生效)
  - 形态与停靠点写在 <html>/面板 dataset 上:CSS 只读状态、JS 只写状态,几何全部
    交给 CSS(margin-right / 三段高度变量),JS 不做逐帧测量对齐
  - 三段高度由 metrics() 依 window.innerHeight / visualViewport 写入
    --aipm-chat-sheet-*;软键盘抬起时 near-full 高度随可视区收缩,输入框不被遮挡
  - 移动/浮层的系统返回:打开时 pushState 一条自家记录,返回键按
    expanded→half→peek→关闭 逐级回退(回退后补回记录,始终保持一条);
    从 UI 关闭时仅在自家记录仍是栈顶时 history.back(),避免连带退掉用户点开的文档页
  - 与后端契约:POST {message, history} → text/event-stream,帧事件
    ready / sources / delta / done / error;预校验失败返回纯 JSON(400/403/
    413/429/503),映射中文提示(429 附 Retry-After 重试时间)
  - 消息操作:每条 AI 回答气泡下方提供常驻「复制」「重新生成」(不随
    hover 显隐);重新生成截断该轮之后的历史并重发其上方那条用户消息
  - 附件:输入卡片内回形针按钮选择文件(也可拖拽进卡片),发送时以
    [附件] 名称(大小) 文本附注进消息体(纯 UI 演示,后端无需改动)
  - 预览站自禁用:location.hostname 以 netlify.app 结尾时不挂载,仅显示
    「预览站不加载问答助手」一行提示
  - 视觉:扁平实色,颜色全走 Material --md-* 变量(亮/暗自动);
    prefers-reduced-motion 禁位移动画
  - 键盘:Enter 发送、Shift+Enter 换行(原生 textarea,对 Material 快捷键豁免);
    Escape 关闭面板(仅面板开时);IME 组字中的 Enter/Escape 不触发;
    遮罩态(浮层 / 半开 / 近全屏)Tab 焦点不逸出面板
  - 无障碍:桌面停靠 role=complementary,抽屉与浮层 role=dialog
    (半开/近全屏 aria-modal=true,peek 非模态);打开后焦点进面板、
    关闭后回到触发按钮;手柄是可点可拖的 button
  - localStorage 存最近会话(≤20 条)+「清空对话」;服务端无状态
*/
(() => {
  "use strict";

  /* ================================================================
     常量与配置
     ================================================================ */
  const API_BASE = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8787"
    : "https://docs-agent.nvc.ac";
  const HISTORY_KEY = "aipm-chat-history";
  const HISTORY_MAX = 20;              // localStorage 条数上限
  const HISTORY_SEND = 8;              // 每次请求携带的最近历史条数
  const ATTACH_MAX = 4;                // 附件个数上限(纯 UI)

  /* 断点:≥75em(1200px)桌面停靠 / ≥48em 且 <1200px 浮层 / <48em 底部抽屉 */
  const MQ_DOCK = window.matchMedia("(min-width: 75em)");
  const MQ_SHEET = window.matchMedia("(max-width: 47.9875em)");

  /* 三段停靠点(PRD:peek 18–25vh / half 45–60vh / expanded 视口高 - 顶部间隙) */
  const SHEET_PEEK_VH = 0.22;
  const SHEET_HALF_VH = 0.55;
  const SHEET_PEEK_MIN = 136;          // 极矮视口下的 peek 保底高度(手柄+头部+速览条约 124px)
  const SHEET_TOP_GAP = 16;            // 近全屏态顶部保留的页面间隙(12–24px)
  const SWIPE_V = 0.45;                // px/ms:快速滑动阈值,超过则直接跳相邻停靠点
  const CLOSE_RATIO = 0.6;             // 下拉到 peek 的该比例以下即关闭
  const SHEET_MIN_H = 56;              // 拖拽下限(再往下就是关闭)

  /* 预览站自禁用:不挂载,仅显示一行提示 */
  if (/\.netlify\.app$/i.test(location.hostname)) {
    const note = document.createElement("div");
    note.className = "aipm-chat--netlify-note";
    note.textContent = "预览站不加载问答助手";
    document.body.appendChild(note);
    return;
  }

  /* ================================================================
     DOM 构造(body 顶层,instant 导航换页存活)
     ================================================================ */
  const els = {};

  const SPARK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19,9l1.25,-2.75L23,5l-2.75,-1.25L19,1l-1.25,2.75L15,5l2.75,1.25L19,9z M11.5,9.5L9,4L6.5,9.5L1,12l5.5,2.5L9,20l2.5,-5.5L17,12L11.5,9.5z M19,15l-1.25,2.75L15,19l2.75,1.25L19,23l1.25,-2.75L23,19l-2.75,-1.25L19,15z"/></svg>';
  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19,6.4L17.6,5L12,10.6L6.4,5L5,6.4L10.6,12L5,17.6L6.4,19L12,13.4L17.6,19L19,17.6L13.4,12L19,6.4z"/></svg>';
  const SEND_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4,12l1.4,1.4L11,7.8V20h2V7.8l5.6,5.6L20,12l-8,-8L4,12z"/></svg>';
  const STOP_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6,6h12v12H6z"/></svg>';
  const COPY_ICON =
    '<svg class="aipm-chat__icon-copy" viewBox="0 0 24 24" aria-hidden="true"><path d="M16,1H4C2.9,1,2,1.9,2,3v14h2V3h12V1z M19,5H8C6.9,5,6,5.9,6,7v14c0,1.1,0.9,2,2,2h11c1.1,0,2,-0.9,2,-2V7C21,5.9,20.1,5,19,5z"/></svg>';
  const CHECK_ICON =
    '<svg class="aipm-chat__icon-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M9,16.2L4.8,12l-1.4,1.4L9,19L21,7l-1.4,-1.4L9,16.2z"/></svg>';
  const REGEN_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65,6.35C16.2,4.9 14.21,4,12,4c-4.42,0 -7.99,3.58 -7.99,8s3.57,8 7.99,8c3.73,0 6.84,-2.55 7.73,-6h-2.08c-0.82,2.33 -3.04,4 -5.65,4 -3.31,0 -6,-2.69 -6,-6s2.69,-6 6,-6c1.66,0 3.14,0.69 4.22,1.78L13,11h7V4l-2.35,2.35z"/></svg>';
  const CLIP_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5,6v11.5c0,2.21 -1.79,4 -4,4s-4,-1.79 -4,-4V5c0,-1.38 1.12,-2.5 2.5,-2.5s2.5,1.12 2.5,2.5v10.5c0,0.55 -0.45,1 -1,1s-1,-0.45 -1,-1V6H10v9.5c0,1.38 1.12,2.5 2.5,2.5s2.5,-1.12 2.5,-2.5V5c0,-2.21 -1.79,-4 -4,-4S7,2.79 7,5v12.5c0,3.04 2.46,5.5 5.5,5.5s5.5,-2.46 5.5,-5.5V6h-1.5z"/></svg>';
  const FILE_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14,2H6C4.9,2 4,2.9 4,4v16c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V8L14,2zM16,18H8v-2h8v2zM16,14H8v-2h8v2zM13,9V3.5L18.5,9H13z"/></svg>';
  const TRASH_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6,19c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V7H6v12zM19,4h-3.5l-1,-1h-5l-1,1H5v2h14V4z"/></svg>';

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "aipm-chat__fab";
  fab.title = "打开问答助手";
  fab.setAttribute("aria-expanded", "false");
  fab.innerHTML = SPARK_ICON + '<span class="aipm-chat__fab-label">询问助手</span>';
  document.body.appendChild(fab);

  /* 遮罩:浮层形态与抽屉半开/近全屏时显示,点击关闭面板 */
  const scrim = document.createElement("div");
  scrim.className = "aipm-chat__scrim";
  scrim.setAttribute("data-level", "none");
  scrim.setAttribute("aria-hidden", "true");
  document.body.appendChild(scrim);

  const panel = document.createElement("div");
  panel.className = "aipm-chat";
  panel.id = "aipm-chat";
  panel.tabIndex = -1;
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "AI-PM 文档问答助手");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML =
    /* 拖拽手柄(仅抽屉形态显示;可拖拽、可点击切换停靠点) */
    '<button type="button" class="aipm-chat__grip" aria-label="调整助手面板高度">' +
      '<span class="aipm-chat__grip-bar"></span>' +
    "</button>" +
    '<header class="aipm-chat__head">' +
      '<span class="aipm-chat__head-icon">' + SPARK_ICON + "</span>" +
      '<span class="aipm-chat__title">助手</span>' +
      '<button type="button" class="aipm-chat__iconbtn aipm-chat__clear" title="清空对话" aria-label="清空对话">' +
        TRASH_ICON +
      "</button>" +
      '<button type="button" class="aipm-chat__iconbtn aipm-chat__close" title="关闭(Esc)" aria-label="关闭">' +
        CLOSE_ICON +
      "</button>" +
    "</header>" +
    /* 页面优先态速览条(仅 peek 显示:状态点 + 最近一句/流式状态) */
    '<button type="button" class="aipm-chat__peek" data-streaming="false" aria-label="展开助手面板">' +
      '<span class="aipm-chat__peek-dot"></span>' +
      '<span class="aipm-chat__peek-text"></span>' +
    "</button>" +
    '<div class="aipm-chat__msgs" role="log" aria-live="polite"></div>' +
    '<form class="aipm-chat__composer">' +
      '<div class="aipm-chat__attachbar" hidden></div>' +
      '<textarea class="aipm-chat__input" rows="1" placeholder="提出问题…" aria-label="提问"></textarea>' +
      '<div class="aipm-chat__inputrow">' +
        '<button type="button" class="aipm-chat__attach" title="添加附件(最多 ' + ATTACH_MAX + ' 个)" aria-label="添加附件">' + CLIP_ICON + "</button>" +
        '<button type="submit" class="aipm-chat__send" title="发送" aria-label="发送" disabled>' + SEND_ICON + "</button>" +
      "</div>" +
      '<input type="file" class="aipm-chat__file" multiple hidden>' +
    "</form>";
  document.body.appendChild(panel);

  els.fab = fab;
  els.scrim = scrim;
  els.panel = panel;
  els.msgs = panel.querySelector(".aipm-chat__msgs");
  els.composer = panel.querySelector(".aipm-chat__composer");
  els.attachbar = panel.querySelector(".aipm-chat__attachbar");
  els.input = panel.querySelector(".aipm-chat__input");
  els.send = panel.querySelector(".aipm-chat__send");
  els.clear = panel.querySelector(".aipm-chat__clear");
  els.close = panel.querySelector(".aipm-chat__close");
  els.attach = panel.querySelector(".aipm-chat__attach");
  els.file = panel.querySelector(".aipm-chat__file");
  els.grip = panel.querySelector(".aipm-chat__grip");
  els.peek = panel.querySelector(".aipm-chat__peek");
  els.peekText = panel.querySelector(".aipm-chat__peek-text");

  /* ================================================================
     Markdown-lite(先 escapeHtml 再转义,防 XSS;系统提示词已约束
     不产出标题/表格,这里只支持粗体/行内代码/链接/列表)
     ================================================================ */
  const escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const LINK_RE = /(?<!!)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  const inline = (text) => {
    /* 先整体 escapeHtml(防 XSS),再转粗体/链接/行内代码 */
    text = escapeHtml(text);
    /* 先摘出 `行内代码` 占位,避免其中的 ** 与 [](url) 被误转 */
    const codes = [];
    text = text.replace(/`([^`]+)`/g, (m, c) => {
      codes.push(c);
      return "\x00" + (codes.length - 1) + "\x00";
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(LINK_RE, (m, t, u) =>
      `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    text = text.replace(/\x00(\d+)\x00/g, (m, i) => `<code>${codes[+i]}</code>`);
    return text;
  };

  const mdLite = (src) => {
    const out = [];
    let list = null; // { tag: "ul"|"ol", items: [] }
    const flush = () => {
      if (list) {
        out.push(`<${list.tag}><li>${list.items.join("</li><li>")}</li></${list.tag}>`);
        list = null;
      }
    };
    for (const line of String(src).split("\n")) {
      const t = line.trim();
      if (!t) { flush(); continue; }
      const ul = t.match(/^[-*+]\s+(.+)$/);
      const ol = t.match(/^\d+[.)、]\s+(.+)$/);
      if (ul || ol) {
        const tag = ul ? "ul" : "ol";
        if (!list || list.tag !== tag) { flush(); list = { tag, items: [] } }
        list.items.push(inline((ul || ol)[1]));
        continue;
      }
      flush();
      out.push(`<p>${inline(t)}</p>`);
    }
    flush();
    return out.join("");
  };

  /* ================================================================
     SSE 帧切分
     ================================================================ */
  const parseSse = (onFrame) => {
    let buf = "";
    return (chunk) => {
      buf += chunk.replace(/\r\n/g, "\n");
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!raw.trim()) continue;
        let event = "message";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith(":")) continue;             // 注释帧(: ping 心跳)
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
        }
        if (!data) continue;
        try {
          onFrame(event, JSON.parse(data));
        } catch (e) {
          console.warn("aipm-chat: 忽略坏帧", e);
        }
      }
    };
  };

  /* ================================================================
     会话状态与持久化
     ================================================================ */
  const history = [];       // [{role, content}] 内存态,与 localStorage 同步
  let streaming = null;     // { ac: AbortController }
  let turnSeq = 0;          // turn 级令牌:runTurn 捕获自增值;清空/新 turn 使在飞 turn 失效
  let attachments = [];     // [{name, size, type}] 纯 UI 附件

  const persist = () => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX)));
    } catch (e) { /* 隐私模式等场景静默 */ }
  };

  const restore = () => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (const m of arr.slice(-HISTORY_MAX))
        if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          history.push({ role: m.role, content: m.content });
    } catch (e) { /* 坏数据直接忽略 */ }
  };

  /* ================================================================
     渲染(免责条 / 空态 / 气泡 / sources chips / 操作行 / 用量行)
     ================================================================ */
  /* 流式输出只在用户本来就在底部附近时跟随滚动(用户上翻阅读不被打断) */
  let stickBottom = true;
  els.msgs.addEventListener("scroll", () => {
    stickBottom = els.msgs.scrollHeight - els.msgs.scrollTop - els.msgs.clientHeight < 96;
  }, { passive: true });

  const scrollBottom = (force) => {
    if (force || stickBottom) els.msgs.scrollTop = els.msgs.scrollHeight;
  };

  /* 常驻顶部免责条 */
  const addDisclaimer = () => {
    const p = document.createElement("p");
    p.className = "aipm-chat__disclaimer";
    p.textContent = "AI 生成的回答可能包含错误。";
    els.msgs.appendChild(p);
  };

  /* 空态:欢迎语 + 可点的建议问题 */
  const SUGGESTIONS = ["这个网站是做什么的?", "什么是 RAG?", "如何准备产品经理面试?"];

  const ensureEmpty = () => {
    if (els.msgs.querySelector(".aipm-chat__empty")) return;
    const d = document.createElement("div");
    d.className = "aipm-chat__empty";
    d.innerHTML =
      '<div class="aipm-chat__empty-icon">' + SPARK_ICON + "</div>" +
      '<p class="aipm-chat__empty-text">你好,我是 AI-PM 文档助手,<br>可以回答站内文档相关的问题。</p>' +
      '<div class="aipm-chat__suggest">' +
        SUGGESTIONS.map((s) =>
          `<button type="button" class="aipm-chat__suggest-btn">${escapeHtml(s)}</button>`).join("") +
      "</div>";
    for (const btn of d.querySelectorAll(".aipm-chat__suggest-btn"))
      btn.addEventListener("click", () => {
        if (streaming) return;
        postUser(btn.textContent, []);
      });
    els.msgs.appendChild(d);
  };

  const clearEmpty = () => {
    const d = els.msgs.querySelector(".aipm-chat__empty");
    if (d) d.remove();
  };

  const addUserBubble = (text, files) => {
    const wrap = document.createElement("div");
    wrap.className = "aipm-chat__msg aipm-chat__msg--user";
    const bubble = document.createElement("div");
    bubble.className = "aipm-chat__bubble";
    const body = document.createElement("div");
    body.className = "aipm-chat__text";
    body.textContent = text; // 用户输入按纯文本展示(已由 textContent 转义)
    bubble.appendChild(body);
    if (files && files.length) {
      const chips = document.createElement("div");
      chips.className = "aipm-chat__files";
      for (const f of files) {
        const chip = document.createElement("span");
        chip.className = "aipm-chat__file-chip";
        chip.title = f.name + (f.size != null ? " (" + fmtSize(f.size) + ")" : "");
        chip.innerHTML = FILE_ICON + "<span></span>";
        chip.querySelector("span").textContent = f.name;
        chips.appendChild(chip);
      }
      bubble.appendChild(chips);
    }
    wrap.appendChild(bubble);
    els.msgs.appendChild(wrap);
    scrollBottom(true);
    return wrap;
  };

  const addAiBubble = () => {
    const wrap = document.createElement("div");
    wrap.className = "aipm-chat__msg aipm-chat__msg--ai";
    const bubble = document.createElement("div");
    bubble.className = "aipm-chat__bubble";
    const md = document.createElement("div");
    md.className = "aipm-chat__md";
    const sources = document.createElement("div");
    sources.className = "aipm-chat__sources";
    sources.style.display = "none";
    const meta = document.createElement("div");
    meta.className = "aipm-chat__meta";
    bubble.append(md, sources, meta);
    /* 操作行置于气泡下方(常驻,回答完成后显示):复制 / 重新生成 */
    const actions = document.createElement("div");
    actions.className = "aipm-chat__actions";
    actions.hidden = true;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "aipm-chat__act";
    copy.title = "复制";
    copy.setAttribute("aria-label", "复制回答");
    copy.innerHTML = COPY_ICON + CHECK_ICON;
    const regen = document.createElement("button");
    regen.type = "button";
    regen.className = "aipm-chat__act";
    regen.title = "重新生成";
    regen.setAttribute("aria-label", "重新生成回答");
    regen.innerHTML = REGEN_ICON;
    actions.append(copy, regen);
    wrap.append(bubble, actions);
    els.msgs.appendChild(wrap);
    return { wrap, bubble, md, sources, meta, actions, copy, regen };
  };

  const renderSources = (ctx) => {
    ctx.sources.style.display = "none";
    ctx.sources.textContent = "";
    for (const r of ctx.sourceList) {
      const a = document.createElement("a");
      a.className = "aipm-chat__chip";
      a.href = r.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = r.url;
      a.textContent = r.title || r.url;
      ctx.sources.appendChild(a);
    }
    if (ctx.sourceList.length) ctx.sources.style.display = "";
  };

  const fmtUsage = (data) => {
    const parts = [];
    if (data.durationMs != null) parts.push(`耗时 ${(data.durationMs / 1000).toFixed(1)} 秒`);
    const usage = data.usage || {};
    const inTok = usage.input_tokens ?? usage.prompt_tokens;
    const outTok = usage.output_tokens ?? usage.completion_tokens;
    if (inTok != null || outTok != null)
      parts.push(`输入 ${(inTok ?? 0).toLocaleString()} / 输出 ${(outTok ?? 0).toLocaleString()} 词元`);
    if (data.costUsd != null) parts.push(`成本 $${Number(data.costUsd).toFixed(4)}`);
    if (data.numTurns != null) parts.push(`${data.numTurns} 轮`);
    return parts.join(" · ");
  };

  const setThinking = (md) => {
    md.innerHTML = '<span class="aipm-chat__thinking">思考中<span class="aipm-chat__dots"></span></span>';
  };

  /* 错误映射:error 帧 code / HTTP 状态 / 网络异常 */
  const ERROR_TEXT = {
    rate_limited: "请求过于频繁,请稍后再试",
    budget_exceeded: "服务预算已用尽,请明天再试",
    budget_exhausted: "服务预算已用尽,请明天再试",
    max_turns: "本轮对话已到达轮次上限,请清空对话后重试",
    model_error: "模型服务暂时不可用,请稍后重试",
    internal: "服务内部错误,请稍后重试",
    http_400: "请求格式有误,请重试",
    http_403: "无权访问问答服务",
    http_413: "问题内容过长,请精简后重试",
    http_429: "请求过于频繁,请稍后再试",
    http_503: "问答服务暂不可用,请稍后重试",
    network: "无法连接问答服务,请检查网络后重试",
  };
  const httpErrorText = (status, retry) => {
    let t = ERROR_TEXT["http_" + status] || `问答服务响应异常(HTTP ${status})`;
    if (status === 429 && retry) t += `(${retry} 秒后可重试)`;
    return t;
  };

  /* ================================================================
     页面优先态速览条(peek):流式状态 / 最近一句 / 默认引导
     ================================================================ */
  const updatePeek = () => {
    let text;
    if (streaming) {
      text = "正在生成回答…";
    } else {
      const last = history[history.length - 1];
      if (last) {
        const one = last.content.replace(/\s+/g, " ").trim();
        text = (last.role === "user" ? "我:" : "助手:") + (one.length > 42 ? one.slice(0, 42) + "…" : one);
      } else {
        text = "问我站内文档的任何问题";
      }
    }
    els.peekText.textContent = text;
    els.peek.setAttribute("data-streaming", streaming ? "true" : "false");
  };

  /* ================================================================
     埋点(自建 umami,见 _static/js/umami.js)
     只报设备/形态/停靠点/页面路径/耗时/是否错误 —— 不报用户输入与回答正文
     ================================================================ */
  const track = (name, data) => {
    try {
      if (window.umami && typeof window.umami.track === "function")
        window.umami.track(name, data);
    } catch (e) { /* 统计失败不影响使用 */ }
  };
  const env = () => ({ mode: mode, snap: mode === "sheet" ? snap : undefined,
                       page: location.pathname, vw: window.innerWidth });

  /* ================================================================
     形态 / 停靠点状态机(状态写在 <html> 与面板 dataset 上,几何交给 CSS)
     ================================================================ */
  const ORDER = ["peek", "half", "expanded"];

  let mode = "dock";        // dock | overlay | sheet
  let open = false;         // 面板是否打开(与停靠点解耦:关闭不清会话)
  let snap = "peek";        // 抽屉停靠点(仅 sheet 形态有效)
  let drag = null;          // 拖拽会话
  let suppressClick = false;// 拖拽结束后的那次 click 不当成"点击切换停靠点"

  const scrollbarWidth = () => {
    const w = window.innerWidth - document.documentElement.clientWidth;
    return w > 0 ? Math.round(w) : 0;
  };

  /* 三段高度:视口高与可视区高(软键盘弹出时 visualViewport 更小) */
  const metrics = () => {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vv = window.visualViewport;
    const visible = vv ? Math.round(vv.height) : vh;
    return {
      peek: Math.max(SHEET_PEEK_MIN, Math.round(vh * SHEET_PEEK_VH)),
      half: Math.max(SHEET_PEEK_MIN, Math.round(vh * SHEET_HALF_VH)),
      expanded: Math.max(SHEET_PEEK_MIN, visible - SHEET_TOP_GAP),
    };
  };

  const applyMetrics = () => {
    const m = metrics();
    const st = document.documentElement.style;
    st.setProperty("--aipm-chat-sheet-peek", m.peek + "px");
    st.setProperty("--aipm-chat-sheet-half", m.half + "px");
    st.setProperty("--aipm-chat-sheet-expanded", m.expanded + "px");
    st.setProperty("--aipm-chat-sbw", scrollbarWidth() + "px");
  };

  const computeMode = () =>
    MQ_SHEET.matches ? "sheet" : (MQ_DOCK.matches ? "dock" : "overlay");

  /* 遮罩级别:桌面停靠不显示;抽屉 peek 不显示(页面优先);其余全遮罩 */
  const scrimLevel = () => {
    if (!open) return "none";
    if (mode === "dock") return "none";
    if (mode === "sheet") return snap === "peek" ? "none" : (snap === "half" ? "half" : "full");
    return "full";
  };

  /* 背景滚动锁定:桌面停靠不锁(页面与面板各自独立滚动) */
  const locked = () =>
    open && mode !== "dock" && !(mode === "sheet" && snap === "peek");

  const syncRole = () => {
    const modal = open && (mode === "overlay" || (mode === "sheet" && snap !== "peek"));
    panel.setAttribute("role", mode === "dock" ? "complementary" : "dialog");
    if (mode === "dock") panel.removeAttribute("aria-modal");
    else panel.setAttribute("aria-modal", modal ? "true" : "false");
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  };

  const syncChrome = () => {
    const cl = document.documentElement.classList;
    cl.toggle("aipm-chat-open", open);
    cl.toggle("aipm-chat-mode--dock", mode === "dock");
    cl.toggle("aipm-chat-mode--overlay", mode === "overlay");
    cl.toggle("aipm-chat-mode--sheet", mode === "sheet");
    cl.toggle("aipm-chat-locked", locked());
    els.scrim.setAttribute("data-level", scrimLevel());
    fab.classList.toggle("is-hidden", open);
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    syncRole();
  };

  /* 切停靠点:清掉拖拽期间写的 inline 高度,让 CSS 的三段高度接管并吸附 */
  const setSnap = (next) => {
    if (ORDER.indexOf(next) === -1) return;
    snap = next;
    panel.setAttribute("data-snap", next);
    void panel.offsetHeight;              // 先落一帧,保证 inline 高度到目标高度的过渡可见
    panel.style.height = "";
    syncChrome();
    updatePeek();
    track("assistant_panel_mode_change", env());
  };

  const stepSnap = (from, dir) => {
    const i = ORDER.indexOf(from);
    return ORDER[Math.min(Math.max(i + dir, 0), ORDER.length - 1)];
  };

  /* 视口变化:重算形态与三段高度;跨断点时保持打开状态(会话不清空) */
  const applyMode = () => {
    const next = computeMode();
    const changed = next !== mode;
    mode = next;
    if (changed && open && mode === "sheet") snap = "peek";   // 进入抽屉默认页面优先
    if (mode === "sheet") panel.setAttribute("data-snap", snap);
    else panel.removeAttribute("data-snap");
    applyMetrics();
    syncChrome();
    updatePeek();
  };

  /* ================================================================
     系统返回键(移动抽屉 / 平板浮层):返回键逐级回退停靠点,peek 时关闭
     ================================================================ */
  let histOwned = false;      // 自家是否占着一条历史记录
  let openedAt = "";          // 打开时的 location(用于判断返回是否落在本页)

  const here = () => location.pathname + location.search + location.hash;

  const pushHistory = () => {
    if (histOwned) return;
    try {
      window.history.pushState({ aipmChat: 1 }, "", location.href);
      histOwned = true;
    } catch (e) { /* 隐私模式等场景静默 */ }
  };

  /* 从 UI 关闭(按钮 / 遮罩 / 手势)时退回自家那条记录。
     仅在自家记录仍是栈顶(未被 instant 导航压在下面)时退回,
     否则会把用户点开的文档页一起退掉 */
  const releaseHistory = () => {
    if (!histOwned) return;
    histOwned = false;
    try {
      if (window.history.state && window.history.state.aipmChat) window.history.back();
    } catch (e) { /* 静默 */ }
  };

  window.addEventListener("popstate", () => {
    if (!open) { histOwned = false; return; }        // releaseHistory() 触发的那次
    if (mode === "dock") return;                      // 桌面停靠不参与系统返回
    if (here() !== openedAt) return;                  // 返回落在别的页面:交给 instant 导航
    /* 这一步已经消费掉自家那条记录,回退后补一条新的,保证"每按一次返回退一级" */
    if (mode === "sheet" && snap === "expanded") { histOwned = false; setSnap("half"); pushHistory(); return; }
    if (mode === "sheet" && snap === "half") { histOwned = false; setSnap("peek"); pushHistory(); return; }
    histOwned = false;                                // peek / 浮层:直接关闭,不再占记录
    closePanel("back");
  });

  /* ================================================================
     打开 / 关闭
     ================================================================ */
  let openedAtMs = 0;

  const openPanel = () => {
    if (open) return;
    open = true;
    openedAt = here();
    openedAtMs = Date.now();
    if (mode === "sheet") snap = "peek";              // 首次打开默认页面优先态
    applyMetrics();
    syncChrome();
    if (mode === "sheet") {
      setSnap(snap);
      pushHistory();
      panel.focus({ preventScroll: true });           // 抽屉不自动弹键盘,焦点给面板
    } else {
      scrollBottom(true);
      els.input.focus();
    }
    track("assistant_panel_open", env());
  };

  const closePanel = (via) => {
    if (!open) return;
    open = false;
    panel.style.height = "";
    syncChrome();
    releaseHistory();
    els.fab.focus();
    track("assistant_panel_close", Object.assign(env(), {
      via: via || "button",
      openMs: openedAtMs ? Date.now() - openedAtMs : undefined,
    }));
  };

  /* ================================================================
     抽屉拖拽(pointer events:触摸 / 鼠标 / 触控笔通吃)
     ================================================================ */
  const snapHeights = () => metrics();

  const velocity = (samples) => {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    const recent = samples.filter((s) => last.t - s.t <= 120);
    const a = recent[0] || samples[0];
    const dt = last.t - a.t;
    if (dt <= 0) return 0;
    return (a.y - last.y) / dt;                       // 上滑(指针 y 变小)为正
  };

  const nearestSnap = (h) => {
    const s = snapHeights();
    let best = "peek";
    let bd = Infinity;
    for (const k of ORDER) {
      const d = Math.abs(s[k] - h);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };

  /* 可拖拽区域:手柄任意位置 + 头部空白(避开头部按钮) */
  const inDragZone = (t) => {
    if (!t || !t.closest) return false;
    if (t.closest(".aipm-chat__grip")) return true;
    return !!t.closest(".aipm-chat__head") && !t.closest("button");
  };

  const onDragDown = (e) => {
    if (mode !== "sheet" || !open || drag) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!inDragZone(e.target)) return;
    drag = {
      id: e.pointerId,
      y0: e.clientY,
      h0: panel.getBoundingClientRect().height,
      from: snap,
      moved: false,
      samples: [{ y: e.clientY, t: e.timeStamp }],
    };
  };

  const onDragMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y0 - e.clientY;                   // 上滑为正
    if (!drag.moved) {
      if (Math.abs(dy) < 4) return;
      drag.moved = true;
      panel.classList.add("is-dragging");
      try { panel.setPointerCapture(e.pointerId); } catch (err) { /* 静默 */ }
    }
    e.preventDefault();
    const s = snapHeights();
    const h = Math.min(Math.max(drag.h0 + dy, SHEET_MIN_H), s.expanded);
    panel.style.height = h + "px";
    drag.samples.push({ y: e.clientY, t: e.timeStamp });
    if (drag.samples.length > 8) drag.samples.shift();
  };

  const onDragUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try { panel.releasePointerCapture(e.pointerId); } catch (err) { /* 静默 */ }
    if (!d.moved) return;                             // 未移动 = 点击,交给 click 分支
    panel.classList.remove("is-dragging");
    suppressClick = true;                             // 拖完松手别触发"点击切换停靠点"
    setTimeout(() => { suppressClick = false; }, 350);
    const h = panel.getBoundingClientRect().height;
    const s = snapHeights();
    const v = velocity(d.samples);
    /* 第一段继续下拉(或快速下滑)超过关闭阈值 → 关闭 */
    if (d.from === "peek" && (v < -SWIPE_V || h < s.peek * CLOSE_RATIO)) { closePanel(); return; }
    const next = Math.abs(v) > SWIPE_V ? stepSnap(d.from, v > 0 ? 1 : -1) : nearestSnap(h);
    setSnap(next);
  };

  panel.addEventListener("pointerdown", onDragDown);
  panel.addEventListener("pointermove", onDragMove, { passive: false });
  panel.addEventListener("pointerup", onDragUp);
  panel.addEventListener("pointercancel", onDragUp);

  /* 点手柄 / 点头部空白 / 点速览条 = 切到下一个停靠点(第三段回退到第二段) */
  panel.addEventListener("click", (e) => {
    if (mode !== "sheet" || !open || suppressClick) return;
    const btn = e.target.closest("button");
    const isGrip = !!e.target.closest(".aipm-chat__grip");
    const isPeek = !!e.target.closest(".aipm-chat__peek");
    const isHeadGap = !!e.target.closest(".aipm-chat__head") && !btn;
    if (!isGrip && !isPeek && !isHeadGap) return;
    setSnap(snap === "expanded" ? "half" : stepSnap(snap, 1));
  });

  /* ================================================================
     复制 / 重新生成(气泡下方常驻操作行)
     ================================================================ */
  const copyText = async (s) => {
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch (e) {
      /* 旧环境降级:临时 textarea + execCommand */
      try {
        const ta = document.createElement("textarea");
        ta.value = s;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  };

  const showActions = (t, rawText) => {
    t.actions.hidden = false;
    t.copy.onclick = async () => {
      const ok = await copyText(rawText || "");
      t.copy.classList.add("is-copied");
      t.copy.title = ok ? "已复制" : "复制失败";
      setTimeout(() => {
        t.copy.classList.remove("is-copied");
        t.copy.title = "复制";
      }, 1600);
    };
    t.regen.onclick = () => regenerate(t.wrap);
  };

  /* 重新生成:截断该回答之后的历史,重发其上方那条用户消息 */
  const regenerate = (aiWrap) => {
    if (streaming) return;
    let prev = aiWrap.previousElementSibling;
    while (prev && !prev.classList.contains("aipm-chat__msg--user"))
      prev = prev.previousElementSibling;
    const idx = prev && prev.getAttribute("data-hidx");
    const content = idx != null && history[+idx] ? history[+idx].content : null;
    if (content == null) return;
    history.length = +idx + 1;
    persist();
    let n = prev.nextElementSibling;
    while (n) {
      const nx = n.nextElementSibling;
      n.remove();
      n = nx;
    }
    runTurn(content);
  };

  /* ================================================================
     发送与流式接收
     ================================================================ */
  /* 发送按钮可用性:非流式且无文本且无附件时禁用 */
  const updateSendState = () => {
    els.send.disabled = !streaming && !els.input.value.trim() && !attachments.length;
  };

  const setStreamingUI = (on) => {
    streaming = on ? { ac: new AbortController() } : null;
    els.send.classList.toggle("is-stop", !!on);
    els.send.title = on ? "停止生成" : "发送";
    els.send.setAttribute("aria-label", on ? "停止生成" : "发送");
    els.send.innerHTML = on ? STOP_ICON : SEND_ICON;
    els.send.disabled = false;
    updatePeek();
  };

  /* 一轮问答:用户消息已入 history(由 postUser / regenerate 负责),
     这里只负责 AI 气泡与流式接收 */
  const runTurn = async (message) => {
    const myTurn = ++turnSeq;             // 捕获本 turn 令牌:清空/新 turn 后本 turn 失效
    const ctx = { acc: "", sourceList: [], sourceSeen: new Set(), requestId: null };
    const t = addAiBubble();
    let finished = false;                 // 收尾只执行一次(done/error/流自然结束)
    setThinking(t.md);
    setStreamingUI(true);
    clearEmpty();
    track("assistant_message_send", env());
    stickBottom = true;
    scrollBottom(true);

    const body = {
      message,
      history: history.slice(0, -1).slice(-HISTORY_SEND), // 最近轮次(不含本条)
    };

    /* 收尾统一出口:失效 turn(清空/新 turn 后)不再写 history/DOM,
       避免"只有回答、没有对应问题"的孤儿历史;但流式状态必须复位,
       否则清空后发送按钮仍卡在"停止生成" */
    const finish = (assistantText) => {
      if (finished) return;
      finished = true;
      const stale = myTurn !== turnSeq;
      if (!stale && assistantText) {
        history.push({ role: "assistant", content: assistantText });
        t.wrap.setAttribute("data-hidx", history.length - 1);
        persist();
      }
      setStreamingUI(false);
      updateSendState();
      if (!stale) showActions(t, assistantText || ctx.acc || "");
      if (!stale)
        track("assistant_message_stream_end", Object.assign(env(), {
          ok: !!assistantText,
          chars: (assistantText || ctx.acc || "").length,
          sources: ctx.sourceList.length,
        }));
    };

    try {
      const res = await fetch(API_BASE + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: streaming.ac.signal,
      });
      const ctype = res.headers.get("content-type") || "";
      if (!res.ok || ctype.indexOf("text/event-stream") === -1) {
        // 预校验失败:纯 JSON 响应(400/403/413/429/503)
        let code = "";
        try { const j = await res.json(); code = j.code || ""; } catch (e) { /* 非 JSON 也兜住 */ }
        const msg = code && ERROR_TEXT[code]
          ? ERROR_TEXT[code] + (code === "rate_limited" && res.headers.get("Retry-After")
              ? `(${res.headers.get("Retry-After")} 秒后可重试)`
              : "")
          : httpErrorText(res.status, res.headers.get("Retry-After"));
        t.bubble.classList.add("is-error");
        t.md.innerHTML = escapeHtml(msg);
        track("assistant_panel_error", Object.assign(env(), { status: res.status, code: code || undefined }));
        finish(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const feed = parseSse((event, data) => {
        switch (event) {
          case "ready":
            ctx.requestId = data.requestId || null;
            break;
          case "sources":
            for (const r of (data.results || [])) {
              if (r && r.url && !ctx.sourceSeen.has(r.url)) {
                ctx.sourceSeen.add(r.url);
                ctx.sourceList.push({ title: r.title || r.url, url: r.url });
              }
            }
            renderSources(ctx);
            break;
          case "delta":
            if (data.text) {
              ctx.acc += data.text;
              t.md.innerHTML = mdLite(ctx.acc);
              scrollBottom(false);
            }
            break;
          case "done":
            t.md.innerHTML = ctx.acc ? mdLite(ctx.acc) : "";
            if (data.usage || data.costUsd != null || data.durationMs != null || data.numTurns != null)
              t.meta.textContent = fmtUsage(data);
            finish(ctx.acc);
            break;
          case "error":
            track("assistant_panel_error", Object.assign(env(), { code: data.code }));
            t.bubble.classList.add("is-error");
            t.md.innerHTML =
              (ctx.acc ? mdLite(ctx.acc) : "") +
              (ERROR_TEXT[data.code] ? `<p>${escapeHtml(ERROR_TEXT[data.code])}</p>` : "");
            finish(null);
            break;
        }
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        feed(decoder.decode(value, { stream: true }));
      }
      feed(decoder.decode());
      /* 流自然结束但未收到 done/error 帧:补收尾,否则 streaming 永不复位,
         发送按钮永远停在"停止生成";finished 标志保证 done 后的正常收尾
         不重复执行 */
      if (!finished) {
        t.md.innerHTML = ctx.acc ? mdLite(ctx.acc) : "";
        finish(ctx.acc);
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        t.bubble.classList.add("is-error");
        t.md.innerHTML = (ctx.acc ? mdLite(ctx.acc) : "") + "<p>已中断</p>";
      } else {
        t.bubble.classList.add("is-error");
        t.md.innerHTML = (ctx.acc ? mdLite(ctx.acc) : "") +
          `<p>${escapeHtml(ERROR_TEXT.network)}</p>`;
      }
      finish(null);
    }
  };

  /* 用户消息入 history + 渲染气泡(附件以 [附件] 文本附注进消息体) */
  const postUser = (text, files) => {
    let sent = text;
    if (files && files.length) {
      const note = files.map((f) => `${f.name}(${f.size != null ? fmtSize(f.size) : "?"})`).join(", ");
      sent = text ? `${text}\n\n[附件] ${note}` : `[附件] ${note}`;
    }
    history.push({ role: "user", content: sent });
    const wrap = addUserBubble(text, files);
    wrap.setAttribute("data-hidx", history.length - 1);
    persist();
    updatePeek();
    runTurn(sent);
  };

  const submit = () => {
    if (streaming) return;
    const text = els.input.value.trim();
    if (!text && !attachments.length) return;
    els.input.value = "";
    autosize();
    const files = attachments.slice();
    attachments = [];
    renderAttach();
    postUser(text, files);
  };

  /* ================================================================
     附件(纯 UI:文件选择 / 拖拽 / chips,发送时并入消息文本)
     ================================================================ */
  const fmtSize = (n) => {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  };

  const addFiles = (list) => {
    for (const f of list || []) {
      if (!f || !f.name) continue;
      if (attachments.some((a) => a.name === f.name && a.size === f.size)) continue;
      if (attachments.length >= ATTACH_MAX) break;
      attachments.push({ name: f.name, size: f.size, type: f.type || "" });
    }
    renderAttach();
  };

  const renderAttach = () => {
    els.attachbar.textContent = "";
    for (const a of attachments) {
      const chip = document.createElement("span");
      chip.className = "aipm-chat__attach-chip";
      chip.title = a.name + " (" + fmtSize(a.size) + ")";
      chip.innerHTML = FILE_ICON + '<span class="aipm-chat__attach-name"></span>';
      chip.querySelector(".aipm-chat__attach-name").textContent = a.name;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "aipm-chat__attach-x";
      rm.title = "移除附件";
      rm.setAttribute("aria-label", "移除附件 " + a.name);
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        attachments = attachments.filter((x) => x !== a);
        renderAttach();
      });
      chip.appendChild(rm);
      els.attachbar.appendChild(chip);
    }
    els.attachbar.hidden = attachments.length === 0;
    els.attach.classList.toggle("is-active", attachments.length > 0);
    updateSendState();
  };

  els.attach.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", () => {
    addFiles(els.file.files);
    els.file.value = "";
  });
  els.composer.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.composer.classList.add("is-dragover");
  });
  els.composer.addEventListener("dragleave", () => {
    els.composer.classList.remove("is-dragover");
  });
  els.composer.addEventListener("drop", (e) => {
    e.preventDefault();
    els.composer.classList.remove("is-dragover");
    addFiles(e.dataTransfer && e.dataTransfer.files);
  });

  /* ================================================================
     视口 / 软键盘
     ================================================================ */
  let kbOpen = false;
  let kbSnap = null;

  /* 软键盘:抽屉形态下按可视区高度收窄面板,至少升到近全屏保证输入框可见;
     键盘收起后回到弹出前的停靠点(期间用户主动切过则以用户为准) */
  const syncKeyboard = () => {
    const vv = window.visualViewport;
    if (!vv || mode !== "sheet") {
      kbOpen = false;
      kbSnap = null;
      panel.style.bottom = "";        // 非抽屉形态/无键盘:高度锚点交回 CSS
      return;
    }
    /* iOS 键盘不改变布局视口(innerHeight 不变),面板贴布局视口底部会被键盘盖住 ——
       键盘抬起时把底边抬到可视区底部(keyboard 高度),高度再按可视区算 */
    const covered = Math.round((window.innerHeight || 0) - vv.height - vv.offsetTop);
    const isOpen = covered > 120;
    panel.style.bottom = isOpen ? covered + "px" : "";
    applyMetrics();
    if (isOpen === kbOpen) return;
    kbOpen = isOpen;
    if (isOpen) {
      kbSnap = snap;
      track("assistant_keyboard_open", env());
      if (snap !== "expanded") setSnap("expanded");
    } else {
      const back = kbSnap;
      kbSnap = null;
      if (back && back !== snap && open) setSnap(back);
    }
  };

  const onViewportChange = () => {
    applyMode();
    syncKeyboard();
  };
  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("orientationchange", onViewportChange, { passive: true });
  MQ_DOCK.addEventListener("change", onViewportChange);
  MQ_SHEET.addEventListener("change", onViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncKeyboard, { passive: true });
  }

  /* ================================================================
     交互(打开 / 关闭 / Escape / 焦点环)
     ================================================================ */
  els.fab.addEventListener("click", openPanel);
  els.close.addEventListener("click", closePanel);
  els.scrim.addEventListener("click", () => {
    track("assistant_drawer_backdrop_close", env());
    closePanel("backdrop");
  });

  els.clear.addEventListener("click", () => {
    if (streaming) streaming.ac.abort();          // 中止在飞请求:其 finish() 随即复位流式状态,清空后立即可用
    turnSeq++;                            // 在飞 turn 失效:其 finish()/写回成为 no-op
    history.length = 0;
    persist();
    els.msgs.textContent = "";
    addDisclaimer();
    ensureEmpty();
    updatePeek();
  });

  els.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    if (streaming) streaming.ac.abort(); // 发送中按钮 = 停止
    else submit();
  });

  /* 输入框自适应高度(高度上限交给 CSS max-height,超出内部滚动) */
  const autosize = () => {
    els.input.style.height = "auto";
    els.input.style.height = els.input.scrollHeight + "px";
  };
  els.input.addEventListener("input", () => {
    autosize();
    updateSendState();
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); // 原生 textarea 对 Material 快捷键豁免,无冲突
      submit();
    }
  });

  document.addEventListener("keydown", (e) => {
    /* Escape 关闭面板(仅面板开时;IME 组字中的 Escape 交给输入法) */
    if (e.key === "Escape" && !e.isComposing && open) {
      closePanel();
      return;
    }
    /* 遮罩态焦点不逸出面板(浮层 / 抽屉半开、近全屏) */
    if (e.key !== "Tab" || !locked()) return;
    const items = panel.querySelectorAll(
      'button:not([disabled]), textarea, input:not([type="hidden"]), a[href], [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ================================================================
     启动:恢复历史、渲染、初始形态
     ================================================================ */
  addDisclaimer();
  restore();
  if (history.length) {
    history.forEach((m, i) => {
      if (m.role === "user") {
        // 附件形态不持久化:恢复时按存入 history 的完整文本展示
        const wrap = addUserBubble(m.content, []);
        wrap.setAttribute("data-hidx", i);
      } else {
        const t = addAiBubble();
        t.md.innerHTML = mdLite(m.content);
        t.wrap.setAttribute("data-hidx", i);
        showActions(t, m.content);
      }
    });
  } else {
    ensureEmpty();
  }
  updateSendState();
  applyMode();
})();
