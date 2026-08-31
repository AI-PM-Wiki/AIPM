"""Assert the mobile chat panel does not expose the page scrollbar."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAT_CSS = ROOT / "docs" / "_static" / "css" / "chat-widget.css"


class TestChatWidgetStyles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = CHAT_CSS.read_text(encoding="utf-8")

    def test_mobile_open_panel_locks_document_scroll(self):
        self.assertIn("@media (max-width: 76.1875em)", self.css)
        self.assertIn(
            "html:has(.aipm-chat:not(.aipm-chat--docked).is-open)",
            self.css,
        )
        self.assertIn("overflow: hidden;", self.css)

    def test_mobile_rule_does_not_match_docked_panel(self):
        self.assertIn(".aipm-chat:not(.aipm-chat--docked).is-open", self.css)


if __name__ == "__main__":
    unittest.main()
