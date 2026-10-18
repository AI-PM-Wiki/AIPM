import argparse
from contextlib import ExitStack
import http.server
import json
from pathlib import Path
import shutil
import subprocess
import threading
import time
from urllib.request import urlopen

from harness import StaticSite, AnnotationApi

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--site', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
parser.add_argument('--env-file', type=Path, required=True)
parser.add_argument('--gateway', required=True)
args = parser.parse_args()
base = args.output_dir.resolve()
base.mkdir(parents=True, exist_ok=True)
assert not (base / 'rate-runtime.json').exists(), 'use a fresh output directory'
assert args.gateway.startswith('http://127.0.0.1:'), 'gateway must be loopback'
shutil.copytree(args.site.resolve(), base / 'site')

with ExitStack() as cleanup:
    site = StaticSite(base / 'site')
    cleanup.callback(site.close)
    annotation = AnnotationApi(site)
    cleanup.callback(annotation.close)
    log = cleanup.enter_context((base / 'server.log').open('w'))
    child = subprocess.Popen(['node', str(ROOT / 'test/browser/start_rate_feedback.mjs'),
                              str(base), site.base, str(args.env_file.resolve())],
                             cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    def stop_child():
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=10)
    cleanup.callback(stop_child)
    deadline = time.monotonic() + 20
    while not (base / 'rate-runtime.json').exists():
        assert child.poll() is None, 'rate service exited; inspect server.log'
        assert time.monotonic() < deadline, 'rate service readiness timeout'
        time.sleep(.05)
    agent = json.loads((base / 'rate-runtime.json').read_text())
    site.set_local_api({'agent': agent['base'], 'annotation': annotation.base})
    with urlopen(args.gateway + '/healthz', timeout=5) as response:
        actual = json.load(response)
    assert actual['sent'] > 0 and not actual['halted']
    status = {'limit': actual['sent'], 'sent': actual['sent'], 'halted': False}
    (site.root / '_local-acceptance.json').write_text(json.dumps(status))
    closed = threading.Event()
    class Control(http.server.BaseHTTPRequestHandler):
        def log_message(self, *arguments):
            pass
        def do_POST(self):
            self.send_response(200)
            self.send_header('Content-Length', '0')
            self.end_headers()
            closed.set()
    control = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Control)
    thread = threading.Thread(target=control.serve_forever)
    thread.start()
    config = {'site': site.base, 'agent': agent['base'], 'control': 'http://127.0.0.1:' + str(control.server_port),
              'actualGatewaySent': actual['sent'], 'isolatedAcceptanceCap': actual['sent'],
              'gateway': args.gateway, 'providerAccess': 'disabled: loopback port zero'}
    (base / 'runtime-config.json').write_text(json.dumps(config))
    print(json.dumps({'ready': True, **config}), flush=True)
    closed.wait()
    control.shutdown()
    control.server_close()
    thread.join()
print(json.dumps({'stopped': True}), flush=True)
