"""Run article summaries against the built index and the authorized real model."""
from __future__ import annotations

import argparse
import atexit
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import http.server
import json
import os
from pathlib import Path
import subprocess
import shutil
import threading
import time
import urllib.error
import urllib.request

from annotation_service import RealAnnotationApi
from harness import StaticSite, free_port
from model_provider import RealModel

parser = argparse.ArgumentParser()
parser.add_argument('--site', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--cache-from', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
if args.cache_from:
    shutil.copytree(args.cache_from.resolve(), output / 'summaries')
resources = ExitStack()
atexit.register(resources.close)
model = RealModel()
resources.callback(model.close)
site = StaticSite(args.site.resolve())
resources.callback(site.close)
for name in list(os.environ):
    if name.startswith(('ANTHROPIC_', 'AIPM_REAL_', 'TYPESAFE_', 'GITHUB_')):
        del os.environ[name]
os.environ['TMPDIR'] = str(output)
annotation = RealAnnotationApi(root, output, site, free_port())
resources.callback(annotation.close)
port = free_port()
agent_base = f'http://127.0.0.1:{port}'
http_client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
env = {key: os.environ[key] for key in ('PATH', 'HOME')}
env.update(HOST='127.0.0.1', PORT=str(port), SITE_BASE=site.base, ALLOWED_ORIGINS=site.base,
           SEARCH_INDEX_URL=site.base + '/search/search_index.json', MODEL=model.name,
           SUMMARY_MODEL=model.name, SUMMARY_CACHE_DIR=str(output / 'summaries'),
           ANTHROPIC_API_KEY=model.api_key, ANTHROPIC_BASE_URL=model.base,
           MAX_BUDGET_USD='0', DAILY_BUDGET_USD='0', MAX_TURNS='8', RATE_LIMIT_MAX='200',
           ANNOTATION_API_BASE=annotation.base, SCRATCH_DIR=str(output / 'scratch'),
           TMPDIR=str(output), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1')
agent = None
agent_log = None


def stop_agent():
    if agent is not None and agent.poll() is None:
        agent.terminate()
        agent.wait(timeout=15)
    if agent_log is not None:
        agent_log.close()


resources.callback(stop_agent)


def start_agent():
    global agent, agent_log
    agent_log = (output / 'agent.log').open('a', encoding='utf-8')
    agent = subprocess.Popen(['node', '--import', 'tsx', 'src/server.ts'], cwd=root / 'agent-server',
                             env=env, stdout=agent_log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if agent.poll() is not None:
            raise RuntimeError((output / 'agent.log').read_text(encoding='utf-8'))
        try:
            with http_client.open(agent_base + '/healthz', timeout=1):
                return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(.1)
    raise TimeoutError('Agent readiness timeout')


def request(path, **kwargs):
    req = urllib.request.Request(agent_base + path, **kwargs)
    try:
        response = http_client.open(req, timeout=180)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response), dict(response.headers)


start_agent()
site.set_local_api({'agent': agent_base, 'annotation': annotation.base})
results = {}
before = len(model.messages())
for path, code in [('/api/summary', 400), ('/api/summary?page=https://example.com', 400),
                   ('/api/summary?page=/ai/rag/%23other', 400),
                   ('/api/summary?page=/missing-summary-article/', 404)]:
    status, _, _ = request(path)
    assert status == code, (path, status)
assert request('/api/summary?page=/ai/rag/', headers={'Origin': 'https://example.com'})[0] == 403
assert len(model.messages()) == before
results['invalidRequestsBeforeModel'] = True
with ThreadPoolExecutor(max_workers=6) as executor:
    replies = list(executor.map(lambda _: request('/api/summary?page=/ai/rag/'), range(6)))
assert all(reply[0] == 200 for reply in replies), replies
summary = replies[0][1]
assert all(reply[1] == summary for reply in replies)
generated = 0 if args.cache_from else 2
assert len(model.messages()) == before + generated, len(model.messages())
assert len(list((output / 'summaries').glob('*.json'))) == 1
results['concurrentClients'] = 6
results['generationRequests'] = generated
results['warmCache'] = bool(args.cache_from)
results['revision'] = summary['revision']
assert summary['mindmap']['branches'] and summary['reading']['sections']
for entry in model.messages():
    message = entry['body']['messages'][-1]['content']
    assert isinstance(message, str)
    assert len(message) > 12000
    assert '来源说明' in message
if generated:
    results['fullArticleBeyond12000Characters'] = True
stop_agent()
start_agent()
assert request('/api/summary?page=/ai/rag/')[1] == summary
assert len(model.messages()) == before + generated
results['cacheSurvivesRestart'] = True
results['sourceAnchors'] = [item['anchor'] for item in summary['reading']['sections']]
(output / 'http-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
closed = threading.Event()


class Control(http.server.BaseHTTPRequestHandler):
    def log_message(self, *arguments):
        pass

    def do_GET(self):
        payload = json.dumps({'modelRequests': len(model.messages()), 'responses': model.responses,
                              'summaryInFollowup': any(summary['reading']['sections'][-1]['explanation'] in
                                  json.dumps(message['body'], ensure_ascii=False) for message in model.messages()),
                              'summary': summary, 'http': results}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path != '/stop':
            self.send_error(404)
            return
        self.send_response(204)
        self.end_headers()
        closed.set()


control = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Control)
thread = threading.Thread(target=control.serve_forever, daemon=True)
thread.start()
config = {'site': site.base, 'agent': agent_base, 'annotation': annotation.base,
          'control': f'http://127.0.0.1:{control.server_port}'}
(output / 'runtime-config.json').write_text(json.dumps(config), encoding='utf-8')
print(json.dumps({'ready': True, **config, 'checks': results}), flush=True)
closed.wait()
control.shutdown()
control.server_close()
thread.join()
(output / 'model-usage.json').write_text(json.dumps({'requests': len(model.messages()), 'responses': model.responses}), encoding='utf-8')
resources.close()
