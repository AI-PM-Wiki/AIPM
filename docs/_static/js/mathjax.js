// MathJax v3 配置:仅处理 pymdownx.arithmatex 包裹的 .arithmatex 内容。
// 需在本文件之后加载 MathJax 本体(见 mkdocs.yml extra_javascript)。
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

// 主题(fork of mkdocs-material)instant 导航暴露 window.document$ 事件流,
// 订阅它在页面加载与 instant 跳转后重新排版公式。
if (typeof document$ !== "undefined") {
  document$.subscribe(function () {
    if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
      MathJax.typesetPromise();
    }
  });
}
