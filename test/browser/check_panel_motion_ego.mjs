import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkPanelMotion({ directory, taskSpace, spaceId, site }) {
  const config = JSON.parse(await readFile(directory + '/runtime-config.json', 'utf8'));
  const page = (await taskSpace(spaceId)).page('p1');
  await page.goto((site || config.site) + '/ai/rag/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__aipmIntegrityReady && window.__aipmChat && window.__aipmSummary);
  const panels = {
    annotation: { id: 'aipm-annotations', entry: '.aipm-anno-entry', close: '.aipm-anno__close' },
    summary: { id: 'aipm-summary', entry: '.aipm-summary-entry', close: '.aipm-summary__head button' },
    chat: { id: 'aipm-chat', entry: '.aipm-chat__fab', close: '.aipm-chat__close' },
  };
  await page.evaluate(ids => {
    window.__aipmMotionRecords = [];
    const active = new Map();
    document.addEventListener('transitionrun', event => {
      if (event.propertyName !== 'transform' || !ids.includes(event.target.id)) return;
      const node = event.target;
      const style = getComputedStyle(node);
      const record = { id: node.id, duration: style.transitionDuration, easing: style.transitionTimingFunction,
        samples: [], complete: false };
      window.__aipmMotionRecords.push(record);
      active.set(node.id, record);
      function sample() {
        record.samples.push(getComputedStyle(node).transform);
        if (!record.complete) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    for (const type of ['transitionend', 'transitioncancel']) document.addEventListener(type, event => {
      if (event.propertyName !== 'transform' || !ids.includes(event.target.id)) return;
      const record = active.get(event.target.id);
      if (record) Object.assign(record, { complete: true, elapsed: event.elapsedTime, event: type });
    });
  }, Object.values(panels).map(panel => panel.id));
  const records = [];
  for (const width of [1440, 1024, 390]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false });
    const motion = {};
    for (const [name, panel] of Object.entries(panels)) {
      await page.click(panel.entry);
      await page.waitForFunction(id => getComputedStyle(document.getElementById(id)).transform === 'none', panel.id);
      await page.click('#' + panel.id + ' ' + panel.close);
      await page.waitForFunction(id => getComputedStyle(document.getElementById(id)).visibility === 'hidden', panel.id);
      const transitions = await page.evaluate(id => window.__aipmMotionRecords.filter(record => record.id === id).slice(-2), panel.id);
      assert.equal(transitions.length, 2);
      for (const transition of transitions) {
        assert.equal(transition.event, 'transitionend');
        assert.ok(Math.abs(transition.elapsed - .24) < .001);
        assert.ok(new Set(transition.samples).size > 1);
      }
      motion[name] = transitions;
    }
    assert.equal(motion.summary[0].duration, motion.chat[0].duration);
    assert.equal(motion.summary[0].easing, motion.chat[0].easing);
    assert.equal(motion.summary[0].easing, motion.annotation[0].easing);
    const switches = [];
    for (const from of Object.keys(panels)) {
      for (const to of Object.keys(panels)) {
        if (from === to) continue;
        await page.click(panels[from].entry);
        await page.waitForFunction(id => getComputedStyle(document.getElementById(id)).transform === 'none', panels[from].id);
        const before = await page.evaluate(() => window.__aipmMotionRecords.length);
        if (width === 1440) await page.click(panels[to].entry);
        else await page.evaluate(name => window.__aipmPanels.claim(name), to);
        const samples = await page.evaluate(ids => new Promise(resolve => {
          const samples = [];
          function sample() {
            samples.push(ids.filter(id => getComputedStyle(document.getElementById(id)).visibility === 'visible'));
            if (samples.length < 20) setTimeout(sample, 20);
            else resolve(samples);
          }
          sample();
        }), Object.values(panels).map(panel => panel.id));
        for (const visible of samples) assert.deepEqual(visible, [panels[to].id]);
        assert.equal(await page.evaluate(() => window.__aipmMotionRecords.length), before);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('aipm-panel-switching')), false);
        assert.equal(await page.evaluate(() => window.__aipmPanels.active()), to);
        switches.push({ from, to, samples: samples.length, visiblePanels: [panels[to].id], transitions: 0 });
        await page.click('#' + panels[to].id + ' ' + panels[to].close);
        await page.waitForFunction(id => getComputedStyle(document.getElementById(id)).visibility === 'hidden', panels[to].id);
      }
    }
    records.push({ width, motion, switches });
    console.log({ width, animatedPanels: 3, directSwitches: switches.length });
  }
  await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.click('.aipm-summary-entry');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('aipm-summary')).transform), 'none');
  await page.click('#aipm-summary .aipm-summary__head button');
  const closed = await page.evaluate(() => {
    const panel = document.getElementById('aipm-summary');
    return { visibility: getComputedStyle(panel).visibility, inert: panel.inert, hidden: panel.getAttribute('aria-hidden'),
      focusedInside: panel.contains(document.activeElement), animations: panel.getAnimations().length };
  });
  assert.deepEqual(closed, { visibility: 'hidden', inert: true, hidden: 'true', focusedInside: false, animations: 0 });
  await page.cdp('Emulation.setEmulatedMedia', { features: [] });
  await writeFile(directory + '/panel-motion-results.json', JSON.stringify({ records, reducedMotion: closed }, null, 2));
  return { records, reducedMotion: true };
}
