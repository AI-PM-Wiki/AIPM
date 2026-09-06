/*
  AI-PM 文档问答 Agent 悬浮助手(chat-widget.js,2026-08-24)

  形态:右下角扁平胶囊按钮(图标 + 「询问助手」引导语);点开后,桌面端
  (≥1220px)对话面板立即弹出(无滑入动画):左缘对齐三列网格右栏(TOC 栏)
  左缘——不切入正文列,右缘贯通视口,顶边贴吸顶导航栏 md-header/md-tabs
  下缘(不盖住导航),底边停在 mkdocs 页脚(md-footer)上缘(不遮挡页脚;
  头部 ↗ 可切加宽模式,允许压过正文);移动端降级为全屏覆盖。零依赖原生 JS。

  工程契约:
  - FAB append 到 document.body 顶层,不带 data-md-component 属性,instant
    换页不触碰;面板插在页头交界线之后(与线同族参与 sticky 布局),而
    instant 导航换页整体替换 [data-md-component=container] 时面板会随旧
    容器被摘除 —— body 级 MutationObserver 在下一帧按同一规则挂回新
    容器,对话状态(消息、滚动、流式)原样存活,不随文档跳转消失
  - 打开时隐藏右侧 TOC(md-sidebar--secondary 内层 nav);面板顶边锚定
    页头交界发丝线(.md-header__line,粘性,与吸顶页头同进退),底边停在
    mkdocs 页脚上缘;面板打开期间用 rAF 逐帧对齐 —— 弹性过滚动(滚到
    顶/底继续拖拽)时浏览器抑制滚动事件,面板靠逐帧同步不脱节
  - MutationObserver 盯 body 子树:instant 导航换页后新页 TOC 随 container
    重建出现,观察器重新应用隐藏;关闭时还原
  - 与后端契约:POST {message, history} → text/event-stream,帧事件
    ready / sources / delta / done / error;预校验失败返回纯 JSON(400/403/
    413/429/503),映射中文提示(429 附 Retry-After 重试时间)
  - 消息操作:每条 AI 回答气泡下方提供常驻「复制」「重新生成」(不随
    hover 显隐);重新生成截断该轮之后的历史并重发其上方那条用户消息
    (纯前端,复用现有接口)
  - 附件:输入卡片内回形针按钮选择文件(也可拖拽进卡片),发送时以
    [附件] 名称(大小) 文本附注进消息体(纯 UI 演示,后端无需改动)
  - 预览站自禁用:location.hostname 以 netlify.app 结尾时不挂载,仅显示
    「预览站不加载问答助手」一行提示
  - 视觉:扁平实色,颜色全走 Material --md-* 变量(亮/暗自动);
    prefers-reduced-motion 禁位移动画
  - 键盘:Enter 发送、Shift+Enter 换行(原生 textarea,对 Material 快捷键
    豁免);Escape 关闭面板(仅面板开时);IME 组字中的 Enter/Escape 不触发
  - localStorage 存最近会话(≤20 条)+「清空对话」+ 加宽模式;服务端无状态
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
  const WIDE_KEY = "aipm-chat-wide";
  const HISTORY_MAX = 20;              // localStorage 条数上限
  const HISTORY_SEND = 8;              // 每次请求携带的最近历史条数
  const ATTACH_MAX = 4;                // 附件个数上限(纯 UI)
  // 主题右侧栏断点(76.25em = 1220px):≥此宽度为桌面侧栏形态,以下全屏覆盖
  const MQ_DESKTOP = window.matchMedia("(min-width: 76.25em)");

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
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65,6.35C16.2,4.9 14.21,4 12,4c-4.42,0 -7.99,3.58 -7.99,8s3.57,8 7.99,8c3.73,0 6.84,-2.55 7.73,-6h-2.08c-0.82,2.33 -3.04,4 -5.65,4 -3.31,0 -6,-2.69 -6,-6s2.69,-6 6,-6c1.66,0 3.14,0.69 4.22,1.78L13,11h7V4l-2.35,2.35z"/></svg>';
  const CLIP_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5,6v11.5c0,2.21 -1.79,4 -4,4s-4,-1.79 -4,-4V5c0,-1.38 1.12,-2.5 2.5,-2.5s2.5,1.12 2.5,2.5v10.5c0,0.55 -0.45,1 -1,1s-1,-0.45 -1,-1V6H10v9.5c0,1.38 1.12,2.5 2.5,2.5s2.5,-1.12 2.5,-2.5V5c0,-2.21 -1.79,-4 -4,-4S7,2.79 7,5v12.5c0,3.04 2.46,5.5 5.5,5.5s5.5,-2.46 5.5,-5.5V6h-1.5z"/></svg>';
  const FILE_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14,2H6C4.9,2 4,2.9 4,4v16c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V8L14,2zM16,18H8v-2h8v2zM16,14H8v-2h8v2zM13,9V3.5L18.5,9H13z"/></svg>';
  const TRASH_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6,19c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V7H6v12zM19,4h-3.5l-1,-1h-5l-1,1H5v2h14V4z"/></svg>';
  const EXPAND_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21,11V3h-8l3.29,3.29L6.41,16.17 3,13v8h8l-3.29,-3.29L17.59,7.71 21,11z"/></svg>';

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "aipm-chat__fab";
  fab.title = "打开问答助手";
  fab.innerHTML = SPARK_ICON + '<span class="aipm-chat__fab-label">询问助手</span>';
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.className = "aipm-chat";
  panel.id = "aipm-chat";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI-PM 文档问答助手");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML =
    '<header class="aipm-chat__head">' +
      '<span class="aipm-chat__head-icon">' + SPARK_ICON + "</span>" +
      '<span class="aipm-chat__title">助手</span>' +
      '<button type="button" class="aipm-chat__iconbtn aipm-chat__clear" title="清空对话" aria-label="清空对话">' +
        TRASH_ICON +
      "</button>" +
      '<button type="button" class="aipm-chat__iconbtn aipm-chat__expand" title="加宽面板" aria-label="加宽面板">' +
        EXPAND_ICON +
      "</button>" +
      '<button type="button" class="aipm-chat__iconbtn aipm-chat__close" title="关闭(Esc)" aria-label="关闭">' +
        CLOSE_ICON +
      "</button>" +
    "</header>" +
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
  /* 挂载点:插到页头交界线之后(文档流内,与线一同参与 sticky 布局 ——
     结构上不可能与页头/线脱节);线缺失时按 tabs → header → body 回退。
     instant 换页整体替换 [data-md-component=container],面板随旧容器被
     摘除,sync() 观察器发现面板脱离文档时按同一规则挂回新容器 */
  const mount = () => {
    if (panel.isConnected) return;
    const anchor = document.querySelector(".md-header__line")
      || document.querySelector(".md-tabs")
      || document.querySelector(".md-header");
    if (anchor) anchor.after(panel);
    else document.body.appendChild(panel);
  };
  mount();

  els.fab = fab;
  els.panel = panel;
  els.msgs = panel.querySelector(".aipm-chat__msgs");
  els.composer = panel.querySelector(".aipm-chat__composer");
  els.attachbar = panel.querySelector(".aipm-chat__attachbar");
  els.input = panel.querySelector(".aipm-chat__input");
  els.send = panel.querySelector(".aipm-chat__send");
  els.clear = panel.querySelector(".aipm-chat__clear");
  els.expand = panel.querySelector(".aipm-chat__expand");
  els.close = panel.querySelector(".aipm-chat__close");
  els.attach = panel.querySelector(".aipm-chat__attach");
  els.file = panel.querySelector(".aipm-chat__file");

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
     形态与 TOC 隐藏(instant 导航换页存活的关键)
     ================================================================ */
  const tocNav = () => document.querySelector(".md-sidebar--secondary .md-nav--secondary");

  /* 面板打开时隐藏右侧 TOC;关闭时还原(空字符串回到样式表默认值) */
  const applyTocHide = (hide) => {
    const nav = tocNav();
    if (nav) nav.style.display = hide ? "none" : "";
  };

  /* 面板顶边归属:面板自身是文档流内 position:sticky(与页头/交界线
     同族),top: calc(2.4rem + 1px) 由 CSS 给出 —— 弹性过滚动/任何滚动
     状态下与页头、线物理同步,不存在测量脱节。这里只负责:
     - 高度 H = 页脚上缘 - 线底缘(不遮挡 footer)
     - 负 margin-bottom 抵消占高(面板不撑长文档)
     - 水平几何:左缘对齐 TOC 栏左缘(不切入正文列),加宽/无 TOC 贴右缘 */
  const footerTop = () => {
    const f = document.querySelector(".md-footer");
    if (!f) return document.documentElement.clientHeight;
    const r = f.getBoundingClientRect();
    if (r.width <= 0) return document.documentElement.clientHeight;
    return Math.min(r.top, document.documentElement.clientHeight);
  };

  const tocCol = () => document.querySelector(".md-sidebar--secondary");

  const align = () => {
    const desktop = MQ_DESKTOP.matches;
    panel.classList.toggle("aipm-chat--docked", desktop);
    if (!desktop) {
      panel.style.marginLeft = panel.style.width = "";
      panel.style.height = panel.style.marginBottom = "";
      return;
    }
    const line = document.querySelector(".md-header__line");
    const top = line ? line.getBoundingClientRect().bottom
                     : document.documentElement.clientHeight; // 无交界线时兜底视口底
    const h = Math.max(footerTop() - top, 240);
    panel.style.height = h + "px";
    panel.style.marginBottom = -h + "px";
    if (wide) {
      /* 加宽模式:宽度交给 CSS(min(46rem, 94vw)),允许压过正文列 */
      panel.style.marginLeft = "auto";
      panel.style.width = "";
      return;
    }
    const col = tocCol();
    const colRect = col && col.getBoundingClientRect();
    if (colRect && colRect.width > 0) {
      panel.style.marginLeft = colRect.left + "px";
      panel.style.width =
        Math.max(document.documentElement.clientWidth - colRect.left, 240) + "px";
    } else {
      /* 本页无右侧栏(无 TOC):回落为 CSS 固定宽贴右缘 */
      panel.style.marginLeft = "auto";
      panel.style.width = "";
    }
  };

  /* 面板打开期间逐帧修正高度/水平几何(顶部几何为 sticky 布局自带,
     无需测量):弹性过滚动(滚到顶/底继续拖拽)时浏览器抑制滚动事件,
     逐帧循环保证高度/边距与页脚、TOC 栏实时一致。
     alignOn 标志防重复启动:sync 在每次结构变化(含流式输出逐块重写
     消息区)时都会触发,没有标志会叠出多条并行的逐帧循环 */
  let alignOn = false;
  const alignLoop = () => {
    if (!alignOn) return;
    align();
    requestAnimationFrame(alignLoop);
  };

  let rafId = 0;
  /* 结构变化时统一同步:先把面板挂回文档(instant 换页后旧容器被整体
     替换,面板随之被摘除,需按 mount 规则重挂到新容器)—— 再重新隐藏
     新页 TOC(新页 TOC 随 container 重建出现)+ 启动/恢复逐帧对齐循环 */
  const sync = () => {
    mount();
    if (!panel.classList.contains("is-open")) return;
    applyTocHide(true);
    if (!alignOn) {
      alignOn = true;
      requestAnimationFrame(alignLoop);
    }
  };
  const scheduleSync = () => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(sync);
  };

  new MutationObserver(scheduleSync).observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("resize", scheduleSync, { passive: true });
  window.addEventListener("orientationchange", scheduleSync, { passive: true });

  /* ================================================================
     加宽模式(↗ 按钮切换,localStorage 记忆)
     ================================================================ */
  let wide = false;
  try { wide = localStorage.getItem(WIDE_KEY) === "1"; } catch (e) { /* 静默 */ }
  const applyWide = () => {
    panel.classList.toggle("aipm-chat--wide", wide);
    els.expand.title = wide ? "恢复默认宽度" : "加宽面板";
    els.expand.setAttribute("aria-label", wide ? "恢复默认宽度" : "加宽面板");
  };
  els.expand.addEventListener("click", () => {
    wide = !wide;
    try { localStorage.setItem(WIDE_KEY, wide ? "1" : "0"); } catch (e) { /* 静默 */ }
    applyWide();
    align();   // 加宽/恢复后重算左缘与宽度
  });
  applyWide();

  /* ================================================================
     交互
     ================================================================ */
  const open = () => {
    if (panel.classList.contains("is-open")) return;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    els.fab.classList.add("is-hidden");
    applyTocHide(true);
    if (!alignOn) {
      alignOn = true;
      requestAnimationFrame(alignLoop);   // 启动逐帧对齐(关闭时自停)
    }
    scrollBottom(true);
    els.input.focus();
  };

  const close = () => {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    els.fab.classList.remove("is-hidden");
    applyTocHide(false);
    alignOn = false;                      // 停掉逐帧对齐循环
    els.fab.focus();
  };

  els.fab.addEventListener("click", open);
  els.close.addEventListener("click", close);

  els.clear.addEventListener("click", () => {
    if (streaming) streaming.ac.abort();          // 中止在飞请求:其 finish() 随即复位流式状态,清空后立即可用
    turnSeq++;                            // 在飞 turn 失效:其 finish()/写回成为 no-op
    history.length = 0;
    persist();
    els.msgs.textContent = "";
    addDisclaimer();
    ensureEmpty();
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

  /* Escape 关闭面板(仅面板开时;IME 组字中的 Escape 交给输入法) */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.isComposing && panel.classList.contains("is-open")) {
      close();
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
  align();
})();
