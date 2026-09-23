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
- **正文读到一半断掉**:退回替代文本,按钮恢复可按,不留未处理的拒绝;
- **Service Worker 接管之后**,上面那条体积限制在三种处境下都成立:这次读没命中
  缓存、缓存里已经有这张图、老用户带着旧缓存升到新构建;
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
from harness import (
    ROOT,
    WORK,
    AgentServer,
    Browser,
    StaticSite,
    StubModel,
    assert_no_page_errors,
    build_site,
)

RAG_PAGE = "/ai/rag/"
SITE_IMG = ROOT / "docs" / "job" / "jd-breakdowns" / "images" / "bytedance_developer_ai_pm_jd_01.png"

#: 「读不完」的两份响应各有多大。要远超任何合理的读取上限,才量得出「读的过程中
#: 有没有停」—— 上限之内的正常图走的是另一条用例。
OVERSIZED_TOTAL = 32 * 1024 * 1024

#: 上一版构建(改动之前那个提交)。两个用例类都要拿它造出「老用户手里那一版」。
#: 缓存升级那条用它当旧构建;Service Worker 那条用它当「带着旧缓存升级」的起点。
#: 那一版里的 chart-context.js 是 `?v=3`,下面按旧构建的地址找缓存条目就照它找。
OLD_REF = "5c76a4ba"

#: 用例素材的站内路径。素材住在站点根目录里,每换一次根目录都要重放一遍
#: (见 `write_fixtures`),路径本身不变。
HUGE_PNG = "/probe/huge.png"
HUGE_SVG = "/probe/huge.svg"
TRUNCATED_PNG = "/probe/half-there.png"
REDIRECT_PNG = "/probe/redirect-to-far.png"
REDIRECT_SVG = "/probe/redirect-to-far.svg"


def mermaid_blocks(markdown: Path) -> list[str]:
    """markdown 里的 mermaid 源码块,按出现顺序。"""
    return re.findall(r"```mermaid\n(.*?)```", markdown.read_text(encoding="utf-8"), flags=re.S)


def write_fixtures(site: StaticSite, probe: StaticSite) -> None:
    """往站点根目录里放用例素材,并把跨域地址与重定向登记好。

    每换一次站点根目录都要重放一遍 —— 素材就住在根目录里(见 `_Stack` 与
    `ServiceWorkerReadLimitTest` 的升级用例)。"""
    # 真实正文里就有的那张 PNG:用例拿它的字节与线上发出去的 base64 对
    site.write("probe/real.png", SITE_IMG.read_bytes())
    site.write("probe/small.png", fixtures.png(8, 8, 1))
    site.write("probe/big.png", fixtures.png(640, 640, 2))
    site.write("probe/not-an-image.png", fixtures.NOT_AN_IMAGE, "text/html")
    site.write("probe/mislabelled.png", fixtures.NOT_AN_IMAGE, "image/png")
    site.write("probe/payload.svg", fixtures.PAYLOAD_SVG)
    site.write("probe/plain.svg", fixtures.PLAIN_SVG)
    # 跨域那一张:另一台静态服务,只放这一个文件
    probe.write("far.png", fixtures.png(8, 8, 3))
    probe.write("far.svg", fixtures.PLAIN_SVG, "image/svg+xml")
    # 同源地址 → 跨域地址的 302。两个都在站内路径上,来源那一关按地址判是过得去的。
    site.redirect(REDIRECT_PNG.lstrip("/"), f"{probe.base}/far.png")
    site.redirect(REDIRECT_SVG.lstrip("/"), f"{probe.base}/far.svg")
    # 读不完的两份:取源那一步拿到的是超大字节,页面上的 <img> 自己那次加载拿到
    # 一张正常的图(按钮所在的容器要靠它量出尺寸)。
    site.stream(
        HUGE_PNG.lstrip("/"),
        fixtures.oversized(b"\x89PNG\r\n\x1a\n", OVERSIZED_TOTAL),
        fixtures.png(8, 8, 5),
        "image/png",
    )
    site.stream(
        HUGE_SVG.lstrip("/"),
        fixtures.oversized(b'<svg xmlns="http://www.w3.org/2000/svg">', OVERSIZED_TOTAL),
        fixtures.PLAIN_SVG,
        "image/svg+xml",
    )
    # 读到一半断的那一份:头照发,正文只写一半。
    site.truncate(
        TRUNCATED_PNG.lstrip("/"),
        fixtures.png(8, 8, 6) + b"\x00" * (128 * 1024),
        fixtures.png(8, 8, 7),
    )


