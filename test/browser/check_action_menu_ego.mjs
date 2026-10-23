import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkActionMenu({ directory, taskSpace, spaceId }) {
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
  const results = [];
  const card = '.aipm-anno__comment';
  const trigger = `${card} .aipm-anno__headtools > button[data-action="options"]`;
  const menu = '.aipm-anno__toolmenu:popover-open';
  async function ready() {
    await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnno, undefined, { timeout: 20000 });
  }
  async function openComments() {
    if (await page.evaluate(() => document.querySelector('.aipm-anno-entry').getAttribute('aria-expanded') === 'false')) {
      await page.click('.aipm-anno-entry');
    }
    if (await page.evaluate(() => document.querySelector('.aipm-anno__title').getAttribute('aria-pressed') === 'false')) {
      await page.click('.aipm-anno__title');
    }
    await page.waitForFunction(() => document.querySelector('.aipm-anno__title-label').textContent === '评论');
  }
  async function closed() {
    assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-anno__toolmenu:popover-open').length), 0);
  }
  async function inspect(width) {
    const state = await page.evaluate(() => {
      const node = document.querySelector('.aipm-anno__toolmenu:popover-open');
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        blocked: Boolean(node.closest('.rr-block')), background: getComputedStyle(node).backgroundColor,
        active: document.activeElement.getAttribute('data-action'),
        items: [...node.querySelectorAll('button')].map(button => ({
          action: button.dataset.action, disabled: button.disabled, role: button.getAttribute('role'),
          label: button.textContent, height: button.getBoundingClientRect().height,
        })) };
    });
    assert.ok(state.left >= 0 && state.right <= width && state.top >= 0 && state.bottom <= 900);
    assert.ok(state.items.every(item => item.role === 'menuitem' && item.height >= 44));
    assert.equal(state.blocked, true);
    assert.equal(state.active, 'reply');
    assert.deepEqual(state.items.map(item => item.action), ['ask-local', 'reply', 'edit', 'delete']);
    assert.equal(state.items[0].disabled, true);
    return state;
  }
  for (const width of [1280, 390, 320]) {
    for (const scheme of ['default', 'slate']) {
      const name = `${width}-${scheme}`;
      const body = `操作菜单检查 ${name}`;
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${config.site}/ai/rag/`);
      await ready();
      assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 0);
      await page.evaluate(scheme => document.body.setAttribute('data-md-color-scheme', scheme), scheme);
      await openComments();
      await page.click('.aipm-anno__newbtn');
      await page.click('form[data-editor="comment"] .aipm-anno__visbtn');
      await page.click('form[data-editor="comment"] button[data-vis="local"]');
      await page.fill('form[data-editor="comment"] textarea', body);
      await page.click('form[data-editor="comment"] button[type="submit"]');
      await page.waitForSelector(trigger, { state: 'visible' });
      assert.equal(await page.evaluate(() => document.querySelector('.aipm-anno__headtools').querySelectorAll('button').length), 1);
      await page.click(trigger);
      const state = await inspect(width);
      if (width === 1280 || scheme === 'slate') {
        await page.screenshot({ path: `${directory}/action-menu-${name}.png` });
      }
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'delete');
      await page.keyboard.press('Home');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'reply');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '再次点击确认删除');
      assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 1);
      await page.keyboard.press('Escape');
      await closed();
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-expanded')), 'false');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'options');
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'delete');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('is-armed')), false);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      await closed();
      await page.click(trigger);
      await page.click('.aipm-anno__head');
      await closed();
      await page.click(trigger);
      await page.click(`${menu} button[data-action="reply"]`);
      await closed();
      await page.waitForSelector('form[data-editor="reply"] textarea', { state: 'visible' });
      await page.fill('form[data-editor="reply"] textarea', `${body} 回复`);
      await page.click('form[data-editor="reply"] button[type="submit"]');
      const replyTrigger = `${card} .aipm-anno__reply-tools > button[data-action="options"]`;
      await page.waitForSelector(replyTrigger, { state: 'visible' });
      await page.click(trigger);
      await page.keyboard.press('Escape');
      await page.click(replyTrigger);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-anno__toolmenu:popover-open').length), 1);
      assert.equal(await page.evaluate(() => document.querySelector('.aipm-anno__headtools > button').getAttribute('aria-expanded')), 'false');
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.aipm-anno__toolmenu button')].map(button => button.dataset.action)), ['reply', 'delete-reply']);
      await page.click(`${menu} button[data-action="delete-reply"]`);
      assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname)[0].replies.length), 1);
      await page.click(`${menu} button[data-action="delete-reply"]`);
      await page.waitForFunction(() => window.__aipmAnnoStore.localList(location.pathname)[0].replies.length === 0);
      await closed();
      await page.click(trigger);
      await page.click(`${menu} button[data-action="edit"]`);
      await page.waitForSelector('form[data-editor="comment"] textarea', { state: 'visible' });
      await page.fill('form[data-editor="comment"] textarea', `${body} 编辑`);
      await page.click('form[data-editor="comment"] button[type="submit"]');
      await page.reload();
      await ready();
      await openComments();
      await page.waitForSelector(trigger, { state: 'visible' });
      assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname)[0].body), `${body} 编辑`);
      await page.click(trigger);
      await page.click(`${menu} button[data-action="delete"]`);
      await page.click(`${menu} button[data-action="delete"]`);
      await page.waitForFunction(() => window.__aipmAnnoStore.localList(location.pathname).length === 0);
      await closed();
      results.push({ name, state, keyboard: true, outsideDismiss: true, singleMenu: true,
        replyDelete: true, commentEditRefresh: true, commentDelete: true });
      await writeFile(`${directory}/action-menu-results.json`, JSON.stringify({ spaceId: task.spaceId, results }, null, 2));
      console.log({ name, status: 'passed' });
    }
  }
  return { spaceId: task.spaceId, results };
}

export async function checkAnnotationActionMenu({ directory, taskSpace, spaceId }) {
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${config.site}/ai/rag/`);
  await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnno);
  await page.evaluate(() => {
    const node = document.createTreeWalker(document.querySelector('.md-content__inner p'), NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 30);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForSelector('.aipm-anno__tb-annotate', { state: 'visible' });
  await page.click('.aipm-anno__tb-annotate');
  await page.waitForSelector('form[data-editor="create"] textarea', { state: 'visible' });
  await page.click('form[data-editor="create"] .aipm-anno__visbtn');
  await page.click('form[data-editor="create"] button[data-vis="local"]');
  await page.fill('form[data-editor="create"] textarea', '批注菜单与权限检查');
  await page.click('form[data-editor="create"] button[type="submit"]');
  const trigger = '.aipm-anno__item .aipm-anno__headtools > button[data-action="options"]';
  const menu = '.aipm-anno__toolmenu:popover-open';
  await page.waitForSelector(trigger, { state: 'visible' });
  await page.click(trigger);
  assert.equal(await page.evaluate(() => document.querySelector('.aipm-anno__toolmenu').getAttribute('aria-label')), '批注选项');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.aipm-anno__toolmenu').closest('.rr-block'))), true);
  await page.click(`${menu} button[data-action="edit"]`);
  await page.fill('form[data-editor="edit"] textarea', '批注菜单编辑完成');
  await page.click('form[data-editor="edit"] button[type="submit"]');
  await page.waitForFunction(() => window.__aipmAnnoStore.localList(location.pathname)[0].body === '批注菜单编辑完成');
  await page.click(trigger);
  await page.click(trigger);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'options');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-anno__toolmenu:popover-open').length), 0);
  await page.click(trigger);
  await page.click('.aipm-anno__item button[data-action="visibility"]');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.aipm-anno__toolmenu:popover-open').length), 0);
  await page.keyboard.press('Escape');
  await page.click('.aipm-anno__close');
  await page.evaluate(async annotation => {
    const response = await fetch(`${annotation}/api/auth/dev`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('isolated development login failed');
    const session = await response.json();
    localStorage.setItem('aipm-anno-auth', JSON.stringify({ token: session.token, user: session.user }));
  }, config.annotation);
  await page.reload();
  await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnnoAuth.isLoggedIn());
  await page.click('.aipm-anno-entry');
  await page.click('.aipm-anno__item button[data-action="visibility"]');
  await page.click('.aipm-anno__vispop button[data-vis="private"]');
  await page.waitForSelector('.aipm-anno__item .aipm-anno__vischip.is-private', { state: 'visible' });
  await page.click(trigger);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.aipm-anno__toolmenu button')].map(button => button.dataset.action)), ['ask', 'reply', 'edit', 'delete']);
  assert.equal(await page.evaluate(() => document.querySelector('.aipm-anno__toolmenu button[data-action="ask"]').disabled), false);
  await page.keyboard.press('Escape');
  await page.click('.aipm-anno__item button[data-action="visibility"]');
  await page.click('.aipm-anno__vispop button[data-vis="public"]');
  await page.waitForSelector('.aipm-anno__item .aipm-anno__vischip.is-public', { state: 'visible' });
  await page.click('.aipm-anno__account');
  await page.click('.aipm-anno__logout');
  await page.waitForFunction(() => !window.__aipmAnnoAuth.isLoggedIn());
  await page.waitForSelector('.aipm-anno__item span.aipm-anno__vischip.is-public', { state: 'visible' });
  await page.click(trigger);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.aipm-anno__toolmenu button')].map(button => button.dataset.action)), ['ask', 'reply-login']);
  assert.equal(await page.evaluate(() => document.querySelector('.aipm-anno__toolmenu button[data-action="reply-login"]').textContent.trim()), '登录后回复');
  await page.keyboard.press('Escape');
  const service = await (await fetch(config.control)).json();
  assert.equal(service.writes, 1);
  const result = { annotationEdit: true, triggerToggleFocus: true, visibilityMenuExclusion: true,
    privateActions: true, publicAnonymousActions: true, service };
  await writeFile(`${directory}/annotation-action-menu-results.json`, JSON.stringify(result, null, 2));
  console.log(result);
  return result;
}
