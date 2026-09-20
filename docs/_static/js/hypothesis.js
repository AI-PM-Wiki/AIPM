/*
 * Hypothesis 批注入口与侧栏样式控制器。
 *
 * 官方客户端由 mkdocs.yml 直接常驻加载（官方 embed 脚本，见 extra_javascript），它渲染
 * <hypothesis-sidebar>：shadow root 内是滑出的侧栏面板 #sidebar-container，以及
 * 贴在视口右缘的竖排控制条 [data-testid="sidebar-edge"]（官方依次放「打开侧栏 /
 * 显示高亮 / 新建页面批注」三个按钮）。
 *
 * 本站的接管（issue #67，2026-09-20）：
 * 1. 侧栏收起时整条竖排控制条隐藏 —— 页面上不再有悬浮的白色竖条；「打开批注」
 *    改由页头右上角一个站点原生按钮承担（.md-header__button.md-icon，与搜索、
 *    GitHub 图标同一套样式，贴浏览器右边缘，亮/暗模式跟随站点主题，样式见
 *    extra.css 5.7）；
 * 2. 侧栏展开时保留面板左缘的控制条 —— 它是唯一的收起入口，同时把按钮配色换成
 *    站点主题变量，去掉官方写死的白块与阴影；
 * 3. 本脚本同时保存官方客户端动态注入的样式资源，在 instant 导航后恢复高亮样式。
 */
