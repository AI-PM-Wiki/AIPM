import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkArticleSummaryUi({ directory, taskSpace, spaceId }) {
  const config = JSON.parse(await readFile(directory + '/runtime-config.json', 'utf8'));
  const baseline = await (await fetch(config.control)).json();
  const summary = baseline.summary;
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  await page.goto(config.site + '/ai/rag/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmSummary);
  const records = [];
  const compactCount = summary.mindmap.branches.length + 1;
  const expandedCount = compactCount + summary.mindmap.branches.reduce((sum, branch) => sum + branch.points.length, 0);
  for (const width of [1440, 1024, 390, 320]) {
    for (const theme of ['default', 'slate']) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false });
      const previous = await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__diagram svg')?.id);
      await page.evaluate(theme => document.body.setAttribute('data-md-color-scheme', theme), theme);
      await page.mouse.move(8, 8, { label: 'observe assistant resting appearance' });
      await page.waitForSelector('.aipm-chat__fab:not(.is-hidden)', { state: 'visible' });
      await page.waitForFunction(() => {
        const style = getComputedStyle(document.querySelector('.aipm-chat__fab'));
        return style.transform === 'none' && style.opacity === '1';
      });
      const fab = await page.evaluate(() => {
        const button = document.querySelector('.aipm-chat__fab');
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { width: rect.width, height: rect.height, radius: style.borderRadius,
          text: button.textContent, label: button.getAttribute('aria-label'), title: button.title,
          background: style.backgroundImage, color: style.color, svg: !!button.querySelector('svg') };
      });
      assert.ok(Math.abs(fab.width - fab.height) < 1 && fab.width >= 44);
      assert.equal(fab.radius, '50%');
      assert.equal(fab.text, '');
      assert.equal(fab.label, '询问助手');
      assert.equal(fab.title, '询问助手');
      assert.equal(fab.svg, true);
      console.log({ width, theme, stage: 'fab-ready' });
      if (width === 1440 && theme === 'default') {
        const anchor = await page.evaluate(() => {
          const rect = document.querySelector('.aipm-chat__fab').getBoundingClientRect();
          return { x: rect.x, y: rect.y };
        });
        await page.evaluate(() => {
          const button = document.querySelector('.aipm-chat__fab');
          window.__aipmFabDragSeen = false;
          window.__aipmFabDragObserver = new MutationObserver(records => {
            if (button.classList.contains('is-dragging') || records.some(record => record.oldValue.includes('is-dragging'))) {
              window.__aipmFabDragSeen = true;
            }
          });
          window.__aipmFabDragObserver.observe(button, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
        });
        await page.dragAndDrop('.aipm-chat__fab', '.md-content__inner', { targetPosition: { x: 100, y: 100 }, label: 'drag circular assistant entry' });
        await page.waitForFunction(({ x, y }) => {
          const button = document.querySelector('.aipm-chat__fab');
          const rect = button.getBoundingClientRect();
          return window.__aipmFabDragSeen && !button.classList.contains('is-returning') &&
            Math.abs(rect.x - x) < 1 && Math.abs(rect.y - y) < 1;
        }, anchor);
        await page.evaluate(() => window.__aipmFabDragObserver.disconnect());
        console.log({ width, theme, stage: 'drag-returned' });
        assert.equal(await page.evaluate(() => window.__aipmChat.isOpen()), false);
        await page.focus('.aipm-chat__fab');
        await page.press('.aipm-chat__fab', 'Enter');
        await page.waitForFunction(() => window.__aipmChat.isOpen());
        console.log({ width, theme, stage: 'keyboard-open' });
        await page.press('.aipm-chat__input', 'Escape');
        await page.waitForFunction(() => !window.__aipmChat.isOpen());
      }
      if (await page.evaluate(() => document.querySelector('#aipm-summary').inert)) await page.click('button[aria-label="AI 总结"]');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#aipm-summary')).transform === 'none');
      if (width < 768) {
        await page.click('#aipm-summary .aipm-summary__grip');
        await page.waitForFunction(() => Math.abs(document.querySelector('#aipm-summary').getBoundingClientRect().height - (innerHeight - 16)) < 1);
      }
      await page.click('#aipm-summary [role="tab"]:text-is("思维导图")');
      await page.waitForFunction(({ count, previous }) => {
        const svg = document.querySelector('#aipm-summary .aipm-summary__diagram svg');
        return svg && svg.id !== previous && svg.querySelectorAll('.node').length === count;
      }, { count: compactCount, previous }, { timeout: 30000 });
      console.log({ width, theme, stage: 'compact' });
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__detail-toggle').getAttribute('aria-pressed')), 'false');
      const compactIcon = await page.evaluate(() => {
        const button = document.querySelector('#aipm-summary .aipm-summary__detail-toggle');
        return { text: button.textContent, label: button.getAttribute('aria-label'), title: button.title,
          path: button.querySelector('svg path').getAttribute('d') };
      });
      assert.equal(compactIcon.text, '');
      assert.equal(compactIcon.label, '展开要点');
      assert.equal(compactIcon.title, '展开要点');
      if (width >= 1200) await page.waitForFunction(() =>
        Math.abs(document.querySelector('.md-header').getBoundingClientRect().right - document.querySelector('#aipm-summary').getBoundingClientRect().left) < 1);
      const dimensions = await page.evaluate(() => {
        const panel = document.querySelector('#aipm-summary');
        const footer = panel.querySelector('.aipm-summary__footer').getBoundingClientRect();
        const discuss = panel.querySelector('.aipm-summary__discuss').getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        const svg = panel.querySelector('.aipm-summary__diagram svg');
        const header = document.querySelector('.md-header').getBoundingClientRect();
        const discussStyle = getComputedStyle(panel.querySelector('.aipm-summary__discuss'));
        return { panel: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
          header: { right: header.right }, mode: panel.dataset.mode,
          footerInScrollArea: panel.querySelector('.aipm-summary__body').contains(panel.querySelector('.aipm-summary__footer')),
          footer: { top: footer.top, bottom: footer.bottom },
          discuss: { top: discuss.top, bottom: discuss.bottom, height: discuss.height,
            background: discussStyle.backgroundImage, color: discussStyle.color },
          compactHeight: svg.viewBox.baseVal.height, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(dimensions.panel.left >= 0 && dimensions.panel.right <= width + 1);
      assert.ok(dimensions.discuss.height >= 44);
      assert.equal(dimensions.discuss.background, fab.background);
      assert.equal(dimensions.discuss.color, fab.color);
      assert.equal(dimensions.footerInScrollArea, true);
      assert.ok(dimensions.footer.top > dimensions.panel.bottom);
      assert.equal(dimensions.mode, width >= 1200 ? 'dock' : width >= 768 ? 'overlay' : 'sheet');
      if (width >= 1200) {
        assert.equal(dimensions.panel.top, 0);
        assert.ok(Math.abs(dimensions.header.right - dimensions.panel.left) < 1);
      }
      assert.equal(dimensions.overflow, false);
      assert.ok(dimensions.compactHeight < 800);
      await page.focus('#aipm-summary .aipm-summary__detail-toggle');
      await page.press('#aipm-summary .aipm-summary__detail-toggle', 'Enter');
      await page.waitForFunction(count => document.querySelector('#aipm-summary .aipm-summary__diagram svg')?.querySelectorAll('.node').length === count, expandedCount, { timeout: 30000 });
      console.log({ width, theme, stage: 'expanded' });
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('aipm-summary__detail-toggle')), true);
      const expandedIcon = await page.evaluate(() => {
        const button = document.querySelector('#aipm-summary .aipm-summary__detail-toggle');
        return { text: button.textContent, label: button.getAttribute('aria-label'), title: button.title,
          pressed: button.getAttribute('aria-pressed'), path: button.querySelector('svg path').getAttribute('d') };
      });
      assert.equal(expandedIcon.text, '');
      assert.equal(expandedIcon.label, '收起要点');
      assert.equal(expandedIcon.title, '收起要点');
      assert.equal(expandedIcon.pressed, 'true');
      assert.notEqual(expandedIcon.path, compactIcon.path);
      await page.press('#aipm-summary .aipm-summary__detail-toggle', 'Enter');
      await page.waitForFunction(count => document.querySelector('#aipm-summary .aipm-summary__diagram svg')?.querySelectorAll('.node').length === count, compactCount, { timeout: 30000 });
      const scale = await page.evaluate(() => Number(document.querySelector('#aipm-summary .aipm-summary__scale').value.replace('%', '')));
      await page.click('#aipm-summary button[aria-label="放大"]');
      assert.ok(await page.evaluate(() => Number(document.querySelector('#aipm-summary .aipm-summary__scale').value.replace('%', ''))) > scale);
      await page.click('#aipm-summary .aipm-summary__zoom button[aria-label="适应窗口"]');
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary button[aria-label="适应窗口"]').textContent), '');
      await page.click('#aipm-summary button[aria-label="全屏显示"]');
      await page.waitForSelector('.aipm-summary__fullscreen[open] .aipm-summary__diagram svg', { state: 'visible' });
      console.log({ width, theme, stage: 'fullscreen' });
      const fullscreen = await page.evaluate(() => {
        const dialog = document.querySelector('.aipm-summary__fullscreen[open]');
        const rect = dialog.getBoundingClientRect();
        return { width: rect.width, height: rect.height, top: rect.top, left: rect.left,
          scrollLocked: getComputedStyle(document.documentElement).overflow === 'hidden' };
      });
      assert.equal(fullscreen.width, width);
      assert.equal(fullscreen.height, 960);
      assert.equal(fullscreen.top, 0);
      assert.equal(fullscreen.left, 0);
      assert.equal(fullscreen.scrollLocked, true);
      await page.click('.aipm-summary__fullscreen[open] button[aria-label="适应窗口"]');
      await page.press('.aipm-summary__fullscreen[open] button[aria-label="退出全屏"]', 'Escape');
      await page.waitForSelector('#aipm-summary .aipm-summary__diagram svg', { state: 'visible' });
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '全屏显示');
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').inert), false);
      const point = await page.evaluate(() => {
        const body = document.querySelector('#aipm-summary .aipm-summary__body');
        const rect = body.getBoundingClientRect();
        const x = rect.left + 8;
        const y = rect.top + 16;
        if (document.elementFromPoint(x, y) !== body) throw new Error('summary scroll target unavailable');
        return { x, y };
      });
      await page.mouse.move(point.x, point.y, { label: 'scroll summary content area' });
      const scrollTarget = await page.evaluate(() => {
        const body = document.querySelector('#aipm-summary .aipm-summary__body');
        return Math.min(body.scrollTop + 700, body.scrollHeight - body.clientHeight);
      });
      const footerBeforeScroll = await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__footer').getBoundingClientRect().top);
      await page.mouse.wheel(0, 700);
      await page.waitForFunction(target => Math.abs(document.querySelector('#aipm-summary .aipm-summary__body').scrollTop - target) < 2, scrollTarget);
      const footerTop = await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__footer').getBoundingClientRect().top);
      assert.ok(footerTop < footerBeforeScroll);
      const mapScroll = await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__body').scrollTop);
      await page.click('#aipm-summary [role="tab"]:text-is("AI 精读")');
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__body').scrollTop), 0);
      await page.click('#aipm-summary [role="tab"]:text-is("思维导图")');
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__body').scrollTop), mapScroll);
      await page.click('#aipm-summary [role="tab"]:text-is("AI 精读")');
      const typography = await page.evaluate(() => {
        const styles = getComputedStyle(document.querySelector('#aipm-summary .aipm-summary__overview'));
        return { fontSize: parseFloat(styles.fontSize), lineHeight: parseFloat(styles.lineHeight) };
      });
      assert.ok(typography.fontSize >= 14 && typography.lineHeight >= 24);
      if (width === 1440 && theme === 'default') await page.screenshot({ path: directory + '/reading-desktop.png' });
      if (width === 390 && theme === 'slate') await page.screenshot({ path: directory + '/reading-mobile.png' });
      records.push({ width, theme, compactCount, expandedCount, fab, compactIcon, expandedIcon, dimensions, typography,
        keyboardExpansion: true, zoom: true, scrollingFooter: true, independentTabScroll: true, fullscreen });
      console.log({ width, theme, stage: 'complete' });
      await page.press('#aipm-summary .aipm-summary__head button', 'Escape');
    }
  }
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await page.click('button[aria-label="AI 总结"]');
  const handle = '#aipm-summary .aipm-panel-resize';
  await page.focus(handle);
  await page.press(handle, 'End');
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').getBoundingClientRect().width), 640);
  const start = await page.evaluate(() => {
    const rect = document.querySelector('#aipm-summary').getBoundingClientRect();
    return { x: rect.left + 2, y: rect.top + 120 };
  });
  await page.mouse.move(start.x, start.y, { label: 'resize sidebar from edge' });
  await page.mouse.down();
  await page.mouse.move(1430, start.y, { label: 'shrink sidebar to minimum' });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').getBoundingClientRect().width), 320);
  await page.focus(handle);
  await page.press(handle, 'ArrowLeft');
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').getBoundingClientRect().width), 336);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat);
  await page.click('button[aria-label="AI 总结"]');
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').getBoundingClientRect().width), 336);
  await page.evaluate(() => window.__aipmPanels.claim('annotation'));
  assert.equal(await page.evaluate(() => window.__aipmPanels.active()), 'annotation');
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-annotations').getBoundingClientRect().width), 336);
  await page.evaluate(() => window.__aipmPanels.claim('chat'));
  assert.equal(await page.evaluate(() => window.__aipmPanels.active()), 'chat');
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-chat').getBoundingClientRect().width), 336);
  await page.evaluate(() => window.__aipmPanels.claim('summary'));
  await page.focus(handle);
  await page.press(handle, 'End');
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 960, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(() => document.querySelector('#aipm-summary').getBoundingClientRect().width === 480);
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 960, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(() => document.querySelector('#aipm-summary').dataset.mode === 'overlay');
  const backdropPoint = await page.evaluate(() => ({
    x: document.querySelector('#aipm-summary').getBoundingClientRect().left / 2,
    y: innerHeight / 2,
  }));
  await page.mouse.click(backdropPoint.x, backdropPoint.y, { label: 'close tablet overlay outside' });
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary').inert), true);
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 960, deviceScaleFactor: 1, mobile: false });
  await page.click('button[aria-label="AI 总结"]');
  const grip = '#aipm-summary .aipm-summary__grip';
  await page.click(grip);
  await page.waitForFunction(() => document.querySelector('#aipm-summary').getBoundingClientRect().height > 940);
  const gripPoint = await page.evaluate(() => {
    const rect = document.querySelector('#aipm-summary .aipm-summary__grip').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(gripPoint.x, gripPoint.y, { label: 'drag summary sheet grip' });
  await page.mouse.down();
  await page.mouse.move(gripPoint.x, 920, { label: 'close summary sheet downward' });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#aipm-summary').inert);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('aipm-summary-locked')), false);
  await page.focus('.mermaid-zoom__trigger >> nth=0');
  await page.press('.mermaid-zoom__trigger >> nth=0', 'Enter');
  await page.waitForSelector('#aipm-mermaid-dialog[open]', { state: 'visible' });
  const fitIcon = await page.evaluate(() => {
    const button = document.querySelector('#aipm-mermaid-dialog [data-mermaid-action="fit"]');
    return { text: button.textContent, label: button.getAttribute('aria-label'), svg: !!button.querySelector('svg') };
  });
  assert.equal(fitIcon.text, '');
  assert.equal(fitIcon.label, '适应窗口');
  assert.equal(fitIcon.svg, true);
  await page.click('#aipm-mermaid-dialog [data-mermaid-action="zoom-in"]');
  await page.click('#aipm-mermaid-dialog [data-mermaid-action="fit"]');
  await page.press('#aipm-mermaid-dialog [data-mermaid-action="fit"]', 'Escape');
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-mermaid-dialog').open), false);
  assert.equal((await (await fetch(config.control)).json()).modelRequests, baseline.modelRequests);
  await writeFile(directory + '/ui-results.json', JSON.stringify(records, null, 2));
  console.log({ scenes: records.length, compactCount, expandedCount, modelRequests: baseline.modelRequests,
    resize: { minimum: 320, maximum: 640, keyboard: true, persisted: true, sharedAcrossPanels: true }, sheetDrag: true, mermaidFitIcon: true });
  return { spaceId: task.spaceId, records };
}
