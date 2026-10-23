import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { assertEditorMenuInput, startEditorInputTrace, waitForEditorLayout } from './editor_input_trace.mjs';

export async function checkEditorMenu({ directory, taskSpace, spaceId, sampledPointer = true, synchronize = true }) {
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const task = await taskSpace(spaceId);
  const page = task.page('p1');
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
  await page.cdp('Network.enable', {});
  await page.cdp('Network.setBlockedURLs', {urls:['*://*/api/chat*','https://umami.nvc.ac/api/record*','https://umami.nvc.ac/api/send*']});
  await page.cdp('Emulation.setDeviceMetricsOverride', {width:390,height:900,deviceScaleFactor:1,mobile:false});
  await page.goto(config.site+'/ai/rag/');
  await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__aipmAnnoStore, undefined, {timeout:20000});
  await page.evaluate(() => {
    const store=window.__aipmAnnoStore;
    if(store.localList(location.pathname).length) throw new Error('isolated origin must contain no annotations');
    document.body.setAttribute('data-md-color-scheme','slate');
    const text=document.querySelector('.md-content__inner p').textContent;
    store.localAdd({id:store.uid(),requestId:crypto.randomUUID(),page:location.pathname,visibility:'local',
      color:'blue',style:'underline',body:'非敏感菜单检查\n'+'甲\n'.repeat(1200)+'正文末行',
      target:{selectors:[{type:'TextQuoteSelector',exact:text.slice(4,22),prefix:text.slice(0,4),suffix:text.slice(22,30)}]},
      author:{githubId:0,login:'本机'},replies:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    window.dispatchEvent(new CustomEvent('aipm-annotation-local-change',{detail:{page:location.pathname}}));
  });
  await page.waitForSelector('mark.aipm-anno-mark',{state:'visible'});
  await startEditorInputTrace(page);
  await page.click('mark.aipm-anno-mark');
  await page.click('.aipm-anno__item .aipm-anno__headtools > button[data-action="options"]');
  await page.click('.aipm-anno__item button[data-action="edit"]');
  await page.waitForSelector('form[data-editor="edit"] textarea',{state:'visible'});
  if (synchronize) {
    const layout=await waitForEditorLayout(page);
    await writeFile(`${directory}/editor-layout.json`,JSON.stringify(layout,null,2));
    assert.equal(layout.ready,true,'editor did not reach stable rendered geometry');
  }
  if (sampledPointer) {
    const sample=await page.evaluate(() => {
      window.__uiEditorTrace.checkpoint('sample-pointer');
      return document.querySelector('form[data-editor="edit"] .aipm-anno__visbtn').getBoundingClientRect().toJSON();
    });
    await writeFile(`${directory}/pointer-sample.json`,JSON.stringify(sample,null,2));
    await page.mouse.click(sample.x+sample.width/2,sample.y+sample.height/2);
  } else await page.click('form[data-editor="edit"] .aipm-anno__visbtn');
  const selected=await page.evaluate(() => document.activeElement?.getAttribute('data-vis'));
  await page.evaluate(() => window.__uiEditorTrace.checkpoint('after-visibility'));
  const trace=await page.evaluate(() => window.__uiEditorTrace.stop());
  await writeFile(`${directory}/menu-input-trace.json`,JSON.stringify(trace,null,2));
  const image=await page.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(`${directory}/menu-click.png`,Buffer.from(image.data,'base64'));
  const state=trace.at(-1).state;
  assert.equal(state.expanded,'true');
  assert.equal(state.hidden,false);
  assert.equal(selected,'local');
  assertEditorMenuInput(trace);
  const service=await(await fetch(config.control)).json();
  assert.equal(service.annotationMutations,0);
  assert.equal(service.permitRequests,0);
  await writeFile(`${directory}/menu-result.json`,JSON.stringify({status:'pass',state,service},null,2));
}
