import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

export async function checkRateFeedback({directory,taskSpace,spaceId}) {
  const config=JSON.parse(await readFile(directory+'/runtime-config.json','utf8'));
  const task=await taskSpace(spaceId);
  const page=task.page('p1');
  await page.cdp('Debugger.disable',{});
  const initial=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{
    source:'delete window.__aipmLocalAcceptanceStatus;'});
  await page.cdp('Network.enable',{});
  await page.cdp('Network.setBlockedURLs',{urls:[
    'http://127.0.0.1:8786/*','http://127.0.0.1:8787/*','http://127.0.0.1:8788/*',
    'https://agent.aipm.ac/*','https://annotations.aipm.ac/*']});
  await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./block_external_uploads.js',import.meta.url),'utf8')});
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await page.goto(config.site+'/ai/rag/');
  await page.waitForFunction(()=>window.__aipmIntegrityReady===true&&document.querySelector('.aipm-chat__fab'),undefined,{timeout:20000});
  if(await page.evaluate(()=>document.querySelector('.aipm-chat').getAttribute('aria-hidden')==='true')) {
    await page.click('.aipm-chat__fab');
  }
  await page.fill('.aipm-chat__input','Explain retrieval briefly.');
  for(let count=0;count<2;count++) {
    const response=await fetch(config.agent+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,400,'admission seed reached an unexpected path');
  }
  await page.click('.aipm-chat__send');
  await page.waitForFunction(()=>document.querySelector('.aipm-chat__bubble.is-error'),undefined,{timeout:10000});
  const windowError=await page.evaluate(()=>document.querySelector('.aipm-chat__bubble.is-error').textContent);
  assert.match(windowError,/请求窗口已达上限/);
  assert.doesNotMatch(windowError,/累计额度/);
  const before=JSON.parse(await readFile(directory+'/rate-requests.json','utf8')).filter(row=>row.method==='POST'&&row.path==='/api/chat');
  assert.deepEqual(before.map(row=>row.status),[400,400,429]);
  const init=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{
    source:"window.__aipmLocalAcceptanceStatus='/_local-acceptance.json';"});
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('.aipm-chat__local-status')?.textContent.includes('累计剩余 0 次'),undefined,{timeout:20000});
  if(await page.evaluate(()=>document.querySelector('.aipm-chat').getAttribute('aria-hidden')==='true')) {
    await page.click('.aipm-chat__fab');
  }
  await page.fill('.aipm-chat__input','Explain retrieval briefly.');
  await page.click('.aipm-chat__send');
  await page.waitForFunction(()=>document.querySelector('.aipm-chat__bubble.is-error')?.textContent.includes('累计额度已用完'),undefined,{timeout:10000});
  const quotaError=await page.evaluate(()=>document.querySelector('.aipm-chat__bubble.is-error').textContent);
  assert.match(quotaError,/本机验收累计额度已用完/);
  const after=JSON.parse(await readFile(directory+'/rate-requests.json','utf8')).filter(row=>row.method==='POST'&&row.path==='/api/chat');
  assert.deepEqual(after,before,'exhausted local policy sent an Agent request');
  const geometry=[];
  for(const width of [1280,390,320]) {
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    const errorsBefore=await page.evaluate(()=>document.querySelectorAll('.aipm-chat__bubble.is-error').length);
    await page.fill('.aipm-chat__input','Explain retrieval briefly.');
    await page.focus('.aipm-chat__send');
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.aipm-chat__send')),true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(count=>document.querySelector('.aipm-chat__input').value===''&&
      document.querySelector('.aipm-chat__send').disabled&&document.querySelectorAll('.aipm-chat__bubble.is-error').length===count+1&&
      [...document.querySelectorAll('.aipm-chat__bubble.is-error')].at(-1)?.textContent.includes('累计额度已用完'),errorsBefore,{timeout:10000});
    await page.waitForFunction(()=>{
      const rect=document.querySelector('.aipm-chat__local-status').getBoundingClientRect();
      return rect.left>=0&&rect.right<=innerWidth+1;
    },undefined,{timeout:5000});
    const current=await page.evaluate(()=>{
      const status=document.querySelector('.aipm-chat__local-status');
      const rect=status.getBoundingClientRect();
      return {hidden:status.hidden,client:status.clientWidth,scroll:status.scrollWidth,
        left:rect.left,right:rect.right,viewport:innerWidth,text:status.textContent};
    });
    assert.equal(current.hidden,false);
    assert.ok(current.scroll<=current.client+1,'local quota label overflows');
    assert.ok(current.left>=0&&current.right<=current.viewport+1,'local quota label is clipped');
    geometry.push({width,...current});
    for(const scheme of ['slate','default']) {
      await page.evaluate(scheme=>document.body.setAttribute('data-md-color-scheme',scheme),scheme);
      const shot=await page.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(directory+`/quota-${width}-${scheme}.png`,Buffer.from(shot.data,'base64'));
    }
  }
  assert.deepEqual(JSON.parse(await readFile(directory+'/rate-requests.json','utf8')).filter(row=>row.method==='POST'&&row.path==='/api/chat'),before,
    'keyboard quota checks sent additional Agent requests');
  const gateway=await(await fetch(config.gateway+'/healthz')).json();
  assert.equal(gateway.sent,config.actualGatewaySent,'rate feedback used a model request');
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:init.identifier});
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:initial.identifier});
  const result={status:'pass',windowError,quotaError,agentStatuses:after.map(row=>row.status),
    providerRequests:0,actualGatewaySent:gateway.sent,isolatedAcceptanceCap:config.isolatedAcceptanceCap,geometry};
  await writeFile(directory+'/rate-results.json',JSON.stringify(result,null,2));
  console.log(result);
}
