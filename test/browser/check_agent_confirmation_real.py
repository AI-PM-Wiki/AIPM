"""Run the full confirmation protocol against the pinned annotation service."""
from __future__ import annotations

import http.client
import http.server
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

import check_agent_confirmation
from playwright.sync_api import sync_playwright

from harness import (
    AGENT_SERVER,
    ANNO_ORIGIN,
    ANNO_PORT,
    ROOT,
    WORK,
    AgentServer,
    Browser,
    StaticSite,
    StubModel,
    assert_no_page_errors,
    build_site,
)


SERVICE_PORT = 18788
SERVICE_ORIGIN = f"http://127.0.0.1:{SERVICE_PORT}"
PINNED_SERVICE_COMMIT = "fd3bc1fc94995c5eed06fec5ffc68b8dacb47c46"


class AnthropicVendorBoundary(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/v1/messages":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        prompt = body["messages"][0]["content"]
        block_ids = re.findall(r"^\[([A-Za-z0-9_-]+)\]$", prompt, re.MULTILINE)
        palette_ids = re.findall(r"^- ([A-Za-z0-9_-]+):", prompt, re.MULTILINE)
        if not block_ids or not palette_ids:
            raise AssertionError(f"highlight judge request did not contain blocks and palette: {body}")
        self.server.owner.record(
            {
                "path": self.path,
                "model": body["model"],
                "blockIds": block_ids,
                "paletteIds": palette_ids,
            }
        )
        result = {
            "results": [
                {"id": block_id, "worth": 0.0, "color": palette_ids[0], "importance": 0}
                for block_id in block_ids
            ]
        }
        response = {
            "id": "msg_browser_vendor_boundary",
            "type": "message",
            "role": "assistant",
            "model": "browser-vendor-boundary",
            "content": [{"type": "text", "text": json.dumps(result)}],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
        payload = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class AnthropicVendorStub:
    """Anthropic HTTP wire stub for the real service's SDK client."""

    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), AnthropicVendorBoundary)
        self.httpd.owner = self
        self.origin = f"http://127.0.0.1:{self.httpd.server_port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def record(self, request: dict):
        with self._lock:
            self.requests.append(request)

    def snapshot(self) -> list[dict]:
        with self._lock:
            return list(self.requests)

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()


