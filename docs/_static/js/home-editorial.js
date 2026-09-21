/*
  AI-PM 首页 v2「Editorial」交互(home-editorial.js)

  职责只有一件:把 hero 里那行带发丝下划线的「搜索整个知识库」提示
  接到 Material 内置搜索弹层上。首页本身没有任何 JS 依赖——
  唯一的动效(hero 上缘发丝线画出)是纯 CSS,禁用 JS 时全部内容照常可读。

  为什么按钮而不是链接:MkDocs 的搜索是 checkbox 驱动的弹层,没有可用的
  URL;用 <button> 触发是唯一不新增路由的做法。无 JS 时这个按钮不响应,
  但顶栏搜索图标始终可用,不构成功能缺失。

  工程契约(与 banner.js / header-line.js 一致):
  - navigation.instant 换 DOM 时 head 脚本不重跑,故用实例工厂 create() +
    顶层 MutationObserver 盯 body 子树:新的 .pmx 出现即重挂、消失即卸载,
    rAF 合并抖动,避免切走再切回首页后事件重复绑定或全部失效。
  - 只读取 base.html 中搜索 checkbox 的固定 id `#__search` 与
    `.md-search__input` 类名——主题内部实现细节,升级主题时需复核。
*/
(() => {
  "use strict";

  const SEARCH_TRIGGER = "[data-pmx-search]";

  /* 单实例:绑定 hero 里的搜索提示,返回 { dispose } */
  const create = (root) => {
    const triggers = Array.from(root.querySelectorAll(SEARCH_TRIGGER));
    if (!triggers.length) return null;

    const open = () => {
      const toggle = document.getElementById("__search");
      if (toggle && !toggle.checked) toggle.click();
      const input = document.querySelector(".md-search__input");
      if (!input) return;
      /* 弹层有 150ms 过渡;等它可见再聚焦,否则移动端键盘会顶掉动画 */
      window.setTimeout(() => input.focus(), 80);
    };

    triggers.forEach((el) => el.addEventListener("click", open));

    return {
      dispose() {
        triggers.forEach((el) => el.removeEventListener("click", open));
      },
    };
  };

  /* 顶层挂载同步 */
  let activeEl = null;
  let activeInst = null;

  const sync = () => {
    const el = document.querySelector(".pmx");
    if (el && el !== activeEl) {
      if (activeInst) activeInst.dispose();
      activeEl = el;
      activeInst = create(el);
    } else if (!el && activeInst) {
      activeInst.dispose();
      activeInst = null;
      activeEl = null;
    }
  };

  let queued = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(sync);
  }).observe(document.body, { childList: true, subtree: true });

  sync();
})();
