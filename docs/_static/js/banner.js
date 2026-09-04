/*
  AI-PM 首页 banner:「深海测深场 · Carved AIPM」(2026-08-25 深海改版;
  引擎沿用 2026-08-23 第三版等势线地形,工程契约全部不变)

  视觉(深海叙事·知识海沟):WebGL fragment shader 实时渲染 domain-warped fbm
  标量场——读作「测深地形图」,等势线 = 水深线(sonar 青),每第 5 条计曲线
  (index contour)= phosphor 亮线;AIPM 四字是「知识海沟」:字形区域在 shader
  中被压平(等势线字内消失、字缘堆叠成轮廓环),再取字形遮罩 0.5 等值线常绘
  一条边缘轮廓(缓慢呼吸 + 指针入场增亮),罩一层极淡 sonar 洗色;3 颗环境
  电荷游走,指针移入即注入第四颗(声呐扰动)。ink 层 = 6 枚 ASCII micro
  标签([ MODEL ] 等)+ 生物荧光像素流(极淡 phosphor 方块,缓慢右漂、微闪烁)。
  视口顶条 VESSEL.SYS 与右下角框由 extra.css §12 伪元素绘制。

  工程契约(全部保持):
  - 双层 canvas:--gl(WebGL 场)+ --ink(2D 标签层);无 WebGL → 2D 静态降级帧(深海色)
  - 颜色全部读 extra.css 第 12 节 --pm-banner-* token(深/浅两套调性:
    深=深海、浅=白昼海面;从 <body> 读计算样式,主题切换重绘)
  - WebGL 预乘 alpha(premultipliedAlpha:true + shader 输出 rgb*a):
    iOS/iPadOS Safari 把 straight-alpha 画布按预乘合成,glyph 洗色(α≈.08)
    与细等势线会被丢光,只剩空心字缘——桌面 Edge/Chrome 无此问题
  - prefers-reduced-motion → 固定相位的静态单帧(含粒子静态帧);
    IntersectionObserver 离屏停转;~30fps 节流;DPR 上限 1.5(shader 成本);
    webglcontextlost 降级、restored 自愈
  - instant 导航(mkdocs.yml navigation.instant)换 DOM 时 head 脚本不重跑:
    实例工厂 create() + 顶层 MutationObserver 盯 body 子树,新 .pm-banner
    出现即重挂、消失即卸载(停 rAF/断观察器/释放 GL),避免切回首页后空白
*/
(() => {
  "use strict";

  /* ================================================================
     实例工厂:挂载一个 .pm-banner,返回 { dispose }(instant 导航重挂用)
     ================================================================ */
  const create = (banner) => {
    const glCanvas = banner.querySelector("canvas.pm-banner__canvas--gl");
    const inkCanvas = banner.querySelector("canvas.pm-banner__canvas--ink");
    const ink = inkCanvas && inkCanvas.getContext("2d");
    if (!glCanvas || !ink) return null;

    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
    const FPS_MIN = 33;          // ~30fps 节流
    const LEVELS = 16;           // 等势线级数
    const POINTER_K = 9.0;       // 指针电荷紧度
    const POINTER_S = 0.34;      // 指针电荷强度
    const GLYPH_FLAT = 0.5;      // 字形压平到的场值(须落在两条等势线之间)

    /* —— 覆盖层:主题 micro 标签(归一化锚点 + 缓慢漂移),全部避开场心字形区 —— */
    const LABELS = [
      { t: "MODEL",  fx: 0.07, fy: 0.20 },
      { t: "RAG",    fx: 0.09, fy: 0.82 },
      { t: "METHOD", fx: 0.32, fy: 0.20 },
      { t: "GROWTH", fx: 0.34, fy: 0.90 },
      { t: "METRIC", fx: 0.87, fy: 0.16 },
      { t: "TEAM",   fx: 0.91, fy: 0.80 },
    ];

    /* 环境电荷(归一化中心 + 半径/角速度/相位/强度),shader 坐标 y 向上;
       游走全场——经过字形下方时被压平,环在字缘聚散,是预期的地形起伏 */
    const CHARGES = [
      { cx: 0.20, cy: 0.40, rx: 0.075, ry: 0.16, w1: 0.31, w2: 0.23, p1: 0.0, p2: 1.3, s: 0.30 },
      { cx: 0.55, cy: 0.62, rx: 0.100, ry: 0.12, w1: 0.19, w2: 0.27, p1: 2.1, p2: 0.4, s: 0.26 },
      { cx: 0.82, cy: 0.42, rx: 0.065, ry: 0.15, w1: 0.26, w2: 0.21, p1: 4.2, p2: 2.9, s: 0.32 },
    ];

    /* 生物荧光像素流:确定性伪随机方块(归一化锚点 + 尺寸/漂速/振幅/相位),
       极淡 phosphor;相位由 t 驱动 → RM/离屏自动落为静态单帧 */
    const PS = [];
    const PS_COUNT = 36;
    for (let i = 0; i < PS_COUNT; i++) {
      const fr = (n) => (i * n) % 1;
      PS.push({
        fx: fr(0.618034),
        fy: 0.06 + fr(0.754878) * 0.88,
        s: 1.2 + fr(0.414214) * 1.2,
        sp: 0.004 + fr(0.271828) * 0.008,
        amp: 0.008 + fr(0.172345) * 0.02,
        ph: i * 2.3999,
      });
    }

    /* —— token(extra.css 第 12 节,亮/暗两套;只解析 hex/rgb()/rgba()) ——
       主题 attribute 挂在 <body>(Material 9.x:data-md-color-scheme),
       token 集在 :root(浅)与 [data-md-color-scheme="slate"](深)上,
       须从 body 读计算样式才能随主题取到对应集;
       深/浅同值时读 html 也碰巧正确,两套调性分家后必须读 body */
    const T = {};
    const TOKENS = ["line", "major", "grid", "ink", "faint", "accent", "glyph"];
    /* CSS 尚未应用时不能让空值落成黑色不透明,否则首屏会出现黑底黑字。
       默认值与 extra.css 的两套 token 同步;样式加载后仍会重新读取实际值。 */
    const TOKEN_DEFAULTS = {
      default: {
        line: "rgba(37, 99, 235, .30)",
        major: "rgba(8, 145, 178, .55)",
        grid: "rgba(30, 64, 175, .06)",
        glyph: "rgba(59, 130, 246, .08)",
        ink: "rgba(15, 27, 45, .88)",
        faint: "rgba(15, 27, 45, .88)",
        accent: "rgba(14, 116, 144, .45)",
      },
      slate: {
        line: "rgba(34, 211, 238, .22)",
        major: "rgba(165, 243, 252, .6)",
        grid: "rgba(148, 196, 255, .05)",
        glyph: "rgba(34, 211, 238, .07)",
        ink: "rgba(230, 240, 250, .88)",
        faint: "rgba(126, 156, 192, .6)",
        accent: "rgba(165, 243, 252, .95)",
      },
    };
    const readTokens = () => {
      const s = getComputedStyle(document.body);
      const scheme = document.body.getAttribute("data-md-color-scheme") === "slate"
        ? "slate" : "default";
      for (const k of TOKENS) {
        const value = s.getPropertyValue(`--pm-banner-${k}`).trim();
        T[k] = parseColor(value) || parseColor(TOKEN_DEFAULTS[scheme][k]);
      }
    };
    /* "#rrggbb" | "rgb()" | "rgba()" → {r,g,b,a} (0-1) */
    const parseColor = (str) => {
      if (!str) return null;
      if (str[0] === "#") {
        const h = str.slice(1);
        const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
        const v = parseInt(n, 16);
        return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255, a: 1 };
      }
      const m = str.match(/[\d.]+/g) || [];
      if (m.length < 3) return null;
      return {
        r: (+m[0] || 0) / 255, g: (+m[1] || 0) / 255, b: (+m[2] || 0) / 255,
        a: m.length > 3 ? +m[3] : 1,
      };
    };
    const css = (c, mul = 1) =>
      `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${Math.min(1, c.a * mul)})`;

    /* —— 尺寸(DPR 上限 1.5,shader 成本);宽高比变化须重建字形纹理 —— */
    let W = 0, H = 0, DPR = 1, aspect = 1;
    const size = () => {
      const r = banner.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      aspect = W / H;
      DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      for (const c of [glCanvas, inkCanvas]) {
        c.width = Math.round(W * DPR);
        c.height = Math.round(H * DPR);
      }
      ink.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (gl) {
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        makeGlyphTexture();
      }
    };

    /* ================================================================
       WebGL 层:等势线 fragment shader + AIPM 字形纹理(场雕刻)
       ================================================================ */
    const VERT = "attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.,1.);}";
    const FRAG = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#define FW(x) fwidth(x)
#else
#define FW(x) u_fw
#endif
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_ch[3];     /* 环境电荷:x,y(shader 坐标),z=强度 */
uniform vec2 u_ptr;       /* 指针电荷位置 */
uniform float u_ps;       /* 指针电荷强度 0..1 */
uniform sampler2D u_glyph;/* AIPM 字形遮罩(alpha,已模糊收边) */
uniform vec4 u_glyphc;    /* 字形洗色(accent,低 alpha) */
uniform vec4 u_line;      /* 细等势线 */
uniform vec4 u_major;     /* 计曲线(accent) */
uniform vec4 u_grid;      /* 底纹网格 */
uniform float u_fw;       /* 无 derivatives 时的兜底线宽 */

float hash(vec2 p){
  p = fract(p*vec2(123.34,345.45));
  p += dot(p,p+34.345);
  return fract(p.x*p.y);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),
             mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.8,0.6,-0.6,0.8);
  for(int i=0;i<5;i++){ v += a*noise(p); p = rot*p*2.0 + vec2(11.5,7.3); a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  vec2 p = vec2(uv.x*asp, uv.y);
  float t = u_time;

  /* domain-warped fbm 标量场 */
  vec2 q = vec2(fbm(p*1.45 + vec2(0.0, t*0.70)),
                fbm(p*1.45 + vec2(5.2, -t*0.55)));
  vec2 r = vec2(fbm(p*1.45 + 1.6*q + vec2(1.7,9.2) + t*0.35),
                fbm(p*1.45 + 1.6*q + vec2(8.3,2.8) - t*0.28));
  float F = fbm(p*1.45 + 1.8*r);

  /* 环境电荷(高斯鼓包) */
  for(int i=0;i<3;i++){
    vec2 d = p - u_ch[i].xy;
    F += u_ch[i].z * exp(-dot(d,d)*7.0);
  }
  /* 指针电荷 */
  vec2 dp = p - u_ptr;
  F += u_ps * exp(-dot(dp,dp)*${POINTER_K.toFixed(1)});

  /* AIPM 场雕刻:字形区域压平成盆地(等势线在字内消失、在字缘堆叠) */
  float letter = texture2D(u_glyph, vec2(uv.x, 1.0 - uv.y)).a;
  F = mix(F, ${GLYPH_FLAT.toFixed(2)}, letter * 0.95);

  /* 等势线提取:细线 + 每 5 条一根计曲线 */
  float v = F * ${LEVELS.toFixed(1)};
  float minor = 1.0 - smoothstep(0.0, max(FW(v),1e-4)*1.1, abs(fract(v)-0.5));
  float vM = v / 5.0;
  float major = 1.0 - smoothstep(0.0, max(FW(vM),1e-4)*1.8, abs(fract(vM)-0.5));

  /* 底纹发丝网格(仅无等势线、无字形处) */
  vec2 gp = uv * vec2(28.0, 11.0);
  float gline = 1.0 - smoothstep(0.0, max(FW(gp.x),1e-4), min(abs(fract(gp.x)-0.5), abs(fract(gp.y)-0.5)));
  gline *= (1.0 - max(minor, major)) * (1.0 - letter);

  /* 合成:字形洗色铺底,网格与等势线盖上 */
  vec3 col = u_glyphc.rgb;
  float alpha = letter * u_glyphc.a;
  alpha = max(alpha, gline * u_grid.a);
  col = mix(col, u_line.rgb, minor);
  alpha = max(alpha, minor * u_line.a);
  col = mix(col, u_major.rgb, major);
  alpha = max(alpha, major * u_major.a);

  /* 字形边缘轮廓线:取遮罩 0.5 等值线(即字缘中带),与场值无关、恒在场——
     场压平只在其周边场值与盆底相差够大时才会堆出环,环境场接近盆底时环会消失;
     这条线补上"大多数时段可见"的轮廓:缓慢呼吸(0.35–0.85),指针入场增亮 */
  float edge = 1.0 - smoothstep(0.0, max(FW(letter), 1e-4) * 1.5, abs(letter - 0.5));
  float oline = edge * clamp(0.60 + 0.25 * sin(u_time * 13.0) + u_ps * 0.50, 0.0, 1.0);
  col = mix(col, u_major.rgb, oline);
  alpha = max(alpha, oline * u_major.a * 1.3);

  alpha += (hash(gl_FragCoord.xy + fract(t)*7.0) - 0.5) * 0.02; /* 抖动去色带 */
  /* 预乘输出:与 getContext({premultipliedAlpha:true}) 配对。
     iOS Safari 对 straight alpha 会丢掉低 α 的洗色/细线。 */
  float a = clamp(alpha, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}`;

    let gl = null, prog = null, U = {}, glyphTex = null;

    /* AIPM 字形遮罩:离屏 canvas 画大字 + 高斯模糊收边(模糊带即等势线堆叠带),
       纹理宽高比与横幅一致以免拉伸;NPOT + CLAMP_TO_EDGE + LINEAR */
    const makeGlyphTexture = () => {
      if (!gl) return;
      const oc = document.createElement("canvas");
      oc.width = 1024;
      oc.height = Math.max(2, Math.round(1024 / aspect));
      const o = oc.getContext("2d");
      if (!o) return;
      o.fillStyle = "#fff";
      o.textAlign = "center";
      o.textBaseline = "middle";
      /* 字号按高度取六成,再按实际字宽收敛(窄横幅 min-height 会压低宽高比,
         不收敛则 A/M 两端被裁) */
      let fs = oc.height * 0.62;
      o.font = `700 ${fs}px "Noto Sans", "Noto Sans SC", sans-serif`;
      const tw = o.measureText("AIPM").width;
      if (tw > oc.width * 0.88) {
        fs = Math.floor(fs * (oc.width * 0.88) / tw);
        o.font = `700 ${fs}px "Noto Sans", "Noto Sans SC", sans-serif`;
      }
      o.filter = `blur(${Math.max(2, fs * 0.028)}px)`; // Safari<18 无 filter:锐边也可接受
      o.fillText("AIPM", oc.width / 2, oc.height / 2 + fs * 0.02);
      if (!glyphTex) glyphTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glyphTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, gl.ALPHA, gl.UNSIGNED_BYTE, oc);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    const initGL = () => {
      const glOpts = {
        alpha: true, premultipliedAlpha: true, antialias: true,
        depth: false, stencil: false, powerPreference: "low-power",
      };
      gl = glCanvas.getContext("webgl", glOpts)
        || glCanvas.getContext("experimental-webgl", glOpts);
      if (!gl) return false;
      gl.getExtension("OES_standard_derivatives");
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn("pm-banner shader:", gl.getShaderInfoLog(sh));
          return null;
        }
        return sh;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) { gl = null; return false; }
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("pm-banner link:", gl.getProgramInfoLog(prog));
        gl = null; return false;
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ["u_res", "u_time", "u_ch[0]", "u_ptr", "u_ps", "u_glyph", "u_glyphc", "u_line", "u_major", "u_grid", "u_fw"]) {
        U[n === "u_ch[0]" ? "u_ch" : n] = gl.getUniformLocation(prog, n);
      }
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(U.u_glyph, 0);
      return true;
    };

    /* 电荷位置(shader 坐标:x∈[0,aspect], y∈[0,1] 向上) */
    const chargeAt = (c, t) => [
      c.cx * aspect + c.rx * aspect * Math.sin(c.w1 * t + c.p1),
      c.cy + c.ry * Math.cos(c.w2 * t + c.p2),
      c.s,
    ];

    const drawGL = (t) => {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.u_res, glCanvas.width, glCanvas.height);
      gl.uniform1f(U.u_time, t * 0.06); // 场演化极慢
      const ch = [];
      for (const c of CHARGES) ch.push(...chargeAt(c, t));
      gl.uniform3fv(U.u_ch, ch);
      gl.uniform2f(U.u_ptr, (ptr.x / W) * aspect, 1 - ptr.y / H);
      gl.uniform1f(U.u_ps, ptr.s * POINTER_S);
      gl.uniform4f(U.u_glyphc, T.glyph.r, T.glyph.g, T.glyph.b, T.glyph.a);
      gl.uniform4f(U.u_line, T.line.r, T.line.g, T.line.b, T.line.a);
      gl.uniform4f(U.u_major, T.major.r, T.major.g, T.major.b, T.major.a);
      gl.uniform4f(U.u_grid, T.grid.r, T.grid.g, T.grid.b, T.grid.a);
      gl.uniform1f(U.u_fw, (LEVELS * 2.2) / glCanvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    /* ================================================================
       2D 覆盖层:只有 micro 标签(+ 无 WebGL 时的静态降级帧)
       ================================================================ */
    const labelAt = (l, t) => [
      l.fx * W + 6 * Math.sin(0.31 * t + l.fx * 9),
      l.fy * H + 5 * Math.cos(0.27 * t + l.fy * 7),
    ];

    const drawLabels = (t) => {
      if (W < 560) return; // 窄屏省掉 micro 标签,字形优先
      ink.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
      ink.textBaseline = "middle";
      ink.textAlign = "left";
      for (const l of LABELS) {
        const [x, y] = labelAt(l, t);
        ink.strokeStyle = css(T.faint, 0.9);
        ink.lineWidth = 1;
        ink.beginPath();
        ink.moveTo(x - 4, y); ink.lineTo(x + 4, y);
        ink.moveTo(x, y - 4); ink.lineTo(x, y + 4);
        ink.stroke();
        ink.fillStyle = css(T.faint);
        ink.fillText(`[ ${l.t} ]`, x + 8, y + 0.5); // ASCII 方括号,终端风
      }
    };

    /* 生物荧光像素流:整数网格方块(原子像素),缓慢右漂 + 微闪烁;
       窄屏减量;RM/离屏时只有静态单帧(相位固定) */
    const drawParticles = (t) => {
      const n = Math.max(6, Math.round((W * H) / 14000) * (W < 560 ? 0.5 : 1));
      for (let i = 0; i < Math.min(n, PS_COUNT); i++) {
        const P = PS[i];
        const x = Math.round(((P.fx + t * P.sp) % 1) * W);
        const y = Math.round((P.fy + Math.sin(t * 0.35 + P.ph) * P.amp) * H);
        const flick = 0.55 + 0.45 * Math.sin(t * 1.4 + P.ph * 3.1);
        ink.fillStyle = css(T.accent, (0.05 + 0.14 * ((i % 5) / 5)) * flick);
        ink.fillRect(x, y, P.s, P.s);
      }
    };

    const drawInk = (t) => {
      ink.clearRect(0, 0, W, H);
      drawLabels(t);
      drawParticles(t);
    };

    /* 无 WebGL 降级:静态网格 + 光斑 + 描边大字 + 标签单帧 */
    const drawFallback = () => {
      ink.clearRect(0, 0, W, H);
      ink.strokeStyle = css(T.grid);
      ink.lineWidth = 1;
      ink.beginPath();
      for (let x = 0.5; x < W; x += W / 28) { ink.moveTo(x, 0); ink.lineTo(x, H); }
      for (let y = 0.5; y < H; y += H / 11) { ink.moveTo(0, y); ink.lineTo(W, y); }
      ink.stroke();
      for (const c of CHARGES) {
        const x = c.cx * W, y = (1 - c.cy) * H, r = Math.min(W, H) * 0.45;
        const g = ink.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css(T.major, 0.5));
        g.addColorStop(1, "rgba(0,0,0,0)");
        ink.fillStyle = g;
        ink.fillRect(0, 0, W, H);
      }
      /* AIPM 描边 + 洗色填充(按宽度收敛,防窄横幅溢出) */
      let fs = Math.round(H * 0.58);
      ink.textAlign = "center";
      ink.textBaseline = "middle";
      ink.font = `700 ${fs}px "Noto Sans", "Noto Sans SC", sans-serif`;
      const tw = ink.measureText("AIPM").width;
      if (tw > W * 0.88) {
        fs = Math.floor(fs * (W * 0.88) / tw);
        ink.font = `700 ${fs}px "Noto Sans", "Noto Sans SC", sans-serif`;
      }
      ink.fillStyle = css(T.glyph);
      ink.fillText("AIPM", W / 2, H / 2);
      ink.strokeStyle = css(T.major, 0.9);
      ink.lineWidth = 1.2;
      ink.strokeText("AIPM", W / 2, H / 2);
      drawLabels(18);
      drawParticles(18);
    };

    /* —— 指针状态(平滑追踪 + 强度缓入出) —— */
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, s: 0, on: false };
    let rect = null;
    const refreshRect = () => { rect = banner.getBoundingClientRect(); };
    const onMove = (e) => {
      if (!rect) refreshRect();
      ptr.tx = e.clientX - rect.left;
      ptr.ty = e.clientY - rect.top;
      if (!ptr.on) { ptr.x = ptr.tx; ptr.y = ptr.ty; } // 入场即吸附,免漂移
      ptr.on = true;
    };
    const onLeave = () => { ptr.on = false; };
    banner.addEventListener("pointermove", onMove);
    banner.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", refreshRect, { passive: true });

    /* —— 渲染状态机:默认常动;离屏/reduced-motion 停转 —— */
    let raf = 0, last = 0, tCur = 18; // 初始相位取一个形态好看的时刻
    let visible = true, motionOK = !RM.matches;
    let disposed = false;

    const step = (t) => {
      /* 指针平滑 */
      ptr.x += (ptr.tx - ptr.x) * 0.12;
      ptr.y += (ptr.ty - ptr.y) * 0.12;
      ptr.s += ((ptr.on ? 1 : 0) - ptr.s) * 0.06;
      if (gl) drawGL(t);
      drawInk(t);
    };

    const loop = (now) => {
      raf = 0;
      if (!motionOK || !visible || !gl) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FPS_MIN) return;
      tCur += (now - last) / 1000;
      last = now;
      step(tCur);
    };

    const start = () => {
      if (raf || !gl || !motionOK) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    const render = () => { // 单帧(reduced-motion / 主题切换 / 初始化)
      if (gl) step(tCur); else drawFallback();
    };

    let ro = null, io = null, moTheme = null;
    const onRMChange = (e) => {
      motionOK = !e.matches;
      if (motionOK) start(); else { stop(); render(); }
    };
    const onContextLost = (e) => {
      e.preventDefault();
      stop();
      gl = null;
      drawFallback();
    };
    const onContextRestored = () => {
      if (initGL()) { size(); start(); }
    };

    ro = new ResizeObserver(() => {
      refreshRect();
      size();
      render();
    });
    ro.observe(banner);
    io = new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible) start(); else stop();
    });
    io.observe(banner);
    RM.addEventListener("change", onRMChange);
    // Material 切换亮/暗主题:<body> 的 data-md-color-scheme 变化
    moTheme = new MutationObserver(() => { readTokens(); render(); });
    moTheme.observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
    glCanvas.addEventListener("webglcontextlost", onContextLost);
    glCanvas.addEventListener("webglcontextrestored", onContextRestored);

    /* 字体就绪后重建字形纹理并重绘(字形度量依赖真实字体);dispose 后不再动作 */
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('700 100px "Noto Sans"'),
        document.fonts.load('600 10px "JetBrains Mono"'),
      ]).then(() => {
        if (disposed) return;
        makeGlyphTexture();
        render();
      }).catch(() => {});
    }

    readTokens();
    refreshRect();
    size();
    if (initGL()) {
      makeGlyphTexture();
      render();
      start();
    } else {
      glCanvas.style.display = "none";
      drawFallback();
    }

    /* 首帧可能早于异步样式表完成:下一帧和 window.load 各重读一次 token,
       让 fallback/首个 WebGL 帧不会把临时空值固化成错误颜色。 */
    const settleTheme = () => {
      if (disposed) return;
      readTokens();
      render();
    };
    requestAnimationFrame(settleTheme);
    window.addEventListener("load", settleTheme, { once: true });

    /* 卸载(instant 导航换 DOM 时由顶层同步器调用):停转、断观察、放 GL */
    const dispose = () => {
      disposed = true;
      stop();
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      if (moTheme) moTheme.disconnect();
      RM.removeEventListener("change", onRMChange);
      banner.removeEventListener("pointermove", onMove);
      banner.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", refreshRect);
      glCanvas.removeEventListener("webglcontextlost", onContextLost);
      glCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("load", settleTheme);
      if (gl) {
        const lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
        gl = null;
      }
      prog = null; U = {}; glyphTex = null;
    };

    return { dispose };
  };

  /* ================================================================
     顶层挂载同步:instant 导航(head 脚本不重跑)靠 body 子树变化侦测
     新的 .pm-banner 出现 → 挂载;消失 → 卸载。rAF 合并抖动。
     ================================================================ */
  let activeEl = null, activeInst = null;
  const sync = () => {
    const el = document.querySelector(".pm-banner");
    if (el && el !== activeEl) {
      if (activeInst) { activeInst.dispose(); activeInst = null; }
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
