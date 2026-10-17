import fs from 'node:fs';
import assert from 'node:assert/strict';

export async function checkReviewDraft({ directory, taskSpace }) {
  const config = JSON.parse(fs.readFileSync(directory + '/runtime.json', 'utf8'));
  const task = await taskSpace('AIPM reviewed code fixes');
  const page = task.page('review');
  await page.goto(config.site + '/ai/rag/');
  await page.waitForFunction(() => window.__aipmIntegrityReady === true, undefined, { timeout: 10000 });
  await page.evaluate(async endpoint => {
    const response = await fetch(endpoint + '/api/auth/dev', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('isolated store initialization failed');
    await response.json();
  }, config.annotation);
  const initial = await (await fetch(config.control)).json();
  const binding = await page.evaluate(async () => {
    const { createAgentEntry } = await import('/_static/js/annotation-agent-entry.js?v=46');
    const entry = createAgentEntry();
    const proposal = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), page: location.pathname,
      scope: 'text', quote: 'Review receipt quotation', prefix: '', suffix: '',
      body: '', visibility: 'local', color: 'blue', style: 'highlight' };
    entry.rememberProposal(proposal);
    return {
      original: entry.hasPendingProposal(proposal),
      bodyChanged: entry.hasPendingProposal({ ...proposal, body: proposal.body + 'changed' }),
      pageChanged: entry.hasPendingProposal({ ...proposal, page: '/other/' }),
      requestChanged: entry.hasPendingProposal({ ...proposal, requestId: crypto.randomUUID() }),
      scopeChanged: entry.hasPendingProposal({ ...proposal, scope: 'page' }),
    };
  });
  assert.deepEqual(binding, { original: true, bodyChanged: false, pageChanged: false, requestChanged: false, scopeChanged: false });
  await page.evaluate(() => window.__aipmAnnoAuth.logout());
  const proposal = await page.evaluate(async () => {
    const { createAgentEntry } = await import('/_static/js/annotation-agent-entry.js?v=46');
    const text = document.querySelector('.md-content__inner p').textContent;
    const proposal = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), page: location.pathname,
      scope: 'text', quote: text.slice(70, 88), prefix: text.slice(66, 70), suffix: text.slice(88, 96),
      body: '', visibility: 'private', color: 'purple', style: 'highlight' };
    createAgentEntry().loginDraft(proposal);
    return proposal;
  });
  await page.waitForURL(url => url.pathname === '/api/auth/github/start', { timeout: 5000 });
  await page.goto(config.site + '/ai/rag/');
  await page.waitForFunction(() => window.__aipmIntegrityReady === true, undefined, { timeout: 10000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aipm-agent-login-draft-v1')));
  assert.equal(saved.proposal.body, '');
  assert.equal(saved.proposal.requestId, proposal.requestId);
  await page.evaluate(async endpoint => {
    const response = await fetch(endpoint + '/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('test session failed');
    localStorage.setItem('aipm-anno-auth', JSON.stringify(await response.json()));
  }, config.annotation);
  await page.reload();
  await page.waitForFunction(() => window.__aipmIntegrityReady === true, undefined, { timeout: 10000 });
  const mounted = await page.evaluate(async () => {
    await window.__aipmAnnoAuth.ready();
    const { createAgentEntry } = await import('/_static/js/annotation-agent-entry.js?v=46');
    const proposal = JSON.parse(localStorage.getItem('aipm-agent-login-draft-v1')).proposal;
    const host = document.createElement('section');
    document.querySelector('.md-content__inner').prepend(host);
    createAgentEntry().mount({ proposal, historical: true, host });
    return { requestId: proposal.requestId, body: proposal.body };
  });
  assert.equal(mounted.requestId, proposal.requestId);
  const beforeConfirm = await (await fetch(config.control)).json();
  assert.equal(beforeConfirm.annotations.length, initial.annotations.length);
  await page.waitForSelector('loc=css:#agree:not([disabled])', { state: 'visible', timeout: 3000 });
  await page.click('loc=css:#agree');
  await page.waitForSelector('loc=css:#state:text-is("已写入：仅自己可见")', { state: 'visible', timeout: 10000 });
  const final = await (await fetch(config.control)).json();
  const records = final.annotations.filter(row => row.requestId === proposal.requestId);
  assert.equal(records.length, 1);
  assert.equal(records[0].body, '');
  assert.equal(records[0].visibility, 'private');
  const loginAttempts = final.requests.slice(initial.requests.length).filter(row => row.path === '/api/auth/github/start');
  assert.equal(loginAttempts.length, 1);
  assert.equal(loginAttempts[0].status, 503, 'isolated service must reject unconfigured OAuth before redirect');
  await page.reload();
  await page.waitForFunction(() => window.__aipmIntegrityReady === true, undefined, { timeout: 10000 });
  const afterReload = await (await fetch(config.control)).json();
  assert.equal(afterReload.annotations.filter(row => row.requestId === proposal.requestId).length, 1);
  const result = { status: 'pass', binding, mounted, saved: { requestId: proposal.requestId, body: records[0].body, visibility: records[0].visibility },
    beforeConfirmWrites: beforeConfirm.annotations.length - initial.annotations.length,
    createdRecords: records.length, localLoginRejected: loginAttempts[0].status, modelRequests: 0,
    scope: 'isolated draft persistence and restoration across test-session establishment; OAuth not exercised' };
  fs.writeFileSync(directory + '/draft.json', JSON.stringify(result, null, 2));
  console.log(result);
}
