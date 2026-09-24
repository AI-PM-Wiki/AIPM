const existing = (await listTaskSpaces()).find((space) =>
  space.name === 'AIPM isolated proposal confirmation' && space.ownership === 'agent');
const task = existing ? await taskSpace(existing.id) : await taskSpace('AIPM isolated proposal confirmation');
console.log('spaceId', task.spaceId);
const page = task.page('p1');
await page.cdp('Network.enable');
await page.cdp('Network.setBypassServiceWorker', { bypass: true });
await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
await page.goto('http://127.0.0.1:18788/ai/rag/');

const prepare = async (visibility, options = {}) => page.evaluate(async ({ visibility, options }) => {
  if (!window.__confirmModules) {
    const { createConsentCore } = await import('/_static/js/annotation-consent-core.js');
    const { mountProposalConfirmation } = await import('/_static/js/annotation-proposal-confirm.js');
    window.__confirmModules = { createConsentCore, mountProposalConfirmation };
  }
  const store = window.__aipmAnnoStore;
  const auth = window.__aipmAnnoAuth;
  if (visibility !== 'local' && !auth.token()) {
    const session = await store.request('/api/auth/dev', { method: 'POST' });
    if (!session.ok) throw new Error('developer session unavailable');
    localStorage.setItem('aipm-anno-auth', JSON.stringify(session.body));
    await auth.ready();
  }
  const requestId = crypto.randomUUID();
  const proposal = { requestId, proposalId: crypto.randomUUID(), page: location.pathname,
    scope: 'page', body: `verification ${requestId}`, visibility, ...options };
  const core = window.__confirmModules.createConsentCore({ storage: localStorage,
    clock: () => Date.now(), site: location.origin, newId: () => crypto.randomUUID() });
  const card = window.__confirmModules.mountProposalConfirmation({ core, proposal,
    session: `session-${requestId}` });
  card.id = 'current-confirmation';
  window.__confirmCase = { core, card, proposal, identity: visibility === 'local' ? 'local' : String(auth.user().githubId),
    session: `session-${requestId}` };
  return { requestId, visible: card.textContent, identity: window.__confirmCase.identity };
}, { visibility, options });

const inspect = async () => page.evaluate(() => {
  const { core, card, identity, session, proposal } = window.__confirmCase;
  return { state: card.querySelector('[role="status"]').textContent,
    record: core.inspect({ identity, session, requestId: proposal.requestId }),
    requests: performance.getEntriesByType('resource').filter((entry) =>
      entry.name.includes('127.0.0.1:8788/api/annotations')).length,
    external: performance.getEntriesByType('resource').filter((entry) =>
      new URL(entry.name).origin !== location.origin).length };
});
const clear = async () => page.evaluate(() => window.__confirmCase.card.remove());
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const logged = [];

let target = await prepare('private');
assert(target.visible.includes('目标：') && target.visible.includes('正文：') &&
  target.visible.includes('最终可见范围：仅自己可见') &&
  target.visible.includes('同意并写入'), 'visible consent details');
assert((await inspect()).record === null, 'display does not grant');
await page.evaluate(() => window.__confirmCase.card.querySelector('button').click());
assert((await inspect()).record === null, 'scripted click is not user consent');
assert((await page.evaluate(async (id) => window.__aipmAnnoStore.request(
  `/api/annotation-requests/${id}`, { token: window.__aipmAnnoAuth.token() }), target.requestId)).status === 404,
  'no creation before consent');
await page.click('#current-confirmation button:nth-last-child(2)', { label: 'cancel unapproved proposal' });
assert((await inspect()).record === null, 'cancel without write');
logged.push({ scenario: 'unapproved and cancelled', result: await inspect() });
await clear();

target = await prepare('private');
const before = (await inspect()).requests;
try {
  await page.dblclick('#current-confirmation button:nth-last-child(3)', { label: 'approve proposal twice' });
} catch (error) {
  if (!String(error).includes('element is disabled')) throw error;
}
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.startsWith('已写入'));
let outcome = await inspect();
assert(outcome.record.status === 'succeeded' && outcome.record.permits.length === 1 &&
  outcome.requests === before + 1, 'single authenticated creation');
const receipt = await page.evaluate(async (id) => window.__aipmAnnoStore.request(
  `/api/annotation-requests/${id}`, { token: window.__aipmAnnoAuth.token() }), target.requestId);
assert(receipt.status === 200 && receipt.body.operation.annotationId === outcome.record.annotationId &&
  receipt.body.operation.visibility === 'private', 'persisted authenticated receipt');
logged.push({ scenario: 'double click, one POST, persisted receipt', requestId: target.requestId,
  annotationId: outcome.record.annotationId });
await clear();

target = await prepare('private');
await page.evaluate(() => window.__aipmAnnoAuth.forget());
await page.click('#current-confirmation button:nth-last-child(3)', { label: 'reject stale identity' });
outcome = await inspect();
assert(outcome.record === null && outcome.state.includes('未写入'), 'stale identity no permission');
logged.push({ scenario: 'expired session', result: outcome.state });
await clear();

