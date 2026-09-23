"""缓存升级:老用户浏览器里那份旧脚本,发布之后必须换得掉。

    uv run python3 test/browser/run.py cache

一条脚本改了却没 +1 版本号,新构建的页面请求的还是同一个 `?v=`,而 Service
Worker 对带版本参数的静态资源是 **cache-first** —— 老用户会一直跑着旧脚本,新
功能在他那里等于没发布。新开一个端口看不到这个问题:那是一个全新的 origin、
一个空的缓存空间。

所以这条用例老老实实照老用户的处境来:

1. 建一份**旧构建**(改动之前那个提交的源码树),用**同一个端口**serve;
2. 一个浏览器打开它,让 Service Worker 接管,确认旧脚本**已经进了缓存**;
3. 把同一个端口的根换成**当前构建**(等于发布),在**同一个浏览器**里重新加载
   —— 服务端这时候按线上那份约定给缓存头(`harness.CACHE_CONTROL`,GitHub Pages
   钉的那个 `max-age=600`),没有哪一处把 HTTP 缓存统一关掉;
4. 断言页面这次真正执行的是新脚本的字节,而旧的那份缓存**还留在那里**
   —— 升级靠的是换 URL,不是靠清缓存;顺带断言这一下刷新**同时**把新的
   `service-worker.js` 取了回来(那一份由浏览器自己的更新通道走,不受 HTTP 缓存
   摆布,但要不要去问、什么时候问,是页面自己的事)。
"""
from __future__ import annotations

import re
import unittest

from playwright.sync_api import sync_playwright

from harness import WORK, Browser, StaticSite, assert_no_page_errors, build_site

#: 「旧」取的是把 chat-widget.js 改掉却没 +1 版本号的那个提交 —— 也就是原审查
#: 意见里复现出来的那个状态(`chat-widget.js?v=31` 一直命中旧缓存)。
OLD_REF = "e3beab55"

PAGE = "/ai/rag/"


def widget_version(site_dir) -> str:
    """这份构建的页面请求的是哪个版本号。"""
    html = (site_dir / "ai" / "rag" / "index.html").read_text(encoding="utf-8")
    found = re.search(r"chat-widget\.js\?v=(\d+)", html)
    if found is None:
        raise AssertionError(f"页面里没有 chat-widget.js 的版本参数:{site_dir}")
    return found.group(1)


class CacheUpgradeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_dir = build_site(WORK / "site-cache-old", ref=OLD_REF)
        cls.new_dir = build_site(WORK / "site-cache-new")
        cls.site = StaticSite(cls.old_dir)
        cls.pw = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.site.close()
        cls.pw.stop()

    @staticmethod
    def cached(page, needle: str):
        """缓存里命中这个片段的条目(没有则 None)。"""
        return page.evaluate(
            """async (needle) => {
                for (const name of await caches.keys()) {
                    const cache = await caches.open(name);
                    for (const req of await cache.keys()) {
                        if (req.url.includes(needle)) return req.url;
                    }
                }
                return null;
            }""",
            needle,
        )

    def test_the_widget_users_already_cached_is_replaced(self):
        old_version = widget_version(self.old_dir)
        new_version = widget_version(self.new_dir)
        self.assertGreater(
            int(new_version),
            int(old_version),
            f"chat-widget.js 改了但版本号还是 {new_version}:老用户的缓存会一直命中旧脚本",
        )

        browser = Browser(self.pw, self.site.base)
        try:
            page = browser.goto(PAGE)
            page.wait_for_function("() => navigator.serviceWorker.controller !== null")
            # 首次加载时页面还没被 SW 接管,它请求的那些资源不过 SW;再加载一次,
            # 这一遍才走 SW 的 cache-first,旧脚本这才真正进了缓存。
            page.reload(wait_until="load")
            stale = self.cached(page, f"chat-widget.js?v={old_version}")
            self.assertIsNotNone(stale, "旧脚本没有进缓存 —— 这条用例的前提不成立")

            # 同一个端口、同一个浏览器:把根换成新构建(等于发布),照常刷新
            self.site.serve(self.new_dir)
            asked = len(self.site.requests_for("/service-worker.js"))
            page.reload(wait_until="load")
            page.wait_for_function("() => window.__aipmChat !== undefined")

            # 这一下刷新把新脚本取了回来 —— SW 脚本走浏览器自己的更新通道,
            # 要不要去问是页面自己的事(主题的 registration 加载完会 update 一次)
            fetched = self.site.requests_for("/service-worker.js")[asked:]
            self.assertTrue(fetched, "刷新没有去取 service-worker.js")
            self.assertEqual(
                fetched[-1]["status"], 200, f"新脚本没取到:{fetched}"
            )

            src = page.evaluate("() => document.querySelector('script[src*=\"chat-widget.js\"]').src")
            self.assertIn(f"chat-widget.js?v={new_version}", src, "页面请求的还是旧 URL")

            loaded = page.evaluate(
                """async () => {
                    const s = document.querySelector('script[src*="chat-widget.js"]');
                    return await (await fetch(s.src)).text();
                }"""
            )
            self.assertEqual(
                loaded,
                (self.new_dir / "_static" / "js" / "chat-widget.js").read_text(encoding="utf-8"),
                "页面拿到的还是缓存里那份旧脚本",
            )

            # 换 URL 就够了,不必动缓存:旧条目原样留着。
            self.assertIsNotNone(
                self.cached(page, f"chat-widget.js?v={old_version}"),
                "旧缓存被清掉了 —— 升级不该依赖清缓存",
            )
            assert_no_page_errors(self, browser)
        finally:
            browser.close()


if __name__ == "__main__":
    unittest.main()
