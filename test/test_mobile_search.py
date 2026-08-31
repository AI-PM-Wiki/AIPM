"""Regression checks for mobile search and the chat affordance."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXTRA_CSS = ROOT / "docs" / "_static" / "css" / "extra.css"


class MobileSearchRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stylesheet = EXTRA_CSS.read_text(encoding="utf-8")

    def test_mobile_search_modal_uses_viewport_height(self):
        """The fixed search modal must not resolve 100% to the 48px header."""
        self.assertRegex(
            self.stylesheet,
            re.compile(
                r"\[data-md-toggle=\"search\"\]:checked\s*~\s*\.md-header\s*"
                r"\.md-search__inner\s*\{[^}]*height:\s*100dvh",
                re.DOTALL,
            ),
        )

    def test_mobile_search_owns_the_top_layer(self):
        """The search modal must win against fixed chat UI when both are active."""
        self.assertRegex(
            self.stylesheet,
            re.compile(
                r"\[data-md-toggle=\"search\"\]:checked\s*~\s*\.md-header\s*"
                r"\{[^}]*z-index:\s*100",
                re.DOTALL,
            ),
        )
        self.assertRegex(
            self.stylesheet,
            re.compile(
                r"\[data-md-toggle=\"search\"\]:checked\s*~\s*\.md-container\s+\.aipm-chat\s*"
                r"\{[^}]*visibility:\s*hidden",
                re.DOTALL,
            ),
        )


if __name__ == "__main__":
    unittest.main()
