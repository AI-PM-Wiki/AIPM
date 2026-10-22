"""Site switching through the real header dropdown on desktop and mobile."""

import unittest

from playwright.sync_api import sync_playwright

from harness import ROOT, WORK, StaticSite


MAIN_TABS = [
    "简介", "产品方法论", "工程与架构", "工商管理", "商业与财会", "AI 基础",
    "AI 产品实战", "工具与平台", "学习资源", "求职专题", "垂直领域",
]


class SiteSwitcherCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (WORK / "site-switcher").mkdir(parents=True, exist_ok=True)
        cls.site = StaticSite(ROOT / "site")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.site.close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(self.site.base + "/product-manager/02/01/", wait_until="domcontentloaded")
        self.trigger = self.page.locator(".aipm-site-switcher__trigger")
        self.menu = self.page.get_by_role("navigation", name="站点列表", exact=True)

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def test_order_local_destinations_and_placeholders(self):
        self.assertEqual(self.trigger.locator(".md-ellipsis").inner_text(), "AI-PM")
        self.assertFalse(self.menu.is_visible())
        self.trigger.click()
        self.menu.wait_for(state="visible")
        self.assertEqual(self.trigger.get_attribute("aria-expanded"), "true")
        self.assertEqual(self.menu.locator("li > :is(a, button) > span:first-child").all_text_contents(),
                         ["主站", "产品", "科技", "商业"])
        self.assertEqual(self.menu.get_by_role("link", name="主站", exact=True).get_attribute("href"), self.site.base + "/")
        product = self.menu.get_by_role("link", name="产品", exact=False)
        self.assertEqual(product.get_attribute("aria-current"), "true")
        self.assertEqual(product.get_attribute("href"), self.site.base + "/product-manager/")
        for name in ("科技", "商业"):
            placeholder = self.menu.get_by_role("link", name=f"{name} 筹备中", exact=True)
            self.assertTrue(placeholder.get_attribute("href").startswith(self.site.base + "/sites/"))
        bounds = self.menu.bounding_box()
        trigger = self.trigger.bounding_box()
        self.assertAlmostEqual(bounds["x"], trigger["x"], delta=1)
        self.assertGreater(bounds["y"], trigger["y"] + trigger["height"])
        self.page.screenshot(path=str(WORK / "site-switcher/desktop.png"))
        product.click()
        self.page.wait_for_url(self.site.base + "/product-manager/")
        self.menu.wait_for(state="hidden")
        self.assertEqual(self.trigger.count(), 1)
        self.page.locator('.md-content__inner a[href$="/product-manager/02/"]').click()
        self.page.wait_for_url("**/product-manager/02/")
        self.page.locator('.md-sidebar--primary a[href$="/product-manager/02/01/"]').click()
        self.page.wait_for_url("**/product-manager/02/01/")
        self.page.locator(".book-original img").first.wait_for()
        self.page.locator(".md-content__inner").hover()
        self.page.mouse.wheel(0, 700)
        self.page.wait_for_function("scrollY > 0")
        self.trigger.click()
        self.menu.wait_for(state="visible")
        self.assertEqual(self.trigger.count(), 1)
        self.assertEqual(self.page.locator("#aipm-site-switcher").count(), 1)

    def test_keyboard_outside_dismissal_and_focus(self):
        self.trigger.focus()
        self.trigger.press("Enter")
        self.menu.wait_for(state="visible")
        self.trigger.press("Enter")
        self.menu.wait_for(state="hidden")
        self.trigger.press("ArrowDown")
        main = self.menu.get_by_role("link", name="主站", exact=False)
        product = self.menu.get_by_role("link", name="产品", exact=False)
        self.assertTrue(main.evaluate("node => node === document.activeElement"))
        main.press("ArrowDown")
        self.assertTrue(product.evaluate("node => node === document.activeElement"))
        product.press("Home")
        self.assertTrue(main.evaluate("node => node === document.activeElement"))
        main.press("End")
        business = self.menu.get_by_role("link", name="商业 筹备中", exact=True)
        self.assertTrue(business.evaluate("node => node === document.activeElement"))
        business.press("Escape")
        self.menu.wait_for(state="hidden")
        self.assertTrue(self.trigger.evaluate("node => node === document.activeElement"))
        self.assertEqual(self.trigger.get_attribute("aria-expanded"), "false")
        self.trigger.click()
        self.page.locator(".md-content__inner > h1").click()
        self.menu.wait_for(state="hidden")
        self.assertEqual(self.trigger.get_attribute("aria-expanded"), "false")

    def test_content_directory_current_state_and_history(self):
        for name, path, heading, destination in (
            ("主站", "/", "关于本项目", "/intro/htc/"),
            ("产品", "/product-manager/", "章节", "/product-manager/02/"),
            ("科技", "/sites/technology/", "筹备中", "/sites/technology/"),
            ("商业", "/sites/business/", "筹备中", "/sites/business/"),
        ):
            with self.subTest(content=name):
                self.trigger.click()
                self.menu.get_by_role("link", name=name, exact=False).click()
                self.page.wait_for_url(self.site.base + path)
                self.page.locator(".md-content__inner").get_by_role("heading", name=heading, exact=False).wait_for()
                self.assertEqual(self.trigger.get_attribute("aria-label"), f"切换站点，当前为{name}")
                sidebar = self.page.locator(".md-sidebar--primary")
                self.assertTrue(sidebar.locator(f'a[href$="{destination}"]').first.is_visible())
                self.trigger.click()
                selected = self.menu.locator('[aria-current="true"]')
                self.assertEqual(selected.count(), 1)
                self.assertEqual(selected.locator("span").first.inner_text(), name)
                self.page.keyboard.press("Escape")
        self.page.reload(wait_until="domcontentloaded")
        self.assertEqual(self.trigger.get_attribute("aria-label"), "切换站点，当前为商业")
        self.page.go_back(wait_until="domcontentloaded")
        self.page.wait_for_url(self.site.base + "/sites/technology/")
        self.page.wait_for_function("document.querySelector('.aipm-site-switcher__trigger').getAttribute('aria-label') === '切换站点，当前为科技'")
        self.assertEqual(self.page.locator(".aipm-site-switcher__trigger").count(), 1)

    def test_tabs_follow_space_and_highlight_current_category(self):
        tabs = self.page.locator('[data-md-component="tabs"]')
        self.assertTrue(tabs.is_visible())
        self.assertEqual([text.strip() for text in tabs.locator("a").all_text_contents()], ["产品经理"])
        self.assertEqual(tabs.locator(".md-tabs__item--active").inner_text(), "产品经理")
        self.trigger.click()
        self.menu.get_by_role("link", name="主站", exact=True).click()
        tabs.get_by_role("link", name="产品方法论", exact=True).wait_for()
        self.assertEqual([text.strip() for text in tabs.locator("a").all_text_contents()], MAIN_TABS)
        self.assertEqual(tabs.locator(".md-tabs__item--active").inner_text(), "简介")
        tabs.get_by_role("link", name="产品方法论", exact=True).click()
        self.page.wait_for_url(self.site.base + "/pm/")
        self.assertEqual(tabs.locator(".md-tabs__item--active").inner_text(), "产品方法论")
        sidebar = self.page.locator(".md-sidebar--primary")
        sidebar.get_by_role("link", name="需求分析", exact=True).click()
        self.page.wait_for_url(self.site.base + "/pm/requirements/")
        self.assertEqual(tabs.locator(".md-tabs__item--active").inner_text(), "产品方法论")
        self.assertEqual(sidebar.locator('a[href*="/product-manager/"]').count(), 0)
        self.page.reload(wait_until="domcontentloaded")
        self.assertEqual(tabs.locator(".md-tabs__item--active").inner_text(), "产品方法论")
        for name, title in (("产品", "产品经理"), ("科技", "科技"), ("商业", "商业")):
            self.trigger.click()
            self.menu.get_by_role("link", name=name, exact=False).click()
            tabs.get_by_role("link", name=title, exact=True).wait_for()
            self.assertEqual([text.strip() for text in tabs.locator("a").all_text_contents()], [title])
            self.assertEqual(tabs.locator(".md-tabs__item--active").inner_text(), title)
        self.page.go_back(wait_until="domcontentloaded")
        tabs.get_by_role("link", name="科技", exact=True).wait_for()
        self.assertEqual(tabs.locator(".md-tabs__item--active").inner_text(), "科技")
        self.page.goto(self.site.base + "/404.html", wait_until="domcontentloaded")
        self.assertEqual([text.strip() for text in tabs.locator("a").all_text_contents()], MAIN_TABS)

    def test_mobile_current_space_categories_in_drawer(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.trigger.click()
        self.menu.get_by_role("link", name="主站", exact=True).click()
        self.page.wait_for_url(self.site.base + "/")
        self.assertFalse(self.page.locator('[data-md-component="tabs"]').is_visible())
        self.page.locator('.md-header label[for="__drawer"]').click()
        sidebar = self.page.locator(".md-sidebar--primary")
        self.assertEqual(sidebar.locator(".md-nav--primary > .md-nav__list > li").count(), len(MAIN_TABS))
        sidebar.locator('nav[data-md-level="1"] > .md-nav__title').click()
        ai = sidebar.locator('a[href$="/ai/"]').first
        self.assertTrue(ai.is_visible())
        ai.click()
        self.page.wait_for_url(self.site.base + "/ai/")
        self.page.locator('.md-header label[for="__drawer"]').click()
        sidebar.locator('a[href$="/ai/rag/"]').click()
        self.page.wait_for_url(self.site.base + "/ai/rag/")
        self.assertFalse(self.page.locator("#__drawer").is_checked())
        self.assertEqual(sidebar.locator('a[href*="/product-manager/"]').count(), 0)
        self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)

    def test_mobile_theme_viewport_and_header_controls(self):
        for width, height, theme in ((390, 844, "light"), (320, 844, "dark"), (667, 375, "dark")):
            with self.subTest(width=width, height=height, theme=theme):
                context = self.browser.new_context(viewport={"width": width, "height": height},
                                                   is_mobile=True, has_touch=True, color_scheme=theme)
                self.addCleanup(context.close)
                page = context.new_page()
                page.on("pageerror", lambda error: self.errors.append(str(error)))
                page.goto(self.site.base + "/product-manager/02/01/", wait_until="domcontentloaded")
                trigger = page.get_by_role("button", name="切换站点，当前为产品", exact=True)
                trigger.tap()
                menu = page.get_by_role("navigation", name="站点列表", exact=True)
                menu.wait_for(state="visible")
                page.wait_for_function("document.querySelector('#aipm-site-switcher').getAnimations().every(animation => animation.playState !== 'running')")
                bounds = menu.bounding_box()
                self.assertGreaterEqual(bounds["x"], 0)
                self.assertLessEqual(bounds["x"] + bounds["width"], width)
                self.assertLessEqual(bounds["y"] + bounds["height"], height)
                self.assertEqual(page.evaluate("document.documentElement.scrollWidth"), width)
                settings = page.get_by_role("button", name="站点设置", exact=True)
                trigger_bounds = trigger.bounding_box()
                self.assertLessEqual(trigger_bounds["x"] + trigger_bounds["width"], settings.bounding_box()["x"])
                if width == 320:
                    page.screenshot(path=str(WORK / "site-switcher/mobile-dark.png"))
                settings.tap()
                menu.wait_for(state="hidden")
                page.get_by_role("dialog", name="站点设置", exact=True).wait_for(state="visible")
                page.get_by_role("button", name="关闭站点设置", exact=True).tap()
                page.get_by_role("dialog", name="站点设置", exact=True).wait_for(state="hidden")
                trigger.tap()
                page.locator('.md-header label[for="__drawer"]').tap()
                menu.wait_for(state="hidden")
                self.assertTrue(page.locator("#__drawer").is_checked())
