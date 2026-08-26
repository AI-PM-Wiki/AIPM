"""Assert long-cache headers and service-worker cache-first contract."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NETLIFY = ROOT / "netlify.toml"
SW = ROOT / "docs" / "service-worker.js"

YEAR = "max-age=31536000"
REVALIDATE = "max-age=0, must-revalidate"


def _header_blocks(text: str) -> list[tuple[str, str]]:
    """Return (for-path, cache-control) pairs from netlify.toml [[headers]]."""
    blocks = re.split(r"\n\[\[headers\]\]\n", text)
    out: list[tuple[str, str]] = []
    for block in blocks[1:]:
        path_m = re.search(r'for = "([^"]+)"', block)
        cc_m = re.search(r'Cache-Control = "([^"]+)"', block)
        if path_m and cc_m:
            out.append((path_m.group(1), cc_m.group(1)))
    return out


class TestNetlifyCacheHeaders(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.headers = dict(_header_blocks(NETLIFY.read_text(encoding="utf-8")))

    def test_default_html_revalidates(self):
        self.assertEqual(self.headers["/*"], f"public, {REVALIDATE}")

    def test_hashed_theme_assets_are_immutable(self):
        for path in (
            "/assets/stylesheets/*",
            "/assets/javascripts/*",
            "/assets/javascripts/workers/*",
            "/assets/javascripts/lunr/*",
            "/assets/javascripts/lunr/min/*",
            "/assets/images/*",
        ):
            with self.subTest(path=path):
                self.assertEqual(
                    self.headers[path],
                    f"public, {YEAR}, immutable",
                )

    def test_unhashed_plugin_script_is_not_immutable(self):
        cc = self.headers["/assets/javascripts/toggle-sidebar.js"]
        self.assertIn("max-age=86400", cc)
        self.assertNotIn("immutable", cc)

    def test_versioned_static_is_long_cached(self):
        for path in ("/_static/css/*", "/_static/js/*"):
            with self.subTest(path=path):
                self.assertEqual(self.headers[path], f"public, {YEAR}")

    def test_service_worker_and_search_revalidate(self):
        for path in ("/service-worker.js", "/search/*"):
            with self.subTest(path=path):
                self.assertEqual(self.headers[path], f"public, {REVALIDATE}")

    def test_narrow_rules_follow_wide_rules(self):
        """Same header name: later matching rule wins. Long-cache must follow /*."""
        order = [p for p, _ in _header_blocks(NETLIFY.read_text(encoding="utf-8"))]
        self.assertEqual(order[0], "/*")
        self.assertGreater(order.index("/_static/css/*"), order.index("/*"))
        self.assertGreater(
            order.index("/assets/javascripts/toggle-sidebar.js"),
            order.index("/assets/javascripts/*"),
        )
        self.assertGreater(order.index("/service-worker.js"), order.index("/*"))


class TestServiceWorkerLongCache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = SW.read_text(encoding="utf-8")

    def test_cache_first_for_static(self):
        self.assertIn("cacheFirst", self.src)
        self.assertIn("CACHE_STATIC", self.src)
        self.assertRegex(self.src, r'CACHE_STATIC = "aipm-static-v\d+"')

    def test_does_not_intercept_own_script(self):
        self.assertIn('url.pathname === "/service-worker.js"', self.src)

    def test_takes_over_on_activate(self):
        self.assertIn("skipWaiting", self.src)
        self.assertIn("clients.claim", self.src)


if __name__ == "__main__":
    unittest.main()
