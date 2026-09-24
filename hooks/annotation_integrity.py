"""Verify annotation assets before initialization and bind executed bytes to SRI."""

import base64
import hashlib
import json
from pathlib import Path

from jinja2 import pass_context
from markupsafe import Markup
from mkdocs.utils import templates


CLASSIC = {
    "_static/js/annotation-store.js": "annotation",
    "_static/js/annotation-auth.js": "annotation",
    "_static/js/annotation.js": "annotation",
    "_static/js/chat-widget.js": "chat_agent",
}
MODULES = (
    "annotation-agent-entry.js",
    "annotation-consent-core.js",
    "annotation-proposal-confirm.js",
    "annotation-request-status.js",
    "annotation-confirm-view.js",
)


def on_env(env, config, **kwargs):
    extra = config["extra"]
    enabled = {key for key in ("annotation", "chat_agent")
               if (extra.get(key) or {}).get("enabled")}
    if not enabled:
        return env

    docs = Path(config["docs_dir"])
    digests = {}
    for path, owner in CLASSIC.items():
        if owner in enabled:
            digest = hashlib.sha256((docs / path).read_bytes()).digest()
            digests[path] = "sha256-" + base64.b64encode(digest).decode("ascii")

    module_integrity = {}
    if "chat_agent" in enabled:
        version = extra["annotation"]["version"]
        for filename in MODULES:
            path = f"_static/js/{filename}"
            digest = hashlib.sha256((docs / path).read_bytes()).digest()
            module_integrity[f"/{path}?v={version}"] = (
                "sha256-" + base64.b64encode(digest).decode("ascii"))

    metadata = json.dumps({"integrity": module_integrity}, separators=(",", ":"))
    seen_pages = set()

    @pass_context
    def protected_script(context, script):
        path = str(script).split("?", 1)[0]
        if path not in digests:
            return templates.script_tag_filter(context, script)
        page_key = id(context.get("page"))
        if page_key in seen_pages:
            return Markup("")
        seen_pages.add(page_key)
        scripts = [{"url": templates.url_filter(context, str(entry)),
                    "integrity": digests[str(entry).split("?", 1)[0]]}
                   for entry in config["extra_javascript"]
                   if str(entry).split("?", 1)[0] in digests]
        modules = [{"url": url, "integrity": integrity}
                   for url, integrity in module_integrity.items()]
        plan = json.dumps({"scripts": scripts, "modules": modules}, separators=(",", ":"))
        importmap = Markup('<script type="importmap">') + Markup(metadata) + Markup('</script>')
        loader = Markup('''<script>
(function () {
  'use strict';
  const plan = ''') + Markup(plan) + Markup(''';
  function failure() {
    if (window.__aipmIntegrityFailed) return;
    window.__aipmIntegrityFailed = true;
    const banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.textContent = '批注资源未通过完整性校验，请刷新页面重试。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '刷新页面';
    retry.addEventListener('click', () => location.reload());
    banner.append(retry);
    document.body.append(banner);
  }
  window.addEventListener('error', event => {
    if (event.target instanceof HTMLScriptElement && event.target.integrity) failure();
  }, true);
  async function verify(resource) {
    const response = await fetch(resource.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('annotation asset unavailable: ' + resource.url);
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    if ('sha256-' + hash !== resource.integrity) {
      throw new Error('annotation asset integrity mismatch: ' + resource.url);
    }
  }
  async function load() {
    await Promise.all([...plan.scripts, ...plan.modules].map(verify));
    await Promise.all(plan.modules.map(resource => new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = resource.url;
      link.integrity = resource.integrity;
      link.onload = resolve;
      link.onerror = () => reject(new Error('annotation module integrity failure'));
      document.head.append(link);
    })));
    for (const resource of plan.scripts) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = resource.url;
        script.integrity = resource.integrity;
        script.onload = resolve;
        script.onerror = () => reject(new Error('annotation script integrity failure'));
        document.body.append(script);
      });
    }
  }
  load().catch(failure);
})();
</script>''')
        return importmap + loader

    env.filters["script_tag"] = protected_script
    return env
