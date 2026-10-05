const spaces = await listTaskSpaces();
const task = await taskSpace(spaces.find((space) =>
  space.name === 'AIPM historical operation evidence' && space.ownership === 'agent').id);
const page = task.page('p1');
const result = await page.evaluate(async () => {
  const requestId = localStorage.getItem('aipm-test-history-id');
  if (!requestId) throw new Error('legacy request absent');
  const auth = window.__aipmAnnoAuth;
  const store = window.__aipmAnnoStore;
  const { createConsentCore } = await import('/docs/_static/js/annotation-consent-core.js');
  const { createAnnotationRequestStatus } = await import('/docs/_static/js/annotation-request-status.js');
  const core = createConsentCore({ storage: localStorage, clock: () => Date.now(),
    site: location.origin, newId: () => crypto.randomUUID() });
  const identity = String(auth.user().githubId);
  const receipt = await store.request(`/api/annotation-requests/${requestId}`, { token: auth.token() });
  if (receipt.status !== 200 || receipt.body.operation.originalRequestKnown !== false) {
    throw new Error('historical operation evidence');
  }
  const controller = createAnnotationRequestStatus({ core });
  const status = await controller.query(requestId);
  if (status.status !== 'indeterminate' ||
      core.inspect({ identity, session: 'legacy-read-session', requestId }).status !== 'unknown') {
    throw new Error('historical result must retain unknown state');
  }
  return { requestId, historicalEvidence: receipt.body.operation.originalRequestKnown,
    status: status.status };
});
console.log(result);
await task.finish({ keep: [] });