class _Stack:
    """一整套跑得起来的东西:真站点、跨域探针、假模型、真的 agent-server、浏览器引擎。

    整个模块共用一份 —— 建站要几十秒,两个用例类各建一份没有意义。"""

    def __init__(self):
        self.site_dir = build_site(WORK / "site-flow")
        self.site = StaticSite(self.site_dir)
        # 跨域那一台**加 CORS 头**:不加的话,挡住「同源重定向到跨域资源」那一步的是
        # CORS 自己,被测的那道来源判断就轮不到 —— 用例必须让跨域那一侧真的放行。
        self.probe = StaticSite(self.site_dir / "probe", cors=True)
        self.model = StubModel()
        self.server = AgentServer(self.site, self.model)
        self.pw = sync_playwright().start()
        write_fixtures(self.site, self.probe)

    def close(self) -> None:
        self.server.close()
        self.model.close()
        self.probe.close()
        self.site.close()
        self.pw.stop()


_STACK: _Stack | None = None


def stack() -> _Stack:
    global _STACK
    if _STACK is None:
        _STACK = _Stack()
    return _STACK


def tearDownModule() -> None:
    global _STACK
    if _STACK is not None:
        _STACK.close()
        _STACK = None


class ChartFlowCase(unittest.TestCase):
    """两个用例类共用的东西:那一整套服务,以及页面上点图的那几件工具。

    `service_workers` 是两类用例唯一分开的地方 —— 见两个子类各自的说明。"""

    #: "block" 或 "allow",传给 Playwright 的 context。
    service_workers = "block"

    def setUp(self):
        self.stack = stack()
        self.site = self.stack.site
        self.probe = self.stack.probe
        self.model = self.stack.model
        self.server = self.stack.server
        self.pw = self.stack.pw
        # 假模型 API 整类共用一份记录,每个用例只看自己这一段
        self.model_seen = len(self.model.messages())
        self.browser = Browser(self.pw, self.site.base, service_workers=self.service_workers)
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
        # 等这张图自己有结果(取到了,或者取不到)。取不到时浏览器摆出来的是 alt
        # 文本,那个框决定了容器多高、按钮落在哪里 —— 不等它落地,下面「先悬停
        # 再点」的两下会落在两个不同的位置上:悬停时容器还没有内容,鼠标落在别处,
        # 点的时候按钮已经在新的位置上,而 CSS 那头没被悬停过,按钮仍是
        # `pointer-events: none`,命中测试照到的就成了那张图自己。
        self.page.wait_for_function(
            "(tag) => { const img = document.querySelector(`img[data-probe=\"${tag}\"]`); return img !== null && img.complete; }",
            arg=tag,
        )
        self.ask_button(tag).wait_for(state="visible")

    def ask_button(self, tag: str):
        return self.ask_box(tag).locator("button.aipm-chart__ask")

    def ask_box(self, tag: str):
        return self.page.locator("div.aipm-chart").filter(
            has=self.page.locator(f'img[data-probe="{tag}"]')
        )

    def wait_still(self, tag: str) -> None:
        """等这张图上的按钮连续若干帧不动。

        页面上随时可能有东西在动:点第一张图会打开助手面板,面板开合会把正文里的
        东西一起挪走;主题的 mermaid 也是一张一张渲染出来的。悬停与点击之间挪一下,
        鼠标就不在这张图上了 —— 容器失去 `:hover`,按钮回到 `pointer-events: none`,
        命中测试照到的成了图自己。用例要验的不是这条竞态,先把它等过去。"""
        self.page.wait_for_function(
            """async (tag) => {
                const img = document.querySelector(`img[data-probe="${tag}"]`);
                const btn = img.closest('.aipm-chart').querySelector('button.aipm-chart__ask');
                const rect = () => {
                    const b = btn.getBoundingClientRect();
                    return [b.x, b.y, b.width, b.height].join(',');
                };
                let last = rect();
                let still = 0;
                while (still < 3) {
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                    const now = rect();
                    still = now === last ? still + 1 : 0;
                    last = now;
                }
                return true;
            }""",
            arg=tag,
        )

    def ask(self, tag: str) -> None:
        """点这张图的「问助手」。

        先悬停再点 —— 按钮平时是 `opacity: 0; pointer-events: none`,只在悬停这张图
        时现形可点(触摸设备上例外,见 chart-context.css)。真实用户也是这样点的,
        用例照做,不绕过命中测试。"""
        box = self.ask_box(tag)
        self.wait_still(tag)
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


