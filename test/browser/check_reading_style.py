"""Reading preferences on built pages using real Chromium interactions."""

import json
import unittest

from playwright.sync_api import sync_playwright

from harness import ROOT, StaticSite


class ReadingStyleCase(unittest.TestCase):
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
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def load(self):
        self.page.goto(self.site.base + "/product-manager/02/01/", wait_until="domcontentloaded")
        self.page.get_by_role("button", name="阅读样式", exact=True).wait_for()

    def open(self):
        self.page.get_by_role("button", name="阅读样式", exact=True).click()
        self.page.get_by_role("dialog", name="阅读样式", exact=True).wait_for(state="visible")

    def select(self, group, label):
        self.page.get_by_role("group", name=group, exact=True).get_by_text(label, exact=True).click()

    def styles(self):
        return self.page.locator(".md-content__inner").evaluate("""node => {
          const style = getComputedStyle(node);
          return { size: style.fontSize, line: style.lineHeight, font: style.fontFamily };
        }""")

    def test_controls_apply_save_reload_and_navigate(self):
        self.load()
        header_size = self.page.locator(".md-header").evaluate("node => getComputedStyle(node).fontSize")
        self.assertTrue(self.page.locator(".aipm-reading-entry").evaluate("""node => {
          const siblings = [...node.parentElement.children];
          return siblings.indexOf(node.parentElement.querySelector('[data-md-component="palette"]')) < siblings.indexOf(node)
            && node.nextElementSibling.matches('label[for="__search"]');
        }"""))
        self.open()
        panel = self.page.get_by_role("dialog", name="阅读样式", exact=True)
        self.assertEqual(panel.get_by_role("button", name="关闭阅读样式").inner_text(), "")
        slider = panel.get_by_role("slider", name="字号")
        slider.focus()
        slider.press("End")
        self.select("行距", "宽松")
        self.select("字体", "宋体")
        self.select("正文宽度", "宽阔")
        self.assertEqual(self.styles()["size"], "22px")
        self.assertAlmostEqual(float(self.styles()["line"].removesuffix("px")), 46.2, places=1)
        self.assertIn("Songti SC", self.styles()["font"])
        self.assertEqual(panel.locator("output").inner_text(), "22 px")
        self.assertEqual(self.page.locator(".md-header").evaluate("node => getComputedStyle(node).fontSize"), header_size)
        self.page.reload(wait_until="domcontentloaded")
        self.assertEqual(self.styles()["size"], "22px")
        self.open()
        self.assertTrue(panel.get_by_role("group", name="行距", exact=True).get_by_role("radio", name="宽松").is_checked())
        panel.get_by_role("button", name="关闭阅读样式").click()
        self.page.locator('.md-sidebar--primary a[href$="/product-manager/02/02/"]').click()
        self.page.wait_for_url("**/product-manager/02/02/")
        self.assertEqual(self.styles()["size"], "22px")
        self.assertEqual(self.page.locator(".aipm-reading-entry").count(), 1)
        self.open()
        panel.get_by_role("button", name="恢复默认").click()
        self.assertEqual(self.styles()["size"], "15px")
        self.assertEqual(self.styles()["line"], "27px")
        saved = json.loads(self.page.evaluate('localStorage.getItem("aipm-reading-style")'))
        self.assertEqual(saved, {"size": 15, "spacing": "standard", "width": "standard", "font": "sans"})

    def test_width_and_cross_tab_preferences(self):
        self.load()
        self.open()
        widths = []
        for label in ("紧凑", "标准", "宽阔"):
            self.select("正文宽度", label)
            widths.append(self.page.locator(".md-content").bounding_box()["width"])
        self.assertLess(widths[0], widths[1])
        self.assertLess(widths[1], widths[2])
        second = self.context.new_page()
        second.goto(self.page.url, wait_until="domcontentloaded")
        self.page.get_by_role("slider", name="字号").focus()
        self.page.get_by_role("slider", name="字号").press("End")
        second.wait_for_function('getComputedStyle(document.querySelector(".md-content__inner")).fontSize === "22px"')
        second.get_by_role("button", name="阅读样式", exact=True).click()
        second.get_by_role("button", name="恢复默认").click()
        self.page.wait_for_function('getComputedStyle(document.querySelector(".md-content__inner")).fontSize === "15px"')

    def test_keyboard_dismissal_theme_and_search(self):
        self.load()
        entry = self.page.get_by_role("button", name="阅读样式", exact=True)
        entry.focus()
        entry.press("Enter")
        self.assertEqual(entry.get_attribute("aria-expanded"), "true")
        self.page.keyboard.press("Escape")
        self.assertTrue(entry.evaluate("node => node === document.activeElement"))
        self.assertEqual(entry.get_attribute("aria-expanded"), "false")
        entry.press("Space")
        self.page.get_by_role("button", name="关闭阅读样式").click()
        self.assertTrue(entry.evaluate("node => node === document.activeElement"))
        self.open()
        entry.click()
        self.assertEqual(entry.get_attribute("aria-expanded"), "false")
        self.open()
        self.page.mouse.click(5, 250)
        self.assertEqual(entry.get_attribute("aria-expanded"), "false")
        scheme = self.page.locator("body").get_attribute("data-md-color-scheme")
        self.page.locator('.md-header [data-md-component="palette"] label:visible').click()
        self.assertNotEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), scheme)
        self.open()
        self.page.get_by_role("slider", name="字号").focus()
        self.page.get_by_role("slider", name="字号").press("Home")
        self.page.keyboard.press("Escape")
        self.page.locator('input[data-md-component="search-query"]').fill("产品")
        self.assertEqual(entry.get_attribute("aria-expanded"), "false")
        self.assertEqual(self.styles()["size"], "14px")

    def test_mobile_themes_small_height_and_print(self):
        for width, height, theme in ((390, 844, "light"), (320, 844, "dark"), (667, 375, "dark")):
            with self.subTest(width=width, theme=theme):
                context = self.browser.new_context(viewport={"width": width, "height": height},
                                                   is_mobile=True, has_touch=True, color_scheme=theme)
                self.addCleanup(context.close)
                self.page = context.new_page()
                self.page.on("pageerror", lambda error: self.errors.append(str(error)))
                self.load()
                self.page.get_by_role("button", name="阅读样式", exact=True).tap()
                panel = self.page.get_by_role("dialog", name="阅读样式", exact=True)
                panel.wait_for(state="visible")
                bounds = panel.bounding_box()
                self.assertGreaterEqual(bounds["x"], 11)
                self.assertLessEqual(bounds["x"] + bounds["width"], width - 11)
                self.assertLessEqual(bounds["y"] + bounds["height"], height - 11)
                self.select("行距", "宽松")
                self.select("正文宽度", "宽阔")
                self.select("字体", "宋体")
                panel.get_by_role("slider", name="字号").focus()
                panel.get_by_role("slider", name="字号").press("End")
                self.assertEqual(self.styles()["size"], "22px")
                self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                self.assertGreater(float(self.page.locator(".book-original h3").first.evaluate("node => getComputedStyle(node).fontSize").removesuffix("px")), 22)
                panel.get_by_role("button", name="恢复默认").tap()
                self.assertEqual(self.styles()["size"], "15px")
                self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                panel.get_by_role("button", name="关闭阅读样式").tap()
                self.assertEqual(self.page.locator('.aipm-reading-entry').get_attribute("aria-expanded"), "false")
                self.page.emulate_media(media="print")
                self.assertFalse(self.page.locator(".aipm-reading-entry").is_visible())
