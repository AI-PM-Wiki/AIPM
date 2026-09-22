/*
  页头那颗图标点下去做什么 —— 真代码、真 DOM、真点击(issue #97)。

  test_annotation.py 里那几条读的是源码文本,能锁住「这句话还在不在」,锁不住
  「站长在评论那一份列表里点它,列表会不会换」。这一份把 docs/_static/js 下的
  四个脚本按线上顺序放进 jsdom 跑起来,点真的那颗 <button>,看三件事:

  - 面板里当前是哪一份列表(点前与点后);
  - 发出去的是什么请求(路径、方法、Authorization、请求体里的 refresh、请求体里的
    块集合);
  - 回执条上写的是什么。

  会话按线上那份造:只有 token 与 user,没有 admin 标记 —— 批注服务比站点旧,
  那段窗口里 /api/auth/session 与 /api/auth/me 都不回这个字段。
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  boot,
  click,
  currentList,
  defaultRespond,
  els,
  receipt,
  sessionFor,
  settle,
  suggests,
  switchList
} from "./annotation-harness.mjs";

/** 起一页,等启动那一轮请求跑完(会话校准、列表加载)。 */
async function page({ login = "HuangYincan", admin = null, respond } = {}) {
  const ctx = boot({
    session: sessionFor(login),
    respond: respond || defaultRespond({ login, admin })
  });
  await settle(ctx.w);
  return ctx;
}

// ---- 站长:两颗图标都不许换列表 ----

test("站长在批注列表里点图标:列表不动,发出带鉴权的 refresh 请求", async () => {
  const { w, requests } = await page();
  assert.equal(currentList(w), "批注");
  requests.length = 0;

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "批注", "批注列表里点它不该换列表");
  const sent = suggests(requests);
  assert.equal(sent.length, 1);
  assert.deepEqual(
    { path: sent[0].path, method: sent[0].method, auth: sent[0].headers.Authorization },
    { path: "/api/highlight/suggest", method: "POST", auth: "Bearer tok-test" }
  );
  assert.equal(sent[0].body.refresh, true, "重新生成要真的要求重新判分");
  assert.ok(sent[0].body.blocks.length > 0, "判的是这一页的正文段落");
});

test("站长在评论列表里点图标:仍留在评论里,回执照样看得见", async () => {
  const { w, requests } = await page();
  await switchList(w);
  assert.equal(currentList(w), "评论");
  requests.length = 0;

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "评论", "站长在评论里点它,判完人还在评论里");
  const sent = suggests(requests);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, "/api/highlight/suggest");
  assert.equal(sent[0].body.refresh, true);
  assert.equal(sent[0].headers.Authorization, "Bearer tok-test");
  const bar = receipt(w);
  assert.equal(bar.hidden, false, "回执条长在面板里,两份列表共用它");
  assert.match(bar.text, /智能高亮 · /);
});

test("判分还在飞的时候:列表不动,条子写明正在重新生成", async () => {
  const { w } = await page({
    respond: (req) =>
      req.path === "/api/highlight/suggest"
        ? new Promise(() => {}) // 一直不回:时间冻在请求飞出去的那一刻
        : defaultRespond()(req)
  });
  await switchList(w);
  assert.equal(currentList(w), "评论");

  click(w, els(w).headIcon);
  await settle(w, 2);

  assert.equal(currentList(w), "评论");
  const bar = receipt(w);
  assert.equal(bar.hidden, false);
  assert.match(bar.text, /正在重新生成/);
});

// ---- 服务端那几种回话 ----

test("服务端照旧读缓存(不认 refresh):条子说明它没有重新判分", async () => {
  const { w } = await page({
    respond: defaultRespond({
      suggest: {
        status: 200,
        body: { blocks: [], suggestions: [], judge: "jev-1.13.0", degraded: [], cached: true }
      }
    })
  });
  await switchList(w);

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "评论");
  assert.match(receipt(w).text, /服务端没有重新判分/);
});

test("服务端不放行(403):条子照实说,不把拒绝念成失败", async () => {
  const { w } = await page({
    respond: defaultRespond({ suggest: { status: 403, body: { error: "forbidden" } } })
  });
  await switchList(w);

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "评论");
  const bar = receipt(w);
  assert.equal(bar.hidden, false);
  assert.match(bar.text, /重新生成仅限站长使用/);
});

test("服务端没配判分密钥(503):条子说清是哪里没开", async () => {
  const { w } = await page({
    respond: defaultRespond({
      suggest: {
        status: 503,
        body: { error: "highlight_not_configured" }
      }
    })
  });
  await switchList(w);

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "评论");
  assert.match(receipt(w).text, /智能高亮未启用/);
});

test("请求根本发不出去(断网):条子说网络异常,不说成失败", async () => {
  const { w } = await page({
    respond: (req) =>
      req.path === "/api/highlight/suggest"
        ? Promise.reject(new TypeError("fetch failed"))
        : defaultRespond()(req)
  });
  await switchList(w);

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "评论");
  assert.match(receipt(w).text, /网络异常/);
});