class ChartContextFlowTest(ChartFlowCase):
    """这条通路的正面用例。

    Service Worker 关掉:站点那个是**按地址**的 cache-first,而「读不完的响应」故意
    让同一个地址先是页面自己那次加载、再是取源那次请求 —— SW 会把第二次挡回第一次
    的响应,两份内容根本到不了服务端,量不出取源读了多少。这里量的是取源本身,
    所以把那一层摘掉;SW 接管之后限额还成不成立,由 `ServiceWorkerReadLimitTest`
    另开一组(那边不摘)。"""

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
        assert_no_page_errors(self, self.browser)

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
        assert_no_page_errors(self, self.browser)

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
        self.inject("redirect", REDIRECT_PNG, "一个重定向到跨域的地址")
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
        self.inject("redirectsvg", REDIRECT_SVG, "一个重定向到跨域的 SVG 地址")
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
        self.inject("huge", HUGE_PNG, "一份读不完的位图")
        self.ask("huge")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份读不完的位图"])

        read = self.settled_bytes(HUGE_PNG)
        self.assertGreaterEqual(
            read, self.image_cap(), "取源没读起来,这个数说明不了「读的过程中停」"
        )
        self.assertLess(
            read,
            OVERSIZED_TOTAL // 4,
            f"整份 {OVERSIZED_TOTAL} 字节的响应被读进了内存,读了 {read} 字节",
        )
        self.assertTrue(self.site.was_cancelled(HUGE_PNG), "超限的响应没有被取消")

        wire = self.send("这张图里写了什么?")
        item = wire["context"][0]
        self.assertEqual(item["mediaType"], "")
        self.assertEqual(item["imageData"], "")

    def test_oversized_svg_is_cancelled_mid_read(self):
        """SVG 与位图同一个上限,同样读的过程中停。"""
        self.inject("hugesvg", HUGE_SVG, "一份读不完的 SVG")
        self.ask("hugesvg")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份读不完的 SVG"])

        read = self.settled_bytes(HUGE_SVG)
        self.assertGreaterEqual(
            read, self.image_cap(), "取源没读起来,这个数说明不了「读的过程中停」"
        )
        self.assertLess(
            read,
            OVERSIZED_TOTAL // 4,
            f"整份 {OVERSIZED_TOTAL} 字节的 SVG 被读进了内存,读了 {read} 字节",
        )
        self.assertTrue(self.site.was_cancelled(HUGE_SVG), "超限的响应没有被取消")

    # ---- 2d. 正文读到一半断掉 ----

    def test_body_failing_mid_read_falls_back_and_frees_the_button(self):
        """响应头到手、正文读到一半断了:退回替代文本,按钮恢复可按,不留未处理的拒绝。

        「取不到这张图」与「读到一半断掉」是两种情形,但都是取源这条路上本来就有
        的结果,走到用户那里应当是同一个:这条语境仍然立得住(写的是替代文本),
        按钮回到能按的状态。按钮停在忙碌态、或者页面上多出一个没人接的拒绝,都是
        这条通路漏掉了这一半。"""
        self.inject("half", TRUNCATED_PNG, "一份读到一半断掉的图")
        self.ask("half")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份读到一半断掉的图"])

        button = self.ask_button("half")
        self.assertFalse(button.is_disabled(), "读失败之后按钮还按不动")
        self.assertNotIn(
            "is-busy", button.get_attribute("class") or "", "按钮还停在取源的忙碌态"
        )

        wire = self.send("这张图里写了什么?")
        item = wire["context"][0]
        self.assertEqual(item["mediaType"], "", "读到一半断掉的那份进了请求体")
        self.assertEqual(item["imageData"], "")
        self.assertEqual(self.images_in(self.model_requests()[0]["body"]), [])
        # 这份素材是这条用例自己弄坏的,浏览器会为它自己报一条「资源没加载成」;
        # 除此之外页面上不该有任何异常(见 assert_no_page_errors)。
        assert_no_page_errors(
            self, self.browser, expected_load_failures=(self.site.base + TRUNCATED_PNG,)
        )

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
        assert_no_page_errors(self, self.browser)

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
        assert_no_page_errors(self, self.browser)

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
        assert_no_page_errors(self, self.browser)