(function () {
  "use strict";

  var SIDEBAR_STYLE = [
    // 收起：整条竖排控制条不显示，入口在页头（见文件头）。
    "#sidebar-container.sidebar-collapsed [data-testid=\"sidebar-edge\"] {",
    "  display: none !important;",
    "}",
    // 展开：保留控制条，但按钮改为跟随站点主题（亮色白底 / 暗色蓝调黑底），
    // 前景色取站点 token，由 shadow root 继承自定义属性，无需另判配色方案。
    '[data-testid="sidebar-edge"] button {',
    "  background: var(--md-default-bg-color) !important;",
    "  border-color: var(--pm-line) !important;",
    "  color: var(--pm-muted) !important;",
    "  box-shadow: none !important;",
    "}",
    '[data-testid="sidebar-edge"] button:hover {',
    "  color: var(--pm-ink) !important;",
    "}",
    // 控制条自身保持透明：面板展开时它浮在正文上，不能带底色。
    '[data-testid="sidebar-edge"] {',
    "  background: transparent !important;",
    "  background-color: transparent !important;",
    "  border-color: transparent !important;",
    "  box-shadow: none !important;",
    "}",
    '[data-testid="sidebar-edge"]::before,',
    '[data-testid="sidebar-edge"]::after {',
    "  background: transparent !important;",
    "  box-shadow: none !important;",
    "}",
    "@media screen and (max-width: 59.984375em) {",
    '#sidebar-container.sidebar-collapsed [data-testid="toolbar-container"] {',
    "  transform: translateY(48px) !important;",
    "  }",
    "}"
  ].join("\n");
  var CONTROLLED_ID = "sidebar-container";
  var ENTRY_CLASS = "aipm-hypothesis-entry";
  var ENTRY_LABEL = "页面批注（Hypothesis）";
  var ENTRY_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M9 22a1 1 0 0 1-1-1v-3H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 ' +
    "2 2v12a2 2 0 0 1-2 2h-6.1l-3.7 3.71c-.2.19-.45.29-.7.29zm1-6v3.08L13.08 16H20V4H4" +
    'v12zM6 7h12v2H6zm0 4h9v2H6z"/>' +
    "</svg>";
  var STATE_KEY = "__aipm_hypothesis_style";
  var state = window[STATE_KEY];

  if (!state) {
    state = {
      assetTemplates: [],
      observer: null,
      restoreScheduled: false,
      sidebarObserver: null,
      sidebarRoot: null,
      sidebarRootObserver: null,
      sidebarStyleScheduled: false,
      entryScheduled: false,
      subscribed: false
    };
    window[STATE_KEY] = state;
  } else {
    // 更新脚本时保留旧页面中的共享状态，避免 instant 导航期间丢失监听器。
    state.assetTemplates = state.assetTemplates || [];
    state.observer = state.observer || null;
    state.restoreScheduled = Boolean(state.restoreScheduled);
  }

  function rememberVendorAssets() {
    var assets = Array.from(document.querySelectorAll("[data-hypothesis-asset]"))
      .filter(function (node) {
        return node.tagName !== "SCRIPT";
      })
      .map(function (node) {
        return {
          key: [node.tagName, node.type, node.rel, node.href, node.src].join("|"),
          html: node.outerHTML
        };
      });
    if (assets.length) {
      state.assetTemplates = assets;
    }
  }

  function restoreVendorAssets() {
    if (!state.assetTemplates.length) {
      return;
    }

    var existing = new Set(
      Array.from(document.querySelectorAll("[data-hypothesis-asset]"))
        .filter(function (node) {
          return node.tagName !== "SCRIPT";
        })
        .map(function (node) {
          return [node.tagName, node.type, node.rel, node.href, node.src].join(
            "|"
          );
        })
    );
    state.assetTemplates.forEach(function (asset) {
      if (existing.has(asset.key)) {
        return;
      }
      var template = document.createElement("template");
      template.innerHTML = asset.html;
      document.head.appendChild(template.content.firstElementChild);
      existing.add(asset.key);
    });
  }

  function scheduleRestore() {
    if (state.restoreScheduled) {
      return;
    }
    state.restoreScheduled = true;
    window.setTimeout(function () {
      state.restoreScheduled = false;
      restoreVendorAssets();
      scheduleSidebarStyle();
    }, 0);
  }

  function observeNavigationDom() {
    if (
      typeof MutationObserver === "undefined" ||
      !document.head ||
      state.observer
    ) {
      return;
    }
    state.observer = new MutationObserver(function (mutations) {
      var removedAsset = mutations.some(function (mutation) {
        return Array.from(mutation.removedNodes).some(function (node) {
          return (
            node.nodeType === 1 &&
            (node.matches("[data-hypothesis-asset]") ||
              node.querySelector("[data-hypothesis-asset]"))
          );
        });
      });
      if (removedAsset) {
        scheduleRestore();
      }
    });
    state.observer.observe(document.head, { childList: true, subtree: true });
  }

  function vendorSidebarRoot() {
    var sidebar = document.querySelector("hypothesis-sidebar");
    return (sidebar && sidebar.shadowRoot) || null;
  }

  function vendorToggle() {
    var root = vendorSidebarRoot();
    return root
      ? root.querySelector(
          '[data-testid="sidebar-edge"] button[aria-controls="' +
            CONTROLLED_ID +
            '"]'
        )
      : null;
  }

  function installSidebarStyle() {
    var root = vendorSidebarRoot();
    if (!root) {
      return false;
    }

    if (!root.querySelector("style[data-aipm-hypothesis-style]")) {
      var style = document.createElement("style");
      style.setAttribute("data-aipm-hypothesis-style", "");
      style.textContent = SIDEBAR_STYLE;
      root.appendChild(style);
    }

    if (state.sidebarRoot === root) {
      return true;
    }
    if (state.sidebarRootObserver) {
      state.sidebarRootObserver.disconnect();
    }
    state.sidebarRoot = root;
    state.sidebarRootObserver = null;
    if (typeof MutationObserver !== "undefined") {
      state.sidebarRootObserver = new MutationObserver(function (mutations) {
        var removedStyle = mutations.some(function (mutation) {
          return Array.from(mutation.removedNodes).some(function (node) {
            return (
              node.nodeType === 1 &&
              (node.matches("style[data-aipm-hypothesis-style]") ||
                node.querySelector("style[data-aipm-hypothesis-style]"))
            );
          });
        });
        if (removedStyle) {
          scheduleSidebarStyle();
        }
        // 官方按钮的 aria-expanded 是侧栏开合的唯一对外信号，页头入口跟着它走。
        if (mutations.some(function (mutation) {
          return mutation.type === "attributes";
        })) {
          syncEntryState();
        }
      });
      state.sidebarRootObserver.observe(root, {
        childList: true,
        attributes: true,
        attributeFilter: ["aria-expanded"],
        subtree: true
      });
    }
    return true;
  }

  function scheduleSidebarStyle() {
    if (state.sidebarStyleScheduled) {
      return;
    }
    state.sidebarStyleScheduled = true;
    window.setTimeout(function () {
      state.sidebarStyleScheduled = false;
      if (installSidebarStyle()) {
        return;
      }
      if (
        typeof customElements !== "undefined" &&
        customElements.whenDefined
      ) {
        customElements.whenDefined("hypothesis-sidebar").then(function () {
          installSidebarStyle();
        });
      }
    }, 0);
  }

  function observeSidebarDom() {
    if (
      typeof MutationObserver === "undefined" ||
      !document.body ||
      state.sidebarObserver
    ) {
      return;
    }
    state.sidebarObserver = new MutationObserver(function (mutations) {
      var sidebarChanged = mutations.some(function (mutation) {
        return Array.from(mutation.addedNodes)
          .concat(Array.from(mutation.removedNodes))
          .some(function (node) {
            return (
              node.nodeType === 1 &&
              (node.matches("hypothesis-sidebar") ||
                node.querySelector("hypothesis-sidebar"))
            );
          });
      });
      if (sidebarChanged) {
        scheduleSidebarStyle();
      }
    });
    state.sidebarObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function syncEntryState() {
    var entry = document.querySelector("." + ENTRY_CLASS);
    var toggle = vendorToggle();
    if (!entry || !toggle) {
      return;
    }
    var expanded = toggle.getAttribute("aria-expanded") === "true";
    entry.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function toggleSidebar() {
    var toggle = vendorToggle();
    if (!toggle) {
      return;
    }
    // 官方按钮的点击处理器负责开合，并在之后更新 aria-expanded。
    toggle.click();
    window.setTimeout(syncEntryState, 0);
  }

  function installEntry() {
    var header = document.querySelector(".md-header");
    if (!header || header.querySelector("." + ENTRY_CLASS)) {
      return;
    }
    var entry = document.createElement("button");
    entry.type = "button";
    entry.className = "md-header__button md-icon " + ENTRY_CLASS;
    entry.title = ENTRY_LABEL;
    entry.setAttribute("aria-label", ENTRY_LABEL);
    entry.setAttribute("aria-expanded", "false");
    // 图标与主题自带材质图标同源（.icons/material/comment-text-outline.svg），
    // 由 .md-icon 统一给到 24px 尺寸与 currentcolor 填充。
    entry.innerHTML = ENTRY_ICON;
    entry.addEventListener("click", toggleSidebar);
    header.appendChild(entry);
    syncEntryState();
  }

  function scheduleEntry() {
    if (state.entryScheduled) {
      return;
    }
    state.entryScheduled = true;
    window.setTimeout(function () {
      state.entryScheduled = false;
      installEntry();
    }, 0);
  }

  rememberVendorAssets();
  observeNavigationDom();
  observeSidebarDom();
  installEntry();
  scheduleSidebarStyle();

  if (!state.subscribed && typeof document$ !== "undefined") {
    state.subscribed = true;
    document$.subscribe(function () {
      // Material 完成页面替换后，恢复被 head 更新移除的官方样式资源，
      // 并补齐页头入口（instant 导航下页头不重建，这里是幂等的兜底）。
      scheduleRestore();
      scheduleSidebarStyle();
      scheduleEntry();
      syncEntryState();
    });
  }
})();
