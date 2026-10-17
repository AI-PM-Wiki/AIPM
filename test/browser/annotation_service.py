"""Run the pinned annotation service and record its actual HTTP traffic."""
from __future__ import annotations

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
from urllib.parse import parse_qs, urlsplit
import urllib.error
import urllib.request


class RealAnnotationApi:
    def __init__(self, root: Path, work: Path, site, port: int):
        self.root = root
        self.site = site
        self.work = work / "annotation-api"
        self.work.mkdir(parents=True, exist_ok=True)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", int(os.environ.get("AIPM_TEST_ANNOTATION_SERVICE_PORT", "0"))))
            self.service_port = listener.getsockname()[1]
        self.port = port
        self.requests: list[dict] = []
        self.drop_next_write_response = False
        self.service = None
        self.log = None
        self.reset()
        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), _AnnotationForwarder)
        self._httpd.owner = self
        self.thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def stored(self) -> list[dict]:
        return json.loads((self.data / "store.json").read_text(encoding="utf-8"))["annotations"]

    def reset(self) -> None:
        self.stop_service()
        self.data = Path(tempfile.mkdtemp(dir=self.work))
        self.log = (self.data / "service.log").open("w", encoding="utf-8")
        env = dict(os.environ, HOST="127.0.0.1", PORT=str(self.service_port),
                   DATA_DIR=str(self.data), DEV_AUTH_BYPASS="true", DEV_AUTH_LOGIN="browser-check",
                   SITE_BASE=self.site.base, ALLOWED_ORIGINS=self.site.base, RETURN_ORIGINS=self.site.base,
                   SEARCH_INDEX_URL=self.site.base + "/search/search_index.json",
                   TMPDIR=str(self.work), HIGHLIGHT_JUDGE_PRIMARY="llm", HIGHLIGHT_JUDGE_FALLBACK="none")
        self.service = subprocess.Popen(["node", "--import", "tsx", "src/server.ts"],
                                        cwd=self.root / "annotation-server", env=env,
                                        stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.service.poll() is not None:
                raise RuntimeError((self.data / "service.log").read_text(encoding="utf-8"))
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.service_port}/healthz", timeout=1):
                    break
            except urllib.error.URLError:
                time.sleep(0.1)
        else:
            raise RuntimeError("annotation service readiness timeout")
        self.requests.clear()
        self.drop_next_write_response = False

    def login(self) -> dict:
        request = urllib.request.Request(self.base + "/api/auth/dev", data=b"{}",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def writes(self) -> list[dict]:
        return [request for request in self.requests
                if request["method"] == "POST" and request["path"] == "/api/annotations"]

    def logins(self) -> list[dict]:
        return [request for request in self.requests if request["path"] == "/api/auth/github/start"]

    def stop_service(self) -> None:
        if self.service is not None:
            self.service.terminate()
            self.service.wait(timeout=15)
            self.log.close()
            self.service = None

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self.thread.join()
        self.stop_service()


class _AnnotationForwarder(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def forward(self):
        owner = self.server.owner
        payload = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        headers = {name: value for name, value in self.headers.items()
                   if name.lower() not in {"host", "connection", "content-length", "transfer-encoding"}}
        upstream = http.client.HTTPConnection("127.0.0.1", owner.service_port, timeout=30)
        upstream.request(self.command, self.path, payload, headers)
        response = upstream.getresponse()
        body = response.read()
        parts = urlsplit(self.path)
        owner.requests.append({"method": self.command, "path": parts.path,
                               "params": {key: values[0] for key, values in parse_qs(parts.query).items()},
                               "body": json.loads(payload) if payload else {},
                               "authorization": self.headers.get("Authorization", ""),
                               "permit": self.headers.get("X-Annotation-Permit", ""),
                               "status": response.status})
        if self.command == "POST" and parts.path == "/api/annotations" and owner.drop_next_write_response:
            owner.drop_next_write_response = False
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
        else:
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in {"connection", "content-length", "transfer-encoding"}:
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        upstream.close()

    do_GET = forward
    do_POST = forward
    do_PATCH = forward
    do_DELETE = forward
    do_OPTIONS = forward
