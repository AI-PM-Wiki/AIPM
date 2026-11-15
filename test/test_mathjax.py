"""Assert the MathJax loading contract used by instant navigation."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "mkdocs.yml"
HOOK = ROOT / "hooks" / "on_env.py"
MATHJAX = ROOT / "docs" / "_static" / "js" / "mathjax.js"
VENDOR = ROOT / "docs" / "_static" / "js" / "vendor"
VENDOR_SCRIPT = ROOT / "scripts" / "vendor-mathjax.sh"


class TestMathJaxScripts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.hook = HOOK.read_text(encoding="utf-8")
        cls.mathjax = MATHJAX.read_text(encoding="utf-8")
        cls.version = re.search(
            r"^VERSION=(\S+)$", VENDOR_SCRIPT.read_text(encoding="utf-8"), re.MULTILINE
        ).group(1)

    def test_config_loads_mathjax_before_chtml(self):
        config_scripts = self.config[self.config.index("extra_javascript:") :]
        mathjax = config_scripts.index("_static/js/mathjax.js")
        chtml = config_scripts.index("/tex-chtml.js")
        self.assertLess(mathjax, chtml)

    def test_chtml_is_served_from_the_vendored_release(self):
        self.assertIn(f"- '_static/js/vendor/mathjax-{self.version}/tex-chtml.js'", self.config)
        self.assertEqual([path.name for path in VENDOR.glob("mathjax-*")], [f"mathjax-{self.version}"])
        release = VENDOR / f"mathjax-{self.version}"
        self.assertTrue((release / "tex-chtml.js").is_file())
        self.assertTrue((release / "LICENSE").is_file())

    def test_mathjax_scripts_are_not_removed_after_build(self):
        self.assertNotIn("_strip_mathjax(config)", self.hook)

    def test_navigation_typesetting_waits_for_startup(self):
        self.assertIn("MathJax.startup.promise", self.mathjax)
        startup = self.mathjax.index("MathJax.startup.promise")
        typeset = self.mathjax.index("MathJax.typesetPromise()")
        self.assertLess(startup, typeset)

    def test_startup_leaves_typesetting_to_the_document_subscription(self):
        self.assertRegex(self.mathjax, r"startup: \{\s*typeset: false\s*\}")

    def test_document_subscription_is_guarded(self):
        self.assertRegex(
            self.mathjax,
            r'if \(typeof document\$ !== "undefined"\) \{\s*'
            r'document\$\.subscribe\(typesetMathJax\);',
        )


if __name__ == "__main__":
    unittest.main()
