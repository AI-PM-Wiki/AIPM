import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const BODY = '检索增强生成（RAG）将检索结果作为生成时的参考资料。批注可以记录资料来源、适用条件以及需要人工核对的事实。\n\n这段非敏感测试内容用于检查长正文的排版、可见范围以及受保护确认区。确认之前不写入批注；确认之后仅保存到当前设备。';

export async function checkConfirmationUi({ directory, sourceDirectory, taskSpace, spaceId, phase = 'after' }) {
  assert.ok(['before', 'after'].includes(phase));
  const config = JSON.parse(await readFile(`${directory}/runtime-config.json`, 'utf8'));
  const task = spaceId === undefined ? await taskSpace('AI-PM confirmation UI verification') : await taskSpace(spaceId);
  const page = task.page('p1');
  await writeFile(`${directory}/browser-space.json`, JSON.stringify({ id: task.spaceId }));
  await page.cdp('Network.enable', {});
  await page.cdp('Network.setBlockedURLs', { urls: ['*://*/api/chat*', 'http://127.0.0.1:8786/*',
    'http://127.0.0.1:8787/*', 'http://127.0.0.1:8788/*', 'https://annotations.aipm.ac/*',
    'https://agent.aipm.ac/*', 'https://umami.nvc.ac/api/record*', 'https://umami.nvc.ac/api/send*'] });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: await readFile(new URL('./block_external_uploads.js', import.meta.url), 'utf8'),
  });
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
      method: 'Runtime.evaluate', params: { expression, returnByValue: true } }) });
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
  for (const width of [1280, 390, 320]) {
    for (const scheme of ['slate', 'default']) {
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
        const wrap = document.createElement('div');
        wrap.className = 'aipm-chat__msg aipm-chat__msg--ai';
        document.querySelector('.aipm-chat__msgs').append(wrap);
        window.__uiProposalCard(wrap, { ...context, requestId: crypto.randomUUID(), scope: 'text',
          body, visibility: 'local', color: 'blue', style: 'underline' });
        window.__uiUntrustedSeen = false;
        window.addEventListener('message', event => {
          if(event.data?.type === 'confirmation-action' && event.data.trusted === false) window.__uiUntrustedSeen = true;
        });
      }, { scheme, body: BODY });
      if (width < 768) await page.click('.aipm-chat__ctx-view');
      await page.click('loc=css:.aipm-chat__proposal button:text-is("查看批注建议")');
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
        assert.equal(inner.body, '正文：' + BODY);
        assert.equal(inner.scheme, scheme === 'slate' ? 'dark' : 'light');
        assert.ok(inner.buttonHeight >= 44);
        assert.ok(inner.buttonContrast >= 4.5);
        assert.ok(outer.choices.every(button => button.height >= 44));
        assert.ok(outer.cardScrollWidth <= outer.cardWidth + 1, 'card has horizontal clipping');
        assert.ok(inner.scrollWidth <= inner.width + 1, 'frame has horizontal clipping');
        assert.ok(inner.scrollHeight <= inner.height + 1, 'frame requires nested vertical scrolling');
        assert.equal(outer.frameHeight, inner.sectionHeight);
        await frameState("document.querySelector('#agree').click();true");
        await page.waitForFunction(() => window.__uiUntrustedSeen === true, undefined, { timeout: 2000 });
        assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 0, 'untrusted click wrote annotation');
        if (width === 1280 && scheme === 'slate') {
          await page.focus('loc=css:#agree');
          assert.equal(await frameState('document.activeElement.id'), 'agree');
          await page.keyboard.press('Enter');
        } else await page.click('loc=css:#agree');
        await page.waitForSelector('loc=css:#state:text-is("已写入：仅本机")', { state: 'visible', timeout: 10000 });
        assert.equal(await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).length), 1);
        assert.equal(await page.evaluate(() => document.querySelectorAll('mark.aipm-anno-mark').length), 1);
        await page.click('.aipm-chat__close');
        await page.click('loc=css:mark.aipm-anno-mark');
        await page.click('.aipm-anno__item button[data-action="edit"]');
        await page.waitForSelector('form[data-editor="edit"] textarea', { state: 'visible' });
        await page.click('form[data-editor="edit"] .aipm-anno__visbtn');
        const selected = await page.evaluate(() => document.activeElement?.getAttribute('data-vis'));
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
        cases.push({ name, status: 'pass', outer, inner, editor, trustedSingleWrite: true, untrustedZeroWrite: true, refreshNoDuplicate: true });
      } else cases.push({ name, status: 'observed', outer, inner });
      if (phase === 'after') {
        const ids = await page.evaluate(() => window.__aipmAnnoStore.localList(location.pathname).map(item => item.id));
        assert.equal(ids.length, 1);
        await page.evaluate(id => window.__aipmAnnoStore.localRemove(location.pathname, id), ids[0]);
      }
    }
  }
  const presentation = [];
  if (phase === 'after') {
    await page.goto(`${config.site}/ai/rag/`);
    await page.waitForFunction(() => window.__aipmIntegrityReady === true, undefined, { timeout: 20000 });
    await page.evaluate(async () => {
      const {createConfirmationView}=await import('/_static/js/annotation-confirm-view.js?v=46');
      const host=document.createElement('section');
      host.className='aipm-chat__proposal';
      document.querySelector('.md-content__inner').prepend(host);
      window.__uiPresentationActions=[];
      window.__uiPresentation=createConfirmationView(host,(action,trusted)=>window.__uiPresentationActions.push({action,trusted}));
      window.__uiPresentation.update({title:'界面状态检查',target:'非敏感引文'.repeat(667).slice(0,4000),
        body:'非敏感正文'.repeat(800).slice(0,4000),visibility:'仅本机'});
    });
    await page.waitForSelector('loc=css:#title:text-is("界面状态检查")',{state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.aipm-confirmation-frame').clientHeight>10000,undefined,{timeout:5000});
    for(const scheme of ['slate','default']) {
      for(const status of ['pending','loading','warning','error','cancelled']) {
        await page.evaluate(({scheme,status})=>{
          document.body.setAttribute('data-md-color-scheme',scheme);
          window.__uiPresentation.update({status,state:`组件状态检查：${status}`,agreeDisabled:status!=='pending',cancelDisabled:status==='cancelled'});
        },{scheme,status});
        const state=await frameState(`(()=>{const section=document.querySelector('section');const state=document.querySelector('#state');
          return {status:section.dataset.status,busy:section.getAttribute('aria-busy'),role:state.getAttribute('role'),
            color:getComputedStyle(state).color,scheme:getComputedStyle(document.documentElement).colorScheme,
            disabled:document.querySelector('#agree').disabled,height:document.documentElement.clientHeight,
            scrollHeight:document.documentElement.scrollHeight,sectionHeight:Math.ceil(section.getBoundingClientRect().height),
            scrollWidth:document.documentElement.scrollWidth,width:document.documentElement.clientWidth};})()`);
        assert.equal(state.status,status);
        assert.equal(state.busy,String(status==='loading'));
        assert.equal(state.role,status==='error'?'alert':'status');
        assert.equal(state.disabled,status!=='pending');
        assert.equal(state.scheme,scheme==='slate'?'dark':'light');
        assert.ok(state.scrollHeight<=state.height+1);
        assert.ok(state.scrollWidth<=state.width+1);
        presentation.push({scheme,status,source:'production presentation API with explicit component state input',state});
      }
    }
    assert.equal(await page.evaluate(()=>window.__aipmAnnoStore.localList(location.pathname).length),0);
    await page.evaluate(()=>window.__uiPresentation.dispose());
  }
  await page.cdp('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
  const service = await (await fetch(config.control)).json();
  assert.equal(service.writes, 0);
  assert.equal(service.annotationMutations, 0);
  assert.equal(service.permitRequests, 0);
  const result = { phase, spaceId: task.spaceId, cases, presentation, service, externalModelRequests: 0, externalJevRequests: 0,
    input: 'non-sensitive UI component fixture; original production renderer exposed by conditional Debugger breakpoint',
    modelGeneration: 'not_run', oauth: 'not_run' };
  await writeFile(`${directory}/ui-results.json`, JSON.stringify(result, null, 2));
  console.log({ phase, spaceId: task.spaceId, cases: cases.map(item => ({ name: item.name, status: item.status })) });
  return result;
}