// ---- 其余身份:换列表那一半原样 ----

test("非站长点图标:换一份列表,一个请求都不发", async () => {
  const { w, requests } = await page({ login: "SomeoneElse" });
  requests.length = 0;

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "评论");
  assert.equal(suggests(requests).length, 0);
});

test("未登录点图标:换一份列表,一个请求都不发", async () => {
  const { w, requests } = await page({ login: null });
  requests.length = 0;

  click(w, els(w).headIcon);
  await settle(w);

  assert.equal(currentList(w), "评论");
  assert.equal(suggests(requests).length, 0);
});

// ---- 身份的两条腿 ----

test("服务端比站点旧(不回 admin 字段):站长按登录名照样认得出", async () => {
  const { w } = await page({ admin: null });
  assert.equal(els(w).headIcon.title, "重新生成智能高亮(重新判分并覆盖本页缓存)");
});

test("服务端回了 admin 标记:名单那条腿不参与也认得出", async () => {
  const { w } = await page({ login: "Whoever", admin: true });
  assert.equal(els(w).headIcon.title, "重新生成智能高亮(重新判分并覆盖本页缓存)");
});

// ---- 默认仍是缓存优先 ----

test("✨ 第二次点同一页:读页内那份结果,不再请求一次", async () => {
  const { w, requests } = await page({ login: "SomeoneElse" });
  click(w, els(w).smartBtn);
  await settle(w);
  assert.equal(suggests(requests).length, 1, "第一次要判一次");

  requests.length = 0;
  click(w, els(w).smartBtn);
  await settle(w);

  assert.equal(suggests(requests).length, 0, "同页同一次会话里的结果不该再判一遍");
  assert.equal(receipt(w).hidden, false);
});

test("✨ 在评论列表里点:判完人还在评论里,回执摆在评论那一份上", async () => {
  const { w } = await page({ login: "SomeoneElse" });
  await switchList(w);
  assert.equal(currentList(w), "评论");

  click(w, els(w).smartBtn);
  await settle(w);

  assert.equal(currentList(w), "评论", "看哪一份列表是用户自己选的,判分不该替他改");
  assert.match(receipt(w).text, /智能高亮 · /);
});

/* ================================================================
   重新生成送出去的是这一页**全部**可判定块
   ----------------------------------------------------------------
   服务端那份同页缓存只有页面粒度(annotation-server 的 cacheKey 是
   page + 内容哈希 + judge + 色板,不含这一次送了哪些块),而判分结果会覆盖整页
   那一格。请求只要漏掉几块,漏掉的那几段在缓存里就没有结论 —— 后面进这一页的人
   身上没有任何标记,送来的是整页,命中的却是一份缺段的结果。
   ================================================================ */

/** 只给第一段建议:落完高亮之后,这一页就是「已有标记」的状态。 */
const SUGGEST_FIRST = {
  status: 200,
  body: {
    blocks: [],
    suggestions: [{ id: "b0", color: "yellow", text: "" }],
    judge: "rules",
    model: "auto-model",
    degraded: []
  }
};

/** 两块都给:落完高亮之后,这一页就是「全部标记」的状态。 */
const SUGGEST_BOTH = {
  status: 200,
  body: {
    blocks: [],
    suggestions: [
      { id: "b0", color: "yellow", text: "" },
      { id: "b1", color: "green", text: "" }
    ],
    judge: "rules",
    model: "auto-model",
    degraded: []
  }
};

/** 起一页,并且真的跑进页面的自动判分(装上 `document$`,见 harness 的 instant)。 */
async function autoPage({ login = "HuangYincan", respond, suggest } = {}) {
  const ctx = boot({
    instant: true,
    session: sessionFor(login),
    respond: respond || defaultRespond({ login, suggest })
  });
  await settle(ctx.w);
  return ctx;
}

/** 方块 id 与已落高亮的块数 —— 判据是正文里真实的 `<mark>`,不是脚本内部的记录。 */
const markedBlocks = (w) =>
  Array.from(w.document.querySelectorAll("mark.aipm-anno-mark")).map((m) => m.textContent.slice(0, 4));

test("页面已经有智能高亮:重新生成照样送全部可判定块", async () => {
  const { w, requests } = await autoPage({ suggest: SUGGEST_FIRST });
  assert.equal(markedBlocks(w).length, 1, "自动判分已经落了一块高亮");
  requests.length = 0;

  click(w, els(w).headIcon);
  await settle(w);

  const sent = suggests(requests);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.refresh, true);
  assert.deepEqual(
    sent[0].body.blocks.map((b) => b.id),
    ["b0", "b1"],
    "已高亮的那一块也要送去重判,否则写回缓存的是缺了它的一份"
  );
});

