(() => {
  "use strict";

  const storageKey = "aipm-reading-style";
  const defaults = {
    size: 15, spacing: "standard", width: "standard", font: "sans",
    heading: "structured", emphasis: "marker", color: "indigo",
  };
  const lineHeights = { compact: 1.6, standard: 1.8, relaxed: 2.1 };
  const fonts = {
    sans: "var(--md-text-font-family)",
    serif: '"Noto Serif SC", "Songti SC", SimSun, serif',
  };
  const colors = {
    indigo: { label: "靛蓝", light: "#4051b5", dark: "#b2bdff", accent: "#526cfe" },
    blue: { label: "海蓝", light: "#1d5fba", dark: "#8bbdff", accent: "#2476d3" },
    teal: { label: "青绿", light: "#087f72", dark: "#71d8c2", accent: "#0b9e8a" },
    amber: { label: "琥珀", light: "#965507", dark: "#f2c06b", accent: "#b56b0b" },
    rose: { label: "玫红", light: "#ae3261", dark: "#ffa2c5", accent: "#cc4a7c" },
    violet: { label: "紫罗兰", light: "#7545af", dark: "#d0acff", accent: "#945ddb" },
  };
  const icons = {
    settings: '<path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m-2 12c-.25 0-.46-.18-.5-.42l-.37-2.65a8 8 0 0 1-1.69-.99l-2.49 1.01c-.22.08-.49 0-.61-.22l-2-3.46a.493.493 0 0 1 .12-.64l2.11-1.66L4.5 12l.07-1-2.11-1.63a.493.493 0 0 1-.12-.64l2-3.46c.12-.22.39-.31.61-.22l2.49 1a8 8 0 0 1 1.69-.98l.37-2.65c.04-.24.25-.42.5-.42h4c.25 0 .46.18.5.42l.37 2.65a8 8 0 0 1 1.69.98l2.49-1c.22-.09.49 0 .61.22l2 3.46c.13.22.07.49-.12.64L19.43 11l.07 1-.07 1 2.11 1.63c.19.15.25.42.12.64l-2 3.46c-.12.22-.39.31-.61.22l-2.49-1a8 8 0 0 1-1.69.98l-.37 2.65c-.04.24-.25.42-.5.42zm1.25-18-.37 2.61a5.42 5.42 0 0 0-3.03 1.78L5.44 7.35l-.75 1.3L6.8 10.2a5.55 5.55 0 0 0 0 3.6l-2.12 1.56.75 1.3 2.43-1.04a5.42 5.42 0 0 0 3.01 1.76l.37 2.62h1.52l.37-2.61a5.42 5.42 0 0 0 3.01-1.77l2.43 1.04.75-1.3-2.12-1.55a5.55 5.55 0 0 0 0-3.61l2.11-1.55-.75-1.3-2.41 1.04a5.42 5.42 0 0 0-3.03-1.77L12.75 4z"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    moon: '<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/>',
    expand: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    reset: '<path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${name === "settings" ? ' class="aipm-reading-style__gear"' : ""}>${icons[name]}</svg>`;
  const validate = (value) => {
    if (!Number.isInteger(value.size) || value.size < 14 || value.size > 22 ||
        !Object.hasOwn(lineHeights, value.spacing) || !Object.hasOwn(fonts, value.font) ||
        !["compact", "standard", "wide"].includes(value.width) ||
        !["simple", "structured", "accent"].includes(value.heading) ||
        !["plain", "marker", "underline"].includes(value.emphasis) ||
        !Object.hasOwn(colors, value.color)) throw new Error("Invalid reading style settings");
  };
  const read = (stored) => {
    if (stored === null) return { ...defaults };
    const value = JSON.parse(stored);
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some((key) => !Object.hasOwn(defaults, key))) {
      throw new Error("Invalid reading style settings");
    }
    const result = { ...defaults, ...value };
    validate(result);
    return result;
  };
  let settings = read(localStorage.getItem(storageKey));
  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty("--aipm-reading-size", `${settings.size}px`);
    root.style.setProperty("--aipm-reading-scale", settings.size / defaults.size);
    root.style.setProperty("--aipm-reading-line-height", lineHeights[settings.spacing]);
    root.style.setProperty("--aipm-reading-font", fonts[settings.font]);
    for (const name of ["light", "dark", "accent"]) root.style.setProperty(`--aipm-theme-${name}`, colors[settings.color][name]);
    root.dataset.readingWidth = settings.width;
    root.dataset.readingHeading = settings.heading;
    root.dataset.readingEmphasis = settings.emphasis;
  };
  apply();

  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "md-header__button md-icon aipm-reading-entry";
  entry.title = "站点设置";
  entry.setAttribute("aria-label", "站点设置");
  entry.setAttribute("aria-haspopup", "dialog");
  entry.setAttribute("aria-expanded", "false");
  entry.setAttribute("aria-controls", "aipm-reading-style");
  entry.setAttribute("popovertarget", "aipm-reading-style");
  entry.innerHTML = icon("settings");

  const panel = document.createElement("section");
  panel.id = "aipm-reading-style";
  panel.className = "aipm-reading-style";
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "aipm-reading-title");
  panel.innerHTML = `
    <div class="aipm-reading-style__head">
      <span class="aipm-reading-style__badge">${icon("settings")}</span>
      <div><h2 id="aipm-reading-title">站点设置</h2><p>阅读与外观</p></div>
      <button type="button" class="aipm-reading-style__close" aria-label="关闭站点设置" title="关闭站点设置" autofocus>${icon("close")}</button>
    </div>
    <div class="aipm-reading-style__body">
      <div class="aipm-reading-style__actions" role="group" aria-label="显示模式">
        <button type="button" data-reading-action="theme" aria-pressed="false">${icon("moon")}<span>暗色模式</span></button>
        <button type="button" data-reading-action="fulltext" aria-pressed="false">${icon("expand")}<span>全文显示</span></button>
      </div>
      <div class="aipm-reading-style__tabs" role="tablist" aria-label="设置分类">
        <button type="button" id="aipm-settings-typography-tab" role="tab" aria-selected="true" aria-controls="aipm-settings-typography" data-settings-tab="typography">排版</button>
        <button type="button" id="aipm-settings-appearance-tab" role="tab" aria-selected="false" aria-controls="aipm-settings-appearance" data-settings-tab="appearance" tabindex="-1">外观</button>
      </div>
      <div class="aipm-reading-style__preview md-typeset" aria-label="样式预览">
        <div class="book-original"><h3>从问题出发</h3><p>清晰的表达，让<strong>重要的想法</strong>更容易理解。</p></div>
      </div>
      <div id="aipm-settings-typography" role="tabpanel" aria-labelledby="aipm-settings-typography-tab">
        <div class="aipm-reading-style__size-label"><label for="aipm-reading-size">字号</label><output for="aipm-reading-size" id="aipm-reading-size-value"></output></div>
        <div class="aipm-reading-style__slider"><span aria-hidden="true">A</span><input id="aipm-reading-size" name="size" type="range" min="14" max="22" step="1"><span aria-hidden="true">A</span></div>
        <fieldset><legend>字体</legend><div class="aipm-reading-style__options">
          <label><input type="radio" name="font" value="sans"><span>黑体</span></label>
          <label><input type="radio" name="font" value="serif"><span class="aipm-reading-style__serif">宋体</span></label>
        </div></fieldset>
        <fieldset><legend>行距</legend><div class="aipm-reading-style__options">
          <label><input type="radio" name="spacing" value="compact"><span>紧凑</span></label>
          <label><input type="radio" name="spacing" value="standard"><span>标准</span></label>
          <label><input type="radio" name="spacing" value="relaxed"><span>宽松</span></label>
        </div></fieldset>
        <fieldset><legend>正文宽度</legend><div class="aipm-reading-style__options">
          <label><input type="radio" name="width" value="compact"><span>紧凑</span></label>
          <label><input type="radio" name="width" value="standard"><span>标准</span></label>
          <label><input type="radio" name="width" value="wide"><span>宽阔</span></label>
        </div></fieldset>
      </div>
      <div id="aipm-settings-appearance" role="tabpanel" aria-labelledby="aipm-settings-appearance-tab" hidden>
        <fieldset><legend>主题色</legend><div class="aipm-reading-style__colors">
          ${Object.entries(colors).map(([value, color]) => `<label title="${color.label}"><input type="radio" name="color" value="${value}" aria-label="${color.label}"><span style="--settings-swatch:${color.light}">${icon("check")}</span></label>`).join("")}
        </div></fieldset>
        <fieldset><legend>标题样式</legend><div class="aipm-reading-style__options">
          <label><input type="radio" name="heading" value="simple"><span>简洁</span></label>
          <label><input type="radio" name="heading" value="structured"><span>层次</span></label>
          <label><input type="radio" name="heading" value="accent"><span>主题色</span></label>
        </div></fieldset>
        <fieldset><legend>加粗样式</legend><div class="aipm-reading-style__options">
          <label><input type="radio" name="emphasis" value="plain"><span>纯文字</span></label>
          <label><input type="radio" name="emphasis" value="marker"><span>淡色标记</span></label>
          <label><input type="radio" name="emphasis" value="underline"><span>下划线</span></label>
        </div></fieldset>
        <div class="aipm-reading-style__language"><label for="aipm-settings-language">站点语言</label><select id="aipm-settings-language"><option value="zh-CN">简体中文</option></select></div>
      </div>
    </div>
    <div class="aipm-reading-style__footer">
      <button type="button" class="aipm-reading-style__reset">${icon("reset")}恢复默认</button>
      <span>${icon("check")}自动保存</span>
    </div>`;
  document.body.append(panel);

  const sidebarState = () => Object.fromEntries(["NAVIGATION", "TOC"].map((name) => {
    const value = localStorage.getItem(`TOGGLE_SIDEBAR_${name}`);
    return [name, value === null || value === "1"];
  }));
  let previousSidebars = { NAVIGATION: true, TOC: true };
  const syncDisplay = () => {
    panel.querySelector('[data-reading-action="theme"]').setAttribute("aria-pressed", String(document.body.dataset.mdColorScheme === "slate"));
    const state = sidebarState();
    panel.querySelector('[data-reading-action="fulltext"]').setAttribute("aria-pressed", String(!state.NAVIGATION && !state.TOC));
  };
  const setScheme = (scheme) => {
    const input = document.querySelector(`[data-md-component="palette"] input[data-md-color-scheme="${scheme}"]`);
    if (!input) throw new Error("Site color palette is missing");
    input.click();
    syncDisplay();
  };
  const setSidebars = (state) => {
    if (!window.MkdocsToggleSidebarPlugin) throw new Error("Sidebar controls are missing");
    window.MkdocsToggleSidebarPlugin.setAllVisibility(state.NAVIGATION, state.TOC);
    syncDisplay();
  };
  const sync = () => {
    panel.querySelector('[name="size"]').value = settings.size;
    panel.querySelector("output").value = `${settings.size} px`;
    for (const input of panel.querySelectorAll('[type="radio"]')) input.checked = input.value === settings[input.name];
    syncDisplay();
  };
  const save = () => {
    validate(settings);
    localStorage.setItem(storageKey, JSON.stringify(settings));
    apply();
    sync();
  };
  sync();
  panel.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    settings[input.name] = input.name === "size" ? input.valueAsNumber : input.value;
    save();
  });
  panel.querySelector('[data-reading-action="theme"]').addEventListener("click", () => setScheme(document.body.dataset.mdColorScheme === "slate" ? "default" : "slate"));
  panel.querySelector('[data-reading-action="fulltext"]').addEventListener("click", () => {
    const state = sidebarState();
    if (!state.NAVIGATION && !state.TOC) setSidebars(previousSidebars);
    else { previousSidebars = state; setSidebars({ NAVIGATION: false, TOC: false }); }
  });
  panel.querySelector(".aipm-reading-style__reset").addEventListener("click", () => {
    settings = { ...defaults };
    save();
    setScheme(matchMedia("(prefers-color-scheme: dark)").matches ? "slate" : "default");
    setSidebars({ NAVIGATION: true, TOC: true });
  });
  panel.querySelector(".aipm-reading-style__close").addEventListener("click", () => {
    panel.hidePopover();
    entry.focus({ preventScroll: true });
  });

  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  const selectTab = (tab) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      panel.querySelector(`#${item.getAttribute("aria-controls")}`).hidden = !selected;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
        (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[index]);
      tabs[index].focus();
    });
  }
  const position = () => {
    const anchor = entry.getBoundingClientRect();
    const width = parseFloat(getComputedStyle(panel).width);
    panel.style.top = `${anchor.bottom + 8}px`;
    panel.style.left = `${Math.max(12, Math.min(anchor.right - width, innerWidth - width - 12))}px`;
    panel.style.maxHeight = `${Math.max(0, innerHeight - anchor.bottom - 20)}px`;
  };
  panel.addEventListener("beforetoggle", (event) => {
    entry.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState === "open") { position(); syncDisplay(); }
  });
  const close = () => { if (panel.matches(":popover-open")) panel.hidePopover(); };
  document.addEventListener("focusin", (event) => {
    if (!panel.contains(event.target) && !entry.contains(event.target)) close();
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches('[data-md-toggle="search"], [data-md-toggle="drawer"]')) close();
  });
  document.addEventListener("keyup", (event) => {
    if (["b", "m", "t"].includes(event.key.toLowerCase())) syncDisplay();
  });
  new MutationObserver(syncDisplay).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  window.addEventListener("resize", () => { if (panel.matches(":popover-open")) position(); });
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) { settings = read(event.newValue); apply(); sync(); }
    else if (event.key?.startsWith("TOGGLE_SIDEBAR_")) setSidebars(sidebarState());
    else if (event.key?.endsWith(".__palette") && event.newValue !== null) {
      const scheme = JSON.parse(event.newValue).color.scheme;
      if (scheme !== document.body.dataset.mdColorScheme) setScheme(scheme);
    }
  });
  const attach = () => {
    close();
    const search = document.querySelector('.md-header__inner > label[for="__search"]');
    if (!search) return;
    search.before(entry);
    syncDisplay();
  };
  attach();
  if (typeof document$ !== "undefined") document$.subscribe(attach);
})();
