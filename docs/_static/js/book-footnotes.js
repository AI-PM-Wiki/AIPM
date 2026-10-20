(() => {
  "use strict";

  let panel = null;
  let reference = null;
  let frame = null;

  const close = (restoreFocus = false) => {
    if (!panel) return;
    const previous = reference;
    panel.remove();
    panel = null;
    reference = null;
    cancelAnimationFrame(frame);
    previous.setAttribute("aria-expanded", "false");
    if (restoreFocus && previous.isConnected) previous.focus({ preventScroll: true });
  };

  const position = () => {
    if (!panel) return;
    if (!reference.isConnected) {
      close();
      return;
    }
    const margin = 12;
    const gap = 8;
    const anchor = reference.getBoundingClientRect();
    const header = document.querySelector(".md-header");
    const ceiling = Math.max(margin, (header?.getBoundingClientRect().bottom || 0) + margin);
    if (anchor.bottom < ceiling || anchor.top > innerHeight - margin) {
      close();
      return;
    }
    const below = innerHeight - anchor.bottom - gap - margin;
    const above = anchor.top - gap - ceiling;
    const opensBelow = below >= Math.min(panel.scrollHeight, 240) || below >= above;
    panel.style.maxHeight = `${Math.max(0, opensBelow ? below : above)}px`;
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(margin, Math.min(anchor.left, innerWidth - bounds.width - margin))}px`;
    panel.style.top = `${opensBelow ? anchor.bottom + gap : anchor.top - gap - bounds.height}px`;
  };

  const schedulePosition = () => {
    if (!panel) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  };

  const open = (link) => {
    if (reference === link) {
      close(true);
      return;
    }
    close();
    const template = document.getElementById(link.dataset.bookFootnote);
    if (!(template instanceof HTMLTemplateElement)) throw new Error("Book footnote content is missing");

    reference = link;
    panel = document.createElement("aside");
    panel.id = "book-footnote-popover";
    panel.className = "book-footnote-popover";
    panel.tabIndex = -1;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "book-footnote-title");
    panel.setAttribute("aria-describedby", "book-footnote-content");

    const header = document.createElement("header");
    header.className = "book-footnote-popover__header";
    const title = document.createElement("h2");
    title.id = "book-footnote-title";
    title.textContent = `注释 ${link.textContent.trim()}`;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5 5 19"></path></svg>';
    dismiss.title = "关闭注释";
    dismiss.setAttribute("aria-label", "关闭注释");
    dismiss.addEventListener("click", () => close(true));
    header.append(title, dismiss);

    const content = document.createElement("div");
    content.id = "book-footnote-content";
    content.className = "book-footnote-popover__content";
    content.append(template.content.cloneNode(true));
    panel.append(header, content);
    document.body.append(panel);
    reference.setAttribute("aria-expanded", "true");
    position();
    if (panel) panel.focus({ preventScroll: true });
  };

  document.addEventListener("click", (event) => {
    const link = event.target.closest(".book-original a[data-book-footnote]");
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    open(link);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (panel && !panel.contains(event.target) && !reference.contains(event.target)) close();
  }, true);

  document.addEventListener("focusin", (event) => {
    if (panel && !panel.contains(event.target) && !reference.contains(event.target)) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === " " && event.target.matches("a[data-book-footnote]")) {
      event.preventDefault();
      open(event.target);
    }
  });

  window.addEventListener("scroll", schedulePosition, { capture: true, passive: true });
  window.addEventListener("resize", schedulePosition);
  if (typeof document$ !== "undefined" && document$?.subscribe) document$.subscribe(() => close());
})();
