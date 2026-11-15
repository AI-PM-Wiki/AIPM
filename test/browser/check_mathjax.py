"""Self-hosted MathJax on the built site: full loads, instant navigation, fonts and on-demand components."""

import re
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from mkdocs.commands.build import build
from mkdocs.config import load_config
from playwright.sync_api import sync_playwright

from harness import ROOT, WORK, StaticSite

VERSION = re.search(r"^VERSION=(\S+)$", (ROOT / "scripts/vendor-mathjax.sh").read_text(encoding="utf-8"),
                    re.MULTILINE).group(1)
RELEASE = f"/_static/js/vendor/mathjax-{VERSION}/"
PLAIN = "/product-manager/02/01/"
FIRST = "/ai/theorems/"
SECOND = "/ai/capabilities/"


class MathJaxCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(ROOT / "site")
        cls.addClassCleanup(cls.site.close)
        cls.config = load_config(str(ROOT / "mkdocs.yml"),
                                 site_dir=str(WORK / "mathjax-site"),
                                 site_url=cls.site.base + "/")
        cls.config.plugins.on_startup(command="build", dirty=False)
        cls.addClassCleanup(cls.config.plugins.on_shutdown)
        build(cls.config)
        cls.site.serve(cls.config.site_dir)
        cls.formulas = {path: cls.count_formulas(path) for path in (PLAIN, FIRST, SECOND)}
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

    @classmethod
    def count_formulas(cls, path):
        html = (Path(cls.config.site_dir) / path.strip("/") / "index.html").read_text(encoding="utf-8")
        return len(BeautifulSoup(html, "html.parser").select("article .arithmatex"))

    def setUp(self):
        self.assertEqual(self.formulas[PLAIN], 0)
        self.assertGreater(self.formulas[FIRST], 0)
        self.assertGreater(self.formulas[SECOND], 0)
        self.errors = []
        self.responses = []
        self.requests = []
        context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.addCleanup(context.close)
        context.on("request", lambda request: self.requests.append(request.url))
        context.on("response", lambda response: self.responses.append((response.url, response.status)))
        self.page = context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.assertEqual(self.errors, [])
        mathjax = [url for url in self.requests if "mathjax" in url.lower()]
        self.assertTrue(mathjax)
        self.assertEqual([url for url in mathjax if not url.startswith(self.site.base + "/")], [])
        self.assertEqual([(url, status) for url, status in self.responses
                          if urlsplit(url).path.startswith(RELEASE) and status != 200], [])

    def release_paths(self):
        return {urlsplit(url).path[len(RELEASE):] for url, _ in self.responses
                if urlsplit(url).path.startswith(RELEASE)}

    def open_page(self, path):
        with self.page.expect_response(lambda response: urlsplit(response.url).path == "/sitemap.xml"):
            self.page.goto(self.site.base + path, wait_until="domcontentloaded")
        self.page.wait_for_function("window.MathJax && MathJax.startup && MathJax.startup.promise")
        self.page.evaluate("MathJax.startup.promise.then(() => null)")
        self.page.evaluate("window.mathjaxDocument = document")

    def navigate(self, path):
        self.page.evaluate("""href => {
            const link = document.createElement("a");
            link.href = href;
            link.id = "mathjax-navigation";
            link.textContent = href;
            document.querySelector(".md-content__inner").append(link);
        }""", path)
        self.page.locator("#mathjax-navigation").dispatch_event("click")
        self.page.wait_for_url("**" + path)
        self.assert_typeset(path)
        self.assertTrue(self.page.evaluate("window.mathjaxDocument === document"))

    def assert_typeset(self, path, jax="CHTML"):
        self.page.wait_for_function("""([count, jax]) =>
            document.querySelectorAll(`article .arithmatex > mjx-container[jax="${jax}"]`).length === count""",
                                    arg=[self.formulas[path], jax])
        self.assertEqual(self.page.locator("article mjx-merror").count(), 0)
        self.assertTrue(self.page.evaluate("""Array.from(MathJax.startup.document.math).length ===
            document.querySelectorAll(".arithmatex > mjx-container").length"""))
        if jax == "CHTML":
            glyphs = self.page.evaluate("""[...document.querySelectorAll("article mjx-c")]
                .map(node => getComputedStyle(node, "::before").content !== "none")""")
            self.assertTrue(glyphs)
            self.assertTrue(all(glyphs))

    def open_menu(self):
        formula = self.page.locator("article mjx-container >> visible=true").first
        formula.evaluate("node => node.scrollIntoView({block: 'center'})")
        box = formula.bounding_box()
        self.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button="right")

    def choose(self, *labels):
        self.open_menu()
        for label in labels[:-1]:
            self.page.locator(".CtxtMenu_MenuItem", has_text=label).last.hover()
        self.page.locator(".CtxtMenu_Menu").last.locator(".CtxtMenu_MenuItem").filter(
            has_text=re.compile("^" + re.escape(labels[-1]) + "✓?$")).click()

    def test_full_load_typesets_formulas_with_release_fonts(self):
        self.open_page(FIRST)
        self.assert_typeset(FIRST)
        self.page.evaluate("document.fonts.ready.then(() => null)")
        loaded = self.page.evaluate("""[...document.fonts]
            .filter(font => font.family.startsWith("MJX") && font.status === "loaded")
            .map(font => font.family)""")
        self.assertIn("MJXTEX-I", loaded)
        self.assertIn("output/chtml/fonts/woff-v2/MathJax_Math-Italic.woff", self.release_paths())

    def test_instant_navigation_typesets_every_formula_page(self):
        self.open_page(PLAIN)
        self.navigate(FIRST)
        self.navigate(SECOND)
        self.page.go_back()
        self.page.wait_for_url("**" + FIRST)
        self.assert_typeset(FIRST)
        self.assertTrue(self.page.evaluate("window.mathjaxDocument === document"))
        chtml = [url for url in self.requests if urlsplit(url).path == RELEASE + "tex-chtml.js"]
        self.assertEqual(len(chtml), 1)

    def test_autoload_extensions_load_from_the_release(self):
        self.open_page(FIRST)
        errors = self.page.evaluate(r"""MathJax.tex2chtmlPromise(
            "\\ce{H2O} + \\cancel{x} + \\color{red}{y} + \\boldsymbol{z} + \\bra{\\psi}")
            .then(node => node.querySelectorAll("mjx-merror").length)""")
        self.assertEqual(errors, 0)
        for name in ("mhchem", "cancel", "color", "boldsymbol", "braket"):
            self.assertIn(f"input/tex/extensions/{name}.js", self.release_paths())

    def test_svg_renderer_loads_from_the_release(self):
        self.open_page(FIRST)
        self.assert_typeset(FIRST)
        self.choose("Math Settings", "Math Renderer", "SVG")
        self.assert_typeset(FIRST, "SVG")
        self.assertTrue({"output/svg.js", "output/svg/fonts/tex.js"} <= self.release_paths())

    # MathJax 3.2.2 的菜单首次开启语义增强时，同步重排遇到 SRE 初始化抛出的 retry，
    # 页面上已排版的公式不再插回；无障碍组件的效果因此在新转换的公式上检查。
    def test_accessibility_components_load_from_the_release(self):
        self.open_page(FIRST)
        self.assert_typeset(FIRST)
        self.choose("Accessibility", "Activate")
        self.page.wait_for_function("""MathJax.tex2chtmlPromise("x^2")
            .then(node => node.querySelector("[data-semantic-speech]") !== null)""")
        speech = self.page.evaluate("""MathJax.tex2chtmlPromise("x^2")
            .then(node => node.querySelector("[data-semantic-speech]").getAttribute("data-semantic-speech"))""")
        self.assertEqual(speech, "x squared")
        self.assertTrue({"a11y/explorer.js", "a11y/semantic-enrich.js", "a11y/sre.js", "input/mml.js",
                         "sre/mathmaps/base.json", "sre/mathmaps/en.json"} <= self.release_paths())

    def test_collapsible_math_loads_from_the_release(self):
        self.open_page(FIRST)
        self.assert_typeset(FIRST)
        self.choose("Accessibility", "Collapsible Math")
        self.page.wait_for_function(r"""MathJax.tex2chtmlPromise("\\frac{a}{b}")
            .then(node => node.querySelector("[data-semantic-complexity]") !== null)""")
        self.assertIn("a11y/complexity.js", self.release_paths())
