import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import threading

from harness import StaticSite, _Handler
from annotation_service import RealAnnotationApi

parser = argparse.ArgumentParser()
parser.add_argument('--site', type=Path, required=True)
parser.add_argument('--recording', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
for key in list(os.environ):
    if key.startswith(('ANTHROPIC_', 'TYPESAFE_', 'JEVE_', 'GITHUB_', 'AIPM_REAL_')) or key == 'API_KEY':
        del os.environ[key]
os.environ['TMPDIR'] = str(output)
payload = args.recording.read_bytes()
replays = []
stopped = threading.Event()


class Handler(_Handler):
    def end_headers(self):
        self.send_header('Content-Security-Policy',
                         "default-src 'self' data: blob:; connect-src 'self' " + api.base +
                         "; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'none'")
        super().end_headers()

    def do_POST(self):
        assert self.path == '/api/chat'
        self.rfile.read(int(self.headers.get('Content-Length', '0')))
        replays.append({'source': 'recorded application SSE', 'sha256': hashlib.sha256(payload).hexdigest()})
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class Control(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = json.dumps({'replays': replays, 'modelRequests': 0,
                           'requests': [{'method': row['method'], 'path': row['path'], 'status': row['status']}
                                        for row in api.requests],
                           'annotations': api.stored}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        assert self.path == '/stop'
        self.send_response(200)
        self.send_header('Content-Length', '0')
        self.end_headers()
        stopped.set()


site = StaticSite(args.site.resolve())
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    api_port = listener.getsockname()[1]
api = RealAnnotationApi(root, output, site, api_port)
site.httpd.RequestHandlerClass = Handler
site.set_local_api({'agent': site.base, 'annotation': api.base}, enable_agent_confirmation=True)
control = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Control)
thread = threading.Thread(target=control.serve_forever)
thread.start()
config = {'site': site.base, 'annotation': api.base,
          'control': f'http://127.0.0.1:{control.server_port}'}
(output / 'runtime.json').write_text(json.dumps(config))
print(json.dumps({'ready': True, **config}), flush=True)
try:
    stopped.wait()
finally:
    api.close()
    site.close()
    control.shutdown()
    control.server_close()
    thread.join()
print(json.dumps({'closed': True, 'modelRequests': 0}), flush=True)
