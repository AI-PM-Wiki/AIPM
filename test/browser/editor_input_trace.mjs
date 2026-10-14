import assert from 'node:assert/strict';

export async function waitForEditorLayout(page) {
  const result = await page.evaluate(() => new Promise(resolve => {
    const button = document.querySelector('form[data-editor="edit"] .aipm-anno__visbtn');
    const panel = document.querySelector('.aipm-anno');
    if (!button || !panel) throw new Error('edit visibility control missing');
    const samples = [];
    let stableFrames = 0;
    let previous;
    let frame;
    const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve({ready:false,samples}); }, 3000);
    function sample() {
      const rect = button.getBoundingClientRect();
      const geometry = [rect.x,rect.y,rect.width,rect.height];
      const running = panel.getAnimations().some(animation => animation.playState === 'running' || animation.pending);
      const same = previous?.every((value,index) => value === geometry[index]);
      stableFrames = button.isConnected && !running && same ? stableFrames + 1 : 0;
      samples.push({at:performance.now(),rect:rect.toJSON(),running,connected:button.isConnected,stableFrames});
      if (stableFrames >= 2) {
        clearTimeout(timer);
        resolve({ready:true,samples});
      } else {
        previous = geometry;
        frame = requestAnimationFrame(sample);
      }
    }
    frame = requestAnimationFrame(sample);
  }));
  return result;
}

export function assertEditorMenuInput(trace) {
  const clicks = trace.filter(row => row.kind === 'click' && row.state.button &&
    row.path.some(node => node?.id === row.state.button.id));
  assert.equal(clicks.length,1,'expected exactly one visibility button click');
  const click = clicks[0];
  assert.equal(click.trusted,true);
  for (const kind of ['pointerdown','pointerup']) {
    const events = trace.filter(row => row.kind === kind && row.state.button &&
      row.path.some(node => node?.id === row.state.button.id));
    assert.equal(events.length,1,`expected exactly one visibility button ${kind}`);
    assert.equal(events[0].trusted,true);
    assert.equal(events[0].state.button.id,click.state.button.id);
    assert.equal(events[0].state.form.id,click.state.form.id);
    const rect = events[0].state.buttonRect;
    assert.ok(events[0].x >= rect.left && events[0].x <= rect.right &&
      events[0].y >= rect.top && events[0].y <= rect.bottom,'native pointer missed the event-time control rectangle');
  }
  assert.ok(trace.some(row => row.kind === 'focusin' && row.target.visibility === 'local' &&
    row.state.button?.id === click.state.button.id && row.state.hidden === false && row.state.expanded === 'true'),
  'selected option did not receive focus after the trusted click');
}

export async function startEditorInputTrace(page) {
  await page.evaluate(() => {
    const ids = new WeakMap();
    let nextId = 0;
    function node(element) {
      if (!(element instanceof Element)) return null;
      if (!ids.has(element)) ids.set(element, ++nextId);
      return { id: ids.get(element), tag: element.tagName, className: element.getAttribute('class'),
        action: element.getAttribute('data-action'), visibility: element.getAttribute('data-vis'),
        connected: element.isConnected };
    }
    function state() {
      const form = document.querySelector('form[data-editor="edit"]');
      const button = form?.querySelector('.aipm-anno__visbtn');
      const list = form?.querySelector('.aipm-anno__vislist');
      const panel = document.querySelector('.aipm-anno');
      return { active: node(document.activeElement), form: node(form), button: node(button),
        buttonRect: button?.getBoundingClientRect().toJSON(), hidden: list?.hidden,
        expanded: button?.getAttribute('aria-expanded'), panelRect: panel?.getBoundingClientRect().toJSON(),
        animations: panel?.getAnimations().map(animation => ({ state: animation.playState,
          currentTime: animation.currentTime, property: animation.transitionProperty })) };
    }
    const rows = [];
    const record = (kind, data = {}) => rows.push({ at: performance.now(), kind, ...data, state: state() });
    const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout',
      'transitionrun', 'transitionstart', 'transitionend', 'transitioncancel'];
    const listener = event => {
      if ((event.type.startsWith('transition') || event.type.startsWith('focus')) &&
        !event.target.closest?.('.aipm-anno, .aipm-chat, mark.aipm-anno-mark')) return;
      record(event.type, { target: node(event.target), relatedTarget: node(event.relatedTarget),
        path: event.composedPath().slice(0, 6).map(node), trusted: event.isTrusted,
        x: event.clientX, y: event.clientY, property: event.propertyName });
    };
    types.forEach(type => document.addEventListener(type, listener, true));
    const observer = new MutationObserver(records => {
      for (const mutation of records) {
        if (!mutation.target.closest?.('.aipm-anno')) continue;
        if (mutation.type === 'attributes') {
          record('attribute', { target: node(mutation.target), attribute: mutation.attributeName,
            previous: mutation.oldValue, value: mutation.target.getAttribute(mutation.attributeName) });
        } else if ([...mutation.addedNodes, ...mutation.removedNodes].some(element =>
          element instanceof Element && (element.matches('form') || element.querySelector('form')))) {
          record('editor-mutation', { added: [...mutation.addedNodes].map(node), removed: [...mutation.removedNodes].map(node) });
        }
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
      attributeOldValue: true, attributeFilter: ['hidden', 'aria-expanded'] });
    window.__uiEditorTrace = { rows, checkpoint: label => record('checkpoint', { label }),
      stop: () => { observer.disconnect(); types.forEach(type => document.removeEventListener(type, listener, true)); return rows; } };
    record('start');
  });
}
