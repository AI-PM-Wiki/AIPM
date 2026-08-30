/*
 * Hypothesis 的网页批注客户端加载器。
 * instant 导航会更新页面 head，因此恢复官方客户端需要的外部资源，但不重复创建客户端。
 * Hypothesis 的收起侧栏位于 open shadow root 内，局部覆盖其视觉 edge，保留原有打开入口。
 */
(function () {
  "use strict";

  var SCRIPT_URL = "https://hypothes.is/embed.js";
  // Vendor UI lives in an open shadow root, so page-level CSS cannot reach it.
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
  var STATE_KEY = "__aipm_hypothesis_loader";
  var state = window[STATE_KEY];

  if (state) {
    return;
  }

  state = {
    status: "idle",
    promise: null,
    resolve: null,
    script: null,
    assetTemplates: [],
    observer: null,
    sidebarObserver: null,
    sidebarRoot: null,
    sidebarRootObserver: null,
    sidebarStyleScheduled: false,
    scheduled: false
  };
  window[STATE_KEY] = state;

  function hasVendorScript() {
    return document.querySelector('script[data-aipm-hypothesis="embed"]') !== null;
  }

  function assetKey(node) {
    return [node.tagName, node.type, node.rel, node.href, node.src].join("|");
  }

  function rememberVendorAssets() {
    state.assetTemplates = Array.from(
      document.querySelectorAll("[data-hypothesis-asset]")
    )
      .filter(function (node) {
        return node.tagName !== "SCRIPT";
      })
      .map(function (node) {
        return { key: assetKey(node), html: node.outerHTML };
      });
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
        .map(assetKey)
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
    if (state.sidebarStyleScheduled || state.status === "failed") {
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

  function resetRemovedScript() {
    if (!state.script || document.documentElement.contains(state.script)) {
      return;
    }
    state.script = null;
    if (state.resolve) {
      state.resolve();
      state.resolve = null;
    }
    state.promise = null;
    state.status = "idle";
  }

  function loadHypothesis() {
    resetRemovedScript();
    if (state.status === "failed") {
      return Promise.resolve();
    }
    if (hasVendorScript()) {
      scheduleSidebarStyle();
      return state.promise || Promise.resolve();
    }
    if (state.promise) {
      return state.promise;
    }

    state.status = "loading";
    state.promise = new Promise(function (resolve) {
      var script = document.createElement("script");
      state.script = script;
      state.resolve = resolve;
      script.src = SCRIPT_URL;
      script.async = true;
      script.dataset.aipmHypothesis = "embed";
      script.addEventListener(
        "load",
        function () {
          if (state.script !== script) {
            return;
          }
          state.status = "loaded";
          state.promise = null;
          state.resolve = null;
          rememberVendorAssets();
          scheduleSidebarStyle();
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        function () {
          if (state.script !== script) {
            return;
          }
          state.status = "failed";
          state.promise = null;
          state.resolve = null;
          console.warn("Hypothesis failed to load; the page remains readable.");
          resolve();
        },
        { once: true }
      );
      document.body.appendChild(script);
    });

    return state.promise;
  }

  function scheduleRestore() {
    if (state.scheduled || state.status === "failed") {
      return;
    }
    state.scheduled = true;
    window.setTimeout(function () {
      state.scheduled = false;
      resetRemovedScript();
      if (state.status === "loaded") {
        restoreVendorAssets();
        scheduleSidebarStyle();
      }
      if (!hasVendorScript()) {
        loadHypothesis();
      }
    }, 0);
  }

  function observeNavigationDom() {
    if (typeof MutationObserver === "undefined" || !document.head) {
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

  loadHypothesis();
  observeNavigationDom();
  observeSidebarDom();

  if (typeof document$ !== "undefined") {
    document$.subscribe(function () {
      // Material 完成页面替换后，恢复被 head 更新移除的官方资源。
      scheduleRestore();
      scheduleSidebarStyle();
    });
  }
})();
