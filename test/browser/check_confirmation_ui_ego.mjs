import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const BODY = '检索增强生成（RAG）将检索结果作为生成时的参考资料。批注可以记录资料来源、适用条件以及需要人工核对的事实。\n\n这段非敏感测试内容用于检查长正文的排版、可见范围以及受保护确认区。确认之前不写入批注；确认之后仅保存到当前设备。';
const LONG_BODY = `${BODY}\n${'甲\n'.repeat(1200)}正文末行`;
assert.ok(LONG_BODY.length <= 4000);

function assertFreshCancellation(before, after) {
  assert.equal(after.eventCount, before.eventCount + 1, 'expected exactly one new trusted cancel');
  assert.deepEqual(after.events.slice(before.eventCount).map(({action,trusted}) => ({action,trusted})),
    [{action:'cancel',trusted:true}]);
  assert.equal(after.localWrites, before.localWrites, 'cancel wrote local annotation storage');
  assert.equal(after.localStorage, before.localStorage, 'cancel changed local annotations');
  assert.equal(after.localCount, 0);
  assert.equal(after.marks, 0);
  for (const key of ['writes','permitRequests','annotationMutations']) {
    assert.equal(before.service[key], 0);
    assert.equal(after.service[key], 0);
  }
}

export async function checkConfirmationUi({ directory, sourceDirectory, taskSpace, spaceId, pageLabel = 'p1', phase = 'after', denseBody = true, presentationOnly = false, scene }) {
  assert.ok(['before', 'after'].includes(phase));
  assert.ok(scene===undefined||['1280-slate','1280-default','390-slate','390-default','320-slate','320-default'].includes(scene));
  assert.ok(!(scene&&presentationOnly));
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const task = spaceId === undefined ? await taskSpace('AI-PM confirmation UI verification') : await taskSpace(spaceId);
  const page = task.page(pageLabel);
  await writeFile(`${directory}/browser-space.json`, JSON.stringify({ id: task.spaceId }));
  await page.cdp('Network.enable', {});
  await page.cdp('Network.setBlockedURLs', { urls: ['*://*/api/chat*', 'http://127.0.0.1:8786/*',
    'http://127.0.0.1:8787/*', 'http://127.0.0.1:8788/*', 'https://annotations.aipm.ac/*',
    'https://agent.aipm.ac/*', 'https://umami.nvc.ac/api/record*', 'https://umami.nvc.ac/api/send*'] });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (window === top && !window.__uiLocalWriteObserverInstalled) {
      window.__uiLocalWriteObserverInstalled = true;
      window.__uiLocalWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key,value) {
        const result = original.apply(this,arguments);
        if (this === localStorage && key === 'aipm-anno-local') window.__uiLocalWrites++;
        return result;
      };
    }` });
  const source = await readFile(`${sourceDirectory}/_static/js/chat-widget.js`, 'utf8');
  assert.equal(await (await fetch(config.site + '/_static/js/chat-widget.js')).text(), source);
  const lines = source.split('\n');
  const lineNumber = lines.findIndex(line => line.includes('window.__aipmChat='));
  const columnNumber = lines[lineNumber].indexOf('window.__aipmChat=');
  assert.ok(lineNumber > 0);
  let breakpoint;
  const cases = [];
  async function frameState(expression) {
    const targets = await task.cdp('Target.getTargets', {});
    const child = targets.targetInfos.find(target => target.type === 'iframe' && target.url === 'about:srcdoc' && target.parentId === page.targetId);
    assert.ok(child, 'protected confirmation frame missing');
    const { sessionId } = await page.cdp('Target.attachToTarget', { targetId: child.targetId, flatten: false });
    await page.cdp('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1,
      method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }) });
    const deadline = Date.now() + 2000;
    let response;
    while (!response && Date.now() < deadline) {
      response = (await page.events()).filter(event => event.method === 'Target.receivedMessageFromTarget' && event.params.sessionId === sessionId)
        .map(event => JSON.parse(event.params.message)).find(message => message.id === 1);
      if (!response) await new Promise(resolve => setTimeout(resolve, 20));
    }
    await page.cdp('Target.detachFromTarget', { sessionId });
    assert.ok(response, 'confirmation inspection response missing');
    assert.equal(response.error, undefined);
    const result = response.result;
    assert.equal(result.exceptionDetails, undefined);
    return result.result.value;
  }
  async function screenshot(name) {
    const shot = await page.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`${directory}/${name}.png`, Buffer.from(shot.data, 'base64'));
  }
  async function paintFrame() {
    assert.equal(await frameState('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'),true);
  }
  async function waitForFrame(expression, ready, label) {
    const samples = [];
    const deadline = Date.now() + 3000;
    let state;
    do {
      state = await frameState(expression);
      samples.push({at:Date.now(),state});
      if (!ready(state)) await new Promise(resolve => setTimeout(resolve,20));
    } while (!ready(state) && Date.now() < deadline);
    await writeFile(`${directory}/${label}.json`,JSON.stringify(samples,null,2));
    assert.ok(ready(state),label);
    return state;
  }
  async function nativeReading(name) {
    await frameState(`(()=>{
      window.__uiReadingEvents=[];
      const details=document.querySelector('#details');
      details.addEventListener('keydown',event=>window.__uiReadingEvents.push({type:event.type,key:event.key,trusted:event.isTrusted,scrollTop:details.scrollTop,at:performance.now()}));
      details.addEventListener('scroll',event=>window.__uiReadingEvents.push({type:event.type,trusted:event.isTrusted,scrollTop:details.scrollTop,at:performance.now()}));
      return true;
    })()`);
    const expression = `(()=>{const details=document.querySelector('#details');const body=document.querySelector('#body').getBoundingClientRect();const box=details.getBoundingClientRect();return {scrollTop:details.scrollTop,maxScroll:details.scrollHeight-details.clientHeight,bodyBottom:body.bottom,detailsTop:box.top,detailsBottom:box.bottom,focus:document.activeElement.id,events:window.__uiReadingEvents};})()`;
    await page.focus('loc=css:#details');
    await page.keyboard.press('Home',{delay:100});
    await paintFrame();
    await screenshot(`${name}-home-key`);
    const home=await waitForFrame(expression,state=>state.scrollTop<=1,`${name}-home`);
    await page.keyboard.press('ArrowDown',{delay:100});
    await paintFrame();
    await screenshot(`${name}-arrow-key`);
    const arrow=await waitForFrame(expression,state=>state.scrollTop>home.scrollTop,`${name}-arrow`);
    await page.keyboard.press('PageDown',{delay:100});
    await paintFrame();
    await screenshot(`${name}-page-down-key`);
    const next=await waitForFrame(expression,state=>state.scrollTop>arrow.scrollTop,`${name}-page-down`);
    await page.keyboard.press('End',{delay:100});
    await paintFrame();
    await screenshot(`${name}-end-key`);
    const tail=await waitForFrame(expression,state=>state.scrollTop>=state.maxScroll-1,`${name}-end`);
    assert.equal(tail.focus,'details');
    assert.ok(tail.bodyBottom<=tail.detailsBottom+1&&tail.bodyBottom>=tail.detailsTop,'last body line must be visible');
    assert.deepEqual(tail.events.filter(event=>event.type==='keydown').map(({key,trusted})=>({key,trusted})),
      ['Home','ArrowDown','PageDown','End'].map(key=>({key,trusted:true})));
    assert.ok(tail.events.some(event=>event.type==='scroll'&&event.trusted));
    await screenshot(`${name}-long-body-tail`);
    await page.keyboard.press('Tab');
    assert.equal(await frameState('document.activeElement.id'),'agree');
    await page.keyboard.press('Tab');
    assert.equal(await frameState('document.activeElement.id'),'cancel');
    return {input:'ego-browser native keyboard with per-key screenshot capture',home,arrow,next,tail};
  }
  async function cancelCheckpoint(key) {
    const state=await page.evaluate(key=>({eventCount:window[key].length,events:[...window[key]],
      localWrites:window.__uiLocalWrites,localStorage:localStorage.getItem('aipm-anno-local'),
      localCount:window.__aipmAnnoStore.localList(location.pathname).length,
      marks:document.querySelectorAll('mark.aipm-anno-mark').length}),key);
    return {...state,service:await(await fetch(config.control)).json(),at:Date.now()};
  }
  async function keyboardCancel(name,key) {
    const before=await cancelCheckpoint(key);
    assert.throws(()=>assertFreshCancellation(before,before),/exactly one new trusted cancel/);
    await paintFrame();
    await page.focus('loc=css:#cancel');
    assert.equal(await frameState('document.activeElement.id'),'cancel');
    await screenshot(`${name}-cancel-focus`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(({key,count})=>window[key].length>count,{key,count:before.eventCount},{timeout:3000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const after=await cancelCheckpoint(key);
    await writeFile(`${directory}/${name}-cancel.json`,JSON.stringify({before,after},null,2));
    assertFreshCancellation(before,after);
    return {before,after,staleSnapshotRejected:true};
  }
  for (const width of presentationOnly ? [] : [1280, 390, 320]) {
    for (const scheme of ['slate', 'default']) {
      if(scene&&scene!==`${width}-${scheme}`) continue;
      const name = `${phase}-${width}-${scheme}`;
      await page.cdp('Debugger.disable', {});
      await page.cdp('Debugger.enable', {});
      breakpoint = await page.cdp('Debugger.setBreakpointByUrl', {
        urlRegex: '/_static/js/chat-widget\\.js', lineNumber, columnNumber,
        condition: 'window.__uiProposalCard=addProposalCard;window.__uiClearEmpty=clearEmpty;false',
      });
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${config.site}/ai/rag/`);
      await page.waitForFunction(() => window.__aipmIntegrityReady === true && window.__uiProposalCard && window.__aipmAnnoStore, undefined, { timeout: 20000 });
      await page.evaluate(({ scheme, body }) => {
        for (const item of window.__aipmAnnoStore.localList(location.pathname)) {
          if (!item.body.startsWith(body)) throw new Error('unexpected data in isolated UI origin');
          window.__aipmAnnoStore.localRemove(location.pathname, item.id);
        }
        window.dispatchEvent(new CustomEvent('aipm-annotation-local-change', {detail:{page:location.pathname}}));
        document.body.setAttribute('data-md-color-scheme', scheme);
        window.__uiClearEmpty();
        const text = document.querySelector('.md-content__inner p').textContent;
        const context = window.__aipmContext.forSelection({ page: location.pathname, title: '检索增强生成',
          quote: text.slice(4, 22), selectors: [{type: 'TextQuoteSelector', exact: text.slice(4, 22),
            prefix: text.slice(0, 4), suffix: text.slice(22, 30)}] });
        const attached = window.__aipmChat.attachContext(context);
        if (!attached.ok) throw new Error('context attachment failed: ' + attached.reason);
        window.__uiAppendProposal=()=>{
          const wrap = document.createElement('div');
          wrap.className = 'aipm-chat__msg aipm-chat__msg--ai';
          document.querySelector('.aipm-chat__msgs').append(wrap);
          window.__uiProposalCard(wrap, { ...context, requestId: crypto.randomUUID(), scope: 'text',
            body, visibility: 'local', color: 'blue', style: 'underline' });
        };
        window.__uiAppendProposal();
        window.__uiUntrustedSeen = false;
        window.__uiConfirmationActions=[];
        window.__uiEntryKeys=[];
        document.addEventListener('keydown',event=>{
          if(event.target.matches('.aipm-chat__proposal-accept')) window.__uiEntryKeys.push({key:event.key,trusted:event.isTrusted,at:performance.now()});
        });
        window.addEventListener('message', event => {
          const frame=document.querySelector('.aipm-chat__proposal iframe');
          if(event.source!==frame?.contentWindow||event.origin!=='null'||event.data?.type!=='confirmation-action') return;
          window.__uiConfirmationActions.push({action:event.data.action,trusted:event.data.trusted,at:performance.now()});
          if(event.data.trusted === false) window.__uiUntrustedSeen = true;
        });
      }, { scheme, body: denseBody ? LONG_BODY : BODY });
      if (width < 768) {
        await page.focus('.aipm-chat__ctx-view');
        await page.keyboard.press('Enter');
      }
      await page.focus('loc=css:.aipm-chat__proposal button:text-is("查看批注建议")');
      await page.keyboard.press('Enter');
      let entryCancel;
      if (phase==='after') {
        await page.waitForSelector('loc=css:#state:text-is("等待同意")',{state:'visible',timeout:10000});
        const reading=denseBody?await nativeReading(`${name}-entry`):null;
        const cancellation=await keyboardCancel(`${name}-entry`,'__uiConfirmationActions');
        await page.waitForSelector('loc=css:#state:text-is("已取消，未写入。")',{state:'visible',timeout:5000});
        await paintFrame();
        await screenshot(`${name}-entry-cancelled`);
        const controls=await frameState(`({agreeDisabled:document.querySelector('#agree').disabled,cancelDisabled:document.querySelector('#cancel').disabled})`);
        assert.deepEqual(controls,{agreeDisabled:true,cancelDisabled:true});
        entryCancel={reading,cancellation,controls};
        await writeFile(`${directory}/${name}-entry-result.json`,JSON.stringify(entryCancel,null,2));
        await page.evaluate(()=>{
          const card=document.querySelector('.aipm-chat__proposal');
          card.querySelector('iframe').remove();
          card.parentElement.remove();
          window.__uiAppendProposal();
        });
        await page.focus('loc=css:.aipm-chat__proposal button:text-is("查看批注建议")');
        await page.keyboard.press('Enter');
      }
      await page.waitForSelector('loc=css:#state:text-is("等待同意")', { state: 'visible', timeout: 10000 });
      await page.waitForFunction(() => document.querySelector('.aipm-chat__proposal iframe')?.clientHeight > 260, undefined, { timeout: 5000 });
      await page.evaluate(() => { document.querySelector('.aipm-chat__msgs').scrollTop = 0; });
      await screenshot(name);
      await page.focus('loc=css:#agree');
      await screenshot(`${name}-confirm-actions`);
      const outer = await page.evaluate(() => {
        const card = document.querySelector('.aipm-chat__proposal');
        const frame = card.querySelector('iframe');
        const styles = getComputedStyle(card);
        return { cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth,
          frameHeight: frame.clientHeight, surface: styles.getPropertyValue('--md-default-bg-color').trim(),
          scheme: document.body.getAttribute('data-md-color-scheme'), sandbox: frame.getAttribute('sandbox'),
          localCount: window.__aipmAnnoStore.localList(location.pathname).length,
          choices: [...card.querySelectorAll('[aria-pressed]')].map(button => ({ label: button.textContent,
            pressed: button.getAttribute('aria-pressed'), disabled: button.disabled, height: button.getBoundingClientRect().height })),
          contextLabels: [...document.querySelectorAll('.aipm-chat__ctx-kind')].map(element => element.textContent) };
      });
      const inner = await frameState(`(() => {
        const section=document.querySelector('section');const button=document.querySelector('#agree');
        const styles=getComputedStyle(button);const canvas=new OffscreenCanvas(1,1);const context=canvas.getContext('2d');
        const luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
        const foreground=luminance(styles.color);const background=luminance(styles.backgroundColor);
        return {width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
          height:document.documentElement.clientHeight,scrollHeight:document.documentElement.scrollHeight,
          sectionHeight:Math.ceil(section.getBoundingClientRect().height),background:getComputedStyle(document.body).backgroundColor,
          scheme:getComputedStyle(document.documentElement).colorScheme,body:document.querySelector('#body').textContent,
          buttonHeight:button.getBoundingClientRect().height,buttonDisabled:button.disabled,
          buttonContrast:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05),
          focus:document.activeElement.id};})()`);
      assert.equal(outer.sandbox, 'allow-scripts');
      assert.equal(outer.localCount, 0, 'viewing suggestion wrote a local annotation');
      assert.equal(outer.choices.filter(button => button.pressed === 'true').length, 1);
      assert.ok(outer.choices.every(button => button.disabled), 'visibility choices were not locked');
      if (phase === 'after') {
        assert.equal(inner.body, '正文：' + (denseBody ? LONG_BODY : BODY));
        assert.equal(inner.scheme, scheme === 'slate' ? 'dark' : 'light');
        assert.ok(inner.buttonHeight >= 44);
        assert.ok(inner.buttonContrast >= 4.5);
        assert.ok(outer.choices.every(button => button.height >= 44));
        assert.ok(outer.cardScrollWidth <= outer.cardWidth + 1, 'card has horizontal clipping');
        assert.ok(inner.scrollWidth <= inner.width + 1, 'frame has horizontal clipping');
        assert.ok(inner.scrollHeight <= inner.height + 1, 'frame requires nested vertical scrolling');
        assert.equal(outer.frameHeight, inner.sectionHeight);
        if (denseBody) {
          const reading = await frameState(`(()=>{const details=document.querySelector('#details');return {height:details.clientHeight,scrollHeight:details.scrollHeight};})()`);
          assert.ok(reading.scrollHeight > reading.height, 'dense body must use a bounded reading region');
          const keyboard=await nativeReading(name);
          await page.focus('loc=css:#agree');
          inner.reading = reading;
          inner.keyboard = keyboard;
        }
        await frameState("document.querySelector('#agree').click();true");
        await page.waitForFunction(() => window.__uiUntrustedSeen === true, undefined, { timeout: 2000 });
        assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 0, 'untrusted click wrote annotation');
        const beforeAgree=await page.evaluate(()=>({localWrites:window.__uiLocalWrites,eventCount:window.__uiConfirmationActions.length}));
        await page.focus('loc=css:#agree');
        assert.equal(await frameState('document.activeElement.id'), 'agree');
        await page.keyboard.press('Enter');
        await page.waitForSelector('loc=css:#state:text-is("已写入：仅本机")', { state: 'visible', timeout: 10000 });
        assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 1);
        assert.equal(await page.evaluate(() => document.querySelectorAll('mark.aipm-anno-mark').length), 1);
        const confirmation=await page.evaluate(before=>({localWriteDelta:window.__uiLocalWrites-before.localWrites,
          actions:window.__uiConfirmationActions.slice(before.eventCount),entryKeys:window.__uiEntryKeys}),beforeAgree);
        assert.equal(confirmation.localWriteDelta,1);
        assert.deepEqual(confirmation.actions.map(({action,trusted})=>({action,trusted})),[{action:'agree',trusted:true}]);
        assert.deepEqual(confirmation.entryKeys.map(({key,trusted})=>({key,trusted})),[{key:'Enter',trusted:true},{key:'Enter',trusted:true}]);
        await writeFile(`${directory}/${name}-confirmation-result.json`,JSON.stringify({beforeAgree,confirmation},null,2));
        await paintFrame();
        await screenshot(`${name}-keyboard-confirmed`);
        await page.click('.aipm-chat__close');
        await page.click('loc=css:mark.aipm-anno-mark');
        await page.click('.aipm-anno__item button[data-action="edit"]');
        await page.waitForSelector('form[data-editor="edit"] textarea', { state: 'visible' });
        await page.click('form[data-editor="edit"] .aipm-anno__visbtn');
        const selected = await page.evaluate(() => document.activeElement?.getAttribute('data-vis'));
        await writeFile(`${directory}/${name}-menu-focus.json`,JSON.stringify(await page.evaluate(()=>{
          const button=document.querySelector('form[data-editor="edit"] .aipm-anno__visbtn');
          const list=document.querySelector('form[data-editor="edit"] .aipm-anno__vislist');
          const rect=button.getBoundingClientRect();
          return {at:performance.now(),active:{tag:document.activeElement.tagName,className:document.activeElement.className,
            selected:document.activeElement.getAttribute('data-vis')},listHidden:list.hidden,expanded:button.getAttribute('aria-expanded'),
            buttonRect:rect.toJSON(),hitTargets:document.elementsFromPoint(rect.x+rect.width/2,rect.y+rect.height/2).slice(0,5).map(element=>({tag:element.tagName,className:element.className})),
            selectedOptions:[...list.querySelectorAll('[aria-selected="true"]')].map(element=>element.getAttribute('data-vis'))};
        }),null,2));
        assert.equal(selected, 'local');
        const menu = await page.evaluate(() => {
          const rect=document.querySelector('form[data-editor="edit"] .aipm-anno__vislist').getBoundingClientRect();
          const panel=document.querySelector('.aipm-anno').getBoundingClientRect();
          return {left:rect.left,right:rect.right,panelLeft:panel.left,panelRight:panel.right};
        });
        assert.ok(menu.left >= menu.panelLeft && menu.right <= menu.panelRight, 'visibility menu is clipped');
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-vis')), 'private');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('aipm-anno__visbtn')), true);
        assert.equal(await page.evaluate(() => document.querySelector('form[data-editor="edit"] .aipm-anno__visbtn').getAttribute('aria-expanded')), 'false');
        await screenshot(`${name}-editor`);
        const editor = await page.evaluate(() => {
          const form=document.querySelector('form[data-editor="edit"]');const actions=form.querySelector('.aipm-anno__actions');
          return {width:form.clientWidth,scrollWidth:form.scrollWidth,scope:form.querySelector('.aipm-anno__vislabel').textContent,
            rrBlocked:!!form.closest('.rr-block'),buttons:[...actions.querySelectorAll('.aipm-anno__cancel,.aipm-anno__save,.aipm-anno__visbtn')].map(button=>({height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width}))};
        });
        assert.ok(editor.scrollWidth <= editor.width + 1);
        assert.ok(editor.buttons.every(button => button.height >= 44));
        assert.equal(editor.rrBlocked, true);
        assert.equal(editor.scope, '仅本机');
        await page.fill('form[data-editor="edit"] textarea', BODY + '\n已完成编辑检查。');
        await page.click('form[data-editor="edit"] button[type="submit"]');
        await page.waitForFunction(body => window.__aipmAnnoStore.localList(location.pathname)[0]?.body === body, BODY + '\n已完成编辑检查。', { timeout: 5000 });
        await page.reload();
        await page.waitForFunction(() => window.__aipmIntegrityReady === true && document.querySelectorAll('mark.aipm-anno-mark').length === 1, undefined, { timeout: 20000 });
        assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 1);
        cases.push({ name, status: 'pass', entryCancel, confirmation, outer, inner, editor, trustedSingleWrite: true, untrustedZeroWrite: true, refreshNoDuplicate: true });
        await writeFile(`${directory}/${name}-result.json`,JSON.stringify(cases.at(-1),null,2));
      } else cases.push({ name, status: 'observed', outer, inner });
      if (phase === 'after') {
        const ids = await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).map(item => item.id));
        assert.equal(ids.length, 1);
        await page.evaluate(id => window.__aipmAnnoStore.localRemove(location.pathname, id), ids[0]);
      }
    }
  }
  const presentation = [];
  const presentationLayout = [];
  if (phase === 'after' && !scene) {
    await page.goto(`${config.site}/ai/rag/`);
    await page.waitForFunction(() => window.__aipmIntegrityReady === true, undefined, { timeout: 20000 });
    await page.evaluate(async () => {
      const {createConfirmationView}=await import('/_static/js/annotation-confirm-view.js?v=46');
      const host=document.createElement('section');
      host.className='aipm-chat__proposal';
      document.querySelector('.md-content__inner').prepend(host);
      window.__uiPresentationActions=[];
      window.__uiPresentation=createConfirmationView(host,(action,trusted)=>window.__uiPresentationActions.push({action,trusted,at:performance.now()}));
      window.__uiPresentation.update({title:'界面状态检查',target:'非敏感引文'.repeat(667).slice(0,4000),
        body:'非敏感正文'.repeat(800).slice(0,4000),visibility:'仅本机'});
    });
    await page.waitForSelector('loc=css:#title:text-is("界面状态检查")',{state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.aipm-confirmation-frame').clientHeight>260,undefined,{timeout:5000});
    for(const width of [1280,390,320]) for(const scheme of ['slate','default']) {
      await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      for(const status of ['pending','loading','warning','error','cancelled']) {
        await page.evaluate(({scheme,status})=>{
          document.body.setAttribute('data-md-color-scheme',scheme);
          window.__uiPresentation.update({status,state:`组件状态检查：${status}`,agreeDisabled:status!=='pending',cancelDisabled:status==='cancelled'});
        },{scheme,status});
        let state;
        const deadline = Date.now() + 3000;
        do {
          state=await frameState(`(()=>{const section=document.querySelector('section');const state=document.querySelector('#state');
          return {status:section.dataset.status,busy:section.getAttribute('aria-busy'),role:state.getAttribute('role'),
            color:getComputedStyle(state).color,scheme:getComputedStyle(document.documentElement).colorScheme,
            disabled:document.querySelector('#agree').disabled,height:document.documentElement.clientHeight,
            scrollHeight:document.documentElement.scrollHeight,sectionHeight:Math.ceil(section.getBoundingClientRect().height),
            scrollWidth:document.documentElement.scrollWidth,width:document.documentElement.clientWidth};})()`);
          presentationLayout.push({width,scheme,status,at:Date.now(),state});
          if (state.status !== status || state.scheme !== (scheme === 'slate' ? 'dark' : 'light') || state.sectionHeight !== state.height) {
            await new Promise(resolve => setTimeout(resolve,20));
          }
        } while ((state.status !== status || state.scheme !== (scheme === 'slate' ? 'dark' : 'light') ||
          state.sectionHeight !== state.height) && Date.now() < deadline);
        await writeFile(`${directory}/presentation-layout.json`,JSON.stringify(presentationLayout,null,2));
        assert.equal(state.status,status);
        assert.equal(state.busy,String(status==='loading'));
        assert.equal(state.role,status==='error'?'alert':'status');
        assert.equal(state.disabled,status!=='pending');
        assert.equal(state.scheme,scheme==='slate'?'dark':'light');
        assert.equal(state.height,state.sectionHeight);
        assert.ok(state.scrollHeight<=state.height+1,JSON.stringify({width,scheme,status,state}));
        assert.ok(state.scrollWidth<=state.width+1);
        presentation.push({width,scheme,status,source:'production presentation API with explicit component state input',state});
      }
      await page.evaluate(()=>window.__uiPresentation.update({status:'pending',state:'等待同意',cancelDisabled:false}));
      const cancellation=await keyboardCancel(`${width}-${scheme}-presentation`,'__uiPresentationActions');
      presentation.push({width,scheme,keyboardCancel:true,cancellation});
    }
    assert.equal(await page.evaluate(()=>window.__aipmAnnoStore.localList(location.pathname).length),0);
    await page.evaluate(()=>window.__uiPresentation.dispose());
  }
  if (breakpoint) await page.cdp('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
  const service = await (await fetch(config.control)).json();
  assert.equal(service.writes, 0);
  assert.equal(service.annotationMutations, 0);
  assert.equal(service.permitRequests, 0);
  const result = { phase, spaceId: task.spaceId, scene, denseBody, bodyLength: (denseBody ? LONG_BODY : BODY).length, cases, presentation, service, externalModelRequests: 0, externalJevRequests: 0,
    input: 'non-sensitive UI component fixture; original production renderer exposed by conditional Debugger breakpoint',
    modelGeneration: 'not_run', oauth: 'not_run' };
  await writeFile(`${directory}/ui-results.json`, JSON.stringify(result, null, 2));
  console.log({ phase, spaceId: task.spaceId, cases: cases.map(item => ({ name: item.name, status: item.status })) });
  return result;
}
