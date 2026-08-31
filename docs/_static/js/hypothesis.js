/*
 * Hypothesis 侧栏样式控制器。
 * 官方客户端由 mkdocs.yml 直接常驻加载；本脚本只处理 open shadow root 内的视觉覆盖，
 * 并在 instant 导航后重新确认侧栏样式仍然存在。
 */
(function () {
  "use strict";

  var SIDEBAR_STYLE = [
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
  var STATE_KEY = "__aipm_hypothesis_style";
  var state = window[STATE_KEY];

  if (!state) {
    state = {
      sidebarObserver: null,
      sidebarRoot: null,
      sidebarRootObserver: null,
      sidebarStyleScheduled: false,
      subscribed: false
    };
    window[STATE_KEY] = state;
  }

  function installSidebarStyle() {
    var sidebar = document.querySelector("hypothesis-sidebar");
    var root = sidebar && sidebar.shadowRoot;
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
      });
      state.sidebarRootObserver.observe(root, { childList: true });
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

  observeSidebarDom();
  scheduleSidebarStyle();

  if (!state.subscribed && typeof document$ !== "undefined") {
    state.subscribed = true;
    document$.subscribe(function () {
      // Material 完成页面替换后，重新确认官方侧栏样式仍已安装。
      scheduleSidebarStyle();
    });
  }
})();
