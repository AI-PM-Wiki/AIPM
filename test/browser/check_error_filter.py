"""异常过滤:哪些失败算这一侧的,哪些算别人的(2026-09-23)。

    uv run python3 test/browser/run.py error

一条通路里「悄悄抛了个 TypeError 但界面看起来没事」靠 `assert_no_page_errors` 现形,
而它一旦把**我们的**失败当成别人的挡下去,就什么也现不了。所以放行的依据只有出处,
并且逐条要对得上。这个文件把三件事钉在真实浏览器里:

- 一条错误的出处是**抛出它的那个脚本**(堆栈第一帧),不是消息里出现的网址 ——
  本站脚本抛出的错误里写着一个别人的地址,照旧算我们的(哪怕这句话的形状与主题
  那句一模一样);
- 主题那句 `Invalid script: <地址>` 是唯一一条「出处在我们、说的是别人」的错误,
  它靠**证据**放行:浏览器自己得报过那个地址没加载成。地址好好的、或者根本没请求过,
  这句话就是我们的问题;
- 出处拿不准(堆栈里没有帧)的,按失败计入。

顺带把 `assert_no_page_errors` 自己的两条断言钉住:声明的「弄坏的地址」必须与浏览器
实际报出来的对得上 —— 声明了却没人报,和不声明就报出来,两头都要响。
"""
from __future__ import annotations

import shutil
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

import fixtures
from harness import (
    INVALID_SCRIPT_RE,
    REASON_FOREIGN_RESOURCE,
    REASON_FOREIGN_SCRIPT,
    WORK,
    Browser,
    StaticSite,
    assert_no_page_errors,
)

#: 页面骨架。用例只替换 `__BODY__`,地址在写入时替换。
PAGE = """<!doctype html><html><head><meta charset="utf-8"></head><body>
__BODY__
</body></html>
"""

#: 别人家的脚本,一载入就抛(出处确实在别人那里)。
THROWER_JS = "throw new Error('boom from the third party');"

#: 别人家的地址,好在(用来构造「消息里那个地址其实没事」)。
FINE_JS = "window.__cdnFine = true;"


