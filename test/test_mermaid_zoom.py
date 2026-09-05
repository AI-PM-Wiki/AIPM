"""Assert the Mermaid viewer loading and interaction contract."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "mkdocs.yml"
MERMAID_JS = ROOT / "docs" / "_static" / "js" / "mermaid-zoom.js"
MERMAID_CSS = ROOT / "docs" / "_static" / "css" / "mermaid-zoom.css"


class TestMermaidZoomAssets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.javascript = MERMAID_JS.read_text(encoding="utf-8")
        cls.stylesheet = MERMAID_CSS.read_text(encoding="utf-8")

    def test_assets_are_registered_with_cache_versions(self):
        config_scripts = self.config[self.config.index("extra_javascript:") :]
        self.assertIn("_static/js/mermaid-zoom.js?v=4", config_scripts)
        self.assertIn("_static/css/mermaid-zoom.css?v=4", config_scripts)

    def test_viewer_waits_for_rendered_mermaid_dom(self):
        self.assertIn('querySelectorAll(".mermaid")', self.javascript)
        self.assertIn('querySelector("svg")', self.javascript)
        self.assertIn("MutationObserver", self.javascript)
        self.assertIn("requestAnimationFrame", self.javascript)
        self.assertIn( 'READY_ATTR = "data-mermaid-zoom-ready"', self.javascript)

    def test_instant_navigation_subscription_is_guarded(self):
        self.assertRegex(
            self.javascript,
            r'if \(typeof document\$ !== "undefined" && document\$ && document\$\.subscribe\) \{\s*'
            r'document\$\.subscribe\(',
        )

    def test_dialog_has_accessibility_and_cleanup_contract(self):
        for text in (
            'setAttribute("aria-modal", "true")',
            'setAttribute("aria-labelledby"',
            'setAttribute("aria-describedby"',
            'setAttribute("aria-haspopup", "dialog")',
            'event.key !== "Tab"',
            'event.preventDefault();\n      closeViewer(true);',
            'source.remove();',
            'trigger.focus()',
        ):
            self.assertIn(text, self.javascript)
        self.assertIn("showModal", self.javascript)

    def test_viewer_supports_centering_and_pointer_drag(self):
        for text in (
            "centerCanvas",
            "pointerdown",
            "setPointerCapture",
            "panX",
            "panY",
            "is-dragging",
            'host.style.position = "absolute"',
        ):
            self.assertIn(text, self.javascript + self.stylesheet)

    def test_viewer_supports_wheel_and_pinch_zoom(self):
        for text in (
            'addEventListener("wheel", zoomWithWheel',
            "deltaMode",
            "Math.hypot",
            'type: "pinch"',
            "startDistance",
            "preventDefault",
        ):
            self.assertIn(text, self.javascript)

    def test_viewer_allows_deep_vector_zoom(self):
        """CSS transform scale rasterizes closed-shadow SVG; cap at 3x was the old UX limit."""
        match = re.search(r"MAX_SCALE\s*=\s*([0-9.]+)", self.javascript)
        self.assertIsNotNone(match, "MAX_SCALE must remain a numeric paint-size guard")
        self.assertGreaterEqual(float(match.group(1)), 32)
        self.assertNotRegex(self.javascript, r"MAX_SCALE\s*=\s*3\b")
        self.assertIn("style.zoom", self.javascript)
        self.assertNotIn("translate3d(", self.javascript)
        self.assertNotIn("scale(${state.scale})", self.javascript)
        self.assertNotIn("will-change: transform", self.stylesheet)

    def test_trigger_is_a_small_icon_with_hover_visibility(self):
        self.assertIn("trigger.innerHTML", self.javascript)
        self.assertIn("mermaid-zoom__trigger svg", self.stylesheet)
        self.assertIn("bottom: .4rem", self.stylesheet)
        self.assertIn("width: 2rem", self.stylesheet)
        self.assertIn("pointer-events: none", self.stylesheet)

    def test_styles_are_namespaced_and_respect_user_preferences(self):
        self.assertIn(".mermaid-zoom__", self.stylesheet)
        self.assertIn(".mermaid-zoom__figure:hover", self.stylesheet)
        self.assertIn("opacity: 0", self.stylesheet)
        self.assertIn("@media (hover: none)", self.stylesheet)
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.stylesheet)
        self.assertIn("@media print", self.stylesheet)
        self.assertIn(".mermaid-zoom__viewport", self.stylesheet)
        self.assertIn("overflow: hidden", self.stylesheet)
        self.assertIn("touch-action: none", self.stylesheet)
        self.assertNotIn(".md-typeset img", self.stylesheet)


if __name__ == "__main__":
    unittest.main()
