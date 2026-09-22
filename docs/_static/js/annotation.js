/*
  AI-PM 批注面板(annotation.js,2026-09-20)

  取代原来嵌入的 hypothes.is 客户端:选中正文 → 高亮 + 写批注 + 回复/编辑/删除,
  高亮多色,并可选调用智能高亮让模型建议「哪里该高亮、用什么颜色」。

  面板有两个模式,由页头标题切换:
  - **批注**锚在正文的某一段上,列表按该段在正文里的位置排序;
  - **评论**针对整个页面(target.scope = "page"),不锚定任何文字,因此画不出
    高亮、也不会进「未在正文中定位」;列表按「最热 / 最新」排。
  两者共用同一份列表、同一套「公开 / 私有 / 仅本机」分栏;分栏可折叠,也可整栏
  不显示(两种状态都记在 prefs 里)。

  形态与 AI 助手面板(chat-widget.js)共用一套语言:
  - 同一块屏幕区域(桌面右侧停靠 / 平板浮层 / 移动三段抽屉),改用共享件
    panel-shared.js 的拖拽与吸附,阈值与助手一致;
  - 两者**互斥**:同一时刻最多一个,靠 window.__aipmPanels 注册表串起来 ——
    批注面板开着时点 FAB「询问助手」→ claim("chat") 先关批注再开助手;
    助手开着时点页头批注按钮 → claim("annotation")。关与开在同一个同步任务里,
    浏览器只画一帧,桌面停靠下页面宽度不跳;
  - 页头入口是**开关**:面板开着时再点一次即收起。两个状态用一对方向箭头表示
    (收起态 ‹ / 展开态 ›),箭头指面板将要移动的方向 —— 面板停靠在右侧,所以收起
    时向左(拉出来)、展开时向右(推回去);不用叉,是因为页头那个叉会和面板头部
    自己的关闭叉在同一屏里打架。助手的 FAB 开着时整个隐藏,所以它没有这个来回,
    而批注入口一直可见,收起的动作只能由它自己承担。

  工程契约:
  - 面板、遮罩、选中工具条都 append 到 document.body 顶层(与 .aipm-chat 同理:
    instant 导航换页整体替换内容容器,挂在容器内会被连根拔掉);
  - 高亮 <mark> 在正文里(必须跟着内容走),所以换页后由 document$ 重新应用
    —— 不写 MutationObserver 重建逻辑;
  - 锚定按 W3C Web Annotation 存三类 selector(TextQuote / TextPosition / Range),
    三级回退;全失败进「未能定位」分组,绝不静默丢;
  - 列表每次 render 整体重建,所以**编辑器由 render 现场产出**,它落在列表里该在
    的位置上,而不是钉在面板底部 —— 写的时候看到的排版就是发出去之后的排版;
  - 两套卡片,两套编辑器:批注锚在正文某一段上,所以它有引文、色点、画法,空正文
    就等于「只划线不写字」;**评论不锚正文**,所以卡片是另一套(头像 + 用户名 +
    发布时间),新评论的编辑卡就长在「写一条评论」那颗按钮的位置上,正文不能为空。
    回复框、回复区、底部操作链三者两套卡片共用 —— 那几件事两边长得一样;
  - 「回复 / 编辑 / 删除」只出图标不出字。这几个动作在所有评论系统里长着同一张
    脸(回勾箭头 / 铅笔 / 垃圾桶),写字只会把一行按钮撑成一行字;名字挂在 title
    与 aria-label 上 —— 那是图标唯一的可读副本。删除另加一道「再点一次」的确认:
    图标按钮比文字链好点错,而删掉的东西回不来。样式见 .aipm-anno__ibtn。
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
  /** 服务端每请求块数上限(与 HIGHLIGHT_MAX_BLOCKS 对齐);超出部分不下发。
      取值:2026-09 实测全站 601 页,最长的一页 654 块,按两倍留冗余。 */
  var MAX_BLOCKS = 1308;
  /** 单块送去判分的字符上限:过长会把预算花在一条上,截断即可(锚定仍用整块)。 */
  var MAX_BLOCK_CHARS = 1000;
  /** 送去判分的总字符闸,与服务端 HIGHLIGHT_MAX_CHARS(60000)对齐并留余量。
      没有它,块数上限一抬,字符密的页面就会撞服务端 400 too_many_chars。 */
  var MAX_BLOCK_TOTAL_CHARS = 55000;
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

  /* 评论排序:两颗芯片。批注不参与 —— 它们按正文位置排,那是唯一的合理顺序;
     「最多回复」并进「最热」(热度 = 点赞 + 回复),两颗比三颗好认。 */
  var COMMENT_SORTS = [
    { id: "hot", label: "最热" },
    { id: "newest", label: "最新" }
  ];

  var ICON = {
    /* 页头入口的开合图标:箭头指面板**将要移动的方向**。面板停靠在右侧,
       所以收起态指向左(点它拉出来)、展开态指向右(点它推回去)。 */
    chevronLeft:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41,7.41L14,6l-6,6 6,6 1.41,-1.41L10.83,12z"/></svg>',
    chevronRight:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59,16.59L10,18l6,-6 -6,-6 -1.41,1.41L13.17,12z"/></svg>',
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
    /* 标题按钮尾巴上那对反向箭头:点一下换到另一份列表(批注 ↔ 评论)。
       用方向对立的两个箭头,而不是下拉的三角 —— 它不是菜单,是开关。 */
    swap:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.99,11L3,15l3.99,4v-3H14v-2H6.99V11zM21,9l-3.99,-4v3H10v2h7.01v3L21,9z"/></svg>',
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
      /* 这条属于哪一栏写在 mark 上:眼睛收走一栏时,正文里对应的那几笔也要跟着
         收(见 syncGroupVisibility),CSS 得认得出它是公开、私有还是仅本机。 */
      mark.setAttribute("data-group", groupOf(anno));
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
    /* 这一枚是面板的标记,只有站长手上才多一重身份:它是「重新生成智能高亮」的
       触发点(见 syncHeadIcon)。 */
    '<span class="aipm-anno__head-icon">' +
    ICON.pen +
    "</span>" +
    /* 标题即「批注 ↔ 评论」的切换器:它同时是当前模式的指示。但它首先是**按钮**,
       而按钮得在不悬停的时候就看得出来 —— 悬停底色只帮得到鼠标,触屏没有悬停。
       所以正面是一颗带边框的胶囊:左边写当前模式(syncMode() 改的就是这个 span),
       尾巴上一对双向箭头说明点下去会换一份列表。 */
    '<button type="button" class="aipm-anno__title" aria-label="切换批注与评论">' +
    '<span class="aipm-anno__title-label">批注</span>' +
    ICON.swap +
    "</button>" +
    '<span class="aipm-anno__count" hidden></span>' +
    /* 账号按钮是这串动作里的头一颗(顺序即视觉顺序):登录态的唯一入口。
       头一颗原先的智能高亮搬去了页头(见 smartBtn)—— 按钮一旦站在面板外面,
       它的可见性就不该再跟着面板里的模式走。 */
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
  /* 一行:挑画法、挑颜色,然后笔 = 写批注、叉 = 收起。可见范围不在这一行 ——
     划词挑个颜色就是「把这段划出来」,犯不着每次先答一遍给谁看;真要选范围的人
     走笔那条路,编辑卡里还留着那个菜单(见 buildVisPicker)。 */
  toolbar.innerHTML =
    '<div class="aipm-anno__tb-group" role="radiogroup" aria-label="批注画法">' +
    styleHtml() +
    "</div>" +
    '<span class="aipm-anno__tb-sep"></span>' +
    '<div class="aipm-anno__tb-group" role="radiogroup" aria-label="颜色">' +
    swatchHtml() +
    "</div>" +
    '<button type="button" class="aipm-anno__tb-annotate" title="写批注" aria-label="写批注">' +
    ICON.pen +
    "</button>" +
    '<button type="button" class="aipm-anno__tb-cancel" title="取消" aria-label="取消">' +
    ICON.close +
    "</button>";
  document.body.appendChild(toolbar);

  /* 快速高亮不开面板 —— 面板里的 hint / smartbar 这时都够不着,回执得落在页面上。
     一条自己会消失的小提示,挂在 body 上,不进面板。 */
  var toast = document.createElement("div");
  toast.className = "aipm-anno__toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.hidden = true;
  document.body.appendChild(toast);
  var toastTimer = 0;

  function flash(text, kind) {
    if (!text) return;
    toast.textContent = text;
    toast.setAttribute("data-kind", kind || "");
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
      toastTimer = 0;
    }, 2400);
  }

  /* 只留静态外壳上的引用。编辑卡的节点每次 render 现建现取,不进这张表 ——
     它们随列表一起被重建,存下来必然过期。 */
  var els = {
    panel: panel,
    scrim: scrim,
    toolbar: toolbar,
    grip: panel.querySelector(".aipm-anno__grip"),
    head: panel.querySelector(".aipm-anno__head"),
    headIcon: panel.querySelector(".aipm-anno__head-icon"),
    title: panel.querySelector(".aipm-anno__title"),
    titleLabel: panel.querySelector(".aipm-anno__title-label"),
    count: panel.querySelector(".aipm-anno__count"),
    account: panel.querySelector(".aipm-anno__account"),
    acct: panel.querySelector(".aipm-anno__acct"),
    acctName: panel.querySelector(".aipm-anno__acct-name"),
    close: panel.querySelector(".aipm-anno__close"),
    smartbar: panel.querySelector(".aipm-anno__smartbar"),
    list: panel.querySelector(".aipm-anno__list"),
    logout: panel.querySelector(".aipm-anno__logout")
  };
  /* 通知条右端那颗「关掉它」。它**不进 panel.innerHTML** —— 通知的正文是用
     textContent 整段重写的,写在壳子里的节点下一次就被抹掉了。所以它是一个常驻
     节点:每次重画(setSmartbar / renderSuggestions)再 appendChild 回来。
     appendChild 一个已在树上的节点只是把它挪到队尾,不克隆,也就不会重复。 */
  var smartClose = document.createElement("button");
  smartClose.type = "button";
  smartClose.className = "aipm-anno__smart-close";
  smartClose.title = "关闭通知";
  smartClose.setAttribute("aria-label", "关闭通知");
  smartClose.innerHTML = ICON.close;
  smartClose.addEventListener("click", function () {
    /* 只收条子,不撤结果:高亮建议还缓存在 suggestCache 里,再点页头的 ✨ 原地
       摆回来,既不重新请求,也不会撞上冷却。记下「这一页被关过」,免得换页回来
       时又被自动摆出来。 */
    smartbarDismissed = pagePath();
    setSmartbar("", "");
  });

  /* 页头入口按钮(位置与样式沿用 issue #67:页头右上角、贴浏览器右边缘) */
  var entry = document.createElement("button");
  entry.type = "button";
  entry.className = "md-header__button md-icon aipm-anno-entry";
  entry.title = "打开批注面板";
  entry.setAttribute("aria-label", "打开批注面板");
  entry.setAttribute("aria-expanded", "false");
  entry.setAttribute("data-state", "closed");
  entry.innerHTML = ICON.chevronLeft;

  /* 智能高亮按钮:它判的是**页面正文**,不是面板里的列表,所以跟入口并排站在
     页头,不开面板也够得着(顺序即视觉顺序:✨ 在 ‹ 左边,位置由 extra.css 的
     right: 2.4rem / right: 0 定)。

     它在面板里时是跟着模式显隐的(评论模式下收起,那边没有正文可划)。搬到面板
     外面之后这条规则不再成立:面板关着的时候,用户根本看不见当前是哪一份列表,
     一颗「有时在、有时不在」的页头按钮就成了没来由的闪烁。所以它一直可见,
     点击时自己把面板切回批注模式(见 smartHighlight 开头那段)。 */
  var smartBtn = document.createElement("button");
  smartBtn.type = "button";
  smartBtn.className = "md-header__button md-icon aipm-anno-smart";
  smartBtn.title = "智能高亮";
  smartBtn.setAttribute("aria-label", "智能高亮");
  smartBtn.innerHTML = ICON.spark;

  /* 入口是**开关**,不是「只负责开」:面板开着时再点一次即收起。这个来回只能由它
     自己承担 —— 助手的 FAB 在面板开着时直接隐藏(.is-hidden),批注入口一直可见。

     开合用一对方向箭头表示:收起态 ‹、展开态 ›,箭头指面板**将要移动的方向**
     (面板停靠在右侧,故收起时向左=拉出来,展开时向右=推回去)。刻意不用叉 ——
     页头那个叉会和面板头部自己的关闭叉在同一屏里打架(验收意见)。

     图标只在状态真的翻转时换一次:syncChrome() 在拖拽吸附、换形态、开关面板时都会
     被调到,每次重建 innerHTML 会让图标白闪一下。 */
  function syncEntry() {
    var state = open ? "open" : "closed";
    if (entry.getAttribute("data-state") === state) return;
    entry.setAttribute("data-state", state);
    entry.setAttribute("aria-expanded", open ? "true" : "false");
    entry.innerHTML = open ? ICON.chevronRight : ICON.chevronLeft;
    var label = open ? "收起批注面板" : "打开批注面板";
    entry.title = label;
    entry.setAttribute("aria-label", label);
  }

  function mountEntry() {
    var inner = document.querySelector(".md-header__inner");
    if (!inner || entry.parentNode === inner) return;
    /* 先 smart 后 entry:两颗都绝对定位,谁在左由 CSS 定,这里的先后只管 Tab 序
       —— 从左到右,✨ 再 ‹。 */
    inner.appendChild(smartBtn);
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
      els.list.querySelector(".aipm-anno__comment") ||
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
    /* 面板一开,划词悬浮窗就让位 —— 它 position: fixed、z-index 在面板之上,留着的
       话是叠在面板前面的一层浮窗,而此刻用户要办的事已经在面板里了。点页头那颗
       入口按钮并不保证把正文选区收掉(实测 headless Chromium 下就不收),所以不能
       指望 selectionchange 顺手把它清掉,这里得自己清。

       顺序无碍:startCreate() 是先把选区存进 composerSelection 再开面板的,这里清
       的是 pendingSelection。 */
    hideToolbar();
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

  /** 从面板外面把面板叫出来。助手开着时走 claim:注册表先关助手再开批注,两步在
      同一个同步任务里,所以那是「切到批注」而不是「什么都没发生」。

      悬浮窗在这里也一并收:这叫的是**面板**,而面板和悬浮窗占的是同一块视线。
      已经开着时尤其不能漏 —— 那条路会从 openPanel 的 `if (open) return` 上早退
      (点 ✨ 时面板常常已经开着),收不着。 */
  function revealPanel() {
    hideToolbar();
    if (open) return;
    if (panels) panels.claim("annotation");
    else openPanel();
  }

  entry.addEventListener("click", function () {
    /* 开着 → 收起;没开 → 打开。 */
    if (open) {
      if (panels) panels.close("annotation");
      else closePanel();
    } else {
      revealPanel();
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

  /* 页面标题:送智能高亮判分时当页面的名字用。主页的页首 h1 是 AI-PM-WIKI
     字标(整块 SVG,没有文字节点),取不到文字就回落到 document.title,
     否则会把空标题丢给模型。 */
  function pageTitle() {
    var h = document.querySelector(".md-content h1") || document.querySelector("h1");
    var text = (h && h.textContent ? h.textContent : "").trim();
    return text || (document.title || "").trim();
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
   * 「这一栏显不显示」的 prefs 键,批注与评论**各存一份**。
   *
   * 两边的栏目同名,收走的却是两样东西:批注那一栏还连着正文里的高亮(见
   * syncGroupVisibility),评论压根不锚正文。共用一份键的话,在评论面板里把「公开」
   * 收掉,回到文章里会发现公开那几条的划线也没了 —— 一次「这栏评论先不看了」的
   * 过滤,顺手改了另一件不相关的事。
   *
   * 折叠态不跟着分家:折叠两处都是同一件事(把这一栏的条目收起来、标题还留着),
   * 没有第二层含义要分开。
   */
  function groupShownKey(key) {
    return prefKey(panelMode === "comments" ? "showComments" : "show", key);
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
   * 评论排序,两档:最热 / 最新。批注**不参与** —— 它们按正文位置排,那是唯一的
   * 合理顺序;给批注排「热度」只会让人找不到刚才看到的那句话。
   * 同分一律按发布时间倒序兜底,免得顺序在两次渲染之间跳。
   */
  function commentComparator(sort) {
    return function (a, b) {
      if (sort === "newest") return tsMs(b.createdAt) - tsMs(a.createdAt);
      return hotOf(b) - hotOf(a) || tsMs(b.createdAt) - tsMs(a.createdAt);
    };
  }

  /* 排序开关:两颗芯片,没有「排序」二字 —— 芯片自己写着「最热 / 最新」,
     再挂一个提示语只是占地方。语义由 radiogroup 的 aria-label 承担。 */
  /**
   * 一次收放所有**原始评论**的回复区。
   *
   * 原始评论一多,一条条点开回复区太慢:想通读讨论要全展开,想只看大家说了什么
   * 要全收起来。它抄的是同一份状态(view.folded),所以单张卡随后自己再点一次,
   * 以那一次为准 —— 两颗按钮不是另一套开关。
   *
   * 只认全页评论:批注卡不归评论面板这一行管(它们有自己的默认收起)。
   */
  function foldAllComments(folded) {
    publicList.concat(privateList).concat(localList).forEach(function (anno) {
      if (!isPageComment(anno)) return;
      replyViewOf(anno.id).folded = folded;
    });
    render();
  }

  function sortRow() {
    var prefs = store.prefs();
    var row = document.createElement("div");
    row.className = "aipm-anno__sort";

    /* 排序是一个单选组,「全部展开 / 全部折叠」不是它的选项 —— 所以后者摆在
       radiogroup 外面,免得读屏软件把那两颗念成第三、第四种排序。 */
    var group = document.createElement("div");
    group.className = "aipm-anno__sort-group";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "评论排序");
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
      group.appendChild(b);
    });
    row.appendChild(group);

    row.appendChild(spacerNode());

    var all = document.createElement("span");
    all.className = "aipm-anno__foldall";
    [
      { label: "全部展开", folded: false },
      { label: "全部折叠", folded: true }
    ].forEach(function (item) {
      all.appendChild(
        moreButton("aipm-anno__replies-fold", item.label, 0, function () {
          foldAllComments(item.folded);
        })
      );
    });
    row.appendChild(all);
    return row;
  }

  /** 分组头:左侧箭头折叠(收起条目、标题还留着),右侧眼睛整栏不显示。 */
  function groupHead(key, count, prefs) {
    var collapsed = prefs[prefKey("collapsed", key)] === true;
    var shown = prefs[groupShownKey(key)] !== false;
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

  /** 这张编辑卡是不是「评论」的(而不是批注或回复)。 */
  function isCommentDraft() {
    if (editorDraft === null) return false;
    if (editorDraft.kind === "reply") return false;
    if (editorDraft.kind === "create") return editorDraft.page === true;
    var on = annoById(editorDraft.annoId);
    return on !== null && isPageComment(on);
  }

  /**
   * 当前编辑卡该落在哪一组、组内哪个位置。没有编辑器时返回 null。
   *
   * 评论不走这里:新评论的编辑卡落在「写一条评论」那颗按钮的位置上(见 render),
   * 改已有评论的编辑卡落在那条自己的位置上(见 renderCommentItem)—— 反正不该
   * 按正文位置插进某个分栏,它压根没有正文位置。
   */
  function draftSlot() {
    if (!editorDraft) return null;
    if (panelMode === "comments") return null;
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

  /**
   * 眼睛收走后,正文里对应的高亮也跟着收。
   *
   * 收走的是「画上去的那一笔」,不是那段文字:`<mark>` 仍旧裹着原文,只把底色与
   * 下划线撤掉,所以收走一栏不会把正文挖出几个洞、行高也不动。
   *
   * 隐藏态挂在 <html> 上而不是面板上 —— `<mark>` 在正文里、眼睛在面板里,两棵
   * 子树没有公共祖先,只有根节点同时罩得住两边(与 syncChrome 那组状态类同处)。
   */
  function syncGroupVisibility() {
    var prefs = store.prefs();
    var cl = document.documentElement.classList;
    ["public", "private", "local"].forEach(function (g) {
      /* 读的**始终是批注那一份**(不是 groupShownKey):正文里的 mark 属于批注,
         评论那一栏的眼睛管不着它。在评论面板里收掉一栏,文章该怎么画还怎么画。 */
      var off = prefs[prefKey("show", g)] === false;
      cl.toggle("aipm-anno-hide-" + g, off);
      /* 收走的那几条也别再留在 Tab 序列里:看不见的东西被键盘停在上面,焦点环
         会凭空画在一段没有任何标记的文字上。(aria-label 留着 —— 文字本身还要
         能被读出来,把整个 mark 打成 aria-hidden 会把那段正文一起读没了。) */
      var marks = document.querySelectorAll('mark.aipm-anno-mark[data-group="' + g + '"]');
      for (var i = 0; i < marks.length; i++) {
        marks[i].setAttribute("tabindex", off ? "-1" : "0");
      }
    });
  }

  function render() {
    /* 列表整体重建,上一轮物化出来的编辑卡已经随之消失 —— 先把 els 里那组
       指针清掉,免得后面读到已经脱开的节点。 */
    unmountEditor();
    closePop();
    /* 面板与正文是两棵子树,一栏的显隐得同时在两边落地:列表这边按 prefs 少排
       几栏的内容,正文那边换一根根节点上的 class。 */
    syncGroupVisibility();

    var all = publicList.concat(privateList).concat(localList);
    var items = all.filter(inMode);
    els.count.textContent = items.length ? String(items.length) : "";
    els.count.hidden = items.length === 0;
    els.list.textContent = "";

    /* 评论模式没有「划词」这个动作,新建得有一颗看得见的按钮 —— 而且新评论的
       编辑卡就长在这颗按钮的位置上:点开它,写的时候看到的排版就是发出去之后的
       排版,发出去之后也还在这一条上,不再另起一张落到某个分栏里。
       编辑器一轮 render 只能物化一次(它会覆写 els 里那组指针),所以这里物化了,
       下面的分组循环就不会再碰它 —— 评论不走 draftSlot()。 */
    if (panelMode === "comments") {
      var composer = editorDraft !== null && editorDraft.page === true ? materializeEditor() : null;
      if (composer !== null) {
        els.list.appendChild(composer);
      } else if (editorDraft === null) {
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
    /* 新批注按落点插进排序好的列表。评论已经没有这一节了(draftSlot 对评论返回
       null,它的编辑卡在上面那颗按钮的位置上)。 */
    var draftRank = draft === null || draft.inline ? null : draftKey();

    /* 面板「空不空」只看真正的内容。排序条与「写一条评论」是常驻的 chrome,
       拿 childNodes.length 去判会把它们误判成「还有内容」,那句「还没有人…」
       就永远露不了面。 */
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
      /* 眼睛收走的是这一栏的**内容**,不是这一栏本身 —— 所以这里只判「有没有
         东西」,不判「眼睛开着没有」。标题、条数与那只眼睛都留在原地(标题变淡),
         收走的只有下面那些卡片。连标题一起收的话,点过的那只眼睛会跟着没:
         它自己就长在标题上,收走之后谁也点不回来。
         空栏平时不露头(一页干净的时候不该挂着三行 0),被眼睛收走的那一栏例外 ——
         标题与眼睛是唯一的回来路,栏里空了也得留着。 */
      var hidden = prefs[groupShownKey(g.key)] === false;
      if (visible.length === 0 && !draftHere && !hidden) return;

      els.list.appendChild(groupHead(g.key, visible.length + (draftHere ? 1 : 0), prefs));
      contentCount++;

      /* 编辑器由 render 现场产出(列表每轮整体重建),而且要落在它该在的位置上:
         新批注按它选中那段文字的位置插进排序好的列表,不再钉在分组最前面。 */
      var pending = draftHere ? materializeEditor() : null;
      /* 收走的那一栏不排内容;正在写的那张卡除外 —— 编辑器还在内存里、屏幕上
         却什么都没有,是说不过去的。 */
      if (hidden || prefs[prefKey("collapsed", g.key)] === true) {
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
        els.list.appendChild(inComments ? renderCommentItem(anno) : renderItem(anno));
        contentCount++;
      });
      if (pending !== null) {
        els.list.appendChild(pending);
        contentCount++;
      }
    });

    /* 未定位组不进「评论」模式:评论本来就没有位置,列在这里毫无意义。
       被眼睛收走的那些也不进来:眼睛说的是「这一栏先不显示」,未定位的条目仍旧
       属于它原来那一栏,不该从这里漏回来。收走的那一条画不出高亮,也没进
       orphanIds 之外的任何地方,这里不滤就是一条藏不住的漏网之鱼。 */
    var shownOrphans = orphans.filter(function (anno) {
      return prefs[groupShownKey(groupOf(anno))] !== false;
    });
    if (shownOrphans.length > 0 && panelMode === "annotations") {
      var oh = document.createElement("div");
      oh.className = "aipm-anno__group-head is-orphan";
      var ohLabel = document.createElement("span");
      ohLabel.className = "aipm-anno__group-title";
      ohLabel.textContent = "未在正文中定位";
      oh.appendChild(ohLabel);
      var ohNum = document.createElement("span");
      ohNum.className = "aipm-anno__group-count";
      ohNum.textContent = String(shownOrphans.length);
      oh.appendChild(ohNum);
      oh.title = "页面改过之后这些批注找不到原来的位置了;它们没有被删掉";
      els.list.appendChild(oh);
      contentCount++;
      shownOrphans.forEach(function (anno) {
        els.list.appendChild(renderItem(anno, true));
        contentCount++;
      });
    }

    if (contentCount === 0) {
      /* 面板空不空只看真正的内容。从前这里有第二条支路:三栏被眼睛收光之后补一颗
         「显示全部」,因为那只眼睛自己也长在被收走的标题上。现在眼睛收走的是栏的
         内容而不是栏本身,三个标题一直在,那条路就没得可走了 —— 点哪只眼睛都能
         回来。 */
      var empty = document.createElement("p");
      empty.className = "aipm-anno__empty";
      empty.textContent =
        panelMode === "comments"
          ? "还没有人对这一页留下评论。"
          : "选中正文里的一段话就能加批注。";
      els.list.appendChild(empty);
    }

    /* 手机上 peek 的高度按「一张卡」算,而卡片是这里刚建出来的 —— 重建完顺手
       重算一次,否则 peek 会停在上一轮的数值上。refreshPeek 内部对 data-snap 的
       存取在同一个任务里完成,浏览器只画一帧,不会闪。 */
    if (mode === "sheet") applyMetrics();

    /* 「回复 @某人」点下去的那一下落在这儿:节点要等整棵列表建完才在文档里,
       在上面边建边滚是滚不动的。与正文高亮点击走同一套「滚过去 + 闪一下」。 */
    if (pendingFocus !== null) {
      var target = els.list.querySelector('[data-reply-id="' + pendingFocus + '"]');
      pendingFocus = null;
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.add("is-flash");
        setTimeout(function () {
          target.classList.remove("is-flash");
        }, 900);
      }
    }
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
    pop.innerHTML = popRow("样式", styleHtml()) + popRow("颜色", swatchHtml());
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

  /* ---------------------------------------------------------------
     回复的账号信息、折叠与翻页
     ---------------------------------------------------------------
     一条热评底下挂着几十条回复时,列表不该被它一条占满 —— B 站与 YouTube 用的
     是同一个办法:先露几条,剩下的折在一颗「展开」下面;顶层回复本身也翻页。
     缩进只留一档(原始评论 → 回复 → 回复回复),再往里的那条改口称「回复 @某人」,
     层次由文字说清,而不是由左边的空白说清(400px 宽的面板里,第二档缩进之后
     正文只剩一条竖线)。

     这一整套是**批注卡与评论卡共用**的:「收起回复」、逐层折叠、@ 拍平、翻页、
     计数都长在 repliesBox 里,两边的层级不可能各漂一套。

     **折叠是逐层独立的**:每个节点只管自己那几条直接子回复,一个楼层底下挂了
     几十条、其中某一条底下又挂了几十条,两处各收各的 —— 一刀切在楼层上的话,
     「这一层很多」与「那一层很多」只能一起收,想看其中一个就得把整层铺开。
     开合态因此按 **节点 id** 记(楼层也就是个节点),不是按楼层记。

     逐层折叠治的是「某一层特别宽」;**治不了「每一层都不少」** —— 每层露 3 条,
     三层下去就是 1 + 3 + 9,再深一层又翻三倍。所以每个楼层另有一道总行数
     上限(REPLY_ROWS_MAX),铺满了就折成一颗「本层还有 N 条回复」。两道各管一头:
     前者管读起来顺不顺,后者管画出来的行数有没有底。

     展开态存在 replyView 里,**不属于任何一次渲染** —— 面板每敲一个字就整个重建
     一遍,状态要是记在节点上,刚展开的那几条会当场收回去。
     */
  var REPLY_PREVIEW = 3;
  /* 一个楼层一次最多铺多少行。取 20 是因为逐层折叠之后,一棵「每层都满 3 条」的树
     到第二层是 1+3 = 4 行,到第三层是 13,再深一层就是 40 —— 上限正好卡在开始
     不像话的那一档之前。 */
  var REPLY_ROWS_MAX = 20;
  var REPLY_PAGE = 20;
  /**
   * annoId -> { page: 1, open: { <replyId>: true }, closed: { <replyId>: true },
   *             rows: { <floorId>: n }, unfolded: bool }
   *
   * open / closed 是一层的两个方向:open = 这一层全铺开(越过「先露三条」的预览),
   * closed = 这一层一条不露。两个都没有 = 按默认来(先露 REPLY_PREVIEW 条)。
   */
  var replyView = {};
  /** 「回复 @某人」点下去要跳的那一条。跳转发生在 render 末尾 —— 节点那时才在文档里。 */
  var pendingFocus = null;

  function replyViewOf(annoId) {
    var v = replyView[annoId];
    if (!v) {
      v = { page: 1, open: {}, closed: {}, rows: {} };
      replyView[annoId] = v;
    }
    return v;
  }

  /** 顶层的祖先 —— 这条回复挂在哪个楼层下。父级悬空时就是它自己。 */
  function floorIdOf(byId, reply) {
    var cur = reply;
    var guard = 0;
    while (cur && cur.parentId && byId[cur.parentId] && guard < 1000) {
      cur = byId[cur.parentId];
      guard++;
    }
    return cur ? cur.id : null;
  }

  /**
   * 按当前的开合态,这个节点连它自己在内**本该**铺几行。与真实铺开的那一轮
   * (paintReply)走的是同一条规则,只是不设上限 —— 两个数一减,就是被楼层总行数
   * 上限截掉的那些,楼层末尾那颗「本层还有 N 条回复」据此报数。
   *
   * 只看真实存在的节点,所以这里是 O(这棵子树里真正有几条回复),不是按每层
   * 乘 3 指数展开的。
   */
  function plannedRows(childrenOf, openSet, closedSet, node) {
    var kids = childrenOf[node.id] || [];
    var n = 1;
    for (var i = 0; i < limitOf(node, kids, openSet, closedSet); i++) {
      n += plannedRows(childrenOf, openSet, closedSet, kids[i]);
    }
    return n;
  }

  /**
   * 这一层铺几条。三态:
   *   closed        → 一条不露
   *   open          → 全铺
   *   都没有(默认) → 先露 REPLY_PREVIEW 条
   *
   * 默认态只对**第一层**(原始批注/评论 → 回复)有意义 —— 那一层是「这条下面有些
   * 什么人在说话」,先露三条让人扫得动。再往里(回复 → 回复回复)那一层本来常常
   * 只有一两条,「先露三条」在那儿等于没有折叠,所以它靠 closed 明确收放。
   */
  function limitOf(node, kids, openSet, closedSet) {
    if (closedSet[node.id] === true) return 0;
    if (openSet[node.id] === true) return kids.length;
    return Math.min(REPLY_PREVIEW, kids.length);
  }

  /**
   * 从某个节点一路往上到楼层,把沿途每个节点都记进来(含它自己)。回复框与刚发出
   * 的那条回复都要靠它:它们落在最里面,沿途任何一层收着都看不见。
   */
  function ancestorChain(byId, reply) {
    var chain = [];
    var cur = reply;
    var guard = 0;
    while (cur && guard < 1000) {
      chain.push(cur.id);
      cur = cur.parentId ? byId[cur.parentId] : null;
      guard++;
    }
    return chain;
  }

  /**
   * 自己刚发的回复一定要看得见 —— 它要是落进一个收着的楼层、或落到还没翻到的那一页
   * 里,发完就像没发出去。所以发之前先把落点放开。
   *
   * 落点拿**当前**数据算:父回复一定已经在本地(服务端只收已经存在的楼层),新回复
   * 本身还没回来,但它在哪一层完全由父级决定。
   */
  function openReplyTarget(anno, parentId) {
    var byId = {};
    (anno.replies || []).forEach(function (r) {
      byId[r.id] = r;
    });
    var view = replyViewOf(anno.id);
    /* 发回复同理:发完那次重渲染不能把新回复连同整块回复区一起折回去。 */
    view.folded = false;
    if (parentId && byId[parentId]) {
      /* 新回复恒挂在父级的**最后**,而父级那一层要是正收着(只露前几条),它正好
         落在折叠外面 —— 所以沿途每一层都得放开,不只是楼层那一层。 */
      ancestorChain(byId, byId[parentId]).forEach(function (id) {
        view.open[id] = true;
      });
      return;
    }
    /* 回的是这条批注自己 → 新回复是一条新的顶层楼层,排在最后一条之后。它落在
       第几页现在就能算出来:现有的顶层楼层数就是它的下标。 */
    var floors = 0;
    (anno.replies || []).forEach(function (r) {
      if (!(r.parentId && byId[r.parentId])) floors++;
    });
    view.page = Math.max(view.page, Math.floor(floors / REPLY_PAGE) + 1);
  }

  /**
   * 跳到被回复的那一条。滚动落在 render 的末尾 —— 这儿建出来的节点那时才在文档里。
   *
   * 放开楼层、翻到它那一页这两步其实**够不着**:@ 那一行与它指的那一条在同一个
   * 楼层里,而父级在 DFS 里恒排在子级之前,所以父级露得出来时子级一定也露着 ——
   * 能点到那颗 @,就说明目标已经画在屏幕上了。留着是因为这两条是从「折叠规则」
   * 推出来的,规则哪天改了(比如折叠改成按热度挑几条),跳转不该跟着坏在一处
   * 没人会想到的地方。
   */
  function jumpToReply(anno, replyId) {
    var view = replyViewOf(anno.id);
    var byId = {};
    var floorless = [];
    (anno.replies || []).forEach(function (r) {
      byId[r.id] = r;
    });
    (anno.replies || []).forEach(function (r) {
      /* 顶层 = 没有父级,或父级已经找不到(悬空 parentId)。与 repliesBox 同一套判定。 */
      if (!(r.parentId && byId[r.parentId])) floorless.push(r);
    });
    var target = byId[replyId];
    if (!target) return;
    var floor = floorIdOf(byId, target);
    if (floor) {
      view.open[floor] = true;
      floorless.forEach(function (f, i) {
        if (f.id !== floor) return;
        view.page = Math.max(view.page, Math.floor(i / REPLY_PAGE) + 1);
      });
    }
    pendingFocus = replyId;
    render();
  }

  /**
   * 回复的头一行:头像 + 名字 + 楼主角标 + 时间。
   *
   * 头像与名字都得有 —— 回复上只挂一串 login 时,读者得靠那串字母在脑子里记住
   * 谁是谁;头像能在一眼之内分清,这正是 B 站与 YouTube 的回复列表都带头像的原因。
   * 名字用 GitHub 的显示名,后面再跟一个 @handle:显示名可以重名,handle 不会,
   * 两个都给才既好认又认得出是谁。
   */
  function replyHead(anno, reply) {
    var head = document.createElement("div");
    head.className = "aipm-anno__reply-head";

    var av = avatarOf(reply.author);
    av.classList.add("is-sm");
    head.appendChild(av);

    var login = loginOf(reply.author);
    var name = displayNameOf(reply.author);
    var who = document.createElement("b");
    who.className = "aipm-anno__reply-who";
    who.textContent = name;
    who.title = "@" + login;
    /* 显示名与 handle 相同时不必说两遍 —— 那就只剩一遍。handle 挂在同一个 <b>
       里(而不是另起一格):名字这一格是这一行唯一有弹性的,挤不下时两个一起
       省略,而不是把后面的时间与按钮顶出面板。 */
    if (name !== login) {
      var handle = document.createElement("span");
      handle.className = "aipm-anno__reply-handle";
      handle.textContent = "@" + login;
      who.appendChild(handle);
    }
    head.appendChild(who);
    /* 「这条是楼主的」—— B 站叫 UP 主、YouTube 叫创作者。几十层的高楼里,作者
       本人的一句话比别人的重,而这个信息只有 githubId 说得清;不标出来,读者
       只能拿名字去猜,而名字可以重。 */
    if (isFloorOwner(anno, reply)) {
      var badge = document.createElement("span");
      badge.className = "aipm-anno__badge is-author";
      badge.textContent = "作者";
      head.appendChild(badge);
    }

    var when = relTime(reply.createdAt);
    if (when) {
      var time = document.createElement("time");
      time.className = "aipm-anno__reply-time";
      time.dateTime = reply.createdAt;
      time.textContent = when;
      time.title = absTime(reply.createdAt);
      head.appendChild(time);
    }
    head.appendChild(spacerNode());

    var tools = document.createElement("span");
    tools.className = "aipm-anno__reply-tools";
    if (canReply(anno)) {
      tools.appendChild(
        iconButton(ICON.reply, "回复这条", "reply", function () {
          startReply(anno, reply);
        })
      );
    }
    if (canDeleteReply(anno, reply)) {
      var del = ibtn(ICON.trash, "删除这条回复", "delete-reply");
      del.classList.add("is-danger");
      armDelete(del, "删除这条回复", function () {
        removeReply(anno, reply);
      });
      tools.appendChild(del);
    }
    if (tools.childNodes.length > 0) head.appendChild(tools);
    return head;
  }

  /**
   * 回复的正文。缩进到顶之后(`parent` 非空)在最前面补一句「回复 @某人」——
   * B 站与 YouTube 都是这个写法:层次说在正文里,不再往右缩。那颗 @ 可点,
   * 点了跳到被回复的那一条;高楼里「他到底在回谁」因此不用靠猜。
   */
  function replyBody(anno, reply, parent) {
    var p = document.createElement("p");
    p.className = "aipm-anno__reply-body";
    if (parent) {
      var at = document.createElement("button");
      at.type = "button";
      at.className = "aipm-anno__reply-at";
      at.textContent = "回复 @" + displayNameOf(parent.author);
      at.title = "跳到这条回复";
      at.addEventListener("click", function () {
        jumpToReply(anno, reply.parentId);
      });
      p.appendChild(at);
      /* 冒号是这一行的分界:显示名可以很长(见上面那颗按钮的省略),没有它,
         名字与正文会连成一串认不出边界。B 站与知乎的楼中楼也这么写。 */
      p.appendChild(document.createTextNode("："));
    }
    p.appendChild(document.createTextNode(reply.body));
    return p;
  }

  /**
   * 各处「还能展开」共用的那颗按钮。`depth` 是它将要展开的那一层 —— 按钮自己缩进
   * 到那一层的宽度上,读者才知道按下去多出来的是谁的回复(逐层折叠之后,同一屏上
   * 可能有好几颗,不缩进就分不清哪颗管哪条)。
   */
  function moreButton(className, label, depth, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    /* 档位由调用方算好 —— 只有它知道这一层最多缩到哪儿(见 repliesBox 的
       MAX_DEPTH)。这儿只负责落到属性上,与回复 / 回复框共用同一组缩进规则。 */
    if (depth > 0) b.setAttribute("data-depth", String(depth));
    b.addEventListener("click", onClick);
    return b;
  }

  /**
   * 回复区。批注卡与评论卡共用 —— 「回复」这件事两边长得一样,没理由两套。
   * 返回 null = 这条既没有回复、也不在回复中,调用方据此决定要不要挂这一块。
   *
   * 卡片级开合由两个开关决定:
   *   `opts.cardFold` = 这张卡**能**把整块回复区收起来(两张卡都传);
   *   `opts.folded`   = 默认就收着(只有批注卡传)。
   *
   * 批注卡默认收起:批注模式是拿来扫读正文里那些标记的,一屏十几条,每条都摊开
   * 几十行回复就没法扫了。评论卡默认展开 —— 去评论面板就是来看对话的,再折一道
   * 只是多一次点击;但「全部折叠」那颗全局按钮要靠它才收得动。
   *
   * 收起来那一版只挂一颗「展开 N 条回复」;摊开之后仍旧走下面那整套(逐层折叠、
   * @ 拍平、楼层上限、翻页),末尾再留一条回去的路。
   */
  function repliesBox(anno, opts) {
    var replies = anno.replies || [];
    var replyingHere =
      editorDraft !== null && editorDraft.kind === "reply" && editorDraft.annoId === anno.id;
    var replyParent = replyingHere ? editorDraft.parentId || null : null;
    /* 卡片级开合。状态记三态:view.folded 为 undefined = 还没人点过,按默认来 ——
       这样「全部展开 / 全部折叠」与单张卡自己的开合能共用同一个字段,谁后点谁说了算。 */
    var cardFold = !!(opts && opts.cardFold) && replies.length > 0;
    var card = cardFold ? replyViewOf(anno.id) : null;
    var cardFolded =
      cardFold && (card.folded === undefined ? !!(opts && opts.folded) : card.folded === true);
    /* 正在这里回复时不许折:输入框得有个落脚的地方。 */
    if (cardFolded && !replyingHere) {
      var wrap = document.createElement("div");
      wrap.className = "aipm-anno__replies-foldwrap";
      wrap.appendChild(
        moreButton("aipm-anno__replies-fold", "展开 " + replies.length + " 条回复", 0, function () {
          card.folded = false;
          render();
        })
      );
      return wrap;
    }
    if (replies.length > 0 || replyingHere) {
      var box = document.createElement("div");
      box.className = "aipm-anno__replies";
      var byId = {};
      replies.forEach(function (r) {
        byId[r.id] = r;
      });
      /* 楼层先按「谁回了谁」挂成一棵树,再顺着树铺开 —— 不是照收到的顺序平铺。
         平铺时后写的那条总排在最后:回第一层的那条会落在「顶层第二条」底下、
         缩进还是一层,读起来就是「回的是顶层第二条」—— 回复挂到了不是它回的那条
         名下。回复挨着它回的那条站,缩进才说明得了问题。
         父回复被删之后 parentId 会悬空,那种按顶层渲染(缩进到看不见的层级里更糟)。
         父级恒在子级之前(服务端只收已经存在的楼层),所以这棵树不会有环。 */
      var childrenOf = {};
      replies.forEach(function (r) {
        var parent = r.parentId && byId[r.parentId] ? r.parentId : "";
        if (!childrenOf[parent]) childrenOf[parent] = [];
        childrenOf[parent].push(r);
      });
      /* 缩进只留**一档**:原始评论 → 回复 → 回复回复。再深的那一层不再往右缩,
         改由正文开头那句「回复 @某人」说清层次 —— 400px 宽的面板里,第二档缩进
         之后正文就只剩一条竖线,而楼中楼之间的回复本来也不该再开一层。 */
      var MAX_DEPTH = 1;

      var view = replyViewOf(anno.id);
      var floors = childrenOf[""] || [];
      /* 正在回复的那一条必须看得见:它在哪一页就翻到哪一页,缩在哪个收着的楼层里
         就把它展开。写的时候看不见自己回的是谁,这个输入框就没有出口。 */
      var openSet = {};
      Object.keys(view.open).forEach(function (id) {
        if (view.open[id]) openSet[id] = true;
      });
      var closedSet = {};
      Object.keys(view.closed).forEach(function (id) {
        if (view.closed[id]) closedSet[id] = true;
      });
      /* 逐层折叠之后,要让某一条看得见就得把它**沿途每一层**都放开 —— 只放开楼层
         不够,中间任何一层收着,它就还是画不出来。编辑器与 @ 跳转都走这一条。 */
      var editorChain = replyingHere && replyParent ? ancestorChain(byId, byId[replyParent]) : [];
      editorChain.forEach(function (id) {
        openSet[id] = true;
        delete closedSet[id]; // 收着的层要放开,不能同时又收着
      });
      var editorFloor = editorChain.length > 0 ? editorChain[editorChain.length - 1] : null;
      var page = view.page;
      if (editorFloor) {
        floors.forEach(function (f, i) {
          if (f.id === editorFloor) page = Math.max(page, Math.floor(i / REPLY_PAGE) + 1);
        });
      }
      var shownFloors = floors.slice(0, page * REPLY_PAGE);

      /* 要翻页才看得全的时候,先报一句总数 —— 「还有多少条没看见」是这一页唯一
         说不清的事。总共没几条时它就是废话,不挂。 */
      if (replies.length > REPLY_PREVIEW) {
        var count = document.createElement("div");
        count.className = "aipm-anno__replies-count";
        count.textContent = "共 " + replies.length + " 条回复";
        box.appendChild(count);
      }

      var placedEditor = false;
      var appendEditor = function (depth) {
        var form = materializeEditor();
        placedEditor = true;
        if (form === null) return;
        /* 回复框跟着它将要成为的那一层缩进:写的时候看见的层次,就是发出去之后的
           层次。回整条批注时缩进为 0,不带这个属性。 */
        if (depth > 0) form.setAttribute("data-depth", String(Math.min(depth, MAX_DEPTH)));
        box.appendChild(form);
      };

      /* budget = 这个楼层还剩几行可铺(见 REPLY_ROWS_MAX)。返回这一趟真正铺了几行
         —— 含它自己,楼层末尾拿它跟 plannedRows 一比就知道被截掉了多少。 */
      var paintReply = function (r, depth, budget) {
        /* 一行都铺不出来了就回头,调用方据此停手 —— 检查放在入口而不是循环里,
           这样「还剩几行」与实际铺出来的行数永远对得上。 */
        if (budget.left <= 0) return 0;
        budget.left--;
        var rows = 1;

        var line = document.createElement("div");
        line.className = "aipm-anno__reply";
        line.setAttribute("data-reply-id", r.id);
        if (depth > 0) line.setAttribute("data-depth", String(Math.min(depth, MAX_DEPTH)));

        /* 回复排成「头一行 + 正文」两段,而不是**作者**正文一串连排:操作按钮
           挂在这条回复自己的头一行右端,位置就固定了 —— 连排时它们跟在正文尾巴
           后面,每条回复的按钮都落在不同的横坐标上,越读越散。这也正是批注卡
           自己的排法(左边是谁、右边是能对它做的事)。 */
        line.appendChild(replyHead(anno, r));
        /* 缩进已经到顶、这条却又是在回某一条 —— 层次改由正文里那句「回复 @某人」
           说清。父级悬空时 parent 取不到,那就不说(它按顶层渲染)。 */
        var over = depth > MAX_DEPTH && r.parentId ? byId[r.parentId] : null;
        line.appendChild(replyBody(anno, r, over || null));

        box.appendChild(line);
        /* 回这一条 → 输入框就落在这条下面、它已有的回复之前:新回复本来就是它的
           第一条子回复,写的时候看见的位置就是发出去之后的位置。 */
        if (replyingHere && replyParent === r.id) {
          appendEditor(Math.min(depth + 1, MAX_DEPTH));
        }

        /* 这一层自己收自己的(三态见 limitOf)。它与楼层那道总行数上限是两回事
           —— 前者说不清「还有几条」的时候,后者兜底。

           「收起」只挂在缩进的最深一档(`MAX_DEPTH`)上,也就是槽位里那一层
           「回复」:它收的是自己那串「回复回复」。更深的不挂 —— 缩进到顶之后
           它们的子回复跟它们铺在同一个档位上,每层各挂一颗,读者看到的就是三四颗
           一模一样的「收起回复」摞在一起,而且收的深度各不相同,点哪颗全靠猜。
           一档一颗还保证了相邻两颗之间必定隔着别的行,不会再连成一片。 */
        var kids = childrenOf[r.id] || [];
        var open = openSet[r.id] === true;
        var closed = closedSet[r.id] === true;
        var limit = limitOf(r, kids, openSet, closedSet);
        var sweepable = depth === MAX_DEPTH && kids.length > 0;
        var painted = 0;
        for (var i = 0; i < kids.length && painted < limit; i++) {
          var got = paintReply(kids[i], depth + 1, budget);
          if (got === 0) break;
          painted++;
          rows += got;
        }
        /* 「还剩几条」只有把这一层数完了才敢报。被楼层总额截断时这一层的开合不挂:
           那一刻「还剩几条」是总额说了算,挂在这儿会报一个只数了本层的数,点下去
           也补不齐(补得齐的那颗在楼层末尾)。 */
        if (painted >= limit) {
          var rest = closed || open ? 0 : kids.length - painted;
          var label = null;
          var foldTo = null;
          if (closed) {
            label = "展开 " + kids.length + " 条回复";
            foldTo = "open";
          } else if (rest > 0) {
            label = "展开剩余 " + rest + " 条回复";
            foldTo = "open";
          } else if (sweepable) {
            /* 全铺着、还有子回复可收 —— 挂一颗「收起」。最深那一档里常常只有一
               两条,「先露三条」的预览在那儿等于没有折叠,不挂这颗就根本收不掉。
               槽位里那一层自己不挂 —— 它那三条预览是有用的,不该再多一颗按钮。

               上面「还剩几条」那一支不看 depth:铺不下的回复再不给颗按钮,它们就
               永远露不出来了,那一支必须到处都能挂。 */
            label = "收起回复";
            foldTo = "closed";
          }
          if (label !== null) {
            box.appendChild(
              moreButton(
                "aipm-anno__reply-more",
                label,
                /* 缩进到它将要开合的那一层的**实际**档位上 —— 深过封顶的那几层
                   是平铺的,按钮要是还按 depth + 1 缩,就会飘在它露出的那几条右边。 */
                Math.min(depth + 1, MAX_DEPTH),
                (function (node, how) {
                  return function () {
                    view.open[node.id] = how === "open";
                    view.closed[node.id] = how === "closed";
                    render();
                  };
                })(r, foldTo)
              )
            );
          }
        }
        return rows;
      };

      shownFloors.forEach(function (floor) {
        /* 逐层折叠之后「本该铺几行」与「真的铺了几行」一比,差出来的就是被楼层总
           行数截掉的那些。这道上限自己是可以顶开的:点一次多给一页。 */
        var cap = view.rows[floor.id] || REPLY_ROWS_MAX;
        var paintedRows = paintReply(floor, 0, { left: cap });
        var cut = plannedRows(childrenOf, openSet, closedSet, floor) - paintedRows;
        if (cut > 0) {
          box.appendChild(
            moreButton("aipm-anno__replies-more", "本层还有 " + cut + " 条回复", 0, function () {
              view.rows[floor.id] = cap + REPLY_ROWS_MAX;
              render();
            })
          );
        }
      });

      /* 回的是这条批注自己(不是某一条回复)→ 输入框排在整棵树后面。 */
      if (replyingHere && replyParent === null) appendEditor(0);
      /* 要回的那条回复在别处被删了:输入框仍旧要看得见,不然这段字写进了一块没有
         出口的空白里。落回末尾 —— 提交时服务端会说这条回复不存在。 */
      if (replyingHere && !placedEditor) appendEditor(0);

      /* 顶层回复翻页。放在最后 —— 它是整段回复的下一页,不是某一个楼层的。 */
      var restFloors = floors.length - shownFloors.length;
      if (restFloors > 0) {
        box.appendChild(
          moreButton("aipm-anno__replies-more", "展开更多回复(" + restFloors + " 条)", 0, function () {
            view.page = page + 1;
            render();
          })
        );
      }
      /* 摊开之后要留一条回去的路 —— 否则「收起」就成了单向门:点开一次,这条
         从此一直摊着,「全部折叠」也就无从收起单张卡。 */
      if (cardFold) {
        box.appendChild(
          moreButton("aipm-anno__replies-fold", "收起全部回复", 0, function () {
            card.folded = true;
            render();
          })
        );
      }
      return box;
    }
    return null;
  }

  /**
   * 卡片底部的操作链:点赞 / 上传 / 重新锚定。批注卡与评论卡共用 ——
   * 「上传」对两者都成立(仅本机那条本来就能转成公开),「重新锚定」只有批注有
   * (isOrphan 对评论恒为假)。一条操作都没有时返回空节点,调用方据此不挂这一行。
   *
   * 「回复」不在这行 —— 它搬去了卡片右上角,与「编辑 / 删除」站在一起(见
   * cardReplyButton):那是它本来该在的地方。
   */
  function itemActions(anno, isOrphan) {
    var acts = document.createElement("div");
    acts.className = "aipm-anno__item-actions";
    /* 点赞:本机批注没有服务端可言,不显示。 */
    if (!isLocal(anno)) acts.appendChild(likeButton(anno));
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
    return acts;
  }

  /**
   * 卡片右上角的「回复」:一支回勾箭头。与每条回复右端那颗同一张脸、同一个位置
   * 逻辑 —— 谁的回话按钮就贴在谁那一行的右端,回复贴在每条回复的头上,卡片贴在
   * 卡片自己头上。它原先单独落在底部那条操作链里(整张卡的左下角):离它要回的
   * 那句话最远,也和每条回复上那颗错开了一整行。
   *
   * 与 cardTools 分开而不是并进去,是因为可编辑与可回复是两回事:未登录看别人的
   * 批注时,铅笔垃圾桶都不在,这颗回勾箭头还在(见下面的 else 分支)。
   */
  function cardReplyButton(anno) {
    var frag = document.createDocumentFragment();
    if (canReply(anno)) {
      frag.appendChild(
        iconButton(ICON.reply, "回复", "reply", function () {
          startReply(anno);
        })
      );
    } else {
      // 未登录看别人的批注:回复要在服务端落库,得先登录
      frag.appendChild(
        iconButton(ICON.reply, "登录后回复", "reply-login", function () {
          if (auth) auth.loginForDraft(draftForLogin());
        })
      );
    }
    return frag;
  }

  /**
   * 卡片右上角那两颗:铅笔 = 编辑,垃圾桶 = 删除(左边还有一颗回勾箭头,见
   * cardReplyButton)。批注卡与评论卡共用 —— 四个操作各归其位:改色在批注卡
   * 左上角的圆点(评论没有色可改),回复 / 编辑 / 删除都在右上角这一排。
   * 编辑就地展开:点它,那张卡本身变成编辑态,不是另起一张。
   */
  function cardTools(anno) {
    var frag = document.createDocumentFragment();
    if (!canEdit(anno)) return frag;
    var what = isPageComment(anno) ? "评论" : "批注";

    frag.appendChild(
      iconButton(ICON.edit, "编辑这条" + what, "edit", function () {
        startEdit(anno);
      })
    );

    /* 删除用垃圾桶,不用叉。叉是「关掉/算了」的意思,写在卡片右上角,点的人
       多半以为那张卡只是收起来 —— 而它一按就真没了,服务端那条直接就删。垃圾桶
       没有第二种读法,也正好与左边那支铅笔配成一对(编辑 / 删除)。 */
    var del = ibtn(ICON.trash, "删除这条" + what, "delete");
    del.classList.add("is-danger");
    armDelete(del, "删除这条" + what, function () {
      removeAnnotation(anno);
    });
    frag.appendChild(del);
    return frag;
  }

  /**
   * 评论卡。**不复用批注卡的骨架** —— 评论不锚正文,那张卡的顶栏(色点、引文、
   * 可见范围、角标)在这里全是空的,正文也没有高亮可画。评论要的是另一套:
   * 谁、什么时候、说了什么。头像是它的锚点,时间戳是它的顺序感。
   */
  function renderCommentItem(anno) {
    /* 编辑就在原位置进行:轮到这条时直接把卡片换成编辑态,而不是另起一张。 */
    if (editorDraft && editorDraft.kind === "edit" && editorDraft.annoId === anno.id) {
      var editing = materializeEditor();
      if (editing) return editing;
    }

    var wrap = document.createElement("article");
    wrap.className = "aipm-anno__comment";
    wrap.setAttribute("data-anno-id", anno.id);
    /* 不留 data-vis:这一条在哪个分栏里,分栏标题已经写着 —— 卡片上再标一遍是
       同一句话说两次。自己发的留一条左边线,那才是卡片自己要说的。 */
    wrap.setAttribute("data-mine", canEdit(anno) ? "true" : "false");

    var head = commentHead(anno.author, anno.createdAt);
    head.appendChild(spacerNode());
    if (isLocal(anno) && store.serverIdOf(anno.id)) {
      var up = document.createElement("span");
      up.className = "aipm-anno__badge is-quiet";
      up.textContent = "已上传";
      head.appendChild(up);
    }
    head.appendChild(cardReplyButton(anno));
    head.appendChild(cardTools(anno));
    wrap.appendChild(head);

    var bodyText = escapeText(anno.body);
    if (bodyText) {
      var body = document.createElement("p");
      body.className = "aipm-anno__cbody";
      body.textContent = bodyText;
      wrap.appendChild(body);
    }

    var box = repliesBox(anno, { cardFold: true });
    if (box) wrap.appendChild(box);

    var acts = itemActions(anno, false);
    if (acts.childNodes.length > 0) wrap.appendChild(acts);
    return wrap;
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
    top.appendChild(cardReplyButton(anno));
    top.appendChild(cardTools(anno));
    wrap.appendChild(top);

    var quoteText = quoteOf(anno);
    if (quoteText) {
      var q = document.createElement("blockquote");
      q.className = "aipm-anno__item-quote";
      /* 引文是正文里那一笔的副本 —— 点它就是回到正主那儿(见 jumpToPassage)。
         它得是「按钮」那一套的无障碍写法(role + tabindex + 键盘),但不能真做成
         <button>:引文是可以被选中、被复制的一段话,mousedown 被按钮拦下就选不
         动了(面板那条 preventDefault 只对 button 生效,见下面的 mousedown)。 */
      q.setAttribute("role", "button");
      q.setAttribute("tabindex", "0");
      q.title = "跳到正文中的位置";
      q.setAttribute("aria-label", "跳到正文:" + quoteText.slice(0, 60));
      q.appendChild(quoteInk(styleOf(anno), shownQuote(quoteText)));
      wrap.appendChild(q);
    }

    if (bodyText) {
      var body = document.createElement("p");
      body.className = "aipm-anno__item-body";
      body.textContent = bodyText;
      wrap.appendChild(body);
    }

    var box = repliesBox(anno, { cardFold: true, folded: true });
    if (box) wrap.appendChild(box);

    var acts = itemActions(anno, isOrphan);
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

  /** 引文最多铺这么长,再长的截断 —— 卡片是列表里的一条,不是阅读器。 */
  var QUOTE_MAX = 140;

  function shownQuote(text) {
    return text.length > QUOTE_MAX ? text.slice(0, QUOTE_MAX) + "…" : text;
  }

  /**
   * 引文行里那层「画上去的一笔」。
   *
   * 面板里的引文是正文里 <mark> 的副本,所以要长得跟正文里那段话一模一样:高亮 /
   * 划线 / 两者叠加,颜色跟着这条批注走(色值与画法那张表在 CSS 的 9. 正文里的
   * 高亮,两边共用)。
   *
   * 底色与下划线必须落在**行内**的这一层上,不能落在块级的 <blockquote> 上 ——
   * 块级会把它拉成一条通栏色带,只划线那种画法更明显:整行底下一条直线,连字与
   * 字之间的空档也划过去。而正文里那一笔是贴着字的,引文一旦折行就露馅。
   */
  function quoteInk(style, text) {
    var ink = document.createElement("span");
    ink.className = "aipm-anno__quote-ink";
    ink.setAttribute("data-style", style);
    ink.textContent = text;
    return ink;
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

  /* ---- 图标按钮 ----
     回复、编辑、删除这几个动作在所有评论系统里都长着同一张脸(回勾箭头 / 铅笔 /
     垃圾桶),写字反而把一行按钮撑成一行文字。所以它们只出图标:名字挂在 title
     与 aria-label 上 —— 那是这颗按钮唯一的可读副本,两个都得写。 */

  /** 图标按钮的壳:只造按钮,不接行为(删除要两段式,见 armDelete)。 */
  function ibtn(icon, label, action) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "aipm-anno__ibtn";
    b.setAttribute("data-action", action);
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = icon;
    return b;
  }

  /** 点一下就走的那种。 */
  function iconButton(icon, label, action, handler) {
    var b = ibtn(icon, label, action);
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      handler();
    });
    return b;
  }

  /* 删除的二次确认。
     它以前是右上角那颗叉,现在是一颗不带字的垃圾桶 —— 图标按钮比文字链好点错,
     而删掉的东西回不来(服务端那条是直接 DELETE)。所以第一次点只是「上膛」:
     按钮转成警示色、title 改成「再点一次…」;再点一次才真删,点别处或者 4 秒
     没动静就自动放下。不上模态框:为一次删除打断整个面板不值当。 */
  var ARMED_MS = 4000;

  function armDelete(btn, label, onConfirm) {
    var timer = 0;
    function disarm() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      btn.classList.remove("is-armed");
      btn.title = label;
      btn.setAttribute("aria-label", label);
      document.removeEventListener("click", onDoc, true);
    }
    /* 捕获阶段监听:点面板里任何别的地方都算「我改主意了」。点在按钮自己身上
       不算 —— 那正是第二次点击。 */
    function onDoc(e) {
      if (!btn.contains(e.target)) disarm();
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (btn.classList.contains("is-armed")) {
        disarm();
        onConfirm();
        return;
      }
      btn.classList.add("is-armed");
      btn.title = "再点一次" + label;
      btn.setAttribute("aria-label", "再点一次" + label);
      document.addEventListener("click", onDoc, true);
      timer = setTimeout(disarm, ARMED_MS);
    });
    return btn;
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

  /** 悬浮窗上的选中态:画法、颜色各一组。 */
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

  /**
   * 收工具条的**同时**把正文选区撤掉。
   *
   * 光 hideToolbar() 挡不住它在原地弹回来:划词那一步的收尾是往正文里插一层
   * 高亮 <mark>,而选区就在被插的那几个节点之间 —— DOM 一变,浏览器会再报一次
   * selectionchange,选中范围还在正文里,handler 于是又把工具条摆回同一个位置。
   * 用户看到的「挑完颜色它还赖着不走」就是这条回路。
   *
   * 只在动作**已经落地**的地方用(落高亮、开面板);滚页面收工具条时绝不能撤选区,
   * 「重新锚定」靠的就是手里那份还活着的正文选区。
   */
  function clearSelection() {
    var sel = window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
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
    var swatch = e.target.closest(".aipm-anno__swatch");
    if (swatch) {
      /* 选颜色 = 当场落这条高亮(用当前选中的画法)。这是「划词 → 挑个颜色」这条
         最短路径:不打开面板、不要一个字,挑完这段就划上了。要给它配文字的人才
         去点右边那支笔 —— 那条路才开编辑卡。 */
      activeColor = swatch.getAttribute("data-color");
      store.setLastColor(activeColor);
      quickHighlight();
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
    els.draftVisBadge = nodes.visBadge || null;
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
    els.quote = els.swatches = els.visbtn = els.vislist = els.draftVisBadge = null;
    els.input = els.hint = els.cancel = els.save = null;
  }

  /** 把当前编辑器物化成 DOM 并挂上事件。由 render() 调用,每轮至多一次。 */
  function materializeEditor() {
    if (editorDraft === null) return null;
    var nodes;
    if (editorDraft.kind === "reply") nodes = buildReplyEditor(editorDraft);
    else if (isCommentDraft()) nodes = buildCommentEditor(editorDraft);
    else nodes = buildEditor(editorDraft);
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

  /* ---- 评论卡:另一套骨架 ----
     评论不锚正文,所以批注卡顶栏那一排(色点 / 引文 / 可见范围 / 角标)在评论这里
     全是空的。评论要的是另一件事:谁、什么时候、说了什么 —— 头像是它的锚点,
     时间戳是它的顺序感。这套骨架同时给「看评论」和「写评论」用。 */

  /** 撑开一条 flex 行的尾巴,把后面的东西推到右边。 */
  function spacerNode() {
    var sp = document.createElement("span");
    sp.className = "aipm-anno__spacer";
    return sp;
  }

  function loginOf(author) {
    return (author && author.login) || "匿名";
  }

  /**
   * 显示名。GitHub 的 name 是可选的,没填就退回 handle —— 回复列表里挂一串
   * 空白比挂 handle 糟得多。handle 仍然由调用方另给一份(见 replyHead):
   * 显示名可以重名,handle 不会。
   */
  function displayNameOf(author) {
    var name = author && typeof author.name === "string" ? author.name.trim() : "";
    return name || loginOf(author);
  }

  /**
   * 这条回复的作者是不是批注(楼层)的作者本人。githubId 为 0 的是「本机」那份
   * 本地落款,不是任何人的账号 —— 拿它去比对会把所有本机留言判成楼主。
   */
  function isFloorOwner(anno, reply) {
    var owner = anno && anno.author;
    var who = reply && reply.author;
    if (!owner || !who) return false;
    if (!(owner.githubId > 0)) return false;
    return owner.githubId === who.githubId;
  }

  /** 当前用户的作者形状。未登录就是「本机」那份 —— 与 syncComposer 里的落款一致。 */
  function meAuthor() {
    var me = auth && auth.isLoggedIn() ? auth.user() : null;
    return me || { githubId: 0, login: "本机" };
  }

  function initialOf(login) {
    return String(login || "?").charAt(0).toUpperCase();
  }

  /** 2026-09-21 14:03。悬停时给的完整时间,精确到分钟。 */
  function absTime(iso) {
    var t = tsMs(iso);
    if (!t) return "";
    var pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    var d = new Date(t);
    return (
      d.getFullYear() +
      "-" + pad(d.getMonth() + 1) +
      "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) +
      ":" + pad(d.getMinutes())
    );
  }

  /**
   * 相对时间。评论带时间戳,但它该是「3 小时前」而不是一串 ISO ——
   * 超过一周才回落成日期,那时「几天前」已经没什么信息量了。
   */
  function relTime(iso) {
    var t = tsMs(iso);
    if (!t) return "";
    var diff = Date.now() - t;
    if (diff < 0) diff = 0;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return min + " 分钟前";
    var hour = Math.floor(min / 60);
    if (hour < 24) return hour + " 小时前";
    var day = Math.floor(hour / 24);
    if (day < 7) return day + " 天前";
    return absTime(iso).slice(0, 10);
  }

  /** 作者头像。服务端不保证给 avatarUrl,退回首字母圆片;头像挂了也退回去。 */
  function avatarOf(author) {
    var login = loginOf(author);
    var wrap = document.createElement("span");
    wrap.className = "aipm-anno__cavatar";
    var fallback = function () {
      wrap.textContent = initialOf(login);
      wrap.classList.add("is-letter");
    };
    if (author && author.avatarUrl) {
      var img = document.createElement("img");
      img.src = author.avatarUrl;
      img.alt = "";
      img.loading = "lazy";
      // GitHub 头像走的是第三方域,被墙 / 限流时别在顶栏留一块空白
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        fallback();
      });
      wrap.appendChild(img);
    } else {
      fallback();
    }
    return wrap;
  }

  /**
   * 评论顶栏:头像 + 用户名 + 发布时间。`iso` 为空 = 还没有时间可言(正在写),
   * 那时只出头像和用户名 —— 草稿的时间戳是假的,不如不给。
   */
  function commentHead(author, iso) {
    var head = document.createElement("div");
    head.className = "aipm-anno__chead";
    head.appendChild(avatarOf(author));
    var who = document.createElement("span");
    who.className = "aipm-anno__cwho";
    var name = document.createElement("b");
    name.className = "aipm-anno__cname";
    name.textContent = loginOf(author);
    who.appendChild(name);
    if (iso) {
      var t = document.createElement("time");
      t.className = "aipm-anno__ctime";
      t.dateTime = iso;
      t.textContent = relTime(iso);
      t.title = absTime(iso);
      who.appendChild(t);
    }
    head.appendChild(who);
    return head;
  }

  /**
   * 评论编辑卡。它落在「写一条评论」那颗按钮的位置上,骨架与评论卡同形
   * (.aipm-anno__comment)—— 写的时候看到的排版,就是发出去之后的排版。
   *
   * 与批注编辑卡的差别同样是「评论不锚正文」:没有引文、没有色板、没有画法,
   * 只留一颗可见范围按钮(评论一样能只存本机)。
   */
  function buildCommentEditor(opts) {
    var form = document.createElement("form");
    form.className = "aipm-anno__composer";
    form.setAttribute("data-editor", "comment");
    form.noValidate = true;

    var card = document.createElement("article");
    card.className = "aipm-anno__comment is-draft";
    form.appendChild(card);

    var head = commentHead(meAuthor(), null);
    /* 名字那一行只写名字。「这条会落到哪儿」用右上角的角标说 —— 并进名字里的话,
       未登录时会读成「本机 · 仅本机」:两句话各说各的,凑在一起像口吃。 */
    var meta = head.querySelector(".aipm-anno__cname");
    head.appendChild(spacerNode());
    var visBadge = document.createElement("span");
    visBadge.className = "aipm-anno__badge is-quiet";
    head.appendChild(visBadge);
    var badge = document.createElement("span");
    badge.className = "aipm-anno__badge";
    badge.textContent = opts.kind === "edit" ? "编辑中" : "新评论";
    head.appendChild(badge);
    card.appendChild(head);

    var input = document.createElement("textarea");
    input.className = "aipm-anno__input aipm-anno__input--comment";
    input.rows = 3;
    input.setAttribute("aria-label", "评论正文");
    input.placeholder = "写下你的评论…";
    input.value = opts.body || "";
    card.appendChild(input);

    var hint = document.createElement("div");
    hint.className = "aipm-anno__hint";
    hint.hidden = true;
    card.appendChild(hint);

    var actions = document.createElement("div");
    actions.className = "aipm-anno__actions";
    actions.appendChild(spacerNode());

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "aipm-anno__cancel";
    cancel.textContent = "取消";
    actions.appendChild(cancel);

    var save = document.createElement("button");
    save.type = "submit";
    save.className = "aipm-anno__save";
    save.textContent = opts.kind === "edit" ? "保存" : "发表";
    actions.appendChild(save);

    var vis = buildVisPicker();
    actions.appendChild(vis.root);
    card.appendChild(actions);

    return {
      form: form, card: card, dot: null, meta: meta, visBadge: visBadge, quote: null,
      input: input, hint: hint, actions: actions,
      swatches: null, cancel: cancel, save: save,
      visbtn: vis.btn, vislist: vis.list
    };
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
    badge.textContent = kind === "edit" ? "编辑中" : "新批注";
    top.appendChild(badge);
    card.appendChild(top);

    var quote = null;
    if (opts.quote) {
      quote = document.createElement("blockquote");
      quote.className = "aipm-anno__quote";
      quote.appendChild(quoteInk(activeStyle, String(opts.quote).slice(0, 200)));
      card.appendChild(quote);
    }

    var input = document.createElement("textarea");
    input.className = "aipm-anno__input";
    input.rows = 2;
    input.setAttribute("aria-label", "批注正文");
    /* 「可留空」是批注独有的:空正文 = 只划线不写字。评论编辑卡不再走这里,
       它有自己的占位语(见 buildCommentEditor)。 */
    input.placeholder = "写点什么(可留空,只做高亮)…";
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

  /** 划词之后落在「批注」列表里 —— 在「评论」视图里划的词也一样。 */
  function showInAnnotations() {
    if (panelMode !== "comments") return;
    panelMode = "annotations";
    syncMode();
  }

  function startCreate() {
    if (!pendingSelection) return;
    composerSelection = {
      selectors: pendingSelection.selectors,
      quote: pendingSelection.range.toString()
    };
    /* 在「评论」视图里划词加批注:先把视图切回「批注」。否则这条新建的批注落在
       一个只列整页评论的列表里 —— 卡片会被筛掉,用户看到的就是「点了没反应」。 */
    showInAnnotations();
    beginEditor({ kind: "create", quote: composerSelection.quote });
  }

  /**
   * 划词之后直接挑了个颜色:当场落一条**只有高亮、没有文字**的批注。不开面板,
   * 也不要用户输一个字 —— 「把这段划出来」本身就是完整的动作。
   *
   * 正文为空是服务端明确允许的(见 annotations.ts 的 normalizeBody:智能高亮落的
   * 就是这种批注),所以这条路没有绕开任何校验。想给这段配文字的人走笔那条路
   * (startCreate → 编辑卡),落库前还能改颜色、改范围。
   */
  function quickHighlight() {
    if (!pendingSelection) return;
    var selectors = pendingSelection.selectors;
    var visibility = defaultVisibility();
    hideToolbar();
    /* 这一条是**已经完成**的动作,选区留着只会把工具条再招回来(见 clearSelection),
       顺手点第二下的人还会在同一段上叠出第二条。 */
    clearSelection();
    showInAnnotations();
    /* 落上了就落上了,不再弹一条「已高亮 · 仅本机」的道贺:高亮当场画在正文里,
       看得见,那句话只是把视线从被划的那段拉到屏幕底下去。 */
    submitAnnotation(selectors, "", visibility, false);
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
    /* 在折起来的卡上点「回复」,等于说要看这块回复区 —— 把它摊开,不然输入框
       落在一块没有任何出处的空白里。 */
    replyViewOf(anno.id).folded = false;
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
    /* 色板与色点是「批注怎么画」那一套,评论编辑卡没有 —— 两边各自缺什么就跳什么。 */
    if (els.swatches) {
      var swatches = els.swatches.querySelectorAll(".aipm-anno__swatch");
      for (var i = 0; i < swatches.length; i++) {
        swatches[i].classList.toggle(
          "is-active",
          swatches[i].getAttribute("data-color") === activeColor
        );
      }
    }
    if (els.draftDot) {
      els.draft.setAttribute("data-color", activeColor);
      els.draft.setAttribute("data-style", activeStyle);
      els.draftDot.setAttribute("data-color", activeColor);
    }
    var vis = defaultVisibility();
    var label = visLabel({ visibility: vis });
    var loggedIn = auth ? auth.isLoggedIn() : false;
    var me = loggedIn && auth.user() ? auth.user().login : "";
    /* 可见范围落在哪儿:批注草稿卡并进名字那一行(「名字 · 公开」),评论编辑卡
       没有那行位置,改用右上角的角标 —— 名字那一行就只剩名字。 */
    if (els.draftVisBadge) {
      els.draftMeta.textContent = me || "本机";
      els.draftVisBadge.textContent = label.text;
    } else {
      els.draftMeta.textContent = (me || "本机") + " · " + label.text;
    }
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

  /**
   * 服务端出错时给一句人话。status 0 是 store.request 对「根本没连上」的约定值
   * (见它的 catch)—— 把 0 直接拼进「保存失败:0」等于什么都没说,而快速高亮这条路
   * 只剩这一句话能解释「为什么没划上」。
   */
  function serverFailText(prefix, res) {
    if (res.status === 0) return "连不上批注服务,请稍后再试。";
    return prefix + ":" + ((res.body && res.body.message) || res.status);
  }

  function setHint(text) {
    /* 没有编辑卡时 els.hint 是空的 —— 快速高亮、上传、重新锚定这几条路都可能在
       面板里没开着编辑卡的时候失败,原来那些话因此一句都没人看见。改落到 toast 上。 */
    if (!els.hint) {
      flash(text, "warn");
      return;
    }
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
    /* 批注可以「只有高亮、没有文字」,评论不行 —— 一条没有正文的评论在列表里
       是一块空白。回复同理(见上)。 */
    if (isPage && !body) {
      setHint("评论不能是空的。");
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
    /* 先放开落点再发:发完的那次重渲染才不会把新回复自己藏起来。 */
    openReplyTarget(anno, parentId);
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
          setHint(serverFailText("保存失败", res));
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
          setHint(serverFailText("修改失败", res));
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
  /* 判分请求进行中。页头那颗按钮靠 disabled 挡住连点,面板页头那支笔没有 disabled
     可言,所以这里另记一笔 —— 重新生成一次就是一轮真金白银的 provider 调用,连点
     两下会让第二下也走一遍「缓存未命中」,多花一次钱。 */
  var smartBusy = false;
  /* 条子当前说的是哪一页。instant 导航只换内容容器,面板与条子都留在原地 ——
     不记这一笔,换页后条子会继续挂上一页的回执(用户验收意见:「通知不会随着
     页面切换而切换」)。 */
  var smartbarPage = null;
  /* 用户亲手关掉条子的那一页。换页时条子要跟着换(见 syncSmartbar),但**用户
     自己关掉的**不能再自作主张弹回来 —— 这两件事都表现为「条子不见了」,得分开记。 */
  var smartbarDismissed = null;

  /**
   * 抽本页的候选块。
   *
   * `includeMarked` 为真时连已经划过高亮的块也一并返回 —— 换页回来重建建议条时
   * 要按块 id 把 Range 重绑到当前 DOM 上(见 withLiveBlocks),落过高亮的块若被
   * 跳过,它在建议里就「不存在」,一条已落过一半的页面会被显示成「本页没有值得
   * 高亮的地方」。送去判分那条路照旧不带它(已高亮的段落不必再判一次)。
   */
  function extractBlocks(includeMarked) {
    var root = contentRoot();
    var nodes = root.querySelectorAll(BLOCK_SELECTOR);
    var out = [];
    var seq = 0;
    var totalChars = 0;
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
      if (!includeMarked && el.querySelector("mark.aipm-anno-mark")) continue;
      /* 页脚那一段(「发现错误?想一起完善?…本页面的全部内容在…协议下提供」,
         partials/comments.html)是主题模板文字,不是页面正文 —— 站内正文索引按
         page.content 建,里面没有它,送去判分只会被服务端按「不属于该页」退掉。
         判断放在编号之后,理由与上面那条一样:id↔段落的映射不随这次改动漂移,
         否则别人缓存里的建议会落到错的段落上。 */
      if (el.closest(".page-copyright")) continue;
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      var clipped = text.length > MAX_BLOCK_CHARS ? text.slice(0, MAX_BLOCK_CHARS) : text;
      // 到顶就停(而不是跳过该块继续找短的):块的 id 是位置序号,继续找会让
      // 「哪些块被送出去」依赖文本长短,反而更难解释。停在整页靠前的位置更可预期。
      if (totalChars + clipped.length > MAX_BLOCK_TOTAL_CHARS) break;
      totalChars += clipped.length;
      var range = document.createRange();
      range.selectNodeContents(el);
      out.push({ id: id, text: clipped, range: range });
    }
    return out;
  }

  /** 判分进行中时两颗入口一起收:页头那颗按钮用 disabled,面板页头那支笔用 is-busy。 */
  function setSmartBusy(on) {
    smartBusy = on;
    smartBtn.disabled = on;
    els.headIcon.classList.toggle("is-busy", on);
  }

  /**
   * 站长(服务端 ADMIN_LOGINS)多一项「重新生成智能高亮」,触发点就是面板页头那支
   * 笔 —— 它平时只是一枚图标,对站长才是一颗开关。
   *
   * 身份决定要不要补上按钮的那套属性:是 → role + tabindex + 标题,并带上
   * .aipm-anno__iconbtn 与 is-regenerate(命中区、悬停底色与焦点圈见
   * annotation.css);否 → 逐个撤掉。未登录 → 登录 → 退出登录这条来回里标记必须
   * 跟着身份走,否则非站长手上会留下一颗点下去必然 403 的按钮。
   *
   * 「不是站长」不用 disabled 表达:disabled 说的是「按不动」,这里要说的是
   * 「这颗图标不是按钮」。
   */
  function syncHeadIcon() {
    var on = !!(auth && auth.isAdmin && auth.isAdmin());
    els.headIcon.classList.toggle("is-regenerate", on);
    els.headIcon.classList.toggle("aipm-anno__iconbtn", on);
    if (on) {
      els.headIcon.setAttribute("role", "button");
      els.headIcon.setAttribute("tabindex", "0");
      els.headIcon.title = "重新生成智能高亮(重新判分并覆盖本页缓存)";
      els.headIcon.setAttribute("aria-label", "重新生成智能高亮");
    } else {
      els.headIcon.removeAttribute("role");
      els.headIcon.removeAttribute("tabindex");
      els.headIcon.removeAttribute("title");
      els.headIcon.removeAttribute("aria-label");
    }
  }

  /**
   * 判这一页的正文。
   *
   * 默认先读缓存:页内已有的那份结果(本次会话点过一次)直接摆回来,服务端那层
   * 同页缓存也照样命中 —— 一次判分的结果不该因为第二次点而被重算一遍。
   *
   * `opts.refresh` 是站长在面板页头那支笔上点的「重新生成」:跳过这两层缓存、
   * 让服务端重新判分并覆盖它那份缓存(见 syncHeadIcon)。
   */
  function smartHighlight(opts) {
    var refresh = !!(opts && opts.refresh);
    /* 判的是正文,评论模式下没有正文可判。按钮挂在页头上一直可见,所以这里不再是
       「够到也白搭地返回」,而是把面板切回批注模式 —— 用户点的是「给这一页划线」,
       回执(智能高亮条与那两颗「全部高亮 / 全部关闭」)也长在批注那一份列表里。 */
    if (panelMode !== "annotations") {
      panelMode = "annotations";
      editorDraft = null;
      composerSelection = null;
      syncMode();
      render();
    }
    /* 回执落在面板里的智能高亮条上,面板关着的话点了等于没反应 —— 先把它叫出来。
       移动端还得多一步:抽屉停在 peek 那一条上时,智能高亮条是被 .is-compact
       压成 opacity:0 的,得展开到第三段才看得见(与写批注那条路一致)。 */
    revealPanel();
    /* 选区也一并撤掉:这一条判的是整页正文,跟用户手上选中的那一段无关,而它接下来
       要往正文里插一整批 <mark> —— DOM 一动,浏览器再报一次 selectionchange,选区
       还在正文里的话,刚收起的悬浮窗又会被摆回面板前面(见 clearSelection)。 */
    clearSelection();
    if (mode === "sheet") setSnap("expanded", false);
    if (smartBusy) return;
    var now = Date.now();
    if (now < cooldownUntil) {
      setSmartbar(
        "刚请求过,请等 " + Math.ceil((cooldownUntil - now) / 1000) + " 秒后再试。",
        "warn"
      );
      return;
    }
    var page = pagePath();
    if (!refresh && suggestCache[page]) {
      renderSuggestions(suggestCache[page]);
      return;
    }
    var blocks = extractBlocks();
    if (blocks.length === 0) {
      setSmartbar("这一页没有可判定的正文。", "warn");
      return;
    }
    setSmartbar(
      refresh
        ? "正在重新生成…(共 " + blocks.length + " 段)"
        : "正在分析这一页…(共 " + blocks.length + " 段)",
      "busy"
    );
    setSmartBusy(true);
    store
      .request("/api/highlight/suggest", {
        method: "POST",
        /* 重新生成要认人:服务端只放站长过,所以这一条得带上会话。普通判分匿名即可,
           未登录时 token() 为 null,请求头里不带 Authorization —— 与今天一样。 */
        token: auth && auth.token ? auth.token() : null,
        body: {
          page: page,
          title: pageTitle(),
          palette: store.PALETTE.map(function (p) {
            return { id: p.id, label: p.label, when: p.when };
          }),
          blocks: blocks.map(function (b) {
            return { id: b.id, text: b.text };
          }),
          judge: "auto",
          refresh: refresh
        }
      })
      .then(function (res) {
        setSmartBusy(false);
        /* 服务端那两道路闸(未登录 / 不是站长)。界面上这颗笔只对站长可点,所以走到
           这里通常意味着会话在这中间过期了 —— 如实说一句,别把 403 念成「失败」。 */
        if (res.status === 401 || res.status === 403) {
          setSmartbar("重新生成仅限站长使用,请重新登录后再试。", "warn");
          return;
        }
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
          /* 两种 503 要分开对待,否则用户只能刷新页面:
             - not_configured 是服务端没配判分密钥,重试永远不会好 → 停掉按钮;
             - 其余(片全挂 / 排队满)是暂时性的 → 按 Retry-After 冷却,按钮留着。 */
          if (res.body && res.body.error === "highlight_not_configured") {
            setSmartbar("智能高亮未启用(服务端缺少判分密钥),批注功能不受影响。", "warn");
            smartBtn.disabled = true;
            return;
          }
          var retry503 =
            res.headers && res.headers.get ? Number(res.headers.get("retry-after")) : 0;
          cooldownUntil = Date.now() + (retry503 > 0 ? retry503 * 1000 : 30000);
          setSmartbar(
            (res.body && res.body.message) || "智能高亮暂时不可用,请稍后再试。",
            "warn"
          );
          return;
        }
        if (!res.ok) {
          // status 0 = 请求根本没发出去(断网/被拦截),别把 0 当状态码念给用户听
          if (res.status === 0) {
            setSmartbar("网络异常,连不上智能高亮服务,请检查网络后重试。", "warn");
            return;
          }
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
      smartbarPage = null;
      return;
    }
    smartbarPage = pagePath();
    smartbarDismissed = null;
    els.smartbar.hidden = false;
    els.smartbar.setAttribute("data-kind", kind || "");
    /* 正文得单独包一层:直接写 textContent 的话,它是一个**匿名 flex 项**,
       最小宽度绑在内容上 —— 长通知会把自己撑到内容宽,把右端那颗关闭按钮顶出
       条子外面,点不着(见 CSS 里 .aipm-anno__smart-text 的 min-width:0)。 */
    els.smartbar.textContent = "";
    var line = document.createElement("span");
    line.className = "aipm-anno__smart-text";
    line.textContent = text;
    els.smartbar.appendChild(line);
    els.smartbar.appendChild(smartClose);
  }

  function sourceLabel(source) {
    if (source === "jev") return "Jev";
    if (source === "llm") return "备用模型";
    return "规则";
  }

  /**
   * 条子上那半句「来源」。
   *
   * 一律以服务端回的**模型 id** 为准(jev-1.13.0 / deepseek-flash …):写死
   * provider 名字会撒谎 —— 兜底那一路是个可配的 Anthropic 兼容端点,线上指到
   * DeepSeek 时,条子上却印着「来源 Claude」,后面还跟着一个 deepseek-flash,
   * 自相矛盾(用户验收意见里那张图)。只有拿不到模型 id 时才退回 provider 名。
   */
  function judgeLabel(payload) {
    return payload.model ? String(payload.model) : sourceLabel(payload.judge);
  }

  /**
   * 把 payload 里的块 Range 重绑到**当前**这份 DOM 上。
   *
   * payload 可能来自缓存(甚至是上一页的缓存),里面的 Range 指向早已脱离文档的
   * 旧节点 —— 拿它去落高亮会落到虚空中。块 id 是文档里的位置序号,同页同内容时
   * 稳定(见 extractBlocks),所以按 id 重绑即可。绑不上的块(页面改了、块被删了)
   * 直接丢掉:宁可不给这条建议,也不要落在错段落上。
   */
  function withLiveBlocks(payload) {
    var live = {};
    extractBlocks(true).forEach(function (b) {
      live[b.id] = b.range;
    });
    var blocks = [];
    (payload.blocks || []).forEach(function (b) {
      if (live[b.id]) blocks.push({ id: b.id, text: b.text, range: live[b.id] });
    });
    var out = {};
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) out[k] = payload[k];
    }
    out.blocks = blocks;
    return out;
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

  /** 服务端 degraded 的理由 → 人话。未知理由按「服务暂时不可用」兜底(宁可多说)。 */
  var REASON_TEXT = {
    not_in_page: "不属于本页正文",
    no_answer: "服务没给这一段结论",
    budget_exhausted: "今日预算已用完",
    over_page_limit: "超出每页建议上限",
    not_worth: "不值得高亮",
    below_threshold: "不值得高亮",
    too_short: "过短",
    unreadable: "纯符号或数字",
    code: "代码块",
    navigation: "导航与目录",
    duplicate: "与本页其他段落重复",
    rate_limited: "服务被限流",
    timeout: "服务超时",
    shape: "服务返回的格式读不懂",
    unavailable: "服务暂时不可用"
  };

  /* 上面这些里,「本来就不该给建议」的那几种:不计进「没能判定」。 */
  var DELIBERATE_SKIP = {
    too_short: 1,
    unreadable: 1,
    code: 1,
    navigation: 1,
    duplicate: 1,
    not_worth: 1,
    below_threshold: 1,
    over_page_limit: 1
  };

  function reasonLabel(reason) {
    var code = String(reason || "").split(":")[0];
    return REASON_TEXT[code] || "服务暂时不可用";
  }

  /**
   * 智能高亮条只有两态:还能落 → 「全部高亮(N)」,已经落过 → 「全部关闭(N)」。
   * 建议不在这里逐条罗列(用户验收意见:一条条列出来太吵),落库后它们就是
   * 面板列表里普通的「仅本机」条目,和手写的批注一样可以编辑、改色、上传。
   */
  function renderSuggestions(payload, page) {
    payload = withLiveBlocks(payload);
    smartbarPage = page || pagePath();
    smartbarDismissed = null;
    els.smartbar.hidden = false;
    els.smartbar.setAttribute("data-kind", "result");
    els.smartbar.textContent = "";

    var head = document.createElement("div");
    head.className = "aipm-anno__smart-head";
    /* 逐段 append 而不是拼一个字符串:括号里那截要能**整体换行**(见 CSS 的
       .aipm-anno__smart-why),整句写成一串文本时,窄面板下会断在「不可」和「用」
       之间。文本节点一律用 createTextNode / textContent 拼,不拼 HTML 字符串。 */
    head.appendChild(document.createTextNode("智能高亮 · " + judgeLabel(payload)));
    // 回退现在只在主选真失败时发生(超时/限流/HTTP/形状),所以这句是陈述事实的
    if (payload.fallbackFrom) {
      var why = document.createElement("span");
      why.className = "aipm-anno__smart-why";
      why.textContent = "(" + sourceLabel(payload.fallbackFrom) + " 不可用)";
      head.appendChild(document.createTextNode(" "));
      head.appendChild(why);
    }
    if (payload.cached) head.appendChild(document.createTextNode(" 缓存"));
    head.title = head.textContent;
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

    /* 「N 段未判定」只在**真出了问题**时才说。过短、纯符号、代码块、导航目录、
       与本页其他段落重复、「不值得高亮」、超出每页上限 —— 这些都是刻意不给建议的
       段落,数量还随页面结构浮动(首页随手一判就有十来个)。把它们计成一个
       「10 段未判定」摆出来,只会让人以为功能坏了(用户验收意见:「10 段未判定
       又是什么鬼」)。真正的失败才提示,原因摊在 tooltip 里。 */
    var misses = {};
    var missTotal = 0;
    (payload.degraded || []).forEach(function (d) {
      var code = String(d.reason || "").split(":")[0];
      if (!code || DELIBERATE_SKIP[code]) return;
      misses[code] = (misses[code] || 0) + 1;
      missTotal++;
    });
    var missCodes = Object.keys(misses);
    if (missCodes.length > 0) {
      var note = document.createElement("span");
      note.className = "aipm-anno__smart-note";
      note.textContent = missTotal + " 段没能判定";
      note.title =
        "这些段落没拿到结论:" +
        missCodes
          .map(function (c) {
            return reasonLabel(c) + (misses[c] > 1 ? " ×" + misses[c] : "");
          })
          .join("、") +
        "。";
      els.smartbar.appendChild(note);
    }
    els.smartbar.appendChild(smartClose);
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

  /** 标题就是模式开关 —— 它写着什么,列表里就是什么。

      只改 label span 的 textContent:按钮里还有那颗双向箭头,整颗重写 innerHTML
      会把图标一起抹掉。aria 三件套跟着当前模式走 —— 读屏听到的应该是**点下去
      会发生什么**(切到评论),而不是一句恒定的「切换批注与评论」。 */
  function syncMode() {
    var isComments = panelMode === "comments";
    var label = isComments ? "评论" : "批注";
    var hint = isComments ? "切回批注(锚在正文某一段上)" : "切到评论(对整页说话)";
    els.titleLabel.textContent = label;
    els.title.title = hint;
    els.title.setAttribute("aria-label", hint);
    els.title.setAttribute("aria-pressed", isComments ? "true" : "false");
    /* 智能高亮条长在批注那一份列表里(它说的「全部高亮」就是正文里的划线),
       切到评论就把残留的那一条收掉。按钮本身不跟着藏 —— 它在页头上,点击时会把
       面板切回批注模式(见 smartHighlight)。 */
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
      showPatch[groupShownKey(group)] = prefs[groupShownKey(group)] === false;
      /* 随意显隐,不做「至少留一栏」的拦截:眼睛收走的是栏的**内容**而不是栏本身,
         三个标题与眼睛一直留在那儿(见 render 的分组循环),点哪只都能回来。 */
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
      /* 全页评论与划词批注的恢复路径不同(前者没有选区,得回到「写一条评论」那颗
         按钮的位置上),往返一趟不能把这件事忘掉。 */
      scope: isCommentDraft() ? "page" : null,
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
      page: draft.scope === "page",
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

  smartBtn.addEventListener("click", function () {
    smartHighlight();
  });

  /* 面板页头那支笔:站长点它是「重新生成」(见 syncHeadIcon),其余时候点它没有
     任何反应。用 click + keydown 两条而不是把它换成 <button> —— 它同时是这面板的
     图标,换成按钮之后非站长那边还得为 disabled 与焦点补一套只对站长有意义的样式。
     两条都先问一遍身份:监听器常驻,身份却是会变的。 */
  function headIconRegenerate() {
    if (!(auth && auth.isAdmin && auth.isAdmin())) return;
    smartHighlight({ refresh: true });
  }
  els.headIcon.addEventListener("click", headIconRegenerate);
  els.headIcon.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    headIconRegenerate();
  });

  /* ================================================================
     面板 ↔ 正文:两头的定位
     ----------------------------------------------------------------
     一条批注同时出现在两处:正文里那一笔,和面板里的那张卡(引文是它的副本)。
     两边都点得回去 —— 点正文里那一笔落到卡上,点卡上的引文落回正文。
     ================================================================ */

  /**
   * 这条批注在正文里的落点。
   *
   * 两级:先是它自己那一笔 <mark>;没有的话退到文字所在的那个块。后一档对应
   * 「锚到了、但那段文字已被别人的高亮占住」—— 同一句话被两个人划线是常见情况,
   * markRange 画不出第二笔,于是这条进了「未在正文中定位」。可文字明明就在页面
   * 上,跳过去仍然是对的,只是那一笔不在它名下。两样都没有才是真没定位到。
   */
  function passageAnchor(anno) {
    var mark = document.querySelector('mark.aipm-anno-mark[data-anno-id="' + anno.id + '"]');
    if (mark) return mark;
    var range = resolved[anno.id];
    if (!range) return null;
    var node = range.startContainer;
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    return el && el.closest ? el.closest(BLOCK_SELECTOR) : null;
  }

  /**
   * 点引文 → 跳回正文里那一段。
   *
   * 手机上面板是一张抽屉:半开或近全屏时正文正压在它底下,直接滚过去会「跳了
   * 等于没跳」。所以先把抽屉收回头一档(peek),落点才在面板外面。桌面停靠是
   * 并排的(页面让开一条,见 CSS 的 3.1),不必动。
   */
  function jumpToPassage(anno) {
    var target = passageAnchor(anno);
    if (!target) {
      flash("这条批注没能在正文里定位到位置,跳不过去。", "warn");
      return;
    }
    if (mode === "sheet" && snap !== "peek") setSnap("peek");
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("aipm-anno-flash");
    setTimeout(function () {
      target.classList.remove("aipm-anno-flash");
    }, 900);
  }

  /** 从引文元素找回它那条批注,再跳。 */
  function jumpFromQuote(q) {
    var card = q.closest("[data-anno-id]");
    var anno = card ? annoById(card.getAttribute("data-anno-id")) : null;
    if (anno !== null) jumpToPassage(anno);
  }

  /* 引文整块是「回去」的入口。事件挂在列表上而不是逐张卡上:列表每一轮 render
     都整个重建,逐卡挂事件会在重建时漏掉。

     两道闸门拦的都是同一件事:引文是可以被选中、复制走的一段话,拖选完松手不该
     跳走 ——
       · 指针挪过窝的(按下与松开之间超过 4px)不算点击。手滑到文字末尾之外松手时
         浏览器会把选区收回去(实测:同一个拖拽落在字符上会选中、落在那行文字的
         空白处会收成光标),光看选区拦不住,所以还得看指针。4px 与抽屉拖拽同一档;
       · 选区落在引文里的也不算 —— 双击选词时指针根本没动,只有这条拦得住。 */
  var quotePress = null;
  els.list.addEventListener("pointerdown", function (e) {
    quotePress =
      e.target.closest && e.target.closest(".aipm-anno__item-quote")
        ? { x: e.clientX, y: e.clientY }
        : null;
  });
  els.list.addEventListener("click", function (e) {
    var q = e.target.closest ? e.target.closest(".aipm-anno__item-quote") : null;
    if (!q) return;
    var dragged =
      quotePress !== null &&
      (Math.abs(e.clientX - quotePress.x) > 4 || Math.abs(e.clientY - quotePress.y) > 4);
    quotePress = null;
    if (dragged) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && q.contains(sel.anchorNode)) return;
    jumpFromQuote(q);
  });
  /* 键盘走同一条路:引文是 role="button",回车与空格都得算数。 */
  els.list.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var q = e.target.closest ? e.target.closest(".aipm-anno__item-quote") : null;
    if (!q) return;
    e.preventDefault();
    jumpFromQuote(q);
  });

  /* ---- 反方向:正文里那一笔 → 面板里那张卡 ---- */
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
  /**
   * 换页时把建议条/通知对齐到新页。
   *
   * instant 导航换的是内容容器,面板和条子都留在原地 —— 不管它,新页面上会继续
   * 挂着上一页的回执(「全部高亮(12)」说的其实是上一页)。这里:新页有缓存就把
   * 自己那条结果摆出来(块 Range 由 renderSuggestions 重绑到当前 DOM),没有就
   * 收起;用户自己关掉的条子(点过叉)不再自作主张弹回来。
   */
  function syncSmartbar() {
    var page = pagePath();
    if (smartbarPage === page && !els.smartbar.hidden) return;
    /* 这一页上用户亲手关过:收着,别弹回来。换到没关过的页面则照常处理 ——
       「关掉」是对那一页说的,不是对整站说的。 */
    if (smartbarDismissed === page) return;
    var cached = suggestCache[page];
    if (cached) {
      renderSuggestions(cached, page);
    } else if (!els.smartbar.hidden) {
      setSmartbar("", "");
    }
  }

  function onPageChange() {
    mountEntry();
    hideToolbar();
    syncSmartbar();
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

  /* 正文一滚,工具条就该收 —— 它是 position: fixed 的,锚点(被划的那段话)却跟着
     页面走了,留着就是一扇钉在屏幕上、跟当前正文已经无关的浮窗,还压在页头与面板
     上面(用户报的「一直悬浮在那里」)。选区本身不动:要「重新锚定」的人手里还是
     那段话,只是画法/颜色那几颗按钮先收起来。

     判据是「这个滚动容器里有没有锚点」,不是「有没有发生滚动」:侧栏、目录、面板
     自己的列表滚起来,锚点纹丝不动,工具条收掉才是错的。scroll 不冒泡,所以挂在
     window 的捕获相上,一次收齐所有滚动容器。 */
  window.addEventListener(
    "scroll",
    function (e) {
      if (toolbar.hidden || !pendingSelection) return;
      var target = e.target;
      if (target === document || target === window) {
        hideToolbar();
        return;
      }
      if (!target || target.nodeType !== 1) return;
      var anchor = pendingSelection.range.startContainer;
      if (target === anchor || target.contains(anchor)) hideToolbar();
    },
    { capture: true, passive: true }
  );

  var onViewportChange = function () {
    /* 视口一变(窗口缩放、转屏、停靠↔抽屉换形态),正文跟着重排,工具条钉住的那个
       坐标就跟它要标的那句话对不上了 —— 与滚动同一条道理,一并收掉。 */
    hideToolbar();
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
      syncHeadIcon();
      if (auth.isLoggedIn()) invalidate();
      if (open) ensureAnnotationsLoaded();
    });
    auth.onChange(function () {
      syncComposer();
      syncHeadIcon();
    });
  }

  mountEntry();
  syncMode();
  syncComposer();
  applyMode();
})();
