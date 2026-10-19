import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';

export async function checkSummaryAgent({ directory, taskSpace, spaceId, phase }) {
  const config = JSON.parse(await readFile(directory + '/runtime-config.json', 'utf8'));
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('aipm-chat-history') || '[]'));
  const activate = async selector => {
    await page.focus(selector);
    if (phase === 'pointer') {
      await page.waitForFunction(() => !document.getAnimations().some(animation => {
        const target = animation.effect?.target;
        return animation.playState === 'running' && target instanceof Element && target.closest('#aipm-summary, #aipm-chat');
      }));
      await page.click(selector);
    } else await page.press(selector, 'Enter');
  };
  const showSummary = async () => {
    if (await page.evaluate(() => window.__aipmChat.isOpen())) {
      await page.press('.aipm-chat__input', 'Escape');
      await page.waitForFunction(() => !window.__aipmChat.isOpen() && !history.state?.aipmChat);
    }
    if (await page.evaluate(() => document.querySelector('#aipm-summary').hidden)) await activate('button[aria-label="AI 总结"]');
    await page.waitForFunction(() => window.__aipmPanels.active() === 'summary');
    await page.waitForSelector('#aipm-summary .aipm-summary__diagram svg', { state: 'attached', timeout: 30000 });
  };
  const send = async question => {
    if (!await page.evaluate(() => window.__aipmChat.isOpen())) await page.click('.aipm-chat__fab');
    const count = (await state()).length;
    await page.fill('.aipm-chat__input', question);
    await page.press('.aipm-chat__input', 'Enter');
    await page.waitForFunction(count => {
      const records = JSON.parse(localStorage.getItem('aipm-chat-history') || '[]');
      return records.length > count && !document.querySelector('button[aria-label="停止生成"]');
    }, count, { timeout: 180000 });
    const last = (await state()).at(-1);
    assert.equal(last.terminal, 'done', JSON.stringify(last));
    return last;
  };
  let result;
  if (['mindmap', 'reading', 'uncached', 'sources'].includes(phase)) {
    const beforeCache = phase === 'uncached' ? await readdir(directory + '/summaries') : [];
    await page.goto(config.site + (phase === 'uncached' ? '/intro/faq/' : '/ai/rag/'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat);
    const view = phase === 'mindmap' || phase === 'sources' ? 'mindmap' : 'reading';
    const last = await send(phase === 'sources'
      ? '请使用 search_wiki 检索 RAG 的引用正确率，读取当前文章，再展示当前文章的思维导图。'
      : view === 'mindmap' ? '请展示当前文章的思维导图。' : '请展示当前文章的 AI 精读。');
    assert.ok(last.summary);
    assert.equal(last.summaryView, view);
    assert.equal(last.summary.page, phase === 'uncached' ? '/intro/faq/' : '/ai/rag/');
    const host = '.aipm-chat__msg--ai:last-child .aipm-summary-view';
    await page.waitForSelector(host, { state: 'visible' });
    if (view === 'mindmap') await page.waitForSelector(host + ' .aipm-summary__diagram svg', { state: 'attached', timeout: 30000 });
    assert.equal(await page.evaluate(selector => document.querySelector(selector + ' [aria-selected="true"]').textContent,
      host), view === 'mindmap' ? '思维导图' : 'AI 精读');
    assert.ok(last.content.length > 0);
    if (phase === 'sources') {
      assert.ok(await page.evaluate(() => document.querySelectorAll('.aipm-chat__msg--ai:last-child .aipm-chat__sources a').length > 0));
    }
    result = { actualModelToolRendered: true, view, page: last.summary.page, revision: last.summary.revision,
      answer: last.content, summarySurvivedTextStreaming: true };
    if (phase === 'uncached') {
      const added = (await readdir(directory + '/summaries')).filter(name => name.endsWith('.json') && !beforeCache.includes(name));
      assert.deepEqual(added, [last.summary.revision + '.json']);
      result.firstGenerationThroughAgentTool = true;
    }
    await page.reload();
    await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat);
    if (!await page.evaluate(() => window.__aipmChat.isOpen())) await page.click('.aipm-chat__fab');
    assert.equal((await state()).at(-1).summaryView, view);
    assert.equal(await page.evaluate(selector => document.querySelector(selector + ' [aria-selected="true"]').textContent,
      host), view === 'mindmap' ? '思维导图' : 'AI 精读');
    result.restoredAfterReload = true;
  } else if (phase === 'topics' || phase === 'pointer') {
    await page.goto(config.site + '/ai/rag/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat);
    await showSummary();
    const before = (await state()).filter(turn => turn.summary).length;
    const layouts = [];
    for (const width of [1280, 390, 320]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const view of ['mindmap', 'reading']) {
        console.log({ phase, width, view });
        await showSummary();
        await activate('#aipm-summary [role="tab"]:text-is("' + (view === 'mindmap' ? '思维导图' : 'AI 精读') + '")');
        await activate('#aipm-summary [role="tabpanel"]:not([hidden]) .aipm-summary__topic-discuss >> nth=0');
        assert.equal(await page.evaluate(() => window.__aipmPanels.active()), 'chat');
        await page.waitForFunction(() => {
          const chips = [...document.querySelectorAll('.aipm-chat__ctx-chip[data-kind="summary"]')];
          return chips.length > 0 && chips.every(chip => {
            const rect = chip.getBoundingClientRect();
            return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth + 1;
          });
        }, undefined, { timeout: 3000 });
        const topic = await page.evaluate(() => {
          const chips = [...document.querySelectorAll('.aipm-chat__ctx-chip[data-kind="summary"]')];
          const rectangles = chips.map(chip => chip.getBoundingClientRect());
          return { count: chips.length, text: chips.map(chip => chip.textContent).join('\n'),
            inside: rectangles.every(rect => rect.left >= 0 && rect.right <= innerWidth + 1),
            inputFocused: document.activeElement?.classList.contains('aipm-chat__input') };
        });
        assert.ok(topic.count >= 1 && topic.count <= 2);
        assert.equal(topic.inside, true, JSON.stringify({ width, view, topic }));
        assert.equal(topic.inputFocused, true);
        const count = topic.count;
        await showSummary();
        await activate('#aipm-summary [role="tabpanel"]:not([hidden]) .aipm-summary__topic-discuss >> nth=0');
        assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-chat__ctx-chip[data-kind="summary"]').length), count);
        layouts.push({ width, view, topic });
      }
    }
    assert.equal((await state()).filter(turn => turn.summary).length, before);
    result = { layouts, repeatedTopicDeduplicated: true, existingSummaryReused: true };
    if (phase === 'topics') {
      const last = await send('请解释所选主题之间的关系，引用本文原文，100 字以内。');
      const records = await state();
      assert.equal(records.at(-2).context.filter(item => item.kind === 'summary').length, 2);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-chat__ctx-chip').length), 0);
      const service = await (await fetch(config.control)).json();
      assert.equal(service.summaryTopicsInFollowup, true);
      assert.equal(last.terminal, 'done');
      Object.assign(result, { selectedTopicsReachedRealModel: true, sentTopicsRemovedFromComposer: true, answer: last.content });
    } else result.pointerActivation = true;
  } else if (phase === 'navigation') {
    await page.cdp('Network.enable', {});
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(config.site + '/ai/rag/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat &&
      performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/sitemap.xml') && entry.responseEnd > 0));
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await showSummary();
    await page.waitForSelector('#aipm-summary [role="tabpanel"]:not([hidden]) .aipm-summary__topic-discuss', { state: 'visible' });
    await activate('#aipm-summary [role="tabpanel"]:not([hidden]) .aipm-summary__topic-discuss >> nth=0');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-chat__ctx-chip[data-kind="summary"]').length), 1);
    await page.press('.aipm-chat__input', 'Escape');
    await page.waitForFunction(() => !window.__aipmChat.isOpen() && !history.state?.aipmChat);
    const identity = await page.evaluate(() => (window.__summaryNavigationIdentity = crypto.randomUUID()));
    await page.click('loc=href:/ai/agent/');
    await page.waitForURL(config.site + '/ai/agent/');
    await page.waitForFunction(() => document.querySelector('.md-content__inner h1')?.textContent.includes('Agent') &&
      location.pathname === '/ai/agent/' && document.querySelectorAll('.aipm-chat__ctx-chip[data-kind="summary"]').length === 0);
    assert.equal(await page.evaluate(() => window.__summaryNavigationIdentity), identity);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-chat__ctx-chip[data-kind="summary"]').length), 0);
    const invalid = await page.evaluate(() => {
      const old = JSON.parse(localStorage.getItem('aipm-chat-history')).find(turn => turn.summary?.page === '/ai/rag/');
      return window.__aipmChat.openSummary(old.summary, { view: 'reading', index: 0 });
    });
    assert.equal(invalid.ok, false);
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
    result = { instantNavigation: true, currentPageContextCleared: true, previousArticleSummaryRejected: true };
  } else {
    throw new Error('unknown summary Agent check phase');
  }
  await writeFile(directory + '/agent-' + phase + '.json', JSON.stringify(result, null, 2));
  console.log({ spaceId: task.spaceId, phase, result });
  return { spaceId: task.spaceId, result };
}
