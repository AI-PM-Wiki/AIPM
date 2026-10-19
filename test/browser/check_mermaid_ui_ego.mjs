import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkMermaidUi({ directory, taskSpace, spaceId }) {
  const config = JSON.parse(await readFile(directory + '/runtime-config.json', 'utf8'));
  const page = (await taskSpace(spaceId)).page('p1');
  await page.goto(config.site + '/ai/rag/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__aipmIntegrityReady && document.querySelector('.mermaid-zoom__trigger'));
  const records = [];
  const trigger = '.mermaid-zoom__trigger >> nth=0';
  const dialog = '#aipm-mermaid-dialog';
  const fitted = () => page.waitForFunction(() => {
    const viewport = document.querySelector('.mermaid-zoom__viewport').getBoundingClientRect();
    const graph = document.querySelector('.mermaid-zoom__canvas > .mermaid').getBoundingClientRect();
    return graph.left >= viewport.left && graph.right <= viewport.right &&
      graph.top >= viewport.top && graph.bottom <= viewport.bottom &&
      Math.abs(graph.left + graph.width / 2 - viewport.left - viewport.width / 2) < 2 &&
      Math.abs(graph.top + graph.height / 2 - viewport.top - viewport.height / 2) < 2;
  });
  let fitIcon;
  for (const width of [1440, 1024, 390, 320]) {
    for (const theme of ['default', 'slate']) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(theme => document.body.setAttribute('data-md-color-scheme', theme), theme);
      const original = await page.evaluate(() => document.querySelector('.mermaid-zoom__figure > .mermaid').getAttribute('style'));
      await page.focus(trigger);
      await page.press(trigger, 'Enter');
      await page.waitForSelector(dialog + '[open]', { state: 'visible' });
      await fitted();
      const geometry = await page.evaluate(() => {
        const root = document.querySelector('#aipm-mermaid-dialog');
        const header = root.querySelector('header').getBoundingClientRect();
        const actions = root.querySelector('.mermaid-zoom__actions').getBoundingClientRect();
        const close = root.querySelector('[data-mermaid-action="close"]').getBoundingClientRect();
        const fit = root.querySelector('[data-mermaid-action="fit"]');
        return { dialog: root.getBoundingClientRect().toJSON(), header: header.toJSON(),
          rootLocked: getComputedStyle(document.documentElement).overflowY === 'hidden',
          viewportWidth: document.documentElement.clientWidth,
          actions: actions.toJSON(), close: close.toJSON(), fitText: fit.textContent,
          fitIcon: fit.querySelector('svg').innerHTML,
          buttons: [...root.querySelectorAll('button')].map(button => button.getBoundingClientRect().toJSON()) };
      });
      assert.ok(geometry.header.height <= 68);
      assert.equal(geometry.rootLocked, true);
      assert.equal(geometry.viewportWidth, width);
      assert.ok(Math.abs(geometry.actions.top + geometry.actions.height / 2 - geometry.close.top - geometry.close.height / 2) < 1);
      assert.ok(geometry.buttons.every(button => button.width >= 44 && button.height >= 44));
      assert.ok(geometry.actions.left >= geometry.dialog.left && geometry.close.right <= geometry.dialog.right);
      assert.equal(geometry.fitText, '');
      if (width < 768) {
        assert.equal(geometry.dialog.width, width);
        assert.equal(geometry.dialog.height, 900);
        assert.equal(geometry.dialog.top, 0);
      }
      fitIcon = geometry.fitIcon;
      const scale = () => page.evaluate(() => Number(document.querySelector('.mermaid-zoom__scale').textContent.replace('%', '')));
      const initialScale = await scale();
      await page.click(dialog + ' [data-mermaid-action="zoom-in"]');
      assert.ok(await scale() > initialScale);
      await page.click(dialog + ' [data-mermaid-action="zoom-out"]');
      const point = await page.evaluate(() => {
        const viewport = document.querySelector('.mermaid-zoom__viewport').getBoundingClientRect();
        return { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
      });
      const beforeWheel = await scale();
      await page.mouse.move(point.x, point.y, { label: 'zoom diagram at center' });
      await page.mouse.wheel(0, -120);
      await page.waitForFunction(before => Number(document.querySelector('.mermaid-zoom__scale').textContent.replace('%', '')) > before, beforeWheel);
      const beforeDrag = await page.evaluate(() => document.querySelector('.mermaid-zoom__canvas').style.transform);
      await page.mouse.move(point.x, point.y, { label: 'pan diagram across canvas' });
      await page.mouse.down();
      await page.mouse.move(point.x + 50, point.y + 30, { label: 'move diagram within canvas' });
      await page.mouse.up();
      assert.notEqual(await page.evaluate(() => document.querySelector('.mermaid-zoom__canvas').style.transform), beforeDrag);
      await page.click(dialog + ' [data-mermaid-action="fit"]');
      await fitted();
      await page.focus(dialog + ' [data-mermaid-action="zoom-out"]');
      await page.press(dialog + ' [data-mermaid-action="zoom-out"]', 'Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('mermaid-zoom__viewport')), true);
      await page.press('.mermaid-zoom__viewport', 'Tab');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-mermaid-action')), 'zoom-out');
      if (width === 1440 && theme === 'default') await page.screenshot({ path: directory + '/mermaid-desktop.png' });
      if (width === 390 && theme === 'slate') await page.screenshot({ path: directory + '/mermaid-mobile.png' });
      await page.press(dialog + ' [data-mermaid-action="fit"]', 'Escape');
      await page.waitForFunction(() => !document.querySelector('#aipm-mermaid-dialog').open);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('mermaid-zoom-open')), false);
      assert.equal(await page.evaluate(() => document.querySelector('.mermaid-zoom__figure > .mermaid').getAttribute('style')), original);
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('mermaid-zoom__trigger')), true);
      records.push({ width, theme, geometry, initialFit: true, buttonZoom: true, wheelZoom: true, drag: true, focus: true, sourceRestored: true });
      console.log({ width, theme, passed: true });
    }
  }
  await page.click('button[aria-label="AI 总结"]');
  await page.waitForSelector('#aipm-summary button[aria-label="适应窗口"]', { state: 'attached', timeout: 30000 });
  assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary button[aria-label="适应窗口"] svg').innerHTML), fitIcon);
  await page.click('#aipm-summary .aipm-summary__head button');
  await writeFile(directory + '/mermaid-ui-results.json', JSON.stringify({ records, sharedFitIcon: true }, null, 2));
  console.log({ scenes: records.length, sharedFitIcon: true });
}
