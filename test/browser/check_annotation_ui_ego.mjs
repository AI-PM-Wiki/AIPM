import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkAnnotationUi(configPath, phase) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const resultPath = `${config.directory}/results.json`;
  const result = phase === 'empty' ? { emptyViews: 0 } : JSON.parse(await readFile(resultPath, 'utf8'));
  const task = await taskSpace(result.spaceId ?? 'annotation UI usernames 20261023');
  result.spaceId = task.spaceId;
  console.log({ phase, spaceId: task.spaceId });
  const page = task.page('p1');

  async function ready() {
    await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnnoAuth);
    await page.evaluate(() => window.__aipmAnnoAuth.ready());
  }
  async function open(mode) {
    if (await page.evaluate(() => document.querySelector('.aipm-anno-entry').getAttribute('aria-expanded') === 'false')) {
      await page.click('.aipm-anno-entry');
    }
    await page.waitForFunction(() => !document.querySelector('.aipm-anno').getAnimations()
      .some(animation => animation.playState === 'running'));
    const current = await page.evaluate(() => document.querySelector('.aipm-anno__title-label').textContent);
    if (current !== mode) await page.click('.aipm-anno__title');
  }
  async function columns() {
    const state = await page.evaluate(() => [...document.querySelectorAll('.aipm-anno__group-head[data-group]')]
      .map(head => {
        const rect = head.getBoundingClientRect();
        return { group: head.dataset.group, title: head.querySelector('.aipm-anno__group-title').textContent,
          count: Number(head.querySelector('.aipm-anno__group-count').textContent),
          expanded: head.querySelector('.aipm-anno__group-fold').getAttribute('aria-expanded'),
          shown: head.querySelector('.aipm-anno__group-eye').getAttribute('aria-pressed'),
          width: rect.width, left: rect.left, right: rect.right };
      }));
    assert.deepEqual(state.map(head => head.group), ['public', 'private', 'local']);
    assert.deepEqual(state.map(head => head.title), ['公开', '私有', '仅本机']);
    assert.ok(state.every(head => head.width > 0 && head.left >= 0));
    return state;
  }
  async function card(body) {
    const id = await page.evaluate(body => [...document.querySelectorAll('article[data-anno-id]')]
      .find(item => item.textContent.includes(body))?.dataset.annoId, body);
    assert.ok(id, body);
    return `article[data-anno-id="${id}"]`;
  }
  async function reply(body, text) {
    const selector = await card(body);
    await page.click(`${selector} .aipm-anno__headtools > button[data-action="options"]`);
    await page.click(`${selector} button[data-action="reply"]`);
    await page.fill('form[data-editor="reply"] textarea', text);
    await page.click('form[data-editor="reply"] button[type="submit"]');
    await page.waitForFunction(text => [...document.querySelectorAll('.aipm-anno__reply-body')]
      .some(node => node.textContent.includes(text)), text);
  }
  async function verifyUsernames(login) {
    const names = await page.evaluate(() => [...document.querySelectorAll(
      '.aipm-anno__cname, .aipm-anno__iname, .aipm-anno__reply-who')]
      .map(node => ({ text: node.textContent, href: node.getAttribute('href'),
        transform: getComputedStyle(node).textTransform })));
    assert.ok(names.length >= 2);
    assert.ok(names.every(name => name.text === login));
    assert.ok(names.every(name => name.href === `https://github.com/${login}`));
    assert.ok(names.every(name => name.transform === 'none'));
    const account = await page.evaluate(() => ({
      label: document.querySelector('.aipm-anno__account').getAttribute('aria-label'),
      initial: document.querySelector('.aipm-anno__avatar--letter')?.textContent,
      authorInitials: [...document.querySelectorAll('.aipm-anno__cavatar.is-letter')]
        .map(node => node.textContent),
    }));
    assert.equal(account.label, `账号:${login}`);
    assert.equal(account.initial, login.charAt(0));
    assert.ok(account.authorInitials.every(initial => initial === login.charAt(0)));
    return names;
  }

  await page.goto(config.site + '/ai/rag/');
  await ready();
  console.log(await page.snapshot());

  if (phase === 'empty') {
    for (const width of [1280, 390, 320]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const scheme of ['default', 'slate']) {
        await page.evaluate(scheme => document.body.setAttribute('data-md-color-scheme', scheme), scheme);
        for (const mode of ['批注', '评论']) {
          await open(mode);
          const heads = await columns();
          assert.ok(heads.every(head => head.count === 0 && head.right <= width));
          const empty = await page.evaluate(() => [...document.querySelectorAll('.aipm-anno__empty')]
            .map(node => ({ group: node.dataset.group, text: node.textContent })));
          assert.equal(empty.length, 3);
          assert.equal(empty.find(item => item.group === 'private').text, `登录 GitHub 后查看私有${mode}。`);
          result.emptyViews++;
          console.log({ width, scheme, mode, emptyViews: result.emptyViews });
        }
      }
    }
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.waitForFunction(() => innerWidth === 1280 &&
      document.documentElement.classList.contains('aipm-anno-mode--dock'));
    await open('评论');
    await page.click('.aipm-anno__group-fold[data-group="public"]');
    assert.equal((await columns())[0].expanded, 'false');
    await page.click('.aipm-anno__group-eye[data-group="private"]');
    assert.equal((await columns())[1].shown, 'false');
    await page.reload();
    await ready();
    await open('评论');
    const persisted = await columns();
    assert.equal(persisted[0].expanded, 'false');
    assert.equal(persisted[1].shown, 'false');
    await page.click('.aipm-anno__group-fold[data-group="public"]');
    await page.click('.aipm-anno__group-eye[data-group="private"]');
    result.emptyControls = true;
  } else if (phase === 'content') {
    const loginResponse = await fetch(config.api + '/api/auth/dev', { method: 'POST' });
    assert.equal(loginResponse.status, 200);
    const session = await loginResponse.json();
    await page.evaluate(session => localStorage.setItem('aipm-anno-auth', JSON.stringify(session)), session);
    await page.reload();
    await ready();
    await open('评论');
    result.originalToken = session.token;
    result.remoteIds = [];
    for (const visibility of ['local', 'public', 'private']) {
      const body = `Username UI ${visibility}`;
      await page.click('.aipm-anno__newbtn');
      await page.click('form[data-editor="comment"] .aipm-anno__visbtn');
      await page.click(`form[data-editor="comment"] [data-vis="${visibility}"]`);
      await page.fill('form[data-editor="comment"] textarea', body);
      await page.click('form[data-editor="comment"] button[type="submit"]');
      await page.waitForFunction(body => [...document.querySelectorAll('.aipm-anno__cbody')]
        .some(node => node.textContent === body), body);
      await reply(body, `Reply ${visibility}`);
      await verifyUsernames(session.user.login);
      await columns();
      if (visibility !== 'local') {
        const records = await page.evaluate(async api => {
          const response = await fetch(api + '/api/annotations?page=/ai/rag/&scope=mine', {
            headers: { Authorization: 'Bearer ' + window.__aipmAnnoAuth.token() },
          });
          return (await response.json()).annotations;
        }, config.api);
        result.remoteIds = records.map(record => record.id).sort();
      }
    }
    const local = await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname));
    assert.equal(local[0].author.githubId, session.user.githubId);
    assert.equal(local[0].replies[0].author.githubId, session.user.githubId);
    result.beforeRename = local;
  } else if (phase === 'renamed' || phase === 'recased') {
    const response = await fetch(config.api + '/api/auth/dev', { method: 'POST' });
    assert.equal(response.status, 200);
    const renamed = await response.json();
    assert.equal(renamed.user.login, phase === 'renamed' ? 'Browser-Renamed' : 'bROWSER-rENAMED');
    const oldSession = await fetch(config.api + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + result.originalToken },
    });
    assert.equal(oldSession.status, 200);
    assert.equal((await oldSession.json()).user.login, renamed.user.login);
    await page.reload();
    await ready();
    await open('评论');
    await page.waitForFunction(() => document.querySelectorAll('.aipm-anno__comment').length === 3);
    await verifyUsernames(renamed.user.login);
    await columns();
    const after = await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname));
    assert.deepEqual(after, result.beforeRename.map(annotation => ({ ...annotation,
      author: renamed.user, replies: annotation.replies.map(reply => ({ ...reply, author: renamed.user })),
    })));
    const mine = await fetch(config.api + '/api/annotations?page=/ai/rag/&scope=mine', {
      headers: { Authorization: 'Bearer ' + result.originalToken },
    });
    assert.equal(mine.status, 200);
    const records = (await mine.json()).annotations;
    assert.deepEqual(records.map(record => record.id).sort(), result.remoteIds);
    assert.ok(records.every(record => record.author.login === renamed.user.login &&
      record.replies[0].author.login === renamed.user.login));
    await reply('Username UI local', `Reply after ${phase}`);
    await verifyUsernames(renamed.user.login);
    result.beforeRename = await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname));
    result.renamedExistingSession = true;
    if (phase === 'recased') {
      result.casePreserved = true;
      result.passed = true;
      delete result.originalToken;
      delete result.beforeRename;
      await task.finish({ keep: [] });
    }
  } else {
    throw new Error('unknown annotation UI phase');
  }
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log({ phase, emptyViews: result.emptyViews, passed: result.passed ?? false });
}
