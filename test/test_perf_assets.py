"""站点性能:静态资源压缩 + 内容哈希长效缓存 + webfont 非阻塞(issue #91)。

契约分三层:
1. 纯函数层(hooks/on_env.py):压缩自检、?v= 改写、webfont 改写;
2. 接线层:on_post_build 里「先压缩再算哈希」的顺序不能反;
3. 配置层:netlify.toml / mkdocs.yml / pyproject.toml 的相应约定。
"""

from __future__ import annotations

import gzip
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

HOOK = ROOT / "hooks" / "on_env.py"
HOOK_SRC = HOOK.read_text(encoding="utf-8")
CONFIG = ROOT / "mkdocs.yml"
NETLIFY = ROOT / "netlify.toml"
PYPROJECT = ROOT / "pyproject.toml"

from hooks.on_env import (  # noqa: E402  (导入路径依赖上面的 sys.path 处理)
    _macro_counts,
    _minify_static_assets,
    defer_webfont_link,
    rewrite_static_versions,
)

WEBFONT_URL = (
    "https://fonts.googleapis.com/css?family=Noto+Sans:400%7CJetBrains+Mono:400&display=fallback"
)


class TestStaticVersionRewrite(unittest.TestCase):
    """?v= 由产物内容哈希决定,而不是人工 bump 的版本号。"""

    VERSIONS = {"_static/js/a.js": "deadbeef", "_static/css/b.css": "cafe1234"}

    def test_replaces_manual_version_with_content_hash(self):
        html = '<script src="_static/js/a.js?v=24"></script>'
        out, n = rewrite_static_versions(html, self.VERSIONS)
        self.assertEqual(out, '<script src="_static/js/a.js?v=deadbeef"></script>')
        self.assertEqual(n, 1)

    def test_keeps_relative_prefix_used_by_nested_pages(self):
        html = '<link href="../../_static/css/b.css?v=40">'
        out, n = rewrite_static_versions(html, self.VERSIONS)
        self.assertEqual(out, '<link href="../../_static/css/b.css?v=cafe1234">')
        self.assertEqual(n, 1)

    def test_keeps_absolute_prefix_used_by_static_templates(self):
        """404.html 是静态模板,引用写成绝对路径 /_static/...;漏掉它那页会吃旧缓存。"""
        html = '<link href="/_static/css/b.css?v=40">'
        out, n = rewrite_static_versions(html, self.VERSIONS)
        self.assertEqual(out, '<link href="/_static/css/b.css?v=cafe1234">')
        self.assertEqual(n, 1)

    def test_adds_version_when_reference_has_none(self):
        """netlify.toml 给 /_static/** 一年缓存,漏了 ?v= 就会被钉住一年。"""
        out, n = rewrite_static_versions('<script src="_static/js/a.js"></script>', self.VERSIONS)
        self.assertEqual(out, '<script src="_static/js/a.js?v=deadbeef"></script>')
        self.assertEqual(n, 1)

    def test_leaves_prose_and_unknown_files_untouched(self):
        html = '<p>源码在 _static/js/a.js 里</p><script src="_static/js/gone.js?v=1"></script>'
        out, n = rewrite_static_versions(html, self.VERSIONS)
        self.assertEqual(out, html)
        self.assertEqual(n, 0)

    def test_is_idempotent(self):
        html = '<script src="_static/js/a.js?v=24"></script>'
        once, _ = rewrite_static_versions(html, self.VERSIONS)
        twice, _ = rewrite_static_versions(once, self.VERSIONS)
        self.assertEqual(once, twice)


class TestWebfontDefer(unittest.TestCase):
    """Google Fonts 样式表不再阻塞首屏;webfont 本身照常加载。"""

    HTML = (
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        f'<link rel="stylesheet" href="{WEBFONT_URL}">'
    )

    def test_link_becomes_non_blocking_with_noscript_fallback(self):
        out, n = defer_webfont_link(self.HTML)
        self.assertEqual(n, 1)
        self.assertIn(f'<link rel="preload" as="style" href="{WEBFONT_URL}">', out)
        self.assertIn(f'media="print" onload="this.media=\'all\'"', out)
        self.assertIn(f'<noscript><link rel="stylesheet" href="{WEBFONT_URL}"></noscript>', out)
        # 原来的阻塞式引用必须消失,否则等于没改
        self.assertNotIn(f'<link rel="stylesheet" href="{WEBFONT_URL}">', out.replace(
            f'<noscript><link rel="stylesheet" href="{WEBFONT_URL}"></noscript>', ""
        ))

    def test_is_idempotent(self):
        once, _ = defer_webfont_link(self.HTML)
        twice, n = defer_webfont_link(once)
        self.assertEqual(once, twice)
        self.assertEqual(n, 0)

    def test_other_stylesheets_are_untouched(self):
        html = '<link rel="stylesheet" href="_static/css/extra.css?v=40">'
        out, n = defer_webfont_link(html)
        self.assertEqual(out, html)
        self.assertEqual(n, 0)