target = await prepare('local');
const outgoingBefore = (await inspect()).requests;
const externalBefore = (await inspect()).external;
await page.click('#current-confirmation button:nth-last-child(3)', { label: 'approve local proposal' });
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.startsWith('已写入'));
outcome = await inspect();
assert(outcome.record.status === 'succeeded' && outgoingBefore === outcome.requests &&
  externalBefore === outcome.external, 'local zero outgoing traffic');
assert((await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).filter(
  (item) => item.id === window.__confirmCase.core.inspect({ identity: 'local',
    session: window.__confirmCase.session, requestId: window.__confirmCase.proposal.requestId }).annotationId).length)) === 1,
  'local annotation exists once');
const localDuplicate = await page.evaluate(() => {
  const { core, proposal, session } = window.__confirmCase;
  try {
    window.__confirmModules.mountProposalConfirmation({ core, proposal, session });
    return false;
  } catch (error) {
    return error.message === 'request already recorded';
  }
});
assert(localDuplicate && outgoingBefore === (await inspect()).requests,
  'local duplicate cannot create another entry or send a request');
logged.push({ scenario: 'local-only zero network', result: outcome.state });
await clear();

target = await prepare('private');
await page.cdp('Network.enable');
await page.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0,
  downloadThroughput: 0, uploadThroughput: 0 });
await page.click('#current-confirmation button:nth-last-child(3)', { label: 'approve while offline' });
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.includes('结果未知'));
outcome = await inspect();
assert(outcome.record.status === 'unknown' && outcome.record.permits[0].used === true,
  'transport failure freezes original');
await page.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0,
  downloadThroughput: -1, uploadThroughput: -1 });
await page.click('#current-confirmation button:last-child', { label: 'query unknown request' });
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.includes('仍未知'));
logged.push({ scenario: 'offline unknown and read-only lookup', result: await inspect() });
await clear();

target = await prepare('private');
const baseline = (await inspect()).requests;
const quota = await page.evaluate(() => {
  const existing = Object.keys(localStorage).reduce((size, key) => size + key.length + localStorage.getItem(key).length, 0);
  localStorage.setItem('aipm-confirm-quota', 'x'.repeat(5_242_880 - existing - 100));
  return existing;
});
await page.click('#current-confirmation button:nth-last-child(3)', { label: 'reject storage exhaustion' });
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.includes('未写入'));
outcome = await inspect();
assert(outcome.record === null && outcome.requests === baseline, 'storage failure stops before sending');
await page.evaluate(() => localStorage.removeItem('aipm-confirm-quota'));
logged.push({ scenario: 'real storage quota', priorBytes: quota, result: outcome.state });
await clear();

target = await prepare('private', { style: 'not-a-valid-style' });
await page.click('#current-confirmation button:nth-last-child(3)', { label: 'observe rejected server write' });
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.includes('结果未知'));
outcome = await inspect();
assert(outcome.record.status === 'unknown', 'rejected response does not certify success');
const rejected = await page.evaluate(async (id) => window.__aipmAnnoStore.request(
  `/api/annotation-requests/${id}`, { token: window.__aipmAnnoAuth.token() }), target.requestId);
assert(rejected.status === 404, 'server rejection did not persist annotation');
logged.push({ scenario: 'service rejection has no receipt', result: outcome.state });
await clear();

target = await prepare('private');
await page.cdp('Network.emulateNetworkConditions', { offline: false, latency: 2500,
  downloadThroughput: -1, uploadThroughput: -1 });
await page.click('#current-confirmation button:nth-last-child(3)', { label: 'send then revoke identity' });
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.includes('写入中'));
await page.evaluate(() => window.__aipmAnnoAuth.forget());
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.includes('结果未知'),
  undefined, { timeout: 12000 });
outcome = await inspect();
assert(outcome.record.status === 'unknown', 'late response does not override lost session');
await page.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0,
  downloadThroughput: -1, uploadThroughput: -1 });
const lateReceipt = await page.evaluate(async (id) => {
  const auth = window.__aipmAnnoAuth;
  const store = window.__aipmAnnoStore;
  const session = await store.request('/api/auth/dev', { method: 'POST' });
  localStorage.setItem('aipm-anno-auth', JSON.stringify(session.body));
  await auth.ready();
  return store.request(`/api/annotation-requests/${id}`, { token: auth.token() });
}, target.requestId);
assert(lateReceipt.status === 200, 'late transport was persisted by service');
await page.click('#current-confirmation button:last-child', { label: 'read late persisted receipt' });
await page.waitForFunction(() => document.querySelector('#current-confirmation [role="status"]')?.textContent.startsWith('已写入'));
logged.push({ scenario: 'late response, new session read-only reconciliation',
  annotationId: lateReceipt.body.operation.annotationId, result: (await inspect()).state });
await clear();

console.log(JSON.stringify(logged, null, 2));
await task.finish({ keep: [] });
