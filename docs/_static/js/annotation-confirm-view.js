// Opaque-origin confirmation frame: the recorder can observe the frame element, never its contents.
const DOCUMENT = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'">
<style>body{font:inherit;margin:12px}p{overflow-wrap:anywhere}button{margin-right:8px}</style>
</head><body><section role="region" aria-label="受保护内容">
<strong id="title"></strong><p id="target"></p><p id="body"></p>
<p id="visibility"></p><p id="notice"></p>
<p id="state" role="status"></p>
<button id="agree" type="button" disabled></button>
<button id="retry" type="button" hidden disabled></button>
<button id="cancel" type="button" disabled></button>
<button id="check" type="button" hidden disabled></button>
</section><script>
let channel;
let origin;
addEventListener('message', (event) => {
  if (event.source !== parent || (origin && event.origin !== origin)) return;
  const data = event.data;
  if (!data || data.type !== 'confirmation-view') return;
  if (channel && data.channel !== channel) return;
  if (!channel) { channel = data.channel; origin = event.origin; }
  for (const key of ['title', 'target', 'body', 'visibility', 'notice', 'state', 'agree', 'retry', 'cancel', 'check']) {
    if (Object.hasOwn(data, key)) document.getElementById(key).textContent = data[key];
  }
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
  frame.style.cssText = 'display:block;width:100%;height:300px;border:1px solid currentColor';
  const channel = crypto.randomUUID();
  const view = { title: '确认写入批注建议', target: '', body: '', visibility: '',
    notice: '取消只能停止后续发送；已经到达服务的请求无法撤回。',
    state: '等待同意', agree: '同意并写入', retry: '再次同意原请求并写入',
    cancel: '取消', check: '查询写入结果', agreeDisabled: false,
    retryDisabled: false, retryHidden: true, cancelDisabled: false, checkDisabled: false, checkHidden: true };
  let ready = false;
  function render() {
    if (ready && frame.isConnected) frame.contentWindow.postMessage({ type: 'confirmation-view', channel, ...view }, '*');
  }
  function receive(event) {
    if (!frame.isConnected || event.source !== frame.contentWindow || event.origin !== 'null' ||
        event.data?.type !== 'confirmation-action' || event.data.channel !== channel) return;
    onAction(event.data.action, event.data.trusted);
  }
  window.addEventListener('message', receive);
  const observer = new MutationObserver(() => {
    if (!frame.isConnected) { window.removeEventListener('message', receive); observer.disconnect(); }
  });
  observer.observe(host, { childList: true });

  frame.addEventListener('load', () => { ready = true; render(); });
  frame.srcdoc = DOCUMENT;
  host.append(frame);
  return { frame, update(values) { Object.assign(view, values); render(); },
    dispose() { window.removeEventListener('message', receive); observer.disconnect(); frame.remove(); } };
}
