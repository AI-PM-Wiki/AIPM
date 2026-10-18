import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAgentEntry } from '../../docs/_static/js/annotation-agent-entry.js';

test('visibility selection and locking survive a new entry instance', () => {
  const storage = new JSDOM('', { url: 'https://aipm.ac' }).window.localStorage;
  const create = () => createAgentEntry({ storage, site: 'https://aipm.ac' });
  const proposal = { id: 'proposal-1', requestId: 'request-choice-1', page: '/ai/rag/', visibility: 'local' };
  assert.deepEqual(create().visibilityChoice(proposal), { visibility: 'local', locked: false });
  create().chooseVisibility(proposal, 'private');
  assert.deepEqual(create().visibilityChoice(proposal), { visibility: 'private', locked: false });
  create().chooseVisibility(proposal, 'public', { lock: true });
  assert.deepEqual(create().visibilityChoice(proposal), { visibility: 'public', locked: true });
  assert.throws(() => create().chooseVisibility(proposal, 'private'), /visibility locked/);
  assert.throws(() => create().visibilityChoice({ ...proposal, page: '/ai/agent/' }), /evidence mismatch/);
});

test('invalid identities and visibility cannot create choice records', () => {
  const storage = new JSDOM('', { url: 'https://aipm.ac' }).window.localStorage;
  const entry = createAgentEntry({ storage, site: 'https://aipm.ac' });
  const proposal = { id: 'proposal-1', requestId: 'request-choice-1', page: '/ai/rag/', visibility: 'local' };
  assert.throws(() => entry.chooseVisibility(proposal, 'unknown'), TypeError);
  assert.throws(() => entry.chooseVisibility({ ...proposal, requestId: '' }, 'public'), TypeError);
  assert.equal(storage.length, 0);
});
