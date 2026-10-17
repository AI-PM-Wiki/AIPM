import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

export async function checkPassageFeedback({directory,taskSpace,spaceId}) {
  const config=JSON.parse(await readFile(directory+'/runtime-config.json','utf8'));
  const task=spaceId===undefined?await taskSpace('AI-PM rate and passage feedback'):await taskSpace(spaceId);
  await writeFile(directory+'/browser-space.json',JSON.stringify({id:task.spaceId}));
  const page=task.page('p1');
  await page.cdp('Network.enable',{});
  await page.cdp('Network.setBlockedURLs',{urls:['*://*/api/chat*','http://127.0.0.1:8786/*','http://127.0.0.1:8787/*','http://127.0.0.1:8788/*','https://annotations.aipm.ac/*','https://agent.aipm.ac/*']});
  await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./block_external_uploads.js',import.meta.url),'utf8')});
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await page.goto(config.site+'/ai/rag/');
  await page.waitForFunction(()=>window.__aipmIntegrityReady===true&&window.__aipmAnnoStore,undefined,{timeout:20000});
  assert.equal(await page.evaluate(()=>window.__aipmAnnoStore.localList(location.pathname).length),0);
  await page.evaluate(()=>{
    const paragraphs=document.querySelectorAll('.md-content__inner p');
    const first=document.createTreeWalker(paragraphs[0],NodeFilter.SHOW_TEXT).nextNode();
    const second=document.createTreeWalker(paragraphs[1],NodeFilter.SHOW_TEXT).nextNode();
    const range=document.createRange();range.setStart(first,4);range.setEnd(second,Math.min(20,second.textContent.length));
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await page.waitForSelector('.aipm-anno__toolbar:not([hidden])',{state:'visible',timeout:5000});
  await page.click('.aipm-anno__tb-annotate');
  await page.waitForSelector('form[data-editor] textarea',{state:'visible'});
  await page.click('form[data-editor] .aipm-anno__visbtn');
  await page.click('form[data-editor] button[data-vis="local"]');
  await page.fill('form[data-editor] textarea','Non-sensitive multi-fragment local note');
  await page.click('form[data-editor] button[type="submit"]');
  await page.waitForFunction(()=>window.__aipmAnnoStore.localList(location.pathname).length===1,undefined,{timeout:5000});
  const id=await page.evaluate(()=>window.__aipmAnnoStore.localList(location.pathname)[0].id);
  const before=await page.evaluate(id=>({fragments:[...document.querySelectorAll('mark.aipm-anno-mark')].filter(mark=>mark.dataset.annoId===id).length}),id);
  assert.ok(before.fragments>1,'test selection did not create multiple annotation fragments');
  await page.click(`.aipm-anno__item[data-anno-id="${id}"] .aipm-anno__quote-ink`);
  const after=await page.evaluate(id=>{
    const fragments=[...document.querySelectorAll('mark.aipm-anno-mark')].filter(mark=>mark.dataset.annoId===id);
    return {fragments:fragments.length,flashed:fragments.filter(mark=>mark.classList.contains('aipm-anno-flash')).length,
      otherFlashed:[...document.querySelectorAll('mark.aipm-anno-flash')].filter(mark=>mark.dataset.annoId!==id).length};
  },id);
  await writeFile(directory+'/passage-results.json',JSON.stringify({spaceId:task.spaceId,before,after},null,2));
  console.log({spaceId:task.spaceId,before,after});
  assert.equal(after.flashed,after.fragments,'passage feedback omits annotation fragments');
  assert.equal(after.otherFlashed,0);
  const cases=[];
  for(const width of [1280,390,320]) {
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    if(width<768) await page.click('.aipm-anno-entry');
    await page.focus(`.aipm-anno__item[data-anno-id="${id}"] .aipm-anno__item-quote`);
    await page.keyboard.press('Enter');
    const current=await page.evaluate(id=>{
      const all=[...document.querySelectorAll('mark.aipm-anno-mark')].filter(mark=>mark.dataset.annoId===id);
      return {fragments:all.length,flashed:all.filter(mark=>mark.classList.contains('aipm-anno-flash')).length,
        localProtected:all.every(mark=>mark.classList.contains('rr-block')),
        records:window.__aipmAnnoStore.localList(location.pathname).length};
    },id);
    assert.equal(current.flashed,current.fragments);
    assert.ok(current.fragments>1);
    assert.equal(current.localProtected,true);
    assert.equal(current.records,1);
    cases.push({width,...current});
  }
  await page.waitForFunction(()=>!document.querySelector('mark.aipm-anno-flash'),undefined,{timeout:2500});
  await writeFile(directory+'/passage-results.json',JSON.stringify({spaceId:task.spaceId,status:'pass',before,after,cases},null,2));
  return {spaceId:task.spaceId,before,after};
}
