// MathJax v3 + pymdownx.arithmatex。配置必须在 tex-chtml.js 之前执行。
// instant 导航重排按 mkdocs-material 官方配方：先清缓存再 typeset。
window.MathJax = {
  tex: {
    inlineMath: [["\\(", "\\)"]],
    displayMath: [["\\[", "\\]"]],
    processEscapes: true,
    processEnvironments: true
  },
  options: {
    ignoreHtmlClass: ".*|",
    processHtmlClass: "arithmatex"
  }
};

document$.subscribe(function () {
  if (!window.MathJax || !MathJax.startup || !MathJax.typesetPromise) {
    return;
  }
  MathJax.startup.output.clearCache();
  MathJax.typesetClear();
  MathJax.texReset();
  MathJax.typesetPromise();
});
