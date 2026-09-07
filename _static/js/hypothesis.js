/*
 * Hypothesis 侧栏样式控制器。
 * 官方客户端由 mkdocs.yml 直接常驻加载；本脚本保存其动态注入的样式资源，
 * 在 instant 导航后恢复高亮样式，并处理 open shadow root 内的侧栏视觉覆盖。
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
      assetTemplates: [],
      observer: null,
      restoreScheduled: false,
      sidebarObserver: null,
      sidebarRoot: null,
      sidebarRootObserver: null,
      sidebarStyleScheduled: false,
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

  rememberVendorAssets();
  observeNavigationDom();
  observeSidebarDom();
  scheduleSidebarStyle();

  if (!state.subscribed && typeof document$ !== "undefined") {
    state.subscribed = true;
    document$.subscribe(function () {
      // Material 完成页面替换后，恢复被 head 更新移除的官方样式资源。
      scheduleRestore();
      scheduleSidebarStyle();
    });
  }
})();
