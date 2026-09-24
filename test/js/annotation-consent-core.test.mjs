import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createConsentCore } from '../../docs/_static/js/annotation-consent-core.js';

const storage = new JSDOM('', { url: 'https://aipm.ac', storageQuota: 5_242_880 }).window.localStorage;
let now;
let counter;
const request = Object.freeze({ requestId: 'req-1', proposalId: 'proposal-1', page: '/ai/rag/',
  scope: 'text', visibility: 'private', body: '个人批注', quote: '选中文字' });
const context = { identity: 'github-1', session: 'session-1', request };
const create = () => createConsentCore({ storage, clock: () => now,
  site: 'https://aipm.ac', newId: () => `grant-${++counter}` });

beforeEach(() => {
  storage.clear();
  now = Date.UTC(2026, 8, 24);
  counter = 0;
});

test('default denial, exact binding, five-minute single-use permission and reload', async () => {
  const core = create();
  await assert.rejects(core.claim({ ...context, grantId: 'grant-1' }));
  const grantId = await core.confirm(context);
  const restored = create();
  await assert.rejects(restored.claim({ ...context, identity: 'github-2', grantId }));
  await assert.rejects(restored.claim({ ...context, session: 'session-2', grantId }));
  await assert.rejects(restored.claim({ ...context, request: { ...request, body: '其他内容' }, grantId }));
  await assert.rejects(restored.claim({ ...context, request: { ...request, page: '/other/' }, grantId }));
  await assert.rejects(restored.claim({ ...context, request: { ...request, visibility: 'public' }, grantId }));
  await assert.rejects(restored.claim({ ...context, request: { ...request, requestId: 'req-2' }, grantId }));
  now += 299999;
  assert.deepEqual(await restored.claim({ ...context, grantId }), request);
  await assert.rejects(restored.claim({ ...context, grantId }));
  restored.settle({ identity: context.identity, session: context.session, requestId: request.requestId, status: 'succeeded', annotationId: 'anno-1' });
  assert.equal(create().inspect({ ...context, requestId: request.requestId }).annotationId, 'anno-1');
  await assert.rejects(core.confirm(context));
});

test('expiry and revocation stop claims; in-flight revocation retains uncertainty', async () => {
  const core = create();
  const grantId = await core.confirm(context);
  now += 300000;
  await assert.rejects(core.claim({ ...context, grantId }));
  const renewed = await core.confirm(context);
  await assert.rejects(core.claim({ ...context, grantId }));
  assert.equal(renewed, 'grant-2');
  core.revoke({ ...context, requestId: request.requestId });
  assert.equal(core.inspect({ ...context, requestId: request.requestId }).permits[1].revoked, true);
  await assert.rejects(core.claim({ ...context, grantId: renewed }));
  storage.clear();
  const second = await core.confirm(context);
  await core.claim({ ...context, grantId: second });
  core.revoke({ ...context, requestId: request.requestId });
  const record = create().inspect({ ...context, requestId: request.requestId });
  assert.equal(record.status, 'unknown');
  assert.equal(record.unknownRetained, true);
  await assert.rejects(core.claim({ ...context, grantId: second }));
});

test('unknown remains frozen until new explicit confirmation for the same request', async () => {
  const core = create();
  const first = await core.confirm(context);
  await core.claim({ ...context, grantId: first });
  core.settle({ identity: context.identity, session: context.session, requestId: request.requestId, status: 'unknown' });
  await assert.rejects(core.claim({ ...context, grantId: first }));
  await assert.rejects(core.confirm({ ...context, unknown: true, request: { ...request, quote: '其他引文' } }));
  await assert.rejects(core.confirm({ ...context, unknown: true, identity: 'github-2' }));
  const second = await core.confirm({ ...context, unknown: true });
  assert.equal(create().inspect({ ...context, requestId: request.requestId }).status, 'unknown');
  assert.equal(create().inspect({ ...context, requestId: request.requestId }).permits.length, 2);
  await assert.rejects(core.confirm({ ...context, unknown: true }));
  assert.deepEqual(await core.claim({ ...context, grantId: second }), request);
  assert.equal(core.inspect({ ...context, requestId: request.requestId }).unknownRetained, true);
});

test('thirty-day recovery cleanup retains identity-scoped idempotency evidence', async () => {
  const core = create();
  await core.confirm(context);
  now += 30 * 86400000;
  core.prune();
  const record = create().inspect({ ...context, requestId: request.requestId });
  assert.equal(record.request, undefined);
  assert.equal(record.requestId, request.requestId);
  assert.match(record.digest, /^[a-f0-9]{64}$/);
  assert.equal(record.identity, context.identity);
  assert.equal(record.permit, null);
  assert.equal(JSON.stringify(record).includes('个人批注'), false);
  await assert.rejects(core.confirm(context));
  await assert.rejects(core.claim({ ...context, grantId: record.permits[0].id }));
  assert.equal(core.inspect({ identity: 'github-2', session: context.session, requestId: request.requestId }), null);
});

test('real browser storage quota failure denies permission and preserves prior state', async () => {
  const core = create();
  const first = await core.confirm(context);
  const existing = storage.getItem('aipm-anno-consent-v1').length;
  storage.setItem('quota-filler', 'x'.repeat(5_242_880 - existing - 50));
  const next = { ...context, request: { ...request, requestId: 'req-2' } };
  await assert.rejects(core.confirm(next), { name: 'QuotaExceededError' });
  assert.equal(core.inspect({ ...context, requestId: request.requestId }).status, 'awaiting_confirmation');
  assert.equal(core.inspect({ ...next, requestId: next.request.requestId }), null);
  storage.removeItem('quota-filler');
  assert.equal(await create().confirm(next), 'grant-3');
  assert.deepEqual(await create().claim({ ...context, grantId: first }), request);
});
