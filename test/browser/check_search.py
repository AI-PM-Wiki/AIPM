"""Search token boundaries and real multiword article queries."""

import json
import unittest

from playwright.sync_api import sync_playwright

from harness import ROOT, StaticSite


class SearchCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(ROOT / "site")
        cls.addClassCleanup(cls.site.close)
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

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
