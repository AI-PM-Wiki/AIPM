/*
 * Hypothesis 宿主页配置注入。
 *
 * 官方 boot 脚本只认文档里的 <script class="js-hypothesis-config"> JSON 标签
 * （window.hypothesisConfig 在它那里不生效，实测过），所以必须在官方 embed 脚本
 * 之前同步把标签写进文档 —— mkdocs.yml 里本文件排在 embed.js 前面。
 *
 * 只覆盖 sidebarAppUrl：把面板外壳换成站内自己托管的 app.html，于是面板与本站
 * 同源，站点样式表能直接生效（见 _static/hypothesis/theme.css）。客户端的 JS/CSS
 * 资源、批注数据、登录流程仍全部走官方 hypothes.is，本站不分发上游代码。
 */
(function () {
  "use strict";

  if (document.querySelector("script.js-hypothesis-config")) {
    return;
  }

  // 由本文件自己的 src 推出站点根，本地预览与生产共用同一份配置。
  var script = document.currentScript;
  var siteRoot = script && script.src ? script.src.split("_static/js/")[0] : "/";
  var scheme =
    (document.body && document.body.getAttribute("data-md-color-scheme")) || "";

  var url = siteRoot + "_static/hypothesis/app.html";
  if (scheme) {
    // 首帧定色用；用户之后切换亮/暗由 hypothesis.js 直接写进面板文档。
    url += "?scheme=" + encodeURIComponent(scheme);
  }

  var tag = document.createElement("script");
  tag.className = "js-hypothesis-config";
  tag.type = "application/json";
  tag.textContent = JSON.stringify({ sidebarAppUrl: url });
  document.head.appendChild(tag);
})();
