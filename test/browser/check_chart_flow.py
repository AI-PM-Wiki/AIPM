"""图表语境的真实浏览器用例(2026-09-23)。

    uv run python3 test/browser/run.py

跑的是完整一条路:真站点(mkdocs build 出来的那份)、真浏览器、真 agent-server、
假模型 API。假 API 把收到的请求体抄下来,于是「在正文里点一下某张图的问助手」
与「模型收到了什么」是同一次运行里可以对着看的两端。

覆盖原审查意见里的每一条:

- **位图送的是图像本身**,并且**模型确实收到了**那张图(第一条,整条链路走完);
- 取图的三道限制:**来源**(跨域不取)、**类型**(按字节认,不看服务器说的)、
  **体积**(超过上限不取);
- mermaid 源码在渲染替换掉它之前收下来,收的是**逐字节相同**的那份源码;
- 同源 SVG 取不到时回落到替代文本;
- 不可信的 SVG 不执行 —— 同一份载荷,innerHTML 那条路是活的,取源那条路是死的;
- 「仅本机」那条边界对带图像的图表同样成立。
"""
from __future__ import annotations

import base64
import re
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

import fixtures
from harness import ROOT, WORK, AgentServer, Browser, StaticSite, StubModel, build_site

RAG_PAGE = "/ai/rag/"
SITE_IMG = ROOT / "docs" / "job" / "jd-breakdowns" / "images" / "bytedance_developer_ai_pm_jd_01.png"


def mermaid_blocks(markdown: Path) -> list[str]:
    """markdown 里的 mermaid 源码块,按出现顺序。"""
    return re.findall(r"```mermaid\n(.*?)```", markdown.read_text(encoding="utf-8"), flags=re.S)


class ChartContextFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = StaticSite(build_site(WORK / "site-flow"))
        cls.probe = StaticSite(cls.site.root / "probe")
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

    def setUp(self):
        # 假模型 API 整类共用一份记录,每个用例只看自己这一段
        self.model_seen = len(self.model.messages())
        self.browser = Browser(self.pw, self.site.base)
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
        """配额满了也要留下这段对话:去掉图像内容再写一次,而不是整条会话都不存。

        先把配额占满,再量出还能放下多少,然后填到只剩约 100 KB —— 比去掉图像之后
        的那份历史大得多,又比带着两张图的那份小。于是第一次写必然失败、第二次
        必然成功,走的就是要验的那条降级路径。"""
        headroom = self.page.evaluate(
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

    @staticmethod
    def _real_png_base64() -> str:
        return base64.b64encode(SITE_IMG.read_bytes()).decode("ascii")

    # ---- 7. 仅本机那道边界对带图像的图表同样成立 ----    def test_local_never_becomes_context(self):
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


if __name__ == "__main__":
    unittest.main()
