(() => {
  "use strict";

  const storageKey = "aipm-reading-style";
  const defaults = {
    size: 15, spacing: "standard", width: "standard", font: "sans",
    heading: "structured", emphasis: "marker", color: "indigo", customColor: "#4051b5", indent: "none", autoSmart: "off",
  };
  const lineHeights = { compact: 1.6, standard: 1.8, relaxed: 2.1 };
  const schemes = {
    auto: "(prefers-color-scheme)",
    dark: "(prefers-color-scheme: dark)",
    light: "(prefers-color-scheme: light)",
  };
  const fonts = {
    sans: { label: "默认黑体", family: "var(--md-text-font-family)" },
    noto: { label: "思源黑体", family: '"Noto Sans SC", sans-serif', source: "Noto Sans SC:wght@400..800" },
    serif: { label: "思源宋体", family: '"Noto Serif SC", "Songti SC", SimSun, serif', source: "Noto Serif SC:wght@400..800" },
    xiaowei: { label: "站酷小薇", family: '"ZCOOL XiaoWei", serif', source: "ZCOOL XiaoWei" },
    kuaile: { label: "站酷快乐", family: '"ZCOOL KuaiLe", sans-serif', source: "ZCOOL KuaiLe" },
    mashan: { label: "马善政楷书", family: '"Ma Shan Zheng", serif', source: "Ma Shan Zheng" },
    longcang: { label: "龙藏行书", family: '"Long Cang", cursive', source: "Long Cang" },
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
    check: '<path d="m5 12 4 4L19 6"/>',
    reset: '<path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
  };
  const icon = (name) => `<svg class="aipm-reading-style__icon${name === "settings" ? " aipm-reading-style__gear" : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
  const colorValidator = document.createElement("input");
  colorValidator.type = "color";
  const validate = (value) => {
    colorValidator.value = value.customColor;
    if (!Number.isInteger(value.size) || value.size < 14 || value.size > 22 ||
        !Object.hasOwn(lineHeights, value.spacing) || !Object.hasOwn(fonts, value.font) ||
        !["compact", "standard", "wide"].includes(value.width) ||
        !["none", "first"].includes(value.indent) ||
        !["off", "on"].includes(value.autoSmart) ||
        !["simple", "structured", "accent"].includes(value.heading) ||
        !["plain", "marker", "underline"].includes(value.emphasis) ||
        !(Object.hasOwn(colors, value.color) || value.color === "custom") ||
        typeof value.customColor !== "string" || colorValidator.value !== value.customColor) {
      throw new Error("Invalid reading style settings");
    }
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
  const loadFont = () => {
    const font = fonts[settings.font];
    if (!font.source || document.querySelector(`link[data-reading-font="${settings.font}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.readingFont = settings.font;
    const url = new URL("https://fonts.googleapis.com/css2");
    url.searchParams.set("family", font.source);
    url.searchParams.set("display", "swap");
    link.href = url.href;
    link.addEventListener("load", () => { link.dataset.loaded = "true"; }, { once: true });
    link.addEventListener("error", () => { throw new Error(`Reading font stylesheet failed: ${font.label}`); }, { once: true });
    document.head.append(link);
  };
  const apply = () => {
    loadFont();
    root.style.setProperty("--aipm-reading-size", `${settings.size}px`);
    root.style.setProperty("--aipm-reading-scale", settings.size / defaults.size);
    root.style.setProperty("--aipm-reading-line-height", lineHeights[settings.spacing]);
    root.style.setProperty("--aipm-reading-font", fonts[settings.font].family);
    root.style.setProperty("--aipm-reading-indent", settings.indent === "first" ? "2em" : "0");
    const palette = settings.color === "custom" ? {
      light: `oklch(from ${settings.customColor} min(l, 0.5) c h)`,
      dark: `oklch(from ${settings.customColor} max(l, 0.8) c h)`,
      accent: settings.customColor,
    } : colors[settings.color];
    for (const name of ["light", "dark", "accent"]) root.style.setProperty(`--aipm-theme-${name}`, palette[name]);
    root.dataset.readingColor = settings.color;
    root.dataset.readingWidth = settings.width;
    root.dataset.readingHeading = settings.heading;
    root.dataset.readingEmphasis = settings.emphasis;
    if (root.dataset.autoSmart !== settings.autoSmart) {
      root.dataset.autoSmart = settings.autoSmart;
      window.dispatchEvent(new Event("aipm:auto-smart-change"));
    }
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
  entry.innerHTML = icon("settings");

  const panel = document.createElement("dialog");
  panel.id = "aipm-reading-style";
  panel.className = "aipm-reading-style";
  panel.setAttribute("aria-label", "站点设置");
  panel.innerHTML = `
    <div class="aipm-reading-style__window">
    <button type="button" class="aipm-reading-style__close" aria-label="关闭站点设置" title="关闭站点设置" autofocus>${icon("close")}</button>
    <div class="aipm-reading-style__layout">
    <div class="aipm-reading-style__settings">
    <div class="aipm-reading-style__toolbar">
    <div class="aipm-reading-style__tabs" role="tablist" aria-label="设置分类">
      <button type="button" id="aipm-settings-typography-tab" role="tab" aria-selected="true" aria-controls="aipm-settings-typography" data-settings-tab="typography">排版</button>
      <button type="button" id="aipm-settings-appearance-tab" role="tab" aria-selected="false" aria-controls="aipm-settings-appearance" data-settings-tab="appearance" tabindex="-1">外观</button>
      <button type="button" id="aipm-settings-general-tab" role="tab" aria-selected="false" aria-controls="aipm-settings-general" data-settings-tab="general" tabindex="-1">通用</button>
    </div>
    <button type="button" class="aipm-reading-style__reset" aria-label="恢复默认" title="恢复默认">${icon("reset")}</button>
    </div>
    <div class="aipm-reading-style__body">
      <div id="aipm-settings-typography" role="tabpanel" aria-labelledby="aipm-settings-typography-tab">
        <div class="aipm-reading-style__row aipm-reading-style__size"><label for="aipm-reading-size">字号</label><input id="aipm-reading-size" name="size" type="range" min="14" max="22" step="1"><output for="aipm-reading-size" id="aipm-reading-size-value"></output></div>
        <div class="aipm-reading-style__row"><label for="aipm-settings-font">字体</label><div class="aipm-reading-style__select"><select id="aipm-settings-font" name="font">${Object.entries(fonts).map(([value, font]) => `<option value="${value}">${font.label}</option>`).join("")}</select>${icon("chevron")}</div></div>
        <div class="aipm-reading-style__row" role="group" aria-label="行距"><span>行距</span><div class="aipm-reading-style__options">
          <label><input type="radio" name="spacing" value="compact"><span>紧凑</span></label>
          <label><input type="radio" name="spacing" value="standard"><span>标准</span></label>
          <label><input type="radio" name="spacing" value="relaxed"><span>宽松</span></label>
        </div></div>
        <div class="aipm-reading-style__row" role="group" aria-label="正文宽度"><span>正文宽度</span><div class="aipm-reading-style__options">
          <label><input type="radio" name="width" value="compact"><span>紧凑</span></label>
          <label><input type="radio" name="width" value="standard"><span>标准</span></label>
          <label><input type="radio" name="width" value="wide"><span>宽阔</span></label>
        </div></div>
        <div class="aipm-reading-style__row" role="group" aria-label="首行样式"><span>首行样式</span><div class="aipm-reading-style__options">
          <label><input type="radio" name="indent" value="none"><span>首行顶格</span></label>
          <label><input type="radio" name="indent" value="first"><span>首行缩进</span></label>
        </div></div>
      </div>
      <div id="aipm-settings-appearance" role="tabpanel" aria-labelledby="aipm-settings-appearance-tab" hidden>
        <div class="aipm-reading-style__palette" role="group" aria-label="主题色">
          <div><span>主题色</span><span class="aipm-reading-style__color-name"></span></div>
          <div class="aipm-reading-style__colors">
          ${Object.entries(colors).map(([value, color]) => `<label title="${color.label}"><input type="radio" name="color" value="${value}" aria-label="${color.label}"><span style="--settings-swatch:${color.light}">${icon("check")}</span></label>`).join("")}
          <label title="自选颜色" class="aipm-reading-style__custom-color"><input id="aipm-settings-custom-color" name="customColor" type="color" aria-label="自选颜色"><span class="aipm-reading-style__custom-swatch">${icon("check")}</span></label>
          </div>
        </div>
        <div class="aipm-reading-style__row"><label for="aipm-settings-scheme">外观</label><div class="aipm-reading-style__select"><select id="aipm-settings-scheme"><option value="auto">跟随浏览器</option><option value="dark">深色</option><option value="light">浅色</option></select>${icon("chevron")}</div></div>
        <div class="aipm-reading-style__row"><label for="aipm-settings-heading">标题样式</label><div class="aipm-reading-style__select"><select id="aipm-settings-heading" name="heading"><option value="simple">简洁</option><option value="structured">层次</option><option value="accent">主题色</option></select>${icon("chevron")}</div></div>
        <div class="aipm-reading-style__row"><label for="aipm-settings-emphasis">加粗样式</label><div class="aipm-reading-style__select"><select id="aipm-settings-emphasis" name="emphasis"><option value="plain">纯文字</option><option value="marker">淡色标记</option><option value="underline">下划线</option></select>${icon("chevron")}</div></div>
      </div>
      <div id="aipm-settings-general" role="tabpanel" aria-labelledby="aipm-settings-general-tab" hidden>
        <div class="aipm-reading-style__row"><label for="aipm-settings-language">站点语言</label><div class="aipm-reading-style__select"><select id="aipm-settings-language"><option value="zh-CN">简体中文</option></select>${icon("chevron")}</div></div>
        <div class="aipm-reading-style__row" role="group" aria-label="自动智能批注"><span>自动智能批注</span><div class="aipm-reading-style__options">
          <label><input type="radio" name="autoSmart" value="off"><span>关闭</span></label>
          <label><input type="radio" name="autoSmart" value="on"><span>开启</span></label>
        </div></div>
      </div>
    </div>
    </div>
    <section class="aipm-reading-style__preview-pane" aria-label="效果预览">
      <div class="aipm-reading-style__preview-head"><span>效果预览</span></div>
      <div class="aipm-reading-style__preview-scroll" tabindex="0" aria-label="预览文章">
        <article class="aipm-reading-style__preview md-typeset"></article>
      </div>
    </section>
    </div>
    </div>`;
  document.body.append(panel);

  const schemeForMedia = (media) => {
    const scheme = Object.keys(schemes).find((name) => schemes[name] === media);
    if (!scheme) throw new Error("Site color palette media is invalid");
    return scheme;
  };
  const syncScheme = () => {
    panel.querySelector("#aipm-settings-scheme").value = schemeForMedia(document.body.dataset.mdColorMedia);
  };
  const setScheme = (scheme) => {
    const input = document.querySelector(`[data-md-component="palette"] input[data-md-color-media="${schemes[scheme]}"]`);
    if (!input) throw new Error("Site color palette is missing");
    input.click();
    syncScheme();
  };
  const sync = () => {
    panel.querySelector('[name="size"]').value = settings.size;
    panel.querySelector("#aipm-reading-size-value").value = `${settings.size} px`;
    for (const input of panel.querySelectorAll('[type="radio"]')) input.checked = input.value === settings[input.name];
    for (const select of panel.querySelectorAll("select[name]")) select.value = settings[select.name];
    panel.querySelector(".aipm-reading-style__color-name").textContent = settings.color === "custom" ? "自选" : colors[settings.color].label;
    panel.querySelector('[name="customColor"]').value = settings.customColor;
    panel.querySelector('[name="customColor"]').dataset.selected = String(settings.color === "custom");
    panel.querySelector(".aipm-reading-style__custom-swatch").style.setProperty("--settings-swatch", settings.customColor);
    syncScheme();
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
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || !input.name) return;
    settings[input.name] = input.name === "size" ? input.valueAsNumber : input.value;
    if (input.name === "customColor") settings.color = "custom";
    save();
  });
  panel.querySelector('[name="customColor"]').addEventListener("click", () => {
    settings.color = "custom";
    save();
  });
  panel.querySelector("#aipm-settings-scheme").addEventListener("change", (event) => setScheme(event.target.value));
  panel.querySelector(".aipm-reading-style__reset").addEventListener("click", () => {
    settings = { ...defaults };
    save();
    setScheme("auto");
  });
  const tabs = [...panel.querySelectorAll('[data-settings-tab]')];
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
  const preview = panel.querySelector(".aipm-reading-style__preview");
  const previewDiagrams = [];
  const restoreDiagrams = () => {
    for (const { host, placeholder, inert, zoomReady } of previewDiagrams) {
      placeholder.replaceWith(host);
      host.inert = inert;
      if (!zoomReady) host.removeAttribute("data-mermaid-zoom-ready");
    }
    previewDiagrams.length = 0;
  };
  const refreshPreview = () => {
    restoreDiagrams();
    const source = document.querySelector(".md-content__inner");
    if (!source) throw new Error("Reading preview article is missing");
    const article = source.cloneNode(true);
    article.querySelectorAll("script, style, button, input, select, textarea, iframe, .headerlink, .md-source-file, .md-content__button, .footnote-backref").forEach((node) => node.remove());
    for (const node of [article, ...article.querySelectorAll("*")]) {
      for (const attribute of [...node.attributes]) {
        if (attribute.name === "id" || attribute.name === "tabindex" || attribute.name === "autofocus" ||
            attribute.name.startsWith("data-") || attribute.name.startsWith("aria-") || attribute.name.startsWith("on")) {
          node.removeAttribute(attribute.name);
        }
      }
    }
    article.querySelectorAll("a").forEach((link) => link.removeAttribute("href"));
    const diagrams = [...source.querySelectorAll("div.mermaid")];
    const copies = [...article.querySelectorAll("div.mermaid")];
    diagrams.forEach((host, index) => {
      const placeholder = document.createElement("div");
      placeholder.style.height = host.getBoundingClientRect().height + "px";
      previewDiagrams.push({ host, placeholder, inert: host.inert,
        zoomReady: host.hasAttribute("data-mermaid-zoom-ready") });
      host.replaceWith(placeholder);
      host.inert = true;
      copies[index].replaceWith(host);
    });
    article.querySelectorAll("img, .mermaid").forEach((node) => node.setAttribute("data-mermaid-zoom-ready", ""));
    article.querySelectorAll("details").forEach((details) => { details.open = true; });
    preview.replaceChildren(...article.childNodes);
    panel.querySelector(".aipm-reading-style__preview-scroll").scrollTop = 0;
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let closing = false;
  const close = async (animate = true) => {
    if (!panel.open || closing) return;
    closing = true;
    panel.dataset.closing = "true";
    if (animate && !motion.matches) {
      await panel.querySelector(".aipm-reading-style__window").animate([
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0, transform: "translateY(10px) scale(.985)" },
      ], { duration: 160, easing: "ease-in", fill: "forwards" }).finished;
    }
    panel.close();
    restoreDiagrams();
    root.classList.remove("aipm-settings-open");
    entry.setAttribute("aria-expanded", "false");
    panel.querySelector(".aipm-reading-style__window").getAnimations().forEach((animation) => animation.cancel());
    delete panel.dataset.closing;
    closing = false;
    if (animate) entry.focus({ preventScroll: true });
  };
  entry.addEventListener("click", () => {
    refreshPreview();
    syncScheme();
    panel.showModal();
    root.classList.add("aipm-settings-open");
    entry.setAttribute("aria-expanded", "true");
  });
  panel.querySelector(".aipm-reading-style__close").addEventListener("click", () => close());
  panel.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key !== "Tab") return;
    const controls = [...panel.querySelectorAll("button, input, select, [tabindex]")].filter((node) =>
      node.tabIndex >= 0 && !node.disabled && node.getClientRects().length &&
      (node.type !== "radio" || node.checked));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
  let backdropPointer = false;
  panel.addEventListener("pointerdown", (event) => { backdropPointer = event.target === panel; });
  panel.addEventListener("click", (event) => {
    if (backdropPointer && event.target === panel) close();
    backdropPointer = false;
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches('[data-md-toggle="search"], [data-md-toggle="drawer"]')) close();
  });
  new MutationObserver(syncScheme).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme", "data-md-color-media"] });
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) { settings = read(event.newValue); apply(); sync(); }
    else if (event.key?.endsWith(".__palette") && event.newValue !== null) {
      const media = JSON.parse(event.newValue).color.media;
      if (media !== document.body.dataset.mdColorMedia) setScheme(schemeForMedia(media));
    }
  });
  const attach = () => {
    close(false);
    const search = document.querySelector('.md-header__inner > label[for="__search"]');
    if (!search) return;
    search.before(entry);
    syncScheme();
  };
  attach();
  if (typeof document$ !== "undefined") document$.subscribe(attach);
})();
