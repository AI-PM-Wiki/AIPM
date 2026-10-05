"""同源旧 SW 缓存升级后的手写公开批注确认与关键资源故障。

运行时批注服务子模块需检出 fd3bc1fc94995c5eed06fec5ffc68b8dacb47c46。
"""
import base64
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
SERVICE_REF = subprocess.check_output(["git", "rev-parse", "HEAD:annotation-server"], cwd=ROOT, text=True).strip()
LEGACY_ANNO_ORIGIN = "http://127.0.0.1:" + os.environ.get("AIPM_TEST_LEGACY_ANNOTATION_PORT", "8788")
PAGE = "/ai/rag/"


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def translate_path(self, path):
        self.directory = str(self.server.root)
        return super().translate_path(path)

    def do_GET(self):
        fault = self.server.faults.get(urlsplit(self.path).path, False)
        if fault is not False:
            self.server.requests.append({"path": self.path, "stage": self.server.stage})
            if fault is None:
                self.send_error(503, "annotation asset unavailable")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(fault)))
            self.end_headers()
            self.wfile.write(fault)
            return
        if self.server.fail_auth and urlsplit(self.path).path == "/_static/js/annotation-auth.js":
            self.send_error(503, "annotation auth unavailable")
            return
        self.server.requests.append({"path": self.path, "stage": self.server.stage})
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache" if self.path.startswith("/service-worker.js") else "max-age=600")
        super().end_headers()


