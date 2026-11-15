(() => {
  "use strict";

  const title = document.querySelector('[data-md-component="header-title"]');
  const name = title.querySelector(".md-header__topic:first-child .md-ellipsis");
  const home = document.querySelector('[data-md-component="logo"]').href;
  const icons = {
    "home-outline": "m12 5.69 5 4.5V18h-2v-6H9v6H7v-7.81zM12 3 2 12h3v8h6v-6h2v6h6v-8h3",
    "cube-outline": "M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18s-.41-.06-.57-.18l-7.9-4.44A.99.99 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18s.41.06.57.18l7.9 4.44c.32.17.53.5.53.88zM12 4.15 6.04 7.5 12 10.85l5.96-3.35zM5 15.91l6 3.38v-6.71L5 9.21zm14 0v-6.7l-6 3.37v6.71z",
    "code-tags": "m14.6 16.6 4.6-4.6-4.6-4.6L16 6l6 6-6 6zm-5.2 0L4.8 12l4.6-4.6L8 6l-6 6 6 6z",
    "briefcase-outline": "M20 6c.58 0 1.05.2 1.42.59.38.41.58.86.58 1.41v11c0 .55-.2 1-.58 1.41-.37.39-.84.59-1.42.59H4c-.58 0-1.05-.2-1.42-.59C2.2 20 2 19.55 2 19V8c0-.55.2-1 .58-1.41C2.95 6.2 3.42 6 4 6h4V4c0-.58.2-1.05.58-1.42C8.95 2.2 9.42 2 10 2h4c.58 0 1.05.2 1.42.58.38.37.58.84.58 1.42v2zM4 8v11h16V8zm10-2V4h-4v2z",
    domain: "M18 15h-2v2h2m0-6h-2v2h2m2 6h-8v-2h2v-2h-2v-2h2v-2h-2V9h8M10 7H8V5h2m0 6H8V9h2m0 6H8v-2h2m0 6H8v-2h2M6 7H4V5h2m0 6H4V9h2m0 6H4v-2h2m0 6H4v-2h2m6-10V3H2v18h20V7z",
    "school-outline": "M12 3 1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9zm6.82 6L12 12.72 5.18 9 12 5.28zM17 16l-5 2.72L7 16v-3.73L12 15l5-2.73z",
  };
  const sites = [
    { name: "主站", path: "", sections: [], icon: "home-outline" },
    { name: "产品", path: "product-manager/", sections: ["product-manager/"], icon: "cube-outline" },
    { name: "技术", path: "sites/technology/", sections: ["sites/technology/", "product-manager-tech/"], icon: "code-tags", placeholder: true },
    { name: "运营", path: "sites/operations/", sections: ["sites/operations/"], icon: "briefcase-outline", placeholder: true },
    { name: "专业知识", path: "management/", sections: ["management/", "business/"], icon: "school-outline" },
    { name: "垂直领域", path: "vertical/cybersecurity/", sections: ["vertical/"], icon: "domain", placeholder: true },
  ];
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "aipm-site-switcher__trigger";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "aipm-site-switcher");
  trigger.setAttribute("popovertarget", "aipm-site-switcher");
  trigger.innerHTML = '<span class="aipm-site-switcher__current"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
  trigger.prepend(name);
  title.classList.add("aipm-site-title");
  title.prepend(trigger);

  const menu = document.createElement("nav");
  menu.id = "aipm-site-switcher";
  menu.className = "aipm-site-switcher";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("aria-label", "站点列表");
  menu.innerHTML = `
    <ul>
      ${sites.map((site) => `<li><a href="${new URL(site.path, home).href}"><svg class="aipm-site-switcher__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[site.icon]}"/></svg><span class="aipm-site-switcher__name">${site.name}</span>${site.placeholder ? '<span class="aipm-site-switcher__status">筹备中</span>' : ""}</a></li>`).join("")}
    </ul>`;
  document.body.append(menu);

  const position = () => {
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${bounds.bottom + 8}px`;
  };
  menu.addEventListener("beforetoggle", (event) => {
    trigger.setAttribute("aria-expanded", String(event.newState === "open"));
  });
  menu.addEventListener("toggle", (event) => {
    if (event.newState === "open") position();
  });
  const links = [...menu.querySelectorAll("a")];
  const sync = () => {
    const current = sites.findIndex((site) => site.sections.some((section) => location.href.startsWith(new URL(section, home).href)));
    const index = current === -1 ? 0 : current;
    for (const [position, link] of links.entries()) {
      if (position === index) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    trigger.querySelector(".aipm-site-switcher__current").textContent = sites[index].name;
    trigger.setAttribute("aria-label", `切换站点，当前为${sites[index].name}`);
  };
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    menu.showPopover();
    links[event.key === "ArrowDown" ? 0 : links.length - 1].focus();
  });
  menu.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 :
      (links.indexOf(document.activeElement) + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
    links[index].focus();
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) menu.hidePopover();
  });
  window.addEventListener("resize", () => {
    if (menu.matches(":popover-open")) position();
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches('[data-md-toggle="search"], [data-md-toggle="drawer"]')) menu.hidePopover();
  });
  window.document$.subscribe(() => {
    sync();
    menu.hidePopover();
  });
})();
