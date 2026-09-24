// 在本地 MkDocs 和启用 DEV_AUTH_BYPASS 的批注服务上运行:
// ego-browser nodejs < test/browser/annotation-like-login.mjs
const assert = (await import("node:assert/strict")).default;
const options = globalThis.annoTestOptions || {};
const task = await taskSpace(options.spaceId || "AIPM-17 点赞登录验证");
const page = task.page("p1");
const site = "http://127.0.0.1:8122";
const api = "http://127.0.0.1:8788";
const upstream = options.api || api;
const returnTo = site + "/?like-login=1#login-test";

if (upstream !== api) {
  await page.cdp("Fetch.enable", { patterns: [{ urlPattern: api + "/api/*" }] });
}
await page.cdp("Network.enable");
const pending = new Set();
let lastRequest = 0;
let loginStarted = false;

async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    for (const event of await page.events()) {
      if (
        event.method === "Network.responseReceived" &&
        event.params.response.url.startsWith(api + "/api/auth/github/start?")
      ) {
        loginStarted = true;
      }
      if (event.method === "Network.requestWillBeSent" && event.params.request.url.startsWith(api)) {
        pending.add(event.params.requestId);
        lastRequest = Date.now();
      }
      if (event.method === "Network.loadingFinished" || event.method === "Network.loadingFailed") {
        pending.delete(event.params.requestId);
      }
      if (upstream !== api && event.method === "Fetch.requestPaused") {
        await page.cdp("Fetch.continueRequest", {
          requestId: event.params.requestId,
          url: event.params.request.url.replace(api, upstream)
        });
      }
    }
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("等待界面状态超时");
}

const hasSelector = (value) => () => page.evaluate((s) => Boolean(document.querySelector(s)), value);
const atLogin = () => loginStarted;
const clickLike = () => page.evaluate((s) => document.querySelector(s).click(), selector);
const idle = () => pending.size === 0 && Date.now() - lastRequest > 300;

async function request(path, method = "GET", token, body) {
  const response = await fetch(upstream + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  assert.ok(response.ok, method + " " + path + ": " + response.status);
  return response.status === 204 ? null : response.json();
}

const owner = await request("/api/auth/dev", "POST");
const { annotation } = await request("/api/annotations", "POST", owner.token, {
  page: "/",
  body: "点赞登录回归测试",
  color: "yellow",
  visibility: "public",
  target: { scope: "page", selectors: [] }
});
const selector = `[data-anno-id="${annotation.id}"] [data-action="like"]`;

async function open(session) {
  await page.goto(site + "/_static/js/annotation-auth.js");
  await page.evaluate((value) => {
    if (value) localStorage.setItem("aipm-anno-auth", JSON.stringify(value));
    else localStorage.removeItem("aipm-anno-auth");
  }, session);
  await page.goto(returnTo);
  await page.click(".aipm-anno-entry");
  await page.click(".aipm-anno__title-label");
  await waitFor(hasSelector(selector));
  await waitFor(idle);
}

async function expectLogin(label) {
  loginStarted = false;
  await clickLike();
  await waitFor(atLogin);
  await page.waitForURL(api + "/api/auth/github/start?*");
  const url = new URL((await page.info()).url);
  assert.equal(url.searchParams.get("return"), returnTo);
  await page.goto(returnTo);
  await waitFor(idle);
  assert.equal(await page.evaluate(() => localStorage.getItem("aipm-anno-auth")), null);
  const result = await request("/api/annotations/" + annotation.id, "GET", owner.token);
  assert.equal(result.annotation.likeCount, 0);
  console.log("PASS " + label);
}

try {
  const session = await request("/api/auth/dev", "POST");
  await open(session);
  await clickLike();
  await waitFor(hasSelector(selector + "[aria-pressed=true]"));
  assert.equal(await page.evaluate((s) => document.querySelector(s).textContent, selector), "1");
  await clickLike();
  await waitFor(hasSelector(selector + "[aria-pressed=false]"));
  assert.equal(await page.evaluate((s) => document.querySelector(s).textContent, selector), "0");
  assert.equal((await page.info()).url, returnTo);
  console.log("PASS 登录后点赞与取消点赞");

  await request("/api/auth/logout", "POST", session.token);
  await expectLogin("会话吊销后第一次点赞跳转登录");

  await open(null);
  await expectLogin("未登录点赞跳转登录");

  const unlikeSession = await request("/api/auth/dev", "POST");
  await open(unlikeSession);
  await clickLike();
  await waitFor(hasSelector(selector + "[aria-pressed=true]"));
  await request("/api/auth/logout", "POST", unlikeSession.token);
  loginStarted = false;
  await clickLike();
  await waitFor(atLogin);
  await page.waitForURL(api + "/api/auth/github/start?*");
  assert.equal(new URL((await page.info()).url).searchParams.get("return"), returnTo);
  const liked = await request("/api/annotations/" + annotation.id, "GET", owner.token);
  assert.equal(liked.annotation.likeCount, 1);
  console.log("PASS 会话吊销后取消点赞跳转登录并保持计数");
} finally {
  if (upstream !== api) await page.cdp("Fetch.disable");
  await request("/api/annotations/" + annotation.id, "DELETE", owner.token);
  await request("/api/auth/logout", "POST", owner.token);
}
await task.finish({ keep: [] });
