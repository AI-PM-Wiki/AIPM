"""真实批注服务的登录恢复草稿与丢失响应回归。"""
import http.client
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
import urllib.request
import urllib.error

from playwright.sync_api import sync_playwright

from harness import ROOT, WORK, StaticSite, build_site


class ResponseDropProxy(http.server.BaseHTTPRequestHandler):
    drop_next = True
    writes = []

    def log_message(self, *args):
        pass

    def forward(self):
        payload = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        upstream = http.client.HTTPConnection("127.0.0.1", 18788, timeout=20)
        headers = dict(self.headers)
        headers["Host"] = "127.0.0.1:18788"
        upstream.request(self.command, self.path, body=payload, headers=headers)
        response = upstream.getresponse()
        body = response.read()
        drop = self.command == "POST" and self.path == "/api/annotations" and self.drop_next
        if self.command == "POST" and self.path == "/api/annotations":
            self.writes.append({"request": json.loads(payload), "status": response.status})
        if drop:
            type(self).drop_next = False
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
        else:
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in {"connection", "transfer-encoding", "content-length"}:
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        upstream.close()

    do_GET = forward
    do_POST = forward
    do_OPTIONS = forward


class RealDraftCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = WORK / "real-draft"
        cls.runtime.mkdir(parents=True, exist_ok=True)
        cls.data = tempfile.mkdtemp(dir=cls.runtime)
        cls.site = StaticSite(build_site(cls.runtime / "site"))
        cls.proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 8788), ResponseDropProxy)
        cls.proxy_thread = threading.Thread(target=cls.proxy.serve_forever)
        cls.proxy_thread.start()
        cls.env = dict(os.environ, HOST="127.0.0.1", PORT="18788", DEV_AUTH_BYPASS="true",
                       DEV_AUTH_LOGIN="draft-review", DATA_DIR=cls.data,
                       SITE_BASE=cls.site.base, ALLOWED_ORIGINS=cls.site.base,
                       RETURN_ORIGINS=cls.site.base,
                       SEARCH_INDEX_URL=cls.site.base + "/search/search_index.json",
                       TMPDIR=str(cls.runtime))
        cls.start_service()
        cls.playwright = sync_playwright().start()

    @classmethod
    def start_service(cls):
        cls.log = (cls.runtime / "service.log").open("a")
        cls.service = subprocess.Popen(["node", "--import", "tsx", "src/server.ts"],
                                       cwd=ROOT / "annotation-server", env=cls.env,
                                       stdout=cls.log, stderr=subprocess.STDOUT)
        for _ in range(150):
            if cls.service.poll() is not None:
                raise AssertionError((cls.runtime / "service.log").read_text())
            try:
                with urllib.request.urlopen("http://127.0.0.1:18788/healthz", timeout=1):
                    return
            except urllib.error.URLError:
                time.sleep(0.1)
        raise AssertionError("批注服务启动超时")

    @classmethod
    def stop_service(cls):
        cls.service.terminate()
        cls.service.wait(timeout=15)
        cls.log.close()

    @classmethod
    def tearDownClass(cls):
        cls.playwright.stop()
        cls.stop_service()
        cls.proxy.shutdown()
        cls.proxy.server_close()
        cls.proxy_thread.join()
        cls.site.close()

    def test_unknown_draft_keeps_scope_and_retries_original_write(self):
        ResponseDropProxy.drop_next = True
        ResponseDropProxy.writes.clear()
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev",
                                         data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        before_count = len(json.loads((Path(self.data) / "store.json").read_text())["annotations"])
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            draft = {"requestId": "real-draft-unknown-2026-09-23", "page": "/ai/rag/",
                     "color": "yellow", "style": "highlight", "body": "真实服务响应中断",
                     "visibility": "public", "resumeKind": "create", "resumeId": None,
                     "scope": "page", "selectors": None, "quote": ""}
            page.evaluate("([auth, draft]) => { localStorage.setItem('aipm-anno-auth', JSON.stringify(auth)); localStorage.setItem('aipm-anno-draft', JSON.stringify(draft)); }",
                          [session, draft])
            with page.expect_event("requestfailed", predicate=lambda r: r.method == "POST" and r.url.endswith("/api/annotations")):
                page.reload(wait_until="load")
            page.wait_for_function("() => JSON.parse(localStorage.getItem('aipm-anno-draft') || '{}').resultUnknown === true")
            self.assertEqual(len(ResponseDropProxy.writes), 1)
            self.assertEqual(ResponseDropProxy.writes[0]["status"], 201)
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
            self.assertFalse(page.locator(".aipm-anno__input--comment").is_editable())
            page.evaluate("() => document.querySelector('.aipm-anno__visbtn').click()")
            self.assertEqual(page.evaluate("() => JSON.parse(localStorage.getItem('aipm-anno-draft')).visibility"), "public")
            self.assertIsNone(page.evaluate("() => localStorage.getItem('aipm-anno-local')"))
            ResponseDropProxy.drop_next = True
            with page.expect_event("requestfailed", predicate=lambda r: r.method == "POST" and r.url.endswith("/api/annotations")):
                page.reload(wait_until="load")
            page.wait_for_function("() => JSON.parse(localStorage.getItem('aipm-anno-draft') || '{}').resultUnknown === true")
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
            page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-draft')")
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [201, 200, 200])
            self.assertEqual([write["request"] for write in ResponseDropProxy.writes],
                             [ResponseDropProxy.writes[0]["request"]] * 3)
            state = json.loads((Path(self.data) / "store.json").read_text())
            self.assertEqual(len(state["annotations"]), before_count + 1)
            self.assertEqual(sum(a["body"] == draft["body"] for a in state["annotations"]), 1)
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                annotations = json.load(response)["annotations"]
                self.assertEqual(len(annotations), before_count + 1)
                self.assertEqual(sum(a["body"] == draft["body"] for a in annotations), 1)
        finally:
            context.close()
            browser.close()

    def test_manual_retry_after_storage_failure_keeps_unknown_scope(self):
        ResponseDropProxy.drop_next = False
        ResponseDropProxy.writes.clear()
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev",
                                         data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        obstruction = Path(self.data) / "store.json.tmp"
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            draft = {"requestId": "manual-retry-storage-failure", "page": "/ai/rag/",
                     "color": "yellow", "style": "highlight", "body": "Manual retry durability review",
                     "visibility": "public", "resumeKind": "create", "resumeId": None,
                     "scope": "page", "selectors": None, "quote": ""}
            page.evaluate("([auth, draft]) => { localStorage.setItem(\"aipm-anno-auth\", JSON.stringify(auth)); localStorage.setItem(\"aipm-anno-draft\", JSON.stringify(draft)); }", [session, draft])
            obstruction.mkdir()
            with page.expect_response(lambda response: response.url.endswith("/api/annotations") and response.request.method == "POST") as initial:
                page.reload(wait_until="load")
            self.assertEqual(initial.value.status, 503)
            page.wait_for_function("() => document.querySelector(\".aipm-anno__hint\")?.textContent.includes(\"保存失败\")")
            self.assertEqual(len(json.loads((Path(self.data) / "store.json").read_text())["annotations"]), 0)
            obstruction.rmdir()
            ResponseDropProxy.drop_next = True
            with page.expect_event("requestfailed", predicate=lambda req: req.url.endswith("/api/annotations") and req.method == "POST"):
                page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !document.querySelector(\".aipm-anno__save\").disabled")
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
            self.assertFalse(page.locator(".aipm-anno__input--comment").is_editable())
            self.assertTrue(page.evaluate("() => JSON.parse(localStorage.getItem(\"aipm-anno-draft\")).resultUnknown"))
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [503, 201])
            self.assertEqual(ResponseDropProxy.writes[0]["request"], ResponseDropProxy.writes[1]["request"])
            self.assertIsNone(page.evaluate("() => localStorage.getItem(\"aipm-anno-local\")"))
            page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !localStorage.getItem(\"aipm-anno-draft\")")
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [503, 201, 200])
            self.assertEqual(ResponseDropProxy.writes[0]["request"], ResponseDropProxy.writes[2]["request"])
            self.assertEqual(len(json.loads((Path(self.data) / "store.json").read_text())["annotations"]), 1)
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(len(json.load(response)["annotations"]), 1)
        finally:
            if obstruction.is_dir():
                obstruction.rmdir()
            context.close()
            browser.close()

    def test_new_editor_submission_preserves_unknown_result(self):
        ResponseDropProxy.drop_next = False
        ResponseDropProxy.writes.clear()
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev",
                                         data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.evaluate("auth => localStorage.setItem(\"aipm-anno-auth\", JSON.stringify(auth))", session)
            page.reload(wait_until="load")
            page.locator(".aipm-anno-entry").click()
            page.locator(".aipm-anno__head-icon").click()
            page.locator(".aipm-anno__newbtn").click()
            page.locator(".aipm-anno__input--comment").fill("New editor interrupted response")
            ResponseDropProxy.drop_next = True
            with page.expect_event("requestfailed", predicate=lambda req: req.url.endswith("/api/annotations") and req.method == "POST"):
                page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !document.querySelector(\".aipm-anno__save\").disabled")
            draft = page.evaluate("() => JSON.parse(localStorage.getItem(\"aipm-anno-draft\"))")
            self.assertTrue(draft["resultUnknown"])
            self.assertEqual(draft["visibility"], "public")
            self.assertEqual(page.locator(".aipm-anno__input--comment").input_value(), draft["body"])
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
            self.assertFalse(page.locator(".aipm-anno__input--comment").is_editable())
            page.reload(wait_until="load")
            page.wait_for_function("() => !localStorage.getItem(\"aipm-anno-draft\")")
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [201, 200])
            self.assertEqual(ResponseDropProxy.writes[0]["request"], ResponseDropProxy.writes[1]["request"])
            state = json.loads((Path(self.data) / "store.json").read_text())["annotations"]
            self.assertEqual(sum(a["body"] == "New editor interrupted response" for a in state), 1)
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(sum(a["body"] == "New editor interrupted response" for a in json.load(response)["annotations"]), 1)
        finally:
            context.close()
            browser.close()

    def test_unknown_login_logout_and_refresh_reuse_original_request(self):
        ResponseDropProxy.writes.clear()
        ResponseDropProxy.drop_next = True
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev", data=b"{}",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        body = "Unknown login lifecycle"
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.evaluate("auth => localStorage.setItem('aipm-anno-auth', JSON.stringify(auth))", session)
            page.reload(wait_until="load")
            page.locator(".aipm-anno-entry").click()
            page.locator(".aipm-anno__head-icon").click()
            page.locator(".aipm-anno__newbtn").click()
            page.locator(".aipm-anno__input--comment").fill(body)
            with page.expect_event("requestfailed", predicate=lambda r: r.method == "POST" and r.url.endswith("/api/annotations")):
                page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !document.querySelector('.aipm-anno__save').disabled")
            before = page.evaluate("() => JSON.parse(localStorage.getItem('aipm-anno-draft'))")
            self.assertTrue(before["resultUnknown"])
            page.locator(".aipm-anno__account").click()
            page.locator(".aipm-anno__logout").click()
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-auth')")
            with page.expect_response(lambda r: "/api/auth/github/start" in r.url) as login:
                page.locator(".aipm-anno__account").click()
            self.assertEqual(login.value.status, 503)
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.wait_for_selector(".aipm-anno__save")
            self.assertEqual(page.evaluate("() => JSON.parse(localStorage.getItem('aipm-anno-draft')).requestId"), before["requestId"])
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
            self.assertFalse(page.locator(".aipm-anno__input--comment").is_editable())
            self.assertEqual(page.locator(".aipm-anno__input--comment").input_value(), body)
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [201])
            with urllib.request.urlopen(request) as response:
                renewed = json.load(response)
            page.evaluate("auth => localStorage.setItem('aipm-anno-auth', JSON.stringify(auth))", renewed)
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/annotations")) as retry:
                page.reload(wait_until="load")
            self.assertEqual(retry.value.status, 200)
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-draft')")
            page.reload(wait_until="networkidle")
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [201, 200])
            self.assertEqual(ResponseDropProxy.writes[0]["request"], ResponseDropProxy.writes[1]["request"])
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(sum(a["body"] == body for a in json.load(response)["annotations"]), 1)
        finally:
            context.close()
            browser.close()

    def test_definite_failure_local_save_consumes_matching_draft(self):
        ResponseDropProxy.writes.clear()
        ResponseDropProxy.drop_next = False
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev", data=b"{}",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        obstruction = Path(self.data) / "store.json.tmp"
        body = "Definite failure local choice"
        draft = {"requestId": "draft-local-choice-20260923", "page": "/ai/rag/",
                 "color": "yellow", "style": "highlight", "body": body,
                 "visibility": "public", "resumeKind": "create", "resumeId": None,
                 "scope": "page", "selectors": None, "quote": ""}
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.evaluate("([auth, draft]) => { localStorage.setItem('aipm-anno-auth', JSON.stringify(auth)); localStorage.setItem('aipm-anno-draft', JSON.stringify(draft)); }", [session, draft])
            obstruction.mkdir()
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/annotations")) as failed:
                page.reload(wait_until="load")
            self.assertEqual(failed.value.status, 503)
            page.wait_for_function("() => document.querySelector('.aipm-anno__hint')?.textContent.includes('保存失败')")
            self.assertFalse(page.locator(".aipm-anno__visbtn").is_disabled())
            obstruction.rmdir()
            page.locator(".aipm-anno__visbtn").click()
            page.locator("button[data-vis=local]").click()
            page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !!localStorage.getItem('aipm-anno-local')")
            self.assertIsNone(page.evaluate("() => localStorage.getItem('aipm-anno-draft')"))
            page.reload(wait_until="networkidle")
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [503])
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(sum(a["body"] == body for a in json.load(response)["annotations"]), 0)
        finally:
            if obstruction.is_dir():
                obstruction.rmdir()
            context.close()
            browser.close()

    def test_manual_success_does_not_schedule_another_write(self):
        ResponseDropProxy.writes.clear()
        ResponseDropProxy.drop_next = True
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev", data=b"{}",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        body = "Manual success exactly once"
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.evaluate("auth => localStorage.setItem('aipm-anno-auth', JSON.stringify(auth))", session)
            page.reload(wait_until="load")
            page.locator(".aipm-anno-entry").click()
            page.locator(".aipm-anno__head-icon").click()
            page.locator(".aipm-anno__newbtn").click()
            page.locator(".aipm-anno__input--comment").fill(body)
            with page.expect_event("requestfailed", predicate=lambda r: r.method == "POST" and r.url.endswith("/api/annotations")):
                page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !document.querySelector('.aipm-anno__save').disabled")
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/annotations")) as retry:
                page.locator(".aipm-anno__save").click()
            self.assertEqual(retry.value.status, 200)
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-draft')")
            page.reload(wait_until="networkidle")
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [201, 200])
            self.assertEqual(ResponseDropProxy.writes[0]["request"], ResponseDropProxy.writes[1]["request"])
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(sum(a["body"] == body for a in json.load(response)["annotations"]), 1)
        finally:
            context.close()
            browser.close()

    def test_local_save_preserves_unrelated_draft(self):
        ResponseDropProxy.writes.clear()
        ResponseDropProxy.drop_next = False
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        other = {"requestId": "other-draft-20260923", "page": "/ai/rag/",
                 "body": "Keep the other draft", "visibility": "public", "resultUnknown": True,
                 "scope": "page", "selectors": None}
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.locator(".aipm-anno-entry").click()
            page.locator(".aipm-anno__head-icon").click()
            page.locator(".aipm-anno__newbtn").click()
            page.locator(".aipm-anno__input--comment").fill("Local while another draft exists")
            page.evaluate("draft => localStorage.setItem('aipm-anno-draft', JSON.stringify(draft))", other)
            page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !!localStorage.getItem('aipm-anno-local')")
            self.assertEqual(page.evaluate("() => JSON.parse(localStorage.getItem('aipm-anno-draft')).requestId"), other["requestId"])
            self.assertEqual(len(ResponseDropProxy.writes), 0)
        finally:
            context.close()
            browser.close()

    def test_unsent_proposal_with_request_id_remains_editable_after_login_failure(self):
        ResponseDropProxy.writes.clear()
        ResponseDropProxy.drop_next = False
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        proposal = {"id": "unsent-proposal", "requestId": "unsent-proposal-id",
                    "page": "/ai/rag/", "scope": "page", "quote": "", "body": "Unsent proposal",
                    "color": "yellow", "style": "highlight", "visibility": "public"}
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.evaluate("proposal => localStorage.setItem('aipm-chat-history', JSON.stringify([{role: 'assistant', content: 'Unsent', proposals: [proposal]}]))", proposal)
            page.reload(wait_until="load")
            page.locator(".aipm-chat__fab").click()
            self.assertTrue(page.locator(".aipm-chat__proposal-visbtn").first.is_enabled())
            with page.expect_response(lambda r: "/api/auth/github/start" in r.url) as login:
                page.locator(".aipm-chat__proposal-accept").click()
            self.assertEqual(login.value.status, 503)
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            entry = page.locator(".aipm-anno-entry")
            if entry.get_attribute("aria-expanded") != "true":
                entry.click()
            page.locator(".aipm-anno__input--comment").wait_for(state="visible")
            self.assertTrue(page.locator(".aipm-anno__input--comment").is_editable())
            draft = page.evaluate("() => JSON.parse(localStorage.getItem('aipm-anno-draft'))")
            self.assertEqual(draft["requestId"], proposal["requestId"])
            self.assertFalse(draft["resultUnknown"])
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_enabled())
            self.assertTrue(page.locator(".aipm-anno__input--comment").is_editable())
            page.locator(".aipm-anno__input--comment").fill("Edited unsent proposal")
            page.evaluate("() => document.querySelector('.aipm-anno__visbtn').click()")
            page.evaluate("() => document.querySelector('button[data-vis=local]').click()")
            self.assertEqual(page.locator(".aipm-anno__input--comment").input_value(), "Edited unsent proposal")
            self.assertTrue(page.locator(".aipm-anno__vislist button[data-vis=local]").evaluate("button => button.classList.contains('is-active')"))
            self.assertEqual(ResponseDropProxy.writes, [])
        finally:
            context.close()
            browser.close()

    def test_unknown_proposal_login_failure_retains_original_request(self):
        ResponseDropProxy.writes.clear()
        ResponseDropProxy.drop_next = True
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev", data=b"{}",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        body = "Proposal unknown login lifecycle"
        proposal = {"id": "unknown-proposal", "page": "/ai/rag/", "scope": "page",
                    "quote": "", "prefix": "", "suffix": "", "body": body,
                    "color": "yellow", "style": "highlight", "visibility": "public"}
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.evaluate("([auth, proposal]) => { localStorage.setItem('aipm-anno-auth', JSON.stringify(auth)); localStorage.setItem('aipm-chat-history', JSON.stringify([{role: 'assistant', content: 'Stored proposal', proposals: [proposal]}])); }", [session, proposal])
            page.reload(wait_until="load")
            page.locator(".aipm-chat__fab").click()
            with page.expect_event("requestfailed", predicate=lambda r: r.method == "POST" and r.url.endswith("/api/annotations")):
                page.locator(".aipm-chat__proposal-accept").click()
            page.wait_for_function("() => document.querySelector('.aipm-chat__proposal').dataset.state === 'unknown'")
            before = page.evaluate("() => JSON.parse(localStorage.getItem('aipm-chat-history'))[0].proposals[0]")
            self.assertTrue(before["resultUnknown"])
            self.assertEqual([w["status"] for w in ResponseDropProxy.writes], [201])
            page.locator(".aipm-anno-entry").click()
            page.locator(".aipm-anno__account").click()
            page.locator(".aipm-anno__logout").click()
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-auth')")
            page.locator(".aipm-chat__fab").click()
            with page.expect_response(lambda r: "/api/auth/github/start" in r.url) as login:
                page.locator(".aipm-chat__proposal-accept").click()
            self.assertEqual(login.value.status, 503)
            for _ in range(2):
                page.goto(self.site.base + "/ai/rag/", wait_until="load")
                page.locator(".aipm-anno-entry").click()
                page.wait_for_selector(".aipm-anno__save", state="attached")
                draft = page.evaluate("() => JSON.parse(localStorage.getItem('aipm-anno-draft'))")
                self.assertEqual(draft["requestId"], before["requestId"])
                self.assertEqual(draft["body"], body)
                self.assertEqual(draft["visibility"], "public")
                self.assertEqual(draft["scope"], "page")
                self.assertTrue(draft["resultUnknown"])
                self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
                self.assertFalse(page.locator(".aipm-anno__input--comment").is_editable())
                self.assertEqual([w["status"] for w in ResponseDropProxy.writes], [201])
            with urllib.request.urlopen(request) as response:
                renewed = json.load(response)
            page.evaluate("auth => localStorage.setItem('aipm-anno-auth', JSON.stringify(auth))", renewed)
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/annotations")) as retry:
                page.reload(wait_until="load")
            self.assertEqual(retry.value.status, 200)
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-draft')")
            page.reload(wait_until="networkidle")
            self.assertEqual([w["status"] for w in ResponseDropProxy.writes], [201, 200])
            self.assertEqual(ResponseDropProxy.writes[0]["request"], ResponseDropProxy.writes[1]["request"])
            self.assertEqual(ResponseDropProxy.writes[0]["request"]["requestId"], before["requestId"])
            self.assertEqual(ResponseDropProxy.writes[0]["request"]["body"], body)
            self.assertEqual(ResponseDropProxy.writes[0]["request"]["visibility"], "public")
            self.assertEqual(ResponseDropProxy.writes[0]["request"]["target"], {"scope": "page", "selectors": []})
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(sum(a["body"] == body for a in json.load(response)["annotations"]), 1)
        finally:
            context.close()
            browser.close()

    def test_unknown_proposal_retry_login_failure_keeps_text_selection(self):
        ResponseDropProxy.writes.clear()
        ResponseDropProxy.drop_next = True
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev", data=b"{}",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
        browser = self.playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        quote = "检索增强生成"
        body = "Proposal anchored text after login"
        proposal = {"id": "text-proposal", "page": "/ai/rag/", "scope": "text",
                    "quote": quote, "prefix": "", "suffix": "", "body": body,
                    "color": "yellow", "style": "highlight", "visibility": "public"}
        try:
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            page.evaluate("([auth, proposal]) => { localStorage.setItem('aipm-anno-auth', JSON.stringify(auth)); localStorage.setItem('aipm-chat-history', JSON.stringify([{role: 'assistant', content: 'Text proposal', proposals: [proposal]}])); }", [session, proposal])
            page.reload(wait_until="load")
            page.locator(".aipm-chat__fab").click()
            with page.expect_event("requestfailed", predicate=lambda r: r.method == "POST" and r.url.endswith("/api/annotations")):
                page.locator(".aipm-chat__proposal-accept").click()
            page.wait_for_function("() => document.querySelector('.aipm-chat__proposal').dataset.state === 'unknown'")
            original = ResponseDropProxy.writes[0]["request"]
            self.assertEqual(original["target"]["selectors"][0]["exact"], quote)
            page.locator(".aipm-anno-entry").click()
            page.locator(".aipm-anno__account").click()
            page.locator(".aipm-anno__logout").click()
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-auth')")
            page.locator(".aipm-chat__fab").click()
            with page.expect_response(lambda r: "/api/auth/github/start" in r.url) as login:
                page.locator(".aipm-chat__proposal-accept").click()
            self.assertEqual(login.value.status, 503)
            page.goto(self.site.base + "/ai/rag/", wait_until="load")
            draft = page.evaluate("() => JSON.parse(localStorage.getItem('aipm-anno-draft'))")
            self.assertTrue(draft["resultUnknown"])
            self.assertEqual(draft["quote"], quote)
            self.assertEqual(draft["selectors"], original["target"]["selectors"])
            self.assertEqual(draft["body"], body)
            self.assertEqual(draft["visibility"], "public")
            self.assertEqual(draft["requestId"], original["requestId"])
            self.assertEqual([w["status"] for w in ResponseDropProxy.writes], [201])
            with urllib.request.urlopen(request) as response:
                renewed = json.load(response)
            page.evaluate("auth => localStorage.setItem('aipm-anno-auth', JSON.stringify(auth))", renewed)
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/annotations")) as retry:
                page.reload(wait_until="load")
            self.assertEqual(retry.value.status, 200)
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-draft')")
            page.reload(wait_until="networkidle")
            self.assertEqual([w["status"] for w in ResponseDropProxy.writes], [201, 200])
            self.assertEqual(ResponseDropProxy.writes[0]["request"], ResponseDropProxy.writes[1]["request"])
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(sum(a["body"] == body for a in json.load(response)["annotations"]), 1)
        finally:
            context.close()
            browser.close()