class ErrorFilterCase(unittest.TestCase):
    """一组静态素材 + 一个浏览器。整类共用,每个用例只看自己那一页。"""

    @classmethod
    def setUpClass(cls):
        cls.root = WORK / "site-errors"
        shutil.rmtree(cls.root, ignore_errors=True)
        cls.root.mkdir(parents=True)
        (cls.root / "present.png").write_bytes(fixtures.png(8, 8, 9))

        cdn_dir = WORK / "cdn-errors"
        shutil.rmtree(cdn_dir, ignore_errors=True)
        cdn_dir.mkdir(parents=True)
        (cdn_dir / "thrower.js").write_text(THROWER_JS, encoding="utf-8")
        (cdn_dir / "fine.js").write_text(FINE_JS, encoding="utf-8")
        cls.cdn = StaticSite(cdn_dir)

        #: 一台**关掉了**的服务:连它上面的地址,浏览器拿到的是连接被拒 —— 别人家的
        #: 资源「没加载成」就是这种样子,与「我们的脚本抛错」是两件事。
        dead = StaticSite(cdn_dir)
        cls.dead_base = dead.base
        dead.close()

        cls.site = StaticSite(cls.root)
        cls.pw = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.site.close()
        cls.cdn.close()
        cls.pw.stop()

    def load(self, name: str, body: str) -> Browser:
        """写一页素材并打开它,返回这个浏览器。"""
        (self.root / f"{name}.html").write_text(
            PAGE.replace("__BODY__", body), encoding="utf-8"
        )
        browser = Browser(self.pw, self.site.base, service_workers="block")
        self.addCleanup(browser.close)
        browser.goto(f"/{name}.html")
        browser.page.wait_for_timeout(700)
        return browser

    # ---- 1. 本站脚本抛错:消息里有别人的网址,也还是我们的 ----

    def test_our_own_error_quoting_a_third_party_url_is_not_filtered(self):
        """消息里出现别人的网址不是放行的理由。

        第二句故意写成主题那句 `Invalid script: <地址>` 的完整形状 —— 旧规则只认
        这句话的形状加消息里的地址,这条就会被当成「别人家的脚本没取到」放过去。"""
        quoted = "https://cdn.example.invalid/mermaid.js"
        browser = self.load(
            "quotes",
            "<script>\n"
            "  setTimeout(function () {\n"
            f"    throw new Error('Invalid script: {quoted}');\n"
            "  }, 0);\n"
            "  setTimeout(function () {\n"
            "    throw new Error('照着这个地址看:https://cdn.example.invalid/x.js');\n"
            "  }, 0);\n"
            "</script>",
        )
        errors, ignored, _ = browser.classify()

        self.assertIsNotNone(
            INVALID_SCRIPT_RE.match(f"Invalid script: {quoted}"),
            "前提不成立:这句话的形状与主题那句对不上,量不到旧规则会放行的那一条",
        )
        self.assertEqual(ignored, [], "本站脚本抛出的错误被当成别人的挡了下去")
        self.assertEqual(len(errors), 2, f"页面上本该有两条异常:{errors}")
        self.assertIn("cdn.example.invalid", " ".join(errors), "异常原文就带着别人的网址")

    def test_a_third_party_url_that_loads_fine_is_not_an_excuse(self):
        """消息里那个地址确实在别人那里、也确实请求过 —— 可它加载成功了。

        「没加载成」是要拿证据说话的:证据不在,这句话就是我们的问题。"""
        url = self.cdn.base + "/fine.js"
        browser = self.load(
            "fine",
            f'<script src="{url}"></script>\n'
            "<script>\n"
            "  setTimeout(function () {\n"
            f"    throw new Error('Invalid script: {url}');\n"
            "  }, 0);\n"
            "</script>",
        )
        browser.page.wait_for_function("() => window.__cdnFine === true")
        errors, ignored, _ = browser.classify()

        self.assertEqual(ignored, [], "地址好好的,这句话却被当成别人的资源没取到")
        self.assertEqual(len(errors), 1, f"本该只剩一条异常:{errors}")
        self.assertIn(url, errors[0])

    # ---- 2. 别人家的资源真的没加载成:连它自己的记录一起挡下 ----

    def test_a_failed_third_party_resource_and_its_notice_are_filtered(self):
        """浏览器自己报过那个地址没加载成,主题那句才有依据放行。

        两条记录都挡下,并且逐条对得上:理由只有那两种,指出的地址确实在别人那里,
        那个地址在记录原文里找得到。"""
        url = self.dead_base + "/gone.js"
        browser = self.load(
            "dead",
            f'<script src="{url}"></script>\n'
            "<script>\n"
            "  window.addEventListener('load', function () {\n"
            f"    throw new Error('Invalid script: {url}');\n"
            "  });\n"
            "</script>",
        )
        assert_no_page_errors(
            self,
            browser,
            expected_ignored=(
                (url, REASON_FOREIGN_SCRIPT),
                (url, REASON_FOREIGN_RESOURCE),
            ),
        )

    def test_a_third_party_script_that_throws_is_filtered(self):
        """出处确实在别人那里的异常:堆栈第一帧就在别人的域名上。"""
        url = self.cdn.base + "/thrower.js"
        browser = self.load("thrower", f'<script src="{url}"></script>')
        assert_no_page_errors(self, browser, expected_ignored=((url, REASON_FOREIGN_SCRIPT),))

    # ---- 3. 出处拿不准的,按失败计入 ----

    def test_origins_are_compared_strictly(self):
        """出处按「协议 + 主机 + 端口」三样比,不做字符串前缀比较。

        两个地址是前缀比较会认错的那种:一个的前半段正好是我们的 origin 再加个 `@`
        (前缀对得上、主机其实是别人的),还有相对地址、空串、`blob:` 这种说不出出处
        的 —— 它们都不是「别人的地址」,拿不准的一律不计入挡下。"""
        browser = Browser(self.pw, self.site.base, service_workers="block")
        self.addCleanup(browser.close)
        port = self.site.port

        self.assertTrue(browser.is_ours(self.site.base + "/x.js"))
        self.assertTrue(
            browser.is_foreign(f"http://127.0.0.1:{port}@evil.example/x.js"),
            "以我们的 origin 开头的地址被当成了自己的",
        )
        self.assertTrue(
            browser.is_foreign(self.cdn.base + "/fine.js"),
            "同一台机器上的另一个端口被算成了我们的",
        )
        for undecidable in ("", "/relative/x.js", "blob:http://127.0.0.1/x", f"http://127.0.0.1:{port}x/"):
            self.assertFalse(
                browser.is_foreign(undecidable),
                f"说不出出处的地址不算别人的:{undecidable!r}",
            )

    def test_an_exception_without_a_reliable_origin_counts_as_a_failure(self):
        """堆栈里没有帧就说不出出处 —— 拿不准不是放行的理由。"""
        browser = self.load(
            "nostack",
            "<script>\n"
            "  setTimeout(function () { throw { message: '没有堆栈' }; }, 0);\n"
            "  setTimeout(function () { Promise.reject('被拒的一个字符串'); }, 0);\n"
            "</script>",
        )
        errors, ignored, _ = browser.classify()

        self.assertEqual(
            [entry["throw_origin"] for entry in browser.page_errors],
            ["", ""],
            "前提不成立:这两条异常其实带得出出处,量不到「拿不准」那一支",
        )
        self.assertEqual(ignored, [], "出处拿不准的异常被当成别人的挡了下去")
        self.assertEqual(len(errors), 2, f"本该两条都计入失败:{errors}")

    # ---- 4. 声明的「弄坏的地址」必须与浏览器实际报出来的一致 ----

    def test_a_declared_broken_resource_must_actually_be_reported(self):
        """两头都要响:不声明就报出来的要响,声明了却没报出来的也要响。"""
        browser = self.load("broken", '<img src="/not-there.png" alt="一张取不到的图">')
        broken = self.site.base + "/not-there.png"

        with self.assertRaises(AssertionError):
            assert_no_page_errors(self, browser)
        assert_no_page_errors(self, browser, expected_load_failures=(broken,))

        # 反过来说:声明一个其实好好的地址,同样不成立。
        loaded = self.load("good", '<img src="/present.png" alt="一张好图">')
        with self.assertRaises(AssertionError):
            assert_no_page_errors(
                self, loaded, expected_load_failures=(self.site.base + "/present.png",)
            )


if __name__ == "__main__":
    unittest.main()
