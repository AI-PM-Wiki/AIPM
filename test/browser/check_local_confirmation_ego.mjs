import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const LOCAL_BODY = 'Local confirmation timing regression';
const BUSINESS_PATH = /^\/api\/(annotations(?:\/|$)|annotation-|reply-permits|highlight\/|auth\/)/;
const NETWORK_KEY = 'aipm-confirmation-regression-network';

function assertServiceBoundary(state) {
  assert.equal(state.writes, 0, 'local confirmation sent an annotation write');
  assert.equal(state.permitRequests, 0, 'local confirmation requested a permit');
  assert.equal(state.annotationMutations, 0, 'local confirmation mutated annotation service data');
  assert.equal(state.localBodyRequests, 0, 'annotation service received local note content');
}

function assertNetworkBoundary(network, origin) {
  const business = network.filter(entry => BUSINESS_PATH.test(entry.path));
  assert.ok(business.length > 0, 'annotation business traffic was not observed');
  assert.ok(business.every(entry => entry.origin === origin), 'business request escaped isolated endpoint');
  assert.ok(business.every(entry => entry.bodyInspectionSupported), 'business request body could not be inspected');
  assert.equal(network.filter(entry => entry.path.includes('permit')).length, 0);
  assert.equal(network.filter(entry => entry.containsLocalBody).length, 0, 'observed fetch carried local note content');
}

