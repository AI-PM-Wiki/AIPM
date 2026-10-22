"""Sequential article links on the built site and through real browser navigation."""

from pathlib import Path
import unittest
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from mkdocs.commands.build import build
from mkdocs.config import load_config
from mkdocs.structure.files import get_files
from mkdocs.structure.nav import get_navigation
from playwright.sync_api import sync_playwright

from harness import ROOT, WORK, StaticSite


class ArticleNavigationCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(ROOT / "site")
        cls.addClassCleanup(cls.site.close)
        cls.config = load_config(str(ROOT / "mkdocs.yml"),
                                 site_dir=str(WORK / "article-navigation-site"),
                                 site_url=cls.site.base + "/")
        cls.config.plugins.on_startup(command="build", dirty=False)
        cls.addClassCleanup(cls.config.plugins.on_shutdown)
        build(cls.config)
        cls.site.serve(cls.config.site_dir)
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

    def setUp(self):
        self.errors = []

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def open_page(self, path, width=1440, scheme="light"):
        context = self.browser.new_context(viewport={"width": width, "height": 900},
                                           color_scheme=scheme, is_mobile=width < 768,
                                           has_touch=width < 768)
        self.addCleanup(context.close)
        page = context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.goto(self.site.base + path, wait_until="domcontentloaded")
        page.wait_for_function("window.document$")
        return page

    def test_all_articles_follow_the_current_space(self):
        config = self.config
        nav = get_navigation(get_files(config), config)
        for current in nav.pages:
            current.read_source(config)
        for space in nav:
            pages = [current for current in nav.pages if space in current.ancestors]
            for index, current in enumerate(pages):
                with self.subTest(page=current.url):
                    document = BeautifulSoup(Path(current.file.abs_dest_path).read_text(), "html.parser")
                    links = document.select(".md-content__inner > .aipm-article-nav > a")
                    expected = []
                    if index:
                        expected.append(("prev", pages[index - 1]))
                    if index + 1 < len(pages):
                        expected.append(("next", pages[index + 1]))
                    if "footer" in current.meta.get("hide", []):
                        expected = []
                    self.assertEqual(len(links), len(expected))
                    for link, (direction, target) in zip(links, expected):
                        self.assertEqual(link["rel"], [direction])
                        self.assertEqual(urlsplit(urljoin(self.site.base + "/" + current.url, link["href"])).path,
                                         "/" + target.url)
                        self.assertEqual(link.select_one(".aipm-article-nav__title").get_text(), target.title)
                        self.assertTrue(link["aria-label"].endswith(target.title))
        not_found = BeautifulSoup((Path(config.site_dir) / "404.html").read_text(), "html.parser")
        self.assertIsNone(not_found.select_one(".aipm-article-nav"))

    def test_click_keyboard_history_and_instant_navigation(self):
        page = self.open_page("/product-manager/02/01/")
        page.evaluate("window.articleNavigationDocument = document")
        page.locator('.aipm-article-nav a[rel="next"]').click()
        page.wait_for_url("**/product-manager/02/02/")
        page.locator('.aipm-article-nav a[rel="prev"]').wait_for()
        self.assertTrue(page.evaluate("window.articleNavigationDocument === document"))
        page.go_back()
        page.wait_for_url("**/product-manager/02/01/")
        previous = page.locator('.aipm-article-nav a[rel="prev"]')
        previous.focus()
        previous.press("Enter")
        page.wait_for_url("**/product-manager/02/")
        self.assertEqual(page.locator(".aipm-article-nav").count(), 1)

    def test_responsive_themes_focus_and_print(self):
        for width, scheme in ((1440, "light"), (1440, "dark"), (390, "light"), (320, "dark")):
            with self.subTest(width=width, scheme=scheme):
                page = self.open_page("/product-manager/02/01/", width, scheme)
                navigation = page.get_by_role("navigation", name="文章导航", exact=True)
                previous = navigation.locator('a[rel="prev"]')
                following = navigation.locator('a[rel="next"]')
                previous.scroll_into_view_if_needed()
                first, second = previous.bounding_box(), following.bounding_box()
                self.assertGreaterEqual(first["x"], 0)
                self.assertLessEqual(second["x"] + second["width"], width)
                self.assertGreaterEqual(first["height"], 48)
                self.assertTrue(previous.locator(".aipm-article-nav__title").is_visible())
                self.assertTrue(following.locator(".aipm-article-nav__title").is_visible())
                self.assertAlmostEqual(first["y"], second["y"], delta=1)
                self.assertAlmostEqual(first["width"], second["width"], delta=1)
                self.assertGreaterEqual(second["x"], first["x"] + first["width"])
                previous.focus()
                page.keyboard.press("Tab")
                self.assertTrue(following.evaluate("node => node === document.activeElement"))
                page.keyboard.press("Shift+Tab")
                self.assertEqual(previous.evaluate("node => getComputedStyle(node).outlineStyle"), "solid")
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), width)
                page.emulate_media(media="print")
                self.assertFalse(navigation.is_visible())
