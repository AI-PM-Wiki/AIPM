/*
  AI-PM 首页 banner 引擎 · 2D 版:「方格纸场 / Graph Paper Field」(2026-09-21)

  视觉:一张被平滑场顶歪的方格纸。细格线用主题前景色(墨),每第 5 条主格线用
  accent 青;一台「绘图笔」左右缓慢扫过,所经的若干列被点亮为实 accent;5 枚
  信号方块沿同一个场漂移,留下渐隐的尾迹。整体是「平面设计师的绘图仪输出」,
  不是 shader 的廉价 imitation——干净矢量、发丝级细线、方形像素头。

  与 3D 版的关系:3D 版是「同一张方格纸叠成 7 层、在透视中旋转、一条扫描面
  穿过纸垛」。2D 是单张纸的正视,3D 是纸垛的透视——两版同一设计语言的两个
  维度,切换时是「升维」而不是「换皮」。

  工程契约(与 docs/_static/js/banner.js 同源;3D 版、home-engine.js 亦然):
  - 实例工厂 create(root) → { dispose };顶层挂载同步由 home-engine.js 负责
  - 颜色全部读 extra.css 第 13 节的 --pm-engine-* token(亮/暗两套),
    主题切换(data-md-color-scheme 变化)重绘
  - prefers-reduced-motion: reduce → 固定相位的静态单帧(不启 rAF)
  - IntersectionObserver 离屏停转;~30fps 节流;DPR 上限 2
    (Canvas2D 便宜,取 2 让发丝线在 Retina 上不糊)
  - 无 Canvas2D(极罕见)→ create 返回 null,CSS 静态底图兜底,不报错
  - dispose 必须停 rAF、断观察器;本引擎不持有 GL 上下文,无上下文泄漏面
*/
(() => {
  "use strict";

  const NS = (window.PMHomeEngine = window.PMHomeEngine || {});

  /* 格:60 列 × 24 行(画布 5:2,故格子近似正方形),每 5 条一条主格线;
     外扩 6% 采样,保证场把边缘推开时画布四周不会露白边 */
  const COLS = 60;
  const ROWS = 24;
  const MAJOR = 5;
  const BLEED = 0.06;

  const FPS_MIN = 33;        // ~30fps 节流
  const SWEEP = 13.0;        // 绘图笔一次左右往返的周期(秒)
  const TRACERS = 5;
  const TRAIL = 6;           // 信号方块的尾迹点数
  const STATIC_T = 8.0;      // reduced-motion 的固定相位

  /* 三团「质量」:Lissajous 缓慢游走,把方格纸顶出穹状形变。
     s 为带符号的位移幅值(单位 = 画布高),正=外推、负=内吸,r 为影响半径 */
  const MASSES = [
    { ax: 0.34, ay: 0.17, wx: 0.23, wy: 0.17, px: 0.0, py: 1.1, r: 0.40, s: 0.055 },
    { ax: 0.26, ay: 0.21, wx: -0.17, wy: 0.21, px: 2.1, py: 0.4, r: 0.34, s: -0.045 },
    { ax: 0.18, ay: 0.14, wx: 0.31, wy: -0.14, px: 4.0, py: 3.2, r: 0.28, s: 0.035 },
  ];

  /* 信号方块的复位点(归一化:u 为宽、v 为高),错开布局避免同起同落 */
  const TRACER_START = [
    [0.10, 0.22], [0.10, 0.72], [0.10, 0.47], [0.10, 0.33], [0.10, 0.61],
  ];

  const TOKENS = ["ink", "accent", "faint", "grid"];

  /* token 读不到时的兜底(正常路径不会用到;亮色集) */
  const FALLBACK = {
    ink: "rgba(15, 27, 45, .55)",
    accent: "rgba(8, 145, 178, .85)",
    faint: "rgba(15, 27, 45, .30)",
    grid: "rgba(15, 27, 45, .10)",
  };

  const create = (root) => {
    const canvas = root.querySelector("canvas.pm-banner__canvas--2d");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");

    /* —— 主题 token(Canvas2D 直接吃 CSS 颜色串,rgba() 无需解析) —— */
    const T = { ink: FALLBACK.ink, accent: FALLBACK.accent, faint: FALLBACK.faint, grid: FALLBACK.grid };
    const readTokens = () => {
      const s = getComputedStyle(document.body);
      for (const k of TOKENS) {
        const v = s.getPropertyValue(`--pm-engine-${k}`).trim();
        T[k] = v || FALLBACK[k];
      }
    };

    let W = 0, H = 0, AR = 1, DPR = 1, disposed = false;
    let raf = 0, last = 0, tCur = STATIC_T;
    let visible = true, motionOK = !RM.matches;

    /* 顶点缓存(像素坐标):(COLS+1) × (ROWS+1) */
    const NV = (COLS + 1) * (ROWS + 1);
    const px = new Float32Array(NV);
    const py = new Float32Array(NV);

    /* 信号方块:位置用「画布高」为单位(X ∈ [0, AR],Y ∈ [0, 1]) */
    const tracers = [];
    for (let i = 0; i < TRACERS; i++) tracers.push({ X: 0, Y: 0, h: [], i });

    const resetTracer = (p) => {
      p.X = TRACER_START[p.i][0] * AR;
      p.Y = TRACER_START[p.i][1];
      p.h.length = 0;
    };

    /* ================================================================
       场:把点 (X, Y) 推离三团质心,返回位移(单位 = 画布高)
       ================================================================ */
    const field = (X, Y, t, out) => {
      let dx = 0, dy = 0;
      for (let i = 0; i < MASSES.length; i++) {
        const m = MASSES[i];
        const cx = AR * (0.5 + m.ax * Math.cos(m.wx * t + m.px));
        const cy = 0.5 + m.ay * Math.sin(m.wy * t + m.py);
        const vx = X - cx, vy = Y - cy;
        const d2 = vx * vx + vy * vy;
        const d = Math.sqrt(d2);
        if (d < 1e-4) continue;              // 质心处位移为 0,跳过奇异点
        const w = (m.s * Math.exp(-d2 / (m.r * m.r))) / d;
        dx += vx * w;
        dy += vy * w;
      }
      /* 全局轻微剪切:让场不是纯径向,方格纸有「被风斜吹」的味道 */
      dx += 0.014 * Math.sin(Y * 2.7 + t * 0.21);
      dy += 0.010 * Math.sin(X * 2.2 - t * 0.17);
      out[0] = dx;
      out[1] = dy;
    };

    const vtmp = [0, 0];

    /* 重算全部顶点:X 以「画布高」为单位铺开,X/Y 再换算回像素 */
    const buildVerts = (t) => {
      for (let j = 0; j <= ROWS; j++) {
        const Y = -BLEED + (1 + 2 * BLEED) * (j / ROWS);
        const row = j * (COLS + 1);
        for (let i = 0; i <= COLS; i++) {
          const X = (-BLEED + (1 + 2 * BLEED) * (i / COLS)) * AR;
          field(X, Y, t, vtmp);
          const k = row + i;
          px[k] = (X + vtmp[0]) * H;   // X * H === (X / AR) * W
          py[k] = (Y + vtmp[1]) * H;
        }
      }
    };

    /* ================================================================
       绘制
       ================================================================ */
    /* 一条水平折线(第 j 行) */
    const rowPath = (j, step) => {
      const base = j * (COLS + 1);
      ctx.moveTo(px[base], py[base]);
      for (let i = step; i <= COLS; i += step) ctx.lineTo(px[base + i], py[base + i]);
    };
    /* 一条垂直折线(第 i 列) */
    const colPath = (i, step) => {
      ctx.moveTo(px[i], py[i]);
      for (let j = step; j <= ROWS; j += step) ctx.lineTo(px[j * (COLS + 1) + i], py[j * (COLS + 1) + i]);
    };

    const draw = (t) => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* 1) 细格线:前景色墨,极淡 */
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = T.ink;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let j = 0; j <= ROWS; j++) if (j % MAJOR !== 0) rowPath(j, 1);
      for (let i = 0; i <= COLS; i++) if (i % MAJOR !== 0) colPath(i, 1);
      ctx.stroke();

      /* 2) 主格线:accent,每 5 条一条(方格纸的 5mm 线) */
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = T.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j <= ROWS; j += MAJOR) rowPath(j, 1);
      for (let i = 0; i <= COLS; i += MAJOR) colPath(i, 1);
      ctx.stroke();

      /* 3) 绘图笔:左右往返(smoothstep 缓动),所经列点亮为实 accent */
      const ph = (t % SWEEP) / SWEEP;
      const lin = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const su = lin * lin * (3 - 2 * lin);
      const xAt = (u) => (-BLEED + (1 + 2 * BLEED) * u) * W;

      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = T.accent;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) {
        if (Math.abs(i / COLS - su) > 0.05) continue;
        colPath(i, 1);
      }
      ctx.stroke();

      /* 4) 笔身:一条 1.4px 亮线 + 两侧各一条 1px 弱线,组成柔和光带 */
      const sx = xAt(su);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
      ctx.stroke();
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 1;
      for (const off of [-7, 7]) {
        ctx.beginPath();
        ctx.moveTo(sx + off, 0);
        ctx.lineTo(sx + off, H);
        ctx.stroke();
      }

      /* 5) 信号方块:头 3px 实 accent,尾迹渐隐的 2px 小方 */
      ctx.fillStyle = T.accent;
      for (const p of tracers) {
        for (let n = p.h.length - 1; n >= 1; n--) {
          ctx.globalAlpha = 0.34 * (1 - n / TRAIL);
          const s = 2;
          ctx.fillRect(p.h[n][0] * H - s / 2, p.h[n][1] * H - s / 2, s, s);
        }
        if (p.h.length) {
          ctx.globalAlpha = 1;
          const s = 3;
          ctx.fillRect(p.h[0][0] * H - s / 2, p.h[0][1] * H - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
    };

    /* ================================================================
       推进
       ================================================================ */
    const stepTracers = (t, dt) => {
      for (const p of tracers) {
        field(p.X, p.Y, t, vtmp);
        /* 场位移当速度 + 缓慢右漂 + 每枚错相的正弦纵向摆动 */
        p.X += (vtmp[0] * 1.6 + 0.055) * dt;
        p.Y += (vtmp[1] * 1.6 + 0.030 * Math.sin(t * 0.6 + p.i * 1.7)) * dt;
        if (p.X < -0.12 || p.X > AR + 0.12 || p.Y < -0.12 || p.Y > 1.12) resetTracer(p);
        p.h.unshift([p.X, p.Y]);
        if (p.h.length > TRAIL) p.h.pop();
      }
    };

    const step = (t, dt) => {
      buildVerts(t);
      if (dt > 0) stepTracers(t, dt);
      draw(t);
    };

    const render = () => step(tCur, 0);   // 单帧(静态相位 / 主题切换 / 尺寸变化)

    const loop = (now) => {
      raf = 0;
      if (!motionOK || !visible || disposed) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FPS_MIN) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      tCur += dt;
      step(tCur, dt);
    };
    const start = () => {
      if (raf || disposed || !motionOK) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    /* ================================================================
       尺寸
       ================================================================ */
    const size = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      AR = W / H;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      for (const p of tracers) {
        if (!p.h.length) { resetTracer(p); continue; }
        if (p.X > AR) p.X = Math.min(p.X, AR);
      }
    };

    /* ================================================================
       观察器
       ================================================================ */
    let ro = null, io = null, moTheme = null;
    const onRMChange = (e) => {
      motionOK = !e.matches;
      if (motionOK) start(); else { stop(); render(); }
    };

    ro = new ResizeObserver(() => { size(); render(); });
    ro.observe(canvas);
    io = new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible) start(); else stop();
    });
    io.observe(canvas);
    RM.addEventListener("change", onRMChange);
    moTheme = new MutationObserver(() => { readTokens(); render(); });
    moTheme.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

    readTokens();
    size();
    for (const p of tracers) resetTracer(p);
    /* 预热尾迹:否则首帧(含 reduced-motion 的静态单帧)里信号方块还没留下尾迹,
       只剩一个孤点。用固定相位推进 TRAIL 步,保证静态帧与动画首帧都完整 */
    for (let i = 0; i < TRAIL; i++) stepTracers(STATIC_T - (TRAIL - i) / 30, 1 / 30);
    render();
    start();

    /* 首帧可能早于异步样式表完成:下一帧再读一次 token,避免把空值固化成错误颜色 */
    const settle = () => { if (!disposed) { readTokens(); render(); } };
    requestAnimationFrame(settle);

    const dispose = () => {
      disposed = true;
      stop();
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      if (moTheme) moTheme.disconnect();
      RM.removeEventListener("change", onRMChange);
      ro = io = moTheme = null;
    };

    return { dispose };
  };

  NS.engine2d = {
    create,
    label: "AI-PM 生成式网格:一张被平滑场顶歪的方格纸,一条绘图笔左右扫过并点亮所经的列,5 枚信号方块沿同一个场漂移",
    meta: "ENGINE 2D ▸ SHEET 60×24 ▸ SWEEP 13s",
  };
})();
