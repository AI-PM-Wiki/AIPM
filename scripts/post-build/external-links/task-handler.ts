import { HTMLElement } from "node-html-parser";

import { TaskHandler, log } from "../html-postprocess.js";

const ROOT_URL = new URL("https://aipm.ac/");

export const taskHandler = new (class implements TaskHandler<void> {
  async process(document: HTMLElement) {
    document.getElementsByTagName("a").forEach(element => {
      const href = element.getAttribute("href");
      if (href === null || href === "") {
        return;
      }
      let isExternal: boolean;
      try {
        isExternal = new URL(href, ROOT_URL).origin !== ROOT_URL.origin;
      } catch {
        // 非法 href(如残缺 URL)会让整个 post-process 崩溃,跳过并告警
        log(`external-links: 非法 href 已跳过: "${href}"`);
        return;
      }
      if (isExternal && (element.getAttribute("target") || "").trim() === "") {
        element.setAttribute("target", "_blank");
      }
    });
  }
})();