class ForwardingAnnotationApi(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def forward(self):
        payload = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        headers = {
            name: value
            for name, value in self.headers.items()
            if name.lower() not in {"host", "connection", "content-length", "transfer-encoding"}
        }
        headers["Host"] = f"127.0.0.1:{SERVICE_PORT}"
        upstream = http.client.HTTPConnection("127.0.0.1", SERVICE_PORT, timeout=20)
        upstream.request(self.command, self.path, body=payload, headers=headers)
        response = upstream.getresponse()
        response_body = response.read()
        parsed_request = json.loads(payload) if payload else None
        parsed_response = json.loads(response_body) if response_body else None
        owner = self.server.owner
        dropped = (
            self.command == "POST"
            and self.path == "/api/annotations"
            and owner.drop_next_write_response
        )
        if dropped:
            owner.drop_next_write_response = False
        event = {
            "method": self.command,
            "path": self.path.split("?", 1)[0],
            "requestTarget": self.path,
            "authorization": self.headers.get("Authorization", ""),
            "permit": self.headers.get("X-Annotation-Permit", ""),
            "permitMatchesIssued": self.headers.get("X-Annotation-Permit", "") in owner.permits
            if self.headers.get("X-Annotation-Permit") else None,
            "body": parsed_request,
            "responseStatus": response.status,
            "response": parsed_response,
            "responseDropped": dropped,
        }
        owner.record(event)
        if self.command == "POST" and self.path in {
            "/api/annotation-permits",
            "/api/reply-permits",
        } and response.status == 201 and parsed_response and parsed_response.get("permit"):
            owner.permits.add(parsed_response["permit"])
        if dropped:
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
        else:
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in {"connection", "transfer-encoding", "content-length"}:
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
        upstream.close()

    do_GET = forward
    do_POST = forward
    do_OPTIONS = forward
    do_DELETE = forward
    do_PATCH = forward
    do_PUT = forward


class RecordedRealAnnotationApi:
    """A request recorder and response-loss proxy; all API behavior stays in the service."""

    def __init__(self):
        self.drop_next_write_response = False
        self.requests: list[dict] = []
        self.archived_requests: list[dict] = []
        self.permits: set[str] = set()
        self._lock = threading.Lock()
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", ANNO_PORT), ForwardingAnnotationApi)
        self.httpd.owner = self
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def reset(self):
        with self._lock:
            self.archived_requests.extend(self.requests)
            self.requests.clear()
            self.permits.clear()
        self.drop_next_write_response = False

    def record(self, event: dict):
        with self._lock:
            self.requests.append(event)

    def writes(self) -> list[dict]:
        return [
            event for event in self.requests
            if event["method"] == "POST" and event["path"] == "/api/annotations"
        ]

    def login(self) -> dict:
        request = urllib.request.Request(
            ANNO_ORIGIN + "/api/auth/dev",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def all_requests(self) -> list[dict]:
        with self._lock:
            return [*self.archived_requests, *self.requests]

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()


class RealAnnotationStack:
    def __init__(self):
        self.runtime = WORK / "real-agent-protocol"
        self.runtime.mkdir(parents=True, exist_ok=True)
        evidence_env = os.environ.get("AIPM_PROTOCOL_EVIDENCE")
        self.evidence = Path(evidence_env) if evidence_env else self.runtime
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.data = Path(tempfile.mkdtemp(dir=self.runtime))
        self.site = StaticSite(build_site(self.runtime / "site"))
        self.api = RecordedRealAnnotationApi()
        self.model = StubModel()
        self.vendor = AnthropicVendorStub()
        self.persisted_snapshots: list[dict] = []
        self.service_log_path = self.evidence / "real-annotation-service.log"
        self.service = None
        self.service_log = None
        self.start_service()
        self.agent = AgentServer(self.site, self.model, max_turns=3)
        self.playwright = sync_playwright().start()

    def start_service(self):
        self.service_log = self.service_log_path.open("a", encoding="utf-8")
        env = dict(
            os.environ,
            HOST="127.0.0.1",
            PORT=str(SERVICE_PORT),
            DEV_AUTH_BYPASS="true",
            DEV_AUTH_LOGIN="browser-protocol-check",
            DATA_DIR=str(self.data),
            SITE_BASE=self.site.base,
            ALLOWED_ORIGINS=self.site.base,
            RETURN_ORIGINS=self.site.base,
            SEARCH_INDEX_URL=self.site.base + "/search/search_index.json",
            TMPDIR=str(self.runtime),
            HIGHLIGHT_JUDGE_PRIMARY="llm",
            HIGHLIGHT_JUDGE_FALLBACK="none",
            ANTHROPIC_API_KEY="browser-vendor-boundary",
            ANTHROPIC_BASE_URL=self.vendor.origin,
            HIGHLIGHT_LLM_MODE="json",
        )
        self.service = subprocess.Popen(
            ["node", "--import", "tsx", "src/server.ts"],
            cwd=ROOT / "annotation-server",
            env=env,
            stdout=self.service_log,
            stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.service.poll() is not None:
                raise AssertionError(self.service_log_path.read_text(encoding="utf-8"))
            try:
                with urllib.request.urlopen(SERVICE_ORIGIN + "/healthz", timeout=1):
                    return
            except urllib.error.URLError:
                time.sleep(0.1)
        raise AssertionError("pinned annotation service did not become ready")

    def stop_service(self):
        if self.service is None:
            return
        self.service.terminate()
        self.service.wait(timeout=15)
        self.service = None
        self.service_log.close()
        self.service_log = None

    def restart_service(self):
        self.stop_service()
        self.start_service()

    def reset_storage(self):
        self.stop_service()
        self.data = Path(tempfile.mkdtemp(dir=self.runtime))
        self.start_service()

    def store_state(self) -> dict:
        return json.loads((self.data / "store.json").read_text(encoding="utf-8"))

    @staticmethod
    def persisted_view(state: dict) -> dict:
        return {
            "annotations": [
                {
                    "id": record["id"],
                    "page": record["page"],
                    "body": record["body"],
                    "visibility": record["visibility"],
                    "replyBodies": [reply["body"] for reply in record["replies"]],
                }
                for record in state["annotations"]
            ],
            "operations": [
                {
                    "requestId": operation["requestId"],
                    "annotationId": operation["annotationId"],
                    "page": operation["page"],
                    "visibility": operation["visibility"],
                    "evidence": operation["evidence"],
                }
                for operation in state["operations"]
            ],
            "sessionRecords": len(state["sessions"]),
        }

    def capture_test_state(self, test_name: str):
        self.persisted_snapshots.append(
            {"test": test_name, **self.persisted_view(self.store_state())}
        )

    def _evidence(self):
        state = self.store_state()
        events = []
        for event in self.api.all_requests():
            response = event["response"] or {}
            request_body = event["body"] or {}
            annotation = response.get("annotation") or {}
            operation = response.get("operation") or {}
            event_view = {
                "method": event["method"],
                "path": event["path"],
                "requestId": request_body.get("requestId")
                or (event["path"].rsplit("/", 1)[-1]
                    if event["path"].startswith("/api/annotation-requests/") else None),
                "annotationId": request_body.get("annotationId") or annotation.get("id")
                or operation.get("annotationId"),
                "visibility": request_body.get("visibility"),
                "body": request_body.get("body"),
                "authenticated": event["authorization"].startswith("Bearer "),
                "permitPresent": bool(event["permit"]),
                "permitMatchesIssued": event["permitMatchesIssued"],
                "status": event["responseStatus"],
                "operationStatus": operation.get("status"),
                "responseDropped": event["responseDropped"],
            }
            if event["path"] in {"/api/annotation-permits", "/api/reply-permits"}:
                event_view["permitIssued"] = bool(response.get("permit"))
            events.append(event_view)
        evidence = {
            "mainCommit": subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True,
                capture_output=True, text=True,
            ).stdout.strip(),
            "annotationServiceCommit": subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=ROOT / "annotation-server", check=True,
                capture_output=True, text=True,
            ).stdout.strip(),
            "modelBoundary": {
                "agent": "StubModel at AgentServer ANTHROPIC_BASE_URL",
                "annotationJudge": "AnthropicVendorStub at annotation-service ANTHROPIC_BASE_URL",
                "realComponents": ["AgentServer", "Anthropic SDK", "annotation service", "annotation tools"],
            },
            "annotationJudgeVendorRequests": self.vendor.snapshot(),
            "events": events,
            "persisted": self.persisted_view(state),
            "persistedByTest": self.persisted_snapshots,
        }
        output = self.evidence / "real-service-protocol.json"
        output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def close(self):
        self.playwright.stop()
        self.agent.close()
        self.model.close()
        self.stop_service()
        self._evidence()
        self.api.close()
        self.vendor.close()
        self.site.close()


class RealServiceConfirmationAcceptance(check_agent_confirmation.AgentConfirmationAcceptance):
    @classmethod
    def setUpClass(cls):
        cls.stack = RealAnnotationStack()
        actual = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT / "annotation-server",
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        if actual != PINNED_SERVICE_COMMIT:
            raise AssertionError(f"annotation service commit {actual} != {PINNED_SERVICE_COMMIT}")

    @classmethod
    def tearDownClass(cls):
        cls.stack.close()

    def setUp(self):
        self.stack.api.reset()
        self.stack.reset_storage()
        self.browser = Browser(self.stack.playwright, self.stack.site.base, also_ours=(ANNO_ORIGIN,))
        self.addCleanup(self.browser.close)
        self.page = self.browser.page
        self.session = self.stack.api.login()
        self.page.add_init_script("window.__aipmAnnoAgentEnabled = true")
        self.page.goto(self.stack.site.base + check_agent_confirmation.PAGE, wait_until="load")
        self.page.evaluate(
            "(raw) => localStorage.setItem('aipm-anno-auth', raw)",
            json.dumps(self.session, separators=(",", ":")),
        )
        self.page.reload(wait_until="load")
        self.page.wait_for_function(
            "() => window.__aipmIntegrityReady === true || window.__aipmIntegrityFailed === true",
            timeout=10000,
        )
        state = self.page.evaluate("""() => ({ ready: window.__aipmIntegrityReady,
            failed: window.__aipmIntegrityFailed, chat: !!window.__aipmChat,
            store: !!window.__aipmAnnoStore, auth: !!window.__aipmAnnoAuth })""")
        self.assertTrue(
            state["ready"] and state["chat"] and state["store"] and state["auth"],
            f"real-service boot state: {state}; page errors: {self.browser.page_errors}; "
            f"console errors: {self.browser.console_errors}",
        )
        self.page.click(".aipm-chat__fab")
        self.page.wait_for_selector(".aipm-chat__input", state="visible")

    def tearDown(self):
        self.stack.capture_test_state(self.id())

    def accepted(self, frame, visibility: str) -> None:
        super().accepted(frame, visibility)
        if visibility == "仅本机":
            return
        write = self.stack.api.writes()[-1]
        annotation_id = write["response"]["annotation"]["id"]
        request_id = write["body"]["requestId"]
        state = self.stack.store_state()
        stored = [record for record in state["annotations"] if record["id"] == annotation_id]
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["visibility"], write["body"]["visibility"])
        self.assertEqual(stored[0]["body"], write["body"]["body"])
        operations = [
            operation for operation in state["operations"]
            if operation["requestId"] == request_id
        ]
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0]["annotationId"], annotation_id)

    def test_reply_permit_and_reply_are_persisted_by_the_real_service(self):
        self.propose("public", "通过真实服务确认的批注")
        frame = self.open_confirmation()
        self.assertEqual(self.stack.api.writes(), [])
        self.assertEqual(self.permit_posts(), [])
        self.accepted(frame, "公开")
        writes = self.stack.api.writes()
        self.assertEqual(len(writes), 1)
        create_response = writes[0]["response"]
        annotation_id = create_response["annotation"]["id"]
        self.assertEqual(writes[0]["responseStatus"], 201)
        self.assertEqual(writes[0]["authorization"], f"Bearer {self.session['token']}")
        self.assertIn(writes[0]["permit"], self.stack.api.permits)
        self.assertEqual(writes[0]["body"]["visibility"], "public")

        self.page.get_by_role("button", name="打开批注面板").click()
        item = self.page.locator(f'.aipm-anno__item[data-anno-id="{annotation_id}"]')
        item.wait_for(state="visible")
        item.locator('button[data-action="reply"]').click()
        reply_box = item.locator(".aipm-anno__replybox")
        reply_box.locator('textarea[aria-label="回复正文"]').fill("经真实服务保存的回复")
        with self.page.expect_response(
            lambda response: response.request.method == "POST"
            and response.url.endswith(f"/api/annotations/{annotation_id}/replies")
        ) as reply_response:
            reply_box.locator("button.aipm-anno__save").click()
        self.assertEqual(reply_response.value.status, 201)
        self.page.get_by_text("经真实服务保存的回复", exact=True).wait_for()

        reply_permits = [
            event for event in self.stack.api.requests
            if event["method"] == "POST" and event["path"] == "/api/reply-permits"
        ]
        reply_writes = [
            event for event in self.stack.api.requests
            if event["method"] == "POST"
            and event["path"] == f"/api/annotations/{annotation_id}/replies"
        ]
        self.assertEqual(len(reply_permits), 1)
        self.assertEqual(len(reply_writes), 1)
        self.assertEqual(reply_permits[0]["responseStatus"], 201)
        self.assertEqual(reply_writes[0]["responseStatus"], 201)
        self.assertEqual(reply_permits[0]["authorization"], f"Bearer {self.session['token']}")
        self.assertEqual(reply_writes[0]["authorization"], f"Bearer {self.session['token']}")
        self.assertIn(reply_writes[0]["permit"], self.stack.api.permits)
        self.assertEqual(reply_permits[0]["body"]["body"], "经真实服务保存的回复")

        state = self.stack.store_state()
        stored = [record for record in state["annotations"] if record["id"] == annotation_id]
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["visibility"], "public")
        self.assertEqual([reply["body"] for reply in stored[0]["replies"]], ["经真实服务保存的回复"])
        self.assertTrue(
            any(operation["annotationId"] == annotation_id for operation in state["operations"])
        )
        assert_no_page_errors(self, self.browser)


if __name__ == "__main__":
    unittest.main()
