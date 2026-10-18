import argparse
import http.server
import json
import os
from pathlib import Path
import sys
import threading

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("--site", type=Path, required=True)
parser.add_argument("--output-dir", type=Path, required=True)
parser.add_argument("--protected-pid", type=int)
args = parser.parse_args()
BASE = args.output_dir.resolve()
BASE.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "test/browser"))
from harness import StaticSite, AnnotationApi

for name in list(os.environ):
    if name.startswith(("AIPM_REAL_", "ANTHROPIC_", "TYPESAFE_", "GITHUB_CLIENT_")):
        del os.environ[name]
os.environ["TMPDIR"] = str(BASE / "local-tmp")
site = StaticSite(args.site.resolve())
api = AnnotationApi(site)
closed = threading.Event()
LOCAL_BODY = "Local confirmation timing regression"


class Control(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        data = {
            "requests": [{"method": row["method"], "path": row["path"], "status": row["status"]}
                         for row in api.requests],
            "writes": len(api.writes()),
            "permitRequests": sum("permit" in row["path"] for row in api.requests),
            "annotationMutations": sum(
                row["method"] in {"POST", "PUT", "PATCH", "DELETE"} and
                row["path"].startswith(("/api/annotations", "/api/annotation-permits", "/api/reply-permits"))
                for row in api.requests),
            "localBodyRequests": sum(LOCAL_BODY in json.dumps(row["body"]) for row in api.requests),
        }
        payload = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()
        closed.set()


control = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Control)
thread = threading.Thread(target=control.serve_forever)
thread.start()
config = {"site": site.base, "annotation": api.base,
          "agent": f"http://127.0.0.1:{control.server_port}",
          "control": f"http://127.0.0.1:{control.server_port}",
          "annotationPid": api.service.pid}
site.set_local_api({"agent": config["agent"], "annotation": config["annotation"]})
(BASE / "runtime-config.json").write_text(json.dumps(config), encoding="utf-8")
print(json.dumps({"ready": True, **config}), flush=True)
closed.wait()
assert api.service.pid != args.protected_pid
api.close()
site.close()
control.shutdown()
control.server_close()
thread.join()
print(json.dumps({"stopped": True}), flush=True)
