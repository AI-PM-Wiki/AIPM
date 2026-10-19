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

  const ICON = {
    spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/><path d="M20 2v4m-2-2h4"/>',
    map: '<rect x="3" y="9" width="5" height="6" rx="1"/><rect x="16" y="3" width="5" height="6" rx="1"/><rect x="16" y="15" width="5" height="6" rx="1"/><path d="M8 12h4m4-6h-4v12h4"/>',
    reading: '<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h3"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    fullscreen: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    fit: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 8H7v3m8-3h2v3M7 14v2h2m6 0h2v-2"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2V11.5a8.5 8.5 0 0 1 17 0Z"/><path d="M7 10h9M7 14h6"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  };

  function icon(name) {
    const holder = element('span', 'aipm-summary__icon');
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + '</svg>';
    return holder;
  }

  function iconButton(name, label, action) {
    const node = button('', action);
    node.classList.add('aipm-summary__icon-button');
    node.setAttribute('aria-label', label);
    node.title = label;
    node.append(icon(name));
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

  function diagramSource(data, expanded = true) {
    const lines = ['flowchart LR', 'root["' + label(data.title) + '"]'];
    data.mindmap.branches.forEach((branch, index) => {
      lines.push('root --> s' + index + '["' + label(branch.label) + '"]');
      if (expanded) branch.points.forEach((point, child) => {
        lines.push('s' + index + ' --> p' + index + '_' + child + '["' + label(point) + '"]');
      });
      const nodes = ['s' + index, ...(expanded ? branch.points.map((_, child) => 'p' + index + '_' + child) : [])];
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
    const body = element('div', 'aipm-summary__body');
    body.append(map, reading);
    const tabButtons = ['思维导图', 'AI 精读'].map((title, index) => {
      const tab = button(title, () => select(index));
      tab.prepend(icon(index === 0 ? 'map' : 'reading'));
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
    const scrollPositions = [0, 0];
    let generation = 0;
    let data = null;
    let disposed = false;
    let expanded = false;
    let stopDrawing = () => {};
    const footer = element('footer', 'aipm-summary__footer');
    body.append(footer);
    const fullscreen = element('dialog', 'aipm-summary-view aipm-summary__fullscreen');
    fullscreen.setAttribute('aria-label', '思维导图全屏显示');
    const fullscreenHead = element('header', 'aipm-summary__head');
    const fullscreenTitle = element('h2');
    const exitButton = iconButton('close', '退出全屏', () => fullscreen.close());
    fullscreenHead.append(fullscreenTitle, exitButton);
    fullscreen.append(fullscreenHead);
    fullscreen.addEventListener('keydown', event => event.stopPropagation());
    fullscreen.addEventListener('cancel', event => {
      event.preventDefault();
      event.stopPropagation();
      fullscreen.close();
    });
    fullscreen.addEventListener('close', () => {
      document.documentElement.classList.remove('aipm-summary-fullscreen-open');
      const graph = fullscreen.querySelector('.aipm-summary__graph');
      if (graph) {
        map.prepend(graph);
        graph.querySelector('[data-summary-fullscreen]')?.focus({ preventScroll: true });
      }
    });
    function exitFullscreen() {
      if (!fullscreen.open) return;
      const graph = fullscreen.querySelector('.aipm-summary__graph');
      if (graph) map.prepend(graph);
      fullscreen.close();
      document.documentElement.classList.remove('aipm-summary-fullscreen-open');
    }
    function goToSource(page, anchor) {
      exitFullscreen();
      navigate(page, anchor);
    }
    function select(index) {
      scrollPositions[active] = body.scrollTop;
      active = index;
      tabButtons.forEach((tab, current) => {
        tab.setAttribute('aria-selected', String(current === index));
        tab.tabIndex = current === index ? 0 : -1;
        content[current].hidden = current !== index;
      });
      body.scrollTop = scrollPositions[index];
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
      link.title = '阅读原文：' + text;
      link.href = data.page + (anchor ? '#' + encodeURIComponent(anchor) : '');
      link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        goToSource(data.page, anchor);
      });
      return link;
    }
    async function draw(current, restoreFocus = false) {
      const graph = element('section', 'aipm-summary__graph');
      const toolbar = element('div', 'aipm-summary__toolbar');
      const detail = button(expanded ? '收起要点' : '展开要点', () => {
        const focused = document.activeElement === detail;
        stopDrawing();
        expanded = !expanded;
        graph.remove();
        void draw(++generation, focused);
      });
      detail.classList.add('aipm-summary__detail-toggle');
      detail.setAttribute('aria-pressed', String(expanded));
      const actions = element('div', 'aipm-summary__graph-actions');
      const fullButton = iconButton('fullscreen', '全屏显示', () => {
        fullscreenTitle.textContent = data.title + ' · 思维导图';
        document.body.append(fullscreen);
        fullscreen.append(graph);
        fullscreen.showModal();
        document.documentElement.classList.add('aipm-summary-fullscreen-open');
        exitButton.focus();
      });
      fullButton.dataset.summaryFullscreen = '';
      actions.append(detail, fullButton);
      toolbar.append(element('span', 'aipm-summary__graph-label', '文章脉络'), actions);
      const diagram = element('div', 'aipm-summary__diagram');
      diagram.setAttribute('aria-label', '文章思维导图');
      const notice = element('p', 'aipm-summary__status', '正在绘制思维导图…');
      graph.append(toolbar, diagram, notice);
      if (fullscreen.open) fullscreen.append(graph);
      else map.prepend(graph);
      if (restoreFocus) detail.focus();
      try {
        const mermaid = await loadMermaid();
        if (disposed || current !== generation) return;
        const dark = document.body.getAttribute('data-md-color-scheme') === 'slate';
        const styles = getComputedStyle(root);
        const source = '%%{init: ' + JSON.stringify({
          theme: dark ? 'dark' : 'neutral', securityLevel: 'strict',
          themeVariables: { fontFamily: styles.fontFamily, fontSize: '15px' },
          flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis', nodeSpacing: 6, rankSpacing: 36, padding: 6 },
        }) + '}%%\n' + diagramSource(data, expanded);
        const rendered = await mermaid.render(id + '-graph-' + current, source);
        if (disposed || current !== generation) return;
        diagram.innerHTML = rendered.svg;
        const svg = diagram.querySelector('svg');
        svg.setAttribute('role', 'group');
        svg.setAttribute('aria-label', data.title + '思维导图，点击节点阅读原文');
        svg.querySelectorAll('.node rect').forEach(rect => {
          rect.setAttribute('rx', '8');
          rect.setAttribute('ry', '8');
        });
        svg.querySelector('.node:not([class*="aipm-summary-branch-"])')?.classList.add('aipm-summary__root-node');
        data.mindmap.branches.forEach((branch, index) => {
          const nodes = diagram.querySelectorAll('.aipm-summary-branch-' + index);
          nodes.forEach(node => {
            node.setAttribute('data-summary-branch', String(index));
            node.setAttribute('role', 'link');
            node.setAttribute('tabindex', '0');
            node.setAttribute('aria-label', '阅读原文：' + branch.label);
            const go = () => goToSource(data.page, branch.anchor);
            node.addEventListener('click', go);
            node.addEventListener('keydown', event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              go();
            });
          });
        });
        const controls = element('div', 'aipm-summary__zoom');
        const scaleLabel = element('output', 'aipm-summary__scale');
        scaleLabel.setAttribute('aria-label', '导图缩放比例');
        const naturalWidth = svg.viewBox.baseVal.width;
        let scale = 1;
        let fitWidth = true;
        const apply = next => {
          scale = Math.max(.1, Math.min(2, next));
          svg.style.width = naturalWidth * scale + 'px';
          scaleLabel.textContent = Math.round(scale * 100) + '%';
        };
        const fit = () => {
          fitWidth = true;
          if (diagram.clientWidth) {
            const widthScale = (diagram.clientWidth - 32) / naturalWidth;
            const heightScale = fullscreen.open ? (diagram.clientHeight - 32) / svg.viewBox.baseVal.height : 1;
            apply(Math.min(1, widthScale, heightScale));
          }
        };
        controls.append(iconButton('minus', '缩小', () => { fitWidth = false; apply(scale / 1.3); }),
          scaleLabel, iconButton('plus', '放大', () => { fitWidth = false; apply(scale * 1.3); }), iconButton('fit', '适应窗口', fit));
        graph.append(element('p', 'aipm-summary__graph-hint', '点击主题节点，阅读对应原文'), controls);
        const resize = new ResizeObserver(() => { if (fitWidth) fit(); });
        resize.observe(diagram);
        stopDrawing = () => resize.disconnect();
        fit();
        notice.remove();
      } catch (error) {
        if (disposed || current !== generation) return;
        notice.textContent = '思维导图绘制失败。';
        notice.append(button('重新绘制', () => { graph.remove(); void draw(current, true); }));
      }
    }
    function setLoading() {
      exitFullscreen();
      stopDrawing();
      generation++;
      data = null;
      expanded = false;
      select(0);
      map.replaceChildren();
      reading.replaceChildren();
      body.scrollTop = 0;
      scrollPositions.fill(0);
      footer.replaceChildren();
      root.setAttribute('aria-busy', 'true');
      status.dataset.state = 'loading';
      status.textContent = '正在整理全文，生成思维导图与 AI 精读…';
      const placeholder = element('div', 'aipm-summary__loading');
      placeholder.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 3; index++) placeholder.append(element('span'));
      map.append(placeholder);
    }
    function setError(message, retry) {
      root.setAttribute('aria-busy', 'false');
      status.dataset.state = 'error';
      status.textContent = message;
      root.querySelector('.aipm-summary__loading')?.remove();
      if (retry) status.append(button('重试', retry));
    }
    function setData(summary) {
      if (!isSummary(summary)) throw new Error('invalid article summary');
      exitFullscreen();
      stopDrawing();
      data = summary;
      const current = ++generation;
      root.setAttribute('aria-busy', 'false');
      status.dataset.state = 'ready';
      status.textContent = data.mindmap.branches.length + ' 个主题 · ' + data.reading.sections.length + ' 节精读';
      map.replaceChildren();
      const intro = element('section', 'aipm-summary__intro');
      intro.append(element('span', 'aipm-summary__eyebrow', '全文导读'), element('p', 'aipm-summary__overview', data.reading.overview));
      reading.replaceChildren(intro);
      const outline = element('ol', 'aipm-summary__outline');
      data.mindmap.branches.forEach((branch, index) => {
        const item = element('li');
        const heading = element('h3');
        const number = element('span', 'aipm-summary__number', String(index + 1).padStart(2, '0'));
        number.setAttribute('aria-hidden', 'true');
        heading.append(number, sourceLink(branch.label, branch.anchor));
        const points = element('ul');
        branch.points.forEach(point => points.append(element('li', '', point)));
        item.append(heading, points);
        outline.append(item);
      });
      map.append(element('h3', 'aipm-summary__outline-title', '主题要点'), outline);
      data.reading.sections.forEach((section, index) => {
        const card = element('section', 'aipm-summary__section');
        const title = element('h3');
        const number = element('span', 'aipm-summary__number', String(index + 1).padStart(2, '0'));
        number.setAttribute('aria-hidden', 'true');
        title.append(number, sourceLink(section.heading, section.anchor));
        const points = element('ul');
        section.takeaways.forEach(point => points.append(element('li', '', point)));
        card.append(title, element('p', '', section.explanation), points);
        reading.append(card);
      });
      footer.replaceChildren();
      if (continueChat) {
        const discuss = button('与 AI 继续讨论', () => continueChat(data));
        discuss.classList.add('aipm-summary__discuss');
        discuss.prepend(icon('chat'));
        discuss.append(icon('arrow'));
        footer.append(discuss);
      }
      footer.append(element('small', '', 'AI 生成内容，请结合原文核对。'));
      void draw(current);
    }
    root.append(tabs, status, body);
    host.append(root);
    select(0);
    const theme = new MutationObserver(() => {
      if (!root.isConnected) { exitFullscreen(); fullscreen.remove(); theme.disconnect(); return; }
      if (data) setData(data);
    });
    theme.observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
    return { setLoading, setError, setData, exitFullscreen, dispose: () => {
      exitFullscreen();
      disposed = true; generation++; stopDrawing(); theme.disconnect(); fullscreen.remove(); root.remove();
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
  entry.append(icon('spark'));
  const panel = element('aside', 'aipm-summary');
  panel.id = 'aipm-summary';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'aipm-summary-title');
  const grip = button('', () => {});
  grip.className = 'aipm-summary__grip';
  grip.setAttribute('aria-label', '调整 AI 总结抽屉高度');
  grip.append(element('span'));
  const head = element('header', 'aipm-summary__head');
  const title = element('h2', '', 'AI 总结');
  title.prepend(icon('spark'));
  title.id = 'aipm-summary-title';
  const closeButton = iconButton('close', '关闭 AI 总结', () => close());
  head.append(title, closeButton);
  const articleTitle = element('p', 'aipm-summary__article');
  const host = element('div', 'aipm-summary__host');
  const backdrop = button('', () => close());
  backdrop.className = 'aipm-summary__backdrop';
  backdrop.setAttribute('aria-label', '关闭 AI 总结');
  backdrop.tabIndex = -1;
  backdrop.hidden = true;
  panel.append(grip, head, articleTitle, host);
  document.body.append(backdrop, panel);
  let opened = false;
  let request;
  let currentPage = '';
  let loaded = false;
  let previousFocus;
  const dock = window.matchMedia('(min-width: 75em)');
  const sheet = window.matchMedia('(max-width: 47.9875em)');
  let mode = 'dock';
  let snap = 'half';
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
    if (mode !== 'dock') close(false);
    target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    const url = new URL(location.href);
    url.hash = anchor;
    history.replaceState(history.state, '', url);
  }

  function metrics() {
    const viewport = panels.viewportHeights();
    const height = Math.min(viewport.vh, viewport.visible);
    return panels.computeMetrics({ vh: height, visible: height,
      peek: Math.min(220, height * .4), peekMin: 136, halfVh: .55, topGap: 16 });
  }

  function locked() {
    return opened && mode !== 'dock' && (mode !== 'sheet' || snap !== 'peek');
  }

  function syncChrome() {
    document.documentElement.classList.toggle('aipm-summary-locked', locked());
    panel.setAttribute('role', mode === 'dock' ? 'complementary' : 'dialog');
    if (locked()) panel.setAttribute('aria-modal', 'true');
    else panel.removeAttribute('aria-modal');
    backdrop.hidden = !locked();
    backdrop.dataset.level = mode === 'sheet' && snap === 'half' ? 'half' : 'full';
  }

  function clearDragHeight() {
    panel.style.height = '';
    panel.style.minHeight = '';
    panel.classList.remove('is-dragging');
    backdrop.style.opacity = '';
  }

  function setSnap(next, afterDrag) {
    snap = next;
    panel.dataset.snap = next;
    if (afterDrag) requestAnimationFrame(clearDragHeight);
    else clearDragHeight();
    syncChrome();
  }

  function syncMode() {
    const next = sheet.matches ? 'sheet' : dock.matches ? 'dock' : 'overlay';
    if (next !== mode) clearDragHeight();
    mode = next;
    panel.dataset.mode = mode;
    panel.dataset.snap = snap;
    const dimensions = metrics();
    for (const key of panels.ORDER) panel.style.setProperty('--aipm-summary-sheet-' + key, dimensions[key] + 'px');
    if (!document.documentElement.classList.contains('aipm-summary-locked')) {
      document.documentElement.style.setProperty('--aipm-summary-sbw', panels.scrollbarWidth() + 'px');
    }
    syncChrome();
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
    snap = 'half';
    document.documentElement.classList.add('aipm-summary-open');
    entry.setAttribute('aria-expanded', 'true');
    syncMode();
    closeButton.focus();
    if (!loaded || currentPage !== location.pathname) void load();
  }

  function close(restoreFocus = true) {
    view.exitFullscreen();
    opened = false;
    panel.hidden = true;
    backdrop.hidden = true;
    document.documentElement.classList.remove('aipm-summary-open');
    entry.setAttribute('aria-expanded', 'false');
    clearDragHeight();
    syncChrome();
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
  panels.attachDockResize(panel);
  panels.attachSheetDrag({
    panel, gripSelector: '.aipm-summary__grip', headSelector: '.aipm-summary__head',
    isActive: () => opened && mode === 'sheet', getMetrics: metrics, getSnap: () => snap,
    setSnap, clearDragHeight, markSnapping: () => {}, onClose: () => close(),
    onDragHeight: (height, dimensions) => {
      backdrop.hidden = false;
      backdrop.style.opacity = String(panels.snapLerp(panels.ORDER, dimensions, height, panels.SCRIM_AT));
    },
  });
  document.addEventListener('keydown', event => {
    if (!opened || event.isComposing) return;
    if (document.querySelector('.aipm-summary__fullscreen[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key !== 'Tab' || !locked()) return;
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
  dock.addEventListener('change', syncMode);
  sheet.addEventListener('change', syncMode);
  window.addEventListener('resize', syncMode);
  window.visualViewport?.addEventListener('resize', syncMode);
  syncMode();
  mount();
  if (typeof document$ !== 'undefined' && document$.subscribe) document$.subscribe(mount);
})();
