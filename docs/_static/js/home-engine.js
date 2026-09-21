/*
  AI-PM 首页 banner · 引擎调度与 2D/3D 切换(2026-09-21)

  职责(视觉一律在 home-engine-2d.js / home-engine-3d.js 里,本文件只做调度):
  1. 顶层挂载同步:mkdocs.yml 开了 navigation.instant,换 DOM 时 head 脚本不重跑,
     故用「顶层 MutationObserver 盯 body 子树」侦测 .pm-banner 出现 → 挂载、
     消失 → 卸载(停 rAF/断观察器/释放 GL)。rAF 合并抖动。这是 banner.js 用过的
     同一套结构,换掉引擎后仍然必要。
  2. 2D / 3D 切换:页面 hero 右上角的 [ 2D | 3D ] 控件;默认 3D。
     切换时**先 dispose 旧引擎再 create 新引擎**——不靠「隐藏但仍在跑」,所以
     停 rAF、断 IntersectionObserver、释放 GL 上下文三件事都由各自 dispose 保证,
     不存在两版同时跑 rAF 或 GL 上下文堆积。
  3. 选择记忆:localStorage("pm-home-engine")。仅在用户**主动点击**时写入,
     自动降级(无 WebGL 回退 2D)不写,免得把 3D 偏好覆盖成 2D。
  4. 降级:无 WebGL(或着色器链接失败)→ 强制 2D 并禁用 3D 按钮;
     无 JS 时两块 canvas 都不显示(CSS 用 html[data-pm-engine] 控制可见性),
     由 .pm-banner 的静态底图 + hero 品牌文案兜底,不会白屏。

  约定:两块 canvas 都在 HTML 里,可见性**只由 CSS 决定**
  (.pm-banner__canvas 默认 display:none;html[data-pm-engine="2d"|"3d"] 放行其一),
  所以无 JS 时自然回落到静态底图,不需要 JS 去写 hidden 属性。
*/
(() => {
  "use strict";

  const NS = (window.PMHomeEngine = window.PMHomeEngine || {});

  const STORE = "pm-home-engine";
  const DEFAULT_MODE = "3d";

  /* WebGL 能力探测:只探一次;探完立刻用 WEBGL_lose_context 释放探测上下文,
     不给浏览器宝贵的 GL 上下文配额添乱 */
  const webglOK = (() => {
    try {
      const c = document.createElement("canvas");
      const g = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!g) return false;
      const lose = g.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return true;
    } catch (e) {
      return false;
    }
  })();

  const readPref = () => {
    try {
      const v = localStorage.getItem(STORE);
      return v === "2d" || v === "3d" ? v : null;
    } catch (e) {
      return null;   // 隐私模式/被禁 cookie 下 localStorage 可能直接抛错
    }
  };
  const writePref = (m) => {
    try { localStorage.setItem(STORE, m); } catch (e) { /* 存不了就算了,不影响功能 */ }
  };

  const engineOf = (m) => NS[m === "2d" ? "engine2d" : "engine3d"] || null;

  let root = null, inst = null, mode = null;
  /* 3D 起不来(不只是「没有 WebGL」,也包括着色器被驱动拒绝链接这种运行期失败)
     → 记下来,之后等同「无 WebGL」处理 */
  let webglDead = false;
  const glUsable = () => webglOK && !webglDead;

  const apply = (next, persist) => {
    if (!root) return;
    if (next === mode && inst) return;   // 已是该引擎且活着:不重建

    /* 1) 先卸旧引擎:停 rAF、断观察器、放 GL(各自 dispose 负责) */
    if (inst) { inst.dispose(); inst = null; }

    /* 2) 复位两块画布的位图,清掉上一版残留像素,避免切换瞬间闪旧帧 */
    for (const c of root.querySelectorAll("canvas.pm-banner__canvas")) {
      c.width = c.width;   // 对 2D / WebGL 画布都安全(只是复位缓冲区)
    }

    /* 3) 候选顺序:要 3D 且 GL 可用 → 先 3D,失败再退 2D;否则直接 2D。
           「3D 失败」不能只看有没有 WebGL:着色器编译/链接被拒时 create() 也返回
           null。此时若照样把 html[data-pm-engine] 定成 "3d",就会留下
           「标签写着 3D、画布却全空」的死状态 —— 必须当场回退。 */
    const order = next === "3d" && glUsable() ? ["3d", "2d"] : ["2d"];

    let used = null;
    for (const m of order) {
      const eng = engineOf(m);
      if (!eng) continue;
      /* 先放行目标画布:可见性由 html[data-pm-engine] 决定,必须先设属性,
         否则画布还是 display:none,getBoundingClientRect 为 0、引擎无法定尺寸 */
      document.documentElement.dataset.pmEngine = m;
      const got = eng.create(root);
      if (got) { inst = got; used = m; break; }
      document.documentElement.removeAttribute("data-pm-engine");
      if (m === "3d") webglDead = true;
    }

    if (!used) {
      /* 两版都没起来:两块画布都不显示,交给 CSS 静态底图兜底(不白屏) */
      document.documentElement.removeAttribute("data-pm-engine");
    }
    mode = used || next;          // 引擎没起来时仍按用户所选高亮控件
    const shown = used || next;

    /* 4) 同步控件、a11y 标签与 HUD 状态行 */
    for (const b of root.querySelectorAll("[data-pm-set]")) {
      const on = b.getAttribute("data-pm-set") === shown;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const b3 = root.querySelector('[data-pm-set="3d"]');
    if (b3) {
      b3.disabled = !glUsable();
      b3.title = glUsable() ? "" : "当前浏览器或设备不支持 WebGL,已回退到 2D";
    }
    const eng = used ? engineOf(used) : null;
    const stage = root.querySelector(".pm-banner__stage");
    if (stage && eng && eng.label) stage.setAttribute("aria-label", eng.label);
    const stat = root.querySelector("[data-pm-stat]");
    if (stat && eng && eng.meta) stat.textContent = eng.meta;

    if (persist && used) writePref(used);
  };

  const unmount = () => {
    if (inst) { inst.dispose(); inst = null; }
    root = null;
    mode = null;
  };

  const bindSwitch = (el) => {
    if (el.dataset.pmBound === "1") return;
    el.dataset.pmBound = "1";
    el.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-pm-set]");
      if (!btn || btn.disabled) return;
      const want = btn.getAttribute("data-pm-set");
      if (want === "3d" && !glUsable()) return;
      apply(want, true);   // 主动点击才写入偏好
    });
  };

  const sync = () => {
    const el = document.querySelector(".pm-banner");
    if (!el) { unmount(); return; }
    if (el === root) return;
    unmount();
    root = el;
    bindSwitch(el);
    /* 默认 3D;用户存过偏好就听用户的。无 WebGL / 3D 起不来时由 apply 内部回退,
       且自动降级不写回偏好(免得把用户的 3D 偏好覆盖成 2D) */
    apply(readPref() || DEFAULT_MODE, false);
  };

  let queued = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(sync);
  }).observe(document.body, { childList: true, subtree: true });

  sync();
})();
