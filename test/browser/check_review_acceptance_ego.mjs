import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkReviewAcceptance({ directory, phase, taskSpace, spaceId }) {
  const config = JSON.parse(await readFile(`${directory}/runtime.json`, 'utf8'));
  const task = await taskSpace(spaceId ?? 'AIPM PR126 fixes acceptance');
  const page = task.page('p1');
  await writeFile(`${directory}/browser-space.json`, JSON.stringify({ id: task.spaceId }));
  const result = { phase, spaceId: task.spaceId, observations: [] };
  const state = async () => (await fetch(config.control)).json();
  const control = async path => {
    const response = await fetch(config.control + path, { method: 'POST' });
    assert.equal(response.status, 204);
  };
  const ready = async () => page.waitForFunction(
    () => window.__aipmIntegrityReady === true && window.__aipmChat && window.__aipmAnnoStore,
    undefined, { timeout: 20000 });
  async function visit(path = '/ai/review-acceptance/') {
    await page.goto(config.site + path);
    await ready();
    await writeFile(`${directory}/${phase}-page.txt`, await page.snapshot());
  }
  async function login() {
    result.step = 'reset development session';
    await control('/reset');
    result.step = 'create development session';
    await page.evaluate(async base => {
      const response = await fetch(base + '/api/auth/dev', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (response.status !== 200) throw new Error('development session unavailable');
      localStorage.setItem('aipm-anno-auth', JSON.stringify(await response.json()));
    }, config.annotation);
    result.step = 'reload development session';
    await page.reload();
    await ready();
    result.step = 'validate development session';
    await page.evaluate(() => window.__aipmAnnoAuth.ready());
    await page.waitForFunction(() => window.__aipmAnnoAuth.user()?.login === 'browser-check');
  }
  async function mount({ visibility = 'local', body = '', proposal, historical = false } = {}) {
    return page.evaluate(async input => {
      const { createAgentEntry } = await import('/_static/js/annotation-agent-entry.js?v=46');
      document.querySelector('#review-confirmation')?.remove();
      const host = document.createElement('section');
      host.id = 'review-confirmation';
      document.querySelector('.md-content__inner').prepend(host);
      const text = document.querySelector('#review-paragraph').textContent;
      const proposal = input.proposal ?? { id: crypto.randomUUID(), requestId: crypto.randomUUID(),
        page: location.pathname, scope: 'text', quote: text.slice(0, 26), prefix: '', suffix: text.slice(26, 40),
        body: input.body, visibility: input.visibility, color: 'blue', style: 'highlight' };
      const entry = createAgentEntry();
      entry.rememberProposal(proposal);
      entry.mount({ proposal, host, historical: input.historical });
      return proposal;
    }, { visibility, body, proposal, historical });
  }
  async function restore(proposal) {
    return page.evaluate(async proposal => {
      const { createAgentEntry } = await import('/_static/js/annotation-agent-entry.js?v=46');
      const entry = createAgentEntry();
      const host = document.createElement('section');
      document.querySelector('.md-content__inner').prepend(host);
      entry.mount({ proposal, host, historical: true });
      return entry.restoreEvidence(proposal.requestId, proposal.visibility).status;
    }, proposal);
  }
  async function confirm() {
    await page.waitForSelector('loc=css:#agree:not([disabled])', { state: 'visible', timeout: 10000 });
    await page.press('loc=css:#agree', 'Enter');
  }
  async function saved(label) {
    await page.waitForSelector(`loc=css:#state:text-is("已写入：${label}")`, { state: 'visible', timeout: 12000 });
  }
  async function marked(id) {
    await page.waitForFunction(id => [...document.querySelectorAll('mark.aipm-anno-mark')]
      .some(mark => mark.dataset.annoId === id), id, { timeout: 10000 });
  }
  try {
    await page.cdp('Network.enable', {});
    await page.cdp('Network.setBlockedURLs', { urls: ['https://umami.nvc.ac/api/*'] });
    await visit(['model', 'controls'].includes(phase) ? '/ai/rag/' : '/ai/review-acceptance/');
    if (phase === 'local') {
      const before = await state();
      const proposal = await mount();
      const unchanged = await state();
      assert.equal(unchanged.requests.filter(row => row.method === 'POST').length,
        before.requests.filter(row => row.method === 'POST').length);
      await confirm();
      await saved('仅本机');
      const local = await page.evaluate(id => window.__aipmAnnoStore.localList(location.pathname)
        .find(record => record.requestId === id), proposal.requestId);
      assert.equal(local.body, '');
      await marked(local.id);
      await page.reload();
      await ready();
      assert.equal(await restore(proposal), 'succeeded');
      const after = await state();
      assert.equal(after.requests.filter(row => row.path.includes('permit') ||
        row.method === 'POST' && row.path === '/api/annotations').length, 0);
      result.observations.push({ proposal, annotationId: local.id, writes: 0 });
    } else if (phase === 'normalized') {
      for (const visibility of ['public', 'private']) {
        result.visibility = visibility;
        await login();
        result.step = 'mount proposal';
        const proposal = await mount({ visibility, body: `Review ${visibility}\n` });
        result.step = 'confirm proposal';
        await confirm();
        result.step = 'await save';
        await saved(visibility === 'public' ? '公开' : '仅自己可见');
        const after = await state();
        const annotation = after.annotations.find(record => record.requestId === proposal.requestId);
        assert.ok(annotation);
        assert.equal(annotation.body, `Review ${visibility}`);
        result.step = 'await initial mark';
        await marked(annotation.id);
        assert.equal(after.requests.filter(row => row.method === 'POST' && row.path === '/api/annotations').length, 1);
        await page.reload();
        await ready();
        result.step = 'await restored mark';
        await marked(annotation.id);
        assert.equal(await restore(proposal), 'succeeded');
        result.observations.push({ visibility, annotationId: annotation.id, body: annotation.body });
      }
    } else if (phase === 'rejected') {
      await login();
      const filled = await page.evaluate(async () => {
        const auth = window.__aipmAnnoAuth;
        return window.__aipmAnnoStore.createAnnotation({ requestId: crypto.randomUUID(), page: location.pathname,
          body: 'Quota window setup', color: 'yellow', style: 'highlight', visibility: 'private',
          target: { scope: 'page', selectors: [] } }, { token: auth.token(), isCurrent: () => true });
      });
      assert.equal(filled.outcome, 'succeeded');
      const proposal = await mount({ visibility: 'private', body: 'Review rejected request' });
      await confirm();
      await page.waitForSelector('loc=css:#state:has-text("写入过于频繁，未保存")', { state: 'visible', timeout: 10000 });
      let after = await state();
      assert.equal(after.requests.filter(row => row.method === 'POST' && row.path === '/api/annotations').at(-1).status, 429);
      assert.equal(after.annotations.some(record => record.requestId === proposal.requestId), false);
      await page.reload();
      await ready();
      assert.equal(await restore(proposal), 'failed');
      await new Promise(resolve => setTimeout(resolve, 3100));
      await confirm();
      await saved('仅自己可见');
      after = await state();
      const annotation = after.annotations.find(record => record.requestId === proposal.requestId);
      assert.ok(annotation);
      assert.equal(after.annotations.filter(record => record.requestId === proposal.requestId).length, 1);
      await marked(annotation.id);
      result.observations.push({ initialStatus: 429, restoredStatus: 'failed', annotationId: annotation.id });
    } else if (phase === 'unknown') {
      await login();
      const proposal = await mount({ visibility: 'public', body: 'Review interrupted response' });
      await control('/drop-write-response');
      await confirm();
      await page.waitForSelector('loc=css:#state:has-text("结果未知")', { state: 'visible', timeout: 10000 });
      await page.reload();
      await ready();
      assert.equal(await restore(proposal), 'unknown');
      await page.press('loc=css:#check', 'Enter');
      await saved('公开');
      const after = await state();
      const annotation = after.annotations.find(record => record.requestId === proposal.requestId);
      assert.ok(annotation);
      await marked(annotation.id);
      assert.equal(after.requests.filter(row => row.method === 'POST' && row.path === '/api/annotations').length, 1);
      result.observations.push({ annotationId: annotation.id, createRequests: 1, queryRecovered: true });
    } else if (phase === 'manual') {
      await login();
      await page.click('button[aria-label="打开批注面板"]');
      if (await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent !== '评论')) {
        await page.press('.aipm-anno__title', 'Enter');
      }
      await page.click('[data-action="new-comment"]');
      await page.fill('textarea[aria-label="评论正文"]', 'Review manual creation');
      await page.click('.aipm-anno__visbtn');
      await page.press('.aipm-anno__vislist [data-vis="private"]', 'Enter');
      await page.press('.aipm-anno__save', 'Enter');
      await page.waitForFunction(() => !document.querySelector('.aipm-anno__composer') &&
        document.querySelector('.aipm-anno__list').textContent.includes('Review manual creation'));
      const after = await state();
      const annotation = after.annotations.find(record => record.body === 'Review manual creation');
      assert.equal(annotation.visibility, 'private');
      assert.equal(annotation.target.scope, 'page');
      assert.equal(after.requests.filter(row => row.method === 'POST' && row.path === '/api/annotations').length, 1);
      result.observations.push({ annotationId: annotation.id, visibility: annotation.visibility, createRequests: 1 });
    } else if (phase === 'upload') {
      await login();
      const proposal = await mount({ body: 'Review local upload' });
      await confirm();
      await saved('仅本机');
      const local = await page.evaluate(id => window.__aipmAnnoStore.localList(location.pathname)
        .find(record => record.requestId === id), proposal.requestId);
      await page.click('button[aria-label="打开批注面板"]');
      if (await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent !== '批注')) {
        await page.press('.aipm-anno__title', 'Enter');
      }
      await page.press(`[data-anno-id="${local.id}"] [data-action="upload-private"]`, 'Enter');
      await page.waitForFunction(id => Boolean(window.__aipmAnnoStore.serverIdOf(id)), local.id);
      const remoteId = await page.evaluate(id => window.__aipmAnnoStore.serverIdOf(id), local.id);
      await marked(remoteId);
      const after = await state();
      const annotation = after.annotations.find(record => record.id === remoteId);
      assert.equal(annotation.body, 'Review local upload');
      assert.equal(annotation.visibility, 'private');
      assert.equal(after.requests.filter(row => row.method === 'POST' && row.path === '/api/annotations').length, 1);
      result.observations.push({ localId: local.id, remoteId, createRequests: 1 });
    } else if (phase === 'navigation') {
      const documentId = await page.evaluate(() => {
        window.__reviewNavigationDocument = crypto.randomUUID();
        return window.__reviewNavigationDocument;
      });
      await page.press('loc=css:img + .aipm-chart__ask', 'Enter');
      const deadline = Date.now() + 5000;
      while (!(await state()).imageStarted && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      assert.equal((await state()).imageStarted, true);
      await page.click('#review-navigation');
      await page.waitForURL(config.site + '/ai/review-next/');
      assert.equal(await page.evaluate(() => window.__reviewNavigationDocument), documentId);
      await control('/release-image');
      await page.waitForFunction(() => performance.getEntriesByType('resource')
        .some(resource => resource.name.includes('bytedance_developer_ai_pm_jd_01.png') && resource.initiatorType === 'fetch'));
      assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-chat__ctx-chip').length), 0);
      result.observations.push({ destination: await page.url(), instantNavigation: true, contextCount: 0 });
    } else if (phase === 'controls') {
      await page.evaluate(() => window.__aipmAnnoAuth.logout());
      await page.reload();
      await ready();
      await page.click('button[aria-label="打开批注面板"]');
      const previous = await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent);
      await page.press('.aipm-anno__head-icon', 'Enter');
      assert.notEqual(await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent), previous);
      await login();
      await page.click('button[aria-label="打开批注面板"]');
      const current = await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent);
      await page.press('.aipm-anno__head-icon', 'Enter');
      await page.waitForFunction(() => document.querySelector('.aipm-anno__smartbar').textContent.includes('智能高亮未启用'));
      assert.equal(await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent), current);
      const after = await state();
      const request = after.requests.filter(row => row.path === '/api/highlight/suggest' && row.body.refresh === true).at(-1);
      assert.ok(request);
      assert.ok(request.body.blocks.length > 0);
      assert.equal(request.status, 503);
      result.observations.push({ anonymousSwitch: true, adminRetainedList: current, refreshStatus: 503 });
    } else if (phase === 'integrity') {
      const before = (await state()).requests.filter(row => row.method === 'POST').length;
      await page.cdp('Network.setBlockedURLs', { urls: ['*/_static/js/annotation-consent-core.js*'] });
      await page.reload();
      await page.waitForFunction(() => window.__aipmIntegrityFailed === true);
      assert.equal(await page.evaluate(() => window.__aipmIntegrityReady), false);
      assert.equal((await state()).requests.filter(row => row.method === 'POST').length, before);
      result.observations.push({ integrityFailed: true, writes: 0 });
      await page.cdp('Network.setBlockedURLs', { urls: [] });
      await page.reload();
      await ready();
    } else if (phase === 'model') {
      assert.equal(config.modelEnabled, true);
      await page.click('.aipm-chat__fab');
      await page.fill('.aipm-chat__input', '请使用 propose_annotation 工具，对当前文章建立一条仅本机的全页评论，body 为“Review model proposal”。只生成一条建议。');
      await page.press('.aipm-chat__input', 'Enter');
      await page.waitForSelector('.aipm-chat__proposal-accept:not([disabled])', { state: 'visible', timeout: 90000 });
      await page.press('.aipm-chat__proposal-accept', 'Enter');
      await confirm();
      await saved('仅本机');
      const after = await state();
      assert.ok(after.modelRequests > 0);
      assert.ok(after.modelResponses.every(response => response.status === 200));
      result.observations.push({ modelRequests: after.modelRequests, modelResponses: after.modelResponses,
        saved: await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname)
          .filter(annotation => annotation.body.includes('Review model proposal')).length) });
      assert.equal(result.observations.at(-1).saved, 1);
    } else throw new Error('unknown acceptance phase');
    result.status = 'passed';
    delete result.step;
  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
    throw error;
  } finally {
    await writeFile(`${directory}/${phase}.json`, JSON.stringify(result, null, 2));
    console.log(result);
  }
  return result;
}
