import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const PRIVATE = 'AIPM_LOCAL_RECORDER_';
const PUBLIC = 'AIPM_PUBLIC_RECORDER_CONTROL';

function values(root) {
  const found = [];
  function visit(value) {
    if (typeof value === 'string') found.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(root);
  return found;
}

function nodes(root) {
  const found = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.tagName && value.attributes) found.push(value);
    Object.values(value).forEach(visit);
  }
  visit(root);
  return found;
}

function reconstruct(rows) {
  const events = [];
  const groups = new Map();
  for (const row of rows) {
    const packet = JSON.parse(row.payload);
    assert.equal(packet.type, 'record');
    assert.equal(row.cacheAvailable, false);
    for (const event of packet.payload.events) {
      if (event.type !== 'umami:rrweb-event-fragment') events.push(event);
      else {
        assert.ok(Number.isInteger(event.data.index) && event.data.index >= 0, 'invalid fragment index');
        assert.ok(Number.isInteger(event.data.total) && event.data.total > 0, 'invalid fragment total');
        if (!groups.has(event.data.id)) groups.set(event.data.id, new Map());
        const pieces = groups.get(event.data.id);
        assert.ok(!pieces.has(event.data.index), 'duplicate fragment index');
        pieces.set(event.data.index, event.data);
      }
    }
  }
  const fragments = [];
  for (const [id, pieces] of groups) {
    const ordered = [...pieces.values()].sort((a, b) => a.index - b.index);
    assert.ok(ordered.every(piece => piece.total === ordered[0].total), 'inconsistent fragment totals');
    assert.equal(ordered.length, ordered[0].total, 'missing fragments');
    assert.ok(ordered.every((piece, index) => piece.index === index), 'non-contiguous fragment indices');
    events.push(JSON.parse(ordered.map(piece => piece.value).join('')));
    fragments.push({ id, count: ordered.length });
  }
  return { events, fragments };
}

function checkFragmentRejections(rows) {
  const packets = rows.map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  const packet = packets.find(row => row.payload.payload.events.some(event => event.type === 'umami:rrweb-event-fragment' && event.data.total > 1));
  if (!packet) return [];
  const fragment = packet.payload.payload.events.find(event => event.type === 'umami:rrweb-event-fragment' && event.data.total > 1);
  const encode = records => records.map(row => ({ ...row, payload: JSON.stringify(row.payload) }));
  const duplicate = structuredClone(packets);
  duplicate[packets.indexOf(packet)].payload.payload.events.push(structuredClone(fragment));
  assert.throws(() => reconstruct(encode(duplicate)), /duplicate fragment index/);
  const missing = structuredClone(packets);
  for (const row of missing) row.payload.payload.events = row.payload.payload.events.filter(event =>
    event.type !== 'umami:rrweb-event-fragment' || event.data.id !== fragment.data.id || event.data.index !== fragment.data.index);
  assert.throws(() => reconstruct(encode(missing)), /missing fragments/);
  const inconsistent = structuredClone(packets);
  inconsistent[packets.indexOf(packet)].payload.payload.events.find(event =>
    event.type === 'umami:rrweb-event-fragment' && event.data.id === fragment.data.id && event.data.index === fragment.data.index).data.total++;
  assert.throws(() => reconstruct(encode(inconsistent)), /inconsistent fragment totals/);
  return ['duplicate_index_rejected', 'missing_piece_rejected', 'inconsistent_total_rejected'];
}

