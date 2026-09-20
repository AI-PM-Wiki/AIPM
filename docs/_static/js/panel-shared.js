/*
  AI-PM 面板共享件(panel-shared.js,2026-09-20)

  AI 助手面板(#aipm-chat)与批注面板(#aipm-annotations)占同一块屏幕区域
  (桌面右侧停靠 / 移动三段抽屉),同一时刻只能有一个存在。这个文件收两件公共事,
  免得两个面板各抄一份、日后改一处漏一处:

  1. 互斥注册表 window.__aipmPanels
     每个面板注册 {open, close, isOpen}。claim(name) 打开自己的同时关掉另一个,
     于是「点 FAB 从批注切到助手」「点页头按钮从助手切回批注」是同一个动作。
     切换在一个同步任务里完成(先关后开),浏览器只画一帧,页面宽度不跳。

  2. 三段抽屉的拖拽与吸附 attachSheetDrag()
     pointer 事件统一处理触摸/鼠标/触控笔:4px 阈值后才算拖拽、跟手高度、
     速度采样、松手按速度或最近停靠点吸附、下拉过阈值即关闭。
     几何仍由各面板自己算(助手有输入条、批注有列表,peek 高度不同),
     共享件只吃 metrics() 回调。

  两个文件都是 IIFE,通过 window 上挂一个命名空间协作 —— 资源列表里
  panel-shared.js 必须排在两个面板脚本之前(见 mkdocs.yml extra_javascript)。
*/
(function () {
  "use strict";

  var ORDER = ["peek", "half", "expanded"];

  /* ================================================================
     纯函数(可被单测直接调用)
     ================================================================ */

  /** 沿停靠点顺序走一步,夹在两端。 */
  function stepSnap(order, from, dir) {
    var i = order.indexOf(from);
    return order[Math.min(Math.max(i + dir, 0), order.length - 1)];
  }

  /** 离当前高度最近的停靠点。 */
  function nearestSnap(order, metrics, h) {
    var best = order[0];
    var bd = Infinity;
    for (var i = 0; i < order.length; i++) {
      var d = Math.abs(metrics[order[i]] - h);
      if (d < bd) {
        bd = d;
        best = order[i];
      }
    }
    return best;
  }

  /** 指针速度(px/ms,上滑为正):只取最近 120ms 的采样,避免长拖被均值拖平。 */
  function velocity(samples) {
    if (!samples || samples.length < 2) return 0;
    var last = samples[samples.length - 1];
    var recent = samples.filter(function (s) {
      return last.t - s.t <= 120;
    });
    var a = recent[0] || samples[0];
    var dt = last.t - a.t;
    if (dt <= 0) return 0;
    return (a.y - last.y) / dt;
  }

  /**
   * 三段高度:peek 由调用方实测(视觉上贴合内容)、half 按视口比例、
   * expanded 按可视区高(软键盘弹出时 visualViewport 更小)减顶部间隙。
   */
  function computeMetrics(opts) {
    var vh = opts.vh;
    var visible = typeof opts.visible === "number" ? opts.visible : vh;
    var peekMin = opts.peekMin;
    return {
      peek: Math.max(peekMin, Math.round(opts.peek)),
      half: Math.max(peekMin, Math.round(vh * opts.halfVh)),
      expanded: Math.max(peekMin, Math.round(visible - opts.topGap))
    };
  }

  /** 视口与可视区高(软键盘适配用)。 */
  function viewportHeights() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var vv = window.visualViewport;
    return { vh: vh, visible: vv ? Math.round(vv.height) : vh };
  }

  /** 经典滚动条宽度:面板让开滚动条,页面收窄量与之对齐。 */
  function scrollbarWidth() {
    var w = window.innerWidth - document.documentElement.clientWidth;
    return w > 0 ? Math.round(w) : 0;
  }

  /* ================================================================
     拖拽会话
     ================================================================ */

  /**
   * 给一个三段抽屉面板接上拖拽与吸附。
   *
   * opts:
   *   panel            面板根节点
   *   gripSelector     手柄选择器(任意位置可拖)
   *   headSelector     头部选择器(空白处可拖,按钮上不拖)
   *   order            停靠点顺序,默认 ["peek","half","expanded"]
   *   snapMs           吸附动画时长(与 CSS --aipm-chat-dur 对齐)
   *   minHeight        拖拽下限(再往下就是关闭)
   *   closeRatio       下拉到 peek 的该比例以下即关闭
   *   swipeV           快速滑动阈值(px/ms)
   *   isActive()       当前是否处于抽屉形态且面板已打开
   *   getMetrics()     → {peek, half, expanded}
   *   getSnap()        当前停靠点
   *   setSnap(next, afterDrag)
   *   isCompact(h, m)  是否该进「内容淡出」态(默认:低于 peek 与 half 的中点)
   *   onCompactChange(compact)
   *   onDragStart() / onDragEnd()
   *   markSnapping()   吸附期间打标(消息区上缘渐隐)
   *   clearDragHeight()
   *   onClose(via)
   * 返回 {isDragging(), isSuppressingClick()}
   */
  function attachSheetDrag(opts) {
    var panel = opts.panel;
    var order = opts.order || ORDER;
    var snapMs = typeof opts.snapMs === "number" ? opts.snapMs : 240;
    var minHeight = typeof opts.minHeight === "number" ? opts.minHeight : 56;
    var closeRatio = typeof opts.closeRatio === "number" ? opts.closeRatio : 0.6;
    var swipeV = typeof opts.swipeV === "number" ? opts.swipeV : 0.45;

    var drag = null;
    var suppressClick = false;
    var suppressTimer = 0;

    function inDragZone(t) {
      if (!t || !t.closest) return false;
      if (opts.gripSelector && t.closest(opts.gripSelector)) return true;
      return !!(
        opts.headSelector &&
        t.closest(opts.headSelector) &&
        !t.closest("button")
      );
    }

    function onDown(e) {
      if (!opts.isActive() || drag) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!inDragZone(e.target)) return;
      var rect = panel.getBoundingClientRect();
      if (opts.onCompactChange) opts.onCompactChange(false);
      drag = {
        id: e.pointerId,
        y0: e.clientY,
        h0: rect.height,
        h: rect.height, // 跟手高度:松手判定用它,避免再强制布局测量
        from: opts.getSnap(),
        moved: false,
        compact: false,
        samples: [{ y: e.clientY, t: e.timeStamp }]
      };
    }

    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = drag.y0 - e.clientY; // 上滑为正
      if (!drag.moved) {
        if (Math.abs(dy) < 4) return;
        drag.moved = true;
        panel.classList.add("is-dragging");
        if (opts.onDragStart) opts.onDragStart();
        try {
          panel.setPointerCapture(e.pointerId);
        } catch (err) {
          /* 指针已失效等场景静默 */
        }
      }
      e.preventDefault();
      var m = opts.getMetrics();
      var h = Math.min(Math.max(drag.h0 + dy, minHeight), m.expanded);
      drag.h = h;
      panel.style.height = h + "px";
      // 跟手期间压掉 CSS 的 peek 保底,否则缩不下去
      panel.style.minHeight = h + "px";
      var compact = opts.isCompact
        ? opts.isCompact(h, m)
        : h < (m.peek + m.half) / 2;
      if (compact !== drag.compact) {
        drag.compact = compact;
        if (opts.onCompactChange) opts.onCompactChange(compact);
      }
      drag.samples.push({ y: e.clientY, t: e.timeStamp });
      if (drag.samples.length > 8) drag.samples.shift();
    }

    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      try {
        panel.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* 静默 */
      }
      if (opts.onCompactChange) opts.onCompactChange(false);
      if (opts.onDragEnd) opts.onDragEnd();
      if (!d.moved) {
        panel.classList.remove("is-dragging");
        return; // 未移动 = 点击,交给 click 处理
      }
      var m = opts.getMetrics();
      var v = velocity(d.samples);
      // 拖完松手别触发「点击切换停靠点」
      suppressClick = true;
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(function () {
        suppressClick = false;
      }, 350);
      /* 关闭:下拉到 peek 的 closeRatio 以下(任意一段都算拖过页面优先态),
         或在第一段快速下滑。从第二/三段一路下拉也能直接关掉,不必先停在第一段 */
      if (d.h < m.peek * closeRatio || (d.from === order[0] && v < -swipeV)) {
        panel.classList.remove("is-dragging");
        if (opts.onCompactChange) opts.onCompactChange(true);
        opts.markSnapping();
        opts.onClose("drag");
        // 等滑下去之后再交回 CSS,否则 peek 保底高度会在下滑途中把面板顶高
        setTimeout(opts.clearDragHeight, snapMs + 90);
        return;
      }
      var next =
        Math.abs(v) > swipeV ? stepSnap(order, d.from, v > 0 ? 1 : -1) : nearestSnap(order, m, d.h);
      opts.setSnap(next, true);
    }

    panel.addEventListener("pointerdown", onDown);
    panel.addEventListener("pointermove", onMove, { passive: false });
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);

    /**
     * 点手柄 / 点头部空白 = 切到下一个停靠点(最后一段回退到倒数第二段)。
     * 两个面板的头部按钮都通过 closest("button") 排除。
     */
    panel.addEventListener("click", function (e) {
      if (!opts.isActive() || suppressClick) return;
      var btn = e.target.closest("button");
      var isGrip = !!(opts.gripSelector && e.target.closest(opts.gripSelector));
      var isHeadGap = !!(opts.headSelector && e.target.closest(opts.headSelector)) && !btn;
      if (!isGrip && !isHeadGap) return;
      var cur = opts.getSnap();
      opts.setSnap(
        cur === order[order.length - 1] ? order[order.length - 2] : stepSnap(order, cur, 1)
      );
    });

    return {
      isDragging: function () {
        return drag !== null;
      },
      isSuppressingClick: function () {
        return suppressClick;
      }
    };
  }

  /* ================================================================
     互斥注册表
     ================================================================ */

  var panels = {};
  var current = null;

  function api(name) {
    return panels[name] || null;
  }

  function isOpen(name) {
    var p = api(name);
    return p !== null && p.isOpen();
  }

  function close(name, via) {
    var p = api(name);
    if (p === null || !p.isOpen()) return;
    if (current === name) current = null;
    p.close(via || "switch");
  }

  function closeAll(via) {
    for (var name in panels) {
      if (Object.prototype.hasOwnProperty.call(panels, name)) close(name, via);
    }
  }

  /**
   * 打开 name 并关掉其他面板。关与开都在同一个同步任务里完成,
   * 浏览器只画一帧 —— 桌面停靠下页面宽度也因此不会跳。
   */
  function claim(name) {
    var target = api(name);
    if (target === null) return false;
    for (var other in panels) {
      if (!Object.prototype.hasOwnProperty.call(panels, other)) continue;
      if (other !== name && panels[other].isOpen()) close(other, "switch");
    }
    current = name;
    if (!target.isOpen()) target.open();
    return true;
  }

  /** 当前打开的面板名(null = 都没开)。 */
  function active() {
    return current !== null && isOpen(current) ? current : null;
  }

  function register(name, panelApi) {
    panels[name] = panelApi;
    if (!panelApi.isOpen()) return;
    // 注册时就已打开(脚本晚于面板挂载执行)时也要登记
    current = name;
  }

  window.__aipmPanels = {
    ORDER: ORDER,
    register: register,
    claim: claim,
    close: close,
    closeAll: closeAll,
    isOpen: isOpen,
    active: active,
    get: api,
    // 共享件(两个面板都用同一套几何与手势)
    attachSheetDrag: attachSheetDrag,
    stepSnap: stepSnap,
    nearestSnap: nearestSnap,
    velocity: velocity,
    computeMetrics: computeMetrics,
    viewportHeights: viewportHeights,
    scrollbarWidth: scrollbarWidth
  };
})();
