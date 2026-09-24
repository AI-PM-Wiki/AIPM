"""同源旧 SW 缓存升级后的手写公开批注确认与关键资源故障。

运行时批注服务子模块需检出 484467e640a144eeac1c426707c89a330d4295a8。
"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from urllib.parse import parse_qs, urlsplit
import urllib.request

from playwright.sync_api import sync_playwright

from harness import ROOT, WORK, build_site


OLD_REF = "b53084cdb700f513a4767065251036254f370105"
BASE_REF = "2e44ae006abf906fa455bd94ddfbd5f99dcfe0d8"
SERVICE_REF = "484467e640a144eeac1c426707c89a330d4295a8"
PAGE = "/ai/rag/"


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def translate_path(self, path):
        self.directory = str(self.server.root)
        return super().translate_path(path)

    def do_GET(self):
        if self.server.fail_auth and urlsplit(self.path).path == "/_static/js/annotation-auth.js":
            self.send_error(503, "annotation auth unavailable")
            return
        self.server.requests.append({"path": self.path, "stage": self.server.stage})
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache" if self.path.startswith("/service-worker.js") else "max-age=600")
        super().end_headers()


class OAuthHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path)
        if path.path == "/login/oauth/authorize":
            params = parse_qs(path.query)
            assert params["client_id"] == ["loopback-client"]
            assert params["redirect_uri"] == [self.server.callback]
            callback = params["redirect_uri"][0] + "?code=loopback-code&state=" + params["state"][0]
            self.send_response(302)
            self.send_header("Location", callback)
            self.end_headers()
            return
        assert path.path == "/user" and self.headers["Authorization"] == "Bearer loopback-token"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"id":912345,"login":"loopback-reviewer"}')

    def do_POST(self):
        assert self.path == "/login/oauth/access_token"
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert body["code"] == "loopback-code"
        assert body["client_secret"] == "loopback-secret"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"access_token":"loopback-token"}')


class AnnotationCacheConsent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        service_ref = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT / "annotation-server", text=True).strip()
        assert service_ref == SERVICE_REF, f"annotation service revision: {service_ref}"
        evidence = WORK / "annotation-cache-consent"
        evidence.mkdir(parents=True, exist_ok=True)
        cls.work = Path(tempfile.mkdtemp(prefix="run-", dir=evidence))
        cls.old = build_site(cls.work / "old", ref=OLD_REF)
        cls.baseline = build_site(cls.work / "baseline", ref=BASE_REF)
        cls.candidate = build_site(cls.work / "candidate")
        cls.site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
        cls.site.root = cls.old
        cls.site.stage = "old"
        cls.site.fail_auth = False
        cls.site.requests = []
        cls.site_thread = threading.Thread(target=cls.site.serve_forever)
        cls.site_thread.start()
        cls.oauth = http.server.ThreadingHTTPServer(("127.0.0.1", 0), OAuthHandler)
        cls.oauth_thread = threading.Thread(target=cls.oauth.serve_forever)
        cls.oauth_thread.start()
        cls.base = f"http://127.0.0.1:{cls.site.server_port}"
        with socket.socket() as backend_socket:
            backend_socket.bind(("127.0.0.1", 0))
            cls.backend_port = backend_socket.getsockname()[1]
        cls.backend = f"http://127.0.0.1:{cls.backend_port}"
        cls.oauth.callback = cls.backend + "/api/auth/github/callback"
        upstream = f"http://127.0.0.1:{cls.oauth.server_port}"
        cls.data = cls.work / "data"
        cls.data.mkdir(exist_ok=True)
        env = dict(os.environ, HOST="127.0.0.1", PORT=str(cls.backend_port), DATA_DIR=str(cls.data),
                   SITE_BASE=cls.base, ALLOWED_ORIGINS=cls.base, RETURN_ORIGINS=cls.base,
                   GITHUB_CLIENT_ID="loopback-client", GITHUB_CLIENT_SECRET="loopback-secret",
                   OAUTH_CALLBACK_URL=cls.oauth.callback,
                   GITHUB_AUTHORIZE_URL=upstream + "/login/oauth/authorize",
                   GITHUB_TOKEN_URL=upstream + "/login/oauth/access_token",
                   GITHUB_API_BASE=upstream,
                   SEARCH_INDEX_URL=cls.base + "/search/search_index.json", TMPDIR=str(cls.work))
        cls.service_log = (cls.work / "service.log").open("w")
        cls.service = subprocess.Popen(["node", "dist/server.js"], cwd=ROOT / "annotation-server",
                                       env=env, stdout=cls.service_log, stderr=subprocess.STDOUT)
        for _ in range(100):
            if cls.service.poll() is not None:
                raise AssertionError((cls.work / "service.log").read_text())
            try:
                urllib.request.urlopen(cls.backend + "/healthz", timeout=1).close()
                break
            except OSError:
                time.sleep(.1)
        else:
            raise AssertionError("annotation service unavailable")
        cls.pw = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.pw.stop()
        cls.service.terminate()
        cls.service.wait(timeout=15)
        cls.service_log.close()
        cls.oauth.shutdown()
        cls.oauth.server_close()
        cls.oauth_thread.join()
        cls.site.shutdown()
        cls.site.server_close()
        cls.site_thread.join()

    def snapshot(self, page, entries, stage):
        browser = page.evaluate("""async () => {
            const cache = await caches.open('aipm-static-v2');
            const keys = (await cache.keys()).map(req => req.url);
            const regs = await navigator.serviceWorker.getRegistrations();
            return { controller: navigator.serviceWorker.controller?.scriptURL,
              registrations: regs.map(reg => ({scope: reg.scope, state: reg.active?.state,
                active: reg.active?.scriptURL})),
              cacheKeys: keys.filter(key => key.includes('annotation')),
              scripts: [...document.scripts].map(s => s.src).filter(src => src.includes('annotation')),
              storeVersion: window.__aipmAnnoStore?.assetVersion ?? null,
              authVersion: window.__aipmAnnoAuth?.assetVersion ?? null,
              consent: document.querySelector('.aipm-anno__login-consent')?.innerText ?? null,
              draft: localStorage.getItem('aipm-anno-manual-draft-v1') };
        }""")
        resources = []
        for url in [page.url, *browser["scripts"]]:
            data = bytes(page.evaluate("""async url => Array.from(new Uint8Array(
                await (await fetch(url)).arrayBuffer()))""", url))
            filename = urlsplit(url).path.rsplit("/", 1)[-1] or "index.html"
            (self.work / f"{stage}-{filename}").write_bytes(data)
            observed = [res for res in entries["responses"] if res.url == url]
            resources.append({"url": url, "status": observed[-1].status if observed else None,
                              "sha256": hashlib.sha256(data).hexdigest(),
                              "bytes": len(data),
                              "fromServiceWorker": observed[-1].from_service_worker if observed else None})
        store_path = self.data / "store.json"
        store = json.loads(store_path.read_text()) if store_path.exists() else {"annotations": [], "operations": []}
        result = {"stage": stage, "browser": browser, "resources": resources,
                  "requests": entries["requests"], "responses": entries["statuses"],
                  "siteRequests": list(self.site.requests),
                  "annotationCount": len(store["annotations"]),
                  "operationCount": len(store.get("operations", [])),
                  "annotations": [{"id": row["id"], "requestId": row.get("requestId")}
                                  for row in store["annotations"]]}
        (self.work / f"{stage}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        return result

    def test_old_sw_and_cached_scripts_require_fresh_confirmation(self):
        browser = self.pw.chromium.launch()
        try:
            for label, target, fail_auth in (("baseline", self.baseline, False),
                                             ("failure", self.candidate, True),
                                             ("candidate", self.candidate, False)):
                context = browser.new_context()
                context.route("**/*", lambda route: route.continue_() if
                              urlsplit(route.request.url).hostname == "127.0.0.1" else route.abort())
                context.route("http://127.0.0.1:8788/**", lambda route:
                              route.continue_(url=self.backend + urlsplit(route.request.url).path +
                                              ("?" + urlsplit(route.request.url).query
                                               if urlsplit(route.request.url).query else "")))
                page = context.new_page()
                entries = {"requests": [], "responses": [], "statuses": []}
                page.on("request", lambda req: entries["requests"].append({"method": req.method,
                        "url": req.url, "postData": req.post_data}))
                page.on("response", lambda res: (entries["responses"].append(res),
                        entries["statuses"].append({"url": res.url, "status": res.status})))
                self.site.root = self.old
                self.site.stage = "old"
                self.site.fail_auth = False
                self.site.requests.clear()
                page.goto(self.base + PAGE, wait_until="domcontentloaded")
                page.wait_for_function("() => !!navigator.serviceWorker.controller")
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("""async () => {
                    const cache = await caches.open('aipm-static-v2');
                    return !!(await cache.keys()).find(k => k.url.includes('annotation-auth.js?v=37'));
                }""")
                old = self.snapshot(page, entries, label + "-old")
                self.assertEqual(old["resources"][0]["sha256"], hashlib.sha256(
                    (self.old / "ai" / "rag" / "index.html").read_bytes()).hexdigest())
                self.assertEqual(old["browser"]["registrations"][0]["state"], "activated")
                self.assertTrue(any("annotation-auth.js?v=37" in key
                                    for key in old["browser"]["cacheKeys"]))
                self.site.root = target
                self.site.stage = label
                self.site.fail_auth = fail_auth
                entries["requests"].clear()
                entries["responses"].clear()
                entries["statuses"].clear()
                self.site.requests.clear()
                page.reload(wait_until="domcontentloaded")
                if fail_auth:
                    page.wait_for_function("() => document.readyState === 'complete'")
                    self.assertEqual(page.locator(".aipm-anno__newbtn").count(), 0)
                    failed = self.snapshot(page, entries, "failure-upgrade")
                    self.assertEqual(failed["annotationCount"], old["annotationCount"])
                    self.assertEqual(failed["operationCount"], old["operationCount"])
                    self.assertFalse([r for r in failed["requests"] if r["method"] == "POST" and
                                      r["url"].endswith("/api/annotations")])
                    self.assertEqual(failed["browser"]["authVersion"], None)
                    context.close()
                    continue
                page.get_by_role("button", name="打开批注面板").click()
                if page.locator(".aipm-anno__title").inner_text().strip() == "批注":
                    page.locator(".aipm-anno__title").click()
                page.wait_for_selector(".aipm-anno__newbtn")
                page.locator(".aipm-anno__newbtn").click()
                page.locator(".aipm-anno__input--comment").fill("升级缓存对照：请求体核查样本")
                page.locator(".aipm-anno__visbtn").click()
                page.locator('.aipm-anno__vislist [data-vis="public"]').click()
                page.wait_for_function("() => !!window.__aipmAnnoAuth?.user()")
                if label == "candidate":
                    page.wait_for_selector(".aipm-anno__login-consent")
                current = self.snapshot(page, entries, label + "-unconfirmed")
                self.assertEqual(current["resources"][0]["sha256"], hashlib.sha256(
                    (target / "ai" / "rag" / "index.html").read_bytes()).hexdigest())
                expected_version = "37" if label == "baseline" else "38"
                self.assertTrue(all(f"?v={expected_version}" in src
                                    for src in current["browser"]["scripts"]))
                for resource in current["resources"][1:]:
                    filename = urlsplit(resource["url"]).path.rsplit("/", 1)[-1]
                    source = self.old if label == "baseline" else self.candidate
                    expected = hashlib.sha256((source / "_static" / "js" / filename).read_bytes()).hexdigest()
                    self.assertEqual(resource["sha256"], expected)
                    self.assertTrue(resource["fromServiceWorker"])
                writes = [r for r in current["requests"] if r["method"] == "POST" and
                          r["url"].endswith("/api/annotations")]
                self.assertEqual(len(writes), 1 if label == "baseline" else 0)
                self.assertEqual(current["annotationCount"] - old["annotationCount"], len(writes))
                self.assertEqual(current["operationCount"] - old["operationCount"], len(writes))
                if label == "candidate":
                    self.assertIsNotNone(current["browser"]["consent"])
                    page.get_by_role("button", name="确认以此账号提交").click()
                    page.wait_for_function("""() => !document.querySelector('.aipm-anno__login-consent')""")
                    approved = self.snapshot(page, entries, "candidate-approved")
                    approved_writes = [r for r in approved["requests"] if r["method"] == "POST" and
                                       r["url"].endswith("/api/annotations")]
                    self.assertEqual(len(approved_writes), 1)
                    self.assertEqual(approved["annotationCount"] - old["annotationCount"], 1)
                    self.assertEqual(approved["operationCount"] - old["operationCount"], 1)
                context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    unittest.main()
