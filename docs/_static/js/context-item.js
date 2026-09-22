/*
  AI-PM 语境条目(context-item.js,2026-09-22)

  批注面板与 AI 助手面板之间的那个「正在读的东西」—— 正文里划选的一段话、卡片上的
  一条批注、正文里的一张图 —— 在这里被规范化成一条**语境条目**:由面板或图表入口
  产出,由助手面板消费、随提问发往问答后端。产生方与消费方因此不必互相认识,
  只认识这个文件。

  条目带一个**稳定 id**:同一条批注、同一段选区、同一张图无论送进来几次都只有一条
  语境,重复点击只在原位刷新(见 upsert)。参照 poco-ai/Agentero#614 —— 那里按 id
  追加,同一条来源连点两次就排出一串重复条目,而删其中一条又会把同 id 的其余条目
  一起删掉。

  图表的**取源**(把 mermaid 源码 / SVG 里的文字 / 位图的替代文本读出来)要碰 DOM
  与网络,在 chart-context.js;这里只负责把取到的文字规范化成条目 —— 与另外两种
  一样,它是一个纯函数,不碰 DOM、不读时钟。

  三态里的「仅本机」**不进语境**:它的承诺是「只在那台设备上」,而语境会随提问
  发到问答后端、再进入模型上下文。判断只有 isDeliverable 一份,条目每进一个容器
  都过它一遍 —— 构造(forSelection / forAnnotation / forChart)、进语境条(upsert)、
  从 localStorage 回来(sanitize)、出网(toPayload)。**出网那道是最后一道**:即便
  别的入口漏了,带 local 的条目也序列化不进请求体。服务端另有一道独立的闸
  (server.ts 里 visibility 的枚举没有 local,并按 kind 校验必填字段),两边各自成立。

  纯函数,不碰 DOM、不读时钟 —— 可以脱离页面直接断言。
*/
(function () {
  "use strict";

  /* 与服务端 context.ts 的 CONTEXT_LIMITS 取同一组数字:两边对「多长算超限」的
     判断必须一致,否则客户端放行、服务端拒收,用户看到的是「发出去没反应」。
     chart 的取值是三个枚举值,长度由服务端的 z.enum 管,不占这里的额度。 */
  var MAX_ITEMS = 4;
  var LIMITS = { page: 512, title: 200, quote: 4000, body: 4000, source: 4000, edge: 200, color: 32 };
  var EXCERPT_MAX = 96;

  var VISIBILITY_LABEL = { public: "公开", private: "仅自己可见" };

  /* 图表种类。与服务端 ContextItemSchema 的 chart 枚举同一组取值。 */
  var CHART_KINDS = ["mermaid", "svg", "image"];
  var CHART_LABEL = { mermaid: "Mermaid 图", svg: "SVG 图", image: "图片" };

  function clip(text, max) {
    var s = typeof text === "string" ? text : "";
    return s.length > max ? s.slice(0, max) : s;
  }

  function trim(text, max) {
    return clip(typeof text === "string" ? text.trim() : "", max);
  }

  /** 站内路径归一:前导斜杠 + 尾斜杠,与批注面板的 pagePath() 同一形态。 */
  function normalizePage(path) {
    var p = typeof path === "string" ? path.trim() : "";
    if (p === "") return "";
    if (p.charAt(0) !== "/") p = "/" + p;
    if (p.charAt(p.length - 1) !== "/") p += "/";
    return clip(p, LIMITS.page);
  }

  function textQuoteOf(selectors) {
    if (!selectors || !selectors.length) return null;
    for (var i = 0; i < selectors.length; i++) {
      if (selectors[i] && selectors[i].type === "TextQuoteSelector") return selectors[i];
    }
    return null;
  }

  function positionOf(selectors) {
    if (!selectors || !selectors.length) return null;
    for (var i = 0; i < selectors.length; i++) {
      var s = selectors[i];
      if (s && s.type === "TextPositionSelector" && typeof s.start === "number") return s;
    }
    return null;
  }

  /** 同一条批注 → 同一个 id;同一段选区(同起点) → 同一个 id。 */
  function annotationId(id, page, quote) {
    var key = typeof id === "string" && id.length > 0 ? id : page + "#" + quote.slice(0, 64);
    return "anno:" + key;
  }

  function selectionId(page, selectors, quote) {
    var pos = positionOf(selectors);
    var key = pos ? pos.start + "-" + pos.end : quote.slice(0, 64);
    return "sel:" + page + "#" + key;
  }

  /**
   * FNV-1a 32 位,进位写成移位相加。图表的来源标识可能是一整段 mermaid 源码,
   * 直接当 id 会把 localStorage 里的会话撑大,所以压成一个短且确定的串。
   * 用的是 UTF-16 码元,同一段文字在任何浏览器上得到同一个值。
   */
  function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h.toString(36);
  }

  /**
   * 同一张图 → 同一个 id。
   *
   * key 是这张图在页面上的来源标识:mermaid 用它的源码,SVG / 位图用图片地址。
   * 同一页上把同一张图送两次(连点、或者两张一模一样的图各点一次)只有一条语境。
   * 哈希撞车只会把两张图并成一条,不会把 A 的文字当成 B 的 —— upsert 刷新的是
   * 后送进来的那一份内容。
   */
  function chartId(page, chart, key) {
    return "chart:" + page + "#" + chart + ":" + hash(key);
  }

  function labelOf(item) {
    if (item.kind === "selection") return "选中文字";
    if (item.kind === "chart") return "图表 · " + (CHART_LABEL[item.chart] || "图");
    return "批注 · " + (VISIBILITY_LABEL[item.visibility] || VISIBILITY_LABEL.public);
  }

  function excerptOf(item) {
    var text = item.quote.length > 0 ? item.quote : item.body;
    if (text.length === 0) text = typeof item.source === "string" ? item.source : "";
    var flat = text.replace(/\s+/g, " ").trim();
    return flat.length > EXCERPT_MAX ? flat.slice(0, EXCERPT_MAX) + "…" : flat;
  }

  /**
   * 这条语境能不能离开浏览器。
   *
   * 形状齐、kind 认识、可见范围是那两档可以出网的取值 —— 「仅本机」卡在最后一条
   * 上。图表另有一条:取到的文字不能是空的,一条没东西可读的图表语境摆进对话框
   * 只会让模型以为用户指向了某张它看不见的图,而它连图是什么都不知道。
   *
   * 判断只写这一份,条目每进一个容器都过它:构造、进语境条、从 localStorage
   * 回来、出网。于是「这里要不要判一次 local」不必在每个入口各想一遍,加一处入口
   * 也不必再判一次。
   */
  function isDeliverable(item) {
    if (!item || typeof item !== "object") return false;
    if (typeof item.id !== "string" || item.id === "") return false;
    if (item.kind !== "selection" && item.kind !== "annotation" && item.kind !== "chart") return false;
    if (typeof item.page !== "string" || item.page === "") return false;
    if (item.visibility !== "public" && item.visibility !== "private") return false;
    if (item.kind === "chart") {
      if (CHART_KINDS.indexOf(item.chart) < 0) return false;
      if (typeof item.source !== "string" || item.source === "") return false;
    }
    return true;
  }

  /**
   * 正文里划选的一段话。quote 为空说明选区已经没了,返回 null 让调用方别送空语境。
   */
  function forSelection(input) {
    var page = normalizePage(input.page);
    var quote = trim(input.quote, LIMITS.quote);
    if (page === "" || quote === "") return null;
    var selectors = input.selectors || [];
    var tq = textQuoteOf(selectors);
    return {
      id: selectionId(page, selectors, quote),
      kind: "selection",
      page: page,
      title: trim(input.title, LIMITS.title),
      quote: quote,
      prefix: tq ? trim(tq.prefix, LIMITS.edge) : "",
      suffix: tq ? trim(tq.suffix, LIMITS.edge) : "",
      body: "",
      color: "",
      visibility: "public"
    };
  }

  /**
   * 批注面板里的一条批注。
   *
   * **visibility 为 local 时返回 null**:批注面板在构造这一步就交不出「仅本机」的
   * 语境,用不着等出网那道闸。调用方不需要、也不应该自己再判一次 —— 判断在
   * isDeliverable 里只有一份。
   */
  function forAnnotation(input) {
    var visibility = input.visibility;
    if (visibility !== "public" && visibility !== "private") return null;
    var page = normalizePage(input.page);
    if (page === "") return null;
    var quote = trim(input.quote, LIMITS.quote);
    var body = trim(input.body, LIMITS.body);
    if (quote === "" && body === "") return null;
    return {
      id: annotationId(input.id, page, quote),
      kind: "annotation",
      page: page,
      title: trim(input.title, LIMITS.title),
      quote: quote,
      prefix: "",
      suffix: "",
      body: body,
      color: trim(input.color, LIMITS.color),
      visibility: visibility
    };
  }

  /**
   * 正文里的一张图。
   *
   * source 是**已经从图上取出来的文字**,不是图的地址:mermaid 是它的源码,
   * SVG 是图里写的那些字,位图是作者写的替代文本。取源那一步(含取不到时的回落)
   * 在 chart-context.js —— 它要读 DOM、要发一次同源请求,做不到纯函数。
   *
   * key 是这张图的来源标识,只用来算 id。两者都由调用方给:这里不认识 DOM,
   * 也就无从判断某张图「应该」是哪一张。
   *
   * source 为空时不造条目 —— 那时模型看到的只有「用户在读某页上的一张图」,
   * 既不知道是哪张,也没有任何可读的内容。降级要做在取源那一步(写一句说明),
   * 而不是在这里放一条空语境过去。
   */
  function forChart(input) {
    var page = normalizePage(input.page);
    if (page === "") return null;
    var chart = input.chart;
    if (CHART_KINDS.indexOf(chart) < 0) return null;
    var source = trim(input.source, LIMITS.source);
    if (source === "") return null;
    var key = typeof input.key === "string" ? input.key : "";
    if (key === "") return null;
    return {
      id: chartId(page, chart, key),
      kind: "chart",
      page: page,
      title: trim(input.title, LIMITS.title),
      quote: "",
      prefix: "",
      suffix: "",
      body: "",
      color: "",
      chart: chart,
      source: source,
      visibility: "public"
    };
  }

  /**
   * 放进语境条。
   *
   * 同 id 的条目**在原位刷新**(位置不动,内容取新的):连着对同一条批注点两次
   * 「问助手」,语境条里仍然只有一条。位置不动是有意的 —— 点第二次的人期待的是
   * 「把这条更新一下」,把它挪到队尾等于让整条语境条重排。
   *
   * 过不了 isDeliverable 的条目在这里就进不来,语境条因此不会摆出一条发不出去的
   * 东西 —— 恢复出来或被别的调用方塞进来的「仅本机」条目,在这一步被挡下。
   */
  function upsert(list, item) {
    if (!isDeliverable(item)) return { ok: false, code: "invalid_context", items: list };
    var items = list.slice();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === item.id) {
        items[i] = item;
        return { ok: true, added: false, items: items };
      }
    }
    if (items.length >= MAX_ITEMS) return { ok: false, code: "context_full", items: list };
    items.push(item);
    return { ok: true, added: true, items: items };
  }

  function remove(list, id) {
    return list.filter(function (item) {
      return item.id !== id;
    });
  }

  /**
   * localStorage 里的语境可能来自旧版本、被手工改坏,或者是从别处恢复出来的
   * 「仅本机」条目:只收过得了 isDeliverable 的,其余丢掉 —— 坏条目别让整轮提问
   * 卡在取字段上,「仅本机」的那条则根本不该回到语境条里。图表那条形状规则
   * (种类认识、取到的文字非空)也在这里生效,恢复出来的一并过一遍。
   */
  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(isDeliverable);
  }

  /**
   * 出网的形态:内部字段(id / 展示用的派生量)不进请求体。
   *
   * 这是条目离开浏览器前的最后一道:过不了 isDeliverable 的一条都不发。语境条与
   * 请求体因此不会出现分歧 —— 看不到的东西也发不出去。
   */
  function toPayload(list) {
    return list.filter(isDeliverable).map(function (item) {
      return {
        kind: item.kind,
        page: item.page,
        title: item.title,
        quote: item.quote,
        prefix: item.prefix,
        suffix: item.suffix,
        body: item.body,
        color: item.color,
        chart: item.kind === "chart" ? item.chart : "",
        source: item.kind === "chart" ? item.source : "",
        visibility: item.visibility
      };
    });
  }

  window.__aipmContext = {
    MAX_ITEMS: MAX_ITEMS,
    LIMITS: LIMITS,
    CHART_KINDS: CHART_KINDS,
    CHART_LABEL: CHART_LABEL,
    normalizePage: normalizePage,
    labelOf: labelOf,
    excerptOf: excerptOf,
    forSelection: forSelection,
    forAnnotation: forAnnotation,
    forChart: forChart,
    isDeliverable: isDeliverable,
    sanitize: sanitize,
    upsert: upsert,
    remove: remove,
    toPayload: toPayload
  };
})();
