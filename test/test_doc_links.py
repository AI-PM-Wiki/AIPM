"""Guard against the broken documentation links reported by MkDocs."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / "docs" / "index.md"
CAPABILITY = ROOT / "docs" / "intro" / "capability.md"
PROJECT_MANAGEMENT = ROOT / "docs" / "pm" / "project-management.md"


class TestDocumentationLinks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = HOME.read_text(encoding="utf-8")
        cls.capability = CAPABILITY.read_text(encoding="utf-8")
        cls.project_management = PROJECT_MANAGEMENT.read_text(encoding="utf-8")

    def test_homepage_section_links_target_documented_index_pages(self):
        for section in ("pm", "ai", "practice", "tech", "job"):
            with self.subTest(section=section):
                self.assertIn(f"]({section}/index.md)", self.home)
                self.assertNotIn(f"]({section}/)", self.home)

    def test_project_management_links_to_existing_capability_heading(self):
        self.assertIn("### ② AI 系统与工程理解", self.capability)
        self.assertIn(
            "../intro/capability.md#②-ai-系统与工程理解",
            self.project_management,
        )
        self.assertNotIn(
            "../intro/capability.md#软件工程素养",
            self.project_management,
        )


if __name__ == "__main__":
    unittest.main()