class ServiceWorkerReadLimitTest(ChartFlowCase):
    """Service Worker 接管之后,取源的读取限额仍然成立。

    上面那一组把 SW 关掉,量的是取源本身;线上跑的站点是有 SW 的,所以同一件事要
    在三种处境下各验一遍:这次读没命中缓存、缓存里已经有这张图、以及老用户带着
    旧缓存升到新构建。

    ── SW 与「读的过程中停」为什么是同一件事 ──

    cache-first 那一层回填时会把响应 clone 一份出去异步写入缓存,那份副本读多少由
    缓存层自己定,页面这边 `reader.cancel()` 管不着它 —— 取消掉页面这一半之后,
    另一半照旧把整份读完,上限就只约束得住一半。所以取源那次请求**不经过那一层**
    (见 service-worker.js 的放行),这条响应只有一个消费者,读多少只由取源那一处
    决定。

    这里不摘 SW,量「取源读了多少」的那两条仍然成立:两份内容按 `Sec-Fetch-Mode`
    分(SW 重新发起 `<img>` 那次加载时 `Sec-Fetch-Dest` 是空的,按那个分会发错),
    见 harness 的 `_Stream`。"""

    service_workers = "allow"

    def setUp(self):
        super().setUp()
        self.page.wait_for_function("() => navigator.serviceWorker.controller !== null")

    # ---- 手上这几件工具 ----

    def cached_urls(self) -> list[str]:
        """缓存里现在有哪些地址(SW 那份 Cache Storage)。"""
        return self.page.evaluate(
            """async () => {
                const out = [];
                for (const name of await caches.keys()) {
                    const cache = await caches.open(name);
                    for (const req of await cache.keys()) out.push(req.url);
                }
                return out;
            }"""
        )

    def wait_cached(self, needle: str) -> None:
        """等这个片段的缓存条目出现 —— 前提是它确实进得去,进不去就是这条用例站不住。"""
        self.page.wait_for_function(
            """async (needle) => {
                for (const name of await caches.keys()) {
                    const cache = await caches.open(name);
                    for (const req of await cache.keys()) if (req.url.includes(needle)) return true;
                }
                return false;
            }""",
            arg=needle,
            timeout=15000,
        )

    def swap_service_worker(self) -> None:
        """把服务端**此刻这一份** service-worker.js 换上去,并等它接管本页。

        不能只看 `controller` 非空 —— 新旧脚本的地址一样,从接口上看不出换没换。
        靠 `reg.update()` 触发一次字节比对(服务端此刻给的是哪一版,换上的就是哪
        一版),靠 `controllerchange` 确认接管完成:脚本 activate 里 claim 的正是
        这一刻。

        导航那一侧的更新检查指望不上:同一份注册的软更新是节流的(24 小时一次),
        几秒之内连着换两版构建,它一次也不会再查。"""
        self.page.evaluate(
            """() => new Promise((resolve, reject) => {
                const guard = setTimeout(
                    () => reject(new Error('新脚本 15 秒内没有接管本页')), 15000
                );
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    clearTimeout(guard);
                    resolve(true);
                }, { once: true });
                navigator.serviceWorker.getRegistration('/').then((reg) => reg && reg.update());
            })"""
        )

    def assert_cap_held(self, path: str, what: str) -> None:
        """取源从这份响应里读走的字节数停在上限附近,并且这条响应被就地取消了。"""
        read = self.settled_bytes(path)
        self.assertGreaterEqual(
            read, self.image_cap(), f"{what}:取源没读起来,这个数说明不了「读的过程中停」"
        )
        self.assertLess(
            read,
            OVERSIZED_TOTAL // 4,
            f"{what}:整份 {OVERSIZED_TOTAL} 字节被读进了内存,读了 {read} 字节",
        )
        self.assertTrue(self.site.was_cancelled(path), f"{what}:超限的响应没有被取消")

    # ---- 1. 没命中缓存 ----

    def test_oversized_bitmap_stops_mid_read_under_the_service_worker(self):
        self.inject("huge", HUGE_PNG, "一份读不完的位图")
        self.ask("huge")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份读不完的位图"])

        self.assert_cap_held(HUGE_PNG, "位图")
        assert_no_page_errors(self, self.browser)

    def test_oversized_svg_stops_mid_read_under_the_service_worker(self):
        self.inject("hugesvg", HUGE_SVG, "一份读不完的 SVG")
        self.ask("hugesvg")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份读不完的 SVG"])

        self.assert_cap_held(HUGE_SVG, "SVG")
        assert_no_page_errors(self, self.browser)

    # ---- 2. 缓存里已经有这张图 ----

    def test_a_warm_cache_does_not_feed_the_source_read(self):
        """缓存层手里已经有这张图时,取源读的仍然不是那一份。

        老用户第二次打开这一页,图早进了 SW 的缓存;点「问助手」时缓存层手里有
        现成的一份。取源读的是此刻这一页上的字节、读多少由它自己定,不借用那份
        —— 借用的话这条响应就有了第二个消费者,限额重新变成只管一半。"""
        self.inject("huge", HUGE_PNG, "一份已经进过缓存的读不完的位图")
        self.wait_cached("/probe/huge.png")
        self.ask("huge")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["一份已经进过缓存的读不完的位图"])

        self.assert_cap_held(HUGE_PNG, "缓存命中")
        assert_no_page_errors(self, self.browser)

    # ---- 3. 老用户带着旧缓存升级 ----

    def test_read_limit_holds_after_an_upgrade_that_keeps_the_old_cache(self):
        """带着旧缓存升级:旧构建缓存过的东西还在,新构建上的取源限额照样成立。

        两件事叠在一起 —— 升级(SW 换成新脚本、页面换成新版本号)与旧缓存(旧构建
        那次加载留下的条目)。升级之后点「问助手」,读的必须是此刻这一页上的字节,
        并且读到上限就地停。"""
        old_dir = build_site(WORK / "site-flow-old", ref=OLD_REF)
        self.addCleanup(self.site.serve, self.stack.site_dir)
        self.site.serve(old_dir)
        write_fixtures(self.site, self.probe)

        self.page.goto(self.site.base + RAG_PAGE, wait_until="load")
        self.page.wait_for_function("() => navigator.serviceWorker.controller !== null")
        # 先真的落到旧构建那一版 SW 上:导航触发的更新检查是节流的,而 setUp 那次
        # 加载装的是新构建那一版 —— 不显式换一次,下面那头就还是新脚本,「升级」
        # 根本无从发生。
        self.swap_service_worker()
        # 首次加载时页面还没被接管,它请求的那些资源不过 SW;再加载一次,这一遍
        # 才走 cache-first,旧构建那一版脚本这才真正进了缓存。
        self.page.reload(wait_until="load")
        self.page.wait_for_function("() => window.__aipmChat && window.__aipmContext")
        self.wait_cached("chart-context.js?v=3")

        # 同一个端口、同一个浏览器:把根换成新构建,再把新的 SW 换上去并等它接管
        self.site.serve(self.stack.site_dir)
        self.swap_service_worker()
        self.page.reload(wait_until="load")
        self.page.wait_for_function("() => window.__aipmChat && window.__aipmContext")

        self.inject("huge", HUGE_PNG, "升级之后送进来的读不完的位图")
        self.ask("huge")
        self.wait_chips(1)
        self.assertEqual(self.chips(), ["升级之后送进来的读不完的位图"])

        self.assert_cap_held(HUGE_PNG, "升级之后")
        self.assertIn(
            "chart-context.js?v=3",
            " ".join(self.cached_urls()),
            "旧构建那份缓存没了 —— 这条用例的前提不成立",
        )
        assert_no_page_errors(self, self.browser)


if __name__ == "__main__":
    unittest.main()