export async function checkLocalConfirmation({ directory, taskSpace }) {
  assert.ok(directory, 'regression directory is required');
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  let id;
  if (existsSync(`${directory}/browser-space.json`)) {
    id = JSON.parse(await readFile(`${directory}/browser-space.json`, 'utf8')).id;
  } else {
    const created = await taskSpace('AI-PM confirmation timing regression');
    id = created.spaceId;
    await writeFile(`${directory}/browser-space.json`, JSON.stringify({ id }));
  }
  const task = await taskSpace(id);
  const page = task.page('p1');
  await page.cdp('Network.enable', {});
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
  await page.cdp('Network.setBlockedURLs', { urls: [
    'http://127.0.0.1:8788/*', 'http://127.0.0.1:8787/*',
    'https://annotations.aipm.ac/*', 'https://agent.aipm.ac/*',
  ] });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (window === top) {
      window.__regressionLocalWrites = 0;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        const result = originalSetItem.call(this, key, value);
        if (this === localStorage && key === 'aipm-anno-local') {
          window.__regressionLocalWrites++;
          window.__confirmationTrace?.push({ event: 'local_storage_write', at: performance.timeOrigin + performance.now() });
        }
        return result;
      };
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        const url = new URL(input instanceof Request ? input.url : input, location.href);
        const records = JSON.parse(sessionStorage.getItem(${JSON.stringify(NETWORK_KEY)}) || '[]');
        const body = init?.body;
        records.push({ origin: url.origin, path: url.pathname,
          method: init?.method || (input instanceof Request ? input.method : 'GET'),
          bodyInspectionSupported: (body === undefined || typeof body === 'string') && !(input instanceof Request && input.body && body === undefined),
          containsLocalBody: String(body || '').includes(${JSON.stringify(LOCAL_BODY)}) });
        sessionStorage.setItem(${JSON.stringify(NETWORK_KEY)}, JSON.stringify(records));
        return originalFetch.apply(this, arguments);
      };
    }` });
  await page.goto(`${config.site}/ai/rag/`);
  await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnnoAuth && window.__aipmAnnoStore, undefined, { timeout: 20000 });
  const initial = await page.evaluate(() => ({
    ready: window.__aipmIntegrityReady,
    count: Object.values(JSON.parse(localStorage.getItem('aipm-anno-local') || '{"pages":{}}').pages || {}).flat().length,
    localWrites: window.__regressionLocalWrites,
  }));
  assert.equal(initial.count, 0);
  assert.equal(initial.localWrites, 0);
  await page.evaluate(async body => {
    window.__confirmationTrace = [];
    const timestamp = () => performance.timeOrigin + performance.now();
    window.addEventListener('aipm-annotation-local-change', event => {
      window.__confirmationTrace.push({ event: 'local_change_notification', at: timestamp(), pageMatches: event.detail?.page === location.pathname });
    });
    let marked = false;
    new MutationObserver(() => {
      if (!marked && document.querySelector('mark.aipm-anno-mark')) {
        marked = true;
        window.__confirmationTrace.push({ event: 'body_mark_appeared', at: timestamp() });
      }
    }).observe(document.querySelector('.md-content__inner'), { childList: true, subtree: true });
    const node = document.createTreeWalker(document.querySelector('.md-content__inner p'), NodeFilter.SHOW_TEXT).nextNode();
    const quote = node.textContent.slice(4, 22);
    const host = document.createElement('section');
    host.setAttribute('data-confirmation-regression', '');
    document.querySelector('.md-content__inner').prepend(host);
    const { createAgentEntry } = await import('/_static/js/annotation-agent-entry.js?v=46');
    const proposal = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), page: location.pathname,
      scope: 'text', quote, prefix: node.textContent.slice(0, 4), suffix: node.textContent.slice(22, 30),
      body, visibility: 'local', color: 'blue', style: 'underline' };
    window.__regressionQuote = quote;
    createAgentEntry().mount({ proposal, host });
  }, LOCAL_BODY);
  await page.waitForSelector(`loc=css:#body:text-is("${LOCAL_BODY}")`, { state: 'visible' });
  const before = await page.evaluate(() => ({
    trace: window.__confirmationTrace.slice(),
    count: Object.values(JSON.parse(localStorage.getItem('aipm-anno-local') || '{"pages":{}}').pages || {}).flat().length,
    localWrites: window.__regressionLocalWrites,
  }));
  assert.equal(before.count, 0);
  assert.equal(before.localWrites, 0);
  assert.equal(before.trace.length, 0);
  assertServiceBoundary(await (await fetch(config.control)).json());
  await page.click('loc=css:#agree');
  await page.waitForSelector('loc=css:#state:text-is("已写入：仅本机")', { state: 'visible', timeout: 10000 });
  await page.evaluate(() => window.__confirmationTrace.push({ event: 'confirmation_completed_observed', at: performance.timeOrigin + performance.now() }));
  await page.waitForFunction(() => document.querySelectorAll('mark.aipm-anno-mark').length === 1, undefined, { timeout: 2500 });
  const after = await page.evaluate(() => ({
    trace: window.__confirmationTrace,
    count: Object.values(JSON.parse(localStorage.getItem('aipm-anno-local') || '{"pages":{}}').pages || {}).flat().length,
    localWrites: window.__regressionLocalWrites,
    marks: document.querySelectorAll('mark.aipm-anno-mark').length,
    quoteMatches: document.querySelector('mark.aipm-anno-mark')?.textContent === window.__regressionQuote,
  }));
  const writes = after.trace.filter(entry => entry.event === 'local_storage_write');
  const notifications = after.trace.filter(entry => entry.event === 'local_change_notification');
  const mark = after.trace.find(entry => entry.event === 'body_mark_appeared');
  const completed = after.trace.find(entry => entry.event === 'confirmation_completed_observed');
  assert.equal(writes.length, 1);
  assert.equal(after.localWrites, 1);
  assert.equal(after.count, 1);
  assert.equal(after.marks, 1);
  assert.equal(after.quoteMatches, true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].pageMatches, true);
  assert.ok(mark && completed && writes[0].at <= notifications[0].at && notifications[0].at <= mark.at && mark.at <= completed.at, 'storage, notification, mark and confirmation order is invalid');
  assertServiceBoundary(await (await fetch(config.control)).json());
  const stored = await page.evaluate(() => localStorage.getItem('aipm-anno-local'));
  const stages = [];
  async function observeStage(name, expectedMarks, expectedWrites) {
    await page.waitForFunction(() => window.__aipmIntegrityReady === true && performance.getEntriesByType('resource').some(entry => entry.name.includes('/api/annotations?')), undefined, { timeout: 20000 });
    await page.waitForFunction(expected => document.querySelectorAll('mark.aipm-anno-mark').length === expected, expectedMarks, { timeout: 5000 });
    const current = await page.evaluate(key => ({
      api: window.__aipmLocalApi,
      stored: localStorage.getItem('aipm-anno-local'),
      localWrites: window.__regressionLocalWrites,
      count: Object.values(JSON.parse(localStorage.getItem('aipm-anno-local') || '{"pages":{}}').pages || {}).flat().length,
      marks: document.querySelectorAll('mark.aipm-anno-mark').length,
      resources: performance.getEntriesByType('resource').map(entry => ({ origin: new URL(entry.name).origin, path: new URL(entry.name).pathname, status: entry.responseStatus })),
      network: JSON.parse(sessionStorage.getItem(key) || '[]'),
    }), NETWORK_KEY);
    assert.equal(current.api.annotation, config.annotation);
    assert.equal(current.stored, stored, 'navigation changed annotation storage');
    assert.equal(current.count, 1);
    assert.equal(current.localWrites, expectedWrites);
    const requests = current.resources.filter(entry => BUSINESS_PATH.test(entry.path));
    assert.ok(requests.length > 0);
    assert.ok(requests.every(entry => entry.origin === config.annotation), 'resource traffic escaped isolated endpoint');
    assertNetworkBoundary(current.network, config.annotation);
    stages.push({ name, localWrites: current.localWrites, count: current.count, marks: current.marks, requests });
  }
  await observeStage('first_load', 1, 1);
  await page.goto(`${config.site}/ai/prompting/`);
  await observeStage('navigation', 0, 0);
  await page.reload();
  await observeStage('refresh', 0, 0);
  await page.goto(`${config.site}/ai/rag/`);
  await observeStage('return_to_article', 1, 0);
  const repeated = await page.evaluate(key => {
    const stored = localStorage.getItem('aipm-anno-local');
    const writes = window.__regressionLocalWrites;
    const requests = JSON.parse(sessionStorage.getItem(key) || '[]').length;
    for (let index = 0; index < 10; index++) window.dispatchEvent(new CustomEvent('aipm-annotation-local-change', { detail: { page: location.pathname } }));
    return { storageUnchanged: stored === localStorage.getItem('aipm-anno-local'),
      writeCountUnchanged: writes === window.__regressionLocalWrites,
      requestCountUnchanged: requests === JSON.parse(sessionStorage.getItem(key) || '[]').length,
      marks: document.querySelectorAll('mark.aipm-anno-mark').length };
  }, NETWORK_KEY);
  assert.deepEqual(repeated, { storageUnchanged: true, writeCountUnchanged: true, requestCountUnchanged: true, marks: 1 });
  const network = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || '[]'), NETWORK_KEY);
  assertNetworkBoundary(network, config.annotation);
  const finalService = await (await fetch(config.control)).json();
  assertServiceBoundary(finalService);
  const result = {
    status: 'pass', spaceId: id, initial, before, after,
    storageToMarkMs: mark.at - writes[0].at,
    assertions: { localWriteCount: writes.length, notificationCount: notifications.length,
      markBeforeConfirmationObserved: true, zeroPermitRequests: true,
      annotationBusinessOriginsIsolated: true, noLocalBodyInObservedFetch: true,
      repeatedNotifications: repeated, refreshRepeatedWrites: false },
    navigationIsolation: stages, network, finalService,
    uploadCoverage: { annotationBusinessRequests: 'pass', observedFetchLiteralBody: 'pass',
      recorder: 'not_run', recorderChannelsNotCovered: ['sendBeacon', 'XHR', 'encoded payloads'] },
    externalModelRequests: 0, externalJevRequests: 0, tokensUsed: 0, automaticRetries: 0,
  };
  await writeFile(`${directory}/after-timing.json`, JSON.stringify(result, null, 2));
  console.log({ status: result.status, spaceId: id, storageToMarkMs: result.storageToMarkMs, assertions: result.assertions, uploadCoverage: result.uploadCoverage });
  console.log((await page.snapshot()).slice(-1500));
  return result;
}
