import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkArticleSummary({ directory, taskSpace, spaceId, phase = 'inspect' }) {
  const config = JSON.parse(await readFile(directory + '/runtime-config.json', 'utf8'));
  const task = await taskSpace(spaceId ?? 'AI-PM issue 123 article summary');
  const page = task.page('p1');
  await writeFile(directory + '/browser-space.json', JSON.stringify({ id: task.spaceId }));
  if (phase === 'inspect') {
    await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
    });
    await page.goto(config.site + '/ai/rag/');
    await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat);
    console.log({ spaceId: task.spaceId });
    console.log(await page.snapshot());
    return { spaceId: task.spaceId };
  }
  if (phase === 'followup') {
    if (await page.evaluate(() => document.querySelector('#aipm-summary').inert)) {
      await page.click('button[aria-label="AI 总结"]');
    }
    await page.waitForSelector('#aipm-summary .aipm-summary__footer button', { state: 'visible' });
    await page.click('#aipm-summary .aipm-summary__footer button');
    await page.fill('.aipm-chat__input', '根据以上总结，说明为什么引用不能替代事实核对，80字以内。');
    await page.press('.aipm-chat__input', 'Enter');
    await page.waitForFunction(() => {
      const history = JSON.parse(localStorage.getItem('aipm-chat-history') || '[]');
      return history.at(-1)?.role === 'assistant' && history.at(-1)?.terminal === 'done';
    }, undefined, { timeout: 180000 });
    const state = await (await fetch(config.control)).json();
    assert.equal(state.summaryInFollowup, true);
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem('aipm-chat-history')).at(-1));
    assert.ok(last.content.length > 20);
    assert.equal(last.terminal, 'done');
    const result = { completeSummaryPassedToRealModel: true, modelRequests: state.modelRequests,
      answer: last.content };
    await writeFile(directory + '/followup-results.json', JSON.stringify(result, null, 2));
    console.log(result);
    return { spaceId: task.spaceId, result };
  }
  if (phase === 'offline') {
    await page.reload();
    await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat);
    await page.cdp('Network.enable', {});
    await page.cdp('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await page.click('button[aria-label="AI 总结"]');
    await page.waitForSelector('#aipm-summary .aipm-summary__status button', { state: 'visible' });
    assert.ok(await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__status').textContent.includes('网络连接失败')));
    await page.cdp('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await page.click('#aipm-summary .aipm-summary__status button');
    await page.waitForSelector('#aipm-summary .aipm-summary__diagram svg', { state: 'attached', timeout: 30000 });
    const result = { offlineFailureShown: true, explicitRetrySucceeded: true };
    await writeFile(directory + '/offline-results.json', JSON.stringify(result, null, 2));
    console.log(result);
    return { spaceId: task.spaceId, result };
  }
  if (phase === 'diagram-retry') {
    await page.cdp('Network.enable', {});
    await page.cdp('Network.setBlockedURLs', { urls: ['https://unpkg.com/mermaid*'] });
    await page.goto(config.site + '/intro/faq/');
    await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmSummary);
    assert.equal(await page.evaluate(() => !!window.mermaid?.render), false);
    const { summary } = await (await fetch(config.control)).json();
    await page.evaluate(summary => {
      const host = document.createElement('section');
      host.id = 'summary-independent-host';
      document.querySelector('.md-content__inner').prepend(host);
      window.__aipmSummary.createView({ host, navigate: (page, anchor) =>
        location.assign(page + '#' + encodeURIComponent(anchor)) }).setData(summary);
    }, summary);
    await page.waitForSelector('#summary-independent-host .aipm-summary__status button', { state: 'visible' });
    await page.cdp('Network.setBlockedURLs', { urls: [] });
    const started = Date.now();
    await page.click('#summary-independent-host .aipm-summary__status button');
    await page.waitForFunction(() => !!document.querySelector('#summary-independent-host .aipm-summary__diagram svg'),
      undefined, { timeout: 30000 });
    const result = { independentHost: true, actualRendererLoadFailure: true, explicitRedrawSucceeded: true,
      redrawMs: Date.now() - started };
    await writeFile(directory + '/diagram-results.json', JSON.stringify(result, null, 2));
    console.log(result);
    return { spaceId: task.spaceId, result };
  }
  const state = async () => (await fetch(config.control)).json();
  const baseline = await state();
  assert.ok([0, 2].includes(baseline.http.generationRequests));
  const before = baseline.modelRequests;
  const summary = baseline.summary;
  const records = [];
  for (const width of [1280, 390, 320]) {
    for (const theme of ['default', 'slate']) {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await page.evaluate(theme => document.body.setAttribute('data-md-color-scheme', theme), theme);
      if (await page.evaluate(() => document.querySelector('#aipm-summary').inert)) {
        await page.click('button[aria-label="AI 总结"]');
      }
      await page.waitForSelector('#aipm-summary .aipm-summary__diagram svg', { state: 'attached', timeout: 30000 });
      const mapTab = '#aipm-summary [role="tab"]:text-is("思维导图")';
      await page.click(mapTab);
      const graphIndex = summary.mindmap.branches.findIndex(branch => branch.anchor);
      assert.ok(graphIndex >= 0);
      const graph = '#aipm-summary .aipm-summary__diagram [data-summary-branch="' + graphIndex + '"] >> nth=0';
      assert.ok(await page.evaluate(index => !!document.querySelector('#aipm-summary [data-summary-branch="' + index + '"]'), graphIndex));
      await page.focus(graph);
      await page.press(graph, 'Enter');
      const anchor = summary.mindmap.branches[graphIndex].anchor;
      await page.waitForFunction(anchor => document.activeElement?.id === anchor, anchor);
      if (width < 1200) {
        assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').inert), true);
        await page.click('button[aria-label="AI 总结"]');
      }
      await page.focus(mapTab);
      await page.press(mapTab, 'ArrowRight');
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary [aria-selected="true"]').textContent), 'AI 精读');
      const reading = summary.reading.sections.find(section => section.anchor);
      const href = summary.page + '#' + encodeURIComponent(reading.anchor);
      await page.click('#aipm-summary [role="tabpanel"]:not([hidden]) a[href="' + href + '"]');
      await page.waitForFunction(anchor => document.activeElement?.id === anchor, reading.anchor);
      if (width < 1200) await page.click('button[aria-label="AI 总结"]');
      const geometry = await page.evaluate(() => {
        const panel = document.querySelector('#aipm-summary').getBoundingClientRect();
        return { width: panel.width, left: panel.left, right: panel.right, bottom: panel.bottom,
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
          active: window.__aipmPanels.active() };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1);
      assert.ok(geometry.bottom <= geometry.viewportHeight + 1);
      assert.equal(geometry.overflow, false);
      assert.equal(geometry.active, 'summary');
      records.push({ width, theme, graphAnchor: anchor, readingAnchor: reading.anchor, geometry });
      await page.press('#aipm-summary .aipm-summary__head button', 'Escape');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'AI 总结');
    }
  }
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.click('button[aria-label="AI 总结"]');
  await page.click('#aipm-summary .aipm-summary__footer button');
  await page.waitForSelector('#aipm-chat .aipm-summary-view', { state: 'visible' });
  assert.equal(await page.evaluate(() => window.__aipmPanels.active()), 'chat');
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').inert), true);
  await page.waitForSelector('#aipm-chat .aipm-summary__diagram svg', { state: 'attached', timeout: 30000 });
  await page.click('#aipm-chat button[aria-label="全屏显示"]');
  await page.waitForSelector('.aipm-summary__fullscreen[open]', { state: 'visible' });
  await page.press('.aipm-summary__fullscreen[open] button[aria-label="退出全屏"]', 'Escape');
  await page.waitForSelector('#aipm-chat .aipm-summary__diagram svg', { state: 'attached' });
  assert.equal(await page.evaluate(() => window.__aipmPanels.active()), 'chat');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aipm-chat-history')));
  assert.equal(stored.at(-1).summary.revision, summary.revision);
  assert.ok(stored.at(-1).content.includes(summary.reading.overview));
  await page.reload();
  await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#aipm-chat .aipm-summary-view').length), 1);
  await page.click('button[aria-label="AI 总结"]');
  await page.waitForSelector('#aipm-summary .aipm-summary__diagram svg', { state: 'attached', timeout: 30000 });
  assert.equal((await state()).modelRequests, before);
  const result = { records, modelRequestsBefore: before, modelRequestsAfter: (await state()).modelRequests,
    reusedInAssistant: true, restoredAfterReload: true, cacheReused: true };
  await writeFile(directory + '/browser-results.json', JSON.stringify(result, null, 2));
  console.log(result);
  console.log(await page.snapshot());
  return { spaceId: task.spaceId, result };
}
