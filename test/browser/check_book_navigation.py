"""Chapter index navigation, reading guides and retained book links."""

import re
import unittest
from urllib.parse import unquote, urlsplit

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from harness import ROOT, StaticSite


CHAPTERS = [
    "0 导读", "1 产品经理", "2 产品基础", "3 产品概念", "4 用户需求",
    "5 需求分析", "6 功能设计", "7 研发执行", "8 规划迭代", "9 产品运营",
    "10 综合案例", "11 职业成长", "12 延伸阅读",
]


class BookNavigationCase(unittest.TestCase):
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

    def test_chapters_front_matter_and_retained_links(self):
        self.assertEqual(len(list((ROOT / "docs").rglob("*.md"))), 76)
        for name in ("introduction", "preface", "contents", "copyright", "reader-services", "reviews", "back-cover"):
            self.assertFalse((ROOT / "docs/product-manager" / f"{name}.md").exists())
            self.assertFalse((ROOT / "site/product-manager" / name).exists())
        referenced_images = set()
        for source in (ROOT / "site").rglob("*.html"):
            document = BeautifulSoup(source.read_text(), "html.parser")
            body = document.select_one(".book-original")
            if body is None:
                continue
            self.assertIsNone(document.select_one(".page-copyright"))
            self.assertIsNone(document.select_one(".md-copyright__highlight"))
            for image in body.select("img[src]"):
                destination = source.parent.joinpath(unquote(urlsplit(image["src"]).path)).resolve()
                self.assertTrue(destination.is_file(), (source, image["src"]))
                referenced_images.add(destination.name)
            for link in body.select("a[href]"):
                target = urlsplit(link["href"])
                if target.scheme or target.netloc:
                    continue
                destination = source.parent.joinpath(unquote(target.path)) if target.path else source
                if destination.is_dir():
                    destination /= "index.html"
                self.assertTrue(destination.is_file(), (source, link["href"]))
                if target.fragment:
                    target_document = BeautifulSoup(destination.read_text(), "html.parser")
                    self.assertIsNotNone(target_document.find(id=unquote(target.fragment)), (source, link["href"]))
        self.assertEqual(referenced_images, {path.name for path in (ROOT / "docs/product-manager/images").iterdir() if path.is_file()})
        for number, title in enumerate(CHAPTERS):
            document = BeautifulSoup((ROOT / f"site/product-manager/{number:02}/index.html").read_text(), "html.parser")
            self.assertEqual([node.get_text(strip=True) for node in document.select(".md-content__inner > h1")], [title])
            body = document.select_one(".book-original")
            self.assertIsNotNone(body.find("img"))
            self.assertIsNone(re.search(r"\d+\.\d+[^\n]*/\d+", body.get_text()))
        introduction = BeautifulSoup((ROOT / "site/product-manager/00/index.html").read_text(), "html.parser").select_one(".book-original")
        self.assertEqual([node.get_text(strip=True).rstrip("¶") for node in introduction.find_all("h2")], ["内容简介", "自序", "阅读导图"])
        self.assertIsNotNone(introduction.find(id="figure-1"))
        self.assertIsNotNone(introduction.find(id="footnote_content_fow005_1"))

    def test_chapter_title_opens_guide_and_arrow_toggles(self):
        context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.addCleanup(context.close)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(self.site.base + "/", wait_until="domcontentloaded")
        page.locator('.md-sidebar--primary a[href$="/product-manager/01/"]').click()
        page.wait_for_url("**/product-manager/01/")
        page.locator(".book-original img").wait_for()
        chapter = page.locator('.md-sidebar--primary .md-nav__container a[href$="/product-manager/01/"]')
        self.assertEqual(chapter.count(), 1)
        self.assertEqual(chapter.inner_text().strip(), CHAPTERS[1])
        container = chapter.locator("..").locator("..")
        toggle = container.locator(":scope > input.md-nav__toggle")
        arrow = container.locator(":scope > .md-nav__container > label")
        self.assertTrue(toggle.is_checked())
        arrow.click()
        self.assertFalse(toggle.is_checked())
        self.assertEqual(page.url, self.site.base + "/product-manager/01/")
        arrow.click()
        self.assertTrue(toggle.is_checked())
        self.assertEqual(container.locator('nav a[href$="/product-manager/01/"]').count(), 0)
        container.locator('nav a[href$="/product-manager/01/01/"]').click()
        page.wait_for_url("**/product-manager/01/01/")
        self.assertEqual(errors, [])

    def test_mobile_chapter_navigation(self):
        for width in (390, 320):
            with self.subTest(width=width):
                context = self.browser.new_context(viewport={"width": width, "height": 844}, is_mobile=True, has_touch=True)
                self.addCleanup(context.close)
                page = context.new_page()
                page.goto(self.site.base + "/", wait_until="domcontentloaded")
                page.locator('.md-header label[for="__drawer"]').tap()
                page.locator('.md-sidebar--primary a[href$="/product-manager/02/"]').tap()
                page.wait_for_url("**/product-manager/02/")
                self.assertEqual(page.locator(".md-content__inner > h1").inner_text(), CHAPTERS[2])
                page.locator(".book-original img").wait_for()
                self.assertFalse(page.locator("#__drawer").is_checked())
                self.assertEqual(page.evaluate("document.documentElement.scrollWidth"), width)
