import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkReplyPlacement({ directory, taskSpace, spaceId }) {
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
  const form = 'form[data-editor="reply"]';
  const menu = '.aipm-anno__toolmenu:popover-open';
  const results = [];
  async function ready() {
    await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnno);
  }
  async function stable() {
    await page.waitForFunction(() => {
      const panel = document.querySelector('#aipm-annotations');
      return panel.getAttribute('aria-hidden') === 'false' &&
        panel.getAnimations().every(animation => animation.playState !== 'running' && !animation.pending);
    });
  }
  async function openPanel(kind) {
    if (await page.evaluate(() => document.querySelector('.aipm-anno-entry').getAttribute('aria-expanded') === 'false')) {
      await page.click('.aipm-anno-entry');
    }
    await stable();
    const mode = await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent);
    if (mode !== (kind === 'comment' ? '评论' : '批注')) await page.click('.aipm-anno__title');
  }
  async function inspect(card, placeholder, blocked) {
    await stable();
    const state = await page.evaluate(card => {
      const root = document.querySelector(card);
      const editor = root.querySelector('form[data-editor="reply"]');
      const bounds = editor.getBoundingClientRect();
      const input = editor.querySelector('textarea');
      const style = getComputedStyle(editor);
      const before = [...root.children].filter(node => node !== editor);
      return {
        count: document.querySelectorAll('form[data-editor="reply"]').length,
        direct: editor.parentElement === root, last: root.lastElementChild === editor,
        unindented: !editor.hasAttribute('data-depth'), placeholder: input.placeholder,
        blocked: Boolean(editor.closest('.rr-block')), body: input.value,
        focused: document.activeElement === input,
        belowContent: before.every(node => node.getBoundingClientRect().bottom <= bounds.top + 1),
        inputLeft: input.getBoundingClientRect().left, inputRight: input.getBoundingClientRect().right,
        left: bounds.left, right: bounds.right, width: bounds.width, viewport: innerWidth,
        background: style.backgroundColor, cardBackground: getComputedStyle(root).backgroundColor,
        radius: parseFloat(style.borderRadius), padding: parseFloat(style.paddingLeft),
        inputBackground: getComputedStyle(input).backgroundColor,
        buttons: [...editor.querySelectorAll('button')].map(button => {
          const rect = button.getBoundingClientRect();
          return { height: rect.height, contained: rect.left >= bounds.left && rect.right <= bounds.right };
        }),
      };
    }, card);
    assert.equal(state.count, 1);
    assert.equal(state.direct, true);
    assert.equal(state.last, true);
    assert.equal(state.unindented, true);
    assert.equal(state.placeholder, placeholder);
    assert.equal(state.blocked, blocked);
    assert.equal(state.belowContent, true);
    assert.ok(state.width > 150 && state.left >= 0 && state.right <= state.viewport);
    assert.ok(state.inputLeft >= state.left && state.inputRight <= state.right + 1);
    assert.notEqual(state.background, state.cardBackground);
    assert.ok(state.radius > 0 && state.padding > 0);
    assert.equal(state.inputBackground, 'rgba(0, 0, 0, 0)');
    assert.ok(state.buttons.every(button => button.height >= 44 && button.contained));
    return state;
  }
  for (const kind of ['annotation', 'comment']) {
    for (const visibility of ['local', 'public']) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${config.site}/ai/rag/`);
      await ready();
      if (visibility === 'public') {
        await page.evaluate(async annotation => {
          const response = await fetch(`${annotation}/api/auth/dev`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
          });
          if (!response.ok) throw new Error('Isolated development login failed');
          const session = await response.json();
          localStorage.setItem('aipm-anno-auth', JSON.stringify({ token: session.token, user: session.user }));
        }, config.annotation);
        await page.reload();
        await ready();
        await page.waitForFunction(() => window.__aipmAnnoAuth.isLoggedIn());
      }
      await openPanel(kind);
      console.log(await page.snapshot());
      if (kind === 'annotation') {
        await page.evaluate(() => {
          const text = document.createTreeWalker(document.querySelector('.md-content__inner p'), NodeFilter.SHOW_TEXT).nextNode();
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 30);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
        await page.waitForSelector('.aipm-anno__tb-annotate', { state: 'visible' });
        await page.click('.aipm-anno__tb-annotate');
      } else {
        await page.click('.aipm-anno__newbtn');
      }
      await stable();
      const create = `form[data-editor="${kind === 'annotation' ? 'create' : 'comment'}"]`;
      await page.click(`${create} .aipm-anno__visbtn`);
      await page.click(`${create} button[data-vis="${visibility}"]`);
      const body = `回复位置检查 ${kind} ${visibility}`;
      await page.fill(`${create} textarea`, body);
      await page.click(`${create} button[type="submit"]`);
      await page.waitForSelector(create, { state: 'hidden' });
      async function readRecord() {
        if (visibility === 'local') {
          return page.evaluate(body => window.__aipmAnnoStore.localList(location.pathname).find(record => record.body === body), body);
        }
        const response = await fetch(`${config.annotation}/api/annotations?page=%2Fai%2Frag%2F&scope=public`);
        assert.equal(response.ok, true);
        return (await response.json()).annotations.find(record => record.body === body);
      }
      let record = await readRecord();
      assert.ok(record);
      const card = `article[data-anno-id="${record.id}"]`;
      const rootTrigger = `${card} .aipm-anno__headtools > button[data-action="options"]`;
      async function reply(target) {
        if (target && await page.evaluate(card => Boolean(document.querySelector(`${card} .aipm-anno__replies-foldwrap`)), card)) {
          await page.click(`${card} .aipm-anno__replies-fold`);
        }
        const trigger = target ? `${card} [data-reply-id="${target.id}"] .aipm-anno__reply-tools > button[data-action="options"]` : rootTrigger;
        await page.click(trigger);
        await page.click(`${menu} button[data-action="reply"]`);
        await page.waitForSelector(`${form} textarea`, { state: 'visible' });
        await stable();
        const who = (target && target.author && target.author.login) || (record.author && record.author.login) || '匿名';
        return inspect(card, `回复 ${who}…`, visibility === 'local');
      }
      async function saveReply(text, parent) {
        await reply(parent);
        await page.fill(`${form} textarea`, text);
        await page.click(`${form} button[type="submit"]`);
        await page.waitForSelector(form, { state: 'hidden' });
        record = await readRecord();
        const saved = record.replies.find(reply => reply.body === text);
        assert.ok(saved);
        assert.equal(saved.parentId || null, parent ? parent.id : null);
        return saved;
      }
      const first = await saveReply(`${body} 第一条`, null);
      const later = await saveReply(`${body} 后续回复`, null);
      const nested = await saveReply(`${body} 嵌套回复`, first);
      for (const width of [1280, 390, 320]) {
        for (const scheme of ['default', 'slate']) {
          await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
          await page.evaluate(scheme => document.body.setAttribute('data-md-color-scheme', scheme), scheme);
          for (const target of [null, first, nested]) {
            const state = await reply(target);
            assert.equal(state.focused, true);
            await page.fill(`${form} textarea`, '保留当前回复内容');
            await page.click(`${card} .aipm-anno__replies-fold`);
            const redraw = await inspect(card, state.placeholder, visibility === 'local');
            assert.equal(redraw.body, '保留当前回复内容');
            assert.equal(await page.evaluate(id => Boolean(document.querySelector(`[data-reply-id="${id}"]`)), later.id), true);
            await page.click(`${form} .aipm-anno__cancel`);
            await page.waitForSelector(form, { state: 'hidden' });
            results.push({ kind, visibility, width, scheme, target: target ? target.id : null, state, draftPreserved: true });
          }
        }
      }
      const deepest = await saveReply(`${body} 最后回复`, nested);
      await page.reload();
      await ready();
      await openPanel(kind);
      record = await readRecord();
      assert.equal(record.replies.find(reply => reply.id === deepest.id).parentId, nested.id);
      await reply(first);
      await page.click(`${form} .aipm-anno__cancel`);
      await page.click(rootTrigger);
      await page.click(`${menu} button[data-action="delete"]`);
      await page.click('.aipm-anno__delete-confirm');
      await page.waitForSelector(card, { state: 'hidden' });
      await writeFile(`${directory}/reply-placement-results.json`, JSON.stringify({ spaceId: task.spaceId, results }, null, 2));
      console.log({ kind, visibility, status: 'passed' });
    }
  }
  return { spaceId: task.spaceId, results };
}
