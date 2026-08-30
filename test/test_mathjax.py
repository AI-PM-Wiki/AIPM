"""Assert the MathJax loading contract used by instant navigation."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "mkdocs.yml"
HOOK = ROOT / "hooks" / "on_env.py"
MATHJAX = ROOT / "docs" / "_static" / "js" / "mathjax.js"


class TestMathJaxScripts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.hook = HOOK.read_text(encoding="utf-8")
        cls.mathjax = MATHJAX.read_text(encoding="utf-8")

    def test_config_loads_mathjax_before_chtml(self):
        config_scripts = self.config[self.config.index("extra_javascript:") :]
        mathjax = config_scripts.index("_static/js/mathjax.js")
        chtml = config_scripts.index("mathjax@3/es5/tex-chtml.js")
        self.assertLess(mathjax, chtml)

    def test_mathjax_scripts_are_not_removed_after_build(self):
        self.assertNotIn("_strip_mathjax(config)", self.hook)

    def test_navigation_typesetting_waits_for_startup(self):
        self.assertIn("MathJax.startup.promise", self.mathjax)
        startup = self.mathjax.index("MathJax.startup.promise")
        typeset = self.mathjax.index("MathJax.typesetPromise()")
        self.assertLess(startup, typeset)

    def test_document_subscription_is_guarded(self):
        self.assertRegex(
            self.mathjax,
            r'if \(typeof document\$ !== "undefined"\) \{\s*'
            r'document\$\.subscribe\(typesetMathJax\);',
        )


if __name__ == "__main__":
    unittest.main()
