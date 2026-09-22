/*
  页头那颗图标点下去做什么 —— 真代码、真 DOM、真点击(issue #97)。

  test_annotation.py 里那几条读的是源码文本,能锁住「这句话还在不在」,锁不住
  「站长在评论那一份列表里点它,列表会不会换」。这一份把 docs/_static/js 下的
  四个脚本按线上顺序放进 jsdom 跑起来,点真的那颗 <button>,看两件事:

  - 面板里当前是哪一份列表(点前与点后);
  - 发出去的是什么请求(路径、方法、Authorization、请求体里的 refresh)。

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
