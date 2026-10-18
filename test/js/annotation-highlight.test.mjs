import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createConsentCore } from '../../docs/_static/js/annotation-consent-core.js';

test('text highlights preserve an empty body through confirmation and a single claim', async () => {
  const storage = new JSDOM('', { url: 'https://aipm.ac' }).window.localStorage;
  for (const visibility of ['local', 'private', 'public']) {
    const core = createConsentCore({ storage, clock: Date.now,
      site: 'http://127.0.0.1', newId: () => crypto.randomUUID() });
    const request = { requestId: crypto.randomUUID(), proposalId: crypto.randomUUID(),
      page: '/ai/rag/', scope: 'text', quote: 'Valid article quotation', body: '', visibility };
    const context = { identity: visibility === 'local' ? 'local' : 'test-account',
      session: crypto.randomUUID(), request };
    const grantId = await core.confirm(context);
    assert.deepEqual(await core.claim({ ...context, grantId }), request);
    await assert.rejects(core.claim({ ...context, grantId }));
  }
});

test('empty page comments and text highlights without a quotation are rejected', async () => {
  const storage = new JSDOM('', { url: 'https://aipm.ac' }).window.localStorage;
  const core = createConsentCore({ storage, clock: Date.now,
    site: 'http://127.0.0.1', newId: () => crypto.randomUUID() });
  for (const scope of ['page', 'text']) {
    await assert.rejects(core.confirm({ identity: 'local', session: crypto.randomUUID(),
      request: { requestId: crypto.randomUUID(), proposalId: crypto.randomUUID(),
        page: '/ai/rag/', scope, body: '', quote: '', visibility: 'local' } }));
  }
});
