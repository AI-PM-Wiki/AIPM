"""Serve the built site and isolated real services for review acceptance."""
from __future__ import annotations

import argparse
import atexit
from contextlib import ExitStack
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup

from annotation_service import RealAnnotationApi
from harness import StaticSite, _Handler, free_port
from model_provider import RealModel


parser = argparse.ArgumentParser()
parser.add_argument("--site", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--model", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
resources = ExitStack()
atexit.register(resources.close)
model = RealModel() if args.model else None
if model is not None:
    resources.callback(model.close)
for name in list(os.environ):
    if name.startswith(("AIPM_REAL_", "ANTHROPIC_", "TYPESAFE_", "GITHUB_", "JEVE_")):
        del os.environ[name]
os.environ.update(WRITE_QUOTA_MAX="1", WRITE_QUOTA_WINDOW_MS="3000", ADMIN_LOGINS="browser-check",
                  TMPDIR=str(output))
site = StaticSite(args.site.resolve())
resources.callback(site.close)
api = RealAnnotationApi(root, output, site, free_port())
resources.callback(api.close)
release_image = threading.Event()
image_started = threading.Event()
closed = threading.Event()
image_path = "/job/jd-breakdowns/images/bytedance_developer_ai_pm_jd_01.png"


class Handler(_Handler):
    def send_head(self):
        if self.path.split("?", 1)[0] == image_path and self.headers.get("X-AIPM-Source-Fetch") == "chart-context":
            image_started.set()
            if not release_image.wait(20):
                raise TimeoutError("image release not received")
        return super().send_head()


site.httpd.RequestHandlerClass = Handler
for slug in ("review-acceptance", "review-next"):
    document = BeautifulSoup((site.root / "ai/rag/index.html").read_text(encoding="utf-8"), "html.parser")
    article = document.select_one(".md-content__inner")
    paragraph = document.new_tag("p", id="review-paragraph")
    paragraph.string = "检索增强生成通过检索外部资料，为语言模型提供可核对的上下文。批注用于记录定义、来源和适用条件。"
    article.insert(0, paragraph)
    image = document.new_tag("img", src=image_path, alt="招聘岗位截图")
    article.insert(1, image)
    link = document.new_tag("a", href="/ai/review-next/", id="review-navigation")
    link.string = "下一篇验收文章"
    article.insert(2, link)
    destination = site.root / "ai" / slug / "index.html"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(str(document), encoding="utf-8")

sitemap_path = site.root / "sitemap.xml"
sitemap = ET.parse(sitemap_path)
namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
for location in sitemap.iterfind(f".//{{{namespace}}}loc"):
    location.text = site.base + urlsplit(location.text).path
for slug in ("review-acceptance", "review-next"):
    entry = ET.SubElement(sitemap.getroot(), f"{{{namespace}}}url")
    ET.SubElement(entry, f"{{{namespace}}}loc").text = site.base + f"/ai/{slug}/"
ET.register_namespace("", namespace)
sitemap.write(sitemap_path, encoding="utf-8", xml_declaration=True)

agent = None
agent_log = None
agent_base = site.base
if model is not None:
    port = free_port()
    agent_base = f"http://127.0.0.1:{port}"
    agent_log = (output / "agent.log").open("w", encoding="utf-8")
    env = {key: os.environ[key] for key in ("PATH", "HOME")}
    env.update(HOST="127.0.0.1", PORT=str(port), SITE_BASE=site.base, ALLOWED_ORIGINS=site.base,
               SEARCH_INDEX_URL=site.base + "/search/search_index.json", MODEL=model.name,
               ANTHROPIC_API_KEY=model.api_key, ANTHROPIC_BASE_URL=model.base,
               SYSTEM_PROMPT_UPDATE="in-history", MAX_BUDGET_USD="0", MAX_TURNS="0", DAILY_BUDGET_USD="0",
               ANNOTATION_API_BASE=api.base, SCRATCH_DIR=str(output / "agent-scratch"), TMPDIR=str(output),
               CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1")
    agent = subprocess.Popen(["node", "--import", "tsx", "src/server.ts"], cwd=root / "agent-server",
                             env=env, stdout=agent_log, stderr=subprocess.STDOUT)

    def close_agent():
        agent.terminate()
        agent.wait(timeout=15)
        agent_log.close()

    resources.callback(close_agent)
    deadline = time.monotonic() + 30
    health_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.monotonic() < deadline:
        if agent.poll() is not None:
            raise RuntimeError((output / "agent.log").read_text(encoding="utf-8"))
        try:
            with health_http.open(agent_base + "/healthz", timeout=1):
                break
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.1)
    else:
        raise TimeoutError("Agent readiness timeout")
site.set_local_api({"agent": agent_base, "annotation": api.base})


def state():
    store = api.data / "store.json"
    return {"requests": [{key: row[key] for key in ("method", "path", "status", "body")}
                         for row in api.requests],
            "annotations": api.stored if store.exists() else [], "imageStarted": image_started.is_set(),
            "modelRequests": len(model.messages()) if model is not None else 0,
            "modelResponses": model.responses if model is not None else []}


class Control(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = json.dumps(state(), ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/reset":
            api.reset()
        elif self.path == "/drop-write-response":
            api.drop_next_write_response = True
        elif self.path == "/release-image":
            release_image.set()
        elif self.path == "/stop":
            closed.set()
        else:
            self.send_error(404)
            return
        self.send_response(204)
        self.end_headers()


control = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Control)
thread = threading.Thread(target=control.serve_forever)
thread.start()


def close_control():
    control.shutdown()
    control.server_close()
    thread.join()


resources.callback(close_control)
config = {"site": site.base, "annotation": api.base, "agent": agent_base,
          "control": f"http://127.0.0.1:{control.server_port}", "modelEnabled": model is not None}
(output / "runtime.json").write_text(json.dumps(config), encoding="utf-8")
print(json.dumps({"ready": True, **config}), flush=True)
try:
    closed.wait()
finally:
    release_image.set()
    (output / "service-results.json").write_text(json.dumps(state(), ensure_ascii=False, indent=2), encoding="utf-8")
    if model is not None:
        (output / "model-requests.json").write_text(json.dumps(model.messages(), ensure_ascii=False, indent=2), encoding="utf-8")
    resources.close()
    atexit.unregister(resources.close)
print(json.dumps({"closed": True}), flush=True)
