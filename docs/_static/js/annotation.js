/*
  AI-PM 批注面板(annotation.js,2026-09-20)

  取代原来嵌入的 hypothes.is 客户端:选中正文 → 高亮 + 写批注 + 回复/编辑/删除,
  高亮多色,并可选调用智能高亮让模型建议「哪里该高亮、用什么颜色」。

  面板有两个模式,由页头标题切换:
  - **批注**锚在正文的某一段上,列表按该段在正文里的位置排序;
  - **评论**针对整个页面(target.scope = "page"),不锚定任何文字,因此画不出
    高亮、也不会进「未在正文中定位」。
  两者共用同一份列表、同一套「公开 / 私有 / 仅本机」分栏;分栏可折叠,也可整栏
  不显示(两种状态都记在 prefs 里)。

  形态与 AI 助手面板(chat-widget.js)共用一套语言:
  - 同一块屏幕区域(桌面右侧停靠 / 平板浮层 / 移动三段抽屉),改用共享件
    panel-shared.js 的拖拽与吸附,阈值与助手一致;
  - 两者**互斥**:同一时刻最多一个,靠 window.__aipmPanels 注册表串起来 ——
    批注面板开着时点 FAB「询问助手」→ claim("chat") 先关批注再开助手;
    助手开着时点页头批注按钮 → claim("annotation")。关与开在同一个同步任务里,
    浏览器只画一帧,桌面停靠下页面宽度不跳;
  - 页头入口是**开关**:面板开着时再点一次即收起。但图标不变(始终是那支笔)——
    换叉会与面板头部自己的关闭叉打架;助手的 FAB 开着时整个隐藏,所以它没有这个
    来回,而批注入口一直可见,收起的动作只能由它自己承担。

  工程契约:
  - 面板、遮罩、选中工具条都 append 到 document.body 顶层(与 .aipm-chat 同理:
    instant 导航换页整体替换内容容器,挂在容器内会被连根拔掉);
  - 高亮 <mark> 在正文里(必须跟着内容走),所以换页后由 document$ 重新应用
    —— 不写 MutationObserver 重建逻辑;
  - 锚定按 W3C Web Annotation 存三类 selector(TextQuote / TextPosition / Range),
    三级回退;全失败进「未能定位」分组,绝不静默丢;
  - 列表每次 render 整体重建,所以**编辑器由 render 现场产出**(新建 / 编辑 / 回复
    共用一套卡片),它落在列表里该在的位置上,而不是钉在面板底部 —— 写的时候看到
    的排版就是发出去之后的排版;
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
  var BLOCK_SELECTOR = "p, li, blockquote, td, th, dd, dt";
  var ORPHAN_GROUP = "orphan";

  /* 画法与颜色正交。图标照阅读器的惯例画成小图示:两条文字条 + 一条下划线 /
     一块浅底 / 两者叠加 —— 比「U」之类的字形更好认,也不必依赖字体。 */
  var STYLES = [
    {
      id: "underline",
      label: "划线",
      icon:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="3" rx="1"/><rect x="4" y="9" width="16" height="3" rx="1"/><rect x="3" y="15.5" width="18" height="2.6" rx="1"/></svg>'
    },
    {
      id: "highlight",
      label: "高亮",
      icon:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="1.6" fill-opacity=".3"/><rect x="5.5" y="8.4" width="13" height="3" rx="1"/><rect x="5.5" y="13" width="9" height="3" rx="1"/></svg>'
    },
    {
      id: "both",
      label: "高亮划线",
      icon:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3.5" width="18" height="11" rx="1.6" fill-opacity=".3"/><rect x="5.5" y="5.8" width="13" height="3" rx="1"/><rect x="5.5" y="10.2" width="9" height="3" rx="1"/><rect x="3" y="17" width="18" height="2.6" rx="1"/></svg>'
    }
  ];

  var COMMENT_SORTS = [
    { id: "hot", label: "热度" },
    { id: "newest", label: "最新发布" },
    { id: "mostReplies", label: "最多回复" }
  ];

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
    caret:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7,10l5,5 5,-5z"/></svg>',
    edit:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.06,9.02l0.92,0.92L5.92,19H5v-0.92l9.06,-9.06M17.66,3c-0.25,0 -0.51,0.1 -0.7,0.29l-1.83,1.83 3.75,3.75 1.83,-1.83c0.39,-0.39 0.39,-1.02 0,-1.41l-2.34,-2.34C18.17,3.1 17.91,3 17.66,3zM14.06,6.19L3,17.25V21h3.75L17.81,9.94l-3.75,-3.75z"/></svg>',
    heart:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12,21.35l-1.45,-1.32C5.4,15.36 2,12.28 2,8.5 2,5.42 4.42,3 7.5,3c1.74,0 3.41,0.81 4.5,2.09C13.09,3.81 14.76,3 16.5,3 19.58,3 22,5.42 22,8.5c0,3.78 -3.4,6.86 -8.55,11.54L12,21.35z"/></svg>',
    heartOutline:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5,3c-1.74,0 -3.41,0.81 -4.5,2.09C10.91,3.81 9.24,3 7.5,3 4.42,3 2,5.42 2,8.5c0,3.78 3.4,6.86 8.55,11.54L12,21.35l1.45,-1.32C18.6,15.36 22,12.28 22,8.5 22,5.42 19.58,3 16.5,3zM12.1,18.55l-0.1,0.1 -0.1,-0.1C7.14,14.24 4,11.39 4,8.5 4,6.5 5.5,5 7.5,5c1.54,0 3.04,0.99 3.57,2.36h1.87C13.46,5.99 14.96,5 16.5,5c2,0 3.5,1.5 3.5,3.5 0,2.89 -3.14,5.74 -7.9,10.05z"/></svg>',
    eye:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12,4.5C7,4.5 2.73,7.61 1,12c1.73,4.39 6,7.5 11,7.5s9.27,-3.11 11,-7.5c-1.73,-4.39 -6,-7.5 -11,-7.5zM12,17c-2.76,0 -5,-2.24 -5,-5s2.24,-5 5,-5 5,2.24 5,5 -2.24,5 -5,5zM12,9c-1.66,0 -3,1.34 -3,3s1.34,3 3,3 3,-1.34 3,-3 -1.34,-3 -3,-3z"/></svg>',
    eyeOff:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12,7c2.76,0 5,2.24 5,5 0,0.65 -0.13,1.26 -0.36,1.83l2.92,2.92c1.51,-1.26 2.7,-2.89 3.43,-4.75 -1.73,-4.39 -6,-7.5 -11,-7.5 -1.4,0 -2.74,0.25 -3.98,0.7l2.16,2.16C10.74,7.13 11.35,7 12,7zM2,4.27l2.28,2.28 0.46,0.46C3.08,8.3 1.78,10.02 1,12c1.73,4.39 6,7.5 11,7.5 1.55,0 3.03,-0.3 4.38,-0.84l0.42,0.42L19.73,22 21,20.73 3.27,3 2,4.27zM7.53,9.8l1.55,1.55c-0.05,0.21 -0.08,0.43 -0.08,0.65 0,1.66 1.34,3 3,3 0.22,0 0.44,-0.03 0.65,-0.08l1.55,1.55c-0.67,0.33 -1.41,0.53 -2.2,0.53 -2.76,0 -5,-2.24 -5,-5 0,-0.79 0.2,-1.53 0.53,-2.2zM11.84,9.02l3.15,3.15 0.02,-0.16c0,-1.66 -1.34,-3 -3,-3l-0.17,0.01z"/></svg>',
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
      mark.setAttribute("data-style", styleOf(anno));
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

  function styleHtml() {
    return STYLES.map(function (st) {
      return (
        '<button type="button" class="aipm-anno__tb-style" data-style="' +
        st.id +
        '" title="' +
        st.label +
        '" aria-label="' +
        st.label +
        '">' +
        st.icon +
        "</button>"
      );
    }).join("");
  }

  /* 悬浮窗里的短标签。列表卡片上用的是 visLabel() 的长文案(「登录同账号可见」),
     那颗芯片塞不下,也不该塞。 */
  var VIS_SHORT = { public: "公开", private: "私有", local: "仅本机" };

  function visChipsHtml() {
    return ["public", "private", "local"]
      .map(function (v) {
        return (
          '<button type="button" class="aipm-anno__tb-vis" data-vis="' +
          v +
          '">' +
          VIS_SHORT[v] +
          "</button>"
        );
      })
      .join("");
  }

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
    // 标题即「批注 ↔ 评论」的切换器:它同时是当前模式的指示
    '<button type="button" class="aipm-anno__title" aria-label="切换批注与评论">批注</button>' +
    '<span class="aipm-anno__count" hidden></span>' +
    '<button type="button" class="aipm-anno__iconbtn aipm-anno__smart" title="智能高亮" aria-label="智能高亮">' +
    ICON.spark +
    "</button>" +
    // 账号按钮夹在智能高亮与关闭之间(顺序即视觉顺序):登录态的唯一入口
    '<button type="button" class="aipm-anno__iconbtn aipm-anno__account" title="用 GitHub 登录" aria-label="账号">' +
    ICON.login +
    "</button>" +
    '<button type="button" class="aipm-anno__iconbtn aipm-anno__close" title="关闭(Esc)" aria-label="关闭">' +
    ICON.close +
    "</button>" +
    "</header>" +
    '<div class="aipm-anno__acct" hidden>' +
    '<span class="aipm-anno__acct-name"></span>' +
    '<button type="button" class="aipm-anno__logout">退出登录</button>' +
    "</div>" +
    '<div class="aipm-anno__smartbar" hidden></div>' +
    /* 列表是面板里唯一的滚动区,编辑卡也长在里面 —— 新建/编辑/回复三种编辑器都由
       render() 按当前状态现场产出,不再有固定在底部的编辑条。 */
    '<div class="aipm-anno__list" role="log" aria-live="polite"></div>';
  document.body.appendChild(panel);

  var toolbar = document.createElement("div");
  toolbar.className = "aipm-anno__toolbar";
  toolbar.hidden = true;
  /* 两行:上行挑画法与颜色,下行挑可见范围并确认。单行在手机宽度上放不下
     (3 个画法 + 5 个色块 + 3 个范围 + 确认,约 460px)。 */
  toolbar.innerHTML =
    '<div class="aipm-anno__tb-row">' +
    '<div class="aipm-anno__tb-group" role="radiogroup" aria-label="批注画法">' +
    styleHtml() +
    "</div>" +
    '<span class="aipm-anno__tb-sep"></span>' +
    '<div class="aipm-anno__tb-group" role="radiogroup" aria-label="颜色">' +
    swatchHtml() +
    "</div>" +
    "</div>" +
    '<div class="aipm-anno__tb-row">' +
    '<div class="aipm-anno__tb-group" role="radiogroup" aria-label="可见范围">' +
    visChipsHtml() +
    "</div>" +
    '<span class="aipm-anno__tb-spacer"></span>' +
    '<button type="button" class="aipm-anno__tb-annotate">' +
    ICON.pen +
    "<span>写批注</span></button>" +
    '<button type="button" class="aipm-anno__tb-cancel" aria-label="取消">' +
    ICON.close +
    "</button>";
  document.body.appendChild(toolbar);

  /* 只留静态外壳上的引用。编辑卡的节点每次 render 现建现取,不进这张表 ——
     它们随列表一起被重建,存下来必然过期。 */
  var els = {
    panel: panel,
    scrim: scrim,
    toolbar: toolbar,
    grip: panel.querySelector(".aipm-anno__grip"),
    head: panel.querySelector(".aipm-anno__head"),
    title: panel.querySelector(".aipm-anno__title"),
    count: panel.querySelector(".aipm-anno__count"),
    smart: panel.querySelector(".aipm-anno__smart"),
    account: panel.querySelector(".aipm-anno__account"),
    acct: panel.querySelector(".aipm-anno__acct"),
    acctName: panel.querySelector(".aipm-anno__acct-name"),
    close: panel.querySelector(".aipm-anno__close"),
    smartbar: panel.querySelector(".aipm-anno__smartbar"),
    list: panel.querySelector(".aipm-anno__list"),
    logout: panel.querySelector(".aipm-anno__logout")
  };  /* 页头入口按钮(位置与样式沿用 issue #67:页头右上角、贴浏览器右边缘) */
  var entry = document.createElement("button");
  entry.type = "button";
  entry.className = "md-header__button md-icon aipm-anno-entry";
  entry.title = "打开批注面板";
  entry.setAttribute("aria-label", "打开批注面板");
  entry.setAttribute("aria-expanded", "false");
  entry.setAttribute("data-state", "closed");
  entry.innerHTML = ICON.pen;

  /* 入口是**开关**,不是「只负责开」:面板开着时再点一次即收起。

     但图标**不随开合变**(验收意见):页头那个叉会和面板头部自己的关闭叉在同一屏
     里互相打架,页头始终就是那支笔 —— 开合由 aria-expanded 与面板本身表达。
     助手那边也不需要这个来回:它的 FAB 在面板开着时直接隐藏(.is-hidden),
     而批注入口一直可见,收起这个动作只能由它自己承担。

     状态真的翻转时才写一次:syncChrome() 在拖拽吸附、换形态、开关面板时都会被
     调到,重复写同样的值无害,但没必要。 */
  function syncEntry() {
    var state = open ? "open" : "closed";
    if (entry.getAttribute("data-state") === state) return;
    entry.setAttribute("data-state", state);
    entry.setAttribute("aria-expanded", open ? "true" : "false");
    var label = open ? "收起批注面板" : "打开批注面板";
    entry.title = label;
    entry.setAttribute("aria-label", label);
  }

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
    if (mode !== "sheet" || !els.grip || !els.head) {
      peekH = SHEET_PEEK_MIN;
      return;
    }
    /* peek 高度 = 把手 + 页头 + 一张卡。编辑卡搬进列表之后这里量不到「底部那条
       固定输入区」了 —— 有编辑卡就量它,否则量列表里的第一张,再没有就用占位
       高度,免得 peek 掉到下限、把手也一起沉下去。

       **量之前不把面板切到 peek**。列表是滚动容器,卡片在里面始终按自然高度排版
       (溢出的是列表,不是卡片),所以量得到的东西跟面板当前多高无关;而早先那版
       先 data-snap="peek" 再切回来,中间要读 offsetHeight / getComputedStyle,
       那是一次强制样式与布局 —— 浏览器因此真的提交了 peek 这个中间态,于是吸附
       动画每帧都被「切到 peek、再切回来」重置一次过渡时钟:高度只能一帧蹭一点,
       240ms 的过渡永远走不完(实测每帧 currentTime 都回到 ~17ms)。 */
    var c =
      els.composer ||
      els.list.querySelector(".aipm-anno__item") ||
      els.list.querySelector(".aipm-anno__draft");
    var cardH = 72;
    if (c) {
      var mb = parseFloat(getComputedStyle(c).marginBottom) || 0;
      cardH = c.offsetHeight + mb;
    }
    var h = els.grip.offsetHeight + els.head.offsetHeight + cardH + 1;
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

  /* 上一次真正写进 CSS 变量的那组值。ResizeObserver 在面板做吸附动画时会每帧
     回调一次(列表跟着面板长高),改 CSS 变量要作废整棵文档树的样式计算 ——
     值没变就一个字节都别写。 */
  var appliedMetrics = "";

  function applyMetrics() {
    refreshPeek();
    var m = metrics();
    var sbw = panels ? panels.scrollbarWidth() : 0;
    var key = m.peek + "/" + m.half + "/" + m.expanded + "/" + sbw;
    if (key === appliedMetrics) return;
    appliedMetrics = key;
    var st = document.documentElement.style;
    st.setProperty("--aipm-anno-sheet-peek", m.peek + "px");
    st.setProperty("--aipm-anno-sheet-half", m.half + "px");
    st.setProperty("--aipm-anno-sheet-expanded", m.expanded + "px");
    st.setProperty("--aipm-anno-sbw", sbw + "px");
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
    syncEntry();
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
    /* 遮罩的跟手明暗也一起撤掉:inline opacity 会压过 data-level,
       撤掉的那一帧过渡从头接管,接着吸附动画走。 */
    els.scrim.classList.remove("is-dragging");
    els.scrim.style.opacity = "";
  }

  function markSnapping() {
    clearTimeout(snapTimer);
    panel.classList.add("is-snapping");
    snapTimer = setTimeout(function () {
      panel.classList.remove("is-snapping");
      /* 动画期间跳过的那些 ResizeObserver 回调,在这里补一次:内容若真在动画
         中间变过(卡片增减、编辑卡长高),peek 到这一刻才对得上。 */
      if (mode === "sheet") applyMetrics();
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
    /* 先撤跟手写下那层 inline opacity 再 syncChrome:否则它会压过 data-level,
       遮罩要顶到 clearDragHeight 那一拍才跳变,而不是跟着面板一起淡出。 */
    els.scrim.classList.remove("is-dragging");
    els.scrim.style.opacity = "";
    syncChrome();
    hideToolbar();
    closeVisMenu();
    els.acct.hidden = true;
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
      /* 遮罩跟着手指走:拖动中按跟手高度在 peek/half/expanded 三档之间插值,
         松手后交回 data-level(见 panel-shared 的 SCRIM_AT / snapLerp)。
         拖动中面板还没「提交」停靠点,所以明暗只能由高度推 —— 不能让用户拖到
         二段高度了背景还停在页面优先态。 */
      onDragStart: function () {
        els.scrim.classList.add("is-dragging");
      },
      onDragEnd: function () {
        els.scrim.classList.remove("is-dragging");
      },
      onDragHeight: function (h, m) {
        els.scrim.style.opacity = String(
          panels.snapLerp(panels.ORDER, m, h, panels.SCRIM_AT)
        );
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
    /* 开着 → 收起;没开 → 打开。助手开着时走 claim:注册表先关助手再开批注,
       两步在同一个同步任务里,所以那是「切到批注」而不是「什么都没发生」。 */
    if (open) {
      if (panels) panels.close("annotation");
      else closePanel();
    } else if (panels) {
      panels.claim("annotation");
    } else {
      openPanel();
    }
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
     即从前端根本建不出批注。它一直留到编辑器关闭才清。 */
  var composerSelection = null; // {selectors, quote}
  var activeColor = store.lastColor();
  var activeStyle = store.prefs().lastStyle;
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

  /* 未登录一律只能落本机(服务端那两条路都要 token);登录后按用户在悬浮窗里选的那个
     走,「仅本机」仍然可选 —— 登录了也想把某些东西留在自己机器上是合理诉求。 */
  function defaultVisibility() {
    if (!auth || !auth.isLoggedIn()) return "local";
    if (activeVis === "private") return "private";
    if (activeVis === "local") return "local";
    return "public";
  }

  /** 画法归一:不认识的 id 一律按高亮(与 store 的默认一致)。 */
  function styleOf(anno) {
    var st = anno && anno.style;
    return store.ANNO_STYLES.indexOf(st) >= 0 ? st : store.DEFAULT_STYLE;
  }

  function styleLabel(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i].label;
    return "高亮";
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
      if (isPageComment(anno)) {
        /* 全页评论不锚定正文任何一段文字:不画高亮,也不该被打成「未在正文中
           定位」——它本来就没有位置。 */
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
    orphanIds = {};
    orphans.forEach(function (a) {
      orphanIds[a.id] = true;
    });
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

  /* ================================================================
     列表:分组 / 排序 / 折叠 / 当前编辑器
     ================================================================ */

  /* 面板有两个模式:「批注」锚在正文的某一段上,「评论」针对整个页面。
     两者共用同一个列表、同一套分组,只是筛的东西不同。 */
  var panelMode = "annotations"; // "annotations" | "comments"

  /** annoId → true,由 applyAll() 维护;positionKey() 也读它。 */
  var orphanIds = {};

  function isPageComment(anno) {
    return !!(anno.target && anno.target.scope === "page");
  }

  function inMode(anno) {
    return panelMode === "comments" ? isPageComment(anno) : !isPageComment(anno);
  }

  function groupOf(anno) {
    if (isLocal(anno)) return "local";
    return anno.visibility === "private" ? "private" : "public";
  }

  function groupTitle(key) {
    if (key === "public") return "公开";
    if (key === "private") return "私有(仅自己)";
    return "仅本机";
  }

  function prefKey(prefix, key) {
    return prefix + key.charAt(0).toUpperCase() + key.slice(1);
  }

  /**
   * 排序键:这条批注在正文里的位置(文档序字符偏移)。三级回退 ——
   *
   *  1. 活 Range 最准,但只有「锚得上」的时候才有:resolved 里可能同时躺着孤儿
   *     (applyAll 先写 resolved 再 markRange,那句话已被别人的 mark 占住的那条
   *     两处都在),所以第一级必须先排除 orphanIds;
   *  2. 退回落库时的 TextPositionSelector;
   *  3. 都没有 → Infinity,稳定排序下按插入序沉到最后。智能高亮落下的那些是整段
   *     选中(startContainer 是元素节点,offsetOf 认不出来),它们本来就覆盖整段,
   *     排在哪儿都不影响阅读。
   *
   * collectTextNodes 不能改成过滤 <mark> 内部的文本 —— 那会让所有偏移整体错位。
   */
  function positionKey(anno) {
    if (!orphanIds[anno.id]) {
      var range = resolved[anno.id];
      if (range) {
        var off = offsetOf(
          collectTextNodes(contentRoot()),
          range.startContainer,
          range.startOffset
        );
        if (off >= 0) return off;
      }
    }
    var sels = (anno.target && anno.target.selectors) || [];
    for (var i = 0; i < sels.length; i++) {
      if (sels[i].type === "TextPositionSelector" && typeof sels[i].start === "number") {
        return sels[i].start;
      }
    }
    return Infinity;
  }

  function byPosition(a, b) {
    return positionKey(a) - positionKey(b);
  }

  function tsMs(iso) {
    var t = Date.parse(iso || "");
    return Number.isFinite(t) ? t : 0;
  }

  function repliesOf(anno) {
    return (anno.replies && anno.replies.length) || 0;
  }

  /** 热度 = 点赞数 + 回复数。两者都是「别人对这条的反应」,直接相加即可。 */
  function hotOf(anno) {
    return (anno.likeCount || 0) + repliesOf(anno);
  }

  /**
   * 评论排序。批注**不参与** —— 它们按正文位置排,那是唯一的合理顺序;
   * 给批注排「热度」只会让人找不到刚才看到的那句话。
   * 同分一律按发布时间倒序兜底,免得顺序在两次渲染之间跳。
   */
  function commentComparator(sort) {
    return function (a, b) {
      if (sort === "newest") return tsMs(b.createdAt) - tsMs(a.createdAt);
      if (sort === "mostReplies") {
        return repliesOf(b) - repliesOf(a) || tsMs(b.createdAt) - tsMs(a.createdAt);
      }
      return hotOf(b) - hotOf(a) || tsMs(b.createdAt) - tsMs(a.createdAt);
    };
  }

  /** 评论模式下、且没有编辑器在写时,给一排排序开关。 */
  function sortRow() {
    var prefs = store.prefs();
    var row = document.createElement("div");
    row.className = "aipm-anno__sort";
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", "评论排序");
    var label = document.createElement("span");
    label.className = "aipm-anno__sort-label";
    label.textContent = "排序";
    row.appendChild(label);
    COMMENT_SORTS.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "aipm-anno__sort-btn";
      b.setAttribute("data-sort", s.id);
      b.textContent = s.label;
      b.classList.toggle("is-active", prefs.commentSort === s.id);
      b.addEventListener("click", function () {
        store.setPrefs({ commentSort: s.id });
        render();
      });
      row.appendChild(b);
    });
    return row;
  }

  /** 分组头:左侧箭头折叠(收起条目、标题还留着),右侧眼睛整栏不显示。 */
  function groupHead(key, count, prefs) {
    var collapsed = prefs[prefKey("collapsed", key)] === true;
    var shown = prefs[prefKey("show", key)] !== false;
    var head = document.createElement("div");
    head.className = "aipm-anno__group-head";
    head.setAttribute("data-group", key);
    head.classList.toggle("is-collapsed", collapsed);
    head.classList.toggle("is-off", !shown);

    var fold = document.createElement("button");
    fold.type = "button";
    fold.className = "aipm-anno__group-fold";
    fold.setAttribute("data-action", "fold-group");
    fold.setAttribute("data-group", key);
    fold.setAttribute("aria-expanded", collapsed ? "false" : "true");
    fold.title = collapsed ? "展开这一栏" : "折叠这一栏";
    var caret = document.createElement("span");
    caret.className = "aipm-anno__group-caret";
    caret.innerHTML = ICON.caret;
    fold.appendChild(caret);
    var label = document.createElement("span");
    label.className = "aipm-anno__group-title";
    label.textContent = groupTitle(key);
    fold.appendChild(label);
    var num = document.createElement("span");
    num.className = "aipm-anno__group-count";
    num.textContent = String(count);
    fold.appendChild(num);
    head.appendChild(fold);

    var spacer = document.createElement("span");
    spacer.className = "aipm-anno__spacer";
    head.appendChild(spacer);

    var eye = document.createElement("button");
    eye.type = "button";
    eye.className = "aipm-anno__group-eye";
    eye.setAttribute("data-action", "toggle-group");
    eye.setAttribute("data-group", key);
    eye.setAttribute("aria-pressed", shown ? "true" : "false");
    eye.title = shown ? "这一栏先不显示" : "重新显示这一栏";
    eye.innerHTML = shown ? ICON.eye : ICON.eyeOff;
    head.appendChild(eye);

    return head;
  }

  /** 当前编辑卡该落在哪一组、组内哪个位置。没有编辑器时返回 null。 */
  function draftSlot() {
    if (!editorDraft) return null;
    if (editorDraft.kind === "create") {
      return { group: defaultVisibility(), inline: false, at: null };
    }
    var on = annoById(editorDraft.annoId);
    if (on === null) return null;
    return { group: groupOf(on), inline: true, at: on.id };
  }

  /** 新建卡在组内的位置:就是它选中那段话在正文里的位置,和普通卡片一起排。 */
  function draftKey() {
    if (!editorDraft) return Infinity;
    if (editorDraft.kind !== "create") {
      var on = annoById(editorDraft.annoId);
      return on === null ? Infinity : positionKey(on);
    }
    return positionKey({
      id: editorDraft.draftId,
      target: { selectors: composerSelection ? composerSelection.selectors : [] }
    });
  }

  function render() {
    /* 列表整体重建,上一轮物化出来的编辑卡已经随之消失 —— 先把 els 里那组
       指针清掉,免得后面读到已经脱开的节点。 */
    unmountEditor();
    closePop();

    var all = publicList.concat(privateList).concat(localList);
    var items = all.filter(inMode);
    els.count.textContent = items.length ? String(items.length) : "";
    els.count.hidden = items.length === 0;
    els.list.textContent = "";

    /* 评论模式没有「划词」这个动作,新建得有一颗看得见的按钮。 */
    if (panelMode === "comments") {
      if (editorDraft === null) {
        var newbtn = document.createElement("button");
        newbtn.type = "button";
        newbtn.className = "aipm-anno__newbtn";
        newbtn.setAttribute("data-action", "new-comment");
        newbtn.innerHTML = ICON.edit + "<span>写一条评论</span>";
        newbtn.addEventListener("click", function () {
          startPageComment();
        });
        els.list.appendChild(newbtn);
      }
      els.list.appendChild(sortRow());
    }

    var draft = draftSlot();
    var prefs = store.prefs();
    var commentSort = prefs.commentSort;
    /* 新增评论没有正文位置可依,固定钉在最上方;新批注则按落点插进排序好的列表。 */
    var draftRank =
      panelMode === "comments" ? -Infinity : draft === null || draft.inline ? null : draftKey();

    /* 面板「空不空」只看真正的内容。排序条与「写一条评论」是常驻的 chrome,
       拿 childNodes.length 去判会把「三栏都被眼睛收走」误判成有内容 —— 于是
       一条回来的路都不给(第三轮那道「至少留一栏」的护栏撤掉之后,这是唯一的退路)。 */
    var contentCount = 0;

    var groups = [
      { key: "public", list: publicList },
      { key: "private", list: privateList },
      { key: "local", list: localList }
    ];
    groups.forEach(function (g) {
      // 未定位的那些下面单独成组,别在这里再列一遍(否则同一条批注出现两次,
      // 一条带着「未定位」角标、一条没有)。先滤再判空 —— 只按 g.list.length
      // 判断的话,某个分组若整组都是未定位的,会留下一个空标题挂在那儿。
      var visible = g.list.filter(function (anno) {
        return !orphanIds[anno.id];
      }).filter(inMode);
      visible.sort(panelMode === "comments" ? commentComparator(commentSort) : byPosition);

      var draftHere = draft !== null && !draft.inline && draft.group === g.key;
      var shown = prefs[prefKey("show", g.key)] !== false;
      if (visible.length === 0 && !draftHere) return;
      /* 眼睛关掉的是「闲着的列表」;正在写的那张卡不能被它连同一起藏掉,
         否则编辑器还在内存里、屏幕上却什么都没有。 */
      if (!shown && !draftHere) return;

      els.list.appendChild(groupHead(g.key, visible.length + (draftHere ? 1 : 0), prefs));
      contentCount++;

      /* 编辑器由 render 现场产出(列表每轮整体重建),而且要落在它该在的位置上:
         新批注按它选中那段文字的位置插进排序好的列表,不再钉在分组最前面。 */
      var pending = draftHere ? materializeEditor() : null;
      if (prefs[prefKey("collapsed", g.key)] === true) {
        if (pending !== null) {
          els.list.appendChild(pending);
          contentCount++;
        }
        return;
      }
      var inComments = panelMode === "comments";
      visible.forEach(function (anno) {
        if (pending !== null && (inComments || draftRank <= positionKey(anno))) {
          els.list.appendChild(pending);
          pending = null;
          contentCount++;
        }
        els.list.appendChild(renderItem(anno));
        contentCount++;
      });
      if (pending !== null) {
        els.list.appendChild(pending);
        contentCount++;
      }
    });

    /* 未定位组不进「评论」模式:评论本来就没有位置,列在这里毫无意义。 */
    if (orphans.length > 0 && panelMode === "annotations") {
      var oh = document.createElement("div");
      oh.className = "aipm-anno__group-head is-orphan";
      var ohLabel = document.createElement("span");
      ohLabel.className = "aipm-anno__group-title";
      ohLabel.textContent = "未在正文中定位";
      oh.appendChild(ohLabel);
      var ohNum = document.createElement("span");
      ohNum.className = "aipm-anno__group-count";
      ohNum.textContent = String(orphans.length);
      oh.appendChild(ohNum);
      oh.title = "页面改过之后这些批注找不到原来的位置了;它们没有被删掉";
      els.list.appendChild(oh);
      contentCount++;
      orphans.forEach(function (anno) {
        els.list.appendChild(renderItem(anno, true));
        contentCount++;
      });
    }

    if (contentCount === 0) {
      /* 三栏被眼睛收光之后,面板上不能只剩一句空白 —— 那只眼睛自己也长在被收走
         的标题上。给一条明确的回来的路。 */
      var anyHidden = ["public", "private", "local"].some(function (g) {
        return prefs[prefKey("show", g)] === false;
      });
      if (anyHidden) {
        var restore = document.createElement("button");
        restore.type = "button";
        restore.className = "aipm-anno__newbtn";
        restore.setAttribute("data-action", "show-all");
        restore.innerHTML =
          ICON.eye +
          "<span>" +
          (panelMode === "comments" ? "显示全部评论栏" : "显示全部批注栏") +
          "</span>";
        restore.addEventListener("click", function () {
          store.setPrefs({ showPublic: true, showPrivate: true, showLocal: true });
          render();
        });
        els.list.appendChild(restore);
      } else {
        var empty = document.createElement("p");
        empty.className = "aipm-anno__empty";
        empty.textContent =
          panelMode === "comments"
            ? "还没有人对这一页留下评论。"
            : "选中正文里的一段话就能加批注。";
        els.list.appendChild(empty);
      }
    }

    /* 手机上 peek 的高度按「一张卡」算,而卡片是这里刚建出来的 —— 重建完顺手
       重算一次,否则 peek 会停在上一轮的数值上。refreshPeek 内部对 data-snap 的
       存取在同一个任务里完成,浏览器只画一帧,不会闪。 */
    if (mode === "sheet") applyMetrics();
  }

  /* ---- 卡片上的小浮层:点左上角圆点改「外观」----
     画法与颜色是同一件事的两面(怎么画、用什么色),所以合在一个浮层里,而不是
     在卡片上再排一排按钮 —— 卡片顶栏已经很挤了。 */

  var openPop = null;

  function closePop() {
    if (openPop !== null) {
      if (openPop.node.parentNode) openPop.node.parentNode.removeChild(openPop.node);
      openPop = null;
    }
  }

  function popRow(label, html) {
    return (
      '<div class="aipm-anno__pop-row"><span class="aipm-anno__pop-label">' +
      label +
      "</span>" +
      html +
      "</div>"
    );
  }

  /**
   * 开/关「外观」浮层。`current` 是这条(或这张草稿卡)现在的 {style, color},
   * `apply` 收到 {style?} 或 {color?} 后负责落地 —— 已存的批注走 patchAnnotation,
   * 草稿卡只改内存态。这样同一个浮层两边都能用。
   */
  function togglePop(wrapEl, current, apply) {
    var same = openPop !== null && openPop.wrap === wrapEl;
    closePop();
    if (same) return;
    var pop = document.createElement("div");
    pop.className = "aipm-anno__pop";
    pop.setAttribute("role", "group");
    pop.setAttribute("aria-label", "批注外观");
    pop.innerHTML = popRow("画法", styleHtml()) + popRow("颜色", swatchHtml());
    // styleHtml/swatchHtml 产出的是 .aipm-anno__tb-style 与 .aipm-anno__swatch,
    // 选中态与悬浮窗共用一套 is-active。
    var st = pop.querySelector('[data-style="' + styleOf(current) + '"]');
    if (st) st.classList.add("is-active");
    var sw = pop.querySelector('[data-color="' + (current.color || store.DEFAULT_COLOR) + '"]');
    if (sw) sw.classList.add("is-active");
    pop.addEventListener("click", function (e) {
      var styleBtn = e.target.closest(".aipm-anno__tb-style");
      if (styleBtn) {
        e.stopPropagation();
        var nextStyle = styleBtn.getAttribute("data-style");
        closePop();
        if (nextStyle !== styleOf(current)) apply({ style: nextStyle });
        return;
      }
      var swatch = e.target.closest(".aipm-anno__swatch");
      if (!swatch) return;
      e.stopPropagation();
      var color = swatch.getAttribute("data-color");
      closePop();
      if (color !== (current.color || store.DEFAULT_COLOR)) apply({ color: color });
    });
    wrapEl.appendChild(pop);
    openPop = { wrap: wrapEl, node: pop };
  }

  function renderItem(anno, isOrphan) {
    /* 编辑就在原位置进行:轮到这条时直接把卡片换成编辑态,而不是另起一张。 */
    if (editorDraft && editorDraft.kind === "edit" && editorDraft.annoId === anno.id) {
      var editing = materializeEditor();
      if (editing) return editing;
    }

    var color = anno.color || store.DEFAULT_COLOR;
    var wrap = document.createElement("article");
    wrap.className = "aipm-anno__item";
    wrap.setAttribute("data-anno-id", anno.id);
    wrap.setAttribute("data-color", color);
    wrap.setAttribute("data-style", styleOf(anno));

    var top = document.createElement("div");
    top.className = "aipm-anno__item-top";

    /* 左上角的圆点就是改色入口。它必须是 <button> —— 面板里判断「这次点击算不算
       点在正文上」靠的是 e.target.closest("button"),不是按钮的点击会被当成
       正文点击而清掉选区,「重新锚定」随即失灵。 */
    var dotWrap = document.createElement("span");
    dotWrap.className = "aipm-anno__dotwrap";
    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "aipm-anno__dot";
    dot.setAttribute("data-action", "recolor");
    dot.setAttribute("data-color", color);
    dot.setAttribute("aria-haspopup", "listbox");
    dot.setAttribute("aria-label", "改颜色");
    dot.title = canEdit(anno) ? "改颜色" : "颜色";
    if (canEdit(anno)) {
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePop(dotWrap, anno, function (patch) {
          patchAnnotation(anno, patch);
        });
      });
    } else {
      dot.disabled = true;
      dot.classList.add("is-readonly");
    }
    dotWrap.appendChild(dot);
    top.appendChild(dotWrap);

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

    /* 没有正文的批注(智能高亮落下的那些)不再拿一句占位文案充正文,改成一个
       角标 —— 卡片因此矮一截,列表也清爽。 */
    var bodyText = escapeText(anno.body);
    if (!bodyText) {
      var only = document.createElement("span");
      only.className = "aipm-anno__badge is-quiet";
      only.textContent = "仅高亮";
      top.appendChild(only);
    }
    if (isOrphan) {
      var ob = document.createElement("span");
      ob.className = "aipm-anno__badge";
      ob.textContent = "未定位";
      top.appendChild(ob);
    }
    if (isLocal(anno) && store.serverIdOf(anno.id)) {
      var up = document.createElement("span");
      up.className = "aipm-anno__badge is-quiet";
      up.textContent = "已上传";
      top.appendChild(up);
    }
    if (canEdit(anno)) {
      /* 四个操作各归其位:改色在左上角的圆点、编辑在右上角的铅笔、删除在右上角
         的关闭,回复仍是卡片底部那条文字链。编辑就地展开 —— 点它,这张卡本身
         变成编辑态,不是另起一张。 */
      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "aipm-anno__item-edit";
      edit.setAttribute("data-action", "edit");
      edit.setAttribute("aria-label", "编辑这条批注");
      edit.title = "编辑";
      edit.innerHTML = ICON.edit;
      edit.addEventListener("click", function (e) {
        e.stopPropagation();
        startEdit(anno);
      });
      top.appendChild(edit);

      /* 右上角关闭 = 删除。与「新批注」卡上的关闭同形,一眼能认。 */
      var del = document.createElement("button");
      del.type = "button";
      del.className = "aipm-anno__item-close";
      del.setAttribute("data-action", "delete");
      del.setAttribute("aria-label", "删除这条批注");
      del.title = "删除";
      del.innerHTML = ICON.close;
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        removeAnnotation(anno);
      });
      top.appendChild(del);
    }
    wrap.appendChild(top);

    var quoteText = quoteOf(anno);
    if (quoteText) {
      var q = document.createElement("blockquote");
      q.className = "aipm-anno__item-quote";
      q.textContent = quoteText.length > 140 ? quoteText.slice(0, 140) + "…" : quoteText;
      wrap.appendChild(q);
    }

    if (bodyText) {
      var body = document.createElement("p");
      body.className = "aipm-anno__item-body";
      body.textContent = bodyText;
      wrap.appendChild(body);
    }

    var replies = anno.replies || [];
    var replyingHere =
      editorDraft !== null && editorDraft.kind === "reply" && editorDraft.annoId === anno.id;
    var replyParent = replyingHere ? editorDraft.parentId || null : null;
    if (replies.length > 0 || replyingHere) {
      var box = document.createElement("div");
      box.className = "aipm-anno__replies";
      var byId = {};
      replies.forEach(function (r) {
        byId[r.id] = r;
      });
      /* 缩进深度按「往上还有几层父回复」算。父回复被删之后 parentId 会悬空 ——
         那种按顶层渲染,不然这条会缩进到一个看不见的层级里。深度封顶两层:
         再深的缩进在 400px 宽的面板里就只剩一条竖线了。 */
      var depthOf = function (r) {
        var d = 0;
        var cur = r.parentId ? byId[r.parentId] : null;
        while (cur && d < 3) {
          d++;
          cur = cur.parentId ? byId[cur.parentId] : null;
        }
        return Math.min(d, 2);
      };
      var appendEditor = function () {
        var form = materializeEditor();
        if (form) box.appendChild(form);
      };
      replies.forEach(function (r) {
        var depth = depthOf(r);
        var line = document.createElement("div");
        line.className = "aipm-anno__reply";
        line.setAttribute("data-reply-id", r.id);
        if (depth > 0) line.setAttribute("data-depth", String(depth));
        var author = document.createElement("b");
        author.textContent = (r.author && r.author.login) || "匿名";
        line.appendChild(author);
        line.appendChild(document.createTextNode(" " + r.body));

        var tools = document.createElement("span");
        tools.className = "aipm-anno__reply-tools";
        if (canReply(anno)) {
          tools.appendChild(
            replyTool("回复", function () {
              startReply(anno, r);
            })
          );
        }
        if (canDeleteReply(anno, r)) {
          tools.appendChild(
            replyTool("删除", function () {
              removeReply(anno, r);
            })
          );
        }
        if (tools.childNodes.length > 0) line.appendChild(tools);
        box.appendChild(line);
        // 回这一条 → 输入框就落在这条下面,不是统一堆在末尾
        if (replyingHere && replyParent === r.id) appendEditor();
      });
      if (replyingHere && replyParent === null) appendEditor();
      wrap.appendChild(box);
    }

    var acts = document.createElement("div");
    acts.className = "aipm-anno__item-actions";
    /* 点赞:本机批注没有服务端可言,不显示。 */
    if (!isLocal(anno)) acts.appendChild(likeButton(anno));
    if (canReply(anno)) {
      acts.appendChild(
        actionButton("回复", "reply", function () {
          startReply(anno);
        })
      );
    } else {
      // 未登录看别人的批注:回复要在服务端落库,得先登录
      acts.appendChild(
        actionButton("登录后回复", "reply-login", function () {
          if (auth) auth.loginForDraft(draftForLogin());
        })
      );
    }
    if (isLocal(anno) && !store.serverIdOf(anno.id) && auth && auth.isLoggedIn()) {
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
    if (isOrphan) {
      acts.appendChild(
        actionButton("重新锚定", "reanchor", function () {
          reanchor(anno);
        })
      );
    }
    if (acts.childNodes.length > 0) wrap.appendChild(acts);
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

  /**
   * 能不能回这条。**未登录只能在本机折腾**:本机批注的回复也落本机,服务端批注的
   * 回复要记名,匿名在服务端没有归属可言 —— 这条路只能引导登录。
   */
  function canReply(anno) {
    if (isLocal(anno)) return true;
    return !!(auth && auth.isLoggedIn());
  }

  /** 删回复:回复作者本人,或这条批注的作者(楼主清理自己的楼)。 */
  function canDeleteReply(anno, reply) {
    if (isLocal(anno)) return true;
    if (!auth || !auth.isLoggedIn()) return false;
    var me = auth.user();
    if (me && reply.author && reply.author.githubId === me.githubId) return true;
    return canEdit(anno);
  }

  function replyTool(label, handler) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "aipm-anno__link";
    b.textContent = label;
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      handler();
    });
    return b;
  }

  function likeButton(anno) {
    var liked = anno.likedByMe === true;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "aipm-anno__like";
    b.setAttribute("data-action", "like");
    b.setAttribute("aria-pressed", liked ? "true" : "false");
    b.classList.toggle("is-on", liked);
    b.title = liked ? "取消点赞" : "点赞";
    b.innerHTML = liked ? ICON.heart : ICON.heartOutline;
    var num = document.createElement("span");
    num.textContent = String(anno.likeCount || 0);
    b.appendChild(num);
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleLike(anno);
    });
    return b;
  }

  /**
   * 点赞。**按账号记名**,所以未登录点不了 —— 服务端不知道你是谁,直接引导登录
   * (与选了公开/私有时的处置一致)。登录后 PUT / DELETE 都幂等,连点与重试都不会
   * 把计数点乱。
   */
  function toggleLike(anno) {
    if (!auth || !auth.isLoggedIn()) {
      if (auth) auth.login(location.href);
      return;
    }
    var liked = anno.likedByMe === true;
    store
      .request("/api/annotations/" + encodeURIComponent(anno.id) + "/like", {
        method: liked ? "DELETE" : "PUT",
        token: auth.token()
      })
      .then(function (res) {
        if (res.status === 401) {
          auth.forget();
          return;
        }
        if (!res.ok) {
          setSmartbar("点赞失败:" + ((res.body && res.body.message) || res.status), "warn");
          return;
        }
        /* 就地改这一条,不整页重拉 —— 点个赞把列表滚回顶部很烦 */
        anno.likeCount = res.body.annotation.likeCount;
        anno.likedByMe = res.body.annotation.likedByMe;
        render();
      });
  }

  /** 删一条回复。服务端有专门的 DELETE(走 PATCH 需要作者权限,回的人不一定是作者)。 */
  function removeReply(anno, reply) {
    if (isLocal(anno)) {
      patchAnnotation(anno, {
        replies: (anno.replies || []).filter(function (r) {
          return r.id !== reply.id;
        })
      });
      return;
    }
    if (!auth || !auth.token()) return;
    store
      .request(
        "/api/annotations/" +
          encodeURIComponent(anno.id) +
          "/replies/" +
          encodeURIComponent(reply.id),
        { method: "DELETE", token: auth.token() }
      )
      .then(function (res) {
        if (res.status === 401) {
          auth.forget();
          return;
        }
        if (!res.ok) {
          setSmartbar("删除回复失败:" + ((res.body && res.body.message) || res.status), "warn");
          return;
        }
        invalidate();
        return ensureAnnotationsLoaded();
      });
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

  /** 悬浮窗上的选中态:画法、颜色、可见范围各一组。 */
  function syncToolbar() {
    var i;
    var styles = toolbar.querySelectorAll(".aipm-anno__tb-style");
    for (i = 0; i < styles.length; i++) {
      styles[i].classList.toggle("is-active", styles[i].getAttribute("data-style") === activeStyle);
    }
    var sws = toolbar.querySelectorAll(".aipm-anno__swatch");
    for (i = 0; i < sws.length; i++) {
      sws[i].classList.toggle("is-active", sws[i].getAttribute("data-color") === activeColor);
    }
    var vis = defaultVisibility();
    var chips = toolbar.querySelectorAll(".aipm-anno__tb-vis");
    for (i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("is-active", chips[i].getAttribute("data-vis") === vis);
      /* 未登录时公开/私有不是禁用,而是「点了去登录」—— 禁用会让人以为这功能没了。
         「仅本机」不需要登录,不该跟着挂锁;三片都挂锁会让人以为一条都写不了。 */
      chips[i].classList.toggle(
        "is-locked",
        !(auth && auth.isLoggedIn()) && chips[i].getAttribute("data-vis") !== "local"
      );
    }
  }

  function showToolbar(range) {
    var rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    syncToolbar();
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
    if (e.target.closest(".aipm-anno__tb-cancel")) {
      hideToolbar();
      return;
    }
    var style = e.target.closest(".aipm-anno__tb-style");
    if (style) {
      activeStyle = style.getAttribute("data-style");
      store.setPrefs({ lastStyle: activeStyle });
      syncToolbar();
      return;
    }
    var vis = e.target.closest(".aipm-anno__tb-vis");
    if (vis) {
      var pick = vis.getAttribute("data-vis");
      if ((pick === "public" || pick === "private") && !(auth && auth.isLoggedIn())) {
        // 未登录只能落本机 —— 选了公开/私有就去登录,草稿扛过往返
        if (auth) auth.loginForDraft(draftForLogin());
        return;
      }
      activeVis = pick;
      syncToolbar();
      return;
    }
    var swatch = e.target.closest(".aipm-anno__swatch");
    if (swatch) {
      /* 选颜色 = 直接落这条批注(用当前选中的画法与范围)。这是「划词 → 挑个颜色」
         这条最短路径,不该再要求点一次确认。想先定画法与范围就先点它们,再挑色。 */
      activeColor = swatch.getAttribute("data-color");
      store.setLastColor(activeColor);
      startCreate();
      return;
    }
    if (e.target.closest(".aipm-anno__tb-annotate")) {
      startCreate();
    }
  });

  /* ================================================================
     编辑卡
     ----------------------------------------------------------------
     新建 / 编辑 / 回复 三种编辑器共用一套控件,并且都长在列表里 —— render()
     每次整体重建列表,所以编辑器只能由它现场产出,不能像从前那样在面板底部放
     一个常驻表单(一重建就被清掉)。

     els 里那组 composer/draft/input/... 是「当前编辑卡」的指针,由 mountEditor()
     在每次重建时刷新,没有编辑器时一律为 null。这样其余读 els.* 的地方(提示、
     草稿、OAuth 回来后恢复)不必跟着改成参数传递。
     ================================================================ */

  /* 编辑器的唯一真相是 editorDraft({kind, annoId, quote, body, page, draftId})。 */

  /* 新建卡的假 id:它不是任何一条真批注,但仍然要参与排序(落点就是刚选中那段
     文字的位置,见 draftKey)。 */
  var DRAFT_ID = "__draft__";

  function mountEditor(nodes) {
    // 回复框没有卡片那套控件,缺的一律落成 null —— syncComposer 见 els.draft 为
    // 空就整体跳过,其余读 els.input/hint/save 的地方照常工作。
    els.composer = nodes.form;
    els.draft = nodes.card || null;
    els.draftDot = nodes.dot || null;
    els.draftMeta = nodes.meta || null;
    els.quote = nodes.quote || null;
    els.swatches = nodes.swatches || null;
    els.visbtn = nodes.visbtn || null;
    els.vislist = nodes.vislist || null;
    els.input = nodes.input;
    els.hint = nodes.hint;
    els.cancel = nodes.cancel;
    els.save = nodes.save;
    syncComposer();
  }

  /* 只清节点指针,不清 editorDraft —— 列表每重建一次就调一遍,状态得留着。 */
  function unmountEditor() {
    els.composer = els.draft = els.draftDot = els.draftMeta = null;
    els.quote = els.swatches = els.visbtn = els.vislist = null;
    els.input = els.hint = els.cancel = els.save = null;
  }

  /** 把当前编辑器物化成 DOM 并挂上事件。由 render() 调用,每轮至多一次。 */
  function materializeEditor() {
    if (editorDraft === null) return null;
    var nodes =
      editorDraft.kind === "reply" ? buildReplyEditor(editorDraft) : buildEditor(editorDraft);
    mountEditor(nodes);
    wireEditor(nodes);
    return nodes.form;
  }

  /**
   * 回复框。与新批注卡**故意不同形**:颜色、画法、可见范围都是「这条批注自己」
   * 的属性,回复继承所在批注的,不该在回复框里再问一遍。所以它就是个朴素的小输入框
   * —— 一眼能看出「这是在回话」,而不是「这是在新建一条批注」。
   */
  function buildReplyEditor(opts) {
    var form = document.createElement("form");
    form.className = "aipm-anno__replybox";
    form.setAttribute("data-editor", "reply");
    form.noValidate = true;

    var input = document.createElement("textarea");
    input.className = "aipm-anno__input aipm-anno__input--reply";
    input.rows = 2;
    input.setAttribute("aria-label", "回复正文");
    input.placeholder = opts.placeholder || "写下回复…";
    form.appendChild(input);

    var hint = document.createElement("div");
    hint.className = "aipm-anno__hint";
    hint.hidden = true;
    form.appendChild(hint);

    var actions = document.createElement("div");
    actions.className = "aipm-anno__replybox-actions";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "aipm-anno__cancel";
    cancel.textContent = "取消";
    actions.appendChild(cancel);
    var save = document.createElement("button");
    save.type = "submit";
    save.className = "aipm-anno__save";
    save.textContent = "回复";
    actions.appendChild(save);
    form.appendChild(actions);

    return { form: form, card: null, input: input, hint: hint, cancel: cancel, save: save };
  }

  /** 可见范围选择器:右半颗分体按钮的菜单。 */
  function buildVisPicker() {
    var root = document.createElement("div");
    root.className = "aipm-anno__vismenu";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "aipm-anno__visbtn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "可见范围");
    btn.title = "可见范围";
    btn.innerHTML = ICON.caret;
    root.appendChild(btn);
    var list = document.createElement("div");
    list.className = "aipm-anno__vislist";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    // 纯静态文案,不走 innerHTML 拼接任何外部数据
    list.innerHTML =
      '<button type="button" role="option" data-vis="public">公开<span>任何访客不登录也能读到</span></button>' +
      '<button type="button" role="option" data-vis="private">私有<span>只有你自己登录后能看到</span></button>' +
      '<button type="button" role="option" data-vis="local">仅本机<span>只存在这台设备上</span></button>';
    root.appendChild(list);
    return { root: root, btn: btn, list: list };
  }

  /**
   * 造一张编辑卡。与列表项共用 .aipm-anno__item 的骨架(见 CSS),所以「新批注」
   * 与「已有批注」的高度与排版一致。
   */
  function buildEditor(opts) {
    var kind = opts.kind;
    var form = document.createElement("form");
    form.className = "aipm-anno__composer";
    form.setAttribute("data-editor", kind);
    form.noValidate = true;

    var card = document.createElement("article");
    card.className = "aipm-anno__draft";
    card.setAttribute("data-color", activeColor);
    card.setAttribute("data-style", activeStyle);
    form.appendChild(card);

    var top = document.createElement("div");
    top.className = "aipm-anno__item-top";
    /* 外面这层 wrap 只负责给浮层当定位锚(与已存卡片同构) */
    var dotWrap = document.createElement("span");
    dotWrap.className = "aipm-anno__dotwrap";
    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "aipm-anno__dot";
    dot.setAttribute("data-color", activeColor);
    dot.setAttribute("aria-haspopup", "group");
    dot.setAttribute("aria-label", "画法与颜色");
    dot.title = "画法与颜色";
    dot.addEventListener("click", function (e) {
      e.stopPropagation();
      togglePop(dotWrap, { style: activeStyle, color: activeColor }, function (patch) {
        if (patch.style) {
          activeStyle = patch.style;
          store.setPrefs({ lastStyle: activeStyle });
        }
        if (patch.color) {
          activeColor = patch.color;
          store.setLastColor(activeColor);
        }
        syncComposer();
      });
    });
    dotWrap.appendChild(dot);
    top.appendChild(dotWrap);
    var meta = document.createElement("span");
    meta.className = "aipm-anno__meta";
    top.appendChild(meta);
    var spacer = document.createElement("span");
    spacer.className = "aipm-anno__spacer";
    top.appendChild(spacer);
    var badge = document.createElement("span");
    badge.className = "aipm-anno__badge";
    badge.textContent = kind === "edit" ? "编辑中" : kind === "reply" ? "回复" : "新批注";
    top.appendChild(badge);
    card.appendChild(top);

    var quote = null;
    if (opts.quote) {
      quote = document.createElement("blockquote");
      quote.className = "aipm-anno__quote";
      quote.textContent = String(opts.quote).slice(0, 200);
      card.appendChild(quote);
    }

    var input = document.createElement("textarea");
    input.className = "aipm-anno__input";
    input.rows = 2;
    input.setAttribute("aria-label", "批注正文");
    input.placeholder = kind === "reply" ? "写下回复…" : "写点什么(可留空,只做高亮)…";
    input.value = opts.body || "";
    card.appendChild(input);

    var hint = document.createElement("div");
    hint.className = "aipm-anno__hint";
    hint.hidden = true;
    card.appendChild(hint);

    var actions = document.createElement("div");
    actions.className = "aipm-anno__actions";

    var swatches = document.createElement("div");
    swatches.className = "aipm-anno__swatches";
    swatches.setAttribute("role", "radiogroup");
    swatches.setAttribute("aria-label", "高亮颜色");
    swatches.innerHTML = swatchHtml();
    actions.appendChild(swatches);

    var gap = document.createElement("span");
    gap.className = "aipm-anno__spacer";
    actions.appendChild(gap);

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "aipm-anno__cancel";
    cancel.textContent = "取消";
    actions.appendChild(cancel);

    var save = document.createElement("button");
    save.type = "submit";
    save.className = "aipm-anno__save";
    save.textContent = "保存";
    actions.appendChild(save);

    var vis = buildVisPicker();
    actions.appendChild(vis.root);
    card.appendChild(actions);

    return {
      form: form, card: card, dot: dot, meta: meta, quote: quote,
      input: input, hint: hint, actions: actions,
      swatches: swatches, cancel: cancel, save: save,
      visbtn: vis.btn, vislist: vis.list
    };
  }

  /** 挂事件。编辑器每次重建都要重新挂,所以直接绑在新建出来的节点上。 */
  function wireEditor(nodes) {
    nodes.form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      submitEditor();
    });
    nodes.cancel.addEventListener("click", function () {
      closeEditor();
    });
    if (nodes.swatches) {
      nodes.swatches.addEventListener("click", function (e) {
        var swatch = e.target.closest(".aipm-anno__swatch");
        if (!swatch) return;
        activeColor = swatch.getAttribute("data-color");
        store.setLastColor(activeColor);
        setHint("");
        syncComposer();
      });
    }
    if (nodes.visbtn) {
      nodes.visbtn.addEventListener("click", function () {
        if (nodes.vislist.hidden) openVisMenu(nodes);
        else closeVisMenu(nodes);
      });
    }
    if (!els.vislist) return;
    els.vislist.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-vis]");
      if (!b) return;
      var vis = b.getAttribute("data-vis");
      if ((vis === "public" || vis === "private") && !(auth && auth.isLoggedIn())) {
        closeVisMenu(nodes);
        if (auth) auth.loginForDraft(draftForLogin());
        return;
      }
      activeVis = vis;
      closeVisMenu(nodes);
      syncComposer();
    });
  }

  function openVisMenu(nodes) {
    var list = nodes ? nodes.vislist : els.vislist;
    var btn = nodes ? nodes.visbtn : els.visbtn;
    if (!list || !btn) return;
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }
  function closeVisMenu(nodes) {
    var list = nodes ? nodes.vislist : els.vislist;
    var btn = nodes ? nodes.visbtn : els.visbtn;
    if (!list || !btn) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  /* ---- 三种进入方式 ---- */

  function startCreate() {
    if (!pendingSelection) return;
    composerSelection = {
      selectors: pendingSelection.selectors,
      quote: pendingSelection.range.toString()
    };
    /* 在「评论」视图里划词加批注:先把视图切回「批注」。否则这条新建的批注落在
       一个只列整页评论的列表里 —— 卡片会被筛掉,用户看到的就是「点了没反应」。 */
    if (panelMode === "comments") {
      panelMode = "annotations";
      syncMode();
    }
    beginEditor({ kind: "create", quote: composerSelection.quote });
  }

  /** 全页评论:不需要选区,整条针对这一页。 */
  function startPageComment() {
    composerSelection = null;
    beginEditor({ kind: "create", page: true });
  }

  function startEdit(anno) {
    composerSelection = null;
    beginEditor({ kind: "edit", annoId: anno.id, quote: quoteOf(anno) });
  }

  /** reply 非空 = 回复某一条回复;为空 = 回复这条批注。 */
  function startReply(anno, reply) {
    composerSelection = null;
    var who =
      (reply && reply.author && reply.author.login) ||
      (anno.author && anno.author.login) ||
      "匿名";
    beginEditor({
      kind: "reply",
      annoId: anno.id,
      parentId: reply ? reply.id : null,
      placeholder: "回复 " + who + "…"
    });
  }

  function beginEditor(opts) {
    var kind = opts.kind;
    var annoId = opts.annoId || null;
    var body = opts.body || "";
    if (kind === "edit") {
      var target = annoById(annoId);
      body = target ? target.body || "" : "";
      activeColor = (target && target.color) || activeColor;
      activeStyle = target ? styleOf(target) : activeStyle;
    }
    hideToolbar();
    if (panels) panels.claim("annotation");
    else openPanel();
    // 移动端:划词之后是要写字的,抽屉停在 peek 那一条上没法写 —— 直接展开到第三段。
    if (mode === "sheet") setSnap("expanded", false);
    if (kind === "edit" || kind === "reply") {
      closePop();
    }
    editorDraft = {
      kind: kind,
      annoId: annoId,
      parentId: opts.parentId || null,
      quote: opts.quote || "",
      body: body,
      placeholder: opts.placeholder || "",
      page: opts.page === true,
      draftId: DRAFT_ID
    };
    render();
    if (els.input) els.input.focus();
  }

  /** 编辑器还没被 render() 物化之前的暂存态。 */
  var editorDraft = null;

  function closeEditor() {
    editorDraft = null;
    composerSelection = null;
    unmountEditor();
    render();
  }

  /**
   * 同步当前编辑卡的外观。色板与可见范围改了就调它 —— 只动这张卡,不重建列表,
   * 否则每点一次颜色输入框都会失焦。
   */
  function syncComposer() {
    syncAccountButton();
    if (!els.draft) return;
    var swatches = els.swatches.querySelectorAll(".aipm-anno__swatch");
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].classList.toggle(
        "is-active",
        swatches[i].getAttribute("data-color") === activeColor
      );
    }
    var vis = defaultVisibility();
    var label = visLabel({ visibility: vis });
    var loggedIn = auth ? auth.isLoggedIn() : false;
    var me = loggedIn && auth.user() ? auth.user().login : "";
    els.draft.setAttribute("data-color", activeColor);
    els.draft.setAttribute("data-style", activeStyle);
    els.draftDot.setAttribute("data-color", activeColor);
    els.draftMeta.textContent = (me || "本机") + " · " + label.text;
    els.draftMeta.setAttribute("data-vis", label.cls);
    var opts = els.vislist.querySelectorAll("button[data-vis]");
    for (var j = 0; j < opts.length; j++) {
      opts[j].classList.toggle("is-active", opts[j].getAttribute("data-vis") === vis);
    }
  }

  /** 账号按钮:未登录是登录图标,登录后是圆形头像。 */
  function syncAccountButton() {
    if (!els.account) return;
    var loggedIn = auth ? auth.isLoggedIn() : false;
    var me = loggedIn && auth.user() ? auth.user() : null;
    els.account.classList.toggle("is-logged-in", loggedIn);
    els.account.title = me ? me.login + "(已登录)" : "用 GitHub 登录";
    els.account.setAttribute("aria-label", me ? "账号:" + me.login : "用 GitHub 登录");
    els.acctName.textContent = me ? me.login : "";
    if (!me) {
      els.account.innerHTML = ICON.login;
      els.account.classList.remove("has-avatar");
      return;
    }
    els.account.classList.add("has-avatar");
    els.account.innerHTML = "";
    if (me.avatarUrl) {
      var img = document.createElement("img");
      img.className = "aipm-anno__avatar";
      img.src = me.avatarUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      els.account.appendChild(img);
    } else {
      // 服务端不保证给头像(author 里的 avatarUrl 是可选的),退回首字母。
      var initial = document.createElement("span");
      initial.className = "aipm-anno__avatar aipm-anno__avatar--letter";
      initial.textContent = String(me.login || "?").charAt(0).toUpperCase();
      els.account.appendChild(initial);
    }
  }

  function setHint(text) {
    if (!els.hint) return;
    if (!text) {
      els.hint.hidden = true;
      els.hint.textContent = "";
      return;
    }
    els.hint.hidden = false;
    els.hint.textContent = text;
  }

  /* 按钮上的字随编辑器而不同:新批注卡是「保存」,回复框是「回复」—— 忙碌时统一
     换成「处理中…」,回落后恢复它自己那个词,别把回复框写成「保存」。 */
  function setBusy(v) {
    busy = v;
    if (!els.save) return;
    els.save.disabled = v;
    if (v) {
      if (!els.save.hasAttribute("data-label")) {
        els.save.setAttribute("data-label", els.save.textContent);
      }
      els.save.textContent = "处理中…";
      return;
    }
    els.save.textContent = els.save.getAttribute("data-label") || "保存";
  }

  /**
   * 落库。三态的落点是三套不同的路径 —— 这是整个文件里唯一做选择的地方,
   * 面板其余部分只认「一条批注」。看不到任何把「仅本机」POST 出去的旁路。
   */
  /**
   * 提交当前编辑器。三种形态在这里分流 ——
   * 新建(含全页评论)/ 编辑 / 回复,各自只碰自己该碰的东西。
   */
  function submitEditor() {
    if (editorDraft === null) return;
    var kind = editorDraft.kind;
    var body = els.input ? els.input.value.trim() : "";

    if (kind === "reply") {
      var on = annoById(editorDraft.annoId);
      if (on === null) {
        closeEditor();
        return;
      }
      if (!body) {
        setHint("回复不能是空的。");
        return;
      }
      setBusy(true);
      postReply(on, body, editorDraft.parentId).then(function (ok) {
        setBusy(false);
        if (ok) closeEditor();
      });
      return;
    }

    if (kind === "edit") {
      var target = annoById(editorDraft.annoId);
      if (target === null) {
        closeEditor();
        return;
      }
      /* 本机批注改成公开/私有,意思就是「连这次编辑一起上传」。先落这次编辑,
         再走已有的上传通路 —— 直接上传会把刚改的内容丢掉。 */
      if (isLocal(target) && defaultVisibility() !== "local") {
        store.localUpdate(target.page, target.id, {
          body: body,
          color: activeColor,
          style: activeStyle
        });
        var updated = annoById(target.id);
        closeEditor();
        uploadLocal(updated || target, defaultVisibility());
        return;
      }
      var patch = { body: body, color: activeColor, style: activeStyle };
      /* 服务端批注可以直接改可见性(公开 ↔ 私有)。 */
      if (!isLocal(target) && defaultVisibility() !== target.visibility) {
        patch.visibility = defaultVisibility();
      }
      setBusy(true);
      patchAnnotation(target, patch).then(function (ok) {
        setBusy(false);
        if (ok) closeEditor();
      });
      return;
    }

    var isPage = editorDraft.page === true;
    var visibility = defaultVisibility();
    var selectors = composerSelection ? composerSelection.selectors : [];
    if (!isPage && selectors.length === 0) {
      setHint("先在正文里选中一段话,或者把标题切到「评论」对整页说话。");
      return;
    }
    setBusy(true);
    submitAnnotation(selectors, body, visibility, isPage).then(function (ok) {
      setBusy(false);
      if (ok) closeEditor();
    });
  }

  /**
   * 落一条回复。
   *
   * 服务端走 `POST /api/annotations/:id/replies` —— **不是** PATCH 的 replies:
   * 那条是「改内容仅作者」,回的人不一定是作者(而回复的定义就是别人回你)。
   * 本机批注的回复只落 localStorage。
   */
  function postReply(anno, body, parentId) {
    if (isLocal(anno)) {
      var replies = (anno.replies || []).slice();
      var now = new Date().toISOString();
      var reply = {
        id: store.uid(),
        body: body,
        author: { githubId: 0, login: auth && auth.user() ? auth.user().login : "本机" },
        createdAt: now,
        updatedAt: now
      };
      if (parentId) reply.parentId = parentId;
      replies.push(reply);
      store.localUpdate(anno.page, anno.id, { replies: replies });
      refreshLocal();
      return Promise.resolve(true);
    }
    if (!auth || !auth.token()) {
      setHint("登录后才能回复别人的批注。");
      return Promise.resolve(false);
    }
    return store
      .request("/api/annotations/" + encodeURIComponent(anno.id) + "/replies", {
        method: "POST",
        token: auth.token(),
        body: { body: body, parentId: parentId || undefined }
      })
      .then(function (res) {
        if (res.status === 401) {
          auth.forget();
          setHint("登录已过期,请重新登录。");
          return false;
        }
        if (!res.ok) {
          setHint("回复失败:" + ((res.body && res.body.message) || res.status));
          return false;
        }
        invalidate();
        return ensureAnnotationsLoaded().then(function () {
          return true;
        });
      });
  }

  /**
   * 新建一条(本机或服务端)。pageScope 为真 = 全页评论,此时 selectors 为空数组,
   * target 上带 scope:'page' 供服务端辨认。
   */
  function submitAnnotation(selectors, body, visibility, pageScope) {
    var page = pagePath();
    var now = new Date().toISOString();
    var target = pageScope
      ? { selectors: selectors, scope: "page" }
      : { selectors: selectors };

    if (visibility === "local") {
      var anno = {
        id: store.uid(),
        page: page,
        visibility: "local",
        color: activeColor,
        style: activeStyle,
        body: body,
        author: { githubId: 0, login: auth && auth.user() ? auth.user().login : "本机" },
        target: target,
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
      return Promise.resolve(true);
    }

    if (!auth || !auth.token()) {
      setHint("登录已过期,请重新登录。");
      return Promise.resolve(false);
    }
    return store
      .request("/api/annotations", {
        method: "POST",
        token: auth.token(),
        body: {
          page: page,
          body: body,
          color: activeColor,
          style: activeStyle,
          visibility: visibility,
          target: target
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
      if (el.querySelector("mark.aipm-anno-mark")) continue;
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

    /* 评论模式没有正文可划;按钮虽然已经藏起来,键盘/脚本仍可能够到它。 */
    if (panelMode !== "annotations") return;    var now = Date.now();
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

  /** 本页由智能高亮落下的「仅本机」批注(带 origin 标记,刷新后仍认得出)。 */
  function smartAnnos() {
    return store.localList(pagePath()).filter(function (a) {
      return a && a.visibility === "local" && a.origin === "smart";
    });
  }

  /**
   * 块内是否已有高亮。用它挡住重复落库 —— 之前 extractBlocks 里那句
   * `el.closest("mark...")` 是往上找,块不可能在 mark 里,从未命中过,于是
   * 已高亮的段落会被反复送去判分、再次点击就重复落库。
   */
  function blockMarked(block) {
    if (!block || !block.range) return true;
    var el = block.range.startContainer;
    if (el && el.nodeType !== 1) el = el.parentNode;
    return !!(el && el.querySelector && el.querySelector("mark.aipm-anno-mark"));
  }

  /** 还没有落过高亮的那部分建议(已高亮的不再重复出现)。 */
  function freshSuggestions(payload) {
    var byId = {};
    (payload.blocks || []).forEach(function (b) {
      byId[b.id] = b;
    });
    return (payload.suggestions || []).filter(function (s) {
      var block = byId[s.id];
      return block && !blockMarked(block);
    });
  }

  /**
   * 智能高亮条只有两态:还能落 → 「全部高亮(N)」,已经落过 → 「全部关闭(N)」。
   * 建议不在这里逐条罗列(用户验收意见:一条条列出来太吵),落库后它们就是
   * 面板列表里普通的「仅本机」条目,和手写的批注一样可以编辑、改色、上传。
   */
  function renderSuggestions(payload) {
    els.smartbar.hidden = false;
    els.smartbar.setAttribute("data-kind", "result");
    els.smartbar.textContent = "";

    var head = document.createElement("div");
    head.className = "aipm-anno__smart-head";
    var parts = ["智能高亮 · 来源 " + sourceLabel(payload.judge)];
    if (payload.fallbackFrom) parts.push("(由 " + sourceLabel(payload.fallbackFrom) + " 回退)");
    if (payload.model) parts.push(payload.model);
    if (payload.cached) parts.push("缓存");
    head.textContent = parts.join(" ");
    els.smartbar.appendChild(head);

    var applied = smartAnnos();
    var fresh = freshSuggestions(payload);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "aipm-anno__smart-toggle";

    if (applied.length > 0) {
      btn.textContent = "全部关闭(" + applied.length + ")";
      btn.addEventListener("click", function () {
        revertSmart(payload);
      });
    } else if (fresh.length > 0) {
      btn.textContent = "全部高亮(" + fresh.length + ")";
      btn.addEventListener("click", function () {
        applySmart(payload);
      });
    } else {
      btn.disabled = true;
      btn.textContent = (payload.suggestions || []).length
        ? "本页已全部高亮"
        : "本页没有值得高亮的地方";
    }
    els.smartbar.appendChild(btn);

    if (payload.degraded && payload.degraded.length) {
      var note = document.createElement("span");
      note.className = "aipm-anno__smart-note";
      note.textContent = payload.degraded.length + " 段未判定";
      note.title = "这些段落是代码、导航或已超出本次预算,没有给出建议。";
      els.smartbar.appendChild(note);
    }
  }

  /** 全开:一次性把余下的建议落成「仅本机」。已高亮的块跳过,不重复落。 */
  function applySmart(payload) {
    var byId = {};
    (payload.blocks || []).forEach(function (b) {
      byId[b.id] = b;
    });
    var fresh = freshSuggestions(payload);
    var page = pagePath();
    var now = new Date().toISOString();
    var who = auth && auth.isLoggedIn() && auth.user() ? auth.user().login : "本机";
    var added = 0;
    fresh.forEach(function (s) {
      var block = byId[s.id];
      if (!block || !block.range || blockMarked(block)) return;
      try {
        store.localAdd({
          id: store.uid(),
          page: page,
          visibility: "local",
          color: s.color || store.DEFAULT_COLOR,
          body: "",
          origin: "smart",
          author: { githubId: 0, login: who },
          target: { selectors: computeSelectors(block.range) },
          replies: [],
          createdAt: now,
          updatedAt: now
        });
        added++;
      } catch (err) {
        setHint(err.message);
      }
    });
    refreshLocal();
    renderSuggestions(payload);
  }

  /** 全关:把本页由智能高亮落下的批注全部撤掉。手写的批注不受影响。 */
  function revertSmart(payload) {
    smartAnnos().forEach(function (a) {
      store.localRemove(a.page, a.id);
    });
    refreshLocal();
    renderSuggestions(payload);
  }

  /* ================================================================
     面板外壳:模式切换 / 账号 / 分组折叠与显示
     ================================================================ */

  /** 标题就是模式开关 —— 它写着什么,列表里就是什么。 */
  function syncMode() {
    var isComments = panelMode === "comments";
    els.title.textContent = isComments ? "评论" : "批注";
    els.title.title = isComments ? "切回批注(锚在正文某一段上)" : "切到评论(对整页说话)";
    els.title.setAttribute("aria-pressed", isComments ? "true" : "false");
    /* 智能高亮找的是「正文里值得划线的地方」,评论模式下没有正文可划。 */
    els.smart.hidden = isComments;
    if (isComments) setSmartbar("", "");
  }

  els.title.addEventListener("click", function () {
    panelMode = panelMode === "comments" ? "annotations" : "comments";
    // 换模式等于换了一份列表,正在写的那张卡不该跨模式跟过去
    editorDraft = null;
    composerSelection = null;
    syncMode();
    render();
  });

  /* 分组头:箭头折叠、眼睛整栏不显示。两件事都写进 prefs,刷新后保持。 */
  els.list.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button[data-action]") : null;
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var group = btn.getAttribute("data-group");
    if (!group) return;
    var prefs = store.prefs();
    if (action === "fold-group") {
      var foldPatch = {};
      foldPatch[prefKey("collapsed", group)] = !prefs[prefKey("collapsed", group)];
      store.setPrefs(foldPatch);
      render();
      return;
    }
    if (action === "toggle-group") {
      var showPatch = {};
      showPatch[prefKey("show", group)] = prefs[prefKey("show", group)] === false;
      /* 随意显隐,不做「至少留一栏」的拦截:三栏都收起来时面板底部有一条
         「显示全部」的恢复入口(见 render 的空列表分支),回得来。 */
      store.setPrefs(showPatch);
      render();
    }
  });

  /* 账号按钮:登录态的唯一入口,夹在智能高亮与关闭之间 */
  els.account.addEventListener("click", function () {
    if (auth && auth.isLoggedIn()) {
      els.acct.hidden = !els.acct.hidden;
      return;
    }
    if (auth) auth.loginForDraft(draftForLogin());
  });
  els.logout.addEventListener("click", function () {
    if (!auth) return;
    els.acct.hidden = true;
    auth.logout().then(function () {
      invalidate();
      return ensureAnnotationsLoaded();
    });
  });

  /* 点在别处:收起可见范围菜单与改色浮层。这两个都是附在卡片上的小浮层,
     没有自己的遮罩,靠这一处统一收。 */
  document.addEventListener("mousedown", function (e) {
    if (!e.target || !e.target.closest) return;
    if (els.vislist && !els.vislist.hidden && !e.target.closest(".aipm-anno__vismenu")) {
      closeVisMenu();
    }
    if (openPop !== null && !e.target.closest(".aipm-anno__dotwrap")) closePop();
  });

  /**
   * 未登录的人选了「公开 / 私有」→ 引导登录。跳转是一次完整的页面加载,所以
   * 手上这份草稿必须存进 localStorage 才能扛过 OAuth 整轮往返。
   */
  function draftForLogin() {
    if (editorDraft === null && composerSelection === null && pendingSelection === null) {
      return null;
    }
    var locked =
      composerSelection !== null
        ? composerSelection
        : pendingSelection !== null
          ? { selectors: pendingSelection.selectors, quote: pendingSelection.range.toString() }
          : null;
    return {
      page: pagePath(),
      color: activeColor,
      style: activeStyle,
      body: els.input ? els.input.value : "",
      visibility: activeVis === "private" ? "private" : "public",
      /* 正在编辑/回复哪一条:登录回来后要接着编那一条,不能当成新建 ——
         当成新建的话,草稿里没有选区,用户回来只会撞上「先在正文里选中一段话」。 */
      resumeKind: editorDraft ? editorDraft.kind : "create",
      resumeId: editorDraft ? editorDraft.annoId : null,
      selectors: locked === null ? null : locked.selectors,
      quote: locked === null ? "" : locked.quote
    };
  }

  /** OAuth 往返回来:草稿还在就恢复,并把待发布的那条补发出去。 */
  function maybeRestoreDraft() {
    var draft = store.peekDraft();
    if (!draft || draft.page !== pagePath()) return;
    if (!open && panels) panels.claim("annotation");
    else if (!open) openPanel();
    if (mode === "sheet") setSnap("expanded", false);
    var resume = null;
    if (draft.resumeId) {
      resume = annoById(draft.resumeId);
      if (resume === null) {
        // 那一条已经不在列表里了(换页 / 被删),草稿无从接续
        store.clearDraft();
        return;
      }
    }
    editorDraft = {
      kind: resume === null ? "create" : draft.resumeKind || "edit",
      annoId: resume === null ? null : resume.id,
      parentId: null,
      placeholder: "",
      quote: draft.quote || "",
      body: draft.body || "",
      page: false,
      draftId: DRAFT_ID
    };
    composerSelection = draft.selectors
      ? { selectors: draft.selectors, quote: draft.quote || "" }
      : null;
    activeColor = draft.color || activeColor;
    activeStyle = store.ANNO_STYLES.indexOf(draft.style) >= 0 ? draft.style : activeStyle;
    activeVis = draft.visibility || null;
    render();
    if (els.input) els.input.focus();
    if (auth && auth.isLoggedIn() && draft.selectors && editorDraft.kind === "create") {
      // 登录回来了:按草稿把那条批注补发出去
      submitAnnotation(draft.selectors, draft.body, draft.visibility, false).then(function (ok) {
        if (!ok) return;
        store.clearDraft();
        closeEditor();
        setSmartbar("已按登录前的草稿保存:" + (draft.visibility === "private" ? "私有" : "公开"), "info");
      });
    }
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
      if (mode !== "sheet") return;
      /* 动画期间列表每帧都在变高变矮,这个回调于是每帧来一次;此时量出来的 peek
         没有任何新信息,却要在动画中间强制一次布局。等吸附落定再对一次账
         (见 markSnapping 的收尾),中间这些直接跳过。 */
      if (panel.classList.contains("is-dragging")) return;
      if (panel.classList.contains("is-snapping")) return;
      applyMetrics();
    }).observe(els.list);
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
  syncMode();
  syncComposer();
  applyMode();
})();
