/*
  首页现代组件:卡片指针聚光(home-modern.js,2026-09-21,w1「现代组件化 UI」)

  作用:指针在 .pmx-card 上移动时,把指针相对卡片的百分比位置写进自定义属性
  --pmx-mx / --pmx-my,供 extra.css §13.7 的 ::after 径向渐变做聚光跟随。

  工程契约(与站内其它脚本同款):
  - 事件委托到 document,一次 pointermove 至多算一帧;不逐卡绑定监听,
    因此 mkdocs.yml 的 navigation.instant 替换 DOM 时不重跑 head 脚本也无碍
    ——不需要 MutationObserver,换页也不会留下旧监听(卡片连同内联样式一起被摘除)。
  - 纯增强:无 JS / JS 报错时聚光回落到居中默认值,卡片完全可读可点可聚焦。
  - prefers-reduced-motion: reduce 与触摸指针直接跳过,不写任何内联样式。
  - passive 监听不阻断滚动;同一帧内合并多次 move(仅记最后一次坐标)。
*/
(() => {
  "use strict";

  const CARD = ".pmx-card";
  const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let pending = null;

  /* 把待处理坐标落到卡片的自定义属性上(每帧至多一次布局读取) */
  const flush = () => {
    frame = 0;
    if (!pending) return;
    const { card, x, y } = pending;
    pending = null;
    const box = card.getBoundingClientRect();
    if (!box.width || !box.height) return;
    card.style.setProperty("--pmx-mx", (((x - box.left) / box.width) * 100).toFixed(2) + "%");
    card.style.setProperty("--pmx-my", (((y - box.top) / box.height) * 100).toFixed(2) + "%");
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      if (RM.matches || event.pointerType === "touch") return;
      const target = event.target;
      if (!target || !target.closest) return;
      const card = target.closest(CARD);
      if (!card) return;
      pending = { card, x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(flush);
    },
    { passive: true }
  );
})();
