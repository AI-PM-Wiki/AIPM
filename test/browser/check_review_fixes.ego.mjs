import fs from 'node:fs';
import assert from 'node:assert/strict';

export async function checkReviewFixes({ directory, scenario, browser }) {
const { cliLog, taskSpace } = browser;
assert.ok(directory && ['cache', 'highlight', 'recovery'].includes(scenario));
const config = JSON.parse(fs.readFileSync(directory + '/runtime.json', 'utf8'));
const managed = await taskSpace('AIPM reviewed code fixes');
fs.writeFileSync(directory + '/space.json', JSON.stringify({ id: managed.spaceId }));
const pages = await managed.pages();
const page = pages.find(p => p.label === 'review') ?? pages[0] ?? await managed.newPage();
const cdp = (method, params) => page.cdp(method, params);
const js = expression => page.evaluate(source => (0, eval)(source), expression);
const waitForElement = (selector, options) => page.waitForSelector(selector, { state: 'attached', timeout: options.timeout * 1000 });
await page.goto(config.site + '/ai/rag/');
async function ready() {
  await waitForElement('.aipm-chat__input', { timeout: 20 });
  assert.equal(await js(`(async()=>{const end=performance.now()+10000;while(!window.__aipmIntegrityReady&&performance.now()<end)await new Promise(r=>setTimeout(r,25));return window.__aipmIntegrityReady===true})()`), true);
}
async function confirmFrame(visibility = 'local') {
  await page.waitForSelector('loc=css:#agree:not([disabled])', { state: 'visible', timeout: 3000 });
  await page.click('loc=css:#agree');
  const state = '已写入：' + ({ public: '公开', private: '仅自己可见', local: '仅本机' })[visibility];
  await page.waitForSelector('loc=css:#state:text-is("' + state + '")', { state: 'visible', timeout: 10000 });
  return state;
}
await ready();
const result = { scenario, modelRequests: 0, phases: [] };
try {
  if (scenario === 'cache') {
    await js(`(async()=>{const r=await fetch(${JSON.stringify(config.annotation + '/api/auth/dev')},{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.status!==200)throw new Error('test session unavailable');localStorage.setItem('aipm-anno-auth',JSON.stringify(await r.json()))})()`);
    await cdp('Page.reload', {});
    await ready();
    for (const visibility of ['public', 'private']) {
      const offset = visibility === 'public' ? 4 : 35;
      const mounted = await js(`(async()=>{await window.__aipmAnnoAuth.ready();const text=document.querySelector('.md-content__inner p').textContent;const start=${offset};const host=document.createElement('section');document.querySelector('.md-content__inner').prepend(host);const version=window.__aipmAnnoStore.assetVersion;const{createAgentEntry}=await import('/_static/js/annotation-agent-entry.js?v='+version);const p={id:crypto.randomUUID(),requestId:crypto.randomUUID(),page:location.pathname,scope:'text',quote:text.slice(start,start+18),prefix:text.slice(Math.max(0,start-4),start),suffix:text.slice(start+18,start+26),body:'Review '+${JSON.stringify(visibility)},visibility:${JSON.stringify(visibility)},color:'blue',style:'underline'};createAgentEntry().mount({proposal:p,host});return{requestId:p.requestId,beforeMarks:document.querySelectorAll('mark.aipm-anno-mark').length,authenticated:!!window.__aipmAnnoAuth.user()}})()`);
      assert.equal(mounted.authenticated, true);
      const state = await confirmFrame(visibility);
      const server = await (await fetch(config.control)).json();
      const saved = server.annotations.find(a => a.requestId === mounted.requestId);
      assert.ok(saved);
      const observation = await js(`(async()=>{const selector='mark.aipm-anno-mark[data-anno-id="'+${JSON.stringify(saved.id)}+'"]';const end=performance.now()+2500;while(!document.querySelector(selector)&&performance.now()<end)await new Promise(r=>setTimeout(r,25));return{marks:document.querySelectorAll('mark.aipm-anno-mark').length,readCount:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/annotations?')).length}})()`);
      const markIds = await js(`Array.from(document.querySelectorAll('mark.aipm-anno-mark')).map(e=>e.getAttribute('data-anno-id'))`);
      result.phases.push({ visibility, mounted, state, observation, savedId: saved.id, markIds, server });
      fs.writeFileSync(directory + '/' + scenario + '.json', JSON.stringify(result, null, 2));
      assert.ok(markIds.includes(saved.id), 'saved annotation must appear in the current article without navigation');
      await cdp('Page.reload', {});
      await ready();
    }
  } else if (scenario === 'highlight') {
    const mounted = await js(`(async()=>{const text=document.querySelector('.md-content__inner p').textContent;const host=document.createElement('section');document.querySelector('.md-content__inner').prepend(host);const version=window.__aipmAnnoStore.assetVersion;const{createAgentEntry}=await import('/_static/js/annotation-agent-entry.js?v='+version);const p={id:crypto.randomUUID(),requestId:crypto.randomUUID(),page:location.pathname,scope:'text',quote:text.slice(4,22),prefix:text.slice(0,4),suffix:text.slice(22,30),body:'',visibility:'local',color:'green',style:'highlight'};try{createAgentEntry().mount({proposal:p,host});return{requestId:p.requestId,error:null}}catch(error){return{error:error.name+': '+error.message}}})()`);
    result.phases.push(mounted);
    fs.writeFileSync(directory + '/' + scenario + '.json', JSON.stringify(result, null, 2));
    assert.equal(mounted.error, null, 'pure highlight must open confirmation');
    result.phases.push({ state: await confirmFrame() });
    const saved = await js(`window.__aipmAnnoStore.localList(location.pathname).find(a=>a.requestId===${JSON.stringify(mounted.requestId)})`);
    assert.equal(saved.body, '');
    await cdp('Page.reload', {});
    await ready();
    assert.equal(await js(`window.__aipmAnnoStore.localList(location.pathname).filter(a=>a.requestId===${JSON.stringify(mounted.requestId)}).length`), 1);
  } else {
    if (!await js('window.__aipmChat.isOpen()')) await page.click('.aipm-chat__fab');
    await page.fill('.aipm-chat__input', '离线检查：恢复原记录中的待确认建议。');
    assert.equal(await js(`document.querySelector('.aipm-chat__input').value`), '离线检查：恢复原记录中的待确认建议。');
    await page.click('.aipm-chat__send');
    await page.waitForSelector('.aipm-chat__proposal', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('.aipm-chat__bubble.is-error', { state: 'attached', timeout: 15000 });
    const before = await js(`({cards:document.querySelectorAll('.aipm-chat__proposal').length,errors:document.querySelectorAll('.aipm-chat__bubble.is-error').length,history:JSON.parse(localStorage.getItem('aipm-chat-history')),local:window.__aipmAnnoStore.localList(location.pathname).length})`);
    assert.equal(before.cards, 1);
    assert.equal(before.errors, 1);
    await cdp('Page.reload', {});
    await ready();
    const after = await js(`({cards:document.querySelectorAll('.aipm-chat__proposal').length,errors:document.querySelectorAll('.aipm-chat__bubble.is-error').length,history:JSON.parse(localStorage.getItem('aipm-chat-history')),local:window.__aipmAnnoStore.localList(location.pathname).length})`);
    result.phases.push({ before, after });
    fs.writeFileSync(directory + '/' + scenario + '.json', JSON.stringify(result, null, 2));
    assert.equal(after.cards, before.cards, 'pending proposals must survive an error and reload');
    assert.equal(after.errors, before.errors, 'error state must survive reload');
    assert.equal(after.local, before.local, 'reload must not write annotations');
    await page.click('.aipm-chat__fab');
    await page.click('.aipm-chat__proposal-accept');
    result.phases.push({ state: await confirmFrame() });
  }
  result.status = 'pass';
} catch (error) {
  result.status = 'fail';
  result.error = error.message;
  throw error;
} finally {
  fs.writeFileSync(directory + '/' + scenario + '.json', JSON.stringify(result, null, 2));
  cliLog(result);
}
}
