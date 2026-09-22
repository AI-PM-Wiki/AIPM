/*
  AI-PM 批注登录(annotation-auth.js,2026-09-20)

  GitHub OAuth 的前端一半。会话是服务端签发的**不透明 bearer token**,存在
  localStorage,请求带 Authorization —— 不用 Cookie,因为站点(aipm.ac)与批注服务
  (anno-api.*)跨源,第三方 Cookie 会被 Safari ITP / Chrome 拦掉。

  三条容易做错、这里刻意做对的事:

  1. **token 不出现在 URL / 历史里**。回跳时 URL 上只有一次性的 `aipm_auth_code`
     (60 秒有效、单次消费),我们用它在 POST /api/auth/session 换到真 token,
     然后立刻 history.replaceState 把参数抹掉。
  2. **草稿要扛过整轮往返**。OAuth 会离开页面,用户刚选中的那段话不能丢:
     发起登录前把草稿写进 localStorage(annotation-store 负责),回来后再取。
  3. **401 静默降级**。会话过期 / 服务重启导致 token 失效时,面板应当安静地
     变回「未登录」而不是弹一个错误 —— 未登录本来就是这个站的正常状态。
*/
(function () {
  "use strict";

  var store = window.__aipmAnnoStore;
  var K_AUTH = "aipm-anno-auth";
  var CODE_PARAM = "aipm_auth_code";

  var session = null; // {token, user}
  var listeners = [];
  var mePromise = null;

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
    try {
      history.replaceState(history.state, "", url.toString());
    } catch (e) {
      /* 某些环境下 replaceState 可能被拒,参数留着不影响功能 */
    }
    return store
      .request("/api/auth/session", { method: "POST", body: { code: code } })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.token) return false;
        writeSession({ token: res.body.token, user: res.body.user });
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
                writeSession({ token: session.token, user: res.body.user });
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
  function login(returnTo) {
    var target = returnTo || location.href;
    location.assign(
      store.ANNO_API_BASE +
        "/api/auth/github/start?return=" +
        encodeURIComponent(target)
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
   * 草稿在 annotation-store 里落盘,回跳后由面板恢复并自动发出去。
   */
  function loginForDraft(draft) {
    if (draft) store.saveDraft(draft);
    login(location.href);
  }

  window.__aipmAnnoAuth = {
    ready: ready,
    token: token,
    user: user,
    isLoggedIn: isLoggedIn,
    onChange: onChange,
    login: login,
    loginForDraft: loginForDraft,
    logout: logout,
    forget: forget,
    CODE_PARAM: CODE_PARAM
  };
})();
