"""图表语境的真实浏览器用例(2026-09-23)。

    uv run python3 test/browser/run.py

跑的是完整一条路:真站点(mkdocs build 出来的那份)、真浏览器、真 agent-server、
假模型 API。假 API 把收到的请求体抄下来,于是「在正文里点一下某张图的问助手」
与「模型收到了什么」是同一次运行里可以对着看的两端。

覆盖原审查意见里的每一条:

- **位图送的是图像本身**,并且**模型确实收到了**那张图(第一条,整条链路走完);
- 取图的三道限制:**来源**(跨域不取,同源地址重定向到跨域也不取)、**类型**(按字节
  认,不看服务器说的)、**体积**(超过上限不取,而且是在**读的过程中**停 —— 超限的
  响应就地取消,不把整份拉进内存);
- mermaid 源码在渲染替换掉它之前收下来,收的是**逐字节相同**的那份源码;
- 同源 SVG 取不到时回落到替代文本;
- 不可信的 SVG 不执行 —— 同一份载荷,innerHTML 那条路是活的,取源那条路是死的;
- 「仅本机」那条边界对带图像的图表同样成立;
- 配额写满降级之后,重新生成按存下来的那份语境重发;
- 模型不收图时,用户看到的是一句能照着做的话,而不是上游的报错原文。
"""
from __future__ import annotations

import base64
import re
import time
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

import fixtures
from harness import ROOT, WORK, AgentServer, Browser, StaticSite, StubModel, build_site

RAG_PAGE = "/ai/rag/"
SITE_IMG = ROOT / "docs" / "job" / "jd-breakdowns" / "images" / "bytedance_developer_ai_pm_jd_01.png"

#: 「读不完」的两份响应各有多大。要远超任何合理的读取上限,才量得出「读的过程中
#: 有没有停」—— 上限之内的正常图走的是另一条用例。
OVERSIZED_TOTAL = 32 * 1024 * 1024


def mermaid_blocks(markdown: Path) -> list[str]:
    """markdown 里的 mermaid 源码块,按出现顺序。"""
    return re.findall(r"```mermaid\n(.*?)```", markdown.read_text(encoding="utf-8"), flags=re.S)


class ChartContextFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(build_site(WORK / "site-flow"))
        # 跨域那一台**加 CORS 头**:不加的话,挡住「同源重定向到跨域资源」那一步的是
        # CORS 自己,被测的那道来源判断就轮不到 —— 用例必须让跨域那一侧真的放行。
        cls.probe = StaticSite(cls.site.root / "probe", cors=True)
        cls._write_fixtures()
        cls.model = StubModel()
        cls.server = AgentServer(cls.site, cls.model)
        cls.pw = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.server.close()
        cls.model.close()
        cls.probe.close()
        cls.site.close()
        cls.pw.stop()

    @classmethod
    def _write_fixtures(cls) -> None:
        site = cls.site
        # 真实正文里就有的那张 PNG:用例拿它的字节与线上发出去的 base64 对
        site.write("probe/real.png", SITE_IMG.read_bytes())
        site.write("probe/small.png", fixtures.png(8, 8, 1))
        site.write("probe/big.png", fixtures.png(640, 640, 2))
        site.write("probe/not-an-image.png", fixtures.NOT_AN_IMAGE, "text/html")
        site.write("probe/mislabelled.png", fixtures.NOT_AN_IMAGE, "image/png")
        site.write("probe/payload.svg", fixtures.PAYLOAD_SVG)
        site.write("probe/plain.svg", fixtures.PLAIN_SVG)
        # 跨域那一张:另一台静态服务,只放这一个文件
        cls.probe.write("far.png", fixtures.png(8, 8, 3))
        cls.probe.write("far.svg", fixtures.PLAIN_SVG, "image/svg+xml")
        # 同源地址 → 跨域地址的 302。两个都在站内路径上,来源那一关按地址判是过得去的。
        cls.redirect_png = site.redirect("probe/redirect-to-far.png", f"{cls.probe.base}/far.png")
        cls.redirect_svg = site.redirect("probe/redirect-to-far.svg", f"{cls.probe.base}/far.svg")
        # 读不完的两份:取源那一步拿到的是超大字节,页面上的 <img> 自己那次加载拿到
        # 一张正常的图(按钮所在的容器要靠它量出尺寸)。
        cls.huge_png = site.stream(
            "probe/huge.png",
            fixtures.oversized(b"\x89PNG\r\n\x1a\n", OVERSIZED_TOTAL),
            fixtures.png(8, 8, 5),
            "image/png",
        )
        cls.huge_svg = site.stream(
            "probe/huge.svg",
            fixtures.oversized(b'<svg xmlns="http://www.w3.org/2000/svg">', OVERSIZED_TOTAL),
            fixtures.PLAIN_SVG,
            "image/svg+xml",
        )

    def setUp(self):
        # 假模型 API 整类共用一份记录,每个用例只看自己这一段
        self.model_seen = len(self.model.messages())
        # Service Worker 关掉:站点那个是**按地址**的 cache-first,而「读取过程限额」
        # 那两条用例故意让同一个地址先是页面自己那次加载、再是取源那次请求 —— SW 会把
        # 第二次挡回第一次的响应,两份内容根本到不了服务端,量不出取源读了多少。
        # SW 自己的行为由 check_cache_upgrade.py 单独覆盖。
        self.browser = Browser(self.pw, self.site.base, service_workers="block")
        self.page = self.browser.goto(RAG_PAGE)
        self.page.wait_for_function("() => window.__aipmChat && window.__aipmContext")

    def tearDown(self):
        self.browser.close()

    def model_requests(self) -> list[dict]:
        """本用例这一段时间里发到模型那一侧的请求。"""
        return self.model.messages()[self.model_seen :]

    # ---- 手上这几件工具 ----

    def inject(self, tag: str, src: str, alt: str = "") -> None:
        """往正文里塞一张图 —— 站点正文目前只有 mermaid,位图与 SVG 这两条路要
        用真图来驱动。"""
        self.page.evaluate(
            """(spec) => {
                const host = document.querySelector('.md-content__inner');
                const p = document.createElement('p');
                const img = document.createElement('img');
                img.src = spec.src;
                img.alt = spec.alt;
                img.setAttribute('data-probe', spec.tag);
                p.appendChild(img);
                host.appendChild(p);
            }""",
            {"tag": tag, "src": src, "alt": alt},
        )
        self.ask_button(tag).wait_for(state="visible")

    def ask_button(self, tag: str):
        return self.ask_box(tag).locator("button.aipm-chart__ask")

    def ask_box(self, tag: str):
        return self.page.locator("div.aipm-chart").filter(
            has=self.page.locator(f'img[data-probe="{tag}"]')
        )

    def ask(self, tag: str) -> None:
        """点这张图的「问助手」。

        先悬停再点 —— 按钮平时是 `opacity: 0; pointer-events: none`,只在悬停这张图
        时现形可点(触摸设备上例外,见 chart-context.css)。真实用户也是这样点的,
        用例照做,不绕过命中测试。"""
        box = self.ask_box(tag)
        box.hover()
        box.locator("button.aipm-chart__ask").click()

    def chips(self) -> list[str]:
        return self.page.locator(".aipm-chat__ctx-text").all_inner_texts()

    def wait_chips(self, count: int) -> None:
        self.page.wait_for_function(
            "(n) => document.querySelectorAll('.aipm-chat__ctx-text').length === n", arg=count
        )

    def send(self, text: str) -> dict:
        """发一句问话,等这一轮跑完,返回这一轮的请求体。"""
        before = len(self.browser.chat_bodies)
        self.page.fill(".aipm-chat__input", text)
        self.page.click(".aipm-chat__send")
        self.page.wait_for_function("() => !document.querySelector('.aipm-chat__send').classList.contains('is-stop')")
        self.assertGreater(len(self.browser.chat_bodies), before, "没有发出 /api/chat 请求")
        return self.browser.chat_bodies[-1]

    def image_cap(self) -> int:
        """取源那一步的字节上限,取自页面上的同一份常量 —— 用例里不另抄一个数。"""
        return self.page.evaluate("() => window.__aipmContext.IMAGE_MAX_BYTES")

    def settled_bytes(self, path: str) -> int:
        """等到服务端给这条「读不完」的响应一个结果,返回取源实际读走的字节数。

        服务端要么把整份写完(超限的字节全被拉进了内存 —— 那正是要抓的),要么在
        中途被客户端断掉。两种都会留下记录,等到记录出现即可判定。"""
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if path in self.site.stream_written:
                break
            time.sleep(0.05)
        else:
            self.fail(f"服务端 15 秒内没有给 {path} 一个结果(连接既没读完也没断开)")
        return self.site.bytes_read_by_fetch(path)

    @staticmethod
    def images_in(body: dict) -> list[dict]:
        """一条模型请求里带过来的图像块。"""
        out = []
        for message in body.get("messages", []):
            content = message.get("content")
            if isinstance(content, list):
                out.extend(b for b in content if b.get("type") == "image")
        return out

    # ---- 1. 位图:图像本身,一路到模型 ----

    def test_bitmap_reaches_the_model(self):
        payload = SITE_IMG.read_bytes()
        self.inject("real", "/probe/real.png", "字节跳动的开发者 AI 产品经理 JD 截图")
        self.ask("real")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["字节跳动的开发者 AI 产品经理 JD 截图"])

        wire = self.send("这张图里写了什么?")
        self.assertEqual(len(wire["context"]), 1)
        item = wire["context"][0]
        self.assertEqual(item["kind"], "chart")
        self.assertEqual(item["chart"], "image")
        self.assertEqual(item["mediaType"], "image/png")
        self.assertEqual(
            item["imageData"],
            base64.b64encode(payload).decode("ascii"),
            "发出去的 base64 与磁盘上那张图的字节对不上",
        )
        self.assertEqual(item["source"], "字节跳动的开发者 AI 产品经理 JD 截图")
        self.assertEqual(item["visibility"], "public")

        # 后端那一侧:模型收到的请求里确实有这条图像,字节一字不差。
        requests = self.model_requests()
        self.assertEqual(len(requests), 1, f"预期一轮模型调用,实际 {len(requests)} 轮")
        images = self.images_in(requests[0]["body"])
        self.assertEqual(len(images), 1, "模型收到的请求里没有图像块")
        self.assertEqual(images[0]["source"]["type"], "base64")
        self.assertEqual(images[0]["source"]["media_type"], "image/png")
        self.assertEqual(images[0]["source"]["data"], item["imageData"])

        text = "\n".join(
            block.get("text", "")
            for message in requests[0]["body"]["messages"]
            if isinstance(message.get("content"), list)
            for block in message["content"]
            if block.get("type") == "text"
        )
        self.assertIn("位图(图像本身随本消息一起送过来)", text)
        self.assertIn("图像: 本消息附带的第 1 张图", text)
        self.assertIn("这张图里写了什么?", text)
        self.assertEqual(self.browser.errors, [], f"页面上有异常:{self.browser.errors}")

    # ---- 2. 三道限制:来源、类型、体积 ----

    def test_source_type_and_size_limits_keep_the_image_out(self):
        self.inject("far", f"{self.probe.base}/far.png", "跨域的一张图")
        self.inject("wrongtype", "/probe/not-an-image.png", "名字像图、内容不是图")
        self.inject("toobig", "/probe/big.png", "一张超过上限的大图")

        self.ask("far")
        self.wait_chips(1)
        self.ask("wrongtype")
        self.wait_chips(2)
        self.ask("toobig")
        self.wait_chips(3)

        wire = self.send("这三张图分别是什么?")
        items = wire["context"]
        self.assertEqual(len(items), 3)

        for item, expected_source in zip(
            items,
            ["跨域的一张图", "名字像图、内容不是图", "一张超过上限的大图"],
        ):
            self.assertEqual(item["chart"], "image")
            self.assertEqual(item["source"], expected_source, "取不到图像时留下的应当是替代文本")
            self.assertEqual(item["mediaType"], "", f"{expected_source}:媒体类型不该有")
            self.assertEqual(item["imageData"], "", f"{expected_source}:图像内容不该有")

        requests = self.model_requests()
        self.assertEqual(len(requests), 1)
        self.assertEqual(self.images_in(requests[0]["body"]), [], "三道限制都没挡住图像")
        self.assertEqual(self.browser.errors, [], f"页面上有异常:{self.browser.errors}")

    def test_mislabelled_type_is_caught_by_the_bytes(self):
        """服务器说它是 image/png,字节说它不是 —— 认的必须是字节。"""
        self.inject("mislabelled", "/probe/mislabelled.png", "挂着 png 名字的 HTML")
        self.ask("mislabelled")
        self.wait_chips(1)

        wire = self.send("这张图里写了什么?")
        item = wire["context"][0]
        self.assertEqual(item["imageData"], "", "服务器说是什么就信什么,字节那一关形同虚设")
        self.assertEqual(item["source"], "挂着 png 名字的 HTML")
        self.assertEqual(self.images_in(self.model_requests()[0]["body"]), [])

    # ---- 2b. 来源那一道要挡住重定向 ----

    def test_same_origin_address_redirecting_cross_origin_is_not_read(self):
        """站内路径回一个 302 指向跨域:跟过去读到的就不是「读者正在看的这一页」。

        跨域那一侧**真的放行 CORS**(probe 服务带 `Access-Control-Allow-Origin: *`),
        所以挡住这一步的只能是取源自己的来源判断 —— 换成一台不放行的服务器,红的
        原因就变成 CORS,量不出这道判断在不在。"""
        self.inject("redirect", self.redirect_png, "一个重定向到跨域的地址")
        self.ask("redirect")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一个重定向到跨域的地址"])

        wire = self.send("这张图里写了什么?")
        item = wire["context"][0]
        self.assertEqual(item["mediaType"], "", "跨域那张图的类型")
        self.assertEqual(item["imageData"], "", "跨域那张图的字节进了请求体")
        self.assertEqual(self.images_in(self.model_requests()[0]["body"]), [])

    def test_same_origin_svg_redirecting_cross_origin_is_not_read(self):
        """SVG 那条路同样按来源判:重定向之后的字符不是这张图的字。"""
        self.inject("redirectsvg", self.redirect_svg, "一个重定向到跨域的 SVG 地址")
        self.ask("redirectsvg")
        self.wait_chips(1)
        self.assertEqual(
            self.chips(),
            ["一个重定向到跨域的 SVG 地址"],
            "读到的字来自重定向之后的那份文件",
        )

    # ---- 2c. 体积那一道要在读的过程中停 ----

    def test_oversized_bitmap_is_cancelled_mid_read(self):
        """超限的响应要就地取消,而不是先整份读进内存再丢掉。"""
        self.inject("huge", self.huge_png, "一份读不完的位图")
        self.ask("huge")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份读不完的位图"])

        read = self.settled_bytes(self.huge_png)
        self.assertGreaterEqual(
            read, self.image_cap(), "取源没读起来,这个数说明不了「读的过程中停」"
        )
        self.assertLess(
            read,
            OVERSIZED_TOTAL // 4,
            f"整份 {OVERSIZED_TOTAL} 字节的响应被读进了内存,读了 {read} 字节",
        )
        self.assertTrue(self.site.was_cancelled(self.huge_png), "超限的响应没有被取消")

        wire = self.send("这张图里写了什么?")
        item = wire["context"][0]
        self.assertEqual(item["mediaType"], "")
        self.assertEqual(item["imageData"], "")

    def test_oversized_svg_is_cancelled_mid_read(self):
        """SVG 与位图同一个上限,同样读的过程中停。"""
        self.inject("hugesvg", self.huge_svg, "一份读不完的 SVG")
        self.ask("hugesvg")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份读不完的 SVG"])

        read = self.settled_bytes(self.huge_svg)
        self.assertGreaterEqual(
            read, self.image_cap(), "取源没读起来,这个数说明不了「读的过程中停」"
        )
        self.assertLess(
            read,
            OVERSIZED_TOTAL // 4,
            f"整份 {OVERSIZED_TOTAL} 字节的 SVG 被读进了内存,读了 {read} 字节",
        )
        self.assertTrue(self.site.was_cancelled(self.huge_svg), "超限的响应没有被取消")

    # ---- 3. mermaid:渲染替换之前收下源码 ----

    def test_mermaid_source_is_captured_byte_for_byte(self):
        expected = mermaid_blocks(ROOT / "docs" / "ai" / "rag.md")[0]

        box = self.page.locator("div.aipm-chart").filter(has=self.page.locator("div.mermaid")).first
        box.hover()
        box.locator("button.aipm-chart__ask").click()
        self.wait_chips(1)

        wire = self.send("这张图画的是什么?")
        item = wire["context"][0]
        self.assertEqual(item["chart"], "mermaid")
        self.assertEqual(item["source"], expected.strip(), "收下来的源码与 markdown 里那一块对不上")
        self.assertEqual(item["mediaType"], "")

        requests = self.model_requests()
        self.assertEqual(self.images_in(requests[0]["body"]), [], "mermaid 走的是文字那条路")
        self.assertEqual(self.browser.errors, [], f"页面上有异常:{self.browser.errors}")

    # ---- 4. SVG 取不到时回落 ----

    def test_failed_svg_fetch_falls_back_to_the_alt_text(self):
        self.inject("gone", "/probe/this-svg-is-not-there.svg", "一张取不到的 SVG")
        self.ask("gone")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一张取不到的 SVG"])

        # 对照:同一条路能取到时,送的是图里写的字。
        self.inject("plain", "/probe/plain.svg", "会被图里的字盖过的替代文本")
        self.ask("plain")
        self.wait_chips(2)
        self.assertEqual(self.chips()[1], "流程示意 / 入库侧 / 查询处理")

    # ---- 5. 不可信的 SVG 不执行 ----

    def test_untrusted_svg_is_never_executed(self):
        self.inject("payload", "/probe/payload.svg", "")
        self.ask("payload")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["载荷图 / 图里的文字"], "取源读的是图里写的字")
        self.assertIsNone(
            self.page.evaluate("() => window.__aipmPwned"),
            "取源那条路把外链取活/把事件属性触发了",
        )

        # 对照:同一份载荷经 innerHTML 进页面时是活的 —— 证明上面那条不是因为它本来就是死的。
        self.page.evaluate(
            """async (markup) => {
                const host = document.createElement('div');
                host.innerHTML = markup;
                document.body.appendChild(host);
            }""",
            fixtures.PAYLOAD_SVG.decode("utf-8"),
        )
        self.page.wait_for_function("() => window.__aipmPwned === true", timeout=5000)

    # ---- 6. 位图与 localStorage 配额 ----

    def test_history_round_trips_the_image(self):
        """语境随用户消息一起存进本机会话:刷新之后那一轮仍能按原样重发。"""
        self.inject("real", "/probe/real.png", "一张会进历史记录的图")
        self.ask("real")
        self.wait_chips(1)
        self.send("这张图里写了什么?")

        stored = self.page.evaluate("() => JSON.parse(localStorage.getItem('aipm-chat-history'))")
        user = [m for m in stored if m["role"] == "user"][-1]
        self.assertEqual(len(user["context"]), 1)
        self.assertEqual(user["context"][0]["mediaType"], "image/png")
        self.assertEqual(user["context"][0]["imageData"], self._real_png_base64())

        self.page.reload(wait_until="load")
        self.page.wait_for_function("() => window.__aipmChat")
        restored = self.page.evaluate(
            """() => {
                const stored = JSON.parse(localStorage.getItem('aipm-chat-history'));
                const user = stored.filter((m) => m.role === 'user').pop();
                return window.__aipmContext.sanitize(user.context).map((it) => [it.mediaType, it.imageData.length]);
            }"""
        )
        self.assertEqual(
            restored,
            [["image/png", len(self._real_png_base64())]],
            "恢复时那条带图像的语境被丢掉了(或图像内容没跟着回来)",
        )

    def test_quota_pressure_keeps_the_conversation(self):
        """配额满了也要留下这段对话:去掉图像内容再写一次,而不是整条会话都不存。"""
        headroom = self.squeeze_quota()
        self.assertGreater(headroom, 100 * 1024, "没能把配额占满,这条用例的前提不成立")

        self.inject("small", "/probe/small.png", "配额吃紧时送进来的图")
        self.inject("real", "/probe/real.png", "配额吃紧时送进来的第二张图")
        self.ask("small")
        self.wait_chips(1)
        self.ask("real")
        self.wait_chips(2)
        self.send("这两张图里写了什么?")

        stored = self.page.evaluate("() => JSON.parse(localStorage.getItem('aipm-chat-history'))")
        user = [m for m in stored if m["role"] == "user"][-1]
        self.assertIn("这两张图里写了什么?", user["content"], "配额满了就把整段对话丢了")
        self.assertEqual(len(user["context"]), 2, "语境条目本身该留着")
        for item in user["context"]:
            self.assertEqual(item["mediaType"], "", "写不下时留的应当是去掉图像的那一份")
            self.assertEqual(item["imageData"], "")
            self.assertNotEqual(item["source"], "", "文字部分要留着,不然这条语境读不出是什么")

    def test_regenerate_replays_the_degraded_context(self):
        """配额降级之后刷新,再点「重新生成」:重发的是**存下来的那一份**语境。

        降级只改写了落进 localStorage 的那一份(内存里的 history 仍带着图像),所以
        这个流程要走完刷新这一步才成立 —— 也是原审查指出的「源码断言看不出行为」
        的那一处:重新生成拿到的究竟是带图像的原件,还是降级后的那份。"""
        self.squeeze_quota()
        self.inject("real", "/probe/real.png", "降级之后要被重发的那张图")
        self.ask("real")
        self.wait_chips(1)
        self.send("这张图里写了什么?")

        stored = self.page.evaluate("() => JSON.parse(localStorage.getItem('aipm-chat-history'))")
        kept = [m for m in stored if m["role"] == "user"][-1]
        self.assertEqual(kept["context"][0]["imageData"], "", "前提不成立:存下来的那份没被降级")

        self.page.reload(wait_until="load")
        self.page.wait_for_function("() => window.__aipmChat")
        # 刷新后面板是合着的(会话恢复了,但没有哪条通路把它打开)
        self.page.click(".aipm-chat__fab")

        # 两条消息都恢复出来,重新生成挂在 AI 那条气泡下方的常驻操作行上
        before = len(self.browser.chat_bodies)
        self.page.locator("button.aipm-chat__act[title='重新生成']").last.click()
        self.page.wait_for_function(
            "() => !document.querySelector('.aipm-chat__send').classList.contains('is-stop')"
        )
        self.assertGreater(len(self.browser.chat_bodies), before, "重新生成没有发出 /api/chat 请求")

        wire = self.browser.chat_bodies[-1]
        self.assertEqual(wire["message"], "这张图里写了什么?", "重发的是另一条问题")
        self.assertEqual(len(wire["context"]), 1, "重发时语境丢了")
        item = wire["context"][0]
        self.assertEqual(item["chart"], "image")
        self.assertEqual(item["source"], "降级之后要被重发的那张图")
        self.assertEqual(item["mediaType"], "", "重新生成把降级之前的图像又送回了一份")
        self.assertEqual(item["imageData"], "")
        self.assertEqual(
            self.images_in(self.model_requests()[-1]["body"]),
            [],
            "降级之后重发的那一轮,模型那边又收到了图像",
        )
        self.assertEqual(self.browser.errors, [], f"页面上有异常:{self.browser.errors}")

    def squeeze_quota(self) -> int:
        """把 localStorage 占满,再填到只剩约 100 KB。返回量出来的余量。

        比去掉图像之后的那份历史大得多,又比带着两张图的那份小 —— 于是第一次写
        必然失败、第二次必然成功,走的就是要验的那条降级路径。"""
        return self.page.evaluate(
            """() => {
                const chunk = 'x'.repeat(256 * 1024);
                try {
                    for (let i = 0; i < 200; i++) localStorage.setItem('quota-filler-' + i, chunk);
                } catch (e) { /* 满了 */ }
                const fits = (n) => {
                    try { localStorage.setItem('quota-canary', 'x'.repeat(n)); return true; }
                    catch (e) { return false; }
                };
                let lo = 0, hi = 8 * 1024 * 1024;
                while (hi - lo > 4096) {
                    const mid = (lo + hi) >> 1;
                    if (fits(mid)) lo = mid; else hi = mid;
                }
                localStorage.removeItem('quota-canary');
                localStorage.setItem('quota-headroom', 'x'.repeat(Math.max(0, lo - 100 * 1024)));
                return lo;
            }"""
        )

    @staticmethod
    def _real_png_base64() -> str:
        return base64.b64encode(SITE_IMG.read_bytes()).decode("ascii")

    # ---- 7. 仅本机那道边界对带图像的图表同样成立 ----

    def test_local_never_becomes_context(self):
        local = self.page.evaluate(
            """() => {
                const CTX = window.__aipmContext;
                const shaped = {
                    id: 'chart:/ai/rag/#image:zzz',
                    kind: 'chart',
                    page: '/ai/rag/',
                    title: '检索增强生成',
                    quote: '', prefix: '', suffix: '', body: '', color: '',
                    chart: 'image',
                    source: '一张仅本机的图。',
                    mediaType: 'image/png',
                    imageData: 'iVBORw0KGgo=',
                    visibility: 'local'
                };
                const put = window.__aipmChat.attachContext(shaped);
                return {
                    deliverable: CTX.isDeliverable(shaped),
                    attach: put,
                    sanitized: CTX.sanitize([shaped]).length,
                    payload: CTX.toPayload([shaped]).length,
                    chips: document.querySelectorAll('.aipm-chat__ctx-text').length
                };
            }"""
        )
        self.assertIs(local["deliverable"], False)
        self.assertEqual(local["attach"]["ok"], False)
        self.assertEqual(local["attach"]["code"], "invalid_context")
        self.assertEqual(local["sanitized"], 0)
        self.assertEqual(local["payload"], 0)
        self.assertEqual(local["chips"], 0, "仅本机的条目摆上了语境条")

        # 同一条改回公开就收得下:挡住它的是可见范围那一条,不是形状。
        public = self.page.evaluate(
            """() => {
                const CTX = window.__aipmContext;
                const ok = {
                    id: 'chart:/ai/rag/#image:yyy',
                    kind: 'chart', page: '/ai/rag/', title: '', quote: '', prefix: '',
                    suffix: '', body: '', color: '', chart: 'image',
                    source: '一张公开的图。', mediaType: 'image/png',
                    imageData: 'iVBORw0KGgo=', visibility: 'public'
                };
                return { deliverable: CTX.isDeliverable(ok), payload: CTX.toPayload([ok]).length };
            }"""
        )
        self.assertIs(public["deliverable"], True)
        self.assertEqual(public["payload"], 1)

    # ---- 8. 模型不收图时,用户看到一句能照着做的话 ----

    def test_rejected_image_gets_actionable_feedback(self):
        """上游说它不收图时,界面上要出现「去掉图片再问」,而不是一句通用提示,
        也不是上游那段报错原文。"""
        self.model.reject_images = True
        self.addCleanup(setattr, self.model, "reject_images", False)

        self.inject("real", "/probe/real.png", "模型不收的一张图")
        self.ask("real")
        self.wait_chips(1)
        self.send("这张图里写了什么?")

        self.assertTrue(
            any(self.images_in(r["body"]) for r in self.model_requests()),
            "前提不成立:这一轮没有哪一次调用带着图;模型收到的请求"
            f"{[(r['path'], len(self.images_in(r['body']))) for r in self.model_requests()]}",
        )

        text = self.page.locator(".aipm-chat__md").last.inner_text()
        self.assertIn("图像", text, f"没有说清是图像的问题:{text!r}")
        self.assertIn("去掉", text, f"没有告诉用户怎么继续:{text!r}")
        self.assertNotIn("收到。", text, "上游摘掉图之后那轮回答还是发了出去,用户以为模型看过图")
        self.assertNotIn("req_01STUBIMAGE", text, "上游报错里的请求编号走到了用户眼前")
        self.assertNotIn("does not support image inputs", text, "上游报错的原文走到了用户眼前")
        self.assertNotIn("模型服务暂时不可用", text, "还停在通用提示上,用户不知道要做什么")
        self.assertEqual(self.browser.errors, [], f"页面上有异常:{self.browser.errors}")


if __name__ == "__main__":
    unittest.main()