test("这一页每一块都已高亮:重新生成仍发出请求", async () => {
  const { w, requests } = await autoPage({ suggest: SUGGEST_BOTH });
  assert.equal(markedBlocks(w).length, 2, "两块都落过高亮");
  requests.length = 0;

  click(w, els(w).headIcon);
  await settle(w);

  const sent = suggests(requests);
  assert.equal(sent.length, 1, "全部块都已高亮不该让重新生成这个动作整个消失");
  assert.equal(sent[0].body.refresh, true);
  assert.deepEqual(
    sent[0].body.blocks.map((b) => b.id),
    ["b0", "b1"]
  );
});

/* ================================================================
   自动判分还在飞的时候点图标
   ----------------------------------------------------------------
   自动判分要跑几秒,这几秒里页头那颗图标仍然点得动,而手上的请求还没收尾 —— 站长
   点下去原本什么都不会发生(没有请求、也没有回执)。现在这一下排队,等手上那一笔
   收尾再发,并且连点只算一次。
   ================================================================ */

const AUTO_BODY = { judge: "rules", model: "auto-model", suggestions: [], degraded: [] };
const REFRESH_BODY = { judge: "rules", model: "refresh-model", suggestions: [], degraded: [] };

/**
 * 自动判分那一笔冻在「还没回」的状态上,其它请求(会话校准、列表、重新生成)照常。
 * 自动那一笔的回包要等 `release()` 才递回去 —— 那几秒正是用户点图标的窗口。
 */
function heldAuto() {
  let open;
  const held = new Promise((resolve) => {
    open = resolve;
  });
  const respond = (req) => {
    const isSuggest = req.path === "/api/highlight/suggest";
    const refresh = !!(req.body && req.body.refresh);
    if (isSuggest && !refresh) return held;
    if (isSuggest) return { status: 200, body: REFRESH_BODY };
    return defaultRespond()(req);
  };
  return { respond, release: () => open({ status: 200, body: AUTO_BODY }) };
}

test("自动判分还在飞时点图标:排队等它收尾,期间不换列表、有等待回执", async () => {
  const { respond, release } = heldAuto();
  const { w, requests } = await autoPage({ respond });
  assert.equal(suggests(requests).length, 1, "进页面就自动判一次");

  await switchList(w);
  assert.equal(currentList(w), "评论");

  click(w, els(w).headIcon);
  await settle(w, 2);

  assert.equal(currentList(w), "评论", "等的过程里人还留在原来那一份列表里");
  assert.equal(suggests(requests).length, 1, "手上那一笔还没落地,不并发第二笔");
  const waiting = receipt(w);
  assert.equal(waiting.hidden, false, "这一下不能静默:要有回执");
  assert.match(waiting.text, /正在重新生成/);

  release();
  await settle(w);

  const sent = suggests(requests);
  assert.equal(sent.length, 2, "自动那一笔收尾之后,排队那一笔接着发");
  assert.equal(sent[1].body.refresh, true);
  assert.equal(sent[1].headers.Authorization, "Bearer tok-test");
  assert.equal(currentList(w), "评论");
});

test("等的过程里连点三下:合并成一次重新生成", async () => {
  const { respond, release } = heldAuto();
  const { w, requests } = await autoPage({ respond });

  click(w, els(w).headIcon);
  click(w, els(w).headIcon);
  click(w, els(w).headIcon);
  await settle(w, 2);
  assert.equal(suggests(requests).length, 1, "自动那一笔还在飞,三下都没发出去");

  release();
  await settle(w);

  const sent = suggests(requests).filter((r) => r.body.refresh === true);
  assert.equal(sent.length, 1, "三下合并成一次 —— 一次重新生成就是一轮真金白银的调用");
});

test("自动那一份的结果不盖在重新生成那一份上", async () => {
  const { respond, release } = heldAuto();
  const { w, requests } = await autoPage({ respond });

  click(w, els(w).headIcon);
  await settle(w, 2);
  release();
  await settle(w);

  const sent = suggests(requests);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body.refresh, false, "旧那一笔在前");
  assert.equal(sent[1].body.refresh, true, "重新生成要等它收尾之后才发");
  const bar = receipt(w);
  assert.match(bar.text, /refresh-model/, "条子上摆的是重新生成那一份");
  assert.doesNotMatch(bar.text, /auto-model/, "旧那一份的结果不许落在它上面");
});

test("等的过程里翻到别的页:排队那一笔不再发,新页照常自己判一次", async () => {
  const { respond, release } = heldAuto();
  const { w, requests } = await autoPage({ respond });

  click(w, els(w).headIcon);
  await settle(w, 2);
  w.history.pushState({}, "", "/ai/other/");
  release();
  await settle(w);

  const sent = suggests(requests);
  assert.equal(
    sent.filter((r) => r.body.refresh === true).length,
    0,
    "重新生成是冲他点的那一页点的,翻页之后不该替新页花这笔钱"
  );
  const arrived = sent.filter((r) => r.body.page === "/ai/other/");
  assert.equal(arrived.length, 1, "翻过去的那一页走它自己那条自动判分");
  assert.equal(arrived[0].body.refresh, false);
});
