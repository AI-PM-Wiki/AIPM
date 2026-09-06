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

function typesetMathJax() {
  if (!window.MathJax || !MathJax.startup || !MathJax.startup.promise) {
    return;
  }
  MathJax.startup.promise
    .then(function () {
      if (!MathJax.typesetPromise) {
        return;
      }
      MathJax.startup.output.clearCache();
      MathJax.typesetClear();
      MathJax.texReset();
      return MathJax.typesetPromise();
    })
    .catch(function (error) {
      console.error("MathJax typesetting failed", error);
    });
}

if (typeof document$ !== "undefined") {
  document$.subscribe(typesetMathJax);
}
