/*
  AI-PM 批注存储(annotation-store.js,2026-09-20)

  三态批注的读写与合并视图。三态是**三件事**,不许混:

    public  存自建批注服务,任何访客不登录也能读;创建需 GitHub 登录;
            只有作者本人能改/删(版主可删公开)。
    private 同样存服务端,但按账号隔离:只有作者本人登录后看得到,
            **换设备登录同一账号能看到**(这正是它与「仅本机」的本质区别)。
    local   匿名也能建、也能改,只存 localStorage,**绝不上传**;
            换设备、清缓存即丢。登录后可「上传为公开 / 私有」。

  所以本文件里有**两套完全独立的读写路径**:服务端那几个走 fetch,本机那套走
  localStorage,中间没有隐式桥。唯一能跨过去的是显式动作 uploadLocal(),
  它把一条本机批注 POST 出去并在本地记下 server id 映射 —— 避免同一段话
  在本地与云端各显示一份。

  存储分片与配额:
  - 本机批注按页面分片(localStorage 单键 aipm-anno-local),键内再按 page 分组;
  - 写入失败(配额满)不静默吞:抛 QuotaError,由面板明确告诉用户去导出/清理。
    数据量到阈值前就提示(阈值见 LOCAL_WARN_BYTES),而不是写崩了才说。
  - 提供 exportJson / importJson,给用户在换设备前自救。

  server id 映射:上传成功后记 localId → serverId;之后本机那条标记为
  uploadedAt,面板把它显示成「已上传」而不是重复一条。
*/
(function () {
  "use strict";

  var ANNO_API_BASE =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:8788"
      : "https://anno-api.nvc.ac";

  /* 色板:≥5 色,每色有亮/暗两套值(定义在 annotation.css 的 --aipm-anno-* 变量上)。
     label 是短标签(面板图例与建议条展示),when 是该颜色的使用语义 ——
     后者会作为 Jev 的 choice 选项描述发出去,所以写得像给模型看的判据。 */
  var PALETTE = [
    { id: "yellow", label: "重点", when: "值得记住的重点内容", key: "1" },
    { id: "green", label: "定义", when: "定义与术语的界定", key: "2" },
    { id: "blue", label: "结论", when: "关键结论与判断", key: "3" },
    { id: "pink", label: "数据", when: "数据、指标与事实", key: "4" },
    { id: "purple", label: "警示", when: "坑、风险与注意事项", key: "5" }
  ];
  var DEFAULT_COLOR = "yellow";

  var K_LOCAL = "aipm-anno-local";
  var K_MAP = "aipm-anno-map";
  var K_DRAFT = "aipm-anno-draft";
  var K_LAST_COLOR = "aipm-anno-last-color";
  var K_PREFS = "aipm-anno-prefs";
  var K_SMART = "aipm-anno-smart";

  /* 批注的画法(与颜色正交):只划线 / 只高亮 / 两者都要。
     放在 store 是因为 prefs() 要校验它 —— 面板文件里那份是渲染用的标签与图标。 */
  var ANNO_STYLES = ["underline", "highlight", "both"];
  var DEFAULT_STYLE = "highlight";
  var COMMENT_SORTS = ["hot", "newest"];
  var LOCAL_WARN_BYTES = 3 * 1024 * 1024; // 约 4–5MB 配额下的提前预警线

  function QuotaError(message) {
    this.name = "QuotaError";
    this.message = message;
  }
  QuotaError.prototype = Object.create(Error.prototype);

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      /* 解析失败(半截写入 / 手工改坏)时退回默认值,不因为一个坏键让面板整个挂掉 */
      return fallback;
    }
  }

  function writeJson(key, value) {
    var text = JSON.stringify(value);
    try {
      localStorage.setItem(key, text);
    } catch (e) {
      throw new QuotaError(
        "浏览器本地存储已满,这条「仅本机」批注没能保存。请打开面板导出 JSON 备份后清理旧批注。"
      );
    }
    return text.length;
  }

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "l-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* ---- 服务端接口 ---- */

  function request(path, opts) {
    opts = opts || {};
    var headers = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    return fetch(ANNO_API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch (e) {
            body = null;
          }
          return { ok: res.ok, status: res.status, body: body, headers: res.headers };
        });
      })
      .catch(function () {
        /* 网络不可达:当作服务不可用,而不是把错误抛给调用方去猜 */
        return { ok: false, status: 0, body: { error: "network" }, headers: null };
      });
  }

  /* ---- 本机(仅本机)---- */

  function loadLocalAll() {
    var data = readJson(K_LOCAL, null);
    if (!data || typeof data !== "object" || typeof data.pages !== "object") {
      return { version: 1, pages: {} };
    }
    return data;
  }

  function localList(page) {
    var all = loadLocalAll();
    var list = all.pages[page];
    return Array.isArray(list) ? list.slice() : [];
  }

  function saveLocalPage(page, list) {
    var all = loadLocalAll();
    if (list.length === 0) delete all.pages[page];
    else all.pages[page] = list;
    return writeJson(K_LOCAL, all);
  }

  function localBytes() {
    try {
      return (localStorage.getItem(K_LOCAL) || "").length;
    } catch (e) {
      return 0;
    }
  }

  function localAdd(anno) {
    var list = localList(anno.page);
    list.push(anno);
    saveLocalPage(anno.page, list);
    return anno;
  }

  function localUpdate(page, id, patch) {
    var list = localList(page);
    var found = null;
    var next = list.map(function (a) {
      if (a.id !== id) return a;
      found = Object.assign({}, a, patch, { updatedAt: new Date().toISOString() });
      return found;
    });
    if (found === null) return null;
    saveLocalPage(page, next);
    return found;
  }

  function localRemove(page, id) {
    var list = localList(page);
    var next = list.filter(function (a) {
      return a.id !== id;
    });
    if (next.length === list.length) return false;
    saveLocalPage(page, next);
    forgetServerId(id);
    return true;
  }

  /* ---- localId → serverId 映射 ---- */

  function loadMap() {
    var m = readJson(K_MAP, {});
    return m && typeof m === "object" ? m : {};
  }

  function rememberServerId(localId, serverId) {
    var m = loadMap();
    m[localId] = serverId;
    writeJson(K_MAP, m);
  }

  function serverIdOf(localId) {
    return loadMap()[localId] || null;
  }

  function forgetServerId(localId) {
    var m = loadMap();
    if (m[localId] === undefined) return;
    delete m[localId];
    writeJson(K_MAP, m);
  }

  /* ---- 草稿:必须扛过 OAuth 整轮往返 ----
     未登录用户选「公开」→ 引导登录 → 回跳后要把刚才那段话发出去。
     草稿存 localStorage(不是内存),因为回跳是一次完整的页面加载。 */

  function saveDraft(draft) {
    try {
      writeJson(K_DRAFT, Object.assign({}, draft, { savedAt: new Date().toISOString() }));
    } catch (e) {
      /* 草稿存不下也不能拦着用户去登录,记个标记由面板提示 */
    }
  }

  function peekDraft() {
    return readJson(K_DRAFT, null);
  }

  function clearDraft() {
    try {
      localStorage.removeItem(K_DRAFT);
    } catch (e) {
      /* 静默 */
    }
  }

  /* ---- 偏好:上次用的颜色 / 面板开关 ---- */

  function lastColor() {
    var c = null;
    try {
      c = localStorage.getItem(K_LAST_COLOR);
    } catch (e) {
      c = null;
    }
    return PALETTE.some(function (p) {
      return p.id === c;
    })
      ? c
      : DEFAULT_COLOR;
  }

  function setLastColor(id) {
    try {
      localStorage.setItem(K_LAST_COLOR, id);
    } catch (e) {
      /* 静默 */
    }
  }

  function prefs() {
    var p = readJson(K_PREFS, {});
    return {
      showLocal: p.showLocal !== false,
      showPrivate: p.showPrivate !== false,
      showPublic: p.showPublic !== false,
      /* 评论面板里那三只眼睛另存一份:评论不锚正文,它的显隐与正文里的高亮是两件
         事,共用一份键会让「这栏评论先不看了」顺手抹掉文章里的划线。
         批注那份(上面三条)同时管着列表与正文高亮,见 syncGroupVisibility。 */
      showCommentsLocal: p.showCommentsLocal !== false,
      showCommentsPrivate: p.showCommentsPrivate !== false,
      showCommentsPublic: p.showCommentsPublic !== false,
      /* 折叠态与「整栏不显示」是两件事:折叠只收起条目、分组标题还留在那儿,
         眼睛则连标题一起收走。默认都是展开(false)。 */
      collapsedLocal: p.collapsedLocal === true,
      collapsedPrivate: p.collapsedPrivate === true,
      collapsedPublic: p.collapsedPublic === true,
      /* 评论排序。批注按正文位置排(那是唯一的合理顺序),只有评论需要挑:
         热度 = 点赞数 + 回复数。 */
      commentSort: COMMENT_SORTS.indexOf(p.commentSort) >= 0 ? p.commentSort : "hot",
      /* 上次用的画法,下次开悬浮窗时预选上 */
      lastStyle: ANNO_STYLES.indexOf(p.lastStyle) >= 0 ? p.lastStyle : DEFAULT_STYLE
    };
  }

  function setPrefs(patch) {
    writeJson(K_PREFS, Object.assign(prefs(), patch));
  }

  /* ---- 智能高亮:这一页的自动判分用掉没有 ----

     默认开启之后,「进页面自动判一次」得留痕:不留的话,用户把自动写下的高亮删掉、
     或者点了「全部关闭」,下一次进这一页又会被加回来 —— 他的手动结果被默认设置推翻。
     记的是页面路径 → 用掉的时间。

     与批注分开存:那一页的批注可以被删光,这一笔要留着,不然「删光了」与「从没判过」
     就分不出来。也不跟着导出 / 导入走 —— 它是这台设备上的账,不是批注数据。 */

  function smartState() {
    var s = readJson(K_SMART, null);
    if (!s || typeof s !== "object" || !s.pages || typeof s.pages !== "object") {
      return { version: 1, pages: {} };
    }
    return s;
  }

  function smartDone(page) {
    return Object.prototype.hasOwnProperty.call(smartState().pages, page);
  }

  function markSmartDone(page) {
    var state = smartState();
    state.pages[page] = new Date().toISOString();
    try {
      writeJson(K_SMART, state);
    } catch (e) {
      /* 存储满了也要让这一页照常读下去:这一笔记不上,顶多下次进来再判一遍 */
    }
  }

  /* ---- 导出 / 导入 ---- */

  function exportPayload() {
    return {
      format: "aipm-annotations-local",
      version: 1,
      exportedAt: new Date().toISOString(),
      pages: loadLocalAll().pages
    };
  }

  function importPayload(text) {
    var data = JSON.parse(text);
    if (!data || typeof data.pages !== "object") throw new Error("不是本机批注的导出文件");
    var all = loadLocalAll();
    var added = 0;
    Object.keys(data.pages).forEach(function (page) {
      var incoming = Array.isArray(data.pages[page]) ? data.pages[page] : [];
      var existing = Array.isArray(all.pages[page]) ? all.pages[page] : [];
      var ids = {};
      existing.forEach(function (a) {
        ids[a.id] = true;
      });
      incoming.forEach(function (a) {
        if (!a || typeof a.id !== "string" || ids[a.id]) return;
        existing.push(a);
        added++;
      });
      all.pages[page] = existing;
    });
    writeJson(K_LOCAL, all);
    return added;
  }

  window.__aipmAnnoStore = {
    ANNO_API_BASE: ANNO_API_BASE,
    PALETTE: PALETTE,
    DEFAULT_COLOR: DEFAULT_COLOR,
    QuotaError: QuotaError,
    LOCAL_WARN_BYTES: LOCAL_WARN_BYTES,

    request: request,
    uid: uid,

    localList: localList,
    localAdd: localAdd,
    localUpdate: localUpdate,
    localRemove: localRemove,
    localBytes: localBytes,

    rememberServerId: rememberServerId,
    serverIdOf: serverIdOf,
    forgetServerId: forgetServerId,

    saveDraft: saveDraft,
    peekDraft: peekDraft,
    clearDraft: clearDraft,

    ANNO_STYLES: ANNO_STYLES,
    DEFAULT_STYLE: DEFAULT_STYLE,
    COMMENT_SORTS: COMMENT_SORTS,

    lastColor: lastColor,
    setLastColor: setLastColor,
    prefs: prefs,
    setPrefs: setPrefs,

    smartDone: smartDone,
    markSmartDone: markSmartDone,

    exportPayload: exportPayload,
    importPayload: importPayload
  };
})();
