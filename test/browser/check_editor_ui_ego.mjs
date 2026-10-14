import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const COMMENT = '这条本机评论用于检查编辑器、回复、可见范围和键盘操作。';
const REPLY = '这条本机回复用于检查保存与刷新。';

export async function checkEditorUi({ directory, taskSpace, spaceId, phase = 'after' }) {
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  await page.cdp('Network.enable', {});
  await page.cdp('Network.setBlockedURLs', { urls: ['*://*/api/chat*', 'http://127.0.0.1:8786/*',
    'http://127.0.0.1:8787/*', 'http://127.0.0.1:8788/*', 'https://annotations.aipm.ac/*',
    'https://agent.aipm.ac/*', 'https://umami.nvc.ac/api/record*', 'https://umami.nvc.ac/api/send*'] });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
  async function capture(name) {
    const image = await page.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`${directory}/${name}.png`, Buffer.from(image.data, 'base64'));
  }
  async function editorState(selector) {
    return page.evaluate(selector => {
      const form=document.querySelector(selector);const rect=form.getBoundingClientRect();
      return {width:form.clientWidth,scrollWidth:form.scrollWidth,left:rect.left,right:rect.right,
        blocked:!!form.closest('.rr-block'),scope:form.querySelector('.aipm-anno__vislabel')?.textContent,
        hintRole:form.querySelector('.aipm-anno__hint')?.getAttribute('role'),
        buttons:[...form.querySelectorAll('.aipm-anno__cancel,.aipm-anno__save,.aipm-anno__visbtn')].map(button=>({height:button.getBoundingClientRect().height}))};
    }, selector);
  }
  const cases = [];
  for (const width of [1280, 390, 320]) {
    for (const scheme of ['slate', 'default']) {
      const name = `${phase}-${width}-${scheme}`;
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${config.site}/ai/rag/`);
      await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnnoStore, undefined, { timeout: 20000 });
      await page.evaluate(({ scheme, body }) => {
        for(const item of window.__aipmAnnoStore.localList(location.pathname)) {
          if(!item.body.startsWith(body)) throw new Error('unexpected data in isolated editor origin');
          window.__aipmAnnoStore.localRemove(location.pathname,item.id);
        }
        window.dispatchEvent(new CustomEvent('aipm-annotation-local-change',{detail:{page:location.pathname}}));
        document.body.setAttribute('data-md-color-scheme',scheme);
      }, {scheme,body:COMMENT});
      await page.click('.aipm-anno-entry');
      await page.click('.aipm-anno__title');
      await page.click('.aipm-anno__newbtn');
      await page.waitForSelector('form[data-editor="comment"] textarea', {state:'visible'});
      await page.click('form[data-editor="comment"] .aipm-anno__visbtn');
      await page.click('form[data-editor="comment"] button[data-vis="local"]');
      if(phase==='after') {
        await page.click('form[data-editor="comment"] button[type="submit"]');
        await page.waitForSelector('loc=css:.aipm-anno__hint:text-is("评论不能是空的。")',{state:'visible'});
        assert.equal(await page.evaluate(()=>window.__aipmAnnoStore.localList(location.pathname).length),0);
        assert.equal(await page.evaluate(()=>document.querySelector('.aipm-anno__hint').getAttribute('aria-live')),'polite');
        await capture(`${name}-comment-error`);
      }
      await page.fill('form[data-editor="comment"] textarea', COMMENT);
      await capture(`${name}-comment`);
      const comment=await editorState('form[data-editor="comment"]');
      if(phase==='after') {
        assert.ok(comment.scrollWidth<=comment.width+1);
        assert.ok(comment.left>=0&&comment.right<=width);
        assert.ok(comment.buttons.every(button=>button.height>=44));
        assert.equal(comment.scope,'仅本机');
        assert.equal(comment.blocked,true);
        await page.focus('form[data-editor="comment"] button[type="submit"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(body=>window.__aipmAnnoStore.localList(location.pathname).some(item=>item.body===body),COMMENT,{timeout:5000});
        assert.equal(await page.evaluate(()=>window.__aipmAnnoStore.localList(location.pathname).length),1);
        await page.click('.aipm-anno__comment button[data-action="reply"]');
        await page.waitForSelector('form[data-editor="reply"] textarea',{state:'visible'});
        await page.fill('form[data-editor="reply"] textarea',REPLY);
        await capture(`${name}-reply`);
        const reply=await editorState('form[data-editor="reply"]');
        assert.ok(reply.scrollWidth<=reply.width+1);
        assert.ok(reply.buttons.every(button=>button.height>=44));
        assert.equal(reply.blocked,true);
        await page.click('form[data-editor="reply"] button[type="submit"]');
        await page.waitForFunction(body=>window.__aipmAnnoStore.localList(location.pathname).some(item=>item.replies?.some(reply=>reply.body===body)),REPLY,{timeout:5000});
        await page.click('.aipm-anno__comment button[data-action="edit"]');
        await page.fill('form[data-editor="comment"] textarea',COMMENT+'已完成编辑。');
        await page.click('form[data-editor="comment"] button[type="submit"]');
        await page.waitForFunction(body=>window.__aipmAnnoStore.localList(location.pathname).some(item=>item.body===body),COMMENT+'已完成编辑。',{timeout:5000});
        await page.reload();
        await page.waitForFunction(()=>window.__aipmIntegrityReady===true&&window.__aipmAnnoStore,undefined,{timeout:20000});
        const saved=await page.evaluate(()=>window.__aipmAnnoStore.localList(location.pathname));
        assert.equal(saved.length,1);
        assert.equal(saved[0].body,COMMENT+'已完成编辑。');
        assert.equal(saved[0].replies.length,1);
        assert.equal(saved[0].replies[0].body,REPLY);
        cases.push({name,status:'pass',comment,reply,emptyRejected:true,keyboardSave:true,commentEditSaveRefresh:true,replySaveRefresh:true});
        await page.evaluate(id=>window.__aipmAnnoStore.localRemove(location.pathname,id),saved[0].id);
      } else cases.push({name,status:'observed',comment});
    }
  }
  const service=await(await fetch(config.control)).json();
  assert.equal(service.writes,0);
  assert.equal(service.annotationMutations,0);
  assert.equal(service.permitRequests,0);
  const result={phase,spaceId,cases,service,externalModelRequests:0,externalJevRequests:0,oauth:'not_run'};
  await writeFile(`${directory}/editor-results.json`,JSON.stringify(result,null,2));
  console.log({phase,cases:cases.map(item=>({name:item.name,status:item.status}))});
  return result;
}
