(function () {
  'use strict';

  let sequence = 0;
  let mermaidReady;
  function loadMermaid() {
    if (window.mermaid?.render) return Promise.resolve(window.mermaid);
    if (!mermaidReady) mermaidReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/mermaid@11/dist/mermaid.min.js';
      script.onload = () => window.mermaid?.render
        ? resolve(window.mermaid) : reject(new Error('Mermaid unavailable'));
      script.onerror = () => reject(new Error('Mermaid unavailable'));
      document.head.append(script);
    }).catch(error => { mermaidReady = undefined; throw error; });
    return mermaidReady;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, action) {
    const node = element('button', 'aipm-summary__button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function isSummary(data) {
    const string = value => typeof value === 'string';
    const strings = value => Array.isArray(value) && value.length > 0 && value.length <= 5 && value.every(string);
    return !!data && data.version === 1 && string(data.page) && data.page.startsWith('/') &&
      !data.page.startsWith('//') && !/[?#\\]/.test(data.page) && string(data.title) &&
      /^[a-f0-9]{64}$/.test(data.revision) && string(data.generatedAt) && string(data.model) &&
      Array.isArray(data.mindmap?.branches) && data.mindmap.branches.length > 0 &&
      data.mindmap.branches.length <= 32 && data.mindmap.branches.every(branch => branch &&
        string(branch.label) && string(branch.anchor) && strings(branch.points)) &&
      string(data.reading?.overview) && Array.isArray(data.reading.sections) &&
      data.reading.sections.length > 0 && data.reading.sections.length <= 48 &&
      data.reading.sections.every(section => section && string(section.heading) && string(section.anchor) &&
        string(section.explanation) && strings(section.takeaways));
  }

  function label(text) {
    return text.replace(/&/g, '#amp;').replace(/"/g, '#quot;')
      .replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/\\/g, '#92;')
      .replace(/%/g, '#37;').replace(/`/g, '#96;').replace(/[\r\n]/g, ' ');
  }

  function diagramSource(data) {
    const lines = ['flowchart LR', 'root["' + label(data.title) + '"]'];
    data.mindmap.branches.forEach((branch, index) => {
      lines.push('root --> s' + index + '["' + label(branch.label) + '"]');
      branch.points.forEach((point, child) => {
        lines.push('s' + index + ' --> p' + index + '_' + child + '["' + label(point) + '"]');
      });
      const nodes = ['s' + index, ...branch.points.map((_, child) => 'p' + index + '_' + child)];
      lines.push('class ' + nodes.join(',') + ' aipm-summary-branch-' + index + ';');
    });
    return lines.join('\n');
  }

  function contextText(data) {
    return '《' + data.title + '》AI 总结\n文章：' + data.page + '\n' +
      diagramSource(data) + '\n\n' + data.reading.overview + '\n\n' +
      data.reading.sections.map(section => section.heading + '（#' + section.anchor + '）\n' +
        section.explanation + '\n' + section.takeaways.join('\n')).join('\n\n');
  }

  // The view owns presentation only; hosts supply article navigation and conversation actions.
  function createView({ host, navigate, continueChat }) {
    const id = 'aipm-summary-view-' + (++sequence);
    const root = element('section', 'aipm-summary-view');
    const tabs = element('div', 'aipm-summary__tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'AI 总结内容');
    const status = element('p', 'aipm-summary__status');
    status.setAttribute('role', 'status');
    const map = element('div', 'aipm-summary__content');
    const reading = element('div', 'aipm-summary__content');
    const content = [map, reading];
    const tabButtons = ['思维导图', 'AI 精读'].map((title, index) => {
      const tab = button(title, () => select(index));
      tab.id = id + '-tab-' + index;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', id + '-panel-' + index);
      content[index].id = id + '-panel-' + index;
      content[index].setAttribute('role', 'tabpanel');
      content[index].setAttribute('aria-labelledby', tab.id);
      tabs.append(tab);
      return tab;
    });
    let active = 0;
    let generation = 0;
    let data = null;
    let disposed = false;
    let stopDrawing = () => {};
    const footer = element('footer', 'aipm-summary__footer');
    function select(index) {
      active = index;
      tabButtons.forEach((tab, current) => {
        tab.setAttribute('aria-selected', String(current === index));
        tab.tabIndex = current === index ? 0 : -1;
        content[current].hidden = current !== index;
      });
    }
    tabs.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (active + 1) % 2;
      if (event.key === 'ArrowLeft') next = (active + 1) % 2;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = 1;
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      tabButtons[next].focus();
    });
    function sourceLink(text, anchor) {
      const link = element('a', 'aipm-summary__source', text);
      link.href = data.page + (anchor ? '#' + encodeURIComponent(anchor) : '');
      link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(data.page, anchor);
      });
      return link;
    }
    async function draw(current) {
      const diagram = element('div', 'aipm-summary__diagram');
      diagram.setAttribute('aria-label', '文章思维导图');
      const notice = element('p', 'aipm-summary__status', '正在绘制思维导图…');
      map.prepend(diagram, notice);
      try {
        const mermaid = await loadMermaid();
        if (disposed || current !== generation) return;
        const dark = document.body.getAttribute('data-md-color-scheme') === 'slate';
        const source = '%%{init: ' + JSON.stringify({
          theme: dark ? 'dark' : 'neutral', securityLevel: 'strict',
          flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis' },
        }) + '}%%\n' + diagramSource(data);
        const rendered = await mermaid.render(id + '-graph-' + current, source);
        if (disposed || current !== generation) return;
        diagram.innerHTML = rendered.svg;
        const svg = diagram.querySelector('svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', data.title + '思维导图，点击节点阅读原文');
        data.mindmap.branches.forEach((branch, index) => {
          const nodes = diagram.querySelectorAll('.aipm-summary-branch-' + index);
          nodes.forEach(node => {
            node.setAttribute('data-summary-branch', String(index));
            node.setAttribute('role', 'link');
            node.setAttribute('tabindex', '0');
            node.setAttribute('aria-label', '阅读原文：' + branch.label);
            const go = () => navigate(data.page, branch.anchor);
            node.addEventListener('click', go);
            node.addEventListener('keydown', event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              go();
            });
          });
        });
        const controls = element('div', 'aipm-summary__zoom');
        const naturalWidth = svg.viewBox.baseVal.width;
        let scale = 1;
        let fitWidth = true;
        const apply = next => {
          scale = Math.max(.1, Math.min(2, next));
          svg.style.width = naturalWidth * scale + 'px';
        };
        const fit = () => {
          fitWidth = true;
          if (diagram.clientWidth) apply((diagram.clientWidth - 24) / naturalWidth);
        };
        controls.append(button('适应宽度', fit), button('缩小', () => { fitWidth = false; apply(scale / 1.3); }),
          button('放大', () => { fitWidth = false; apply(scale * 1.3); }));
        diagram.before(controls);
        const resize = new ResizeObserver(() => { if (fitWidth) fit(); });
        resize.observe(diagram);
        stopDrawing = () => resize.disconnect();
        fit();
        notice.remove();
      } catch (error) {
        if (disposed || current !== generation) return;
        notice.textContent = '思维导图绘制失败。';
        notice.append(button('重新绘制', () => { diagram.remove(); notice.remove(); void draw(current); }));
      }
    }
    function setLoading() {
      stopDrawing();
      generation++;
      data = null;
      select(0);
      map.replaceChildren();
      reading.replaceChildren();
      footer.replaceChildren();
      root.setAttribute('aria-busy', 'true');
      status.textContent = '正在同时生成思维导图和 AI 精读…';
    }
    function setError(message, retry) {
      root.setAttribute('aria-busy', 'false');
      status.textContent = message;
      if (retry) status.append(button('重试', retry));
    }
    function setData(summary) {
      if (!isSummary(summary)) throw new Error('invalid article summary');
      stopDrawing();
      data = summary;
      const current = ++generation;
      root.setAttribute('aria-busy', 'false');
      status.textContent = 'AI 生成，请结合原文阅读。';
      map.replaceChildren();
      reading.replaceChildren(element('p', 'aipm-summary__overview', data.reading.overview));
      const outline = element('ul', 'aipm-summary__outline');
      data.mindmap.branches.forEach(branch => {
        const item = element('li');
        item.append(sourceLink(branch.label, branch.anchor));
        branch.points.forEach(point => item.append(element('p', '', point)));
        outline.append(item);
      });
      map.append(outline);
      data.reading.sections.forEach(section => {
        const card = element('section', 'aipm-summary__section');
        const title = element('h3');
        title.append(sourceLink(section.heading, section.anchor));
        const points = element('ul');
        section.takeaways.forEach(point => points.append(element('li', '', point)));
        card.append(title, element('p', '', section.explanation), points);
        reading.append(card);
      });
      footer.replaceChildren(element('small', '', new Date(data.generatedAt).toLocaleString() + ' · ' + data.model));
      if (continueChat) footer.append(button('与 AI 继续讨论', () => continueChat(data)));
      void draw(current);
    }
    root.append(tabs, status, map, reading, footer);
    host.append(root);
    select(0);
    const theme = new MutationObserver(() => {
      if (!root.isConnected) { theme.disconnect(); return; }
      if (data) setData(data);
    });
    theme.observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
    return { setLoading, setError, setData, dispose: () => {
      disposed = true; generation++; stopDrawing(); theme.disconnect(); root.remove();
    } };
  }

  window.__aipmSummary = { createView, isSummary, contextText };
  if (!document.querySelector('.md-header__inner')) return;
  if (/\.netlify\.app$/i.test(location.hostname)) return;
  const panels = window.__aipmPanels;
  if (!panels) throw new Error('summary requires panel-shared.js');
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const api = local ? (window.__aipmLocalApi?.agent || 'http://127.0.0.1:8787') : 'https://docs-agent.nvc.ac';
  if (local) {
    const endpoint = new URL(api);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
        endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
      throw new Error('invalid local summary endpoint');
    }
  }
  const entry = button('', () => opened ? close() : panels.claim('summary'));
  entry.className = 'md-header__button md-icon aipm-summary-entry';
  entry.title = 'AI 总结';
  entry.setAttribute('aria-label', 'AI 总结');
  entry.setAttribute('aria-expanded', 'false');
  entry.setAttribute('aria-controls', 'aipm-summary');
  entry.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.9 6.1L22 9l-5 4.9 1.2 7-6.2-3.3L5.8 21 7 13.9 2 9l7.1-.9L12 2z"/></svg>';
  const panel = element('aside', 'aipm-summary');
  panel.id = 'aipm-summary';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'aipm-summary-title');
  const head = element('header', 'aipm-summary__head');
  const title = element('h2', '', 'AI 总结');
  title.id = 'aipm-summary-title';
  const closeButton = button('×', () => close());
  closeButton.setAttribute('aria-label', '关闭 AI 总结');
  head.append(title, closeButton);
  const articleTitle = element('p', 'aipm-summary__article');
  const host = element('div', 'aipm-summary__host');
  const backdrop = button('', () => close());
  backdrop.className = 'aipm-summary__backdrop';
  backdrop.setAttribute('aria-label', '关闭 AI 总结');
  backdrop.tabIndex = -1;
  backdrop.hidden = true;
  panel.append(head, articleTitle, host);
  document.body.append(backdrop, panel);
  let opened = false;
  let request;
  let currentPage = '';
  let loaded = false;
  let previousFocus;
  const mobile = window.matchMedia('(max-width: 74.999em)');
  const view = createView({
    host,
    navigate,
    continueChat: data => {
      const result = window.__aipmChat?.openSummary(data);
      if (!result?.ok) view.setError(result?.message || 'AI 助手尚未就绪，请稍后重试。');
    },
  });

  function navigate(page, anchor) {
    if (page !== location.pathname) {
      location.assign(page + (anchor ? '#' + encodeURIComponent(anchor) : ''));
      return;
    }
    const target = anchor ? document.getElementById(anchor) : document.querySelector('.md-content__inner');
    if (!target) {
      view.setError('该章节已更新，请刷新文章后重新打开总结。');
      return;
    }
    if (mobile.matches) close(false);
    target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    const url = new URL(location.href);
    url.hash = anchor;
    history.replaceState(history.state, '', url);
  }

  function syncMode() {
    panel.setAttribute('role', mobile.matches ? 'dialog' : 'complementary');
    if (mobile.matches) panel.setAttribute('aria-modal', 'true');
    else panel.removeAttribute('aria-modal');
    backdrop.hidden = !opened || !mobile.matches;
  }

  async function load() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const page = location.pathname;
    currentPage = page;
    loaded = false;
    articleTitle.textContent = document.querySelector('.md-content__inner h1')?.textContent.replace(/¶/g, '').trim() || document.title;
    view.setLoading();
    try {
      const response = await fetch(api + '/api/summary?page=' + encodeURIComponent(page), { signal: controller.signal });
      const data = await response.json();
      if (controller.signal.aborted || location.pathname !== page) return;
      if (!response.ok) {
        const retry = Number(response.headers.get('Retry-After'));
        const wait = retry > 0 ? '请在 ' + Math.ceil(retry / 60) + ' 分钟后重试。' : '';
        throw new Error((data.message || 'AI 总结暂时不可用。') + wait);
      }
      if (!isSummary(data) || data.page !== page) throw new Error('AI 总结内容校验失败，请重试。');
      view.setData(data);
      loaded = true;
    } catch (error) {
      if (controller.signal.aborted || location.pathname !== page) return;
      view.setError(error instanceof TypeError ? '网络连接失败，请检查网络后重试。' : error.message, () => void load());
    } finally {
      if (request === controller) request = null;
    }
  }

  function open() {
    previousFocus = document.activeElement;
    opened = true;
    panel.hidden = false;
    document.documentElement.classList.add('aipm-summary-open');
    entry.setAttribute('aria-expanded', 'true');
    syncMode();
    closeButton.focus();
    if (!loaded || currentPage !== location.pathname) void load();
  }

  function close(restoreFocus = true) {
    opened = false;
    panel.hidden = true;
    backdrop.hidden = true;
    document.documentElement.classList.remove('aipm-summary-open');
    entry.setAttribute('aria-expanded', 'false');
    if (restoreFocus !== false) (previousFocus?.isConnected ? previousFocus : entry).focus();
  }

  function mount() {
    const header = document.querySelector('.md-header__inner');
    if (header && entry.parentElement !== header) header.append(entry);
    if (currentPage !== location.pathname) {
      request?.abort();
      loaded = false;
      currentPage = '';
      if (opened) void load();
    }
  }

  panels.register('summary', { open, close: () => close(false), isOpen: () => opened });
  document.addEventListener('keydown', event => {
    if (!opened || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key !== 'Tab' || !mobile.matches) return;
    const nodes = [...panel.querySelectorAll('button, a, [tabindex="0"]')]
      .filter(node => !node.disabled && node.getClientRects().length);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  mobile.addEventListener('change', syncMode);
  mount();
  if (typeof document$ !== 'undefined' && document$.subscribe) document$.subscribe(mount);
})();
