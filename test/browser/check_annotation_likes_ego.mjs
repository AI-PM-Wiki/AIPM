import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function checkAnnotationLikes(configPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const task = await taskSpace('annotation likes visibility 20261023');
  console.log({ spaceId: task.spaceId });
  const page = task.page('p1');
  await page.goto(config.site + '/ai/rag/');
  await page.waitForFunction(() => window.__aipmIntegrityReady === true);
  await page.evaluate(() => window.__aipmAnnoAuth.ready());
  console.log(await page.snapshot());
  await page.click('.aipm-anno-entry');
  await page.waitForFunction(() => !document.querySelector('.aipm-anno').getAnimations()
    .some(animation => animation.playState === 'running'));
  let transitions = 0;

  async function reload(scope) {
    await page.reload();
    await page.waitForFunction(() => window.__aipmIntegrityReady === true);
    await page.evaluate(() => window.__aipmAnnoAuth.ready());
    await page.click('.aipm-anno-entry');
    await page.waitForFunction(() => !document.querySelector('.aipm-anno').getAnimations()
      .some(animation => animation.playState === 'running'));
    if (scope === 'page') await page.click('.aipm-anno__title');
  }

  async function verify(body, visibility, count, liked) {
    await page.waitForFunction(({ body, visibility, count, liked }) => {
      const card = [...document.querySelectorAll('article[data-anno-id]')]
        .find(item => item.textContent.includes(body));
      const button = card?.querySelector('[data-action="like"]');
      return card?.querySelector('.aipm-anno__vischip.is-' + visibility) && button &&
        Number(button.querySelector('span')?.textContent || 0) === count &&
        button.getAttribute('aria-pressed') === String(liked);
    }, { body, visibility, count, liked });
  }

  for (const scope of ['text', 'page']) {
    const body = 'Like transfer check: ' + scope;
    await page.evaluate(({ body, scope }) => {
      const store = window.__aipmAnnoStore;
      const now = new Date().toISOString();
      const exact = document.querySelector('.md-content__inner p').textContent.trim().slice(0, 20);
      store.localAdd({ id: crypto.randomUUID(), page: location.pathname, visibility: 'local',
        color: 'yellow', style: 'highlight', body, author: { githubId: 0, login: '本机' },
        target: scope === 'page' ? { scope: 'page', selectors: [] }
          : { selectors: [{ type: 'TextQuoteSelector', exact }] },
        replies: [], createdAt: now, updatedAt: now });
      window.dispatchEvent(new CustomEvent('aipm-annotation-local-change', { detail: { page: location.pathname } }));
    }, { body, scope });
    if (scope === 'page') await page.click('.aipm-anno__title');
    async function action(name) {
      const id = await page.evaluate(body => [...document.querySelectorAll('article[data-anno-id]')]
        .find(item => item.textContent.includes(body)).getAttribute('data-anno-id'), body);
      return '[data-anno-id="' + id + '"] [data-action="' + name + '"]';
    }
    await verify(body, 'local', 0, false);
    await page.click(await action('like'));
    await verify(body, 'local', 1, true);

    const login = await fetch(config.api + '/api/auth/dev', { method: 'POST' });
    assert.equal(login.status, 200);
    const session = await login.json();
    await page.evaluate(session => localStorage.setItem('aipm-anno-auth', JSON.stringify(session)), session);
    await reload(scope);
    await verify(body, 'local', 1, true);

    let remoteId;
    for (const visibility of ['public', 'private', 'local', 'private', 'public', 'local']) {
      console.log({ scope, visibility, transitions });
      await page.click(await action('visibility'));
      await page.click('.aipm-anno__vispop [data-vis="' + visibility + '"]');
      await verify(body, visibility, 1, true);
      if (visibility !== 'local') {
        const identity = await page.evaluate(async body => {
          const store = window.__aipmAnnoStore;
          const response = await store.request('/api/annotations?page=' + encodeURIComponent(location.pathname) + '&scope=mine',
            { token: window.__aipmAnnoAuth.token() });
          return response.body.annotations.find(item => item.body === body).id;
        }, body);
        if (remoteId) assert.equal(identity, remoteId);
        remoteId = identity;
      }
      transitions++;
      await reload(scope);
      await verify(body, visibility, 1, true);
    }
    await page.click(await action('like'));
    await verify(body, 'local', 0, false);
    await page.click(await action('visibility'));
    await page.click('.aipm-anno__vispop [data-vis="public"]');
    await verify(body, 'public', 0, false);
    await page.click(await action('like'));
    await verify(body, 'public', 1, true);
    await reload(scope);
    await verify(body, 'public', 1, true);
    await page.click(await action('like'));
    await verify(body, 'public', 0, false);
  }

  await writeFile(config.output, JSON.stringify({ transitions, passed: true }, null, 2));
  console.log(await page.snapshot());
  await task.finish({ keep: [] });
}
