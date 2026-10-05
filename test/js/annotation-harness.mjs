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
 *
 * `instant` 装上 mkdocs-material 的 `document$`(instant loading 那个「每进一个
 * 页面发一次」的 observable)。站点头部的并入逻辑订阅它,进页面时的自动判分
 * (见 autoSmart)就挂在这一条上;jsdom 里没有这个全局,不装的话那条路根本不跑。
 * 它按 mkdocs-material 的接口行为:订阅时先发当前这一份,之后每次换页再发。
 *
 * `storage` 是脚本跑起来**之前**写进 localStorage 的键值 —— 上一轮留在这台设备上
 * 的状态(「仅本机」批注、用掉的自动判分……)。键名与原样的一份数据都由调用方给,
 * 测试不自己拼批注对象:位置选择器是 app 自己算出来的东西。
 */
export function boot({ session, respond, instant = false, storage = null } = {}) {
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

  if (instant) {
    w.document$ = {
      subscribe(fn) {
        fn();
      }
    };
  }

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

  if (storage) {
    for (const key of Object.keys(storage)) {
      if (storage[key] !== null) w.localStorage.setItem(key, storage[key]);
    }
  }
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
    smartbar: doc.querySelector(".aipm-anno__smartbar"),
    smartToggle: doc.querySelector(".aipm-anno__smart-toggle")
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

/** 页面路径:app 的 pagePath 就是 location.pathname(这里起的是这一页)。 */
export const PAGE_PATH = "/ai/pm/";

/** 存在本机的那两笔账:批注,与「这一页的自动判分已经用过了」。 */
export const LOCAL_KEY = "aipm-anno-local";
export const SMART_KEY = "aipm-anno-smart";

/** 「本机批注」那一格在存储里的形状(与 app 自己写的那份一致)。 */
function localState(list) {
  return JSON.stringify({ version: 1, pages: { [PAGE_PATH]: list } });
}

/**
 * 抄一份这台设备上留下的状态,交给下一个页面的 `boot({ storage })` —— 造出
 * 「换一次会话回到同一页」:正文上还留着上一轮的高亮,而页内那份会话缓存
 * (suggestCache)随着页面一起没了。
 *
 * `drop` 里的键不抄(整份抄过去就是原样回到同一页;去掉 SMART_KEY 才是「这一页
 * 的自动判分还没用过」);`local` 给定时换掉本机批注那一格。
 */
export function savedState(w, { drop = [], local = null } = {}) {
  const out = {};
  for (const key of [LOCAL_KEY, SMART_KEY]) {
    if (drop.includes(key)) continue;
    out[key] = w.localStorage.getItem(key);
  }
  if (local) out[LOCAL_KEY] = localState(local);
  return out;
}

/** 本机保存的批注列表(app 存在 localStorage 里的那一份,多出一条在这里看得见)。 */
export function localAnnos(w) {
  const raw = w.localStorage.getItem(LOCAL_KEY);
  const all = raw ? JSON.parse(raw) : null;
  const list = all && all.pages ? all.pages[PAGE_PATH] : null;
  return Array.isArray(list) ? list : [];
}
