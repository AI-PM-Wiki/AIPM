/*
  AI-PM 批注面板(annotation.js,2026-09-20)

  取代原来嵌入的 hypothes.is 客户端:选中正文 → 高亮 + 写批注 + 回复/编辑/删除,
  高亮多色,并可选调用智能高亮让模型建议「哪里该高亮、用什么颜色」。

  形态与 AI 助手面板(chat-widget.js)共用一套语言:
  - 同一块屏幕区域(桌面右侧停靠 / 平板浮层 / 移动三段抽屉),改用共享件
    panel-shared.js 的拖拽与吸附,阈值与助手一致;
  - 两者**互斥**:同一时刻最多一个,靠 window.__aipmPanels 注册表串起来 ——
    批注面板开着时点 FAB「询问助手」→ claim("chat") 先关批注再开助手;
    助手开着时点页头批注按钮 → claim("annotation")。关与开在同一个同步任务里,
    浏览器只画一帧,桌面停靠下页面宽度不跳。

  工程契约:
  - 面板、遮罩、选中工具条都 append 到 document.body 顶层(与 .aipm-chat 同理:
    instant 导航换页整体替换内容容器,挂在容器内会被连根拔掉);
  - 高亮 <mark> 在正文里(必须跟着内容走),所以换页后由 document$ 重新应用
    —— 不写 MutationObserver 重建逻辑;
  - 锚定按 W3C Web Annotation 存三类 selector(TextQuote / TextPosition / Range),
    三级回退;全失败进「未能定位」分组,绝不静默丢;
  - 未登录能做的:读公开批注、写「仅本机」批注、用智能高亮。
*/
(function () {
  "use strict";

  var store = window.__aipmAnnoStore;
  var auth = window.__aipmAnnoAuth;
  var panels = window.__aipmPanels;

  /* 预览站(Netlify)不挂载:后端在线上,预览站打过去会 403 且没有意义 */
  if (/\.netlify\.app$/i.test(location.hostname)) return;

  /* ================================================================
     常量
     ================================================================ */
  var MQ_DOCK = window.matchMedia("(min-width: 75em)");
  var MQ_SHEET = window.matchMedia("(max-width: 47.9875em)");
  var SHEET_HALF_VH = 0.55;
  var SHEET_PEEK_MIN = 148;
  var SHEET_PEEK_MAX_VH = 0.5;
  var SHEET_TOP_GAP = 16;
  var SNAP_MS = 240;
  var SWIPE_V = 0.45;
  var CLOSE_RATIO = 0.6;
  var SHEET_MIN_H = 56;
  /** 服务端每请求块数上限(HIGHLIGHT_MAX_BLOCKS 默认值);超出部分不下发。 */
  var MAX_BLOCKS = 120;
  /** 单块送去判分的字符上限:过长会把预算花在一条上,截断即可(锚定仍用整块)。 */
  var MAX_BLOCK_CHARS = 1000;
  var BLOCK_SELECTOR = "p, li, h2, h3, h4, h5, blockquote, td, th, dd, dt";
  var ORPHAN_GROUP = "orphan";

  var ICON = {
    pen:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3,17.25V21h3.75L17.81,9.94l-3.75,-3.75L3,17.25zM20.71,7.04c0.39,-0.39 0.39,-1.02 0,-1.41l-2.34,-2.34c-0.39,-0.39 -1.02,-0.39 -1.41,0l-1.83,1.83 3.75,3.75 1.83,-1.83z"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19,6.4L17.6,5L12,10.6L6.4,5L5,6.4L10.6,12L5,17.6L6.4,19L12,13.4L17.6,19L19,17.6L13.4,12L19,6.4z"/></svg>',
    spark:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19,9l1.25,-2.75L23,5l-2.75,-1.25L19,1l-1.25,2.75L15,5l2.75,1.25L19,9z M11.5,9.5L9,4L6.5,9.5L1,12l5.5,2.5L9,20l2.5,-5.5L17,12L11.5,9.5z M19,15l-1.25,2.75L15,19l2.75,1.25L19,23l1.25,-2.75L23,19l-2.75,-1.25L19,15z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9,16.2L4.8,12l-1.4,1.4L9,19L21,7l-1.4,-1.4L9,16.2z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6,19c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V7H6v12zM19,4h-3.5l-1,-1h-5l-1,1H5v2h14V4z"/></svg>',
    reply:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10,9V5l-7,7 7,7v-4.1c5,0 8.5,1.6 11,5.1 -1,-5 -4,-10 -11,-11z"/></svg>',
    login:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12,2C6.48,2 2,6.48 2,12c0,4.42 2.87,8.17 6.84,9.5 0.5,0.09 0.68,-0.22 0.68,-0.48 0,-0.24 -0.01,-0.87 -0.01,-1.71 -2.78,0.6 -3.37,-1.34 -3.37,-1.34 -0.45,-1.16 -1.11,-1.47 -1.11,-1.47 -0.91,-0.62 0.07,-0.61 0.07,-0.61 1,0.07 1.53,1.03 1.53,1.03 0.89,1.53 2.34,1.09 2.91,0.83 0.09,-0.65 0.35,-1.09 0.63,-1.34 -2.22,-0.25 -4.56,-1.11 -4.56,-4.94 0,-1.09 0.39,-1.99 1.03,-2.69 -0.1,-0.25 -0.45,-1.27 0.1,-2.65 0,0 0.84,-0.27 2.75,1.03 0.8,-0.22 1.65,-0.33 2.5,-0.34 0.85,0 1.7,0.12 2.5,0.34 1.91,-1.3 2.75,-1.03 2.75,-1.03 0.55,1.38 0.2,2.4 0.1,2.65 0.64,0.7 1.03,1.6 1.03,2.69 0,3.84 -2.34,4.69 -4.57,4.94 0.36,0.31 0.68,0.92 0.68,1.85 0,1.34 -0.01,2.42 -0.01,2.75 0,0.27 0.18,0.58 0.69,0.48C19.13,20.17 22,16.42 22,12c0,-5.52 -4.48,-10 -10,-10z"/></svg>'
  };

  /* ================================================================
     锚定:三类 selector 的生成、应用与三级回退
     ================================================================ */

  function contentRoot() {
    return (
      document.querySelector(".md-content__inner") ||
      document.querySelector("article") ||
      document.body
    );
  }

  /** 内容根之下的纯文本(用于字符偏移),跨元素按文档序拼接。 */
  function collectTextNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentNode;
        if (parent && parent.nodeName === "SCRIPT") return NodeFilter.FILTER_REJECT;
        if (parent && parent.nodeName === "STYLE") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var out = [];
    var node;
    while ((node = walker.nextNode())) out.push(node);
    return out;
  }

  function offsetOf(rootNodes, node, offset) {
    var total = 0;
    for (var i = 0; i < rootNodes.length; i++) {
      if (rootNodes[i] === node) return total + offset;
      total += rootNodes[i].nodeValue.length;
    }
    return -1;
  }

  function rangeFromOffsets(rootNodes, start, end) {
    if (start < 0 || end <= start) return null;
    var total = 0;
    var range = document.createRange();
    var startSet = false;
    for (var i = 0; i < rootNodes.length; i++) {
      var len = rootNodes[i].nodeValue.length;
      if (!startSet && start <= total + len) {
        range.setStart(rootNodes[i], Math.max(0, start - total));
        startSet = true;
      }
      if (startSet && end <= total + len) {
        range.setEnd(rootNodes[i], Math.max(0, end - total));
        return range;
      }
      total += len;
    }
    return startSet ? null : null;
  }

  function xpathFor(node) {
    var parts = [];
    var cur = node;
    var root = contentRoot();
    while (cur && cur !== root && cur.nodeType === 1) {
      var index = 1;
      var sib = cur.previousSibling;
      while (sib) {
        if (sib.nodeType === 1 && sib.nodeName === cur.nodeName) index++;
        sib = sib.previousSibling;
      }
      parts.unshift(cur.nodeName.toLowerCase() + "[" + index + "]");
      cur = cur.parentNode;
    }
    return parts.length ? "./" + parts.join("/") : null;
  }

  function nodeForXpath(xpath) {
    if (!xpath) return null;
    try {
      var result = document.evaluate(
        xpath,
        contentRoot(),
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (e) {
      return null;
    }
  }

  /** 生成三类 selector —— 顺序即回退顺序,别打乱。 */
  function computeSelectors(range) {
    var root = contentRoot();
    var nodes = collectTextNodes(root);
    var start = offsetOf(nodes, range.startContainer, range.startOffset);
    var end = offsetOf(nodes, range.endContainer, range.endOffset);
    var exact = range.toString();
    var selectors = [];

    if (exact) {
      var selector = { type: "TextQuoteSelector", exact: exact };
      if (start >= 0) {
        var full = nodes
          .map(function (n) {
            return n.nodeValue;
          })
          .join("");
        selector.prefix = full.slice(Math.max(0, start - 32), start);
        selector.suffix = full.slice(end, end + 32);
      }
      selectors.push(selector);
    }
    if (start >= 0 && end > start) {
      selectors.push({ type: "TextPositionSelector", start: start, end: end });
    }
    var startXpath = xpathFor(range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentNode);
    var endXpath = xpathFor(range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentNode);
    if (startXpath) {
      selectors.push({
        type: "RangeSelector",
        startXpath: startXpath,
        startOffset: range.startOffset,
        endXpath: endXpath || startXpath,
        endOffset: range.endOffset
      });
    }
    return selectors;
  }

  /** 在给定范围内按 quote 找最贴合的一段(prefix/suffix 命中优先)。 */
  function findByQuote(nodes, quote) {
    var full = nodes
      .map(function (n) {
        return n.nodeValue;
      })
      .join("");
    var exact = quote.exact;
    if (!exact) return null;
    var from = 0;
    var best = -1;
    var bestScore = -1;
    while (true) {
      var at = full.indexOf(exact, from);
      if (at === -1) break;
      var score = 0;
      if (quote.prefix && full.slice(Math.max(0, at - quote.prefix.length), at) === quote.prefix) score += 2;
      if (quote.suffix && full.slice(at + exact.length, at + exact.length + quote.suffix.length) === quote.suffix) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = at;
      }
      if (bestScore === 4) break;
      from = at + 1;
    }
    if (best === -1) return null;
    return rangeFromOffsets(nodes, best, best + exact.length);
  }

  /** 第二级回退:按记录的字符位置,在 ±window 里模糊匹配 quote 的前缀。 */
  function findByPositionFuzzy(nodes, position, quote) {
    var full = nodes
      .map(function (n) {
        return n.nodeValue;
      })
      .join("");
    var needle = (quote && quote.exact ? quote.exact : "").slice(0, 64);
    if (needle.length < 8) return null;
    var window = 2000;
    var from = Math.max(0, position.start - window);
    var to = Math.min(full.length, position.end + window);
    var slice = full.slice(from, to);
    for (var len = needle.length; len >= 8; len -= 4) {
      var probe = needle.slice(0, len);
      var at = slice.indexOf(probe);
      if (at !== -1) {
        var abs = from + at;
        return rangeFromOffsets(
          nodes,
          abs,
          abs + Math.min(quote.exact.length, len)
        );
      }
    }
    return null;
  }

  /** 第三级回退:RangeSelector(xpath + offset)。 */
  function findByXpath(rangeSelector) {
    var startNode = nodeForXpath(rangeSelector.startXpath);
    if (!startNode) return null;
    var start = startNode.firstChild || startNode;
    var range = document.createRange();
    try {
      range.setStart(
        start.nodeType === 3 ? start : startNode,
        Math.min(rangeSelector.startOffset || 0, (start.nodeType === 3 ? start : startNode).nodeValue ? (start.nodeType === 3 ? start : startNode).nodeValue.length : startNode.childNodes.length)
      );
      var endNode = nodeForXpath(rangeSelector.endXpath) || startNode;
      var endTarget = endNode.lastChild || endNode;
      range.setEnd(
        endTarget.nodeType === 3 ? endTarget : endNode,
        Math.min(rangeSelector.endOffset || 0, (endTarget.nodeType === 3 ? endTarget : endNode).nodeValue ? (endTarget.nodeType === 3 ? endTarget : endNode).nodeValue.length : endNode.childNodes.length)
      );
    } catch (e) {
      return null;
    }
    return range.collapsed ? null : range;
  }

  /**
   * 三级回退解析出可渲染的 Range。
   * 全都失败返回 null —— 调用方把它放进「未能定位」分组,不静默丢。
   */
  function resolveRange(selectors) {
    var nodes = collectTextNodes(contentRoot());
    if (nodes.length === 0) return null;
    var quote = null;
    var position = null;
    var rangeSelector = null;
    for (var i = 0; i < selectors.length; i++) {
      var s = selectors[i];
      if (s.type === "TextQuoteSelector" && quote === null) quote = s;
      else if (s.type === "TextPositionSelector" && position === null) position = s;
      else if (s.type === "RangeSelector" && rangeSelector === null) rangeSelector = s;
    }
    var range = quote ? findByQuote(nodes, quote) : null;
    if (!range && position) {
      range = rangeFromOffsets(nodes, position.start, position.end);
      if (!range) range = findByPositionFuzzy(nodes, position, quote);
    }
    if (!range && rangeSelector) range = findByXpath(rangeSelector);
    return range;
  }

  /* ================================================================
     高亮渲染
     ================================================================ */

  /** 一个 Range 可能跨多个元素:拆成多个 <mark>,共享同一个 data-anno-id。 */
  function markRange(range, anno) {
    var nodes = collectTextNodes(contentRoot());
    var targets = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!range.intersectsNode(node)) continue;
      if (!node.nodeValue || node.nodeValue.trim().length === 0) continue;
      // 跳过已有高亮(避免嵌套)与代码里的 svg 文本
      if (node.parentNode && node.parentNode.closest && node.parentNode.closest("mark.aipm-anno-mark")) continue;
      if (node.parentNode && node.parentNode.closest && node.parentNode.closest("svg")) continue;
      var start = node === range.startContainer ? range.startOffset : 0;
      var end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (end <= start) continue;
      targets.push({ node: node, start: start, end: end });
    }
    var made = [];
    for (var j = 0; j < targets.length; j++) {
      var t = targets[j];
      var original = t.node;
      if (!original.parentNode) continue;
      var tail = original.splitText(t.end);
      var mid = original.splitText(t.start);
      var mark = document.createElement("mark");
      mark.className = "aipm-anno-mark";
      mark.setAttribute("data-anno-id", anno.id);
      mark.setAttribute("data-color", anno.color || store.DEFAULT_COLOR);
      mark.setAttribute("role", "button");
      mark.setAttribute("tabindex", "0");
      mark.setAttribute("aria-label", "批注:" + (anno.body ? anno.body.slice(0, 60) : "高亮"));
      mid.parentNode.insertBefore(mark, mid);
      mark.appendChild(mid);
      made.push(mark);
      void tail;
    }
    return made;
  }

  function clearMarks() {
    var marks = document.querySelectorAll("mark.aipm-anno-mark");
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  /* ================================================================
     DOM 构造
     ================================================================ */

  function swatchHtml() {
    return store.PALETTE.map(function (p) {
      return (
        '<button type="button" class="aipm-anno__swatch" data-color="' +
        p.id +
        '" title="' +
        p.label +
        "(" +
        p.key +
        ')" aria-label="' +
        p.label +
        '"><span class="aipm-anno__swatch-dot" data-color="' +
        p.id +
        '"></span></button>'
      );
    }).join("");
  }

  var scrim = document.createElement("div");
  scrim.className = "aipm-anno__scrim";
  scrim.setAttribute("data-level", "none");
  scrim.setAttribute("aria-hidden", "true");
  document.body.appendChild(scrim);

  var panel = document.createElement("div");
  panel.className = "aipm-anno";
  panel.id = "aipm-annotations";
  panel.tabIndex = -1;
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "网页批注");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML =
    '<button type="button" class="aipm-anno__grip" aria-label="调整批注面板高度">' +
    '<span class="aipm-anno__grip-bar"></span></button>' +
    '<header class="aipm-anno__head">' +
    '<span class="aipm-anno__head-icon">' +
    ICON.pen +
    "</span>" +
    '<span class="aipm-anno__title">批注</span>' +
    '<span class="aipm-anno__count" hidden></span>' +
    '<button type="button" class="aipm-anno__iconbtn aipm-anno__smart" title="智能高亮" aria-label="智能高亮">' +
    ICON.spark +
    "</button>" +
    '<button type="button" class="aipm-anno__iconbtn aipm-anno__close" title="关闭(Esc)" aria-label="关闭">' +
    ICON.close +
    "</button>" +
    "</header>" +
    '<div class="aipm-anno__smartbar" hidden></div>' +
    '<div class="aipm-anno__list" role="log" aria-live="polite"></div>' +
    '<form class="aipm-anno__composer">' +
    '<div class="aipm-anno__quote" hidden></div>' +
    '<div class="aipm-anno__swatches" role="radiogroup" aria-label="高亮颜色">' +
    swatchHtml() +
    "</div>" +
    '<div class="aipm-anno__vis" role="radiogroup" aria-label="可见范围">' +
    '<button type="button" data-vis="public">公开</button>' +
    '<button type="button" data-vis="private">私有</button>' +
    '<button type="button" data-vis="local">仅本机</button>' +
    "</div>" +
    '<textarea class="aipm-anno__input" rows="2" placeholder="写点什么(可留空,只做高亮)…" aria-label="批注正文"></textarea>' +
    '<div class="aipm-anno__hint" hidden></div>' +
    '<div class="aipm-anno__actions">' +
    '<button type="button" class="aipm-anno__login" hidden>用 GitHub 登录</button>' +
    '<span class="aipm-anno__user" hidden></span>' +
    '<button type="button" class="aipm-anno__logout" hidden>退出</button>' +
    '<button type="button" class="aipm-anno__cancel">取消</button>' +
    '<button type="submit" class="aipm-anno__save">保存</button>' +
    "</div>" +
    "</form>";
  document.body.appendChild(panel);

  var toolbar = document.createElement("div");
  toolbar.className = "aipm-anno__toolbar";
  toolbar.hidden = true;
  toolbar.innerHTML =
    swatchHtml() +
    '<button type="button" class="aipm-anno__tb-annotate">' +
    ICON.pen +
    "<span>写批注</span></button>" +
    '<button type="button" class="aipm-anno__tb-cancel" aria-label="取消">' +
    ICON.close +
    "</button>";
  document.body.appendChild(toolbar);

  var els = {
    panel: panel,
    scrim: scrim,
    toolbar: toolbar,
    grip: panel.querySelector(".aipm-anno__grip"),
    head: panel.querySelector(".aipm-anno__head"),
    count: panel.querySelector(".aipm-anno__count"),
    smart: panel.querySelector(".aipm-anno__smart"),
    close: panel.querySelector(".aipm-anno__close"),
    smartbar: panel.querySelector(".aipm-anno__smartbar"),
    list: panel.querySelector(".aipm-anno__list"),
    composer: panel.querySelector(".aipm-anno__composer"),
    quote: panel.querySelector(".aipm-anno__quote"),
    swatches: panel.querySelector(".aipm-anno__swatches"),
    vis: panel.querySelector(".aipm-anno__vis"),
    input: panel.querySelector(".aipm-anno__input"),
    hint: panel.querySelector(".aipm-anno__hint"),
    actions: panel.querySelector(".aipm-anno__actions"),
    login: panel.querySelector(".aipm-anno__login"),
    logout: panel.querySelector(".aipm-anno__logout"),
    user: panel.querySelector(".aipm-anno__user"),
    cancel: panel.querySelector(".aipm-anno__cancel"),
    save: panel.querySelector(".aipm-anno__save")
  };

  /* 页头入口按钮(位置与样式沿用 issue #67:页头右上角、贴浏览器右边缘) */
  var entry = document.createElement("button");
  entry.type = "button";
  entry.className = "md-header__button md-icon aipm-anno-entry";
  entry.title = "网页批注";
  entry.setAttribute("aria-label", "打开批注面板");
  entry.setAttribute("aria-expanded", "false");
  entry.innerHTML = ICON.pen;

  function mountEntry() {
    var inner = document.querySelector(".md-header__inner");
    if (!inner || entry.parentNode === inner) return;
    inner.appendChild(entry);
  }

  /* ================================================================
     形态状态机(状态写在 <html> 上,几何交给 CSS)
     ================================================================ */
  var mode = "dock";
  var open = false;
  var snap = "peek";
  var peekH = SHEET_PEEK_MIN;
  var snapTimer = 0;

  function refreshPeek() {
    if (mode !== "sheet" || !els.grip || !els.head || !els.composer) {
      peekH = SHEET_PEEK_MIN;
      return;
    }
    var prev = panel.getAttribute("data-snap");
    if (prev !== "peek") panel.setAttribute("data-snap", "peek");
    var c = els.composer;
    var mb = parseFloat(getComputedStyle(c).marginBottom) || 0;
    var h = els.grip.offsetHeight + els.head.offsetHeight + c.offsetHeight + mb + 1;
    if (prev !== "peek") panel.setAttribute("data-snap", prev || "peek");
    var cap = Math.round((window.innerHeight || 800) * SHEET_PEEK_MAX_VH);
    peekH = Math.max(SHEET_PEEK_MIN, Math.min(Math.round(h), cap));
  }

  function metrics() {
    var vp = panels
      ? panels.viewportHeights()
      : { vh: window.innerHeight, visible: window.innerHeight };
    return panels
      ? panels.computeMetrics({
          vh: vp.vh,
          visible: vp.visible,
          peek: peekH,
          peekMin: SHEET_PEEK_MIN,
          halfVh: SHEET_HALF_VH,
          topGap: SHEET_TOP_GAP
        })
      : { peek: peekH, half: vp.vh * SHEET_HALF_VH, expanded: vp.visible - SHEET_TOP_GAP };
  }

  function applyMetrics() {
    refreshPeek();
    var m = metrics();
    var st = document.documentElement.style;
    st.setProperty("--aipm-anno-sheet-peek", m.peek + "px");
    st.setProperty("--aipm-anno-sheet-half", m.half + "px");
    st.setProperty("--aipm-anno-sheet-expanded", m.expanded + "px");
    st.setProperty(
      "--aipm-anno-sbw",
      (panels ? panels.scrollbarWidth() : 0) + "px"
    );
  }

  function computeMode() {
    return MQ_SHEET.matches ? "sheet" : MQ_DOCK.matches ? "dock" : "overlay";
  }

  function scrimLevel() {
    if (!open) return "none";
    if (mode === "dock") return "none";
    if (mode === "sheet") return snap === "peek" ? "none" : snap === "half" ? "half" : "full";
    return "full";
  }

  function locked() {
    return open && mode !== "dock" && !(mode === "sheet" && snap === "peek");
  }

  function syncChrome() {
    var cl = document.documentElement.classList;
    cl.toggle("aipm-anno-open", open);
    cl.toggle("aipm-anno-mode--dock", mode === "dock");
    cl.toggle("aipm-anno-mode--overlay", mode === "overlay");
    cl.toggle("aipm-anno-mode--sheet", mode === "sheet");
    cl.toggle("aipm-anno-locked", locked());
    els.scrim.setAttribute("data-level", scrimLevel());
    entry.setAttribute("aria-expanded", open ? "true" : "false");
    var modal = open && (mode === "overlay" || (mode === "sheet" && snap !== "peek"));
    panel.setAttribute("role", mode === "dock" ? "complementary" : "dialog");
    if (mode === "dock") panel.removeAttribute("aria-modal");
    else panel.setAttribute("aria-modal", modal ? "true" : "false");
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function clearDragHeight() {
    panel.style.minHeight = "";
    panel.classList.remove("is-dragging");
    panel.style.height = "";
  }

  function markSnapping() {
    clearTimeout(snapTimer);
    panel.classList.add("is-snapping");
    snapTimer = setTimeout(function () {
      panel.classList.remove("is-snapping");
    }, SNAP_MS + 90);
  }

  function setSnap(next, afterDrag) {
    if (panels && panels.ORDER.indexOf(next) === -1) return;
    snap = next;
    panel.setAttribute("data-snap", next);
    syncChrome();
    if (afterDrag) {
      requestAnimationFrame(function () {
        clearDragHeight();
        markSnapping();
      });
    } else {
      clearDragHeight();
    }
  }

  function applyMode() {
    var next = computeMode();
    var changed = next !== mode;
    mode = next;
    if (changed && open && mode === "sheet") snap = "peek";
    if (mode === "sheet") panel.setAttribute("data-snap", snap);
    else panel.removeAttribute("data-snap");
    applyMetrics();
    syncChrome();
  }

  /* ================================================================
     打开 / 关闭(经互斥注册表)
     ================================================================ */
  var openedAt = 0;

  function openPanel() {
    if (open) return;
    open = true;
    openedAt = Date.now();
    clearDragHeight();
    clearTimeout(snapTimer);
    panel.classList.remove("is-compact", "is-snapping");
    if (mode === "sheet") snap = "peek";
    applyMetrics();
    syncChrome();
    if (mode === "sheet") {
      setSnap(snap);
      panel.focus({ preventScroll: true });
    }
    ensureAnnotationsLoaded();
  }

  function closePanel() {
    if (!open) return;
    open = false;
    syncChrome();
    hideToolbar();
    entry.focus();
    void openedAt;
  }

  if (panels) {
    panels.attachSheetDrag({
      panel: panel,
      gripSelector: ".aipm-anno__grip",
      headSelector: ".aipm-anno__head",
      order: panels.ORDER,
      snapMs: SNAP_MS,
      minHeight: SHEET_MIN_H,
      closeRatio: CLOSE_RATIO,
      swipeV: SWIPE_V,
      isActive: function () {
        return mode === "sheet" && open;
      },
      getMetrics: metrics,
      getSnap: function () {
        return snap;
      },
      setSnap: setSnap,
      onCompactChange: function (compact) {
        panel.classList.toggle("is-compact", compact);
      },
      markSnapping: markSnapping,
      clearDragHeight: clearDragHeight,
      onClose: closePanel
    });
    panels.register("annotation", {
      open: openPanel,
      close: closePanel,
      isOpen: function () {
        return open;
      }
    });
  }

  entry.addEventListener("click", function () {
    if (panels) panels.claim("annotation");
    else if (open) closePanel();
    else openPanel();
  });
  els.close.addEventListener("click", closePanel);
  els.scrim.addEventListener("click", function () {
    closePanel();
  });

  /* ================================================================
     状态
     ================================================================ */
  var currentPage = null;
  var publicList = [];
  var privateList = [];
  var localList = [];
  var resolved = {}; // annoId → Range
  var orphans = []; // 锚不到的批注
  var pendingSelection = null; // 工具条当前对应的选区 {range, selectors}
  /* 开始写批注时把选区**锁定**一份到这里。工具条一收起(点「批注」就会收起,
     而且收起的同一步会把 pendingSelection 置空),待提交的这条批注就再没有
     选区可用了 —— 之前因此永远走到「先在正文里选中一段话」这句提示上,
     即从前端根本建不出批注。它一直留到 finishComposer() 才清。 */
  var composerSelection = null; // {selectors, quote}
  var editingId = null; // 正在编辑的批注 id(null = 新建)
  var activeColor = store.lastColor();
  var activeVis = null;
  var busy = false;
  var cache = {};

  function pagePath() {
    var p = location.pathname;
    if (p.length > 1 && p.charAt(p.length - 1) !== "/") p += "/";
    return p;
  }

  function pageTitle() {
    var h = document.querySelector(".md-content h1") || document.querySelector("h1");
    return (h ? h.textContent : document.title || "").trim();
  }

  function defaultVisibility() {
    if (!auth || !auth.isLoggedIn()) return "local";
    return activeVis === "private" ? "private" : "public";
  }

  /* ================================================================
     加载与渲染
     ================================================================ */

  function ensureAnnotationsLoaded() {
    var page = pagePath();
    if (currentPage === page && cache[page]) {
      render();
      return Promise.resolve();
    }
    currentPage = page;
    var token = auth ? auth.token() : null;
    var requests = [
      store.request("/api/annotations?page=" + encodeURIComponent(page) + "&scope=public")
    ];
    if (token) {
      requests.push(
        store.request("/api/annotations?page=" + encodeURIComponent(page) + "&scope=mine", {
          token: token
        })
      );
    }
    return Promise.all(requests).then(function (results) {
      if (currentPage !== page) return; // 期间又换页了
      publicList = results[0].ok && results[0].body ? results[0].body.annotations || [] : [];
      var mine =
        results[1] && results[1].ok && results[1].body ? results[1].body.annotations || [] : [];
      /* scope=mine 回的是**本人全部**(公开 + 私有),公开的那些已经在 publicList 里了;
         直接 concat 会让登录用户看到自己的每条公开批注各出现两次(一次还挂着
         「登录同账号可见」的错误标签)。这里只留私有的,去重靠这一道。 */
      privateList = mine.filter(function (a) {
        return a && a.visibility === "private";
      });
      localList = store.localList(page);
      cache[page] = true;
      applyAll();
      render();
      maybeRestoreDraft();
    });
  }

  function invalidate() {
    cache = {};
    currentPage = null;
  }

  /** 把三类批注都尝试锚定并渲染高亮;锚不到的进 orphans。 */
  function applyAll() {
    clearMarks();
    resolved = {};
    orphans = [];
    var all = publicList.concat(privateList).concat(localList);
    for (var i = 0; i < all.length; i++) {
      var anno = all[i];
      if (anno.visibility === "local" && store.serverIdOf(anno.id)) {
        /* 已上传为公开/私有:本机那份不再重复渲染,由服务端那份负责。
           这里必须 continue —— 只是留个空 if 的话,本机那条会继续往下走去锚定,
           而那段文字已经被服务端那份占住了,于是它既画不出高亮、又被打成
           「未在正文中定位」,列表里凭空多出一条没位置的条目。 */
        continue;
      }
      var range = resolveRange((anno.target && anno.target.selectors) || []);
      if (range === null) {
        orphans.push(anno);
        continue;
      }
      resolved[anno.id] = range;
      if (markRange(range, anno).length === 0) {
        /* 位置找得到,但那段文字已经被另一条批注的 <mark> 占住了 —— 同一句话
           被两个人划线是常见情况,而这里画不出第二个高亮。别让它在页面上无声
           消失:与「根本找不到位置」一样进未定位分组,给出重新锚定/删除的出口。 */
        orphans.push(anno);
      }
    }
  }

  function annoById(id) {
    var all = publicList.concat(privateList).concat(localList);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function isLocal(anno) {
    return anno.visibility === "local";
  }

  function visLabel(anno) {
    if (anno.visibility === "public") return { text: "公开", cls: "is-public" };
    if (anno.visibility === "private") return { text: "登录同账号可见", cls: "is-private" };
    return { text: "仅本机", cls: "is-local" };
  }

  function escapeText(s) {
    return String(s === undefined || s === null ? "" : s);
  }

  function render() {
    var items = publicList.concat(privateList).concat(localList);
    els.count.textContent = items.length ? String(items.length) : "";
    els.count.hidden = items.length === 0;
    els.list.textContent = "";

    if (items.length === 0 && orphans.length === 0) {
      var empty = document.createElement("p");
      empty.className = "aipm-anno__empty";
      empty.textContent = "选中正文里的一段话就能加批注。未登录也可以写,批注只存在这台设备上。";
      els.list.appendChild(empty);
      return;
    }

    var orphanIds = {};
    orphans.forEach(function (a) {
      orphanIds[a.id] = true;
    });
    var groups = [
      { key: "public", title: "公开", list: publicList },
      { key: "private", title: "私有(仅自己)", list: privateList },
      { key: "local", title: "仅本机", list: localList }
    ];
    var prefs = store.prefs();
    groups.forEach(function (g) {
      // 未定位的那些下面单独成组,别在这里再列一遍(否则同一条批注出现两次,
      // 一条带着「未定位」角标、一条没有)。先滤再判空 —— 只按 g.list.length
      // 判断的话,某个分组若整组都是未定位的,会留下一个空标题挂在那儿。
      var visible = g.list.filter(function (anno) {
        return !orphanIds[anno.id];
      });
      if (visible.length === 0) return;
      if (!prefs["show" + g.key.charAt(0).toUpperCase() + g.key.slice(1)]) return;
      var header = document.createElement("h3");
      header.className = "aipm-anno__group";
      header.textContent = g.title;
      els.list.appendChild(header);
      visible.forEach(function (anno) {
        els.list.appendChild(renderItem(anno));
      });
    });

    if (orphans.length > 0) {
      var oh = document.createElement("h3");
      oh.className = "aipm-anno__group is-orphan";
      oh.textContent = "未在正文中定位(" + orphans.length + ")";
      oh.title = "页面改过之后这些批注找不到原来的位置了;它们没有被删掉";
      els.list.appendChild(oh);
      orphans.forEach(function (anno) {
        els.list.appendChild(renderItem(anno, true));
      });
    }
  }

  function renderItem(anno, isOrphan) {
    var wrap = document.createElement("article");
    wrap.className = "aipm-anno__item";
    wrap.setAttribute("data-anno-id", anno.id);
    wrap.setAttribute("data-color", anno.color || store.DEFAULT_COLOR);

    var top = document.createElement("div");
    top.className = "aipm-anno__item-top";
    var dot = document.createElement("span");
    dot.className = "aipm-anno__dot";
    dot.setAttribute("data-color", anno.color || store.DEFAULT_COLOR);
    top.appendChild(dot);
    var meta = document.createElement("span");
    meta.className = "aipm-anno__meta";
    var v = visLabel(anno);
    var who = anno.author && anno.author.login ? anno.author.login : "匿名";
    meta.textContent = who + " · " + v.text;
    meta.setAttribute("data-vis", v.cls);
    top.appendChild(meta);
    var spacer = document.createElement("span");
    spacer.className = "aipm-anno__spacer";
    top.appendChild(spacer);
    if (isOrphan) {
      var ob = document.createElement("span");
      ob.className = "aipm-anno__badge";
      ob.textContent = "未定位";
      top.appendChild(ob);
    }
    wrap.appendChild(top);

    var quoteText = quoteOf(anno);
    if (quoteText) {
      var q = document.createElement("blockquote");
      q.className = "aipm-anno__item-quote";
      q.textContent = quoteText.length > 140 ? quoteText.slice(0, 140) + "…" : quoteText;
      wrap.appendChild(q);
    }

    var body = document.createElement("p");
    body.className = "aipm-anno__item-body";
    body.textContent = escapeText(anno.body) || "(只有高亮,没有文字)";
    wrap.appendChild(body);

    if (anno.replies && anno.replies.length) {
      var replies = document.createElement("div");
      replies.className = "aipm-anno__replies";
      anno.replies.forEach(function (r) {
        var line = document.createElement("p");
        line.className = "aipm-anno__reply";
        var author = document.createElement("b");
        author.textContent = (r.author && r.author.login) || "匿名";
        line.appendChild(author);
        line.appendChild(document.createTextNode(" " + r.body));
        replies.appendChild(line);
      });
      wrap.appendChild(replies);
    }

    var acts = document.createElement("div");
    acts.className = "aipm-anno__item-actions";
    acts.appendChild(
      actionButton("回复", "reply", function () {
        startReply(anno);
      })
    );
    if (canEdit(anno)) {
      acts.appendChild(
        actionButton("编辑", "edit", function () {
          startEdit(anno);
        })
      );
      acts.appendChild(
        actionButton("删除", "delete", function () {
          removeAnnotation(anno);
        })
      );
      acts.appendChild(
        actionButton("改色", "recolor", function () {
          cycleColor(anno);
        })
      );
    }
    if (isLocal(anno)) {
      if (store.serverIdOf(anno.id)) {
        var done = document.createElement("span");
        done.className = "aipm-anno__badge";
        done.textContent = "已上传";
        acts.appendChild(done);
      } else if (auth && auth.isLoggedIn()) {
        acts.appendChild(
          actionButton("上传为公开", "upload-public", function () {
            uploadLocal(anno, "public");
          })
        );
        acts.appendChild(
          actionButton("上传为私有", "upload-private", function () {
            uploadLocal(anno, "private");
          })
        );
      }
    }
    if (isOrphan) {
      acts.appendChild(
        actionButton("重新锚定", "reanchor", function () {
          reanchor(anno);
        })
      );
    }
    wrap.appendChild(acts);
    return wrap;
  }

  function actionButton(label, action, handler) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "aipm-anno__link";
    b.setAttribute("data-action", action);
    b.textContent = label;
    b.addEventListener("click", handler);
    return b;
  }

  function quoteOf(anno) {
    var sels = (anno.target && anno.target.selectors) || [];
    for (var i = 0; i < sels.length; i++) {
      if (sels[i].type === "TextQuoteSelector" && sels[i].exact) return sels[i].exact;
    }
    for (var j = 0; j < sels.length; j++) {
      if (sels[j].type === "TextPositionSelector") return "字符 " + sels[j].start + "–" + sels[j].end;
    }
    return "";
  }

  function canEdit(anno) {
    if (isLocal(anno)) return true;
    var me = auth ? auth.user() : null;
    return me !== null && anno.author && anno.author.githubId === me.githubId;
  }

  /* ================================================================
     选中 → 工具条 → 新建批注
     ================================================================ */

  function selectionInContent() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    var root = contentRoot();
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    if (!range.toString().trim()) return null;
    return range;
  }

  function showToolbar(range) {
    var rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    toolbar.hidden = false;
    // 先显示再量尺寸,免得取到 0
    var tw = toolbar.offsetWidth || 260;
    var th = toolbar.offsetHeight || 40;
    var left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - tw / 2),
      window.innerWidth - tw - 8
    );
    var top = rect.top - th - 8;
    if (top < 8) top = rect.bottom + 8;
    toolbar.style.left = left + "px";
    toolbar.style.top = top + "px";
  }

  function hideToolbar() {
    toolbar.hidden = true;
    pendingSelection = null;
  }

  document.addEventListener("selectionchange", function () {
    if (!open && toolbar.hidden === false) hideToolbar();
    if (locked() && open) return;
    var range = selectionInContent();
    if (range === null) {
      hideToolbar();
      return;
    }
    pendingSelection = { range: range, selectors: computeSelectors(range) };
    showToolbar(range);
  });

  toolbar.addEventListener("mousedown", function (e) {
    // 别让点击工具条清掉选区
    e.preventDefault();
  });

  /* 面板里的按钮同理:「重新锚定」的流程就是「先在正文里选好一段话,再回面板点
     这个按钮」,而 mousedown 的默认行为会把正文选区收掉 —— 等 click 跑到时
     selectionInContent() 已经是空的,用户只会看到「先在正文里选中一段话」。
     只对按钮 preventDefault:输入框与列表里的正文仍要能正常落下光标、拖选文字。 */
  panel.addEventListener("mousedown", function (e) {
    if (e.target && e.target.closest && e.target.closest("button")) e.preventDefault();
  });
  toolbar.addEventListener("click", function (e) {
    var cancel = e.target.closest(".aipm-anno__tb-cancel");
    if (cancel) {
      hideToolbar();
      return;
    }
    var swatch = e.target.closest(".aipm-anno__swatch");
    if (swatch) {
      activeColor = swatch.getAttribute("data-color");
      store.setLastColor(activeColor);
      syncComposer();
      return;
    }
    if (e.target.closest(".aipm-anno__tb-annotate")) {
      startCreate();
    }
  });

  function startCreate() {
    if (!pendingSelection) return;
    editingId = null;
    composerSelection = {
      selectors: pendingSelection.selectors,
      quote: pendingSelection.range.toString()
    };
    els.quote.hidden = false;
    els.quote.textContent = composerSelection.quote.slice(0, 200);
    els.input.value = "";
    hideToolbar();
    if (panels) panels.claim("annotation");
    else openPanel();
    syncComposer();
    els.input.focus();
  }

  function startEdit(anno) {
    // 编辑走批注自己的 selectors,别把上一次「新建」锁定的选区带进来
    composerSelection = null;
    editingId = anno.id;
    activeColor = anno.color || store.DEFAULT_COLOR;
    els.quote.hidden = false;
    els.quote.textContent = quoteOf(anno).slice(0, 200);
    els.input.value = anno.body || "";
    els.input.focus();
    syncComposer();
  }

  function startReply(anno) {
    composerSelection = null;
    editingId = anno.id;
    activeColor = anno.color || store.DEFAULT_COLOR;
    els.quote.hidden = false;
    els.quote.textContent = "回复 " + ((anno.author && anno.author.login) || "匿名") + " 的批注";
    els.input.value = "";
    els.input.focus();
    syncComposer();
  }

  function syncComposer() {
    var swatches = els.swatches.querySelectorAll(".aipm-anno__swatch");
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].classList.toggle(
        "is-active",
        swatches[i].getAttribute("data-color") === activeColor
      );
    }
    var vis = defaultVisibility();
    var buttons = els.vis.querySelectorAll("button");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].classList.toggle("is-active", buttons[j].getAttribute("data-vis") === vis);
    }
    var loggedIn = auth ? auth.isLoggedIn() : false;
    els.login.hidden = loggedIn;
    els.logout.hidden = !loggedIn;
    els.user.hidden = !loggedIn;
    var me = auth ? auth.user() : null;
    els.user.textContent = me ? me.login : "";
    setHint(
      !loggedIn
        ? "未登录:现在保存只会存在这台设备上(仅本机)。用 GitHub 登录后可以保存为公开或私有。"
        : vis === "private"
        ? "私有:只有你自己登录后能看到;换设备登录同一账号也能看到。"
        : "公开:任何访客不登录也能读到。"
    );
  }

  function setHint(text) {
    if (!text) {
      els.hint.hidden = true;
      els.hint.textContent = "";
      return;
    }
    els.hint.hidden = false;
    els.hint.textContent = text;
  }

  els.swatches.addEventListener("click", function (e) {
    var swatch = e.target.closest(".aipm-anno__swatch");
    if (!swatch) return;
    activeColor = swatch.getAttribute("data-color");
    store.setLastColor(activeColor);
    syncComposer();
    if (editingId !== null) {
      var anno = annoById(editingId);
      if (anno && isLocal(anno)) {
        store.localUpdate(anno.page, anno.id, { color: activeColor });
        refreshLocal();
      }
    }
  });

  els.vis.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    activeVis = b.getAttribute("data-vis");
    syncComposer();
  });

  els.login.addEventListener("click", function () {
    if (!auth) return;
    auth.loginForDraft(draftForLogin());
  });
  els.logout.addEventListener("click", function () {
    if (!auth) return;
    auth.logout().then(function () {
      invalidate();
      return ensureAnnotationsLoaded();
    });
  });
  els.cancel.addEventListener("click", function () {
    editingId = null;
    els.input.value = "";
    els.quote.hidden = true;
    syncComposer();
  });

  function draftForLogin() {
    var locked = composerSelection !== null
      ? composerSelection
      : (pendingSelection !== null
          ? { selectors: pendingSelection.selectors, quote: pendingSelection.range.toString() }
          : null);
    if (locked === null && editingId === null) return null;
    return {
      page: pagePath(),
      color: activeColor,
      body: els.input.value,
      visibility: activeVis === "private" ? "private" : "public",
      selectors: locked === null ? null : locked.selectors,
      quote: locked === null ? "" : locked.quote
    };
  }

  /** OAuth 往返回来:草稿还在就恢复,并把待发布的那条发出去。 */
  function maybeRestoreDraft() {
    var draft = store.peekDraft();
    if (!draft || draft.page !== pagePath()) return;
    var loggedIn = auth ? auth.isLoggedIn() : false;
    els.quote.hidden = false;
    els.quote.textContent = draft.quote || "";
    els.input.value = draft.body || "";
    activeColor = draft.color || activeColor;
    activeVis = draft.visibility || null;
    syncComposer();
    if (!open && panels) panels.claim("annotation");
    else if (!open) openPanel();
    els.input.focus();
    if (loggedIn && draft.selectors) {
      // 登录回来了:按草稿把那条批注补发出去
      submitAnnotation(draft.selectors, draft.body, draft.visibility).then(function (ok) {
        if (ok) {
          store.clearDraft();
          els.input.value = "";
          els.quote.hidden = true;
          setHint("已按登录前的草稿保存:" + (draft.visibility === "private" ? "私有" : "公开"));
        }
      });
    }
  }

  els.composer.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    var selectors = composerSelection
      ? composerSelection.selectors
      : (pendingSelection ? pendingSelection.selectors : null);
    if (editingId !== null && selectors === null) {
      var anno = annoById(editingId);
      selectors = (anno && anno.target && anno.target.selectors) || null;
    }
    if (!selectors && editingId === null) {
      setHint("先在正文里选中一段话,再写批注。");
      return;
    }
    var wantVis = defaultVisibility();
    if (editingId !== null && wantVis !== "local" && !(auth && auth.isLoggedIn())) {
      setHint("编辑服务端批注需要登录。");
      return;
    }
    if (!(auth && auth.isLoggedIn()) && wantVis !== "local") {
      // 未登录 + 想存服务端:存草稿去登录
      if (auth) auth.loginForDraft(draftForLogin());
      return;
    }
    setBusy(true);
    submitAnnotation(selectors, els.input.value, wantVis).then(function () {
      setBusy(false);
    });
  });

  function setBusy(v) {
    busy = v;
    els.save.disabled = v;
    els.save.textContent = v ? "保存中…" : "保存";
  }

  /**
   * 落库。三态的落点是三套不同的路径 —— 这是整个文件里唯一做选择的地方,
   * 面板其余部分只认「一条批注」。看不到任何把「仅本机」POST 出去的旁路。
   */
  function submitAnnotation(selectors, body, visibility) {
    var page = pagePath();
    var now = new Date().toISOString();
    if (editingId !== null && visibility === "local") {
      var existing = annoById(editingId);
      if (existing === null) return Promise.resolve(false);
      if (existing.visibility === "local") {
        store.localUpdate(page, editingId, { body: body, color: activeColor });
      } else {
        // 服务端批注的回复:走 PATCH 提交整个 replies 数组
        var replies = (existing.replies || []).slice();
        if (body.trim()) replies.push({ body: body });
        return patchAnnotation(existing, { replies: replies }).then(function (ok) {
          if (ok) finishComposer();
          return ok;
        });
      }
      refreshLocal();
      finishComposer();
      return Promise.resolve(true);
    }

    if (visibility === "local") {
      var anno = {
        id: store.uid(),
        page: page,
        visibility: "local",
        color: activeColor,
        body: body,
        author: { githubId: 0, login: (auth && auth.user() ? auth.user().login : "本机") },
        target: { selectors: selectors },
        replies: [],
        createdAt: now,
        updatedAt: now
      };
      try {
        store.localAdd(anno);
      } catch (err) {
        setHint(err.message);
        return Promise.resolve(false);
      }
      refreshLocal();
      finishComposer();
      return Promise.resolve(true);
    }

    // public / private → 服务端
    if (editingId !== null) {
      var target = annoById(editingId);
      if (target === null) return Promise.resolve(false);
      return patchAnnotation(target, {
        body: body,
        color: activeColor,
        visibility: visibility
      }).then(function (ok) {
        if (ok) finishComposer();
        return ok;
      });
    }
    return store
      .request("/api/annotations", {
        method: "POST",
        token: auth.token(),
        body: {
          page: page,
          body: body,
          color: activeColor,
          visibility: visibility,
          target: { selectors: selectors }
        }
      })
      .then(function (res) {
        if (res.status === 401) {
          if (auth) auth.forget();
          setHint("登录已过期,请重新登录。");
          return false;
        }
        if (!res.ok) {
          setHint("保存失败:" + ((res.body && res.body.message) || res.status));
          return false;
        }
        finishComposer();
        invalidate();
        return ensureAnnotationsLoaded().then(function () {
          return true;
        });
      });
  }

  function patchAnnotation(anno, patch) {
    var token = auth ? auth.token() : null;
    var isLocalAnno = isLocal(anno);
    if (isLocalAnno) {
      store.localUpdate(anno.page, anno.id, patch);
      refreshLocal();
      return Promise.resolve(true);
    }
    if (!token) {
      setHint("需要登录才能修改。");
      return Promise.resolve(false);
    }
    return store
      .request("/api/annotations/" + encodeURIComponent(anno.id), {
        method: "PATCH",
        token: token,
        body: patch
      })
      .then(function (res) {
        if (res.status === 401) {
          auth.forget();
          setHint("登录已过期,请重新登录。");
          return false;
        }
        if (!res.ok) {
          setHint("修改失败:" + ((res.body && res.body.message) || res.status));
          return false;
        }
        invalidate();
        return ensureAnnotationsLoaded().then(function () {
          return true;
        });
      });
  }

  function finishComposer() {
    editingId = null;
    composerSelection = null;
    els.input.value = "";
    els.quote.hidden = true;
    setHint("");
    syncComposer();
  }

  function refreshLocal() {
    localList = store.localList(pagePath());
    applyAll();
    render();
  }

  function removeAnnotation(anno) {
    if (isLocal(anno)) {
      store.localRemove(anno.page, anno.id);
      refreshLocal();
      return;
    }
    var token = auth ? auth.token() : null;
    if (!token) return;
    store
      .request("/api/annotations/" + encodeURIComponent(anno.id), { method: "DELETE", token: token })
      .then(function (res) {
        if (res.ok || res.status === 404) {
          invalidate();
          return ensureAnnotationsLoaded();
        }
        if (res.status === 401) auth.forget();
        setHint("删除失败:" + ((res.body && res.body.message) || res.status));
      });
  }

  function cycleColor(anno) {
    var index = 0;
    for (var i = 0; i < store.PALETTE.length; i++) {
      if (store.PALETTE[i].id === (anno.color || store.DEFAULT_COLOR)) index = i;
    }
    var next = store.PALETTE[(index + 1) % store.PALETTE.length].id;
    patchAnnotation(anno, { color: next });
  }

  function reanchor(anno) {
    var sel = selectionInContent();
    if (sel === null) {
      setHint("先在正文里选中一段话,再点「重新锚定」。");
      return;
    }
    var selectors = computeSelectors(sel);
    patchAnnotation(anno, {}).then(function () {
      /* PATCH 不接受 selector 变更(那是新锚点,不是编辑),所以重新锚定走
         「删掉旧的服务端记录 + 用新锚点建一条」——只对本机批注直接改。 */
      if (isLocal(anno)) {
        store.localUpdate(anno.page, anno.id, { target: { selectors: selectors } });
        invalidate();
        ensureAnnotationsLoaded();
      } else {
        setHint("服务端批注的锚点不能就地改;请删掉后在新位置重新添加。");
      }
    });
    void selectors;
  }

  function uploadLocal(anno, visibility) {
    var token = auth ? auth.token() : null;
    if (!token) return;
    setBusy(true);
    store
      .request("/api/annotations", {
        method: "POST",
        token: token,
        body: {
          page: anno.page,
          body: anno.body,
          color: anno.color,
          visibility: visibility,
          target: anno.target
        }
      })
      .then(function (res) {
        setBusy(false);
        if (!res.ok) {
          setHint("上传失败:" + ((res.body && res.body.message) || res.status));
          return;
        }
        store.rememberServerId(anno.id, res.body.annotation.id);
        store.localUpdate(anno.page, anno.id, { uploadedAt: new Date().toISOString() });
        invalidate();
        return ensureAnnotationsLoaded();
      });
  }

  /* ================================================================
     智能高亮
     ================================================================ */
  var suggestCache = {};
  var cooldownUntil = 0;

  function extractBlocks() {
    var root = contentRoot();
    var nodes = root.querySelectorAll(BLOCK_SELECTOR);
    var out = [];
    var seq = 0;
    for (var i = 0; i < nodes.length && out.length < MAX_BLOCKS; i++) {
      var el = nodes[i];
      if (el.closest(".aipm-anno, .aipm-chat, .md-nav, nav, .md-sidebar")) continue;
      // 只取叶子块:含子块时交给子块,避免同一段文字被判两次
      if (el.querySelector(BLOCK_SELECTOR)) continue;
      // 块 id 取「文档里的位置序号」而不是「入选块的序号」:已高亮的块会被下面跳过,
      // 若用入选项计数,同一页在不同客户端(批注多少不同)就会算出不同的 id↔段落
      // 映射,而服务端同页缓存是按页面内容哈希共享的 —— 那样 id 会错配到别的段落。
      // 位置序号只依赖 DOM 顺序,各客户端一致。
      var id = "b" + seq++;
      if (el.closest("mark.aipm-anno-mark")) continue;
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      var range = document.createRange();
      range.selectNodeContents(el);
      out.push({
        id: id,
        text: text.length > MAX_BLOCK_CHARS ? text.slice(0, MAX_BLOCK_CHARS) : text,
        range: range
      });
    }
    return out;
  }

  function smartHighlight() {
    var now = Date.now();
    if (now < cooldownUntil) {
      setSmartbar(
        "刚请求过,请等 " + Math.ceil((cooldownUntil - now) / 1000) + " 秒后再试。",
        "warn"
      );
      return;
    }
    var page = pagePath();
    if (suggestCache[page]) {
      renderSuggestions(suggestCache[page]);
      return;
    }
    var blocks = extractBlocks();
    if (blocks.length === 0) {
      setSmartbar("这一页没有可判定的正文。", "warn");
      return;
    }
    setSmartbar("正在分析这一页…(共 " + blocks.length + " 段)", "busy");
    els.smart.disabled = true;
    store
      .request("/api/highlight/suggest", {
        method: "POST",
        body: {
          page: page,
          title: pageTitle(),
          palette: store.PALETTE.map(function (p) {
            return { id: p.id, label: p.label, when: p.when };
          }),
          blocks: blocks.map(function (b) {
            return { id: b.id, text: b.text };
          }),
          judge: "auto"
        }
      })
      .then(function (res) {
        els.smart.disabled = false;
        if (res.status === 429) {
          var retry = res.headers && res.headers.get ? Number(res.headers.get("retry-after")) : 0;
          cooldownUntil = Date.now() + (retry > 0 ? retry * 1000 : 30000);
          setSmartbar(
            (res.body && res.body.message) || "请求过于频繁,请稍后再试。",
            "warn"
          );
          return;
        }
        if (res.status === 503) {
          setSmartbar("智能高亮当前不可用,批注功能不受影响。", "warn");
          els.smart.disabled = true;
          return;
        }
        if (!res.ok) {
          setSmartbar("智能高亮失败:" + ((res.body && res.body.message) || res.status), "warn");
          return;
        }
        res.body.blocks = blocks;
        suggestCache[page] = res.body;
        renderSuggestions(res.body);
      });
  }

  function setSmartbar(text, kind) {
    if (!text) {
      els.smartbar.hidden = true;
      els.smartbar.textContent = "";
      return;
    }
    els.smartbar.hidden = false;
    els.smartbar.setAttribute("data-kind", kind || "");
    els.smartbar.textContent = text;
  }

  function sourceLabel(source) {
    if (source === "jev") return "Jev";
    if (source === "llm") return "Claude";
    return "规则";
  }

  function renderSuggestions(payload) {
    var blocks = payload.blocks || [];
    var byId = {};
    blocks.forEach(function (b) {
      byId[b.id] = b;
    });
    els.smartbar.hidden = false;
    els.smartbar.setAttribute("data-kind", "result");
    els.smartbar.textContent = "";
    var head = document.createElement("div");
    head.className = "aipm-anno__smart-head";
    var label = sourceLabel(payload.judge);
    var parts = ["智能高亮 · 来源 " + label];
    if (payload.fallbackFrom) parts.push("(由 " + sourceLabel(payload.fallbackFrom) + " 回退)");
    if (payload.model) parts.push(payload.model);
    if (payload.cached) parts.push("缓存");
    head.textContent = parts.join(" ");
    els.smartbar.appendChild(head);

    if (!payload.suggestions || payload.suggestions.length === 0) {
      var none = document.createElement("p");
      none.className = "aipm-anno__smart-none";
      none.textContent = "这一页没有值得高亮的地方。";
      els.smartbar.appendChild(none);
      return;
    }

    var all = document.createElement("button");
    all.type = "button";
    all.className = "aipm-anno__link";
    all.textContent = "全部采纳(" + payload.suggestions.length + ")";
    all.addEventListener("click", function () {
      payload.suggestions.forEach(function (s) {
        acceptSuggestion(s, byId[s.id]);
      });
      setSmartbar("", "");
    });
    els.smartbar.appendChild(all);

    var list = document.createElement("ul");
    list.className = "aipm-anno__smart-list";
    payload.suggestions.forEach(function (s) {
      var block = byId[s.id];
      if (!block) return;
      var li = document.createElement("li");
      li.className = "aipm-anno__smart-item";
      var dot = document.createElement("span");
      dot.className = "aipm-anno__dot";
      dot.setAttribute("data-color", s.color || store.DEFAULT_COLOR);
      li.appendChild(dot);
      var text = document.createElement("span");
      text.className = "aipm-anno__smart-text";
      text.textContent = block.text.slice(0, 90) + (block.text.length > 90 ? "…" : "");
      li.appendChild(text);
      var badge = document.createElement("span");
      badge.className = "aipm-anno__badge";
      badge.textContent = "重要度 " + s.importance;
      li.appendChild(badge);
      var accept = document.createElement("button");
      accept.type = "button";
      accept.className = "aipm-anno__link";
      accept.textContent = "采纳";
      accept.addEventListener("click", function () {
        acceptSuggestion(s, block);
        li.remove();
      });
      li.appendChild(accept);
      list.appendChild(li);
    });
    els.smartbar.appendChild(list);

    if (payload.degraded && payload.degraded.length) {
      var note = document.createElement("p");
      note.className = "aipm-anno__smart-none";
      note.textContent = payload.degraded.length + " 段未给出建议(代码、导航或已超预算)。";
      els.smartbar.appendChild(note);
    }
  }

  function acceptSuggestion(s, block) {
    if (!block || !block.range) return;
    var selectors = computeSelectors(block.range);
    var visibility = defaultVisibility();
    activeColor = s.color || store.DEFAULT_COLOR;
    store.setLastColor(activeColor);
    var saved = activeVis;
    activeVis = visibility;
    var body = "";
    var anno = {
      id: store.uid(),
      page: pagePath(),
      visibility: "local",
      color: activeColor,
      body: body,
      author: { githubId: 0, login: (auth && auth.user() ? auth.user().login : "本机") },
      target: { selectors: selectors },
      replies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (visibility === "local" || !(auth && auth.isLoggedIn())) {
      try {
        store.localAdd(anno);
      } catch (err) {
        setHint(err.message);
        return;
      }
      refreshLocal();
    } else {
      store
        .request("/api/annotations", {
          method: "POST",
          token: auth.token(),
          body: {
            page: anno.page,
            body: body,
            color: activeColor,
            visibility: visibility,
            target: anno.target
          }
        })
        .then(function (res) {
          if (!res.ok) {
            setHint("采纳失败:" + ((res.body && res.body.message) || res.status));
            return;
          }
          invalidate();
          return ensureAnnotationsLoaded();
        });
    }
    activeVis = saved;
  }

  els.smart.addEventListener("click", smartHighlight);

  /* ================================================================
     高亮点击 → 定位到面板里的那条
     ================================================================ */
  document.addEventListener("click", function (e) {
    var mark = e.target.closest && e.target.closest("mark.aipm-anno-mark");
    if (!mark) return;
    var id = mark.getAttribute("data-anno-id");
    if (!open && panels) panels.claim("annotation");
    else if (!open) openPanel();
    var item = els.list.querySelector('[data-anno-id="' + id + '"]');
    if (item) {
      item.scrollIntoView({ block: "center", behavior: "smooth" });
      item.classList.add("is-flash");
      setTimeout(function () {
        item.classList.remove("is-flash");
      }, 900);
    }
  });

  /* ================================================================
     Escape 与焦点环
     ================================================================ */
  document.addEventListener("keydown", function (e) {
    if (!open) return;
    if (e.key === "Escape" && !e.isComposing) {
      if (!toolbar.hidden) {
        hideToolbar();
        return;
      }
      if (document.activeElement && panel.contains(document.activeElement) &&
          document.activeElement.tagName === "TEXTAREA") {
        document.activeElement.blur();
        return;
      }
      closePanel();
      return;
    }
    /* 色板快捷键 1–5:只在面板开着、且没在输入框里打字时生效 */
    if (document.activeElement === els.input) return;
    if (/^[1-5]$/.test(e.key)) {
      var idx = Number(e.key) - 1;
      if (idx < store.PALETTE.length) {
        activeColor = store.PALETTE[idx].id;
        store.setLastColor(activeColor);
        syncComposer();
        e.preventDefault();
      }
      return;
    }
    if (e.key !== "Tab" || !locked()) return;
    var items = panel.querySelectorAll(
      'button:not([disabled]), textarea, input:not([type="hidden"]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ================================================================
     换页 / 视口 / 启动
     ================================================================ */
  function onPageChange() {
    mountEntry();
    hideToolbar();
    invalidate();
    /* 高亮要在页面打开的那一刻就看得见(hypothes.is 也是这样):不依赖面板是否
       打开。面板只是列表的容器,不是高亮的前置条件 —— 之前只在 open 时加载,
       结果是刷新后页面上光秃秃的,别人的公开批注要等用户先点开面板才浮现。 */
    ensureAnnotationsLoaded();
  }

  if (typeof document$ !== "undefined" && document$.subscribe) {
    document$.subscribe(onPageChange);
  } else {
    mountEntry();
  }

  var onViewportChange = function () {
    applyMode();
  };
  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("orientationchange", onViewportChange, { passive: true });
  MQ_DOCK.addEventListener("change", onViewportChange);
  MQ_SHEET.addEventListener("change", onViewportChange);
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      if (mode === "sheet") applyMetrics();
    }).observe(els.composer);
  }

  if (auth) {
    auth.ready().then(function () {
      syncComposer();
      if (auth.isLoggedIn()) invalidate();
      if (open) ensureAnnotationsLoaded();
    });
    auth.onChange(function () {
      syncComposer();
    });
  }

  mountEntry();
  syncComposer();
  applyMode();
})();
