/*
  AI-PM 图表语境(chart-context.js,2026-09-23)

  正文里的 mermaid 图与图片多一颗「问助手」:点它把这张图交给 AI 助手面板,用户
  随后可以对着这张图提问。与划选一段话送进对话是同一条路,只是入口不同 —— 划选
  用悬浮窗,图用图自己的角标。

  三件事分成三层,各自的失败方式不同:

  1. **取源**(readChart):把这张图里能读的东西读出来。mermaid 读它的源码 ——
     模型读源码比看一张栅格化后的图有用得多;SVG 读图里写的那些字;位图把**图像
     本身**取回来(base64),作者写的替代文本一并留着。三条路都可能一无所获,那时
     写的是一句说明:第几张、什么图、为什么没有内容。**例句本身也是内容**,语境
     因此仍然立得住 —— 模型知道用户在指哪一张,可以反问;换成「取不到就不造条目」,
     按钮点下去什么都没发生,而用户并不知道是为什么。
  2. **规范化**:交给 context-item.js 的 forChart,由它管形状、去重与「仅本机不出
     本机」那道边界。这个文件不自己拼条目,也就不可能绕开那道边界。
  3. **交接**:交给助手面板的 attachContext。失败(语境条满了、面板没挂上)由
     这个文件自己报信 —— 面板那边不弹窗,它只管摆放与发送。

  ── mermaid 的源码为什么要在渲染后回头读 ──

  因为**渲染之后它就不在页面上了**。主题的做法是 `el.replaceWith(host)`:把
  `<pre class="mermaid"><code>源码</code></pre>` 换成一个空的 `<div class="mermaid">`,
  SVG 塞进它的 closed shadow root(从外面 `host.shadowRoot` 读出来是 null,连
  textContent 都是空的)。源码在替换的那一刻还完整地留在被换下来的那个游离节点
  上,所以这里挂 MutationObserver 收替换记录:一条记录里既有被换下的 pre(源码
  还在),也有换上去的宿主,两者在各自名单里的先后一致,按位配对即得。
  实测(2026-09,主题 91f401a,首屏加载与 instant 换页两种情形)都是一条记录同时
  带 added 与 removed。

  ── 不可信的 SVG ──

  图是作者写的,和其它正文一样不可信。SVG 的取源走 fetch 拿文本,再交给 DOMParser
  解析成一份**惰性文档**读字:那份文档没有浏览上下文,里面的 <script> 不执行、
  事件属性不触发、外链不加载;读出来的字符串也只以文本形式进语境(经 textContent
  摆上语境条),解析出来的节点从不插入本文档。这个文件里唯一一处 innerHTML 写的
  是自己定义的那颗图标常量,任何来自页面的字符串都不经过它。

  ── 位图:图像本身 ──

  位图取的是**图像本身**,不只是作者写的替代文本 —— 图里的文字与结构只有像素里
  才有。取一张图的字节要过三道,任何一道不过就退回只带文字说明的那条路:

  - **来源**:只取同源的地址。跨域的图 fetch 被 CORS 挡下,也超出「读者正在看的
    这一页」。**重定向一概不跟**(`redirect: "manual"`):地址换了个地方之后取到的
    就不是这一页的东西了,而重定向的去向在读之前是看不见的 —— 同源地址照样可以
    302 到一台放行 CORS 的跨域服务器上,跟过去就把跨域的字节读了进来;
  - **类型**:认的只有 PNG / JPEG / WebP / GIF,按**字节开头**判定 —— 服务器说的
    content-type 由服务器给,和正文一样不可信,只用来在读字节之前挡掉明显不是图
    的东西;
  - **体积**:超过 CTX.IMAGE_MAX_BYTES 的不取。这一道管的是**读的过程**:从头读,
    一超限就地取消这条响应(reader.cancel()),剩下的字节既不进内存也不继续传。
    读完了再判的话,一份几百 MB 的响应会先整个落进浏览器内存,再由我们自己丢掉它。

  读到一半断掉(响应头到手、正文没写完)与「取不到这张图」是同一个结果:退回替代
  文本那条路,按钮回到能按的状态 —— 半份字节认不出类型,SVG 那支还会读出一句被
  截断的话。

  体积这一道要成立,取源那次请求就不能被站点的 Service Worker 接过去:它对同源
  图片是 cache-first,命中时交出来的不是这一页此刻的字节,未命中时回填用的 clone
  更会在页面取消之后照旧把整份读完 —— 一条响应两个消费者,上限只管得住一半。取源
  因此带一个只属于它自己的标记头,SW 认这一对头才放行(见 docs/service-worker.js 与
  sourceRequest),别的请求照旧走原来的缓存策略。

  SVG 走的是同一个读取上限、同样在读取过程中停 —— 上限说的是「一次取源最多读多少
  字节」,与这张图是位图还是矢量图无关。
*/
(function () {
  "use strict";

  var CTX = window.__aipmContext || null;
  var READY_ATTR = "data-aipm-chart-ready";
  /* 取源那条请求的标记头:告诉站点的 Service Worker「这一条由页面按字节读,别接管」。
     名字与取值与 docs/service-worker.js 里那一对是同一对 —— 那边只认这一对,别的
     请求照旧走原来的缓存策略(见 sourceRequest)。 */
  var SOURCE_FETCH_HEADER = "X-AIPM-Source-Fetch";
  var SOURCE_FETCH_VALUE = "chart-context";
  /* 与批注面板悬浮窗上那颗「问助手」同一张脸(四角星,与助手面板的 FAB 同源):
     两处指的是同一件事,图形就该是同一个。 */
  var ASK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19,9l1.25,-2.75L23,5l-2.75,-1.25L19,1l-1.25,2.75L15,5l2.75,1.25L19,9z M11.5,9.5L9,4L6.5,9.5L1,12l5.5,2.5L9,20l2.5,-5.5L17,12L11.5,9.5z M19,15l-1.25,2.75L15,19l2.75,1.25L19,23l1.25,-2.75L23,19l-2.75,-1.25L19,15z"/></svg>';

  /* 没有共享的语境模块就整条不做:这颗按钮存在的意义就是把图交给它,少一个成员
     等于在正文里摆一颗点了没反应的按钮。 */
  if (CTX === null) return;
  /* 预览站(Netlify)不挂载:助手面板在那里本来就不挂(见 chat-widget.js 与
     annotation.js 的同一条判断),挂上去只是多一颗够不着的按钮。 */
  if (/\.netlify\.app$/i.test(location.hostname)) return;

  /* ================================================================
     页面
     ================================================================ */

  /** 正文容器。页面上的图不止正文里有(页眉的站标、页脚的图标),那些谈不上
      「用户正在读的一张图」。 */
  function contentRoot() {
    return (
      document.querySelector(".md-content__inner") ||
      document.querySelector("article") ||
      document.body
    );
  }

  function pagePath() {
    return CTX.normalizePage(location.pathname);
  }

  /* 页面标题:与批注面板的 pageTitle() 同一条规则 —— 主页的页首 h1 是字标
     (整块 SVG,没有文字节点),取不到文字就回落到 document.title,否则会把空
     标题丢给模型。 */
  function pageTitle() {
    var h = document.querySelector(".md-content h1") || document.querySelector("h1");
    var text = (h && h.textContent ? h.textContent : "").trim();
    return text || (document.title || "").trim();
  }

  /** 正文里的图,按文档顺序。渲染中的 mermaid(还是 pre)不算 —— 它马上会变成
     宿主,那时再挂。`div` 限定把 `<pre class="mermaid">` 排除在外。 */
  function chartElements() {
    return Array.prototype.slice.call(contentRoot().querySelectorAll("div.mermaid, img"));
  }

  /** 第几张图(从 1 数起,与用户数下来的一致)。取不到内容时那句说明靠它指向
     具体的图。 */
  function ordinalOf(el) {
    return chartElements().indexOf(el) + 1;
  }

  /* ================================================================
     mermaid 源码登记表
     ================================================================ */

  var mermaidSource = new WeakMap();

  /** 这个 mermaid 块还带着源码吗。主题给渲染前后两种形态挂了同一个类:渲染前是
      `<pre class="mermaid"><code>源码</code></pre>`,渲染后是一个空的
      `<div class="mermaid">`。 */
  function holdsSource(node) {
    return node.tagName === "PRE" || !!node.querySelector("code");
  }

  function mermaidNodes(nodes, wantSource) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType !== 1 || !node.classList || !node.classList.contains("mermaid")) continue;
      if (holdsSource(node) === wantSource) out.push(node);
    }
    return out;
  }

  /**
   * 收下这一批变动里的 mermaid 源码。
   *
   * 只在**一条记录内部**配对,不跨记录攒队列:一条记录就是一个替换动作本身,跨
   * 记录配对得先回答「哪几条算一批」,而那个答案随渲染时序变。配不上源码的图落到
   * 取源的兜底那一步(见 readChart),写一句说明。
   */
  function absorbMermaidSources(records) {
    for (var r = 0; r < records.length; r++) {
      var gone = mermaidNodes(records[r].removedNodes, true);
      if (gone.length === 0) continue;
      var fresh = mermaidNodes(records[r].addedNodes, false);
      for (var i = 0; i < gone.length && i < fresh.length; i++) {
        var text = (gone[i].textContent || "").trim();
        if (text !== "") mermaidSource.set(fresh[i], text);
      }
    }
  }

  /* ================================================================
     取源
     ================================================================ */

  function chartName(chart) {
    return CTX.CHART_LABEL[chart] || "图";
  }

  /**
   * 什么都没有取到时写进 source 的那句说明。它是这条语境唯一的可读内容,所以
   * 要说清三件事:哪一张、什么图、为什么没内容。
   */
  function missingText(chart, ordinal, why) {
    var head = ordinal > 0 ? "页面上的第 " + ordinal + " 张图" : "页面上的一张图";
    return head + "(" + chartName(chart) + ", " + why + ")。";
  }

  /** 作者写的替代文本。位图与 SVG 都可能有。 */
  function altTextOf(img) {
    return (img.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
  }

  /** 同源的地址才取:跨域的图 fetch 会被 CORS 挡下,也超出「读者正在看的这一页」。
      返回 null 表示这张图不取字节。 */
  function sameOriginUrl(src) {
    if (!src) return null;
    var url = new URL(src);
    return url.origin === location.origin ? url : null;
  }

  /**
   * 取源的请求怎么发。
   *
   * `redirect: "manual"` 是不跟重定向:重定向是「地址换了个地方」,而重定向的去向
   * 在读之前看不见 —— 同源地址照样可以 302 到一台放行 CORS 的跨域服务器上,跟过去
   * 读到的就不是这一页的东西了。manual 之下重定向拿到的是一个不透明响应(状态 0、
   * 没有正文),`res.ok` 为假,自然落回替代文本那条路:跨源重定向因此**根本不会
   * 发生**,而不是发生之后再拦。
   *
   * 标记头(SOURCE_FETCH_HEADER)是这条请求自己的名字:站点的 Service Worker 对同源
   * 图片是 cache-first,由它接管的话,拿到的可能是缓存里那一份(读到的就不是这一页
   * 此刻的字节),回填用的 clone 更会在页面取消之后照旧把整份读完。带上这一对头的
   * 请求,SW 才放行(见 docs/service-worker.js),这条响应于是只有一个消费者,读多少
   * 只由 readCapped 决定。放行认的是这个标记,不看别的请求怎么声明。
   *
   * `cache: "no-store"` 管的是没有 SW 接手时的浏览器那份 HTTP 缓存:取源要的是此刻
   * 的字节,不是存下来的那一份。SW 放行之后这条请求回到浏览器的默认处理,这一句
   * 仍然生效。
   */
  function sourceRequest(url) {
    var init = {
      credentials: "same-origin",
      redirect: "manual",
      cache: "no-store",
      headers: {}
    };
    init.headers[SOURCE_FETCH_HEADER] = SOURCE_FETCH_VALUE;
    return fetch(url.href, init);
  }

  /**
   * 读一个响应体,最多读 max 字节。
   *
   * 一超限就 `reader.cancel()`:这条响应就地断掉,剩下的字节既不进内存也不再传。
   * 读完再判体积的话,超限的那份会先整个落进内存,再由我们自己丢掉它 —— 上限就
   * 形同虚设。返回 null 表示超限、没有正文,或者正文读到一半断了。
   *
   * 读到一半断掉(响应头已经拿到、`reader.read()` 拒绝)与「取不到这张图」在这条
   * 路上是同一个结果:读到的那些字节不作数 —— 半份字节认不出类型,SVG 那支还会读
   * 出一句被截断的话。
   */
  function readCapped(res, max) {
    if (!res.body) return Promise.resolve(null);
    var reader = res.body.getReader();
    var chunks = [];
    var total = 0;
    function step() {
      return reader.read().then(
        function (part) {
          if (part.done) {
            var bytes = new Uint8Array(total);
            var at = 0;
            for (var i = 0; i < chunks.length; i++) {
              bytes.set(chunks[i], at);
              at += chunks[i].length;
            }
            return bytes;
          }
          total += part.value.byteLength;
          if (total > max) {
            /* 取消本身的结果无关紧要(这条响应已经不要了),但它可能带着上游的读
               错误一起拒绝 —— 别把一个未处理的拒绝留在页面上。 */
            reader.cancel().catch(function () {});
            return null;
          }
          chunks.push(part.value);
          return step();
        },
        function () {
          return null;
        }
      );
    }
    return step();
  }

  function sameOriginSvgUrl(img) {
    var url = sameOriginUrl(img.src);
    return url !== null && url.pathname.toLowerCase().endsWith(".svg") ? url : null;
  }

  /** 服务器说的类型只当个前置筛子:不是图像就不必把字节读进来。真正定种类的是
      字节本身(见 sniffImageType)。 */
  function looksLikeRaster(res) {
    var type = (res.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
    return type === "" || CTX.RASTER_TYPES.indexOf(type) >= 0;
  }

  /**
   * 字节开头认出这是什么图。认的是内容,不是服务器说的那个头 —— 头由服务器给,
   * 和正文一样不可信。认不出返回 null,由调用方回落到替代文本。
   *
   * 四种的签名:PNG 的 89 50 4E 47、JPEG 的 FF D8 FF、GIF 的 "GIF8"、
   * WebP 的 "RIFF" + 四字节长度 + "WEBP"。
   */
  function sniffImageType(bytes) {
    if (bytes.length < 12) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return "image/webp";
    }
    return null;
  }

  /* btoa 收的是字符,一次 apply 五十万个码元会把调用栈撑爆 —— 分块拼。 */
  var B64_CHUNK = 0x8000;

  function base64Of(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += B64_CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK)));
    }
    return btoa(parts.join(""));
  }

  function isSvgResponse(res) {
    var type = (res.headers.get("content-type") || "").toLowerCase();
    return type === "" || type.indexOf("svg") >= 0;
  }

  /**
   * SVG 里的字:title / desc / text 三处,按文档顺序去重后连起来。
   *
   * DOMParser 给出的是一份**惰性文档** —— 没有浏览上下文,<script> 不执行、事件
   * 属性不触发、外链不加载。这里只读它写出来的字符串,而字符串只以文本形式进
   * 语境;解析出来的节点从不插入本文档。读不出东西(不是 SVG、只有图形没有字)
   * 时返回空串,由调用方回落到替代文本或那句说明。
   */
  function svgLabels(markup) {
    var doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    if (!doc || doc.querySelector("parsererror")) return "";
    var nodes = doc.querySelectorAll("title, desc, text");
    var parts = [];
    var total = 0;
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (text === "" || parts.indexOf(text) >= 0) continue;
      parts.push(text);
      total += text.length;
      /* 超长的图不必整个读完:forChart 那一步也会截,这里早点停省下一次拼接。 */
      if (total >= CTX.LIMITS.source) break;
    }
    return parts.join(" / ");
  }

  /**
   * 读一张位图:把**图像本身**取回来(base64),作者写的替代文本一并留着。
   *
   * 三道限制都在这里,任何一道不过就退回只带文字说明的那条路(与这条通路原本的
   * 行为一致):
   *   - **来源**:只取同源的地址,重定向一概不跟(见 sourceRequest);
   *   - **类型**:content-type 先挡一道,字节开头再认一道;
   *   - **体积**:读的过程中就不超过 CTX.IMAGE_MAX_BYTES(见 readCapped)。
   *
   * key 用图片地址:同一张图送两次只有一条语境,页面上两张不同的图各是一条。
   */
  function readRaster(img) {
    var ordinal = ordinalOf(img);
    var text = altTextOf(img) || missingText("image", ordinal, "作者没有写替代文本");
    var url = sameOriginUrl(img.src);
    if (url === null) return Promise.resolve({ chart: "image", source: text, key: img.src });
    /* 取的是同一张已经显示在页面上的图的地址,同源。失败不是异常,是这条路本来
       就有的一种结果(图换了地方、服务器不给这个类型、字节认不出来、超过上限),
       退回替代文本即可 —— fetch 的第二个回调接住它,不额外包一层。 */
    return sourceRequest(url)
      .then(
        function (res) {
          return res.ok && looksLikeRaster(res) ? readCapped(res, CTX.IMAGE_MAX_BYTES) : null;
        },
        function () {
          return null;
        }
      )
      .then(function (bytes) {
        if (bytes === null || bytes.length === 0) return null;
        var mediaType = sniffImageType(bytes);
        if (mediaType === null) return null;
        return {
          chart: "image",
          source: text,
          key: img.src,
          mediaType: mediaType,
          imageData: base64Of(bytes)
        };
      })
      .then(function (got) {
        return got === null ? { chart: "image", source: text, key: img.src } : got;
      });
  }

  /**
   * 读一张图,返回 {chart, source, key},位图另带 mediaType 与 imageData。
   * source 一定非空 —— 取不到写说明。
   */
  function readImage(img) {
    var svg = sameOriginSvgUrl(img);
    if (svg === null) return readRaster(img);
    /* 取的是同一张已经显示在页面上的图的地址,同源。失败不是异常,是这条路本来
       就有的一种结果(图换了地方、服务器不给这个类型),退回替代文本即可 ——
       fetch 的第二个回调接住它,不额外包一层。读取与位图同一个上限:一份 SVG
       再大也不该整个落进内存。 */
    return sourceRequest(svg)
      .then(
        function (res) {
          return res.ok && isSvgResponse(res) ? readCapped(res, CTX.IMAGE_MAX_BYTES) : null;
        },
        function () {
          return null;
        }
      )
      .then(function (bytes) {
        var labels = bytes === null || bytes.length === 0 ? "" : svgLabels(new TextDecoder().decode(bytes));
        return {
          chart: "svg",
          source: labels || altTextOf(img) || missingText("svg", ordinalOf(img), "图里的文字没有取到"),
          key: img.src
        };
      });
  }

  /**
   * 读一张图,返回 {chart, source, key},位图另带 mediaType 与 imageData。
   * source 一定非空 —— 取不到写说明。
   *
   * mermaid 的 key 是它的源码:同一页上同一张图(连点两次、或者两张一模一样的
   * 图各点一次)只有一条语境。源码没收上来时退回按位置认,那也认得出「还是这张」。
   */
  function readChart(el) {
    if (el.tagName === "IMG") return readImage(el);
    var source = mermaidSource.get(el);
    if (source) return Promise.resolve({ chart: "mermaid", source: source, key: source });
    var ordinal = ordinalOf(el);
    return Promise.resolve({
      chart: "mermaid",
      source: missingText("mermaid", ordinal, "源码没有取到"),
      key: "by-position:" + ordinal
    });
  }

  /* ================================================================
     交接:交给助手面板
     ================================================================ */

  var toast = document.createElement("div");
  toast.className = "aipm-chart__toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.hidden = true;
  document.body.appendChild(toast);
  var toastTimer = 0;

  function flash(text) {
    if (!text) return;
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
      toastTimer = 0;
    }, 3200);
  }

  /**
   * 把读到的这张图交给助手面板。形状、去重与那道边界都在 context-item.js 与面板
   * 里,这里只管报信:语境条满了、面板没挂上,按钮点下去都不该毫无动静 ——
   * 「点了没反应」与「坏了」在用户那里是同一件事。
   */
  function handOff(found) {
    var chat = window.__aipmChat;
    if (!chat || typeof chat.attachContext !== "function") {
      flash("问答助手未加载,这张图送不进对话。");
      return;
    }
    var item = CTX.forChart({
      page: pagePath(),
      title: pageTitle(),
      chart: found.chart,
      source: found.source,
      key: found.key,
      mediaType: found.mediaType,
      imageData: found.imageData
    });
    var res = chat.attachContext(item);
    if (res && res.ok) return;
    flash(
      res && res.code === "context_full"
        ? "对话里最多放 " + CTX.MAX_ITEMS + " 条语境,先去对话框上方去掉一条。"
        : "这张图送不进对话。"
    );
  }

  /* ================================================================
     入口:正文里的每张图挂一颗「问助手」
     ================================================================ */

  function askButton(el) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "aipm-chart__ask";
    btn.title = "问助手:把这张图送进对话";
    btn.setAttribute("aria-label", "问助手:把这张图送进对话");
    btn.innerHTML = ASK_ICON;
    btn.addEventListener("click", function (event) {
      /* 图常常本身就是个链接(点开大图、外链原图),按钮于是落在那个链接里面 ——
         不拦下这一下,点「问助手」会顺带把页面带走。 */
      event.preventDefault();
      event.stopPropagation();
      ask(el, btn);
    });
    return btn;
  }

  /**
   * 取源要发请求(SVG 那一支),期间按钮按不动 —— 没有这一下,连点两次会排两条
   * 一样的语境(去重会把它们并成一条,但两次请求都发出去了)。
   */
  function ask(el, btn) {
    btn.disabled = true;
    btn.classList.add("is-busy");
    readChart(el).then(function (found) {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      handOff(found);
    });
  }

  /**
   * 给一张图挂上容器与按钮。
   *
   * 容器是 `position: relative` 的那一层,按钮绝对定位到它的左下角 —— 与
   * mermaid-zoom 的放大按钮(右下角)分开两个角,两个都只在悬停这张图时出现,
   * 挤在一起会互相盖住。正文里的图常常整张就在一个 `<p>` 里,容器因此落进 `<p>`
   * 内(与 `.mermaid-zoom__figure` 同一个位置);浏览器不重新解析 DOM 插入的节点,
   * 不影响任何东西。
   */
  function enhance(el) {
    if (el.hasAttribute(READY_ATTR)) return;
    var parent = el.parentNode;
    if (!parent) return;
    var box = document.createElement("div");
    box.className = "aipm-chart";
    parent.insertBefore(box, el);
    box.appendChild(el);
    box.appendChild(askButton(el));
    el.setAttribute(READY_ATTR, "");
  }

  function scan() {
    chartElements().forEach(enhance);
  }

  var scanFrame = 0;

  function scheduleScan() {
    if (scanFrame) return;
    scanFrame = requestAnimationFrame(function () {
      scanFrame = 0;
      scan();
    });
  }

  /* 一个观察者兼两件事:收 mermaid 的源码(渲染是替换,记录里有源码),以及给新
     出现的图挂按钮。两件事各读各的字段,不会互相影响;按钮挂上之后取源才发生,
     所以源码与宿主谁先到都不影响最后读到的东西。 */
  new MutationObserver(function (records) {
    absorbMermaidSources(records);
    scheduleScan();
  }).observe(document.body, { childList: true, subtree: true });

  /* 换页后正文整个换掉,按钮跟着旧内容一起走,新页的图重新挂。批注面板的条子与
     mermaid-zoom 的扫描都用这条机制。 */
  if (typeof document$ !== "undefined" && document$ && document$.subscribe) {
    document$.subscribe(scheduleScan);
  }

  scan();
})();
