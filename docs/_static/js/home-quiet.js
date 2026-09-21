/*!
 * 首页 v2「静纸」—— 唯一的动效挂载器(刻度尺自左向右描出)。
 *
 * 职责只有一个:extra.css §13.5 里的 @keyframes qd-rule-draw 不挂在默认状态上,
 * 由本脚本在 hero 出现时给 .qd-rule 加上 .qd-draw,让发丝刻度尺描出一次。
 *
 *  - 无 JS:刻度尺静态呈现(完整可见),页面不缺任何功能,只是少了这一次描出;
 *  - prefers-reduced-motion: reduce 时 extra.css 直接 animation: none,本脚本仍可挂类,无副作用;
 *  - navigation.instant 换 DOM 时 head 脚本不会重跑,故用实例工厂 create() +
 *    顶层 MutationObserver 盯 body 子树:hero 出现即重挂,消失即复位;
 *  - 骨架屏与局部刷新会高频触发 childList,用 requestAnimationFrame 合并 + 元素同一性
 *    判断去抖:同一根刻度尺不会被重复挂载,动画也不因无关 DOM 变更而反复重放。
 */
(function () {
  "use strict";

  var DRAW = "qd-draw";
  var drawn = null;
  var raf = 0;

  function draw(rule) {
    if (!rule || rule === drawn) {
      return;
    }
    drawn = rule;
    rule.classList.remove(DRAW);
    // 读一次布局强制重排,使同一元素上的 CSS 动画可以重新开始
    void rule.offsetWidth;
    rule.classList.add(DRAW);
  }

  function scan() {
    var hero = document.querySelector(".qd-hero");
    if (!hero) {
      drawn = null;
      return;
    }
    if (drawn && hero.contains(drawn)) {
      return;
    }
    draw(hero.querySelector(".qd-rule"));
  }

  function create() {
    var observer = new MutationObserver(function () {
      if (raf) {
        return;
      }
      raf = window.requestAnimationFrame(function () {
        raf = 0;
        scan();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return observer;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", create, { once: true });
  } else {
    create();
  }
})();
