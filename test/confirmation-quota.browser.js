const assert = (condition, message) => { if (!condition) throw new Error(message); };
const task = await taskSpace('AIPM isolated quota regression');
const page = task.page('p1');
await page.cdp('Network.enable');
await page.cdp('Network.setBypassServiceWorker', { bypass: true });
await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
await page.goto(`http://127.0.0.1:18981/review/fixture/?quota=${crypto.randomUUID()}`);
await page.evaluate(async () => {
  const store = window.__aipmAnnoStore;
  const auth = window.__aipmAnnoAuth;
  const login = await store.request('/api/auth/dev', { method: 'POST' });
  if (!login.ok) throw new Error('real developer authentication failed');
  localStorage.setItem('aipm-anno-auth', JSON.stringify(login.body));
  await auth.ready();
  window.currentConfirmation.frame.remove();
});
const fill = () => page.evaluate(() => {
  const key = 'quota-fill';
  const used = Object.keys(localStorage).reduce((count, item) =>
    count + item.length + localStorage.getItem(item).length, 0);
  localStorage.setItem(key, 'x'.repeat(5242880 - used - key.length));
  return localStorage.getItem(key).length;
});
const release = () => page.evaluate(() => localStorage.removeItem('quota-fill'));
const inspect = () => page.evaluate(() => {
  const { core, proposal, session, identity } = window.currentConfirmation;
  const record = core.inspect({ identity, session, requestId: proposal.requestId });
  return { requestId: proposal.requestId, record, posts: performance.getEntriesByType('resource')
    .filter((item) => item.name.endsWith('/api/annotations')).length };
});
const receipt = (id) => page.evaluate((requestId) => window.__aipmAnnoStore.request(
  `/api/annotation-requests/${requestId}`, { token: window.__aipmAnnoAuth.token() }), id);
const prepare = () => page.evaluate(() => {
  window.currentConfirmation.frame.remove();
  return window.prepareConfirmation('private');
});
const network = (latency) => page.cdp('Network.emulateNetworkConditions', {
  offline: false, latency, downloadThroughput: -1, uploadThroughput: -1
});
const unknown = () => page.waitForSelector('text="结果未知；只能查询原请求，不能再次提交。"');

const before = await page.evaluate(() => window.prepareConfirmation('private'));
await page.waitForSelector('text="同意并写入"');
await fill();
await page.click('text="同意并写入"', { label: 'approve when storage is full' });
await unknown();
const blocked = await inspect();
assert(blocked.requestId === before.requestId && blocked.record === null && blocked.posts === 0,
  'failed confirmation never dispatched a write');
assert((await receipt(before.requestId)).status === 404, 'no server operation before persistence');
await release();

const after = await prepare();
await page.waitForSelector('text="同意并写入"');
await network(2500);
await page.click('text="同意并写入"', { label: 'approve delayed original write' });
await page.waitForFunction(() => {
  const { core, identity, session, proposal } = window.currentConfirmation;
  return core.inspect({ identity, session, requestId: proposal.requestId })?.status === 'executing';
});
await fill();
await unknown();
const pending = await inspect();
assert(pending.requestId === after.requestId && pending.record.status === 'executing' &&
  pending.record.permits.length === 1 && pending.record.permits[0].used && pending.posts === 1,
  'unknown outcome retains the original consumed request');
await network(0);
const saved = await receipt(after.requestId);
assert(saved.status === 200 && saved.body.operation.status === 'succeeded', 'real write persisted');
await release();
await page.click('text="查询写入结果"', { label: 'read original result after quota release' });
await page.waitForFunction(() => {
  const { core, identity, session, proposal } = window.currentConfirmation;
  return core.inspect({ identity, session, requestId: proposal.requestId })?.status === 'succeeded';
});
const restored = await inspect();
assert(restored.record.annotationId === saved.body.operation.annotationId &&
  restored.record.permits[0].used && restored.posts === 1, 'read-only query restores success');

const refreshed = await prepare();
await page.waitForSelector('text="同意并写入"');
await network(2500);
await page.click('text="同意并写入"', { label: 'approve refresh recovery request' });
await page.waitForFunction(() => {
  const { core, identity, session, proposal } = window.currentConfirmation;
  return core.inspect({ identity, session, requestId: proposal.requestId })?.status === 'executing';
});
await fill();
await unknown();
const stillPending = await inspect();
assert(stillPending.requestId === refreshed.requestId && stillPending.record.permits[0].used,
  'original grant remains consumed');
await network(0);
const persisted = await receipt(refreshed.requestId);
assert(persisted.status === 200, 'request persisted before refresh');
await release();
await page.goto(`http://127.0.0.1:18981/review/fixture/?refresh=${crypto.randomUUID()}`);
const recovery = await page.evaluate(async (requestId) => {
  await window.__aipmAnnoAuth.ready();
  const { createAnnotationRequestStatus } = await import('/_static/js/annotation-request-status.js');
  const core = window.currentConfirmation.core;
  const prior = core.inspectOwned({ identity: String(window.__aipmAnnoAuth.user().githubId), requestId });
  const result = await createAnnotationRequestStatus({ core }).query(requestId);
  const current = core.inspectOwned({ identity: String(window.__aipmAnnoAuth.user().githubId), requestId });
  return { prior: prior.status, used: prior.permits[0].used, result, current };
}, refreshed.requestId);
assert(recovery.prior === 'executing' && recovery.used && recovery.result.status === 'succeeded' &&
  recovery.current.annotationId === persisted.body.operation.annotationId &&
  recovery.current.permits[0].used, 'refresh resumes read-only recovery of original operation');
const localRecovery = await page.evaluate(async () => {
  const { core, proposal, session } = window.currentConfirmation;
  const store = window.__aipmAnnoStore;
  const request = { ...proposal, prefix: '', suffix: '', color: store.DEFAULT_COLOR,
    style: 'highlight' };
  const grantId = await core.confirm({ identity: 'local', session, request });
  await core.claim({ identity: 'local', session, request, grantId });
  const { createAnnotationRequestStatus } = await import('/_static/js/annotation-request-status.js');
  const status = createAnnotationRequestStatus({ core });
  const absent = await status.query(request.requestId);
  const annotationId = store.uid();
  store.localAdd({ id: annotationId, requestId: request.requestId, page: request.page,
    visibility: 'local', body: request.body, color: request.color, style: request.style,
    target: { selectors: [{ type: 'TextQuoteSelector', exact: request.quote,
      prefix: request.prefix, suffix: request.suffix }] }, author: { githubId: 0, login: '本机' },
    replies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const result = await status.query(request.requestId);
  const record = core.inspect({ identity: 'local', session, requestId: request.requestId });
  return { absent: absent.status, result, record, annotationId };
});
assert(localRecovery.absent === 'indeterminate' && localRecovery.result.status === 'succeeded' &&
  localRecovery.result.annotationId === localRecovery.annotationId &&
  localRecovery.record.permits[0].used, 'local read-only correlation retains consumed grant');

console.log({ before: blocked.record, after: restored.record.status,
  refreshed: recovery.current.status, consumed: recovery.used });
await task.finish({ keep: [] });
