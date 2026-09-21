/* ============================================================================
 * home-plate.js — 首页 v2「内容图谱」的 Canvas2D 图形 + 图/目录 hover 联动
 *
 * 图形编码的是仓库里**真实的内容量**,不是装饰:
 *   docs/<key>/ 下 .md 篇数(2026-09-21 实测)写成下面的常量,
 *   纵坐标与点面积同时编码该篇数的平方根(面积标度,压缩 214 : 10 的极差)。
 *
 * 工程契约:
 *   - navigation.instant 下 head 脚本不重跑 → 实例工厂 create() + 顶层
 *     MutationObserver 盯 body 子树,出现即重挂、消失即卸载;
 *   - prefers-reduced-motion: reduce → 固定相位静态单帧,不启动 rAF;
 *   - IntersectionObserver 离屏停转;
 *   - DPR 上限 2,~30fps 节流(周期 ≥ 20s 的极轻呼吸);
 *   - 无 JS / 无 Canvas → 本文件不执行,横带由 CSS 底纹 + index.md 里的
 *     <noscript> 静态图兜底,字标与 CTA 是纯 HTML。
 * ========================================================================== */
(function () {
  "use strict";

  /* --- 真实数据:docs/<key>/ 下的 .md 篇数(实测)----------------------------
   * 顺序 = 站点导航次序(导航栏里的栏目顺序),图形的横坐标即此序。 */
  var SECTIONS = [
    { key: "pm",         name: "产品方法论",  href: "pm/",          count: 18  },
    { key: "tech",       name: "工程与架构",  href: "tech/",        count: 14  },
    { key: "management", name: "工商管理",    href: "management/",  count: 19  },
    { key: "business",   name: "商业与财会",  href: "business/",    count: 214 },
    { key: "ai",         name: "AI 基础",     href: "ai/",          count: 45  },
    { key: "practice",   name: "AI 产品实战", href: "practice/",    count: 22  },
    { key: "tools",      name: "工具与平台",  href: "tools/",       count: 10  },
    { key: "case",       name: "学习资源",    href: "case/",        count: 62  },
    { key: "job",        name: "求职专题",    href: "job/",         count: 55  },
    { key: "vertical",   name: "垂直领域",    href: "vertical/",    count: 125 },
    { key: "intro",      name: "关于",        href: "intro/about/", count: 15  }
  ];

  var TOTAL = SECTIONS.reduce(function (a, s) { return a + s.count; }, 0);

  /* 点面积/纵坐标共用的标度根 */
  var ROOT = SECTIONS.map(function (s) { return Math.sqrt(s.count); });
  var ROOT_MIN = Math.min.apply(null, ROOT);
  var ROOT_MAX = Math.max.apply(null, ROOT);

  /* 只标注最大的 3 个簇 —— 好图表是"选择性标注",不是把 11 个名字都糊上去 */
  var ANNOTATED = SECTIONS.slice()
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 3)
    .map(function (s) { return s.key; });

  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  var SANS = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", ' +
    '"Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  var BREATH_MS = 24000;   /* 呼吸周期 ≥ 20s */
  var FRAME_MS = 33;       /* ~30fps */

  function norm(i) { return (ROOT[i] - ROOT_MIN) / (ROOT_MAX - ROOT_MIN || 1); }

  function tokens() {
    var cs = getComputedStyle(document.body);
    function v(name, fallback) {
      var out = cs.getPropertyValue(name);
      return (out && out.trim()) || fallback;
    }
    return {
      ink: v("--pm2-ink", "#1C1917"),
      ink2: v("--pm2-ink-2", "#57534E"),
      ink3: v("--pm2-ink-3", "#A8A29E"),
      rule: v("--pm2-rule", "rgba(28,25,23,.09)"),
      rule2: v("--pm2-rule-2", "rgba(28,25,23,.18)"),
      accent: v("--pm2-accent", "#C2410C"),
      wash: v("--pm2-accent-wash", "rgba(194,65,12,.07)"),
      dark: document.body.getAttribute("data-md-color-scheme") === "slate"
    };
  }

  function makeCanvas() {
    try {
      return document.createElement("canvas").getContext
        ? true : false;
    } catch (e) { return false; }
  }

  /* 满宽出血:正文栏到视口左右边的实际距离。
     用 clientWidth 而不是 100vw —— 100vw 含滚动条宽度,在非 overlay 滚动条
     的平台上会把横带撑出横向滚动条。 */
  function setBleed() {
    var article = document.querySelector(".md-content__inner");
    var root = document.documentElement;
    if (!article) { return; }
    var r = article.getBoundingClientRect();
    var cs = getComputedStyle(article);
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var vw = root.clientWidth;
    root.style.setProperty("--pm2-bleed-l", Math.max(0, Math.round(r.left + pl)) + "px");
    root.style.setProperty("--pm2-bleed-r", Math.max(0, Math.round(vw - (r.right - pr))) + "px");
  }

  function create(root) {
    var hero = root.querySelector(".pm2-hero");
    var grid = root.querySelector(".pm2-grid");
    if (!hero || !grid) { return null; }
    var canvas = hero.querySelector(".pm2-fig");
    if (!canvas || !makeCanvas()) { return null; }

    var ctx = canvas.getContext("2d");
    if (!ctx) { return null; }
    hero.classList.add("pm2-hero--nojs");   /* 先按"没有图"排,拿到尺寸后再放开 */

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var toks = tokens();
    var tiles = {};
    [].forEach.call(grid.querySelectorAll("[data-pm2]"), function (el) {
      tiles[el.getAttribute("data-pm2")] = el;
    });

    var W = 0, H = 0, geom = null;
    var linkKey = null;    /* 来自 bento 格子 */
    var hoverKey = null;   /* 来自指针靠近 */
    var visible = true;
    var raf = 0, last = 0, t0 = 0, needsDraw = true;

    function focusKey() { return linkKey || hoverKey; }

    /* --- 几何:全部按真实像素算,所以 1440/1024/768/390 都成立 --------- */
    function compute() {
      var rect = hero.getBoundingClientRect();
      /* 绘图区对齐正文栏的内容盒(而不是横带两端),这样横带里的图形、
         左下角字标、下方 bento 与两个 h2 小节共用同一条左缘 */
      var padL = 16, padR = 16;
      var article = document.querySelector(".md-content__inner");
      if (article) {
        var ar = article.getBoundingClientRect();
        var acs = getComputedStyle(article);
        var apl = parseFloat(acs.paddingLeft) || 0;
        var apr = parseFloat(acs.paddingRight) || 0;
        padL = Math.max(0, ar.left + apl - rect.left);
        padR = Math.max(0, rect.right - (ar.right - apr));
      }

      W = Math.max(280, Math.round(hero.clientWidth || rect.width));
      H = Math.max(300, Math.round(hero.clientHeight || rect.height));

      var markReserve = 154;            /* 左下角字标区(字标 + 篇数行 + 图注行) */
      var countRow = 28;                /* 基线下的篇数行 */
      var baseY = H - markReserve - countRow;
      var top = Math.round(H * 0.12) + 16;
      var minH = 12;
      var chartH = Math.max(60, baseY - top - minH);

      var n = SECTIONS.length;
      var plotL = padL;
      var plotR = W - padR;
      var step = (plotR - plotL) / n;
      var rScale = Math.max(0.45, Math.min(1.25, (plotR - plotL) / 1100));

      var pts = [], i;
      for (i = 0; i < n; i++) {
        var x = plotL + step * (i + 0.5);
        var y = baseY - minH - norm(i) * chartH;
        pts.push({
          x: x,
          y: y,
          r: 4 + norm(i) * 12,
          rp: (4 + norm(i) * 12) * rScale,
          s: SECTIONS[i]
        });
      }

      geom = {
        pts: pts, W: W, H: H, baseY: baseY, top: top,
        plotL: plotL, plotR: plotR, rScale: rScale, step: step,
        compact: (plotR - plotL) < 720
      };
      return geom;
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var next = compute();
      canvas.width = Math.round(next.W * dpr);
      canvas.height = Math.round(next.H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hero.style.setProperty("--pm2-plot-left", Math.round(next.plotL) + "px");
      setBleed();
      needsDraw = true;
      draw(performance.now());
    }

    /* --- 绘制 ---------------------------------------------------------- */
    function draw(now) {
      if (!geom) { return; }
      var g = geom, pts = g.pts, i, p;
      var f = focusKey();
      var phase = reduced ? 0 : ((now - t0) % BREATH_MS) / BREATH_MS;
      var breath = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;   /* 0..1 */
      var dim = f ? 0.26 : 1;

      ctx.clearRect(0, 0, g.W, g.H);

      /* 图区上沿的极细量尺线(3 条),给"制图"的坐标感 */
      ctx.save();
      ctx.strokeStyle = toks.rule;
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = 1;
      for (i = 1; i <= 3; i++) {
        var gy = Math.round(g.top + (g.baseY - g.top) * (i / 4)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(g.plotL, gy);
        ctx.lineTo(g.plotR, gy);
        ctx.stroke();
      }
      ctx.restore();

      if (!toks.dark) {
        /* 亮色:一层极淡的强调色水洗 —— 纸上的地形 */
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, g.baseY);
        ctx.lineTo(pts[0].x, pts[0].y);
        bezierPath(ctx, pts);
        ctx.lineTo(pts[pts.length - 1].x, g.baseY);
        ctx.closePath();
        ctx.globalAlpha = 0.85 + breath * 0.15;
        ctx.fillStyle = toks.wash;
        ctx.fill();
        ctx.restore();
      } else {
        /* 暗色:横向细密排线(clip 在脊线多边形内)—— 第二套设计 */
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, g.baseY);
        ctx.lineTo(pts[0].x, pts[0].y);
        bezierPath(ctx, pts);
        ctx.lineTo(pts[pts.length - 1].x, g.baseY);
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = toks.wash;
        ctx.lineWidth = 1;
        for (var yy = g.top; yy < g.baseY; yy += 5) {
          ctx.beginPath();
          ctx.moveTo(g.plotL, Math.round(yy) + 0.5);
          ctx.lineTo(g.plotR, Math.round(yy) + 0.5);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 测站到基线的垂线 */
      ctx.save();
      ctx.lineWidth = 1;
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        ctx.strokeStyle = toks.rule2;
        ctx.globalAlpha = (f && p.s.key !== f) ? dim * 0.6 : 0.55;
        ctx.beginPath();
        ctx.moveTo(p.x + 0.5, p.y);
        ctx.lineTo(p.x + 0.5, g.baseY);
        ctx.stroke();
      }
      ctx.restore();

      /* 基线 */
      ctx.save();
      ctx.strokeStyle = toks.rule2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.plotL, g.baseY + 0.5);
      ctx.lineTo(g.plotR, g.baseY + 0.5);
      ctx.stroke();
      ctx.restore();

      /* 脊线 */
      ctx.save();
      ctx.globalAlpha = f ? 0.34 : 1;
      ctx.strokeStyle = toks.ink;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = "round";
      ctx.beginPath();
      bezierPath(ctx, pts);
      ctx.stroke();
      ctx.restore();

      /* 簇:面积 ∝ 篇数;被聚焦的那个加一圈发丝环并回到满不透明度 */
      ctx.save();
      ctx.font = "600 12px " + MONO;
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        var active = f === p.s.key;
        var r = p.rp + (reduced ? 0 : breath * 0.5);
        if (active) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = toks.accent;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5.5, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.globalAlpha = f ? dim : 1;
        }
        ctx.fillStyle = toks.accent;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      /* 基线下篇数:等宽、tabular —— 图上的"数据"。
         窄屏步距变小,字号跟着缩,免得 11 个数字连成一串 */
      ctx.save();
      var numFs = g.step < 40 ? 10 : 12;
      ctx.font = "500 " + numFs + "px " + MONO;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        var on = f === p.s.key;
        ctx.globalAlpha = on ? 1 : (f ? dim : (ANNOTATED.indexOf(p.s.key) >= 0 ? 1 : 0.72));
        ctx.fillStyle = on ? toks.accent : toks.ink2;
        ctx.fillText(String(p.s.count), p.x, g.baseY + 9);
      }
      ctx.restore();

      /* 选择性标注:只给最大的 3 个簇写名字(聚焦时补上被聚焦的那个) */
      if (!g.compact) {
        ctx.save();
        ctx.textBaseline = "alphabetic";
        for (i = 0; i < pts.length; i++) {
          p = pts[i];
          var show = ANNOTATED.indexOf(p.s.key) >= 0 || f === p.s.key;
          if (!show) { continue; }
          var on2 = f === p.s.key;
          var alpha = on2 ? 1 : (f ? dim : 1);
          var lx = p.x - Math.max(0, p.rp - 6);
          var ly = p.y - p.rp - 13;
          var align = "left";
          if (ly < 16) { ly = p.y + 4; lx = p.x + p.rp + 9; }      /* 顶到上沿就改右挂 */
          if (lx + 104 > g.plotR) { lx = p.x - p.rp - 9; align = "right"; }

          ctx.font = "500 12px " + SANS;
          var nameW = ctx.measureText(p.s.name).width;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = on2 ? toks.accent : toks.ink;
          ctx.textAlign = align;
          ctx.fillText(p.s.name, align === "right" ? lx - 34 : lx, ly);

          ctx.font = "500 12px " + MONO;
          ctx.globalAlpha = alpha * 0.62;
          ctx.fillStyle = on2 ? toks.accent : toks.ink2;
          ctx.fillText(String(p.s.count), align === "right" ? lx : lx + nameW + 6, ly);
        }
        ctx.restore();
      }

      /* 坐标说明:与基线下的篇数行同一条横线上、右对齐 —— 横带右下角本来是
         空地,放图注既不浪费空间也让「图 + 图题」的左右关系成立 */
      ctx.save();
      ctx.font = "500 11px " + MONO;
      ctx.globalAlpha = f ? 0.45 : 0.9;
      ctx.fillStyle = toks.ink3;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("篇数 · √ 面积标度 · 横轴为导航次序", g.plotR, g.baseY + (numFs < 12 ? 38 : 44));
      ctx.restore();
    }

    /* 把 monotone 曲线的三次段取成 canvas 参数数组 */
    function bezierArgs(pts) {
      var args = [], i, n = pts.length;
      var dx = [], m = [], t = [];
      for (i = 0; i < n - 1; i++) {
        dx[i] = pts[i + 1].x - pts[i].x;
        m[i] = (pts[i + 1].y - pts[i].y) / dx[i];
      }
      t[0] = m[0];
      for (i = 1; i < n - 1; i++) {
        if (m[i - 1] * m[i] <= 0) { t[i] = 0; }
        else {
          var w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
          t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
        }
      }
      t[n - 1] = m[n - 2];
      for (i = 0; i < n - 1; i++) {
        var h = dx[i] / 3;
        args.push(pts[i].x + h, pts[i].y + t[i] * h,
                  pts[i + 1].x - h, pts[i + 1].y - t[i + 1] * h,
                  pts[i + 1].x, pts[i + 1].y);
      }
      return args;
    }

    function bezierPath(c, pts) {
      var args = bezierArgs(pts), i;
      c.moveTo(pts[0].x, pts[0].y);
      for (i = 0; i < args.length; i += 6) {
        c.bezierCurveTo(args[i], args[i + 1], args[i + 2], args[i + 3], args[i + 4], args[i + 5]);
      }
    }

    /* --- 循环 ---------------------------------------------------------- */
    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (!visible) { return; }
      if (now - last < FRAME_MS) { return; }
      last = now;
      needsDraw = false;
      draw(now);
    }

    function start() {
      if (!reduced && !raf) { last = 0; raf = requestAnimationFrame(tick); }
    }

    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    function redraw() { needsDraw = true; if (reduced) { draw(performance.now()); } }

    /* --- 联动:格子 ↔ 簇 ----------------------------------------------- */
    function setLink(key) {
      if (linkKey === key) { return; }
      linkKey = key;
      applyTileState();
      redraw();
    }

    function applyTileState() {
      var k = focusKey();
      for (var key in tiles) {
        if (!Object.prototype.hasOwnProperty.call(tiles, key)) { continue; }
        if (key === k) { tiles[key].classList.add("is-linked"); }
        else { tiles[key].classList.remove("is-linked"); }
      }
    }

    function onTileEnter(e) {
      setLink(e.currentTarget.getAttribute("data-pm2"));
    }

    function onTileLeave() {
      setLink(null);
    }

    Object.keys(tiles).forEach(function (key) {
      tiles[key].addEventListener("mouseenter", onTileEnter);
      tiles[key].addEventListener("mouseleave", onTileLeave);
      tiles[key].addEventListener("focus", onTileEnter);
      tiles[key].addEventListener("blur", onTileLeave);
    });

    function onPointer(e) {
      if (!geom) { return; }
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      var best = null, bestD = 1e9, i, p, d;
      for (i = 0; i < geom.pts.length; i++) {
        p = geom.pts[i];
        d = Math.abs(p.x - x);
        if (d < bestD) { bestD = d; best = p; }
      }
      var near = best && bestD < Math.max(46, geom.step * 0.42)
        && y > geom.top - 24 && y < geom.baseY + 30;
      var key = near ? best.s.key : null;
      if (key !== hoverKey) { hoverKey = key; applyTileState(); redraw(); }
    }

    function onPointerLeave() {
      if (hoverKey) { hoverKey = null; applyTileState(); redraw(); }
    }

    hero.addEventListener("pointermove", onPointer);
    hero.addEventListener("pointerleave", onPointerLeave);

    /* --- 尺寸 / 可见性 / 主题 ------------------------------------------ */
    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { resize(); });
      ro.observe(hero);
    } else {
      window.addEventListener("resize", resize);
    }

    var io = null;
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && !reduced) { start(); } else { stop(); }
      }, { rootMargin: "120px" });
      io.observe(hero);
    }

    var themeObserver = new MutationObserver(function () {
      toks = tokens();
      redraw();
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

    /* 主题切换时 Material 会重建 palette 组件,尺寸也可能变 */
    var onMedia = function () { toks = tokens(); resize(); };
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) { mq.addEventListener("change", onMedia); }

    resize();
    hero.classList.remove("pm2-hero--nojs");
    hero.classList.add("pm2-hero--js");
    if (reduced) { draw(performance.now()); } else { t0 = performance.now(); start(); }

    return {
      destroy: function () {
        stop();
        if (ro) { ro.disconnect(); }
        if (io) { io.disconnect(); }
        themeObserver.disconnect();
        if (mq.removeEventListener) { mq.removeEventListener("change", onMedia); }
        hero.removeEventListener("pointermove", onPointer);
        hero.removeEventListener("pointerleave", onPointerLeave);
        Object.keys(tiles).forEach(function (key) {
          tiles[key].removeEventListener("mouseenter", onTileEnter);
          tiles[key].removeEventListener("mouseleave", onTileLeave);
          tiles[key].removeEventListener("focus", onTileEnter);
          tiles[key].removeEventListener("blur", onTileLeave);
        });
      }
    };
  }

  /* --- 实例工厂 + 顶层 MutationObserver(navigation.instant 下重挂) ------ */
  var instance = null;

  function sync() {
    setBleed();
    var root = document.querySelector(".md-content__inner") || document.body;
    var has = !!root.querySelector(".pm2-hero") && !!root.querySelector(".pm2-grid");
    if (has && !instance) {
      instance = create(root);
    } else if (!has && instance) {
      instance.destroy();
      instance = null;
    }
  }

  var pending = false;
  function schedule() {
    if (pending) { return; }
    pending = true;
    requestAnimationFrame(function () { pending = false; sync(); });
  }

  function boot() {
    sync();
    window.addEventListener("resize", setBleed);
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true
      });
    }
    document.addEventListener("DOMContentLoaded", schedule);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
