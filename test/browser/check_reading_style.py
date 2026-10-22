"""Reading preferences on built pages using real Chromium interactions."""

import json
import unittest

from playwright.sync_api import sync_playwright

from harness import ROOT, WORK, StaticSite


class ReadingStyleCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (WORK / "settings").mkdir(parents=True, exist_ok=True)
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
        self.page.get_by_role("button", name="站点设置", exact=True).wait_for()

    def open(self):
        self.page.get_by_role("button", name="站点设置", exact=True).click()
        self.page.get_by_role("dialog", name="站点设置", exact=True).wait_for(state="visible")
        self.page.wait_for_function("""() => document.querySelector('.aipm-reading-style__window')
          .getAnimations().every(animation => animation.playState !== 'running')""")

    def wait_closed(self):
        self.page.get_by_role("dialog", name="站点设置", exact=True).wait_for(state="hidden")

    def select(self, group, label):
        self.page.get_by_role("group", name=group, exact=True).get_by_text(label, exact=True).click()

    def select_style(self, name, label):
        self.page.get_by_role("combobox", name=name, exact=True).select_option(label=label)

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
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        self.assertEqual(panel.get_by_role("button", name="关闭站点设置").inner_text(), "")
        self.assertEqual(self.page.locator(".aipm-reading-entry .aipm-reading-style__gear").count(), 1)
        self.assertFalse(self.page.locator('.md-header [data-md-component="palette"]').is_visible())
        self.assertEqual(self.page.locator(".mkdocs-toggle-sidebar-button").count(), 0)
        slider = panel.get_by_role("slider", name="字号")
        slider.focus()
        slider.press("End")
        self.select("行距", "宽松")
        self.select_style("字体", "思源宋体")
        self.select("正文宽度", "宽阔")
        self.assertEqual(self.styles()["size"], "22px")
        self.assertAlmostEqual(float(self.styles()["line"].removesuffix("px")), 46.2, places=1)
        self.assertIn("Songti SC", self.styles()["font"])
        self.assertEqual(panel.locator("#aipm-reading-size-value").inner_text(), "22 px")
        self.assertEqual(self.page.locator(".md-header").evaluate("node => getComputedStyle(node).fontSize"), header_size)
        self.page.reload(wait_until="domcontentloaded")
        self.assertEqual(self.styles()["size"], "22px")
        self.open()
        self.assertTrue(panel.get_by_role("group", name="行距", exact=True).get_by_role("radio", name="宽松").is_checked())
        panel.get_by_role("button", name="关闭站点设置").click()
        self.page.locator('.md-sidebar--primary a[href$="/product-manager/02/02/"]').click()
        self.page.wait_for_url("**/product-manager/02/02/")
        self.assertEqual(self.styles()["size"], "22px")
        self.assertEqual(self.page.locator(".aipm-reading-entry").count(), 1)
        self.open()
        panel.get_by_role("button", name="恢复默认").click()
        self.assertEqual(self.styles()["size"], "15px")
        self.assertEqual(self.styles()["line"], "27px")
        saved = json.loads(self.page.evaluate('localStorage.getItem("aipm-reading-style")'))
        self.assertEqual(saved, {"size": 15, "spacing": "standard", "width": "standard", "font": "sans",
                                 "heading": "structured", "emphasis": "marker", "color": "indigo",
                                 "customColor": "#4051b5", "indent": "none"})

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
        second.get_by_role("button", name="站点设置", exact=True).click()
        second.get_by_role("button", name="恢复默认").click()
        self.page.wait_for_function('getComputedStyle(document.querySelector(".md-content__inner")).fontSize === "15px"')

    def test_keyboard_dismissal_theme_and_search(self):
        self.load()
        entry = self.page.get_by_role("button", name="站点设置", exact=True)
        entry.focus()
        entry.press("Enter")
        self.assertEqual(entry.get_attribute("aria-expanded"), "true")
        self.page.keyboard.press("Escape")
        self.wait_closed()
        self.assertTrue(entry.evaluate("node => node === document.activeElement"))
        self.assertEqual(entry.get_attribute("aria-expanded"), "false")
        entry.press("Space")
        self.page.get_by_role("button", name="关闭站点设置").click()
        self.wait_closed()
        self.assertTrue(entry.evaluate("node => node === document.activeElement"))
        self.open()
        self.assertTrue(self.page.locator("#aipm-reading-style").evaluate("node => node.matches(':modal')"))
        for _ in range(20):
            self.page.keyboard.press("Tab")
            self.assertTrue(self.page.evaluate("document.querySelector('#aipm-reading-style').contains(document.activeElement)"))
        self.page.mouse.click(5, 250)
        self.wait_closed()
        self.assertEqual(entry.get_attribute("aria-expanded"), "false")
        scheme = self.page.locator("body").get_attribute("data-md-color-scheme")
        self.open()
        self.page.get_by_role("tab", name="外观", exact=True).click()
        self.select_style("外观", "浅色" if scheme == "slate" else "深色")
        self.assertNotEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), scheme)
        self.assertEqual(entry.get_attribute("aria-expanded"), "true")
        self.page.get_by_role("tab", name="排版", exact=True).click()
        self.page.get_by_role("slider", name="字号").focus()
        self.page.get_by_role("slider", name="字号").press("Home")
        self.page.keyboard.press("Escape")
        self.wait_closed()
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
                self.page.get_by_role("button", name="站点设置", exact=True).tap()
                panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
                panel.wait_for(state="visible")
                self.page.wait_for_function("""() => document.querySelector('.aipm-reading-style__window')
                  .getAnimations().every(animation => animation.playState !== 'running')""")
                bounds = panel.bounding_box()
                self.assertEqual(bounds["x"], 0)
                self.assertEqual(bounds["width"], width)
                self.assertLessEqual(bounds["y"] + bounds["height"], height)
                self.select("行距", "宽松")
                self.select("正文宽度", "宽阔")
                self.select_style("字体", "思源宋体")
                panel.get_by_role("slider", name="字号").focus()
                panel.get_by_role("slider", name="字号").press("End")
                self.assertEqual(self.styles()["size"], "22px")
                self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                self.assertGreater(float(self.page.locator(".book-original h3").first.evaluate("node => getComputedStyle(node).fontSize").removesuffix("px")), 22)
                panel.get_by_role("button", name="恢复默认").tap()
                self.assertEqual(self.styles()["size"], "15px")
                self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                panel.get_by_role("tab", name="通用", exact=True).tap()
                language = panel.get_by_role("combobox", name="站点语言")
                language.select_option("zh-CN")
                self.assertEqual(language.locator("option").all_text_contents(), ["简体中文"])
                panel.get_by_role("tab", name="外观", exact=True).tap()
                self.select_style("标题样式", "主题色")
                self.select_style("加粗样式", "下划线")
                self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                for name in ("排版", "外观", "通用"):
                    panel.get_by_role("tab", name=name, exact=True).tap()
                    controls = panel.locator(".aipm-reading-style__settings").bounding_box()
                    preview_bounds = panel.locator(".aipm-reading-style__preview-pane").bounding_box()
                    self.assertAlmostEqual(controls["y"] + controls["height"], preview_bounds["y"], delta=1)
                    self.assertAlmostEqual(preview_bounds["y"] + preview_bounds["height"], height, delta=1)
                    self.assertGreaterEqual(preview_bounds["height"], height * .39)
                close = panel.get_by_role("button", name="关闭站点设置").bounding_box()
                reset = panel.get_by_role("button", name="恢复默认").bounding_box()
                self.assertGreaterEqual(close["x"], reset["x"] + reset["width"])
                panel.get_by_role("tab", name="外观", exact=True).tap()
                if width == 320:
                    panel.get_by_role("button", name="恢复默认").tap()
                    self.page.screenshot(path=str(WORK / "settings/mobile-dark.png"))
                preview = panel.locator(".aipm-reading-style__preview")
                self.assertTrue(preview.is_visible())
                self.assertTrue(panel.get_by_role("tab", name="排版", exact=True).is_visible())
                self.assertLessEqual(preview.bounding_box()["width"], width)
                self.assertEqual(preview.evaluate("node => node.scrollWidth <= node.clientWidth"), True)
                self.assertGreater(preview.locator("p").count(), 10)
                scroll = panel.locator(".aipm-reading-style__preview-scroll")
                body = panel.locator(".aipm-reading-style__body")
                controls_scroll = body.evaluate("node => node.scrollTop")
                scroll.hover()
                self.page.mouse.wheel(0, 500)
                self.page.wait_for_function("document.querySelector('.aipm-reading-style__preview-scroll').scrollTop > 0")
                self.assertEqual(body.evaluate("node => node.scrollTop"), controls_scroll)
                if width == 390:
                    scroll.evaluate("node => { node.scrollTop = 0; }")
                    self.page.screenshot(path=str(WORK / "settings/mobile-preview.png"))
                panel.get_by_role("tab", name="排版", exact=True).tap()
                self.select("首行样式", "首行缩进")
                self.assertEqual(preview.locator(".book-original > p").first.evaluate("node => getComputedStyle(node).textIndent"), "30px")
                panel.get_by_role("button", name="关闭站点设置").tap()
                self.wait_closed()
                self.assertEqual(self.page.locator('.aipm-reading-entry').get_attribute("aria-expanded"), "false")
                self.page.emulate_media(media="print")
                self.assertFalse(self.page.locator(".aipm-reading-entry").is_visible())

    def test_appearance_colors_typography_and_language(self):
        self.load()
        self.open()
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        tab = panel.get_by_role("tab", name="排版", exact=True)
        tab.focus()
        tab.press("ArrowRight")
        self.assertEqual(panel.get_by_role("tab", name="外观", exact=True).get_attribute("aria-selected"), "true")
        heading = self.page.locator(".md-content__inner .book-original h3").first
        emphasis = self.page.locator(".md-content__inner .book-original p strong").first
        self.select_style("标题样式", "简洁")
        self.assertEqual(heading.evaluate("node => getComputedStyle(node).borderInlineStartWidth"), "0px")
        self.select_style("标题样式", "层次")
        self.assertEqual(heading.evaluate("node => getComputedStyle(node).borderInlineStartWidth"), "3px")
        self.select_style("加粗样式", "纯文字")
        self.assertEqual(emphasis.evaluate("node => getComputedStyle(node).backgroundImage"), "none")
        self.select_style("加粗样式", "下划线")
        self.assertEqual(emphasis.evaluate("node => getComputedStyle(node).textDecorationLine"), "underline")
        self.select_style("加粗样式", "淡色标记")
        self.assertIn("linear-gradient", emphasis.evaluate("node => getComputedStyle(node).backgroundImage"))
        self.select_style("标题样式", "主题色")
        for dark in (False, True):
            self.select_style("外观", "深色" if dark else "浅色")
            previous = set()
            for label in ("靛蓝", "海蓝", "青绿", "琥珀", "玫红", "紫罗兰"):
                panel.get_by_role("group", name="主题色", exact=True).locator(f'label[title="{label}"]').click()
                self.page.wait_for_function("""() => getComputedStyle(document.querySelector('.md-content__inner .book-original h3')).color ===
                  getComputedStyle(document.querySelector('.md-content__inner .book-original a')).color""")
                values = self.page.evaluate("""() => {
                  const heading = document.querySelector('.md-content__inner .book-original h3');
                  const link = document.querySelector('.md-content__inner .book-original a');
                  const preview = document.querySelector('.aipm-reading-style__preview h3');
                  return { heading: getComputedStyle(heading).color, link: getComputedStyle(link).color,
                    preview: getComputedStyle(preview).color };
                }""")
                self.assertEqual(values["heading"], values["link"])
                self.assertEqual(values["heading"], values["preview"])
                previous.add(values["link"])
            self.assertEqual(len(previous), 6)
        panel.get_by_role("button", name="恢复默认").click()
        panel.screenshot(path=str(WORK / "settings/desktop-appearance.png"))
        panel.get_by_role("group", name="主题色", exact=True).locator('label[title="青绿"]').click()
        self.select_style("标题样式", "简洁")
        self.select_style("加粗样式", "下划线")
        self.page.reload(wait_until="domcontentloaded")
        self.open()
        panel.get_by_role("tab", name="外观", exact=True).click()
        self.assertTrue(panel.get_by_role("radio", name="青绿", exact=True).is_checked())
        self.assertEqual(panel.get_by_role("combobox", name="标题样式", exact=True).input_value(), "simple")
        self.assertEqual(panel.get_by_role("combobox", name="加粗样式", exact=True).input_value(), "underline")

    def test_appearance_modes_follow_browser_and_persist(self):
        self.page.emulate_media(color_scheme="light")
        self.load()
        self.open()
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        panel.get_by_role("tab", name="外观", exact=True).click()
        appearance = panel.get_by_role("combobox", name="外观", exact=True)
        self.assertEqual(appearance.locator("option").all_text_contents(), ["跟随浏览器", "深色", "浅色"])
        self.assertEqual(panel.locator("#aipm-settings-appearance > div").evaluate_all("""nodes => nodes.map(node =>
          node.getAttribute('aria-label') || node.querySelector('label').textContent)"""),
          ["主题色", "外观", "标题样式", "加粗样式"])
        self.assertEqual(panel.get_by_role("button", name="全文显示", exact=True).count(), 0)
        self.select_style("外观", "深色")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "slate")
        self.page.emulate_media(color_scheme="dark")
        self.page.emulate_media(color_scheme="light")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "slate")
        self.page.reload(wait_until="domcontentloaded")
        self.open()
        panel.get_by_role("tab", name="外观", exact=True).click()
        self.assertEqual(appearance.input_value(), "dark")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "slate")
        self.select_style("外观", "浅色")
        self.page.emulate_media(color_scheme="dark")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "default")
        self.select_style("外观", "跟随浏览器")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "slate")
        self.page.emulate_media(color_scheme="light")
        self.page.wait_for_function("document.body.dataset.mdColorScheme === 'default'")
        self.page.emulate_media(color_scheme="dark")
        self.page.wait_for_function("document.body.dataset.mdColorScheme === 'slate'")
        self.page.reload(wait_until="domcontentloaded")
        self.open()
        panel.get_by_role("tab", name="外观", exact=True).click()
        self.assertEqual(appearance.input_value(), "auto")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "slate")
        self.select_style("外观", "浅色")
        panel.get_by_role("button", name="恢复默认").click()
        self.assertEqual(appearance.input_value(), "auto")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "slate")
        second = self.context.new_page()
        second.goto(self.page.url, wait_until="domcontentloaded")
        second.get_by_role("button", name="站点设置", exact=True).click()
        second.get_by_role("tab", name="外观", exact=True).click()
        self.select_style("外观", "深色")
        second.wait_for_function("document.querySelector('#aipm-settings-scheme').value === 'dark'")
        self.assertEqual(second.locator("body").get_attribute("data-md-color-scheme"), "slate")
        second.get_by_role("combobox", name="外观", exact=True).select_option("auto")
        self.page.wait_for_function("document.querySelector('#aipm-settings-scheme').value === 'auto'")
        self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), "slate")
        self.assertEqual(second.locator("body").get_attribute("data-md-color-scheme"), "default")

    def test_centered_modal_article_preview_and_reduced_motion(self):
        self.load()
        self.page.evaluate("window.scrollTo(0, 300)")
        scroll = self.page.evaluate("scrollY")
        self.open()
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        window = panel.locator(".aipm-reading-style__window").bounding_box()
        self.assertAlmostEqual(window["x"] + window["width"] / 2, 800, delta=1)
        self.assertAlmostEqual(window["y"] + window["height"] / 2, 500, delta=1)
        controls = panel.locator(".aipm-reading-style__settings").bounding_box()
        preview = panel.locator(".aipm-reading-style__preview-pane").bounding_box()
        self.assertAlmostEqual(controls["x"] + controls["width"], preview["x"], delta=1)
        self.assertAlmostEqual(controls["y"], preview["y"], delta=1)
        self.assertIn("blur", panel.evaluate("node => getComputedStyle(node, '::backdrop').backdropFilter"))
        self.assertTrue(self.page.evaluate("getComputedStyle(document.documentElement).overflow === 'hidden'"))
        article = panel.locator(".aipm-reading-style__preview")
        self.assertEqual(article.locator("h1").inner_text(), self.page.locator(".md-content__inner > h1").inner_text())
        self.assertEqual(article.locator("p").count(), self.page.locator(".md-content__inner p").count())
        self.assertGreater(article.locator("img").count(), 0)
        self.assertGreater(article.locator("strong").count(), 0)
        self.assertEqual(article.locator("[id], a[href], button, [data-book-footnote]").count(), 0)
        reset = panel.get_by_role("button", name="恢复默认")
        self.assertEqual(reset.inner_text(), "")
        self.assertTrue(reset.evaluate("node => node.parentElement.classList.contains('aipm-reading-style__toolbar')"))
        self.select_style("字体", "思源宋体")
        self.assertIn("Songti SC", article.evaluate("node => getComputedStyle(node).fontFamily"))
        panel.screenshot(path=str(WORK / "settings/desktop-typography.png"))
        panel.get_by_role("button", name="关闭站点设置").click()
        self.wait_closed()
        self.assertEqual(self.page.evaluate("scrollY"), scroll)
        self.assertFalse(self.page.evaluate("document.documentElement.classList.contains('aipm-settings-open')"))
        self.page.emulate_media(reduced_motion="reduce")
        self.open()
        self.assertEqual(panel.locator(".aipm-reading-style__window").evaluate("node => getComputedStyle(node).animationName"), "none")
        self.page.keyboard.press("Escape")
        self.wait_closed()

    def test_homepage_svg_preview_preserves_article_rendering(self):
        for width, height in ((1600, 1000), (390, 844)):
            for theme in ("light", "dark"):
                with self.subTest(width=width, theme=theme):
                    self.page.set_viewport_size({"width": width, "height": height})
                    self.page.emulate_media(color_scheme=theme)
                    self.page.goto(self.site.base + "/", wait_until="domcontentloaded")
                    self.open()
                    panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
                    scheme = "slate" if theme == "dark" else "default"
                    if self.page.locator("body").get_attribute("data-md-color-scheme") != scheme:
                        panel.get_by_role("tab", name="外观", exact=True).click()
                        self.select_style("外观", "深色" if theme == "dark" else "浅色")
                        panel.get_by_role("tab", name="排版", exact=True).click()
                    self.assertEqual(self.page.locator("body").get_attribute("data-md-color-scheme"), scheme)
                    styles = self.page.evaluate("""() => {
                      const properties = ['fill', 'stroke', 'strokeWidth', 'strokeLinecap',
                        'strokeLinejoin', 'opacity', 'shapeRendering'];
                      const inspect = selector => {
                        const svg = document.querySelector(selector);
                        return [svg, ...svg.querySelectorAll('*')].map(node => {
                          const style = getComputedStyle(node);
                          return Object.fromEntries(properties.map(property => [property, style[property]]));
                        });
                      };
                      return {
                        source: inspect('.md-content__inner .pm-wordmark > svg'),
                        preview: inspect('.aipm-reading-style__preview .pm-wordmark > svg'),
                      };
                    }""")
                    self.assertEqual(styles["source"], styles["preview"])
                    icon = panel.locator(".aipm-reading-style__close > svg")
                    self.assertEqual(icon.evaluate("node => getComputedStyle(node).fill"), "none")
                    self.assertNotEqual(icon.evaluate("node => getComputedStyle(node).stroke"), "none")
                    self.assertEqual(icon.evaluate("node => getComputedStyle(node).width"), "18px")
                    self.page.get_by_role("button", name="关闭站点设置").click()
                    self.wait_closed()

    def test_main_site_heading_and_emphasis_settings(self):
        self.page.goto(self.site.base + "/pm/requirements/", wait_until="domcontentloaded")
        self.open()
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        panel.get_by_role("tab", name="外观", exact=True).click()
        for label, border, weight in (("简洁", "0px", "650"), ("层次", "3px", "750")):
            with self.subTest(heading=label):
                self.select_style("标题样式", label)
                for root in (".md-content__inner", ".aipm-reading-style__preview"):
                    heading = self.page.locator(f"{root} h3").first
                    self.assertEqual(heading.evaluate("node => getComputedStyle(node).borderInlineStartWidth"), border)
                    self.assertEqual(heading.evaluate("node => getComputedStyle(node).fontWeight"), weight)
        for label, decoration, marker in (("纯文字", "none", False), ("下划线", "underline", False),
                                           ("淡色标记", "none", True)):
            with self.subTest(emphasis=label):
                self.select_style("加粗样式", label)
                for root in (".md-content__inner", ".aipm-reading-style__preview"):
                    emphasis = self.page.locator(f"{root} > p strong").first
                    self.assertEqual(emphasis.evaluate("node => getComputedStyle(node).textDecorationLine"), decoration)
                    self.assertEqual("linear-gradient" in emphasis.evaluate("node => getComputedStyle(node).backgroundImage"), marker)
        self.select_style("标题样式", "主题色")
        panel.get_by_role("radio", name="青绿", exact=True).check()
        self.page.wait_for_function("""() =>
          getComputedStyle(document.querySelector('.md-content__inner h3')).color ===
          getComputedStyle(document.querySelector('.md-content__inner p a[href]')).color
        """)
        colors = self.page.evaluate("""() => ({
          headings: [...document.querySelectorAll('.md-content__inner :is(h1, h2, h3, h4), .aipm-reading-style__preview :is(h1, h2, h3, h4)')]
            .map(node => getComputedStyle(node).color),
          accent: getComputedStyle(document.querySelector('.md-content__inner p a[href]')).color,
        })""")
        self.assertEqual(set(colors["headings"]), {colors["accent"]})
        panel.get_by_role("button", name="关闭站点设置").click()
        self.wait_closed()
        self.page.reload(wait_until="domcontentloaded")
        self.open()
        panel.get_by_role("tab", name="外观", exact=True).click()
        self.assertEqual(panel.get_by_role("combobox", name="标题样式", exact=True).input_value(), "accent")
        self.assertEqual(panel.get_by_role("combobox", name="加粗样式", exact=True).input_value(), "marker")
        self.assertIn("linear-gradient", self.page.locator(".md-content__inner > p strong").first.evaluate("node => getComputedStyle(node).backgroundImage"))

    def test_main_site_mobile_reading_preferences(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.goto(self.site.base + "/pm/requirements/", wait_until="domcontentloaded")
        self.open()
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        panel.get_by_role("tab", name="外观", exact=True).click()
        self.select_style("标题样式", "简洁")
        self.select_style("加粗样式", "下划线")
        for dark in (False, True):
            with self.subTest(dark=dark):
                self.select_style("外观", "深色" if dark else "浅色")
                for root in (".md-content__inner", ".aipm-reading-style__preview"):
                    heading = self.page.locator(f"{root} h3").first
                    self.assertEqual(heading.evaluate("node => getComputedStyle(node).borderInlineStartWidth"), "0px")
                    self.assertEqual(heading.evaluate("node => getComputedStyle(node).paddingInlineStart"), "0px")
                    self.assertEqual(heading.evaluate("node => getComputedStyle(node).fontWeight"), "650")
                    emphasis = self.page.locator(f"{root} > p strong").first
                    self.assertEqual(emphasis.evaluate("node => getComputedStyle(node).textDecorationLine"), "underline")
        panel.get_by_role("tab", name="排版", exact=True).click()
        panel.get_by_role("slider", name="字号").focus()
        panel.get_by_role("slider", name="字号").press("End")
        self.select("行距", "宽松")
        self.select_style("字体", "思源宋体")
        self.select("首行样式", "首行缩进")
        for root in (".md-content__inner", ".aipm-reading-style__preview"):
            paragraph = self.page.locator(f"{root} > p").first
            self.assertEqual(paragraph.evaluate("node => getComputedStyle(node).fontSize"), "22px")
            self.assertAlmostEqual(float(paragraph.evaluate("node => getComputedStyle(node).lineHeight").removesuffix("px")), 46.2, places=1)
            self.assertEqual(paragraph.evaluate("node => getComputedStyle(node).textIndent"), "44px")
            self.assertIn("Songti SC", paragraph.evaluate("node => getComputedStyle(node).fontFamily"))
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)
        self.assertTrue(panel.locator(".aipm-reading-style__preview").evaluate("node => node.scrollWidth <= node.clientWidth"))

    def test_custom_color_contrast_persistence_and_reset(self):
        self.load()
        self.open()
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        panel.get_by_role("tab", name="外观", exact=True).click()
        self.select_style("标题样式", "主题色")
        picker = panel.get_by_label("自选颜色", exact=True)
        self.assertEqual(picker.get_attribute("type"), "color")
        self.assertEqual(panel.locator(".aipm-reading-style__custom-color output").count(), 0)
        self.assertTrue(picker.evaluate("""node => {
          const input = node.getBoundingClientRect();
          const swatch = node.nextElementSibling.getBoundingClientRect();
          return input.x <= swatch.x && input.y <= swatch.y &&
            input.right >= swatch.right && input.bottom >= swatch.bottom;
        }"""))
        for dark in (False, True):
            self.select_style("外观", "深色" if dark else "浅色")
            for color in ("#ffffff", "#000000", "#00ff00", "#d52e69"):
                picker.fill(color)
                self.assertEqual(picker.get_attribute("data-selected"), "true")
                self.assertEqual(picker.input_value(), color)
                contrast = panel.locator(".aipm-reading-style__preview").evaluate("""node => {
                  const canvas = document.createElement('canvas');
                  canvas.width = canvas.height = 1;
                  const context = canvas.getContext('2d');
                  const luminance = color => {
                    context.fillStyle = color;
                    context.fillRect(0, 0, 1, 1);
                    const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
                      value /= 255;
                      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
                    });
                    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
                  };
                  const foreground = luminance(getComputedStyle(node.querySelector('h3')).color);
                  const background = luminance(getComputedStyle(node).backgroundColor);
                  return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
                }""")
                self.assertGreaterEqual(contrast, 4.5)
        self.page.reload(wait_until="domcontentloaded")
        self.open()
        panel.get_by_role("tab", name="外观", exact=True).click()
        self.assertEqual(picker.input_value(), "#d52e69")
        self.assertEqual(picker.get_attribute("data-selected"), "true")
        panel.get_by_role("button", name="恢复默认").click()
        self.assertEqual(picker.input_value(), "#4051b5")
        self.assertTrue(panel.get_by_role("radio", name="靛蓝", exact=True).is_checked())
        self.assertEqual(picker.get_attribute("data-selected"), "false")

    def test_paragraph_indent_preview_persistence_and_general_tab(self):
        self.load()
        self.open()
        panel = self.page.get_by_role("dialog", name="站点设置", exact=True)
        paragraph = self.page.locator(".md-content__inner .book-original > p").filter(has_text="产品经理是做什么的").first
        preview = panel.locator(".book-original > p").filter(has_text="产品经理是做什么的").first
        self.assertEqual(paragraph.evaluate("node => getComputedStyle(node).textIndent"), "0px")
        self.select("首行样式", "首行缩进")
        for node in (paragraph, preview):
            self.assertEqual(node.evaluate("node => getComputedStyle(node).textIndent"), "30px")
        figure = self.page.locator(".md-content__inner figure p").first
        self.assertEqual(figure.evaluate("node => getComputedStyle(node).textIndent"), "0px")
        panel.get_by_role("slider", name="字号").focus()
        panel.get_by_role("slider", name="字号").press("End")
        self.assertEqual(paragraph.evaluate("node => getComputedStyle(node).textIndent"), "44px")
        self.page.reload(wait_until="domcontentloaded")
        self.open()
        self.assertTrue(panel.get_by_role("radio", name="首行缩进", exact=True).is_checked())
        self.assertEqual(paragraph.evaluate("node => getComputedStyle(node).textIndent"), "44px")
        self.select("首行样式", "首行顶格")
        self.assertEqual(paragraph.evaluate("node => getComputedStyle(node).textIndent"), "0px")
        typography = panel.get_by_role("tab", name="排版", exact=True)
        typography.focus()
        typography.press("End")
        self.assertEqual(panel.get_by_role("tab", name="通用", exact=True).get_attribute("aria-selected"), "true")
        language = panel.get_by_role("combobox", name="站点语言", exact=True)
        self.assertTrue(language.is_visible())
        self.assertEqual(language.locator("option").all_text_contents(), ["简体中文"])
        self.assertEqual(language.evaluate("node => node.closest('[role=tabpanel]').id"), "aipm-settings-general")
        panel.get_by_role("tab", name="通用", exact=True).press("ArrowRight")
        self.assertEqual(typography.get_attribute("aria-selected"), "true")
        panel.get_by_role("button", name="恢复默认").click()
        self.assertTrue(panel.get_by_role("radio", name="首行顶格", exact=True).is_checked())

    def test_font_library_loads_selected_typefaces(self):
        self.load()
        self.assertEqual(self.page.locator("link[data-reading-font]").count(), 0)
        self.open()
        selector = self.page.get_by_role("combobox", name="字体", exact=True)
        self.assertEqual(selector.locator("option").all_text_contents(),
                         ["默认黑体", "思源黑体", "思源宋体", "站酷小薇", "站酷快乐", "马善政楷书", "龙藏行书"])
        for value, family in (("noto", "Noto Sans SC"), ("serif", "Noto Serif SC"),
                              ("xiaowei", "ZCOOL XiaoWei"), ("kuaile", "ZCOOL KuaiLe"),
                              ("mashan", "Ma Shan Zheng"), ("longcang", "Long Cang")):
            with self.subTest(font=family):
                selector.select_option(value)
                self.page.wait_for_function("value => document.querySelector(`link[data-reading-font='${value}']`)?.dataset.loaded === 'true'", arg=value)
                loaded = self.page.evaluate("""async family => {
                  const faces = await document.fonts.load(`16px "${family}"`, '产品经理阅读样式');
                  return faces.length > 0 && faces.every(face => face.status === 'loaded');
                }""", family)
                self.assertTrue(loaded)
                self.assertIn(family, self.styles()["font"])
                self.assertIn(family, self.page.locator(".aipm-reading-style__preview").evaluate("node => getComputedStyle(node).fontFamily"))
        self.page.reload(wait_until="domcontentloaded")
        self.open()
        self.assertEqual(selector.input_value(), "longcang")
        self.page.get_by_role("button", name="恢复默认").click()
        self.assertEqual(selector.input_value(), "sans")