class AnnotationCacheConsent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        required = ("AIPM_REAL_GITHUB_CLIENT_ID", "AIPM_REAL_GITHUB_CLIENT_SECRET", "AIPM_REAL_GITHUB_ID")
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise RuntimeError("authorized GitHub OAuth configuration missing: " + ", ".join(missing))
        cls.github_id = os.environ["AIPM_REAL_GITHUB_ID"]
        service_ref = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT / "annotation-server", text=True).strip()
        assert service_ref == SERVICE_REF, f"annotation service revision: {service_ref}"
        evidence = WORK / "annotation-cache-consent"
        evidence.mkdir(parents=True, exist_ok=True)
        cls.work = Path(tempfile.mkdtemp(prefix="run-", dir=evidence))
        cls.old = build_site(cls.work / "old", ref=OLD_REF)
        cls.baseline = build_site(cls.work / "baseline", ref=BASE_REF)
        cls.frozen = build_site(cls.work / "frozen", ref="d537f1e74d04685528bcacc06f07541c3ea220f4")
        cls.candidate = build_site(cls.work / "candidate")
        cls.site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
        cls.site.root = cls.old
        cls.site.stage = "old"
        cls.site.faults = {}
        cls.site.fail_auth = False
        cls.site.requests = []
        cls.site_thread = threading.Thread(target=cls.site.serve_forever)
        cls.site_thread.start()
        cls.base = f"http://127.0.0.1:{cls.site.server_port}"
        with socket.socket() as backend_socket:
            backend_socket.bind(("127.0.0.1", 0))
            cls.backend_port = backend_socket.getsockname()[1]
        cls.backend = f"http://127.0.0.1:{cls.backend_port}"
        callback = cls.backend + "/api/auth/github/callback"
        cls.data = cls.work / "data"
        cls.data.mkdir(exist_ok=True)
        env = dict(os.environ, HOST="127.0.0.1", PORT=str(cls.backend_port), DATA_DIR=str(cls.data),
                   SITE_BASE=cls.base, ALLOWED_ORIGINS=cls.base, RETURN_ORIGINS=cls.base,
                   GITHUB_CLIENT_ID=os.environ["AIPM_REAL_GITHUB_CLIENT_ID"],
                   GITHUB_CLIENT_SECRET=os.environ["AIPM_REAL_GITHUB_CLIENT_SECRET"],
                   OAUTH_CALLBACK_URL=callback,
                   GITHUB_AUTHORIZE_URL="https://github.com/login/oauth/authorize",
                   GITHUB_TOKEN_URL="https://github.com/login/oauth/access_token",
                   GITHUB_API_BASE="https://api.github.com",
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
              integrity: Object.fromEntries([...document.scripts].filter(s => s.integrity)
                .map(s => [s.src, s.integrity])),
              scripts: [...document.scripts].map(s => s.src)
                .filter(src => src.includes('annotation') || src.includes('chat-widget')),
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
            executed = next((res for res in reversed(observed) if res.request.resource_type == "script"), None)
            resources.append({"url": url, "status": observed[-1].status if observed else None,
                              "sha256": hashlib.sha256(data).hexdigest(),
                              "bytes": len(data),
                              "firstExecutionSha256": hashlib.sha256(executed.body()).hexdigest() if executed else None,
                              "integrity": browser["integrity"].get(url),
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

    def assert_oauth_identity(self, page, responses, stage):
        exchanges = [response for response in responses
                     if response.request.method == "POST" and
                     urlsplit(response.url).path == "/api/auth/session" and response.status == 200]
        self.assertTrue(exchanges, "actual OAuth session exchange must complete")
        session = exchanges[-1].json()
        self.assertIsInstance(session["token"], str)
        self.assertTrue(session["token"])
        self.assertEqual(session["user"]["githubId"], int(self.github_id))
        self.assertIsInstance(session["user"]["login"], str)
        self.assertTrue(session["user"]["login"])
        me = page.request.get(self.backend + "/api/auth/me", headers={
            "Authorization": "Bearer " + session["token"]})
        self.assertEqual(me.status, 200)
        identity = me.json()
        self.assertEqual(identity["user"]["githubId"], session["user"]["githubId"])
        self.assertEqual(identity["user"]["login"], session["user"]["login"])
        browser_user = page.evaluate("window.__aipmAnnoAuth.user()")
        self.assertEqual(browser_user["githubId"], identity["user"]["githubId"])
        self.assertEqual(browser_user["login"], identity["user"]["login"])
        (self.work / f"{stage}-oauth-identity.json").write_text(json.dumps({
            "exchangeStatus": exchanges[-1].status, "meStatus": me.status,
            "sessionUser": {name: session["user"][name] for name in ("githubId", "login")},
            "meUser": {name: identity["user"][name] for name in ("githubId", "login")},
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def test_old_sw_and_cached_scripts_require_fresh_confirmation(self):
        browser = self.pw.chromium.launch()
        try:
            for label, target, fail_auth in (("baseline", self.baseline, False),
                                             ("failure", self.candidate, True),
                                             ("candidate", self.candidate, False)):
                context = browser.new_context()
                context.route("**/*", lambda route: route.continue_() if
                              urlsplit(route.request.url).hostname in {"127.0.0.1", "github.com", "api.github.com"} else route.abort())
                context.route(LEGACY_ANNO_ORIGIN + "/**", lambda route:
                              route.continue_(url=self.backend + urlsplit(route.request.url).path +
                                              ("?" + urlsplit(route.request.url).query
                                               if urlsplit(route.request.url).query else "")))
                page = context.new_page()
                entries = {"requests": [], "responses": [], "statuses": []}
                page.on("request", lambda req: entries["requests"].append({"method": req.method,
                        "url": req.url, "postData": req.post_data}))
                page.on("response", lambda res: (entries["responses"].append(res),
                        entries["statuses"].append({"method": res.request.method,
                                                     "url": res.url, "status": res.status})))
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
                self.assert_oauth_identity(page, entries["responses"], label)
                if label == "candidate":
                    page.wait_for_selector(".aipm-anno__login-consent")
                current = self.snapshot(page, entries, label + "-unconfirmed")
                self.assertEqual(current["resources"][0]["sha256"], hashlib.sha256(
                    (target / "ai" / "rag" / "index.html").read_bytes()).hexdigest())
                script_versions = {parse_qs(urlsplit(src).query).get("v", [None])[0]
                                   for src in current["browser"]["scripts"]}
                self.assertEqual(len(script_versions), 1)
                for resource in current["resources"][1:]:
                    filename = urlsplit(resource["url"]).path.rsplit("/", 1)[-1]
                    source = self.old if label == "baseline" else self.candidate
                    expected = hashlib.sha256((source / "_static" / "js" / filename).read_bytes()).hexdigest()
                    self.assertEqual(resource["sha256"], expected)
                    self.assertTrue(resource["fromServiceWorker"])
                    if label == "candidate":
                        self.assertEqual(resource["firstExecutionSha256"], expected)
                        self.assertEqual(resource["integrity"],
                                         "sha256-" + base64.b64encode(bytes.fromhex(expected)).decode())
                writes = [r for r in current["requests"] if r["method"] == "POST" and
                          r["url"].endswith("/api/annotations")]
                self.assertEqual(len(writes), 1 if label == "baseline" else 0)
                annotation_responses = [r for r in current["responses"] if
                                        r["method"] == "POST" and
                                        urlsplit(r["url"]).path == "/api/annotations"]
                self.assertEqual([r["status"] for r in annotation_responses],
                                 [403] if label == "baseline" else [])
                self.assertEqual(current["annotationCount"] - old["annotationCount"], 0)
                self.assertEqual(current["operationCount"] - old["operationCount"], 0)
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


    def test_mixed_panel_bytes_are_rejected_before_execution(self):
        browser = self.pw.chromium.launch()
        old_panel = (self.old / "_static/js/annotation.js").read_bytes()
        try:
            for label, target in (("frozen", self.frozen), ("protected", self.candidate)):
                context = browser.new_context()
                context.route("**/*", lambda route: route.continue_() if
                              urlsplit(route.request.url).hostname in {"127.0.0.1", "github.com", "api.github.com"} else route.abort())
                context.route(LEGACY_ANNO_ORIGIN + "/**", lambda route:
                              route.continue_(url=self.backend + urlsplit(route.request.url).path +
                                              ("?" + urlsplit(route.request.url).query
                                               if urlsplit(route.request.url).query else "")))
                self.site.root = self.old
                self.site.stage = "old"
                self.site.faults = {}
                self.site.fail_auth = False
                page = context.new_page()
                oauth_responses = []
                page.on("response", lambda response: oauth_responses.append(response))
                page.goto(self.base + PAGE, wait_until="load")
                page.wait_for_function("() => !!navigator.serviceWorker.controller")
                page.reload(wait_until="load")
                page.wait_for_function("""async () => {
                    const keys = await (await caches.open('aipm-static-v2')).keys();
                    return keys.some(key => key.url.includes('annotation.js?v=37'));
                }""")
                context.route(LEGACY_ANNO_ORIGIN + "/api/annotations",
                              lambda route: route.abort() if route.request.method == "POST"
                              else route.continue_(url=self.backend + "/api/annotations"))
                page.get_by_role("button", name="打开批注面板").click()
                if page.locator(".aipm-anno__title").inner_text().strip() == "批注":
                    page.locator(".aipm-anno__title").click()
                page.locator(".aipm-anno__newbtn").click()
                page.locator(".aipm-anno__input--comment").fill("混合版本复现：旧面板字节")
                page.locator(".aipm-anno__visbtn").click()
                page.locator('.aipm-anno__vislist [data-vis="public"]').click()
                page.wait_for_function("() => !!window.__aipmAnnoAuth?.user()")
                self.assert_oauth_identity(page, oauth_responses, "mixed-" + label)
                page.wait_for_function("() => !!window.__aipmAnnoStore?.peekDraft()?.identity")
                draft = page.evaluate("window.__aipmAnnoStore.peekDraft()")
                self.assertEqual(draft["identity"], self.github_id)
                page.wait_for_timeout(500)
                context.unroute(LEGACY_ANNO_ORIGIN + "/api/annotations")
                store_path = self.data / "store.json"
                before = json.loads(store_path.read_text()) if store_path.exists() else {"annotations": [], "operations": []}
                self.site.root = target
                self.site.stage = label
                self.site.faults = {"/_static/js/annotation.js": old_panel}
                self.site.requests.clear()
                responses = []
                requests = []
                page.on("response", lambda response: responses.append(response))
                page.on("request", lambda request: requests.append(request))
                navigation = page.reload(wait_until="load")
                page.wait_for_timeout(1000)
                panel = next(response for response in responses
                             if urlsplit(response.url).path == "/_static/js/annotation.js")
                expected_html = (target / "ai/rag/index.html").read_bytes()
                self.assertEqual(hashlib.sha256(navigation.body()).hexdigest(), hashlib.sha256(expected_html).hexdigest())
                self.assertEqual(hashlib.sha256(panel.body()).hexdigest(), hashlib.sha256(old_panel).hexdigest())
                self.assertTrue(panel.from_service_worker)
                record = {"stage": label, "draft": draft, "scriptURL": panel.url,
                          "firstExecutionResponseSha256": hashlib.sha256(panel.body()).hexdigest(),
                          "expectedSha256": hashlib.sha256((target / "_static/js/annotation.js").read_bytes()).hexdigest(),
                          "firstHTMLResponseSha256": hashlib.sha256(navigation.body()).hexdigest(),
                          "controller": page.evaluate("navigator.serviceWorker.controller?.scriptURL"),
                          "cacheKeys": page.evaluate("""async () => (await (await caches.open('aipm-static-v2')).keys()).map(key => key.url)""")}
                if label == "protected":
                    self.assertEqual(page.locator(".aipm-anno__newbtn").count(), 0)
                    self.assertTrue(page.get_by_role("alert").filter(has_text="完整性校验").is_visible())
                writes = [request for request in requests if request.method == "POST" and
                          urlsplit(request.url).path == "/api/annotations"]
                after = json.loads(store_path.read_text()) if store_path.exists() else {"annotations": [], "operations": []}
                record["posts"] = [{"body": json.loads(request.post_data)} for request in writes]
                record["postResponses"] = [{"status": response.status, "body": response.json()}
                                           for response in responses if response.request.method == "POST" and
                                           urlsplit(response.url).path == "/api/annotations"]
                record["annotationsBefore"] = len(before["annotations"])
                record["annotationsAfter"] = len(after["annotations"])
                record["operationsBefore"] = len(before["operations"])
                record["operationsAfter"] = len(after["operations"])
                (self.work / f"mixed-{label}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2))
                self.assertEqual(len(writes), 1 if label == "frozen" else 0)
                self.assertEqual([item["status"] for item in record["postResponses"]],
                                 [403] if label == "frozen" else [])
                self.assertEqual(len(after["annotations"]) - len(before["annotations"]), 0)
                self.assertEqual(len(after["operations"]) - len(before["operations"]), 0)
                context.close()
        finally:
            self.site.faults = {}
            browser.close()


    def test_agent_module_graph_rejects_mixed_bytes(self):
        browser = self.pw.chromium.launch()
        modules = ("annotation-agent-entry.js", "annotation-consent-core.js",
                   "annotation-proposal-confirm.js", "annotation-request-status.js",
                   "annotation-confirm-view.js")
        payload = b"export const unexpected = true;\n"
        try:
            for name in modules:
                context = browser.new_context()
                context.route("**/*", lambda route: route.continue_() if
                              urlsplit(route.request.url).hostname in {"127.0.0.1", "github.com", "api.github.com"} else route.abort())
                path = "/_static/js/" + name
                self.site.root = self.candidate
                self.site.stage = name
                self.site.fail_auth = False
                self.site.faults = {path: payload}
                page = context.new_page()
                responses = []
                requests = []
                page.on("response", lambda response: responses.append(response))
                page.on("request", lambda request: requests.append(request))
                failures = []
                page.on("requestfailed", lambda request: failures.append({"url": request.url,
                                                                            "error": request.failure}))
                page.goto(self.base + PAGE, wait_until="load")
                page.wait_for_function("() => window.__aipmIntegrityFailed === true")
                module_url = page.evaluate("""name => {
                    const map = JSON.parse(document.querySelector('script[type="importmap"]').textContent);
                    const url = Object.keys(map.integrity).find(value =>
                        new URL(value, location.href).pathname.endsWith('/' + name));
                    if (!url) throw new Error('module missing from integrity map: ' + name);
                    return url;
                }""", name)
                result = page.evaluate("""() => ({
                    ready: window.__aipmIntegrityReady,
                    failed: window.__aipmIntegrityFailed,
                    chat: !!window.__aipmChat,
                    store: !!window.__aipmAnnoStore,
                    auth: !!window.__aipmAnnoAuth
                })""")
                record = {"module": name, "result": result,
                          "moduleURL": module_url,
                          "servedSha256": hashlib.sha256(payload).hexdigest(),
                          "builtSha256": hashlib.sha256((self.candidate / path.lstrip("/")).read_bytes()).hexdigest(),
                          "browserRequests": [request.url for request in requests
                                              if urlsplit(request.url).path == path],
                          "browserFailures": [failure for failure in failures
                                              if urlsplit(failure["url"]).path == path],
                          "serverRequests": [entry["path"] for entry in self.site.requests
                                             if urlsplit(entry["path"]).path == path],
                          "annotationPosts": [request.post_data for request in requests if request.method == "POST" and
                                              urlsplit(request.url).path == "/api/annotations"]}
                (self.work / f"module-{name}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2))
                self.assertTrue(result["failed"], record)
                self.assertFalse(result["ready"], record)
                self.assertFalse(result["chat"], record)
                self.assertFalse(result["store"], record)
                self.assertFalse(result["auth"], record)
                self.assertTrue(record["browserRequests"], record)
                self.assertTrue(record["serverRequests"], record)
                self.assertFalse(record["annotationPosts"])
                context.close()
            self.site.faults = {}
            context = browser.new_context()
            context.route("**/*", lambda route: route.continue_() if
                          urlsplit(route.request.url).hostname in {"127.0.0.1", "github.com", "api.github.com"} else route.abort())
            page = context.new_page()
            page.goto(self.base + PAGE, wait_until="load")
            page.wait_for_function("() => window.__aipmIntegrityReady === true")
            module_url = page.evaluate("""() => {
                const map = JSON.parse(document.querySelector('script[type="importmap"]').textContent);
                return Object.keys(map.integrity).find(value =>
                    new URL(value, location.href).pathname.endsWith('/annotation-agent-entry.js'));
            }""")
            result = page.evaluate("""async path => typeof (await import(path)).createAgentEntry""", module_url)
            self.assertEqual(result, "function")
            context.close()
        finally:
            self.site.faults = {}
            browser.close()


    def test_missing_and_mixed_classic_assets_stop_writes(self):
        browser = self.pw.chromium.launch()
        paths = ("annotation-store.js", "annotation-auth.js", "annotation.js", "chat-widget.js")
        try:
            for name in paths:
                for label, payload in (("missing", None),
                                       ("mixed", (self.old / "_static/js" / name).read_bytes())):
                    context = browser.new_context()
                    context.route("**/*", lambda route: route.continue_() if
                                  urlsplit(route.request.url).hostname in {"127.0.0.1", "github.com", "api.github.com"} else route.abort())
                    context.route(LEGACY_ANNO_ORIGIN + "/**", lambda route:
                                  route.continue_(url=self.backend + urlsplit(route.request.url).path +
                                                  ("?" + urlsplit(route.request.url).query
                                                   if urlsplit(route.request.url).query else "")))
                    path = "/_static/js/" + name
                    self.site.root = self.candidate
                    self.site.stage = label + "-" + name
                    self.site.faults = {path: payload}
                    self.site.fail_auth = False
                    self.site.requests.clear()
                    page = context.new_page()
                    requests = []
                    failures = []
                    responses = []
                    page.on("response", lambda response: responses.append(response))
                    page.on("request", lambda request: requests.append(request))
                    page.on("requestfailed", lambda request: failures.append({"url": request.url,
                                                                                "error": request.failure}))
                    page.goto(self.base + PAGE, wait_until="load")
                    page.wait_for_selector('[role="alert"]')
                    record = {"asset": name, "scenario": label,
                              "failedRequests": [failure for failure in failures
                                                 if urlsplit(failure["url"]).path == path],
                              "serverRequests": [entry["path"] for entry in self.site.requests
                                                 if urlsplit(entry["path"]).path == path],
                              "firstResponses": [{"status": response.status,
                                                  "sha256": hashlib.sha256(response.body()).hexdigest()}
                                                 for response in responses if urlsplit(response.url).path == path],
                              "servedSha256": hashlib.sha256(payload).hexdigest() if payload else None,
                              "builtSha256": hashlib.sha256((self.candidate / path.lstrip("/")).read_bytes()).hexdigest(),
                              "posts": [request.post_data for request in requests if request.method == "POST" and
                                        urlsplit(request.url).path == "/api/annotations"],
                              "banner": page.get_by_role("alert").inner_text(),
                              "panelButtons": page.locator(".aipm-anno__newbtn").count()}
                    (self.work / f"classic-{label}-{name}.json").write_text(
                        json.dumps(record, ensure_ascii=False, indent=2))
                    self.assertTrue(record["serverRequests"], record)
                    self.assertIn("完整性校验", record["banner"])
                    self.assertEqual(record["panelButtons"], 0)
                    self.assertFalse(record["posts"])
                    context.close()
        finally:
            self.site.faults = {}
            browser.close()

    def test_missing_agent_modules_reject_import(self):
        browser = self.pw.chromium.launch()
        modules = ("annotation-agent-entry.js", "annotation-consent-core.js",
                   "annotation-proposal-confirm.js", "annotation-request-status.js",
                   "annotation-confirm-view.js")
        try:
            for name in modules:
                context = browser.new_context()
                context.route("**/*", lambda route: route.continue_() if
                              urlsplit(route.request.url).hostname in {"127.0.0.1", "github.com", "api.github.com"} else route.abort())
                path = "/_static/js/" + name
                self.site.root = self.candidate
                self.site.stage = name
                self.site.faults = {path: None}
                self.site.requests.clear()
                page = context.new_page()
                page.goto(self.base + PAGE, wait_until="load")
                page.wait_for_function("() => window.__aipmIntegrityFailed === true")
                module_url = page.evaluate("""name => {
                    const map = JSON.parse(document.querySelector('script[type="importmap"]').textContent);
                    return Object.keys(map.integrity).find(value =>
                        new URL(value, location.href).pathname.endsWith('/' + name));
                }""", name)
                result = page.evaluate("""() => ({
                    ready: window.__aipmIntegrityReady,
                    failed: window.__aipmIntegrityFailed,
                    chat: !!window.__aipmChat,
                    store: !!window.__aipmAnnoStore,
                    auth: !!window.__aipmAnnoAuth
                })""")
                record = {"module": name, "result": result,
                          "moduleURL": module_url,
                          "serverRequests": [entry["path"] for entry in self.site.requests
                                             if urlsplit(entry["path"]).path == path]}
                (self.work / f"module-missing-{name}.json").write_text(
                    json.dumps(record, ensure_ascii=False, indent=2))
                self.assertTrue(result["failed"], record)
                self.assertFalse(result["ready"], record)
                self.assertFalse(result["chat"], record)
                self.assertFalse(result["store"], record)
                self.assertFalse(result["auth"], record)
                self.assertTrue(record["serverRequests"], record)
                context.close()
        finally:
            self.site.faults = {}
            browser.close()


if __name__ == "__main__":
    unittest.main()
