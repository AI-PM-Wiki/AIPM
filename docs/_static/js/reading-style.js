(() => {
  "use strict";

  const storageKey = "aipm-reading-style";
  const defaults = { size: 15, spacing: "standard", width: "standard", font: "sans" };
  const lineHeights = { compact: 1.6, standard: 1.8, relaxed: 2.1 };
  const fonts = {
    sans: "var(--md-text-font-family)",
    serif: '"Noto Serif SC", "Songti SC", SimSun, serif',
  };
  const stored = localStorage.getItem(storageKey);
  let settings = stored === null ? { ...defaults } : JSON.parse(stored);
  const validate = (value) => {
    if (!value || !Number.isInteger(value.size) || value.size < 14 || value.size > 22 ||
        !Object.hasOwn(lineHeights, value.spacing) ||
        !["compact", "standard", "wide"].includes(value.width) ||
        !Object.hasOwn(fonts, value.font)) {
      throw new Error("Invalid reading style settings");
    }
  };
  validate(settings);

  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty("--aipm-reading-size", `${settings.size}px`);
    root.style.setProperty("--aipm-reading-scale", settings.size / defaults.size);
    root.style.setProperty("--aipm-reading-line-height", lineHeights[settings.spacing]);
    root.style.setProperty("--aipm-reading-font", fonts[settings.font]);
    root.dataset.readingWidth = settings.width;
  };
  apply();

  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "md-header__button md-icon aipm-reading-entry";
  entry.title = "阅读样式";
  entry.setAttribute("aria-label", "阅读样式");
  entry.setAttribute("aria-haspopup", "dialog");
  entry.setAttribute("aria-expanded", "false");
  entry.setAttribute("aria-controls", "aipm-reading-style");
  entry.setAttribute("popovertarget", "aipm-reading-style");
  entry.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 8h3v12h1v1h-4v-1h1v-3h-4l-1.5 3H14v1h-4v-1h1zm1 1-3.5 7H18zM5 3h5c1.11 0 2 .89 2 2v11H9v-5H6v5H3V5c0-1.11.89-2 2-2m1 2v4h3V5z"/></svg>';

  const panel = document.createElement("section");
  panel.id = "aipm-reading-style";
  panel.className = "aipm-reading-style";
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "aipm-reading-title");
  panel.innerHTML = `
    <div class="aipm-reading-style__head">
      <h2 id="aipm-reading-title">阅读样式</h2>
      <button type="button" class="aipm-reading-style__close" aria-label="关闭阅读样式" title="关闭阅读样式" autofocus>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="aipm-reading-style__body">
      <div class="aipm-reading-style__size-label">
        <label for="aipm-reading-size">字号</label>
        <output for="aipm-reading-size" id="aipm-reading-size-value"></output>
      </div>
      <input id="aipm-reading-size" name="size" type="range" min="14" max="22" step="1">
      <fieldset>
        <legend>行距</legend>
        <div class="aipm-reading-style__options">
          <label><input type="radio" name="spacing" value="compact"><span>紧凑</span></label>
          <label><input type="radio" name="spacing" value="standard"><span>标准</span></label>
          <label><input type="radio" name="spacing" value="relaxed"><span>宽松</span></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>正文宽度</legend>
        <div class="aipm-reading-style__options">
          <label><input type="radio" name="width" value="compact"><span>紧凑</span></label>
          <label><input type="radio" name="width" value="standard"><span>标准</span></label>
          <label><input type="radio" name="width" value="wide"><span>宽阔</span></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>字体</legend>
        <div class="aipm-reading-style__options">
          <label><input type="radio" name="font" value="sans"><span>黑体</span></label>
          <label><input type="radio" name="font" value="serif"><span>宋体</span></label>
        </div>
      </fieldset>
      <div class="aipm-reading-style__footer">
        <span>自动保存</span>
        <button type="button" class="aipm-reading-style__reset">恢复默认</button>
      </div>
    </div>`;
  document.body.append(panel);

  const sync = () => {
    panel.querySelector('[name="size"]').value = settings.size;
    panel.querySelector("output").value = `${settings.size} px`;
    for (const input of panel.querySelectorAll('[type="radio"]')) {
      input.checked = input.value === settings[input.name];
    }
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
  panel.querySelector(".aipm-reading-style__reset").addEventListener("click", () => {
    settings = { ...defaults };
    save();
  });
  panel.querySelector(".aipm-reading-style__close").addEventListener("click", () => {
    panel.hidePopover();
    entry.focus({ preventScroll: true });
  });

  const position = () => {
    const anchor = entry.getBoundingClientRect();
    const width = parseFloat(getComputedStyle(panel).width);
    panel.style.top = `${anchor.bottom + 8}px`;
    panel.style.left = `${Math.max(12, Math.min(anchor.right - width, innerWidth - width - 12))}px`;
    panel.style.maxHeight = `${Math.max(0, innerHeight - anchor.bottom - 20)}px`;
  };
  panel.addEventListener("beforetoggle", (event) => {
    entry.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState === "open") position();
  });
  const close = () => {
    if (panel.matches(":popover-open")) panel.hidePopover();
  };
  document.addEventListener("focusin", (event) => {
    if (!panel.contains(event.target) && !entry.contains(event.target)) close();
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches('[data-md-toggle="search"], [data-md-toggle="drawer"]')) close();
  });
  window.addEventListener("resize", () => {
    if (panel.matches(":popover-open")) position();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    settings = event.newValue === null ? { ...defaults } : JSON.parse(event.newValue);
    validate(settings);
    apply();
    sync();
  });

  const attach = () => {
    close();
    const search = document.querySelector('.md-header__inner > label[for="__search"]');
    if (!search) return;
    search.before(entry);
  };
  attach();
  if (typeof document$ !== "undefined") document$.subscribe(attach);
})();
