const task = await taskSpace('AIPM read-only annotation status verification');
console.log('spaceId', task.spaceId);
const page = task.page('p1');
await page.cdp('Network.enable');
await page.cdp('Network.setBlockedURLs', { urls: ['*umami.nvc.ac*'] });
await page.cdp('Network.setBypassServiceWorker', { bypass: true });
await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });

await page.goto('http://127.0.0.1:18788/');
const result = await page.evaluate(async () => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const load = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  await load('/_static/js/annotation-store.js');
  await load('/_static/js/annotation-auth.js');
  const { createConsentCore } = await import('/_static/js/annotation-consent-core.js');
  const { createAnnotationRequestStatus } = await import('/_static/js/annotation-request-status.js');
  const store = window.__aipmAnnoStore;
  const auth = window.__aipmAnnoAuth;
  const session = await store.request('/api/auth/dev', { method: 'POST' });
  assert(session.ok, 'real developer session');
  localStorage.setItem('aipm-anno-auth', JSON.stringify(session.body));
  await auth.ready();
  const identity = String(auth.user().githubId);
  const requestId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const context = { identity, session: 'original-session', request: {
    requestId, proposalId, page: '/ai/rag/', scope: 'page',
    visibility: 'private', body: 'read status integration', color: 'yellow' } };
  let now = Date.now();
  const core = createConsentCore({ storage: localStorage, clock: () => now,
    site: location.origin, newId: () => crypto.randomUUID() });
  const controller = createAnnotationRequestStatus({ core });
  const grantId = await core.confirm(context);
  await core.claim({ ...context, grantId });
  core.settle({ identity, session: context.session, requestId, status: 'unknown' });
  assert((await controller.query(requestId)).status === 'indeterminate', '404 remains unknown');
  assert(core.inspect({ identity, session: context.session, requestId }).status === 'unknown', '404 state');
  const payload = { requestId, page: '/ai/rag/', body: context.request.body,
    color: 'yellow', visibility: 'private', target: { scope: 'page', selectors: [] } };
  const created = await store.request('/api/annotations', { method: 'POST', token: auth.token(), body: payload });
  assert(created.status === 201, 'real persisted operation');
  const status = await controller.query(requestId);
  assert(status.status === 'succeeded' && status.annotationId === created.body.annotation.id,
    'bound success');
  const second = await controller.query(requestId);
  assert(second.annotationId === status.annotationId, 'repeated read');
  const staleId = crypto.randomUUID();
  const stale = { ...context, request: { ...context.request, requestId: staleId } };
  const staleGrant = await core.confirm(stale);
  await core.claim({ ...stale, grantId: staleGrant });
  core.settle({ identity, session: stale.session, requestId: staleId, status: 'unknown' });
  const pending = controller.query(staleId);
  auth.forget();
  assert((await pending).status === 'indeterminate', 'late result after session loss');
  assert(core.inspect({ identity, session: stale.session, requestId: staleId }).status === 'unknown',
    'late result does not settle');
  const newSession = await store.request('/api/auth/dev', { method: 'POST' });
  localStorage.setItem('aipm-anno-auth', JSON.stringify(newSession.body));
  await auth.ready();
  const revoked = await store.request('/api/auth/logout', { method: 'POST', token: auth.token() });
  assert(revoked.ok, 'real revoked session');
  assert((await controller.query(staleId)).status === 'indeterminate', '401 remains unknown');
  assert(core.inspect({ identity, session: stale.session, requestId: staleId }).status === 'unknown',
    '401 state');
  auth.forget();
  const renewed = await store.request('/api/auth/dev', { method: 'POST' });
  localStorage.setItem('aipm-anno-auth', JSON.stringify(renewed.body));
  await auth.ready();
  const cleanedId = crypto.randomUUID();
  const cleanedContext = { ...context, request: { ...context.request, requestId: cleanedId } };
  const cleanedGrant = await core.confirm(cleanedContext);
  await core.claim({ ...cleanedContext, grantId: cleanedGrant });
  core.settle({ identity, session: cleanedContext.session, requestId: cleanedId, status: 'unknown' });
  now += 31 * 86400000;
  core.prune();
  assert(core.inspect({ identity, session: cleanedContext.session, requestId: cleanedId }).request === undefined,
    'expired recovery copy removed');
  const cleanedCreated = await store.request('/api/annotations', { method: 'POST',
    token: auth.token(), body: { ...payload, requestId: cleanedId } });
  assert(cleanedCreated.status === 201, 'persisted operation after cleanup');
  const cleanedStatus = await controller.query(cleanedId);
  assert(cleanedStatus.status === 'succeeded' &&
    cleanedStatus.annotationId === cleanedCreated.body.annotation.id, 'read after cleanup');
  assert((await controller.query(requestId)).status === 'succeeded', 'read after prune');
  const localId = crypto.randomUUID();
  const localRequest = { ...context, request: { ...context.request, requestId: localId,
    visibility: 'local' } };
  await core.confirm(localRequest);
  const before = performance.getEntriesByType('resource').filter((item) => item.name.includes(':8788/')).length;
  assert((await controller.query(localId)).status === 'awaiting_confirmation', 'local state');
  const after = performance.getEntriesByType('resource').filter((item) => item.name.includes(':8788/')).length;
  assert(before === after, 'local query zero HTTP');
  auth.forget();
  const anonymousId = crypto.randomUUID();
  const anonymous = { identity: 'local', session: 'anonymous-session', request: {
    ...context.request, requestId: anonymousId, visibility: 'local' } };
  await core.confirm(anonymous);
  const anonymousBefore = performance.getEntriesByType('resource').filter((item) => item.name.includes(':8788/')).length;
  assert((await controller.query(anonymousId)).status === 'awaiting_confirmation', 'anonymous local state');
  const anonymousAfter = performance.getEntriesByType('resource').filter((item) => item.name.includes(':8788/')).length;
  assert(anonymousBefore === anonymousAfter, 'anonymous local query zero HTTP');
  return { requestId, annotationId: status.annotationId,
    networkReads: after, localNetworkDelta: after - before };
});
console.log(result);
await task.finish({ keep: [] });
