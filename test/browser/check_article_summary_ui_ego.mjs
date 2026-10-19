import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkArticleSummaryUi({ directory, taskSpace, spaceId }) {
  const config = JSON.parse(await readFile(directory + '/runtime-config.json', 'utf8'));
  const baseline = await (await fetch(config.control)).json();
  const summary = baseline.summary;
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  await page.goto(config.site + '/ai/rag/');
  await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmSummary);
  const records = [];
  const compactCount = summary.mindmap.branches.length + 1;
  const expandedCount = compactCount + summary.mindmap.branches.reduce((sum, branch) => sum + branch.points.length, 0);
  for (const width of [1440, 390, 320]) {
    for (const theme of ['default', 'slate']) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false });
      const previous = await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__diagram svg')?.id);
      await page.evaluate(theme => document.body.setAttribute('data-md-color-scheme', theme), theme);
      if (await page.evaluate(() => document.querySelector('#aipm-summary').hidden)) await page.click('button[aria-label="AI 总结"]');
      await page.click('#aipm-summary [role="tab"]:text-is("思维导图")');
      await page.waitForFunction(({ count, previous }) => {
        const svg = document.querySelector('#aipm-summary .aipm-summary__diagram svg');
        return svg && svg.id !== previous && svg.querySelectorAll('.node').length === count;
      }, { count: compactCount, previous }, { timeout: 30000 });
      console.log({ width, theme, stage: 'compact' });
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__detail-toggle').getAttribute('aria-pressed')), 'false');
      const dimensions = await page.evaluate(() => {
        const panel = document.querySelector('#aipm-summary');
        const footer = panel.querySelector('.aipm-summary__footer').getBoundingClientRect();
        const discuss = panel.querySelector('.aipm-summary__discuss').getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        const svg = panel.querySelector('.aipm-summary__diagram svg');
        return { panel: { left: bounds.left, right: bounds.right, bottom: bounds.bottom },
          footer: { top: footer.top, bottom: footer.bottom },
          discuss: { top: discuss.top, bottom: discuss.bottom, height: discuss.height },
          compactHeight: svg.viewBox.baseVal.height, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(dimensions.panel.left >= 0 && dimensions.panel.right <= width + 1);
      assert.ok(dimensions.discuss.height >= 44 && dimensions.discuss.bottom <= 961);
      assert.equal(dimensions.overflow, false);
      assert.ok(dimensions.compactHeight < 800);
      await page.focus('#aipm-summary .aipm-summary__detail-toggle');
      await page.press('#aipm-summary .aipm-summary__detail-toggle', 'Enter');
      await page.waitForFunction(count => document.querySelector('#aipm-summary .aipm-summary__diagram svg')?.querySelectorAll('.node').length === count, expandedCount, { timeout: 30000 });
      console.log({ width, theme, stage: 'expanded' });
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('aipm-summary__detail-toggle')), true);
      await page.press('#aipm-summary .aipm-summary__detail-toggle', 'Enter');
      await page.waitForFunction(count => document.querySelector('#aipm-summary .aipm-summary__diagram svg')?.querySelectorAll('.node').length === count, compactCount, { timeout: 30000 });
      const scale = await page.evaluate(() => Number(document.querySelector('#aipm-summary .aipm-summary__scale').value.replace('%', '')));
      await page.click('#aipm-summary button[aria-label="放大"]');
      assert.ok(await page.evaluate(() => Number(document.querySelector('#aipm-summary .aipm-summary__scale').value.replace('%', ''))) > scale);
      await page.click('#aipm-summary .aipm-summary__zoom button:text-is("适应宽度")');
      const point = await page.evaluate(() => {
        const body = document.querySelector('#aipm-summary .aipm-summary__body');
        const rect = body.getBoundingClientRect();
        const x = rect.left + 8;
        const y = rect.top + 16;
        if (document.elementFromPoint(x, y) !== body) throw new Error('summary scroll target unavailable');
        return { x, y };
      });
      await page.mouse.move(point.x, point.y, { label: 'scroll summary content area' });
      await page.mouse.wheel(0, 700);
      await page.waitForFunction(() => document.querySelector('#aipm-summary .aipm-summary__body').scrollTop > 0);
      const footerTop = await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__footer').getBoundingClientRect().top);
      assert.equal(footerTop, dimensions.footer.top);
      await page.click('#aipm-summary [role="tab"]:text-is("AI 精读")');
      assert.equal(await page.evaluate(() => document.querySelector('#aipm-summary .aipm-summary__body').scrollTop), 0);
      const typography = await page.evaluate(() => {
        const styles = getComputedStyle(document.querySelector('#aipm-summary .aipm-summary__overview'));
        return { fontSize: parseFloat(styles.fontSize), lineHeight: parseFloat(styles.lineHeight) };
      });
      assert.ok(typography.fontSize >= 14 && typography.lineHeight >= 24);
      if (width === 1440 && theme === 'default') await page.screenshot({ path: directory + '/reading-desktop.png' });
      if (width === 390 && theme === 'slate') await page.screenshot({ path: directory + '/reading-mobile.png' });
      records.push({ width, theme, compactCount, expandedCount, dimensions, typography,
        keyboardExpansion: true, zoom: true, fixedFooter: true, independentTabScroll: true });
      await page.press('#aipm-summary .aipm-summary__head button', 'Escape');
    }
  }
  assert.equal((await (await fetch(config.control)).json()).modelRequests, baseline.modelRequests);
  await writeFile(directory + '/ui-results.json', JSON.stringify(records, null, 2));
  console.log({ scenes: records.length, compactCount, expandedCount, modelRequests: baseline.modelRequests });
  return { spaceId: task.spaceId, records };
}
