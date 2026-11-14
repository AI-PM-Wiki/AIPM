"""Search queries, and the search layer over the header and docked side panels."""

import json
import unittest

from playwright.sync_api import sync_playwright

from harness import ROOT, StaticSite

ARTICLE = "/product-manager/00/"

HEADER_CONTROLS = """() => {
  const shown = node => {
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getBoundingClientRect().width > 0;
  };
  const selectors = ['.md-logo', 'label.md-header__button[for="__drawer"]', '.aipm-site-switcher__trigger',
    '.aipm-reading-entry', '.md-search__inner', '.md-header__source', '.aipm-summary-entry', '.aipm-anno-entry'];
  const header = document.querySelector('.md-header').getBoundingClientRect();
  return {
    header: {left: header.left, right: header.right},
    controls: selectors.map(selector => [selector, document.querySelector(selector)])
      .filter(([, node]) => node && shown(node))
      .map(([selector, node]) => {
        const box = node.getBoundingClientRect();
        return {selector, left: box.left, right: box.right};
      }),
    innerWidth: document.querySelector('.md-search__inner').getBoundingClientRect().width,
    resultsWidth: document.querySelector('.md-search__scrollwrap').getBoundingClientRect().width,
  };
}"""

TOPMOST = """selectors => selectors.map(selector => {
  const box = document.querySelector(selector).getBoundingClientRect();
  const x = Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1);
  const node = document.elementFromPoint(x, y);
  return node.closest('.md-search__overlay') ? 'overlay' : node.tagName.toLowerCase() + '.' + node.getAttribute('class');
})"""


class SearchCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(ROOT / "site")
        cls.addClassCleanup(cls.site.close)
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

    def open_article(self, width, height, docked):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.site.base + ARTICLE, wait_until="domcontentloaded")
        page.locator(".aipm-anno-entry").wait_for(state="visible")
        if docked:
            page.locator(".aipm-anno-entry").click()
            page.wait_for_function("""() => {
              const root = document.documentElement.classList;
              const panel = document.querySelector('.aipm-anno');
              return root.contains('aipm-anno-mode--dock') && root.contains('aipm-anno-open')
                && panel.getAnimations().length === 0;
            }""")
        return page

    def open_search(self, page):
        if page.viewport_size["width"] >= 960:
            page.locator('input[data-md-component="search-query"]').click()
        else:
            page.locator('label.md-header__button[for="__search"]').click()
        page.wait_for_function("""() => document.querySelector('[data-md-toggle="search"]').checked
          && ['.md-search__inner', '.md-search__overlay'].every(selector =>
            document.querySelector(selector).getAnimations().length === 0)""")

    def test_multiword_queries_find_the_article(self):
        index = json.loads((ROOT / "site/search/search_index.json").read_text())
        context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.addCleanup(context.close)
        page = context.new_page()
        tokens = page.evaluate("""separator => ({
          english: 'business strategy'.split(new RegExp(separator)),
          chinese: '需求 分析'.split(new RegExp(separator))
        })""", index["config"]["separator"])
        self.assertEqual(tokens["english"], ["business", "strategy"])
        self.assertEqual(tokens["chinese"], ["需求", "分析"])
        page.goto(self.site.base + "/pm/", wait_until="domcontentloaded")
        query = page.locator('input[data-md-component="search-query"]')
        query.fill("需求 分析")
        query.press("Enter")
        result = page.locator('.md-search-result a[href*="/pm/requirements/"]').first
        result.wait_for(state="visible")
        self.assertIn("需求", result.inner_text())

    def test_search_overlay_dims_the_docked_panel_and_header_entries(self):
        page = self.open_article(1440, 900, docked=True)
        panel = page.locator(".aipm-anno").bounding_box()
        self.assertLess(panel["x"], 1440)
        self.open_search(page)
        overlay = page.locator(".md-search__overlay").bounding_box()
        self.assertEqual((overlay["x"], overlay["y"], overlay["width"]), (0, 0, 1440))
        self.assertGreaterEqual(overlay["height"], 900)
        self.assertEqual(page.evaluate(TOPMOST, [".aipm-anno__list", ".aipm-summary-entry", ".aipm-anno-entry", ".md-content"]),
                         ["overlay"] * 4)

    def test_expanded_search_fits_the_header(self):
        for width, docked in ((960, False), (1280, False), (1920, False), (1200, True), (1280, True), (1440, True)):
            with self.subTest(width=width, docked=docked):
                page = self.open_article(width, 800, docked)
                self.open_search(page)
                layout = page.evaluate(HEADER_CONTROLS)
                controls = sorted(layout["controls"], key=lambda control: control["left"])
                self.assertIn(".md-search__inner", [control["selector"] for control in controls])
                self.assertIn(".aipm-site-switcher__trigger", [control["selector"] for control in controls])
                for control in controls:
                    self.assertGreaterEqual(control["left"], layout["header"]["left"] - .5, control)
                    self.assertLessEqual(control["right"], layout["header"]["right"] + .5, control)
                for previous, current in zip(controls, controls[1:]):
                    self.assertLessEqual(previous["right"], current["left"] + .5, (previous, current))
                self.assertLessEqual(layout["resultsWidth"], layout["innerWidth"] + .5)

    def test_mobile_search_covers_the_viewport(self):
        page = self.open_article(390, 844, docked=False)
        self.open_search(page)
        inner = page.locator(".md-search__inner").bounding_box()
        self.assertEqual((inner["x"], inner["y"], inner["width"], inner["height"]), (0, 0, 390, 844))
