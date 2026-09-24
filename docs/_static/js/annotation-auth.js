/*
  AI-PM 批注登录(annotation-auth.js,2026-09-20)

  GitHub OAuth 的前端一半。会话是服务端签发的**不透明 bearer token**,存在
  localStorage,请求带 Authorization —— 不用 Cookie,因为站点(aipm.ac)与批注服务
  (anno-api.*)跨源,第三方 Cookie 会被 Safari ITP / Chrome 拦掉。

  三条容易做错、这里刻意做对的事:

  1. **token 不出现在 URL / 历史里**。回跳时 URL 上只有一次性的 `aipm_auth_code`
     (60 秒有效、单次消费),我们用它在 POST /api/auth/session 换到真 token,
     然后立刻 history.replaceState 把参数抹掉。
  2. **草稿要扛过整轮往返**。登录事务与草稿绑定,返回后显示待确认请求。
  3. **401 静默降级**。会话过期 / 服务重启导致 token 失效时,面板应当安静地
     变回「未登录」而不是弹一个错误 —— 未登录本来就是这个站的正常状态。
*/
(function () {
  "use strict";

  var store = window.__aipmAnnoStore;
  var K_AUTH = "aipm-anno-auth";
  var K_DRAFT_LOGIN = "aipm-anno-draft-login-v1";
  var CODE_PARAM = "aipm_auth_code";
  var DRAFT_PARAM = "aipm_draft_login";

  var session = null; // {token, user}
  var listeners = [];
  var mePromise = null;
  var completedDraftLogin = null;

  function draftSnapshot(draft) {
    return JSON.stringify({
      requestId: draft.requestId, site: draft.site, page: draft.page,
      body: draft.body, selectors: draft.selectors, quote: draft.quote,
      scope: draft.scope, visibility: draft.visibility, color: draft.color,
      style: draft.style, identity: draft.identity, source: draft.source,
      createdAt: draft.createdAt, sendState: draft.sendState,
      resultUnknown: draft.resultUnknown
    });
  }

  function consumeDraftLogin(url) {
    var nonce = url.searchParams.get(DRAFT_PARAM);
    url.searchParams.delete(DRAFT_PARAM);
    var raw = localStorage.getItem(K_DRAFT_LOGIN);
    localStorage.removeItem(K_DRAFT_LOGIN);
    if (!nonce || !raw) return null;
    var record = JSON.parse(raw);
    if (record.nonce !== nonce || record.site !== location.origin ||
        record.returnTo !== url.toString() || Date.now() >= record.expiresAt ||
        Date.now() < record.createdAt) return null;
    return record;
  }

  function readSession() {
    try {
      var raw = localStorage.getItem(K_AUTH);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.token !== "string" || !parsed.user) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeSession(next) {
    session = next;
    try {
      if (next === null) localStorage.removeItem(K_AUTH);
      else localStorage.setItem(K_AUTH, JSON.stringify(next));
    } catch (e) {
      /* 隐私模式等场景:内存里仍然有效,只是刷新后要重新登录 */
    }
    notify();
  }

  function notify() {
    listeners.forEach(function (cb) {
      try {
        cb(user());
      } catch (e) {
        /* 订阅者的异常不该影响登录流程 */
      }
    });
  }

  function token() {
    return session ? session.token : null;
  }

  function user() {
    return session ? session.user : null;
  }

  function isLoggedIn() {
    return session !== null;
  }

  function sameStoredSession(expectedToken, expectedId) {
    var stored = readSession();
    return !!stored && !!stored.user && stored.token === expectedToken &&
      stored.user.githubId === expectedId && token() === expectedToken &&
      !!user() && user().githubId === expectedId;
  }

  /**
   * 站长标记。服务端在签发会话与 /api/auth/me 里一并回带,前端只用它决定面板页头
   * 那支笔要不要做成「重新生成智能高亮」的开关(见 annotation.js 的 syncHeadIcon)。
   * 真正的闸在服务端 —— 这里返回 true 也只说明按钮摆得出来。
   */
  function isAdmin() {
    return session !== null && session.admin === true;
  }

  function onChange(cb) {
    listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  /** 服务端拒绝了这个 token(过期 / 吊销 / 服务重启):静默回到未登录。 */
  function forget() {
    writeSession(null);
    mePromise = null;
  }

  /**
   * 处理回跳:URL 上带 aipm_auth_code 时换 token。
   * 无论成功失败都要把参数从地址栏与历史里抹掉(replaceState,不新增历史项)。
   */
  function consumeAuthCode() {
    var url = new URL(location.href);
    var code = url.searchParams.get(CODE_PARAM);
    if (!code) return Promise.resolve(false);
    url.searchParams.delete(CODE_PARAM);
    var draftLogin = consumeDraftLogin(url);
    try {
      history.replaceState(history.state, "", url.toString());
    } catch (e) {
      /* 某些环境下 replaceState 可能被拒,参数留着不影响功能 */
    }
    return store
      .request("/api/auth/session", { method: "POST", body: { code: code } })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.token) return false;
        writeSession({ token: res.body.token, user: res.body.user, admin: res.body.admin === true });
        if (draftLogin) completedDraftLogin = {
          record: draftLogin, token: res.body.token,
          githubId: res.body.user && res.body.user.githubId
        };
        /* 换到 token 之后这个 code 已作废;如服务端因异常仍留着,过期也只有 60 秒 */
        return true;
      });
  }

  /**
   * 启动时调用:先处理回跳(若有),再拉一次 /api/auth/me 校准身份
   * (换设备后本地可能残留一个已失效的 token)。
   */
  function ready() {
    session = readSession();
    return consumeAuthCode()
      .then(function () {
        if (session === null) return null;
        if (mePromise === null) {
          mePromise = store
            .request("/api/auth/me", { token: session.token })
            .then(function (res) {
              if (res.status === 401) {
                forget();
                return null;
              }
              if (res.ok && res.body && res.body.user) {
                writeSession({
                  token: session.token,
                  user: res.body.user,
                  admin: res.body.admin === true
                });
                return res.body.user;
              }
              // 网络不可达(0)时保留本地会话,不要因为后端临时挂了就把人踢下线
              return session.user;
            });
        }
        return mePromise;
      })
      .then(function () {
        return user();
      });
  }

  /**
   * 发起登录:先把草稿存好再跳走。`returnTo` 默认回当前页(location.href),
   * 服务端会拿它跟站点来源白名单核对(开放重定向防护)。
   */
  function login(returnTo, forDraft) {
    var url = new URL(returnTo || location.href);
    url.searchParams.delete(CODE_PARAM);
    if (!forDraft) {
      url.searchParams.delete(DRAFT_PARAM);
      localStorage.removeItem(K_DRAFT_LOGIN);
    }
    location.assign(
      store.ANNO_API_BASE +
        "/api/auth/github/start?return=" +
        encodeURIComponent(url.toString())
    );
  }

  function logout() {
    var t = token();
    var done = function () {
      forget();
    };
    if (t === null) {
      done();
      return Promise.resolve();
    }
    return store.request("/api/auth/logout", { method: "POST", token: t }).then(done, done);
  }

  /**
   * 需要登录时的统一入口:带上待发布草稿去登录。
   * 草稿由 annotation-store 保存，回跳后进入独立确认界面。
   */
  function loginForDraft(draft) {
    if (draft && draft.identity === null && draft.sendState === "unsent" &&
        !crypto.randomUUID) throw new Error("secure random required for draft login");
    if (!draft || draft.identity !== null || draft.sendState !== "unsent" ||
        draft.resultUnknown !== false || draft.site !== location.origin) {
      login(location.href);
      return;
    }
    store.saveDraft(draft);
    var saved = store.peekDraft();
    if (draftSnapshot(saved || {}) !== draftSnapshot(draft)) {
      throw new Error("draft login persistence failed");
    }
    var returnTo = new URL(location.href);
    returnTo.searchParams.delete(CODE_PARAM);
    returnTo.searchParams.delete(DRAFT_PARAM);
    var record = {
      nonce: crypto.randomUUID(), site: location.origin,
      returnTo: returnTo.toString(), requestId: draft.requestId,
      page: draft.page, snapshot: draftSnapshot(draft),
      createdAt: Date.now(), expiresAt: Date.now() + 10 * 60000
    };
    localStorage.setItem(K_DRAFT_LOGIN, JSON.stringify(record));
    returnTo.searchParams.set(DRAFT_PARAM, record.nonce);
    login(returnTo.toString(), true);
  }

  window.__aipmAnnoAuth = {
    ready: ready,
    takeDraftLogin: function (draft) {
      var completed = completedDraftLogin;
      completedDraftLogin = null;
      if (!completed || !draft || completed.record.requestId !== draft.requestId ||
          completed.record.page !== draft.page ||
          completed.record.snapshot !== draftSnapshot(draft) ||
          completed.record.site !== location.origin ||
          Date.now() >= completed.record.expiresAt ||
          !sameStoredSession(completed.token, completed.githubId)) return null;
      return { token: completed.token, githubId: completed.githubId,
        expiresAt: completed.record.expiresAt, snapshot: completed.record.snapshot };
    },
    draftSnapshot: draftSnapshot,
    sameStoredSession: sameStoredSession,
    token: token,
    user: user,
    isLoggedIn: isLoggedIn,
    isAdmin: isAdmin,
    onChange: onChange,
    login: login,
    loginForDraft: loginForDraft,
    logout: logout,
    forget: forget,
    CODE_PARAM: CODE_PARAM
  };
})();
