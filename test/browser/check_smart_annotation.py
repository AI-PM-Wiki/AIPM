"""Smart annotation settings and manual actions against the real service."""

import json
from pathlib import Path
import unittest

from mkdocs.commands.build import build
from mkdocs.config import load_config
from playwright.sync_api import expect, sync_playwright

from harness import ANNO_ORIGIN, ROOT, WORK, AnnotationApi, Browser, StaticSite


class SmartAnnotationCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(ROOT / "site")
        cls.addClassCleanup(cls.site.close)
        config = load_config(str(ROOT / "mkdocs.yml"), site_url=cls.site.base + "/",
                             site_dir=str(WORK / "smart-annotation-site"))
        config.plugins.on_startup(command="build", dirty=False)
        cls.addClassCleanup(config.plugins.on_shutdown)
        build(config)
        cls.site.serve(config.site_dir)
        cls.api = AnnotationApi(cls.site)
        cls.addClassCleanup(cls.api.close)
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)

    def setUp(self):
        self.api.reset()
        self.browser = Browser(self.playwright, self.site.base, also_ours=(ANNO_ORIGIN,))
        self.addCleanup(self.browser.close)
        self.page = self.browser.page
        self.load("/product-manager/02/01/")

    def tearDown(self):
        self.assertEqual(self.browser.page_errors, [])

    def load(self, path):
        self.page.goto(self.site.base + path, wait_until="load")
        self.page.wait_for_function("window.__aipmAnno && performance.getEntriesByType('resource')"
                                    ".some(entry => entry.name.includes('/api/annotations'))")

    def requests(self):
        return [row for row in self.api.requests
                if row["method"] == "POST" and row["path"] == "/api/highlight/suggest"]

    def open_settings(self):
        self.page.get_by_role("button", name="站点设置", exact=True).click()
        self.page.get_by_role("tab", name="通用", exact=True).click()
        return self.page.get_by_role("group", name="自动智能批注", exact=True)

    def close_settings(self):
        self.page.get_by_role("button", name="关闭站点设置", exact=True).click()
        self.page.get_by_role("dialog", name="站点设置", exact=True).wait_for(state="hidden")

    def test_saved_smart_annotations_require_current_visit_activation(self):
        """Replay a ds-flash record captured from the real service on 2026-10-22."""
        record = json.loads((Path(__file__).parent / "data/smart-annotation-record.json").read_text())
        self.page.evaluate("""() => {
            const range = document.createRange();
            range.selectNodeContents([...document.querySelectorAll('.md-content__inner p')]
                .find(paragraph => paragraph.textContent.trim().length > 30));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }""")
        self.page.locator('.aipm-anno__toolbar button[data-color="yellow"]').click()
        manual = self.page.evaluate("() => window.__aipmAnnoStore.localList(location.pathname)[0]")
        self.assertNotIn("origin", manual)
        manual_marks = self.page.locator(f'mark.aipm-anno-mark[data-anno-id="{manual["id"]}"]')
        self.page.evaluate("record => window.__aipmAnnoStore.localAdd(record)", record)
        self.load(record["page"])
        marks = self.page.locator(f'mark.aipm-anno-mark[data-anno-id="{record["id"]}"]')
        cards = self.page.locator(f'.aipm-anno__item[data-anno-id="{record["id"]}"]')
        expect(marks).to_have_count(0)
        expect(cards).to_have_count(0)
        expect(manual_marks).not_to_have_count(0)
        self.assertEqual(self.requests(), [])

        self.page.get_by_role("button", name="打开批注面板", exact=True).click()
        with self.page.expect_response("**/api/highlight/suggest") as first_request:
            self.page.get_by_role("button", name="智能批注", exact=True).click()
        self.assertEqual(first_request.value.status, 503)
        first_request.value.body()
        expect(marks).to_have_count(1)
        expect(cards).to_have_count(1)

        self.load(record["page"])
        expect(marks).to_have_count(0)
        expect(cards).to_have_count(0)
        expect(manual_marks).not_to_have_count(0)
        self.page.get_by_role("button", name="打开批注面板", exact=True).click()
        with self.page.expect_response("**/api/highlight/suggest") as second_request:
            self.page.get_by_role("button", name="智能批注", exact=True).click()
        self.assertEqual(second_request.value.status, 503)
        second_request.value.body()
        expect(marks).to_have_count(1)

        self.page.evaluate("window.smartAnnotationDocument = document")
        self.page.locator('.md-sidebar--primary a[href$="/product-manager/02/02/"]').click()
        self.page.wait_for_url("**/product-manager/02/02/")
        self.assertTrue(self.page.evaluate("window.smartAnnotationDocument === document"))
        with self.page.expect_response(lambda response: "/api/annotations?" in response.url
                                       and "%2F02%2F01%2F" in response.url) as annotations:
            self.page.go_back(wait_until="load")
        annotations.value.json()
        self.page.wait_for_url("**/product-manager/02/01/")
        expect(marks).to_have_count(0)
        expect(cards).to_have_count(0)
        expect(manual_marks).not_to_have_count(0)
        expect(self.page.locator(".aipm-anno__smartbar")).to_be_hidden()

        self.open_settings().get_by_text("开启", exact=True).click()
        self.close_settings()
        expect(marks).to_have_count(1)
        expect(cards).to_have_count(1)
        self.open_settings().get_by_text("关闭", exact=True).click()
        self.close_settings()
        expect(marks).to_have_count(0)
        expect(cards).to_have_count(0)
        expect(manual_marks).not_to_have_count(0)

        self.load(record["page"])
        expect(marks).to_have_count(0)
        expect(cards).to_have_count(0)
        expect(manual_marks).not_to_have_count(0)
        self.assertEqual(self.page.evaluate(
            "page => window.__aipmAnnoStore.localList(page)", record["page"]), [manual, record])

    def test_manual_action_applies_to_current_page_only(self):
        self.assertEqual(self.requests(), [])
        self.assertTrue(self.open_settings().get_by_role("radio", name="关闭", exact=True).is_checked())
        self.close_settings()
        self.page.get_by_role("button", name="打开批注面板", exact=True).click()
        with self.page.expect_response("**/api/highlight/suggest") as response:
            self.page.get_by_role("button", name="智能批注", exact=True).click()
        self.assertEqual(response.value.status, 503)
        self.page.locator('.aipm-anno__smartbar[data-kind="warn"]').wait_for()
        self.assertEqual(len(self.requests()), 1)
        self.assertEqual(self.requests()[0]["body"]["page"], "/product-manager/02/01/")
        self.assertFalse(self.requests()[0]["body"]["refresh"])
        self.page.locator('.md-sidebar--primary a[href$="/product-manager/02/02/"]').click()
        self.page.wait_for_url("**/product-manager/02/02/")
        self.assertEqual(self.page.locator("html").get_attribute("data-auto-smart"), "off")
        self.assertEqual(len(self.requests()), 1)
        expect(self.page.locator(".aipm-anno__smartbar")).to_be_hidden()
        self.load("/product-manager/02/02/")
        self.assertEqual(len(self.requests()), 1)

    def test_setting_controls_requests_across_navigation_and_reload(self):
        group = self.open_settings()
        with self.page.expect_response("**/api/highlight/suggest") as response:
            group.get_by_text("开启", exact=True).click()
        self.assertEqual(response.value.status, 503)
        self.assertEqual(len(self.requests()), 1)
        self.close_settings()
        self.assertEqual(self.page.locator("#aipm-annotations").get_attribute("aria-hidden"), "true")
        with self.page.expect_response("**/api/highlight/suggest"):
            self.page.locator('.md-sidebar--primary a[href$="/product-manager/02/02/"]').click()
        self.page.wait_for_url("**/product-manager/02/02/")
        self.assertEqual(len(self.requests()), 2)
        with self.page.expect_response("**/api/highlight/suggest"):
            self.load("/product-manager/02/02/")
        self.assertEqual(len(self.requests()), 3)
        self.open_settings().get_by_text("关闭", exact=True).click()
        self.close_settings()
        self.load("/product-manager/02/01/")
        self.assertEqual(len(self.requests()), 3)
        self.assertEqual(self.page.locator("html").get_attribute("data-auto-smart"), "off")


if __name__ == "__main__":
    unittest.main()
