"""异常过滤:哪些失败算这一侧的,哪些算别人的(2026-09-23)。

    uv run python3 test/browser/run.py error

一条通路里「悄悄抛了个 TypeError 但界面看起来没事」靠 `assert_no_page_errors` 现形,
而它一旦把**我们的**失败当成别人的挡下去,就什么也现不了。所以放行的依据只有出处,
并且逐条要对得上。这个文件把四件事钉在真实浏览器里:

- 一条错误的出处是**抛出它的那个脚本**(堆栈第一帧),不是消息里出现的网址 ——
  本站脚本抛出的错误里写着一个别人的地址,照旧算我们的(哪怕这句话的形状与主题
  那句一模一样、那个地址也确实没加载成);
- 主题那句 `Invalid script: <地址>` 要三样同时成立才放行:抛出位置在**主题自己的
  脚本**里(见 `harness.THEME_SCRIPT_PREFIX`)、消息里那个地址确实在别人那里、
  浏览器自己报过它没加载成。少一样就是我们的问题;
- 出处拿不准(堆栈里没有帧)的,按失败计入;
- 主题那几份脚本的位置不是猜的:真站点拦掉主题取 mermaid 的那个 CDN,主题的
  bundle 真的在那里抛出这句话(`ThemeHintOnTheRealSiteCase`)。

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
    LOAD_FAILURE_PREFIX,
    REASON_FOREIGN_RESOURCE,
    REASON_FOREIGN_SCRIPT,
    REASON_THEME_HINT,
    THEME_SCRIPT_PREFIX,
    WORK,
    Browser,
    StaticSite,
    assert_no_page_errors,
    build_site,
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

#: 主题那几份脚本的位置上的一份脚本,它抛主题那句 `Invalid script: <地址>`。
#: 抛出位置与主题的 bundle 同在一处,量的是「位置在主题脚本里」这一支;真 bundle
#: 自己抛的那一条在 `ThemeHintOnTheRealSiteCase`。
THEME_PROBE = THEME_SCRIPT_PREFIX.lstrip("/") + "probe-bundle.js"

#: 主题那句提示说的是**这个**地址:主题取 mermaid 的那个 CDN(见 mkdocs-material 的
#: components/content/mermaid)。
MERMAID_CDN = "https://unpkg.com/mermaid@11/dist/mermaid.min.js"

#: 正文里只有一张 mermaid 图的一页 —— 拦掉主题那个 CDN 之后,主题只为这一张图抛
#: 这句话,页面上的噪声因此最少。
HINT_PAGE = "/ai/jargon/"


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

    def theme_probe(self, quoted: str) -> str:
        """往主题那几份脚本的位置上放一份脚本,它在页面 load 之后抛主题那句话。

        抛在**这份文件自己的帧**里 —— 与主题的 bundle 抛这句话时在同一个位置。"""
        target = self.root / THEME_PROBE
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            "window.addEventListener('load', function () {\n"
            f"  throw new Error('Invalid script: {quoted}');\n"
            "});\n",
            encoding="utf-8",
        )
        return "/" + THEME_PROBE

    # ---- 1. 本站脚本抛错:消息里有别人的网址,也还是我们的 ----

    def test_our_own_error_quoting_a_third_party_url_is_not_filtered(self):
        """消息里出现别人的网址不是放行的理由。

        第二句故意写成主题那句 `Invalid script: <地址>` 的完整形状 —— 只认这句话的
        形状加消息里的那个地址,这条就会被当成「别人家的脚本没取到」放过去。"""
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
            "前提不成立:这句话的形状与主题那句对不上,量不到那句形状本身会放行的那一条",
        )
        self.assertEqual(ignored, [], "本站脚本抛出的错误被当成别人的挡了下去")
        self.assertEqual(len(errors), 2, f"页面上本该有两条异常:{errors}")
        self.assertIn("cdn.example.invalid", " ".join(errors), "异常原文就带着别人的网址")

    def test_a_third_party_url_that_loads_fine_is_not_an_excuse(self):
        """消息里那个地址确实在别人那里、也确实请求过 —— 可它加载成功了。

        抛出位置在页面自己这一侧、证据也不在:两条放行的依据都不成立,这句话就是
        我们的问题。"""
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

    # ---- 2. 本站脚本抛的这句话 + 别人家的资源真的没加载成 ----

    def test_a_page_error_quoting_a_failed_third_party_resource_is_not_filtered(self):
        """组合场景:那个地址真的请求了、真的没加载成,而这句话是**本站脚本**抛的。

        证据齐了也不算别人的 —— 一条被挡下的记录必须指得出一个第三方的**抛出位置**
        或者一个第三方的资源记录。本站脚本抛出的这句话两样都不是,它一旦被放行,
        页面上真实的失败就藏起来了。"""
        url = self.dead_base + "/gone.js"
        browser = self.load(
            "combination",
            f'<script src="{url}"></script>\n'
            "<script>\n"
            "  window.addEventListener('load', function () {\n"
            f"    throw new Error('Invalid script: {url}');\n"
            "  });\n"
            "</script>",
        )

        self.assertTrue(
            any(entry["url"] == url for entry in browser.console_errors),
            "前提不成立:浏览器没有报过那个地址没加载成,量不到「证据齐了却仍算我们的」",
        )
        self.assertEqual(len(browser.page_errors), 1, f"前提不成立:{browser.page_errors}")
        errors, ignored, _ = browser.classify()

        # 浏览器自己那条记录照旧挡下(第三方的资源记录)……
        self.assertEqual(
            [(entry["origin"], entry["reason"]) for entry in ignored],
            [(url, REASON_FOREIGN_RESOURCE)],
            f"被挡下的记录与预期对不上:{ignored}",
        )
        # ……这句话本身算失败。
        self.assertEqual(len(errors), 1, f"本站脚本抛的这句话被当成别人的挡了下去:{errors}")
        self.assertIn(url, errors[0])

    # ---- 3. 主题脚本位置上的那句话:三样齐了才放行 ----

    def test_a_theme_script_hint_about_a_failed_third_party_resource_is_filtered(self):
        """抛出位置在主题那几份脚本里、地址在别人那里、浏览器报过它没加载成。

        两条记录都挡下,并且逐条对得上:理由各自是什么、指出的地址确实在别人那里、
        那个地址在记录原文里找得到。"""
        url = self.dead_base + "/gone.js"
        probe = self.theme_probe(url)
        browser = self.load("hint", f'<script src="{url}"></script>\n<script src="{probe}"></script>')
        assert_no_page_errors(
            self,
            browser,
            expected_ignored=(
                (url, REASON_THEME_HINT),
                (url, REASON_FOREIGN_RESOURCE),
            ),
        )

    def test_a_theme_script_hint_without_a_load_failure_is_not_an_excuse(self):
        """位置对了,可那个地址好好的 —— 证据不在,这句话还是我们的问题。"""
        url = self.cdn.base + "/fine.js"
        probe = self.theme_probe(url)
        browser = self.load(
            "hint-without-evidence",
            f'<script src="{url}"></script>\n<script src="{probe}"></script>',
        )
        browser.page.wait_for_function("() => window.__cdnFine === true")
        errors, ignored, _ = browser.classify()

        self.assertEqual(ignored, [], "地址好好的,这句话却被当成别人的加载提示挡下")
        self.assertEqual(len(errors), 1, f"本该只剩一条异常:{errors}")
        self.assertIn(url, errors[0])

    # ---- 4. 别人家的脚本抛错:出处确实在别人那里 ----

    def test_a_third_party_script_that_throws_is_filtered(self):
        """出处确实在别人那里的异常:堆栈第一帧就在别人的域名上。"""
        url = self.cdn.base + "/thrower.js"
        browser = self.load("thrower", f'<script src="{url}"></script>')
        assert_no_page_errors(self, browser, expected_ignored=((url, REASON_FOREIGN_SCRIPT),))

    # ---- 5. 出处拿不准的,按失败计入 ----

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

    # ---- 6. 声明的「弄坏的地址」必须与浏览器实际报出来的一致 ----

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


class ThemeHintOnTheRealSiteCase(unittest.TestCase):
    """主题那句提示真的出自主题自己的 bundle —— 真站点、真 CDN 拦下来对着看。

    上面那些用例里的抛出位置是照着规则摆出来的;这一条量的是规则里的那个位置
    确实是主题脚本:`/assets/javascripts/` 那一份真 bundle 取不到 mermaid 的 CDN
    时,堆栈第一帧就在它上面,这句话才被放行。位置要是猜错了,这里立刻响。"""

    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(build_site(WORK / "site-hint"))
        cls.pw = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.site.close()
        cls.pw.stop()

    def test_the_theme_hint_is_thrown_by_the_theme_bundle(self):
        browser = Browser(self.pw, self.site.base, service_workers="block")
        self.addCleanup(browser.close)
        browser.page.route("**/unpkg.com/**", lambda route: route.abort())
        browser.goto(HINT_PAGE)
        browser.page.wait_for_timeout(2500)

        self.assertTrue(browser.page_errors, "主题没有抛那句提示 —— 前提不成立")
        for entry in browser.page_errors:
            self.assertEqual(entry["named_url"], MERMAID_CDN, f"这句话说的不是那个 CDN:{entry}")
            self.assertTrue(
                browser.is_theme_script(entry["throw_origin"]),
                f"这句话的抛出位置不在主题自己的脚本里:{entry['throw_origin']}",
            )
        self.assertTrue(
            any(
                entry["url"] == MERMAID_CDN and entry["text"].startswith(LOAD_FAILURE_PREFIX)
                for entry in browser.console_errors
            ),
            "浏览器没有报过那个 CDN 没加载成 —— 前提不成立",
        )

        errors, ignored, _ = browser.classify()
        self.assertEqual(errors, [], f"主题那句提示被当成了我们的失败:{errors}")
        self.assertEqual(
            [(entry["origin"], entry["reason"]) for entry in ignored if not browser.is_ambient(entry["origin"])],
            [(MERMAID_CDN, REASON_THEME_HINT)] * len(browser.page_errors)
            + [(MERMAID_CDN, REASON_FOREIGN_RESOURCE)],
            f"挡下来的记录与预期对不上:{ignored}",
        )


if __name__ == "__main__":
    unittest.main()
