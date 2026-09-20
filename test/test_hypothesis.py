"""Assert the always-on Hypothesis integration contract."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "mkdocs.yml"
HYPOTHESIS = ROOT / "docs" / "_static" / "js" / "hypothesis.js"
EXTRA_CSS = ROOT / "docs" / "_static" / "css" / "extra.css"
ABOUT = ROOT / "docs" / "intro" / "about.md"

# issue #67 定案：侧栏收起时官方竖排控制条整条隐藏，入口改为页头右上角的
# 站点原生按钮；展开时保留面板左缘的控制条（唯一的收起入口），只换配色。
ENTRY_SELECTOR = ".md-header .md-header__button.aipm-hypothesis-entry"
STRIP_HIDDEN_WHILE_COLLAPSED = (
    '#sidebar-container.sidebar-collapsed [data-testid="sidebar-edge"]'
)


class TestHypothesisScripts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.hypothesis = HYPOTHESIS.read_text(encoding="utf-8")
        cls.about = ABOUT.read_text(encoding="utf-8")

    def sidebar_style(self):
        """SIDEBAR_STYLE 常量注入 shadow root 的那段样式文本。"""
        start = self.hypothesis.index("var SIDEBAR_STYLE =")
        end = self.hypothesis.index("function installSidebarStyle", start)
        # 源码里是 JS 字符串字面量，先把 \" 还原成 CSS 里的 "
        return self.hypothesis[start:end].replace('\\"', '"')

    def entry_source(self):
        """页头入口按钮相关的代码段（状态同步 + 开合 + 注入）。"""
        start = self.hypothesis.index("function syncEntryState")
        end = self.hypothesis.index("  rememberVendorAssets();")
        return self.hypothesis[start:end]

    def test_config_loads_vendor_before_local_controller(self):
        self.assertEqual(self.config.count("https://hypothes.is/embed.js"), 1)
        entries = re.findall(r"_static/js/hypothesis\.js\?v=\d+", self.config)
        self.assertEqual(entries, ["_static/js/hypothesis.js?v=10"])
        self.assertLess(
            self.config.index("https://hypothes.is/embed.js"),
            self.config.index("_static/js/hypothesis.js?v=10"),
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

    def test_sidebar_style_hides_the_vendor_strip_only_while_collapsed(self):
        style = self.sidebar_style()
        self.assertIn(STRIP_HIDDEN_WHILE_COLLAPSED + " {", style)
        self.assertIn("display: none !important;", style)
        # 每处隐藏都必须挂在「侧栏收起」条件下 —— 展开时控制条是唯一的收起入口。
        hiding_rules = [
            rule for rule in re.findall(r"[^{}]+\{[^}]*\}", style)
            if "display: none" in rule
        ]
        self.assertEqual(len(hiding_rules), 1)
        self.assertIn(STRIP_HIDDEN_WHILE_COLLAPSED, hiding_rules[0])

    def test_sidebar_style_keeps_the_expanded_controls_usable(self):
        style = self.sidebar_style()
        for forbidden in ("visibility: hidden", "pointer-events: none", "width: 0"):
            self.assertNotIn(forbidden, style)
        # 展开时的按钮只换配色（站点 token，亮/暗跟随），不换尺寸。
        self.assertIn('[data-testid="sidebar-edge"] button {', style)
        self.assertIn("background: var(--md-default-bg-color) !important;", style)
        self.assertIn("color: var(--pm-muted) !important;", style)
        self.assertIn('[data-testid="sidebar-edge"] button:hover {', style)

    def test_sidebar_style_is_initialized_and_resubscribed_for_navigation(self):
        self.assertIn("observeSidebarDom();", self.hypothesis)
        self.assertIn("scheduleSidebarStyle();", self.hypothesis)
        self.assertIn('if (!state.subscribed && typeof document$ !== "undefined")', self.hypothesis)
        self.assertIn("document$.subscribe(function ()", self.hypothesis)
        self.assertIn("state.subscribed = true;", self.hypothesis)

    def test_sidebar_toolbar_leaves_mobile_header_clear(self):
        style = self.sidebar_style()
        self.assertIn("@media screen and (max-width: 59.984375em)", style)
        self.assertIn('[data-testid="toolbar-container"] {', style)
        self.assertIn("transform: translateY(48px) !important;", style)

    def test_wrapper_does_not_call_undocumented_lifecycle_apis(self):
        for name in ("destroy", "reset", "reinitialize"):
            self.assertNotIn(f".{name}(", self.hypothesis)

    def test_header_entry_reuses_the_native_header_button_classes(self):
        entry = self.entry_source()
        self.assertIn('var ENTRY_CLASS = "aipm-hypothesis-entry";', self.hypothesis)
        self.assertIn('"md-header__button md-icon " + ENTRY_CLASS', entry)

    def test_header_entry_is_injected_into_the_header_once(self):
        entry = self.entry_source()
        self.assertIn('document.querySelector(".md-header")', entry)
        self.assertIn('header.querySelector("." + ENTRY_CLASS)', entry)
        self.assertIn("header.appendChild(entry);", entry)

    def test_header_entry_drives_the_vendor_sidebar_toggle(self):
        self.assertIn("function vendorToggle()", self.hypothesis)
        self.assertIn('button[aria-controls="', self.hypothesis)
        entry = self.entry_source()
        self.assertIn('entry.addEventListener("click", toggleSidebar);', entry)
        self.assertIn("toggle.click();", entry)

    def test_header_entry_mirrors_the_vendor_expanded_state(self):
        self.assertIn('entry.setAttribute("aria-expanded"', self.hypothesis)
        self.assertIn('toggle.getAttribute("aria-expanded") === "true"', self.hypothesis)
        self.assertIn('attributeFilter: ["aria-expanded"]', self.hypothesis)

    def test_about_page_discloses_third_party_annotation_service(self):
        self.assertIn("Hypothesis", self.about)
        self.assertIn("页面 URL", self.about)
        self.assertIn("选中文本", self.about)
        self.assertIn("批注内容", self.about)


class TestHypothesisEntryStyles(unittest.TestCase):
    """页头入口按钮的定位契约 —— extra.css 5.7。"""

    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.css = EXTRA_CSS.read_text(encoding="utf-8")

    def rule(self, selector):
        match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", self.css)
        self.assertIsNotNone(match, f"extra.css 缺少规则：{selector}")
        return match.group(1)

    def test_stylesheet_is_versioned(self):
        self.assertIn("'_static/css/extra.css?v=36'", self.config)

    def test_entry_button_sits_flush_against_the_viewport_right_edge(self):
        body = self.rule(ENTRY_SELECTOR)
        self.assertIn("position: absolute;", body)
        self.assertIn("top: 0;", body)
        self.assertIn("right: 0;", body)
        self.assertIn("height: 2.4rem;", body)
        self.assertIn("width: 2.4rem;", body)

    def test_header_content_reserves_room_for_the_entry_button(self):
        body = self.rule(".md-header__inner")
        self.assertIn("padding-inline-end: 2.4rem;", body)

    def test_entry_button_yields_to_the_mobile_search_overlay(self):
        self.assertIn(
            '[data-md-toggle="search"]:checked ~ .md-header '
            ".aipm-hypothesis-entry",
            self.css,
        )


if __name__ == "__main__":
    unittest.main()
