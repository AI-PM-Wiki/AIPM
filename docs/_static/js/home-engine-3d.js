/*
  AI-PM 首页 banner 引擎 · 3D 版:「纸垛与扫描面 / Sheaf & Scan」(2026-09-21)

  视觉:7 层方格纸沿 Y 轴叠成纸垛(每层 16×9 格),在透视中绕 Y 缓慢自转、
  带一点俯角轻微起伏;稀疏的竖直连杆把纸垛锚成一体;一条扫描面沿 Y 往复
  穿过纸垛,面附近的节点与格线被染成 accent 青并显著提亮。近处亮、远处淡
  (深度雾),于是纸垛是透明的、能看穿的——是「结构」而不是「实体」。

  与 2D 版的关系:2D 版是同一张方格纸的正视单张;3D 版把同一张纸叠成垛并
  升维。两版共用同一套 --pm-engine-* token 与「墨 + accent 青」两种颜色,
  切换时是升维不是换皮。

  —— 工程契约(逐条对齐 docs/_static/js/banner.js,全部保持)——
  - 预乘 alpha:getContext({ premultipliedAlpha: true }) 且 shader 输出 rgb*a。
    iOS/iPadOS Safari 把 straight-alpha 画布按预乘合成,细线(α≈.16)会被丢光,
    只剩一片空白;桌面 Chromium 无此问题。这是最容易踩且最难发现的一条。
  - prefers-reduced-motion: reduce → 固定相位的静态单帧(不启 rAF)
  - IntersectionObserver 离屏停转
  - ~30fps 节流(FPS_MIN = 33ms)
  - DPR 上限 1.5(GL_LINES + 点精灵的填充成本,沿用 banner.js 的上限)
  - webglcontextlost → 降级(CSS 静态底图兜底);webglcontextrestored → 自愈
  - mkdocs.yml 开了 navigation.instant:换 DOM 时 head 脚本不重跑,故本文件只
    导出「实例工厂 create(root)」,由 home-engine.js 的顶层 MutationObserver
    负责新容器出现即重挂、消失即卸载(停 rAF/断观察器/释放 GL 上下文)
  - 无 WebGL → create 返回 null,由 home-engine.js 回退到 2D 版
*/
(() => {
  "use strict";

  const NS = (window.PMHomeEngine = window.PMHomeEngine || {});

  /* —— 纸垛尺寸(半长,模型空间)—— 取值受取景约束,见下方 DIST 处的算式 —— */
  const NX = 16, NZ = 9, NY = 7;
  const EX = 2.3, EZ = 0.8, EY = 0.42;
  /* 竖直连杆只挂在这些格点上(稀疏锚点),否则纸垛会糊成一团 */
  const ANCH_X = [0, 5, 10, 15];
  const ANCH_Z = [0, 4, 8];

  const FPS_MIN = 33;                 // ~30fps 节流
  const DPR_MAX = 1.5;
  /* 取景(按投影算式定的,不要随手改):
     绕 Y 全周自转把 X 半长 EX 带进深度,故 |z'| ≤ hypot(EX, EZ) = 2.435;
     经 TILT 俯角后 视空间 |y''| ≤ 1.032、w = DIST - z'' ∈ [3.74, 8.46]。
     可见半高 = DIST·tan(FOVY/2) = 1.608、半宽 = 2.5×半高(画布 5:2)。
     结果:纸垛常态占画幅高 ~64%、宽 ~61%,最近的角刚好擦到上下边(NDC_y ≈ 1.09),
     有纵深但不被拦腰裁断。DIST 再小就会把近角大面积切掉(试过 3.3,NDC_y≈3.3)。 */
  const DIST = 6.0;                   // 相机距离
  const FOVY = (30 * Math.PI) / 180;
  const TILT = -0.26;                 // 俯角
  const ROT_PERIOD = 48;              // 自转周期(秒)
  const SCAN_PERIOD = 9;              // 扫描面往返周期(秒)
  const STATIC_T = 12.0;              // reduced-motion 的固定相位

  /* ================================================================
     极简 mat4(列主序,与 GL 一致)
     ================================================================ */
  const mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  };
  const perspective = (fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const o = new Float32Array(16);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) * nf;
    o[11] = -1;
    o[14] = 2 * far * near * nf;
    return o;
  };
  const rotX = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  };
  const rotY = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  };
  const translate = (x, y, z) =>
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

  /* —— 颜色:只支持 hex / rgb() / rgba()(与 banner.js 同一约定) —— */
  const parseColor = (str) => {
    if (!str) return null;
    if (str[0] === "#") {
      const h = str.slice(1);
      const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      const v = parseInt(n, 16);
      if (isNaN(v)) return null;
      return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
    }
    const m = str.match(/[\d.]+/g) || [];
    if (m.length < 3) return null;
    return { r: (+m[0] || 0) / 255, g: (+m[1] || 0) / 255, b: (+m[2] || 0) / 255 };
  };

  const VERT = [
    "attribute vec3 a_pos;",
    "attribute float a_shade;",
    "uniform mat4 u_mvp;",
    "uniform float u_scan;",
    "uniform float u_alpha;",
    /* u_isPoint 必须显式 mediump:片元着色器是 precision mediump float,
       顶点着色器默认 highp,WebGL1 要求跨阶段同名 uniform 精度一致,否则
       linkProgram 直接失败(错误信息 "Precisions of uniform 'u_isPoint' differ
       between VERTEX and FRAGMENT shaders"),表现为引擎完全不出图(踩过)。
       varying 同理显式声明,避免依赖各阶段默认精度。 */
    "uniform mediump float u_isPoint;",
    "uniform float u_dpr;",
    "varying mediump float v_a;",
    "varying mediump float v_hot;",
    "void main() {",
    "  vec4 p = u_mvp * vec4(a_pos, 1.0);",
    "  gl_Position = p;",
    "  float fog = clamp((p.w - 3.4) / 5.0, 0.0, 1.0);",   // 近处亮、远处淡
    "  v_a = u_alpha * a_shade * mix(1.0, 0.16, fog);",
    "  float d = (a_pos.y - u_scan) * 6.0;",               // 扫描面附近的节点
    "  v_hot = exp(-d * d);",
    "  gl_PointSize = (u_isPoint > 0.5 ? mix(3.4, 1.5, fog) : 1.0) * u_dpr;",
    "}",
  ].join("\n");

  const FRAG = [
    "precision mediump float;",
    "uniform vec3 u_ink;",
    "uniform vec3 u_accent;",
    "uniform float u_isPoint;",
    "varying mediump float v_a;",
    "varying mediump float v_hot;",
    "void main() {",
    "  float a = v_a;",
    "  if (u_isPoint > 0.5) {",                             // 点精灵 → 柔边圆点
    "    float r = length(gl_PointCoord - vec2(0.5));",
    "    a *= 1.0 - smoothstep(0.26, 0.5, r);",   // 不可写 smoothstep(0.5, 0.26, r):edge0>edge1 是未定义行为
    "    if (a <= 0.002) discard;",
    "  }",
    "  float hot = clamp(v_hot, 0.0, 1.0);",
    "  vec3 col = mix(u_ink, u_accent, hot);",
    "  a = clamp(a * (1.0 + 2.0 * hot), 0.0, 1.0);",
    "  gl_FragColor = vec4(col * a, a);",                   // 预乘输出(与 premultipliedAlpha 配对)
    "}",
  ].join("\n");

  const create = (root) => {
    const canvas = root.querySelector("canvas.pm-banner__canvas--3d");
    if (!canvas) return null;
    /* alpha + 预乘:见文件头「工程契约」第一条 */
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
      powerPreference: "low-power",
    }) || canvas.getContext("experimental-webgl", { alpha: true, premultipliedAlpha: true });
    if (!gl) return null;   // 无 WebGL:交给 home-engine.js 回退 2D

    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");

    let disposed = false, raf = 0, last = 0, tCur = STATIC_T;
    let visible = true, motionOK = !RM.matches;
    let W = 0, H = 0, DPR = 1;

    /* —— 几何:纸垛的节点 + 三族线(一次性构建,之后每帧只换 uniform) —— */
    const node = (i, k, j) => [EX * (-1 + 2 * i / (NX - 1)),
                               EY * (-1 + 2 * j / (NY - 1)),
                               EZ * (-1 + 2 * k / (NZ - 1))];
    const shadeOf = (j) => 0.72 + 0.28 * (j / (NY - 1));   // 顶层略亮,分层可读

    const pts = [], ptsShade = [];
    for (let j = 0; j < NY; j++) {
      for (let k = 0; k < NZ; k++) {
        for (let i = 0; i < NX; i++) {
          const p = node(i, k, j);
          pts.push(p[0], p[1], p[2]);
          ptsShade.push(shadeOf(j));
        }
      }
    }
    const lines = [], lineShade = [];
    const pushSeg = (a, b, j) => { lines.push(a[0], a[1], a[2], b[0], b[1], b[2]); lineShade.push(shadeOf(j), shadeOf(j)); };
    for (let j = 0; j < NY; j++) {
      for (let k = 0; k < NZ; k++) {                       // 每层的 X 向格线
        for (let i = 0; i < NX - 1; i++) pushSeg(node(i, k, j), node(i + 1, k, j), j);
      }
      for (let i = 0; i < NX; i++) {                       // 每层的 Z 向格线
        for (let k = 0; k < NZ - 1; k++) pushSeg(node(i, k, j), node(i, k + 1, j), j);
      }
    }
    for (const i of ANCH_X) {                              // 稀疏竖直连杆
      for (const k of ANCH_Z) {
        for (let j = 0; j < NY - 1; j++) pushSeg(node(i, k, j), node(i, k, j + 1), j);
      }
    }
    const nPoint = pts.length / 3;
    const nLine = lines.length / 3;

    /* —— GL 资源 —— */
    let prog = null, U = {}, bufP = null, bufPs = null, bufL = null, bufLs = null;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
      return s;
    };
    const initGL = () => {
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { prog = null; return false; }
      gl.useProgram(prog);

      U = {
        mvp: gl.getUniformLocation(prog, "u_mvp"),
        scan: gl.getUniformLocation(prog, "u_scan"),
        alpha: gl.getUniformLocation(prog, "u_alpha"),
        isPoint: gl.getUniformLocation(prog, "u_isPoint"),
        dpr: gl.getUniformLocation(prog, "u_dpr"),
        ink: gl.getUniformLocation(prog, "u_ink"),
        accent: gl.getUniformLocation(prog, "u_accent"),
        aPos: gl.getAttribLocation(prog, "a_pos"),
        aShade: gl.getAttribLocation(prog, "a_shade"),
      };
      const mk = (arr) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        return b;
      };
      bufP = mk(pts); bufPs = mk(ptsShade);
      bufL = mk(lines); bufLs = mk(lineShade);
      if (U.aPos >= 0) gl.enableVertexAttribArray(U.aPos);
      if (U.aShade >= 0) gl.enableVertexAttribArray(U.aShade);
      /* 预乘 alpha 的正确混合式 */
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return true;
    };

    /* —— 主题 token:ink = 墨(纸垛本体),accent = 青(扫描面/热区) —— */
    const INK_FB = { r: 0.059, g: 0.106, b: 0.176 };
    const ACC_FB = { r: 0.031, g: 0.569, b: 0.698 };
    let ink = INK_FB, accent = ACC_FB;
    const readTokens = () => {
      const s = getComputedStyle(document.body);
      ink = parseColor(s.getPropertyValue("--pm-engine-ink").trim()) || INK_FB;
      accent = parseColor(s.getPropertyValue("--pm-engine-accent").trim()) || ACC_FB;
    };

    const size = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      DPR = Math.min(window.devicePixelRatio || 1, DPR_MAX);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
    };

    const drawGL = (t) => {
      if (!gl || !prog) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);

      /* 扫描面:沿 Y 往返(smoothstep 缓动),落在 ±EY 之间 */
      const ph = (t % SCAN_PERIOD) / SCAN_PERIOD;
      const lin = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const scanY = -EY + 2 * EY * (lin * lin * (3 - 2 * lin));

      const rot = (t / ROT_PERIOD) * Math.PI * 2;
      const tilt = TILT + 0.05 * Math.sin(t * 0.11);
      const dist = DIST + 0.15 * Math.sin(t * 0.07);
      const mvp = mul(perspective(FOVY, W / H, 1.0, 16),
                      mul(translate(0, 0, -dist), mul(rotX(tilt), rotY(rot))));

      gl.uniformMatrix4fv(U.mvp, false, mvp);
      gl.uniform1f(U.scan, scanY);
      gl.uniform1f(U.dpr, DPR);
      gl.uniform3f(U.ink, ink.r, ink.g, ink.b);
      gl.uniform3f(U.accent, accent.r, accent.g, accent.b);

      const bind = (b, s) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        if (U.aPos >= 0) gl.vertexAttribPointer(U.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, s);
        if (U.aShade >= 0) gl.vertexAttribPointer(U.aShade, 1, gl.FLOAT, false, 0, 0);
      };

      gl.uniform1f(U.isPoint, 0);      // 线框:细、淡,负责「结构」
      gl.uniform1f(U.alpha, 0.17);
      bind(bufL, bufLs);
      gl.drawArrays(gl.LINES, 0, nLine);

      gl.uniform1f(U.isPoint, 1);      // 节点:点精灵,负责「密度」
      gl.uniform1f(U.alpha, 0.5);
      bind(bufP, bufPs);
      gl.drawArrays(gl.POINTS, 0, nPoint);
    };

    const render = () => drawGL(tCur);   // 单帧(静态相位 / 主题切换 / 尺寸变化)

    const loop = (now) => {
      raf = 0;
      if (!motionOK || !visible || disposed) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FPS_MIN) return;
      tCur += Math.min(0.1, (now - last) / 1000);
      last = now;
      drawGL(tCur);
    };
    const start = () => {
      if (raf || disposed || !motionOK || !gl) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    /* —— 观察器 —— */
    let ro = null, io = null, moTheme = null;
    const onRMChange = (e) => {
      motionOK = !e.matches;
      if (motionOK) start(); else { stop(); render(); }
    };
    const onLost = (e) => {
      e.preventDefault();     // 阻止默认行为,才能等到 restored 自愈
      stop();
      prog = null;
    };
    const onRestored = () => {
      if (initGL()) { size(); start(); } else { render(); }
    };

    readTokens();
    size();
    if (!initGL()) {
      /* 着色器编译/链接失败:此时还没挂任何观察器与监听器,直接返回 null
         交给 home-engine.js 回退 2D(顺序很重要,挂完再失败就会漏监听器) */
      return null;
    }

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
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    render();
    start();

    const settle = () => { if (!disposed) { readTokens(); render(); } };
    requestAnimationFrame(settle);

    const dispose = () => {
      disposed = true;
      stop();
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      if (moTheme) moTheme.disconnect();
      RM.removeEventListener("change", onRMChange);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      ro = io = moTheme = null;
      if (gl) {
        /* 先删资源:GPU 侧立刻回收,下次 mount 由 initGL() 重建 */
        for (const b of [bufP, bufPs, bufL, bufLs]) if (b) gl.deleteBuffer(b);
        if (prog) gl.deleteProgram(prog);
        /* ⚠ 只在画布**已脱离文档**时才主动 loseContext()。
           原因(踩过):loseContext() 之后,这个 canvas 与该上下文类型就永久绑定为
           「已丢失」——再调 getContext("webgl") 拿回来的仍是那个 lost 上下文
           (要恢复只能靠异步的 restoreContext + webglcontextrestored 事件),
           于是 2D↔3D 来回切时切回 3D 会直接失败(实测 glError = CONTEXT_LOST_WEBGL
           37442,引擎退化成 2D)。2D↔3D 切换复用的是同一个 canvas,所以只有
           「容器已被移出 DOM、这个 canvas 不会再被复用」时才释放上下文;
           那种情况下不释放才会真的堆积 GL 上下文。 */
        if (!canvas.isConnected) {
          const lose = gl.getExtension("WEBGL_lose_context");
          if (lose) lose.loseContext();
        }
      }
      prog = null; U = {}; bufP = bufPs = bufL = bufLs = null;
    };

    return { dispose };
  };

  NS.engine3d = {
    create,
    label: "AI-PM 生成式网格:7 层方格纸叠成的纸垛在透视中缓慢自转,一条扫描面沿纸垛往复穿过并把所经的节点与格线染成青色",
    meta: "ENGINE 3D ▸ 16×9×7 SHEAF ▸ SCAN 9s",
  };
})();
