/*
  页头交界发丝线(header-line.js,2026-08-24)

  在 .md-tabs 之后(无 .md-tabs?回退到 .md-header 后)注入一个粘性发丝线
  元素 .md-header__line:per-page 两栏时线在 tabs 底缘,随滚动连续上移,
  到吸顶页头下缘(top 2.4rem)粘住;一栏时(tabs display:none)线紧跟
  页头 —— 任何状态下始终只有一条线,样式见 extra.css 5.3.1。

  重复注入防护:class 已存在即跳过;MutationObserver 兜底 instant 导航
  换页([data-md-component=container] 整体替换,线随旧容器被摘除,由
  观察器按同一规则重新注入)。
*/
(() => {
  "use strict";

  const LINE_CLASS = "md-header__line";

  const ensure = () => {
    if (document.querySelector("." + LINE_CLASS)) return;
    const anchor = document.querySelector(".md-tabs") || document.querySelector(".md-header");
    if (!anchor) return;
    const line = document.createElement("div");
    line.className = LINE_CLASS;
    line.setAttribute("aria-hidden", "true");
    anchor.after(line);
  };

  ensure();
  new MutationObserver(ensure).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
