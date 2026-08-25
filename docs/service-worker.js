/*
  AI-PM 静态站点 Service Worker —— 最小缓存策略(2026-08-25)

  主题 base.html 注册本文件(scope "/"),此前为空 fetch 监听,PWA 名存实亡。
  现按资源易变性分两类缓存:

  - 静态资源(_static/、assets/、根层 favicon/manifest、带 ?v= 版本参数的
    JS/CSS 等)→ cache-first:命中缓存直接返回,未命中走网络并回填。
  - 易变内容(页面文档 HTML、search/search_index.json、sitemap.xml 等)→
    network-first:先走网络保证内容新鲜(network-first 防陈旧),网络失败时
    兜底用缓存(防离线白屏),成功后回填缓存。

  保守原则:
  - 只拦截同源 GET;非 GET / 跨源(如 Google Fonts、widget API)一律放行,
    交给浏览器默认处理,不缓存。
  - 仅缓存 HTTP ok(2xx,排除 206 部分内容)响应;失败响应不落缓存。
  - 响应体 clone 后入缓存,不影响原响应流。
  - 淘汰:简单 FIFO 上限(每个缓存 ≤ 100 项,超限删最旧)。轻量站点,
    不做 install 预缓存全站,按需缓存即可。
*/
"use strict";

const CACHE_STATIC = "aipm-static-v1";
const CACHE_DYNAMIC = "aipm-dynamic-v1";
const CACHE_MAX = 100; // 每个缓存的条目上限(FIFO 淘汰)

/* 静态资源:站内构建产物目录 / 版本化参数(?v=N)/ 常见静态扩展名 / 根层站点文件 */
const STATIC_EXT_RE =
  /\.(?:css|js|mjs|woff2?|ttf|otf|eot|svgz?|png|jpe?g|gif|webp|avif|ico)(?:$|[?#])/i;
const STATIC_PATH_RE = [
  /^\/_static\//,
  /^\/assets\//,
  /^\/(?:manifest\.webmanifest|favicon(?:_\d+x\d+)?\.[a-z0-9]+|robots\.txt)$/i,
];

/* 易变内容:搜索索引与站点地图随内容重建,页面文档单独按 navigate 判定 */
const DYNAMIC_RE = /^\/search\//;
const siteMapRe = /^\/sitemap\.xml(?:\.gz)?$/;

const kindOf = (url) => {
  if (DYNAMIC_RE.test(url.pathname) || siteMapRe.test(url.pathname)) return "dynamic";
  if (STATIC_EXT_RE.test(url.href) || /\?v=\d+/.test(url.search)) return "static";
  for (const re of STATIC_PATH_RE) if (re.test(url.pathname)) return "static";
  return null; // 其余(含未知路径)不拦截,交给浏览器默认处理
};

/* 入缓存 + FIFO 淘汰(Cache API 的 keys() 在 Chrome/Firefox 按插入序返回,
   删最旧即删头部);配额满等异常静默降级为不缓存 */
const putCache = async (cache, req, res) => {
  try {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    while (keys.length > CACHE_MAX) {
      await cache.delete(keys[0]);
      keys.shift();
    }
  } catch (e) {
    /* 缓存写入失败不影响本次响应 */
  }
};

const cacheFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.status !== 206) putCache(cache, req, res);
  return res;
};

const networkFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.status !== 206) putCache(cache, req, res);
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 只缓存 GET(其他方法直接放行)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 只处理同源
  const kind = kindOf(url);
  if (!kind) return;
  const pageDoc = req.mode === "navigate" || req.destination === "document";
  event.respondWith(
    kind === "dynamic" || pageDoc
      ? networkFirst(req, CACHE_DYNAMIC)
      : cacheFirst(req, CACHE_STATIC)
  );
});
