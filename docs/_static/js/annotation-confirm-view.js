// Opaque-origin confirmation frame: the recorder can observe the frame element, never its contents.
const DOCUMENT = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:light;--surface:#fff;--text:#202124;--muted:#62666d;--line:#d6d9df;--accent:#34408f;--on-accent:#fff;--focus:#526cfe;--success:#1b5e20;--warning:#805b00;--error:#b3261e}
:root[data-theme="dark"]{color-scheme:dark;--success:#a5d6a7;--warning:#ffe082;--error:#ffb4ab}
*{box-sizing:border-box}body{margin:0;color:var(--text);background:var(--surface);font:16px/1.6 system-ui,sans-serif}
section{padding:16px;display:grid;gap:14px;min-width:0}h2{font-size:1em;line-height:1.4;margin:0;font-weight:650}
.details{display:grid;align-content:start;gap:12px;min-height:0;max-height:320px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.details:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}.field{min-width:0}.label{display:block;font-size:.75em;color:var(--muted);margin-bottom:4px}
p{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.body{padding:12px;border:1px solid var(--line);border-radius:8px}
.visibility{font-weight:600}.notice{font-size:.8em;color:var(--muted)}
.state{font-size:.875em;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:color-mix(in srgb,var(--text) 4%,var(--surface))}
section[data-status="success"] .state{color:var(--success);border-color:currentColor}
section[data-status="warning"] .state{color:var(--warning);border-color:currentColor}
section[data-status="error"] .state{color:var(--error);border-color:currentColor}
section[data-status="loading"] .state::before{content:"";display:inline-block;width:12px;height:12px;margin-right:8px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
.actions{display:flex;flex-wrap:wrap;gap:8px}button{min-height:44px;min-width:0;padding:9px 14px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--text);font-family:inherit;font-size:.875em;font-weight:600;line-height:1.4;cursor:pointer;overflow-wrap:anywhere}
#agree,#retry{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}button:hover:not(:disabled){filter:brightness(.94)}button:disabled{opacity:.5;cursor:default}
button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}button[hidden]{display:none}
@media(max-width:260px){.actions button{flex:1 1 100%}section{padding:12px}}
@media(prefers-reduced-motion:reduce){section[data-status="loading"] .state::before{animation:none}}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body><section role="region" aria-label="受保护内容">
<h2 id="title"></h2><div id="details" class="details" tabindex="0" role="region" aria-label="批注建议正文，可使用方向键浏览"><div class="field"><span class="label">文章与引文</span><p id="target"></p></div>
<div class="field body"><span class="label">批注正文</span><p id="body"></p></div>
<div class="field visibility"><span class="label">可见范围已锁定</span><p id="visibility"></p></div></div><p id="notice" class="notice"></p>
<p id="state" class="state" role="status" aria-live="polite" aria-atomic="true"></p><div class="actions">
<button id="agree" type="button" disabled></button>
<button id="retry" type="button" hidden disabled></button>
<button id="cancel" type="button" disabled></button>
<button id="check" type="button" hidden disabled></button>
</div></section><script>
let channel;
let origin;
function layout(){if(channel)parent.postMessage({type:'confirmation-layout',channel,height:Math.ceil(document.querySelector('section').getBoundingClientRect().height)},origin)}
new ResizeObserver(layout).observe(document.querySelector('section'));
addEventListener('message', (event) => {
  if (event.source !== parent || (origin && event.origin !== origin)) return;
  const data = event.data;
  if (!data || data.type !== 'confirmation-view') return;
  if (channel && data.channel !== channel) return;
  if (!channel) { channel = data.channel; origin = event.origin; }
  if(data.theme){
    document.documentElement.dataset.theme=data.theme.scheme;
    for(const key of ['surface','text','muted','line','accent','focus']){
      if(CSS.supports('color',data.theme[key]))document.documentElement.style.setProperty('--'+key,data.theme[key]);
    }
    document.body.style.fontFamily=data.theme.fontFamily;
    document.body.style.fontSize=data.theme.fontSize;
  }
  document.querySelector('section').dataset.status=data.status;
  document.querySelector('section').setAttribute('aria-busy',String(data.status==='loading'));
  document.querySelector('#state').setAttribute('role',data.status==='error'?'alert':'status');
  for (const key of ['title', 'target', 'body', 'visibility', 'notice', 'state', 'agree', 'retry', 'cancel', 'check']) {
    if (Object.hasOwn(data, key)) document.getElementById(key).textContent = data[key];
  }
  requestAnimationFrame(layout);
  for (const key of ['agree', 'retry', 'cancel', 'check']) {
    if (Object.hasOwn(data, key + 'Disabled')) document.getElementById(key).disabled = data[key + 'Disabled'];
    if (Object.hasOwn(data, key + 'Hidden')) document.getElementById(key).hidden = data[key + 'Hidden'];
  }
});
for (const action of ['agree', 'retry', 'cancel', 'check']) {
  document.getElementById(action).addEventListener('click', (event) => {
    parent.postMessage({ type: 'confirmation-action', channel, action, trusted: event.isTrusted }, origin);
  });
}
</script></body></html>`;

export function createConfirmationView(host, onAction) {
  const frame = document.createElement('iframe');
  frame.title = '受保护内容';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.className = 'aipm-confirmation-frame rr-block';
  frame.setAttribute('scrolling', 'no');
  frame.style.cssText = 'display:block;box-sizing:border-box;width:100%;min-width:0;height:260px;border:0;border-radius:8px';
  const channel = crypto.randomUUID();
  const view = { title: '确认写入批注建议', target: '', body: '', visibility: '',
    notice: '取消只能停止后续发送；已经到达服务的请求无法撤回。',
    state: '等待同意', status: 'pending', agree: '同意并写入', retry: '再次同意原请求并写入',
    cancel: '取消', check: '查询写入结果', agreeDisabled: false,
    retryDisabled: false, retryHidden: true, cancelDisabled: false, checkDisabled: false, checkHidden: true };
  let ready = false;
  function theme() {
    const styles = getComputedStyle(host);
    const scheme = document.body.getAttribute('data-md-color-scheme') === 'slate' ? 'dark' : 'light';
    const result = { scheme, fontFamily: styles.fontFamily, fontSize: styles.fontSize };
    for (const [key, variable] of Object.entries({ surface: '--md-default-bg-color', text: '--md-default-fg-color',
      muted: '--md-default-fg-color--light', line: '--md-default-fg-color--lightest',
      accent: '--md-primary-fg-color--dark', focus: '--md-accent-fg-color' })) {
      result[key] = styles.getPropertyValue(variable).trim();
    }
    frame.style.backgroundColor = result.surface;
    frame.style.colorScheme = scheme;
    return result;
  }
  function render() {
    if (ready && frame.isConnected) frame.contentWindow.postMessage({ type: 'confirmation-view', channel, ...view, theme: theme() }, '*');
  }
  function receive(event) {
    if (!frame.isConnected || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.channel !== channel) return;
    if (event.data.type === 'confirmation-layout') {
      if (Number.isSafeInteger(event.data.height) && event.data.height > 0 && event.data.height <= 24000) {
        frame.style.height = event.data.height + 'px';
      }
      return;
    }
    if (event.data.type !== 'confirmation-action') return;
    onAction(event.data.action, event.data.trusted);
  }
  window.addEventListener('message', receive);
  const themeObserver = new MutationObserver(render);
  for (const element of [document.documentElement, document.body]) themeObserver.observe(element,
    { attributes: true, attributeFilter: ['data-md-color-scheme', 'style', 'class'] });
  const observer = new MutationObserver(() => {
    if (!frame.isConnected) { window.removeEventListener('message', receive); observer.disconnect(); themeObserver.disconnect(); }
  });
  observer.observe(host, { childList: true });

  frame.addEventListener('load', () => { ready = true; render(); });
  frame.srcdoc = DOCUMENT;
  host.append(frame);
  return { frame, update(values) { Object.assign(view, values); host.dataset.state = view.status;
    host.setAttribute('aria-busy', String(view.status === 'loading')); render(); },
    dispose() { window.removeEventListener('message', receive); observer.disconnect(); themeObserver.disconnect(); frame.remove(); } };
}
