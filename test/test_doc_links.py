"""Site-wide in-repo Markdown/HTML link and heading-anchor checks."""

from __future__ import annotations

import unittest
from pathlib import Path

from scripts.doc_links import (
    DOCS_DIR,
    check_href,
    collect_problems,
    extract_hrefs,
    heading_slugs,
    resolve_target,
)


class TestExtractAndResolve(unittest.TestCase):
    def test_extracts_markdown_and_html_hrefs(self):
        text = (
            "see [a](foo.md#bar) and <a href=\"pm/\">card</a>\n"
            "http is [ext](https://example.com/x.md)\n"
        )
        hrefs = extract_hrefs(text)
        self.assertIn("foo.md#bar", hrefs)
        self.assertIn("pm/", hrefs)
        self.assertIn("https://example.com/x.md", hrefs)

    def test_ignores_links_inside_fenced_code(self):
        text = "```\n[broken](does-not-exist.md)\n```\n[ok](index.md)\n"
        self.assertEqual(extract_hrefs(text), ["index.md"])

    def test_directory_url_resolves_to_index(self):
        home = DOCS_DIR / "index.md"
        self.assertEqual(resolve_target(home, "pm/"), DOCS_DIR / "pm" / "index.md")
        self.assertEqual(
            resolve_target(home, "intro/about/"), DOCS_DIR / "intro" / "about.md"
        )

    def test_capability_heading_slug_matches_mkdocs(self):
        slugs = heading_slugs((DOCS_DIR / "intro" / "capability.md").read_text())
        self.assertIn("②-ai-系统与工程理解", slugs)
        self.assertNotIn("软件工程素养", slugs)

    def test_missing_file_and_missing_heading_are_errors(self):
        source = DOCS_DIR / "pm" / "project-management.md"
        cache: dict[Path, set[str]] = {}
        self.assertIsNone(
            check_href(
                source, "../intro/capability.md#②-ai-系统与工程理解", cache
            )
        )
        self.assertIn(
            "missing target",
            check_href(source, "../intro/nope.md", cache) or "",
        )
        self.assertIn(
            "missing heading",
            check_href(source, "../intro/capability.md#软件工程素养", cache) or "",
        )


class TestSiteWideDocLinks(unittest.TestCase):
    def test_all_in_repo_links_resolve(self):
        problems = collect_problems()
        self.assertEqual(problems, [], "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
