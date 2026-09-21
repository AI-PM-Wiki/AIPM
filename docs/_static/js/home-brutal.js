/* ============================================================================
   首页 v2 / BRUTAL —— 「按 G 显示栏线」

   为什么需要 JS:CSS 用 :has() 已经能把栏线、chrome 隐藏、网格全部表达清楚,
   本文件只负责一件 CSS 做不到的事 —— 一个可切换的全页网格校对视图
   (hero 元信息里写明「按 G 显示栏线」,是设计的一部分,不是彩蛋)。

   navigation.instant 下换页只换 DOM、<head> 脚本不重跑,所以键位监听必须
   按「出现即挂 / 消失即卸」维护,否则离开首页后 G 会继续改 body 属性。
   ========================================================================== */
(function () {
  "use strict";

  var ATTR = "data-pmb-grid";
  var HOME = ".pmb";

  function isTypingTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function onKeydown(event) {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (event.key !== "g" && event.key !== "G") return;
    var on = document.body.getAttribute(ATTR) === "1";
    if (on) document.body.removeAttribute(ATTR);
    else document.body.setAttribute(ATTR, "1");
  }

  function attach() {
    document.addEventListener("keydown", onKeydown);
  }

  function detach() {
    document.removeEventListener("keydown", onKeydown);
    document.body.removeAttribute(ATTR);
  }

  var mounted = false;

  function sync() {
    var onHome = !!document.querySelector(HOME);
    if (onHome && !mounted) {
      mounted = true;
      attach();
    } else if (!onHome && mounted) {
      mounted = false;
      detach();
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () {
      queued = false;
      sync();
    });
  }

  // 首屏:DOMContentLoaded 之后 body 才稳定;脚本在 body 末尾加载,直接跑一次。
  if (document.body) sync();
  else document.addEventListener("DOMContentLoaded", sync);

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
