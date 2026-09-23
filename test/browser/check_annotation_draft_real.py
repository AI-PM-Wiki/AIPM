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
        request = urllib.request.Request("http://127.0.0.1:18788/api/auth/dev",
                                         data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            session = json.load(response)
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
            page.reload(wait_until="load")
            page.wait_for_function("() => JSON.parse(localStorage.getItem('aipm-anno-draft') || '{}').resultUnknown === true")
            self.assertTrue(page.locator(".aipm-anno__visbtn").is_disabled())
            page.locator(".aipm-anno__save").click()
            page.wait_for_function("() => !localStorage.getItem('aipm-anno-draft')")
            self.assertEqual([write["status"] for write in ResponseDropProxy.writes], [201, 200, 200])
            self.assertEqual([write["request"] for write in ResponseDropProxy.writes],
                             [ResponseDropProxy.writes[0]["request"]] * 3)
            state = json.loads((Path(self.data) / "store.json").read_text())
            self.assertEqual(len(state["annotations"]), 1)
            self.stop_service()
            self.start_service()
            with urllib.request.urlopen("http://127.0.0.1:18788/api/annotations?page=/ai/rag/&scope=public") as response:
                self.assertEqual(len(json.load(response)["annotations"]), 1)
        finally:
            context.close()
            browser.close()
