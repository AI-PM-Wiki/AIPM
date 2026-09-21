/*
  首页 ASCII 面板逐行显影(home-ascii.js,2026-09-21 · w3 ASCII 方向)

  做什么:
    .pm-ascii-hero__window 里是三行终端文本(命令 / FIGlet 字样 / 脚注),
    各是一个 <pre>。本脚本按 DOM 顺序把每一行包成
    <span class="pm-ascii-hero__line">,用递增 animation-delay 依次淡入,
    得到「终端逐行打印」的观感。7 行 × 42ms 约 0.3s,不循环、不常驻绘制。

  为什么这样写:
    - 只对已有文本重新包 span,不改动任何一个字符,所以 JS 被禁用或报错时
      <pre> 原样显示完整 ASCII 主视觉 —— 主视觉不依赖 JS;
    - span 用行内显示且保留原始 \n,行数与断行完全不变,不触发 reflow;
    - 只跑一次:跑完给容器打上 --typed,后续观察器触发即早退。

  动效开关:
    prefers-reduced-motion: reduce 时直接返回、不加任何类,CSS 侧(§13.8)
    也没有动画 —— 静态显示。

  重复执行 / instant 导航:
    与 header-line.js 同套路:启动跑一次 + MutationObserver 兜底。
    navigation.instant 换页会整体替换 [data-md-component=container],新出现的
    窗口不带 --typed,观察器会让它重新显影一次。
*/
(() => {
  "use strict";

  const WINDOW = ".pm-ascii-hero__window";
  const DONE = "pm-ascii-hero__window--typed";
  const LINE = "pm-ascii-hero__line";
  const STEP = 42; // 每行递增延迟 ms

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const escape = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const reveal = () => {
    const win = document.querySelector(WINDOW);
    if (!win || win.classList.contains(DONE)) return;
    if (prefersReducedMotion()) return;

    const pres = Array.from(win.querySelectorAll("pre"));
    if (!pres.length) return;

    let n = 0;
    for (const pre of pres) {
      if (!pre.textContent) continue;
      pre.innerHTML = pre.textContent
        .split("\n")
        .map(
          (line) =>
            '<span class="' +
            LINE +
            '" style="animation-delay:' +
            n++ * STEP +
            'ms">' +
            escape(line) +
            "</span>"
        )
        .join("\n");
    }

    win.classList.add(DONE);
  };

  reveal();
  new MutationObserver(reveal).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
