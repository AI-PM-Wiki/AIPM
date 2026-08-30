/*
  Mermaid 图放大查看器(mermaid-zoom.js)

  Mermaid 由 Material 主题异步渲染。这里不依赖主题私有 API,只增强已经
  出现的 .mermaid 宿主元素。当前主题可能把 SVG 放进 closed ShadowRoot,
  因此外部无法稳定 clone 内部 SVG;打开时临时把原宿主移入 dialog,用宿主
  本身的矢量内容放大,关闭后原位恢复。

  放大视图是一个不设边界的画布:
  - 鼠标左键拖动平移;
  - 滚轮按指针位置缩放;
  - 触摸设备用 Pointer Events 支持单指拖动与双指缩放。

  生命周期:
  - 首次扫描 + MutationObserver:等待 Mermaid 渲染和 instant 换页;
  - document$ 订阅:换页时关闭旧图,再扫描新页面;
  - 单例 dialog:避免每张图重复创建模态层。
*/
(() => {
  "use strict";

  const DIALOG_ID = "aipm-mermaid-dialog";
  const READY_ATTR = "data-mermaid-zoom-ready";
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;
  const SCALE_STEP = 0.25;
  const DEFAULT_SCALE_CAP = 1.5;
  const FOCUSABLE_SELECTOR =
    "button:not([disabled]), [href], input:not([disabled]), " +
    "select:not([disabled]), textarea:not([disabled]), " +
    "[tabindex]:not([tabindex=\"-1\"])";

  const state = {
    dialog: null,
    viewport: null,
    canvas: null,
    scaleText: null,
    closeButton: null,
    source: null,
    sourceParent: null,
    placeholder: null,
    sourceStyle: null,
    trigger: null,
    baseWidth: 0,
    baseHeight: 0,
    scale: 1,
    panX: 0,
    panY: 0,
    previousOverflow: "",
    restoreFocus: true,
    scanFrame: 0,
    gesture: null,
    pointers: new Map(),
  };

  const supportsDialog = () =>
    typeof HTMLDialogElement !== "undefined" &&
    typeof HTMLDialogElement.prototype.showModal === "function";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const isVisible = (element) => {
    if (!element || element.hidden) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const focusable = () => {
    if (!state.dialog) return [];
    return Array.from(state.dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
  };

  const ensureDialog = () => {
    if (state.dialog) return true;
    if (!supportsDialog()) return false;

    const dialog = document.createElement("dialog");
    dialog.id = DIALOG_ID;
    dialog.className = "mermaid-zoom__dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "aipm-mermaid-dialog-title");
    dialog.setAttribute("aria-describedby", "aipm-mermaid-dialog-hint");
    dialog.innerHTML =
      '<div class="mermaid-zoom__shell">' +
        '<header class="mermaid-zoom__header">' +
          '<h2 class="mermaid-zoom__title" id="aipm-mermaid-dialog-title">' +
            "Mermaid 图放大视图" +
          "</h2>" +
          '<div class="mermaid-zoom__actions">' +
            '<button type="button" class="mermaid-zoom__button" data-mermaid-action="fit">' +
              "适应窗口" +
            "</button>" +
            '<button type="button" class="mermaid-zoom__button" data-mermaid-action="zoom-out" aria-label="缩小">−</button>' +
            '<output class="mermaid-zoom__scale" aria-live="polite">100%</output>' +
            '<button type="button" class="mermaid-zoom__button" data-mermaid-action="zoom-in" aria-label="放大">＋</button>' +
            '<button type="button" class="mermaid-zoom__button mermaid-zoom__button--close" data-mermaid-action="close">' +
              "关闭" +
            "</button>" +
          "</div>" +
        "</header>" +
        '<p class="mermaid-zoom__hint" id="aipm-mermaid-dialog-hint">' +
          "可拖动图表查看不同区域，使用滚轮或双指缩放。" +
        "</p>" +
        '<div class="mermaid-zoom__viewport" tabindex="0">' +
          '<div class="mermaid-zoom__canvas"></div>' +
        "</div>" +
      "</div>";

    document.body.appendChild(dialog);
    state.dialog = dialog;
    state.viewport = dialog.querySelector(".mermaid-zoom__viewport");
    state.canvas = dialog.querySelector(".mermaid-zoom__canvas");
    state.scaleText = dialog.querySelector(".mermaid-zoom__scale");
    state.closeButton = dialog.querySelector('[data-mermaid-action="close"]');

    dialog.querySelector('[data-mermaid-action="fit"]').addEventListener("click", fitToWindow);
    dialog.querySelector('[data-mermaid-action="zoom-out"]').addEventListener("click", () => {
      zoomAt(state.scale - SCALE_STEP, viewportCenterX(), viewportCenterY());
    });
    dialog.querySelector('[data-mermaid-action="zoom-in"]').addEventListener("click", () => {
      zoomAt(state.scale + SCALE_STEP, viewportCenterX(), viewportCenterY());
    });
    state.closeButton.addEventListener("click", () => closeViewer(true));

    dialog.addEventListener("cancel", (event) => {
      // 统一走清理流程,确保宿主元素和 body 滚动状态恢复。
      event.preventDefault();
      closeViewer(true);
    });
    dialog.addEventListener("close", finishClose);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeViewer(true);
    });
    dialog.addEventListener("keydown", trapFocus);
    state.viewport.addEventListener("pointerdown", startPointer);
    state.viewport.addEventListener("pointermove", movePointer);
    state.viewport.addEventListener("pointerup", endPointer);
    state.viewport.addEventListener("pointercancel", endPointer);
    state.viewport.addEventListener("wheel", zoomWithWheel, { passive: false });

    return true;
  };

  const trapFocus = (event) => {
    if (event.key !== "Tab") return;
    const elements = focusable();
    if (!elements.length) {
      event.preventDefault();
      state.dialog.focus();
      return;
    }

    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const viewportPoint = (clientX, clientY) => {
    const rect = state.viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const viewportCenterX = () => {
    const rect = state.viewport.getBoundingClientRect();
    return rect.left + rect.width / 2;
  };
  const viewportCenterY = () => {
    const rect = state.viewport.getBoundingClientRect();
    return rect.top + rect.height / 2;
  };

  const pointerPair = () => {
    const points = Array.from(state.pointers.values());
    if (points.length < 2) return null;
    const first = viewportPoint(points[0].x, points[0].y);
    const second = viewportPoint(points[1].x, points[1].y);
    return {
      midpoint: {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      },
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    };
  };

  function startPointer(event) {
    if (!state.source || event.button > 0) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      state.viewport.setPointerCapture(event.pointerId);
    } catch (error) {
      // 合成 PointerEvent 或旧浏览器可能不支持 pointer capture,不影响平移。
    }

    if (state.pointers.size === 1) {
      const point = viewportPoint(event.clientX, event.clientY);
      state.gesture = {
        type: "drag",
        lastX: point.x,
        lastY: point.y,
      };
    } else if (state.pointers.size === 2) {
      const pair = pointerPair();
      state.gesture = {
        type: "pinch",
        startDistance: Math.max(pair.distance, 1),
        startScale: state.scale,
        worldX: (pair.midpoint.x - state.panX) / state.scale,
        worldY: (pair.midpoint.y - state.panY) / state.scale,
      };
    }
    state.viewport.classList.add("is-dragging");
    event.preventDefault();
  }

  function movePointer(event) {
    if (!state.source || !state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (state.gesture?.type === "pinch" && state.pointers.size >= 2) {
      const pair = pointerPair();
      const gesture = state.gesture;
      state.scale = clamp(
        gesture.startScale * (pair.distance / gesture.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      state.panX = pair.midpoint.x - gesture.worldX * state.scale;
      state.panY = pair.midpoint.y - gesture.worldY * state.scale;
      applyTransform();
    } else if (state.gesture?.type === "drag" && state.pointers.size === 1) {
      const point = viewportPoint(event.clientX, event.clientY);
      state.panX += point.x - state.gesture.lastX;
      state.panY += point.y - state.gesture.lastY;
      state.gesture.lastX = point.x;
      state.gesture.lastY = point.y;
      applyTransform();
    }
    event.preventDefault();
  }

  function endPointer(event) {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);
    try {
      if (state.viewport.hasPointerCapture(event.pointerId)) {
        state.viewport.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      // 释放失败只影响 capture,不影响画布状态。
    }

    if (state.pointers.size === 1) {
      const point = Array.from(state.pointers.values())[0];
      const local = viewportPoint(point.x, point.y);
      state.gesture = { type: "drag", lastX: local.x, lastY: local.y };
    } else if (!state.pointers.size) {
      state.gesture = null;
      state.viewport.classList.remove("is-dragging");
    }
    event.preventDefault();
  }

  function zoomWithWheel(event) {
    if (!state.source) return;
    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * state.viewport.clientHeight
        : event.deltaY;
    if (!delta) return;
    const factor = Math.pow(1.0015, -delta);
    zoomAt(state.scale * factor, event.clientX, event.clientY);
    event.preventDefault();
  }

  const applyTransform = () => {
    if (!state.source) return;
    state.source.style.transform =
      `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.scale})`;
    state.source.style.transformOrigin = "top left";
    if (state.scaleText) state.scaleText.textContent = `${Math.round(state.scale * 100)}%`;
  };

  const centerCanvas = () => {
    if (!state.viewport) return;
    state.panX = (state.viewport.clientWidth - state.baseWidth * state.scale) / 2;
    state.panY = (state.viewport.clientHeight - state.baseHeight * state.scale) / 2;
    applyTransform();
  };

  const zoomAt = (value, clientX, clientY) => {
    if (!state.source || !state.viewport) return;
    const point = viewportPoint(clientX, clientY);
    const worldX = (point.x - state.panX) / state.scale;
    const worldY = (point.y - state.panY) / state.scale;
    state.scale = clamp(value, MIN_SCALE, MAX_SCALE);
    state.panX = point.x - worldX * state.scale;
    state.panY = point.y - worldY * state.scale;
    applyTransform();
  };

  const fitScale = () => {
    if (!state.viewport || !state.baseWidth || !state.baseHeight) return 1;
    return clamp(
      Math.min(
        Math.max(state.viewport.clientWidth - 32, 1) / state.baseWidth,
        Math.max(state.viewport.clientHeight - 32, 1) / state.baseHeight,
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
  };

  function fitToWindow() {
    if (!state.source) return;
    state.scale = fitScale();
    centerCanvas();
  }

  const isRenderedMermaid = (host) => {
    if (host.querySelector("svg")) return true;
    if (host.shadowRoot && host.shadowRoot.querySelector("svg")) return true;

    // Material 当前版本使用 closed ShadowRoot:宿主本身是空 div,SVG 不在
    // light DOM 中。用 tag、无 code 子节点和实际高度判断是否已渲染。
    return (
      host.tagName === "DIV" &&
      !host.querySelector("code") &&
      host.childElementCount === 0 &&
      host.getBoundingClientRect().height > 0
    );
  };

  const enhance = (host) => {
    if (host.hasAttribute(READY_ATTR)) return;
    if (!isRenderedMermaid(host)) return;

    const parent = host.parentNode;
    if (!parent) return;

    const figure = document.createElement("div");
    figure.className = "mermaid-zoom__figure";
    parent.insertBefore(figure, host);
    figure.appendChild(host);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "mermaid-zoom__trigger";
    trigger.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<circle cx="10.8" cy="10.8" r="6.5"></circle>' +
        '<path d="m16 16 5 5"></path>' +
      "</svg>";
    trigger.title = "打开 Mermaid 大图";
    trigger.setAttribute("aria-label", "打开 Mermaid 大图");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", DIALOG_ID);
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openViewer(host, trigger);
    });
    figure.appendChild(trigger);
    host.setAttribute(READY_ATTR, "");
  };

  const scan = () => {
    if (!state.dialog && !ensureDialog()) return;
    document.querySelectorAll(".mermaid").forEach((host) => {
      if (state.dialog && state.dialog.contains(host)) return;
      enhance(host);
    });
  };

  const scheduleScan = () => {
    cancelAnimationFrame(state.scanFrame);
    state.scanFrame = requestAnimationFrame(scan);
  };

  const openViewer = (host, trigger) => {
    if (!ensureDialog() || state.source || !host.parentNode) return;

    const rect = host.getBoundingClientRect();
    state.baseWidth = Math.max(rect.width, host.scrollWidth, 1);
    state.baseHeight = Math.max(rect.height, host.scrollHeight, 1);
    state.source = host;
    state.sourceParent = host.parentNode;
    state.placeholder = document.createComment("mermaid-zoom-placeholder");
    state.sourceStyle = host.getAttribute("style");
    state.trigger = trigger;
    state.previousOverflow = document.body.style.overflow;
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    state.pointers.clear();
    state.gesture = null;

    state.sourceParent.insertBefore(state.placeholder, host);
    state.canvas.replaceChildren(host);
    trigger.hidden = true;
    host.style.width = `${state.baseWidth}px`;
    host.style.height = `${state.baseHeight}px`;
    host.style.margin = "0";
    host.style.position = "absolute";
    host.style.left = "0";
    host.style.top = "0";
    host.style.transformOrigin = "top left";
    document.body.style.overflow = "hidden";

    try {
      state.dialog.showModal();
    } catch (error) {
      // showModal 失败时立即复原,不要破坏正文中的图。
      finishClose();
      console.error("Mermaid viewer failed to open", error);
      return;
    }

    requestAnimationFrame(() => {
      if (!state.source) return;
      // 宽图默认适度放大;仍完整落在视口时直接居中,用户可继续缩放。
      state.scale = clamp(Math.min(DEFAULT_SCALE_CAP, Math.max(1, fitScale())), MIN_SCALE, MAX_SCALE);
      centerCanvas();
      state.closeButton.focus();
    });
  };

  function finishClose() {
    if (!state.source) return;

    endGesture();
    const source = state.source;
    const placeholder = state.placeholder;
    const parent = state.sourceParent;
    const trigger = state.trigger;
    const shouldFocus = state.restoreFocus;

    if (placeholder && placeholder.parentNode && parent && parent.isConnected) {
      placeholder.parentNode.insertBefore(source, placeholder);
      placeholder.remove();
    } else {
      // 换页时旧正文可能已被移除,不要把旧图挂到新页面。
      source.remove();
      if (placeholder) placeholder.remove();
    }

    if (state.sourceStyle === null) source.removeAttribute("style");
    else source.setAttribute("style", state.sourceStyle);
    if (trigger) trigger.hidden = false;
    if (state.canvas) state.canvas.replaceChildren();
    document.body.style.overflow = state.previousOverflow;

    state.source = null;
    state.sourceParent = null;
    state.placeholder = null;
    state.sourceStyle = null;
    state.trigger = null;
    state.baseWidth = 0;
    state.baseHeight = 0;
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    state.restoreFocus = true;

    if (shouldFocus && trigger && trigger.isConnected) trigger.focus();
    scheduleScan();
  }

  function endGesture() {
    for (const pointerId of state.pointers.keys()) {
      try {
        if (state.viewport.hasPointerCapture(pointerId)) {
          state.viewport.releasePointerCapture(pointerId);
        }
      } catch (error) {
        // 忽略已失效的 pointer capture。
      }
    }
    state.pointers.clear();
    state.gesture = null;
    if (state.viewport) state.viewport.classList.remove("is-dragging");
  }

  function closeViewer(restoreFocus) {
    if (!state.source) return;
    state.restoreFocus = restoreFocus;
    if (state.dialog && state.dialog.open) state.dialog.close();
    finishClose();
  }

  const observer = new MutationObserver(() => {
    if (state.source && state.sourceParent && !state.sourceParent.isConnected) {
      closeViewer(false);
    }
    scheduleScan();
  });

  const observeTheme = new MutationObserver(() => {
    // Mermaid 的 SVG 颜色通常继承 body 主题变量;主题切换后重套变换即可。
    if (state.source) applyTransform();
  });

  const start = () => {
    if (!supportsDialog()) return;
    ensureDialog();
    scan();
    observer.observe(document.body, { childList: true, subtree: true });
    observeTheme.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-md-color-scheme"],
    });

    if (typeof document$ !== "undefined" && document$ && document$.subscribe) {
      document$.subscribe(() => {
        if (state.source) closeViewer(false);
        scheduleScan();
      });
    }
  };

  start();
})();
