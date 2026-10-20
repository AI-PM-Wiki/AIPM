"""Book footnote popovers using the original notes and real Chromium."""

from copy import deepcopy
import unittest
from urllib.parse import unquote, urlsplit

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from harness import ROOT, StaticSite


class BookFootnotesCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(ROOT / "site")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.site.close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def load(self, path="/product-manager/00/02/"):
        self.page.goto(self.site.base + path, wait_until="domcontentloaded")
        self.page.wait_for_selector(".book-original a[data-book-footnote]")

    def reference(self, identifier="txt001_3"):
        return self.page.locator(f'.book-original a[data-book-footnote="book-note-footnote_content_{identifier}"]')

    def assert_open(self, reference, text):
        panel = self.page.locator("#book-footnote-popover")
        panel.wait_for(state="visible")
        self.assertIn(text, panel.inner_text())
        self.assertEqual(reference.get_attribute("aria-expanded"), "true")
        self.assertEqual(self.page.locator('#book-footnote-popover').count(), 1)
        self.assertEqual(self.page.locator('.book-original [aria-expanded="true"]').count(), 1)
        bounds = panel.bounding_box()
        viewport = self.page.viewport_size
        self.assertGreaterEqual(bounds["x"], 11)
        self.assertGreaterEqual(bounds["y"], 11)
        self.assertLessEqual(bounds["x"] + bounds["width"], viewport["width"] - 11)
        self.assertLessEqual(bounds["y"] + bounds["height"], viewport["height"] - 11)

    def test_every_reference_embeds_its_original_note(self):
        references = 0
        for source in sorted((ROOT / "site").rglob("*.html")):
            document = BeautifulSoup(source.read_text(), "html.parser")
            for link in document.select('.book-original a[href*="#footnote_content_"]'):
                target = urlsplit(link["href"])
                destination = source.parent.joinpath(unquote(target.path)) if target.path else source
                if destination.is_dir():
                    destination /= "index.html"
                original = BeautifulSoup(destination.read_text(), "html.parser").find(id=unquote(target.fragment))
                expected = deepcopy(original.parent)
                expected.select_one('a[href*="#footnote_quote_"]').decompose()
                expected.find(id=original["id"]).decompose()
                template = document.find("template", id=link["data-book-footnote"])
                actual = BeautifulSoup(template.decode_contents(), "html.parser")
                self.assertEqual(actual.get_text(" ", strip=True), expected.get_text(" ", strip=True), (source, link["href"]))
                self.assertIsNone(actual.select_one("[id]"))
                self.assertEqual(link["aria-expanded"], "false")
                references += 1
        self.assertGreater(references, 50)

    def test_cross_article_note_opens_without_navigation(self):
        self.load()
        reference = self.reference()
        reference.scroll_into_view_if_needed()
        url = self.page.url
        scroll = self.page.evaluate("scrollY")
        reference.click()
        self.assert_open(reference, "凯文·凯利，《连线》（Wired）杂志创始主编")
        self.assertEqual(self.page.url, url)
        self.assertAlmostEqual(self.page.evaluate("scrollY"), scroll, delta=1)
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "book-footnote-popover")
        self.page.get_by_role("button", name="关闭注释").click()
        self.assertEqual(self.page.locator("#book-footnote-popover").count(), 0)
        self.assertEqual(reference.get_attribute("aria-expanded"), "false")
        self.assertTrue(reference.evaluate("node => document.activeElement === node"))

    def test_keyboard_toggle_switch_and_outside_dismissal(self):
        self.load()
        reference = self.reference()
        reference.focus()
        reference.press("Enter")
        self.assert_open(reference, "《连线》")
        self.page.keyboard.press("Escape")
        self.assertTrue(reference.evaluate("node => document.activeElement === node"))
        reference.press("Space")
        self.assert_open(reference, "《连线》")
        reference.click()
        self.assertEqual(self.page.locator("#book-footnote-popover").count(), 0)
        reference.click()
        second = self.reference("txt001_4")
        second.click()
        self.assert_open(second, "对于这个读书会，以及嘉宾团写过的书")
        self.assertEqual(reference.get_attribute("aria-expanded"), "false")
        self.page.mouse.click(5, 200)
        self.assertEqual(self.page.locator("#book-footnote-popover").count(), 0)

    def test_same_article_note_and_instant_navigation(self):
        self.load("/product-manager/00/")
        reference = self.reference("fow005_1")
        reference.click()
        self.assert_open(reference, "详情可参见12.3节。")
        self.load()
        reference = self.reference()
        reference.click()
        self.assert_open(reference, "《连线》")
        self.page.locator('.md-nav a[href$="/product-manager/00/03/"]').first.click()
        self.page.wait_for_url("**/product-manager/00/03/")
        self.assertEqual(self.page.locator("#book-footnote-popover").count(), 0)
        current = self.reference("txt001_5")
        current.click()
        self.assert_open(current, "浙江大学语言与认知研究中心徐慈华老师")

    def test_mobile_touch_and_viewport_position(self):
        for width in (390, 320):
            with self.subTest(width=width):
                context = self.browser.new_context(viewport={"width": width, "height": 844}, is_mobile=True, has_touch=True, color_scheme="dark")
                self.addCleanup(context.close)
                page = context.new_page()
                page.on("pageerror", lambda error: self.errors.append(str(error)))
                self.page = page
                self.load("/product-manager/00/04/")
                reference = self.reference("txt001_6")
                reference.tap()
                self.assert_open(reference, "因为在业内朋友比较多")
                self.assertEqual(page.evaluate("document.documentElement.scrollWidth"), width)
                page.get_by_role("button", name="关闭注释").tap()
                self.assertEqual(page.locator("#book-footnote-popover").count(), 0)
