"""Assert the always-on Hypothesis integration contract."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "mkdocs.yml"
HYPOTHESIS = ROOT / "docs" / "_static" / "js" / "hypothesis.js"
ABOUT = ROOT / "docs" / "intro" / "about.md"


class TestHypothesisScripts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.hypothesis = HYPOTHESIS.read_text(encoding="utf-8")
        cls.about = ABOUT.read_text(encoding="utf-8")

    def test_config_loads_vendor_before_local_controller(self):
        self.assertEqual(self.config.count("https://hypothes.is/embed.js"), 1)
        entries = re.findall(r"_static/js/hypothesis\.js\?v=\d+", self.config)
        self.assertEqual(entries, ["_static/js/hypothesis.js?v=9"])
        self.assertLess(
            self.config.index("https://hypothes.is/embed.js"),
            self.config.index("_static/js/hypothesis.js?v=9"),
        )

    def test_controller_does_not_create_vendor_script(self):
        self.assertNotIn("https://hypothes.is/embed.js", self.hypothesis)
        self.assertNotIn('document.createElement("script")', self.hypothesis)
        self.assertNotIn("loadHypothesis", self.hypothesis)

    def test_controller_restores_vendor_styles_after_instant_navigation(self):
        self.assertIn("function rememberVendorAssets()", self.hypothesis)
        self.assertIn("function restoreVendorAssets()", self.hypothesis)
        self.assertIn("state.observer = new MutationObserver", self.hypothesis)
        self.assertIn('node.matches("[data-hypothesis-asset]")', self.hypothesis)
        self.assertIn(
            "document.head.appendChild(template.content.firstElementChild);",
            self.hypothesis,
        )
        self.assertIn('return node.tagName !== "SCRIPT";', self.hypothesis)

    def test_controller_keeps_one_style_controller_and_sidebar_observer(self):
        self.assertIn('var STATE_KEY = "__aipm_hypothesis_style";', self.hypothesis)
        self.assertIn("function installSidebarStyle()", self.hypothesis)
        self.assertIn("function scheduleSidebarStyle()", self.hypothesis)
        self.assertIn("state.sidebarObserver = new MutationObserver", self.hypothesis)
        self.assertIn("state.sidebarRootObserver = new MutationObserver", self.hypothesis)
        self.assertIn('data-aipm-hypothesis-style', self.hypothesis)
        self.assertIn(".shadowRoot", self.hypothesis)
        self.assertIn('[data-testid="sidebar-edge"]', self.hypothesis)
        self.assertIn("background: transparent !important", self.hypothesis)
        self.assertIn("box-shadow: none !important", self.hypothesis)
        self.assertIn("border-color: transparent !important", self.hypothesis)

    def test_sidebar_style_preserves_the_default_open_trigger(self):
        style_start = self.hypothesis.index("var SIDEBAR_STYLE =")
        style_end = self.hypothesis.index("function installSidebarStyle", style_start)
        sidebar_style = self.hypothesis[style_start:style_end]
        for forbidden in (
            "display: none",
            "width: 0",
            "visibility: hidden",
            "pointer-events: none",
        ):
            self.assertNotIn(forbidden, sidebar_style)

    def test_sidebar_style_is_initialized_and_resubscribed_for_navigation(self):
        self.assertIn("observeSidebarDom();", self.hypothesis)
        self.assertIn("scheduleSidebarStyle();", self.hypothesis)
        self.assertIn('if (!state.subscribed && typeof document$ !== "undefined")', self.hypothesis)
        self.assertIn("document$.subscribe(function ()", self.hypothesis)
        self.assertIn("state.subscribed = true;", self.hypothesis)

    def test_sidebar_toolbar_leaves_mobile_header_clear(self):
        style_start = self.hypothesis.index("var SIDEBAR_STYLE =")
        style_end = self.hypothesis.index("function installSidebarStyle", style_start)
        sidebar_style = self.hypothesis[style_start:style_end]
        self.assertIn("@media screen and (max-width: 59.984375em)", sidebar_style)
        self.assertIn('[data-testid="toolbar-container"] {', sidebar_style)
        self.assertIn("transform: translateY(48px) !important;", sidebar_style)

    def test_wrapper_does_not_call_undocumented_lifecycle_apis(self):
        for name in ("destroy", "reset", "reinitialize"):
            self.assertNotIn(f".{name}(", self.hypothesis)

    def test_about_page_discloses_third_party_annotation_service(self):
        self.assertIn("Hypothesis", self.about)
        self.assertIn("页面 URL", self.about)
        self.assertIn("选中文本", self.about)
        self.assertIn("批注内容", self.about)


if __name__ == "__main__":
    unittest.main()
