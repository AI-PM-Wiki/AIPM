"""Book sections, figure references and the image viewer on the built site."""

import re
import unittest
from urllib.parse import unquote, urljoin, urlsplit

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from harness import ROOT, StaticSite


class BookFiguresCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(ROOT / 'site')
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.site.close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900})
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def load(self, path):
        self.page.goto(self.site.base + path, wait_until='domcontentloaded')
        self.page.wait_for_selector('.book-original')

    def test_sections_and_reference_destinations(self):
        sections = list((ROOT / 'docs/product-manager').glob('[0-9][0-9]/[0-9][0-9]/index.md'))
        self.assertEqual(len(sections), 62)
        self.assertEqual(list((ROOT / 'docs/product-manager').glob('[0-9][0-9]/[0-9][0-9]/[0-9][0-9].md')), [])
        references = 0
        headings = 0
        for source in (ROOT / 'site').rglob('*.html'):
            document = BeautifulSoup(source.read_text(), 'html.parser')
            body = document.select_one('.book-original')
            if body is None:
                continue
            headings += sum(bool(re.match(r'^\d+\.\d+\.\d+', node.get_text())) for node in body.find_all('h3'))
            for link in body.select('a[href*="#figure-"]'):
                target = urlsplit(link['href'])
                destination = source.parent.joinpath(unquote(target.path)) if target.path else source
                if destination.is_dir():
                    destination = destination / 'index.html'
                self.assertTrue(destination.is_file(), (source, link['href']))
                figure = BeautifulSoup(destination.read_text(), 'html.parser').find(id=unquote(target.fragment))
                self.assertIsNotNone(figure, (source, link['href']))
                self.assertEqual(figure.name, 'figure')
                self.assertIsNotNone(figure.find('img'))
                references += 1
        self.assertEqual(headings, 126)
        self.assertGreaterEqual(references, 120)

    def test_figure_reference_highlight_and_repeated_link(self):
        self.load('/product-manager/00/02/')
        reference = self.page.locator('.book-original a[href$="#figure-0-1"]')
        reference.click()
        self.page.wait_for_function("document.getElementById('figure-0-1').classList.contains('is-figure-target')")
        self.assertEqual(self.page.evaluate('location.hash'), '#figure-0-1')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'figure-0-1')
        bounds = self.page.locator('#figure-0-1').bounding_box()
        self.assertLess(bounds['y'], 900)
        self.assertGreater(bounds['y'] + bounds['height'], 48)
        self.page.wait_for_function("!document.getElementById('figure-0-1').classList.contains('is-figure-target')")
        reference.click()
        self.page.wait_for_function("document.getElementById('figure-0-1').classList.contains('is-figure-target')")

    def test_cross_article_reference(self):
        cross_reference = None
        for source in sorted((ROOT / 'site/product-manager').rglob('*.html')):
            document = BeautifulSoup(source.read_text(), 'html.parser')
            for link in document.select('.book-original a[href*="#figure-"]'):
                if urlsplit(link['href']).path:
                    cross_reference = (source, link['href'])
                    break
            if cross_reference:
                break
        self.assertIsNotNone(cross_reference)
        source, href = cross_reference
        source_url = '/' + str(source.parent.relative_to(ROOT / 'site')) + '/'
        self.load(source_url)
        identifier = unquote(urlsplit(href).fragment)
        destination = urljoin(self.site.base + source_url, href)
        reference = self.page.locator(f'.book-original a[href$="#{identifier}"]').first
        self.assertEqual(reference.evaluate('(link) => link.href'), destination)
        reference.click()
        self.page.wait_for_function("identifier => document.getElementById(identifier)?.classList.contains('is-figure-target')", arg=identifier)
        self.assertEqual(self.page.url, destination)
        self.assertEqual(self.page.evaluate('document.activeElement.id'), identifier)
        bounds = self.page.locator(f'#{identifier}').bounding_box()
        self.assertLess(bounds['y'], 900)
        self.assertGreater(bounds['y'] + bounds['height'], 48)

    def test_image_viewer_desktop_and_mobile(self):
        for width in [1280, 390, 320]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 900})
                self.load('/product-manager/00/02/')
                image = self.page.locator('#figure-0-1 img')
                self.page.wait_for_selector('#figure-0-1 .mermaid-zoom__trigger')
                before = image.get_attribute('style')
                image.click()
                self.page.wait_for_selector('#aipm-mermaid-dialog[open]')
                self.page.wait_for_function("Number(document.querySelector('.mermaid-zoom__scale').textContent.replace('%', '')) > 0")
                self.assertIn('图0-1', self.page.locator('#aipm-mermaid-dialog-title').inner_text())
                scale = lambda: int(self.page.locator('.mermaid-zoom__scale').inner_text().rstrip('%'))
                initial = scale()
                self.page.locator('[data-mermaid-action="zoom-in"]').click()
                self.assertGreater(scale(), initial)
                self.page.locator('[data-mermaid-action="zoom-out"]').click()
                self.page.locator('[data-mermaid-action="fit"]').click()
                viewport = self.page.locator('.mermaid-zoom__viewport').bounding_box()
                self.page.mouse.move(viewport['x'] + viewport['width']/2, viewport['y'] + viewport['height']/2)
                initial = scale()
                self.page.mouse.wheel(0, -200)
                self.page.wait_for_function("value => Number(document.querySelector('.mermaid-zoom__scale').textContent.replace('%', '')) > value", arg=initial)
                before_pan = self.page.locator('.mermaid-zoom__canvas').get_attribute('style')
                self.page.mouse.down()
                self.page.mouse.move(viewport['x'] + viewport['width']/2 + 40, viewport['y'] + viewport['height']/2 + 30, steps=4)
                self.page.mouse.up()
                self.assertNotEqual(self.page.locator('.mermaid-zoom__canvas').get_attribute('style'), before_pan)
                self.page.keyboard.press('Escape')
                self.page.wait_for_function("!document.getElementById('aipm-mermaid-dialog').open")
                self.assertEqual(image.get_attribute('style'), before)
                self.assertTrue(image.is_visible())
                self.assertTrue(self.page.evaluate("document.activeElement.classList.contains('mermaid-zoom__trigger')"))
                self.page.keyboard.press('Enter')
                self.page.wait_for_selector('#aipm-mermaid-dialog[open]')
                self.page.locator('[data-mermaid-action="close"]').click()
                self.page.wait_for_function("!document.getElementById('aipm-mermaid-dialog').open")

    def test_touch_pinch_zoom(self):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        self.addCleanup(context.close)
        page = context.new_page()
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        page.goto(self.site.base + '/product-manager/00/02/', wait_until='domcontentloaded')
        page.wait_for_selector('#figure-0-1 .mermaid-zoom__trigger')
        image = page.locator('#figure-0-1 img')
        image.scroll_into_view_if_needed()
        box = image.bounding_box()
        page.touchscreen.tap(box['x'] + box['width']/2, box['y'] + box['height']/2)
        page.wait_for_selector('#aipm-mermaid-dialog[open]')
        page.wait_for_function("Number(document.querySelector('.mermaid-zoom__scale').textContent.replace('%', '')) > 0")
        initial = int(page.locator('.mermaid-zoom__scale').inner_text().rstrip('%'))
        viewport = page.locator('.mermaid-zoom__viewport').bounding_box()
        x = viewport['x'] + viewport['width']/2
        y = viewport['y'] + viewport['height']/2
        protocol = context.new_cdp_session(page)
        protocol.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x-30, 'y': y, 'id': 1}, {'x': x+30, 'y': y, 'id': 2}]})
        protocol.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x-60, 'y': y, 'id': 1}, {'x': x+60, 'y': y, 'id': 2}]})
        protocol.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        page.wait_for_function("value => Number(document.querySelector('.mermaid-zoom__scale').textContent.replace('%', '')) > value", arg=initial)
        page.locator('[data-mermaid-action="close"]').tap()
        page.wait_for_function("!document.getElementById('aipm-mermaid-dialog').open")
