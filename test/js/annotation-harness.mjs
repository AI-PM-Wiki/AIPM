/*
  批注前端的行为测试台:把真正的 docs/_static/js/*.js 放进一个 DOM 里跑。

  为什么要有这一份:test/test_annotation.py 那一套读的是**源码文本**,能锁住
  「这句话还在不在」,锁不住「点下去到底发生了什么」。页头那颗图标的点击去向
  正是这样一条契约 —— 它由身份、当前列表、服务端回包的形状共同决定,只有真的
  把它点一下、看它发了什么请求、列表有没有换,才算验过。

  这一份不替代那套:契约断言不需要 Node,天天跑;这里跑的是真代码,挂在
  check-scripts 那个已经装了 Node 依赖的作业里。

  环境是 jsdom(真 DOM,不是手写的替身),网络边界是这一份里的 fetch 记录器 ——
  它就是被测代码与外部世界之间那道口,记下每一次请求并把预先备好的回包递回去。
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 批注前端的加载顺序,与 hooks/annotation.py 注入的顺序一致。 */
const SCRIPTS = [
  "annotation-store.js",
  "annotation-auth.js",
  "panel-shared.js",
  "annotation.js"
];

function readScript(name) {
  return fs.readFileSync(path.join(ROOT, "docs", "_static", "js", name), "utf8");
}

/** 一页正文。块 id 是文档里的位置序号(b0、b1…),所以这里要有真段落可判。 */
const PAGE = `<!doctype html><html><body>
  <header class="md-header"><div class="md-header__inner"></div></header>
  <article class="md-content__inner">
    <h1>页面标题</h1>
    <p>第一段正文,智能高亮要判的就是这些段落。</p>
    <p>第二段正文,同样属于可判定的范围。</p>
  </article>
</body></html>`;

/**
 * 起一个页面。
 *
 * `respond` 收到记下来的那一条请求({path, method, headers, body}),返回
 * {status, body, headers};返回一个 Promise 就表示「这一刻还没回」—— 判分进行
 * 中那一条靠它把时间冻在请求飞出去的那一刻。
 *
 * `runScripts` 是必须的:被测的就是这四个脚本本身,它们得在真 DOM 里执行。
 */
export function boot({ session, respond } = {}) {
  const dom = new JSDOM(PAGE, {
    url: "https://aipm.ac/ai/pm/",
    runScripts: "dangerously",
    pretendToBeVisual: true
  });
  const w = dom.window;

  /* jsdom 不做布局,这两个是它没有而页面代码初始化时会碰的浏览器接口。 */
  w.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  });
  w.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const requests = [];
  w.fetch = (url, init) => {
    const req = {
      url: String(url),
      path: new URL(String(url)).pathname + new URL(String(url)).search,
      method: (init && init.method) || "GET",
      headers: (init && init.headers) || {},
      body: init && init.body ? JSON.parse(init.body) : null
    };
    requests.push(req);
    return Promise.resolve(respond(req)).then((res) => ({
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: { get: (name) => (res.headers || {})[String(name).toLowerCase()] || null },
      text: () => Promise.resolve(res.body === undefined ? "" : JSON.stringify(res.body))
    }));
  };

  if (session !== null) {
    w.localStorage.setItem("aipm-anno-auth", JSON.stringify(session));
  }
  for (const name of SCRIPTS) {
    const el = w.document.createElement("script");
    el.textContent = readScript(name);
    w.document.body.appendChild(el);
  }
  return { dom, w, requests };
}

/** 让挂在微任务/宏任务上的收尾动作跑完。 */
export async function settle(w, ticks = 4) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => w.setTimeout(r, 0));
  }
}

/** 线上那份会话:只有 token 与 user,没有 admin 标记(批注服务比站点旧)。 */
export function sessionFor(login, extra = {}) {
  return {
    token: "tok-test",
    user: login === null ? null : { githubId: 1, login },
    ...extra
  };
}

/** 服务端那两份回包:会话校准与判分。 */
export function defaultRespond({ login = "HuangYincan", admin = null, suggest } = {}) {
  return (req) => {
    if (req.path === "/api/auth/me") {
      const body = { user: { githubId: 1, login } };
      if (admin !== null) body.admin = admin;
      return { status: 200, body };
    }
    if (req.path === "/api/highlight/suggest") {
      return (
        suggest || {
          status: 200,
          body: { blocks: [], suggestions: [], judge: "jev-1.13.0", degraded: [] }
        }
      );
    }
    if (req.path.startsWith("/api/annotations")) return { status: 200, body: { annotations: [] } };
    return { status: 200, body: {} };
  };
}

export const els = (w) => {
  const doc = w.document;
  return {
    doc,
    title: doc.querySelector(".aipm-anno__title"),
    list: doc.querySelector(".aipm-anno__title-label"),
    headIcon: doc.querySelector(".aipm-anno__head-icon"),
    smartBtn: doc.querySelector(".aipm-anno-smart"),
    smartbar: doc.querySelector(".aipm-anno__smartbar")
  };
};

export function click(w, el) {
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** 当前列表看的是哪一份:「批注」还是「评论」。 */
export function currentList(w) {
  return els(w).list.textContent;
}

/** 换一份列表(与用户点标题那颗胶囊是同一件事)。 */
export async function switchList(w) {
  click(w, els(w).title);
  await settle(w);
}

export function receipt(w) {
  const bar = els(w).smartbar;
  return { hidden: bar.hidden, text: bar.textContent.replace(/\s+/g, " ").trim() };
}

export function suggests(requests) {
  return requests.filter((r) => r.path === "/api/highlight/suggest");
}
