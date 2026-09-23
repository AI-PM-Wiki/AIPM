// 自建 umami 统计埋点(umami.nvc.ac,Env-only 2026-08)
// 主题 fork 无 umami analytics 模板,故用注入文件动态挂载 script.js / recorder.js。
// 若不需要会话录制(鼠标/滚动/点击回放),删掉 recorder.js 那一行即可。
(function () {
  if (window.__umami_loaded) return;
  var HOST = "https://umami.nvc.ac";
  var SITE_ID = "15cfb770-15be-4652-b3d7-bc9409c7a5fa";
  ["script.js", "recorder.js"].forEach(function (file) {
    var s = document.createElement("script");
    s.async = true;
    s.defer = true;
    s.src = HOST + "/" + file;
    s.setAttribute("data-website-id", SITE_ID);
    document.head.appendChild(s);
  });
  window.__umami_loaded = true;
})();