class TestMinifyGuards(unittest.TestCase):
    """压缩器自检:结构不变量是「压坏了就保留原文件」的判据。"""

    def test_css_macro_counts_detect_structure_loss(self):
        full = "@media (a){.x{color:red}}@keyframes k{from{opacity:0}}a{background:url(u.png)}"
        self.assertNotEqual(_macro_counts(full), _macro_counts("@media (a){.x{color:red}}"))

    def test_css_macro_counts_ignore_whitespace_and_comments(self):
        self.assertEqual(
            _macro_counts("/* c */\n.x { color : red ; }"),
            _macro_counts(".x{color:red}"),
        )

    def test_css_minifier_preserves_structure_and_drops_comments(self):
        from rcssmin import cssmin

        source = "/* 注释 */\n@media (max-width:640px){.a{color:red}}\n"
        out = cssmin(source)
        self.assertEqual(_macro_counts(source), _macro_counts(out))
        self.assertNotIn("注释", out)

    def test_js_minifier_drops_comments_and_keeps_tokens(self):
        from rjsmin import jsmin

        source = "// 注释\nfunction f(a) { return a + 1; } /* x */\n"
        out = jsmin(source)
        self.assertNotIn("注释", out)
        self.assertIn("function f(a)", out)
        self.assertIn("return a+1", out)


class TestMinifyStaticAssets(unittest.TestCase):
    """就地压缩 site/_static,并且只动该动的文件。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        static = self.site / "_static"
        (static / "css").mkdir(parents=True)
        (static / "js").mkdir(parents=True)
        self.css = static / "css" / "x.css"
        self.js = static / "js" / "x.js"
        self.css.write_text("/* 注释 */\n.a { color : red ; }\n", encoding="utf-8")
        self.js.write_text("// 注释\nvar a = 1;\n", encoding="utf-8")
        self.other = self.site / "index.html"
        self.other.write_text("<html><!-- keep --></html>", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_minifies_css_and_js_in_place(self):
        _minify_static_assets({"site_dir": str(self.site)})
        css = self.css.read_text(encoding="utf-8")
        js = self.js.read_text(encoding="utf-8")
        self.assertNotIn("注释", css)
        self.assertNotIn("注释", js)
        self.assertLess(len(css), len("/* 注释 */\n.a { color : red ; }\n"))

    def test_leaves_non_static_files_alone(self):
        _minify_static_assets({"site_dir": str(self.site)})
        self.assertEqual(self.other.read_text(encoding="utf-8"), "<html><!-- keep --></html>")

    def test_missing_site_dir_is_not_fatal(self):
        _minify_static_assets({"site_dir": str(self.tmp / "nope")})


class TestPostBuildWiring(unittest.TestCase):
    """接线契约:压缩必须在算哈希之前,否则哈希对不上最终字节。"""

    def test_hook_calls_minify_before_optimize(self):
        body = HOOK_SRC[HOOK_SRC.index("def on_post_build("):]
        self.assertIn("_minify_static_assets(config)", body)
        self.assertIn("_optimize_pages(config)", body)
        self.assertLess(
            body.index("_minify_static_assets(config)"),
            body.index("_optimize_pages(config)"),
        )

    def test_walks_every_built_html_not_just_pages(self):
        """静态模板(404.html)不在 _iter_built_pages 里,必须按目录遍历才不漏。"""
        self.assertIn("def _iter_built_html(", HOOK_SRC)
        optimize = HOOK_SRC[HOOK_SRC.index("def _optimize_pages("):]
        self.assertIn("_iter_built_html(config)", optimize)

    def test_hash_is_taken_from_final_bytes(self):
        fn = HOOK_SRC[HOOK_SRC.index("def _static_version_map("):HOOK_SRC.index("def rewrite_static_versions(")]
        self.assertIn("sha256", fn)
        self.assertIn('"rb"', fn)


class TestPerfConfigContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.netlify = NETLIFY.read_text(encoding="utf-8")
        cls.pyproject = PYPROJECT.read_text(encoding="utf-8")

    def test_navigation_prune_enabled(self):
        features = self.config[self.config.index("  features:"):self.config.index("  font:")]
        self.assertIn("- navigation.prune", features)

    def test_minifiers_are_pinned_dependencies(self):
        for name, version in (("rcssmin", "1.2.2"), ("rjsmin", "1.2.5")):
            with self.subTest(dep=name):
                self.assertIn(f'"{name}=={version}"', self.pyproject)

    def test_static_rules_stay_long_lived(self):
        """内容哈希是 _static 敢标一年缓存的前提,别把规则收短。"""
        for path in ("/_static/css/*", "/_static/js/*"):
            block = self._block(path)
            self.assertIn("max-age=31536000", block)

    def _block(self, path: str) -> str:
        blocks = re.split(r"\n\[\[headers\]\]\n", self.netlify)
        for block in blocks:
            if f'for = "{path}"' in block:
                return block
        raise AssertionError(f"no [[headers]] block for {path}")


class TestCompressionIsReal(unittest.TestCase):
    """实测口径固化:压缩后 gzip 体积必须真的下降,防止哪天悄悄失效。"""

    def test_committed_static_assets_shrink_under_minification(self):
        try:
            from rcssmin import cssmin
            from rjsmin import jsmin
        except ImportError:  # pragma: no cover - 依赖缺失时跳过
            self.skipTest("rcssmin/rjsmin 未安装")

        total_before = total_after = 0
        for path in sorted((ROOT / "docs" / "_static").rglob("*")):
            if path.suffix not in (".css", ".js"):
                continue
            source = path.read_text(encoding="utf-8")
            minified = cssmin(source) if path.suffix == ".css" else jsmin(source)
            total_before += len(gzip.compress(source.encode(), 9))
            total_after += len(gzip.compress(minified.encode(), 9))

        self.assertGreater(total_before, 0)
        self.assertLess(total_after, total_before * 0.7)


if __name__ == "__main__":
    unittest.main()