export async function checkRecorderPrivacy({ directory, taskSpace, spaceId }) {
  assert.ok(directory);
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const pin = JSON.parse(await readFile(new URL('./recorder-privacy.json', import.meta.url), 'utf8'));
  let id = spaceId;
  if (id === undefined && existsSync(`${directory}/browser-space.json`)) id = JSON.parse(await readFile(`${directory}/browser-space.json`, 'utf8')).id;
  if (id === undefined) id = (await taskSpace('AI-PM local recorder protection regression')).spaceId;
  await writeFile(`${directory}/browser-space.json`, JSON.stringify({ id }));
  const task = await taskSpace(id);
  const page = task.page('p1');
  await page.cdp('Network.enable', {});
  await page.cdp('Network.setBlockedURLs', { urls: ['https://umami.nvc.ac/api/record*', 'https://umami.nvc.ac/api/send*',
    'https://annotations.aipm.ac/*', 'https://agent.aipm.ac/*', 'http://127.0.0.1:8788/*', 'http://127.0.0.1:8787/*'] });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (window === top) {
      window.__recorder = { events: [], preSend: [], ready: false, violations: [], insertions: 0, editorInsertions: 0, localWrites: 0 };
      function localIds() {
        return new Set(Object.values(JSON.parse(localStorage.getItem('aipm-anno-local') || '{"pages":{}}').pages || {}).flat().map(item => item.id));
      }
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        const result = setItem.call(this, key, value);
        if (this === localStorage && key === 'aipm-anno-local') window.__recorder.localWrites++;
        return result;
      };
      function observe(parent, node) {
        if (!parent.isConnected || node.nodeType !== Node.ELEMENT_NODE) return;
        const ids = localIds();
        for (const element of [node, ...node.querySelectorAll('mark, article, form')]) {
          if (element.matches('form[data-editor]')) window.__recorder.editorInsertions++;
          const sensitive = element.matches('mark[data-group="local"]') ||
            (element.matches('article[data-anno-id]') && ids.has(element.getAttribute('data-anno-id'))) ||
            (element.matches('form[data-editor]') && element.querySelector('textarea')?.value.includes(${JSON.stringify(PRIVATE)}));
          if (!sensitive) continue;
          window.__recorder.insertions++;
          if (!element.closest('.rr-block') && !parent.closest('.rr-block')) window.__recorder.violations.push({ tag: element.tagName });
        }
      }
      for (const method of ['appendChild', 'insertBefore', 'replaceChild']) {
        const original = Node.prototype[method];
        Node.prototype[method] = function(node) { observe(this, node); return original.apply(this, arguments); };
      }
    }` });
  await page.cdp('Debugger.enable', {});
  const conditions = {
    configured: 'window.__recorder.start=ee;window.__recorder.snapshot=Xn.takeFullSnapshot;window.__recorder.mirror=Xn.mirror;window.__recorder.options={maskLevel:k,blockSelector:M};window.__recorder.ready=true;false',
    emit: 'window.__recorder.events.push(structuredClone(e));false',
    transport: 'window.__recorder.preSend.push({payload:F(e,t),cacheAvailable:Boolean(P())});false',
  };
  for (const [name, condition] of Object.entries(conditions)) {
    await page.cdp('Debugger.setBreakpointByUrl', { url: pin.sourceUrl,
      lineNumber: pin.locations[name].line - 1, columnNumber: pin.locations[name].column, condition });
  }
  const cases = [];
  const traces = [];
  let insertionBaseline = 0;
  let editorBaseline = 0;
  let fragmentRejections = [];
  async function start(path, reload = false) {
    if (reload) await page.reload();
    else await page.goto(`${config.site}${path}`);
    await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnnoStore && window.__recorder.ready, undefined, { timeout: 20000 });
    const parsed = (await page.events()).filter(event => event.method === 'Debugger.scriptParsed' && event.params.url === pin.sourceUrl);
    assert.ok(parsed.length);
    const loaded = await page.cdp('Debugger.getScriptSource', { scriptId: parsed.at(-1).params.scriptId });
    assert.equal(createHash('sha256').update(loaded.scriptSource).digest('hex'), pin.sha256);
    await page.evaluate(publicText => {
      if (window.umami?.getSession?.()?.cache) throw new Error('unexpected analytics session');
      const control = document.createElement('p');
      control.id = 'recorder-public-control';
      control.textContent = publicText;
      document.querySelector('.md-content__inner').append(control);
      window.__recorder.start();
    }, PUBLIC);
    insertionBaseline = 0;
    editorBaseline = 0;
  }
  async function capture(name, expectedPrivateRoots) {
    await page.evaluate(({ text, name }) => { document.querySelector('#recorder-public-control').textContent = `${text} ${name}`; }, { text: PUBLIC, name });
    await page.waitForFunction(() => window.__recorder.events.some(event => event.type === 3), undefined, { timeout: 5000 });
    const trace = await page.evaluate(() => {
      window.__recorder.snapshot();
      const ids = new Set(window.__aipmAnnoStore.localList(location.pathname).map(item => item.id));
      const roots = [...document.querySelectorAll('mark[data-group="local"], article[data-anno-id], form[data-editor]')].filter(element =>
        (element.matches('mark') || ids.has(element.getAttribute('data-anno-id')) || element.querySelector('textarea')?.value.includes('AIPM_LOCAL_RECORDER_')) && !element.parentElement.closest('.rr-block'));
      const result = { events: window.__recorder.events, preSend: window.__recorder.preSend, options: window.__recorder.options,
        roots: roots.map(element => ({ id: window.__recorder.mirror.getId(element), blocked: element.classList.contains('rr-block'), tag: element.tagName })),
        violations: window.__recorder.violations, insertions: window.__recorder.insertions,
        editorInsertions: window.__recorder.editorInsertions, localWrites: window.__recorder.localWrites,
        editorVisibility: document.querySelector('form[data-editor] button[data-vis].is-active')?.getAttribute('data-vis') || null,
        attempts: window.__aipmBlockedUploads, recordCount: Object.values(JSON.parse(localStorage.getItem('aipm-anno-local') || '{"pages":{}}').pages || {}).flat().length };
      window.__recorder.events = []; window.__recorder.preSend = [];
      return result;
    });
    assert.deepEqual(trace.options, { maskLevel: 'moderate', blockSelector: '' });
    assert.equal(trace.violations.length, 0, 'local content inserted before blocking');
    const insertionDelta = trace.insertions - insertionBaseline;
    const editorInsertionDelta = trace.editorInsertions - editorBaseline;
    if (pin.requiredInsertionScenes.includes(name)) assert.ok(insertionDelta > 0, `${name}: no actual local insertion observed`);
    if (pin.requiredEditorInsertionScenes.includes(name)) assert.ok(editorInsertionDelta > 0, `${name}: no actual editor insertion observed`);
    insertionBaseline = trace.insertions;
    editorBaseline = trace.editorInsertions;
    assert.ok(trace.roots.length >= expectedPrivateRoots);
    assert.ok(trace.roots.every(root => root.blocked && root.id > 0));
    assert.equal(values(trace.events).some(value => value.includes(PRIVATE)), false, 'private content in recording event');
    const full = trace.events.filter(event => event.type === 2);
    const incremental = trace.events.filter(event => event.type === 3);
    assert.ok(full.length && incremental.length);
    assert.ok(values(full).some(value => value.includes(PUBLIC)), 'public full-snapshot control missing');
    assert.ok(values(incremental).some(value => value.includes(PUBLIC)), 'public incremental control missing');
    const snapshotNodes = nodes(full.at(-1));
    const placeholders = trace.roots.map(root => {
      const node = snapshotNodes.find(node => node.id === root.id);
      assert.ok(node && node.attributes.class.includes('rr-block'));
      assert.equal(node.childNodes.length, 0);
      assert.ok(node.attributes.rr_width && node.attributes.rr_height);
      assert.equal('aria-label' in node.attributes, false);
      return { id: node.id, tag: node.tagName, attributes: node.attributes, childCount: 0 };
    });
    const decoded = reconstruct(trace.preSend);
    if (!fragmentRejections.length) fragmentRejections = checkFragmentRejections(trace.preSend);
    assert.ok(decoded.events.length);
    assert.equal(values(decoded.events).some(value => value.includes(PRIVATE)), false, 'private content in decoded payload');
    assert.ok(values(decoded.events).some(value => value.includes(PUBLIC)), 'public serialized control missing');
    traces.push({ name, events: trace.events, preSend: trace.preSend });
    cases.push({ name, status: 'pass', placeholders, incrementalCount: incremental.length, fullCount: full.length,
      packetCount: trace.preSend.length, fragments: decoded.fragments, localWrites: trace.localWrites,
      recordCount: trace.recordCount, editorVisibility: trace.editorVisibility, insertions: trace.insertions, insertionDelta, editorInsertionDelta,
      violations: trace.violations.length });
  }
  async function confirm(scope, body, count) {
    await page.evaluate(async ({ scope, body }) => {
      document.querySelector('[data-recorder-confirmation]')?.remove();
      const host = document.createElement('section');
      host.setAttribute('data-recorder-confirmation', '');
      document.querySelector('.md-content__inner').prepend(host);
      const node = document.createTreeWalker(document.querySelector('.md-content__inner p'), NodeFilter.SHOW_TEXT).nextNode();
      const { createAgentEntry } = await import('/_static/js/annotation-agent-entry.js?v=46');
      createAgentEntry().mount({ host, proposal: { id: crypto.randomUUID(), requestId: crypto.randomUUID(), page: location.pathname,
        scope, body, visibility: 'local', color: 'blue', style: 'underline',
        ...(scope === 'text' ? { quote: node.textContent.slice(4, 22), prefix: node.textContent.slice(0, 4), suffix: node.textContent.slice(22, 30) } : {}) } });
    }, { scope, body });
    await page.waitForSelector('loc=css:#agree', { state: 'visible', timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), count);
    console.log((await page.snapshot()).slice(0, 200));
    await page.click('loc=css:#agree');
    await page.waitForSelector('loc=css:#state:text-is("已写入：仅本机")', { state: 'visible', timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), count + 1);
  }
  async function edit(kind, body) {
    const card = kind === 'annotation' ? '.aipm-anno__item' : '.aipm-anno__comment';
    await page.click(`loc=css:${card} button[data-action="edit"]`);
    await page.waitForSelector('loc=css:form[data-editor="edit"] textarea, form[data-editor="comment"] textarea', { state: 'visible' });
    await capture(`${kind}_editor`, 2);
    await page.fill('loc=css:form[data-editor] textarea', body);
    await page.click('loc=css:form[data-editor] button[type="submit"]');
    await page.waitForFunction(body => window.__aipmAnnoStore.localList(location.pathname).some(item => item.body === body), body, { timeout: 5000 });
    await page.waitForFunction(({ card, body }) => document.querySelector(card)?.textContent.includes(body), { card, body }, { timeout: 5000 });
    await capture(`${kind}_edited`, 2);
  }
  await start('/ai/rag/');
  assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 0);
  await confirm('text', `${PRIVATE}ANNOTATION`, 0);
  const visible = await page.evaluate(() => ({ markBody: document.querySelector('mark.aipm-anno-mark')?.getAttribute('aria-label'),
    quote: document.querySelector('mark.aipm-anno-mark')?.textContent }));
  assert.equal(visible.markBody, `批注:${PRIVATE}ANNOTATION`);
  assert.ok(visible.quote);
  await page.click('loc=css:mark.aipm-anno-mark');
  await page.waitForFunction(body => document.querySelector('.aipm-anno__item')?.textContent.includes(body), `${PRIVATE}ANNOTATION`, { timeout: 5000 });
  await capture('annotation_created', 2);
  await edit('annotation', `${PRIVATE}ANNOTATION_EDITED`);
  assert.equal(await page.evaluate(() => document.querySelector('mark.aipm-anno-mark').getAttribute('aria-label')), `批注:${PRIVATE}ANNOTATION_EDITED`);
  await confirm('page', `${PRIVATE}COMMENT`, 1);
  await page.click('loc=css:.aipm-anno__title');
  await page.waitForSelector('loc=css:.aipm-anno__comment button[data-action="edit"]', { state: 'visible' });
  await page.waitForFunction(body => document.querySelector('.aipm-anno__comment')?.textContent.includes(body), `${PRIVATE}COMMENT`, { timeout: 5000 });
  await capture('comment_created', 2);
  await edit('comment', `${PRIVATE}COMMENT_EDITED`);
  await page.click('.aipm-anno__comment button[data-action="reply"]');
  await page.waitForSelector('form[data-editor="reply"] textarea', { state: 'visible' });
  await page.fill('form[data-editor="reply"] textarea', `${PRIVATE}REPLY`);
  await capture('reply_editor', 2);
  await page.click('form[data-editor="reply"] button[type="submit"]');
  await page.waitForFunction(body => window.__aipmAnnoStore.localList(location.pathname).some(item =>
    item.replies?.some(reply => reply.body === body)), `${PRIVATE}REPLY`, { timeout: 5000 });
  await page.waitForFunction(body => document.querySelector('.aipm-anno__comment')?.textContent.includes(body), `${PRIVATE}REPLY`, { timeout: 5000 });
  await capture('reply_saved', 2);
  const stored = await page.evaluate(() => localStorage.getItem('aipm-anno-local'));
  await page.evaluate(() => { for (let index = 0; index < 10; index++) window.dispatchEvent(new CustomEvent('aipm-annotation-local-change', { detail: { page: location.pathname } })); });
  assert.equal(await page.evaluate(() => localStorage.getItem('aipm-anno-local')), stored);
  await capture('redraw', 2);
  await start('/ai/prompting/');
  await capture('navigation', 0);
  await start('/ai/rag/');
  await capture('restore', 2);
  assert.equal(await page.evaluate(() => document.querySelector('mark.aipm-anno-mark').getAttribute('aria-label')), `批注:${PRIVATE}ANNOTATION_EDITED`);
  assert.equal(await page.evaluate(() => document.querySelector('mark.aipm-anno-mark').textContent), visible.quote);
  assert.equal(await page.evaluate(() => localStorage.getItem('aipm-anno-local')), stored);
  await start('/ai/rag/', true);
  await page.click('loc=css:mark.aipm-anno-mark');
  await page.click('loc=css:.aipm-anno__title');
  await page.waitForSelector('loc=css:.aipm-anno__comment', { state: 'visible' });
  await page.waitForFunction(body => document.querySelector('.aipm-anno__comment')?.textContent.includes(body), `${PRIVATE}COMMENT_EDITED`, { timeout: 5000 });
  await capture('refresh_comment_restore', 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('aipm-anno-local')), stored);
  await start('/ai/rag/', true);
  await page.click('mark.aipm-anno-mark');
  await page.click('.aipm-anno__title');
  await page.waitForFunction(body => document.querySelector('.aipm-anno__comment')?.textContent.includes(body), `${PRIVATE}REPLY`, { timeout: 5000 });
  await capture('reply_restored', 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('aipm-anno-local')), stored);
  await page.evaluate(async annotation => {
    const response = await fetch(`${annotation}/api/auth/dev`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('isolated development login failed');
    const session = await response.json();
    localStorage.setItem('aipm-anno-auth', JSON.stringify({ token: session.token, user: session.user }));
  }, config.annotation);
  await start('/ai/rag/', true);
  assert.equal(await page.evaluate(() => window.__aipmAnnoAuth.isLoggedIn()), true);
  await page.click('mark.aipm-anno-mark');
  await page.click('.aipm-anno__title');
  await page.waitForSelector('.aipm-anno__comment button[data-action="edit"]', { state: 'visible' });
  await capture('authenticated_restore', 2);
  await page.click('.aipm-anno__comment button[data-action="edit"]');
  await page.waitForSelector('form[data-editor="comment"] textarea', { state: 'visible' });
  await capture('existing_local_editor', 2);
  for (const [index, visibility] of ['private', 'local', 'public', 'local'].entries()) {
    await page.click('form[data-editor] .aipm-anno__visbtn');
    await page.click(`form[data-editor] button[data-vis="${visibility}"]`);
    assert.equal(await page.evaluate(() => document.querySelector('form[data-editor] button[data-vis].is-active')?.getAttribute('data-vis')), visibility);
    assert.equal(await page.evaluate(() => document.querySelector('form[data-editor] textarea').value), `${PRIVATE}COMMENT_EDITED`);
    await capture(`existing_local_visibility_${index}_${visibility}`, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('aipm-anno-local')), stored);
  }
  await page.click('form[data-editor] button.aipm-anno__cancel');
  await start('/ai/rag/', true);
  await page.click('mark.aipm-anno-mark');
  await page.click('.aipm-anno__title');
  await page.waitForSelector('.aipm-anno__newbtn', { state: 'visible' });
  await capture('new_draft_restore', 2);
  await page.click('.aipm-anno__newbtn');
  await page.waitForSelector('form[data-editor="comment"] textarea', { state: 'visible' });
  await page.click('form[data-editor] .aipm-anno__visbtn');
  await page.click('form[data-editor] button[data-vis="public"]');
  assert.equal(await page.evaluate(() => document.querySelector('form[data-editor] button[data-vis].is-active')?.getAttribute('data-vis')), 'public');
  assert.equal(await page.evaluate(() => document.querySelector('form[data-editor]').classList.contains('rr-block')), false);
  await page.fill('form[data-editor] textarea', `${PUBLIC} DRAFT`);
  await capture('new_public_draft', 2);
  await page.click('form[data-editor] .aipm-anno__visbtn');
  await page.click('form[data-editor] button[data-vis="local"]');
  assert.equal(await page.evaluate(() => document.querySelector('form[data-editor] button[data-vis].is-active')?.getAttribute('data-vis')), 'local');
  assert.equal(await page.evaluate(() => document.querySelector('form[data-editor]').classList.contains('rr-block')), true);
  await page.fill('form[data-editor] textarea', `${PRIVATE}PUBLIC_DRAFT_TO_LOCAL`);
  await capture('new_public_draft_to_local', 3);
  assert.equal(await page.evaluate(() => localStorage.getItem('aipm-anno-local')), stored);
  await page.click('form[data-editor] button[type="submit"]');
  await page.waitForFunction(body => window.__aipmAnnoStore.localList(location.pathname).some(item => item.body === body), `${PRIVATE}PUBLIC_DRAFT_TO_LOCAL`, { timeout: 5000 });
  await page.waitForFunction(body => [...document.querySelectorAll('.aipm-anno__comment')].some(element => element.textContent.includes(body)), `${PRIVATE}PUBLIC_DRAFT_TO_LOCAL`, { timeout: 5000 });
  await capture('new_local_draft_saved', 3);
  assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 3);
  assert.equal(cases.at(-1).localWrites, 1, 'new local draft must write once');
  assert.ok(cases.flatMap(item => item.fragments).length);
  assert.ok(cases.every(item => item.violations === 0));
  assert.equal(fragmentRejections.length, 3);
  assert.ok(cases.filter(item => ['navigation', 'restore', 'refresh_comment_restore', 'reply_restored',
    'authenticated_restore', 'existing_local_editor', 'new_draft_restore', 'new_public_draft', 'new_public_draft_to_local'].includes(item.name) ||
    item.name.startsWith('existing_local_visibility_')).every(item => item.localWrites === 0));
  const service = await (await fetch(config.control)).json();
  assert.equal(service.writes, 0); assert.equal(service.permitRequests, 0); assert.equal(service.annotationMutations, 0);
  const result = { status: 'pass', spaceId: id, recorderSha256: pin.sha256, cases,
    entry: 'unaltered recorder start invoked directly; session and sampling startup gates not run',
    serialization: 'actual transport arguments inspected with original F serializer at W entry',
    nativeSend: 'not_run_session_gate', sendBeacon: 'not_run_no_recorder_call', XHR: 'not_run_no_recorder_call', gzipBase64: 'not_run_no_transport_observed',
    publicControl: 'recorded in full, incremental and decoded JSON payloads', externalWritesForwarded: 0,
    modelRequests: 0, jevRequests: 0, realDevelopmentLogin: true, oauth: 'not_run',
    fragmentRejections, insertionCoverage: 'per-scene deltas for observed native Node insertion methods',
    independentReview: 'pending_release_blocked', service };
  await writeFile(`${directory}/recorder-results.json`, JSON.stringify(result, null, 2));
  await writeFile(`${directory}/synthetic-recorder-traces.json`, JSON.stringify(traces));
  console.log({ status: result.status, spaceId: id, cases: cases.map(item => ({ name: item.name, status: item.status, insertions: item.insertions })), nativeSend: result.nativeSend });
  return result;
}
