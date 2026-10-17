const task = await taskSpace('AIPM historical operation evidence');
console.log('spaceId', task.spaceId);
const page = task.page('p1');
await page.goto('http://127.0.0.1:18788/');
const result = await page.evaluate(async () => {
  const load = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  await load('/docs/_static/js/annotation-store.js');
  await load('/docs/_static/js/annotation-auth.js');
  const { createConsentCore } = await import('/docs/_static/js/annotation-consent-core.js');
  const store = window.__aipmAnnoStore;
  const auth = window.__aipmAnnoAuth;
  const login = await store.request('/api/auth/dev', { method: 'POST' });
  if (!login.ok) throw new Error('legacy login');
  localStorage.setItem('aipm-anno-auth', JSON.stringify(login.body));
  await auth.ready();
  const requestId = crypto.randomUUID();
  const identity = String(auth.user().githubId);
  const session = 'legacy-read-session';
  const core = createConsentCore({ storage: localStorage, clock: () => Date.now(),
    site: location.origin, newId: () => crypto.randomUUID() });
  const request = { requestId, proposalId: crypto.randomUUID(), page: '/ai/rag/',
    scope: 'page', visibility: 'private', body: 'historical persisted note' };
  const grantId = await core.confirm({ identity, session, request });
  await core.claim({ identity, session, request, grantId });
  core.settle({ identity, session, requestId, status: 'unknown' });
  const created = await store.request('/api/annotations', { method: 'POST', token: auth.token(),
    body: { requestId, page: request.page, body: request.body, color: 'yellow',
      visibility: request.visibility, target: { scope: 'page', selectors: [] } } });
  if (created.status !== 201) throw new Error('legacy write');
  localStorage.setItem('aipm-test-history-id', requestId);
  return { requestId, annotationId: created.body.annotation.id };
});
console.log(result);
