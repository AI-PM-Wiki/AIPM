"""Forward model traffic to an explicitly authorized HTTPS provider."""
from __future__ import annotations

import http.client
import http.server
import json
import os
import threading
from urllib.parse import urlsplit


class RealModel:
    def __init__(self):
        required = ("AIPM_REAL_MODEL_API_KEY", "AIPM_REAL_MODEL_BASE_URL", "AIPM_REAL_MODEL_NAME")
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise RuntimeError("authorized real model configuration missing: " + ", ".join(missing))
        self.api_key = os.environ[required[0]]
        self.upstream = urlsplit(os.environ[required[1]])
        if self.upstream.scheme != "https" or not self.upstream.hostname or self.upstream.username or self.upstream.password:
            raise ValueError("real model provider must be an HTTPS URL without credentials")
        if self.upstream.query or self.upstream.fragment:
            raise ValueError("real model provider URL must not have a query or fragment")
        self.name = os.environ[required[2]]
        self._reject_images = False
        self.requests: list[dict] = []
        self.responses: list[dict] = []
        self.instruction = ""
        port = int(os.environ.get("AIPM_TEST_MODEL_PROXY_PORT", "0"))
        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), _ModelForwarder)
        self._httpd.owner = self
        self.port = self._httpd.server_port
        self.thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def messages(self) -> list[dict]:
        return [request for request in self.requests if request["path"].endswith("/messages")]

    @property
    def reject_images(self) -> bool:
        return self._reject_images

    @reject_images.setter
    def reject_images(self, enabled: bool) -> None:
        if enabled and not os.environ.get("AIPM_REAL_TEXT_ONLY_MODEL"):
            raise RuntimeError("authorized image rejection model missing: AIPM_REAL_TEXT_ONLY_MODEL")
        self._reject_images = enabled

    def set_script(self, script: list[dict]) -> None:
        calls = [call for turn in script for call in turn.get("tools", [])]
        self.instruction = "请调用以下工具并使用给定参数：" + json.dumps(calls, ensure_ascii=False)

    def snapshot(self) -> list[dict]:
        return list(self.requests)

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self.thread.join()


class _ModelForwarder(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        owner = self.server.owner
        payload = self.rfile.read(int(self.headers["Content-Length"]))
        body = json.loads(payload)
        if owner.reject_images and "model" in body:
            body["model"] = os.environ["AIPM_REAL_TEXT_ONLY_MODEL"]
            payload = json.dumps(body).encode("utf-8")
        owner.requests.append({"path": self.path, "body": body})
        headers = {
            name: value for name, value in self.headers.items()
            if name.lower() not in {"host", "connection", "content-length", "transfer-encoding", "authorization", "x-api-key"}
        }
        headers["x-api-key"] = owner.api_key
        upstream = http.client.HTTPSConnection(owner.upstream.hostname, owner.upstream.port, timeout=180)
        path = owner.upstream.path.rstrip("/") + self.path
        upstream.request("POST", path, payload, headers)
        response = upstream.getresponse()
        owner.responses.append({"status": response.status,
                                "requestId": response.getheader("request-id") or response.getheader("x-request-id")})
        self.send_response(response.status)
        for name, value in response.getheaders():
            if name.lower() not in {"connection", "transfer-encoding", "content-length"}:
                self.send_header(name, value)
        self.send_header("Connection", "close")
        self.end_headers()
        while chunk := response.read1(65536):
            self.wfile.write(chunk)
            self.wfile.flush()
        self.close_connection = True
        upstream.close()
