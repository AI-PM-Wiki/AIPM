"""锁住图表语境(chart-context.js)的取源与安全边界。

这个文件碰 DOM、发请求、解析 SVG,没法在 node 里跑 —— 行为由真实浏览器验证,
这里锁的是那些**改一处就会静默失效**的形状:取源从哪儿来、取不到时写什么、
不可信的 SVG 走哪条路进、以及那道「不执行任何来自页面的东西」的边界。

容易在改动中悄悄回退的几条:

- **mermaid 的源码要在渲染把它换掉之前收下来**。主题渲染一张图是
  `el.replaceWith(host)`:换下来的 `<pre>` 上源码还在,换上去的 `<div>` 是个
  空壳(SVG 在它的 closed shadow root 里,外面读不到)。收源的观察者因此必须
  同时看 removedNodes 与 addedNodes,并且只在一条记录内部配对。
- **取不到内容写一句说明,而不是不造条目**。三种图各有一条兜底路径,兜底文案
  里要有位置、种类与原因 —— 它是这条语境唯一的可读内容。
- **不可信的 SVG 不执行**。SVG 是正文的一部分,和别的正文一样由作者提供。取源
  只走 fetch 拿文本 + DOMParser 解析成惰性文档读字,读到的字符串以文本形式进
  语境;解析出来的节点从不插入本文档。这个文件里唯一一处 innerHTML 写的是自己
  定义的那颗图标常量。
- **样式与脚本成对注册**。少一处注册,按钮就没有样式或者整段不加载。
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "mkdocs.yml"
CHART_JS = ROOT / "docs" / "_static" / "js" / "chart-context.js"
CHART_CSS = ROOT / "docs" / "_static" / "css" / "chart-context.css"
CTX_JS = ROOT / "docs" / "_static" / "js" / "context-item.js"
CHAT_JS = ROOT / "docs" / "_static" / "js" / "chat-widget.js"


def _strip_comments(src: str) -> str:
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


class TestChartContextAssets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = CONFIG.read_text(encoding="utf-8")
        cls.raw = CHART_JS.read_text(encoding="utf-8")
        cls.js = _strip_comments(cls.raw)
        cls.css = _strip_comments(CHART_CSS.read_text(encoding="utf-8"))

    def test_assets_are_registered_with_cache_versions(self):
        scripts = self.config[self.config.index("extra_javascript:") :]
        self.assertIn("_static/js/chart-context.js?v=5", scripts)
        self.assertIn("_static/css/chart-context.css?v=1", scripts)
        entries = [e.split("?", 1)[0] for e in re.findall(r"-\s*'([^']+)'", scripts)]
        self.assertLess(
            entries.index("_static/js/context-item.js"),
            entries.index("_static/js/chart-context.js"),
            "chart-context.js 读 __aipmContext,必须排在 context-item.js 之后",
        )

    def test_missing_dependencies_skip_the_whole_module(self):
        """共享件缺失时整条不做:摆一颗点了没反应的按钮比不摆更糟。"""
        head = self.js[: self.js.index("function contentRoot()")]
        self.assertIn("var CTX = window.__aipmContext || null", head)
        self.assertIn("if (CTX === null) return", head)
        self.assertIn(r"/\.netlify\.app$/i.test(location.hostname)", head)

    def test_instant_navigation_subscription_is_guarded(self):
        self.assertRegex(
            self.js,
            r'if \(typeof document\$ !== "undefined" && document\$ && document\$\.subscribe\) \{\s*'
            r"document\$\.subscribe\(",
        )

    def test_entry_button_sits_in_its_own_positioned_box(self):
        self.assertIn('box.className = "aipm-chart"', self.js)
        self.assertIn('btn.className = "aipm-chart__ask"', self.js)
        fn = self.js[self.js.index("function enhance(el)") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("parent.insertBefore(box, el)", fn)
        self.assertIn("box.appendChild(el)", fn, "容器要包住这张图,按钮才有定位的参照")
        self.assertIn("box.appendChild(askButton(el))", fn)
        self.assertIn("el.setAttribute(READY_ATTR", fn, "重复扫描要认得出来,不然会套第二层")

        ask = self.css[self.css.index(".aipm-chart__ask {") :]
        self.assertIn("position: absolute", ask)
        self.assertIn("left: .4rem", ask, "贴在左下角,避开 mermaid-zoom 右下角的放大按钮")
        self.assertIn(".aipm-chart:hover > .aipm-chart__ask", self.css)
        self.assertIn("@media (hover: none)", self.css, "触摸设备上按钮要一直可见")
        self.assertIn(".aipm-chart__toast", self.css)

    def test_button_swallows_the_click_before_the_link(self):
        """图常常本身就是个链接,按钮落在链接里面 —— 不拦下这一下会把页面带走。"""
        fn = self.js[self.js.index("function askButton(el)") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("event.preventDefault()", fn)
        self.assertIn("event.stopPropagation()", fn)
        self.assertIn('btn.title = "问助手:把这张图送进对话"', fn)
        self.assertIn('btn.setAttribute("aria-label"', fn)


class TestChartSourceCapture(unittest.TestCase):
    """mermaid 的源码在渲染替换掉它之前收下来。"""

    @classmethod
    def setUpClass(cls):
        cls.js = _strip_comments(CHART_JS.read_text(encoding="utf-8"))

    def test_source_is_read_off_the_removed_block_and_paired_in_record(self):
        fn = self.js[self.js.index("function absorbMermaidSources(records)") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("records[r].removedNodes", fn, "源码在被换下来的那个游离节点上")
        self.assertIn("records[r].addedNodes", fn, "要配到换上去的宿主上")
        self.assertIn("mermaidSource.set(fresh[i], text)", fn)
        self.assertNotIn("push", fn, "配对只在一条记录内部做,不跨记录攒队列")

    def test_rendered_and_unrendered_blocks_are_told_apart(self):
        fn = self.js[self.js.index("function holdsSource(node)") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn('node.tagName === "PRE"', fn)
        self.assertIn('node.querySelector("code")', fn)

    def test_registry_is_keyed_on_the_live_element(self):
        self.assertIn("var mermaidSource = new WeakMap()", self.js)

    def test_only_rendered_hosts_are_wrapped(self):
        """`div.mermaid` 这个限定把还在源码形态的 `<pre class="mermaid">` 排除在外。"""
        fn = self.js[self.js.index("function chartElements()") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn('querySelectorAll("div.mermaid, img")', fn)

    def test_observer_collects_sources_and_wraps_new_charts(self):
        obs = self.js[self.js.index("new MutationObserver(") :]
        self.assertIn("absorbMermaidSources(records)", obs)
        self.assertIn("scheduleScan()", obs)
        self.assertIn("observe(document.body, { childList: true, subtree: true })", obs)


class TestChartSourceFidelity(unittest.TestCase):
    """三种图各读到什么,以及读完什么时写什么。"""

    @classmethod
    def setUpClass(cls):
        cls.raw = CHART_JS.read_text(encoding="utf-8")
        cls.js = _strip_comments(cls.raw)

    def _fn(self, head: str) -> str:
        body = self.js[self.js.index(head) :]
        return body[: body.index("\n  }") + 4]

    def test_mermaid_sends_its_source(self):
        fn = self._fn("function readChart(el)")
        self.assertIn("mermaidSource.get(el)", fn, "mermaid 送给模型的是它的源码")
        self.assertIn('chart: "mermaid"', fn)
        self.assertIn("key: source", fn, "同一段源码 = 同一张图,连点两次只有一条语境")

    def test_svg_is_fetched_same_origin_and_parsed_as_an_inert_document(self):
        fn = self._fn("function readImage(img)")
        self.assertIn("sameOriginSvgUrl(img)", fn, "跨域的图不取")
        self.assertIn("sourceRequest(svg)", fn)
        self.assertIn("svgLabels(", fn)

        guard = self._fn("function sameOriginUrl(src)")
        self.assertIn("url.origin === location.origin", guard)
        self.assertIn("if (!src) return null", guard, "没有 src 的图连 URL 都拼不出来")

        svg_guard = self._fn("function sameOriginSvgUrl(img)")
        self.assertIn("sameOriginUrl(img.src)", svg_guard)
        self.assertIn('endsWith(".svg")', svg_guard)

        parse = self._fn("function svgLabels(markup)")
        self.assertIn('new DOMParser().parseFromString(markup, "image/svg+xml")', parse)
        self.assertIn('doc.querySelectorAll("title, desc, text")', parse)
        self.assertIn('doc.querySelector("parsererror")', parse, "不是 SVG 时返回空,交给兜底")

    def test_source_fetch_carries_the_marker_the_service_worker_knows(self):
        """取源那条请求带一个只属于它自己的标记头,站点的 Service Worker 认它才放行。

        名字与取值在页面与 SW 两边各写一遍(两边不共享模块),所以由这条断言钉住:
        两边必须还是同一对。对不上的后果是静默的 —— 放行失效,读取上限又只管得住
        一半,而页面上看不出任何异常。"""
        req = self._fn("function sourceRequest(url)")
        self.assertIn("SOURCE_FETCH_HEADER", req)
        self.assertIn("SOURCE_FETCH_VALUE", req)

        header = re.search(r'var SOURCE_FETCH_HEADER = "([^"]+)"', self.js)
        value = re.search(r'var SOURCE_FETCH_VALUE = "([^"]+)"', self.js)
        self.assertIsNotNone(header, "取源标记头的名字没写在这份脚本里")
        self.assertIsNotNone(value, "取源标记头的取值没写在这份脚本里")

        sw = (ROOT / "docs" / "service-worker.js").read_text(encoding="utf-8")
        self.assertIn(f'const SOURCE_FETCH_HEADER = "{header.group(1).lower()}"', sw)
        self.assertIn(f'const SOURCE_FETCH_VALUE = "{value.group(1)}"', sw)
        self.assertIn("req.headers.get(SOURCE_FETCH_HEADER) === SOURCE_FETCH_VALUE", sw)

    def test_source_fetch_never_follows_a_redirect(self):
        """重定向是「地址换了个地方」,去向在读之前看不见 —— 同源地址照样可以 302
        到一台放行 CORS 的跨域服务器上。不跟,就是跨源那一步根本不会发生。"""
        req = self._fn("function sourceRequest(url)")
        self.assertIn('redirect: "manual"', req, "跟了重定向,跨源那一侧就被读了")
        self.assertIn('credentials: "same-origin"', req)
        self.assertNotIn("redirect: \"follow\"", req)

        for read in ("function readRaster(img)", "function readImage(img)"):
            self.assertIn("sourceRequest(", self._fn(read), f"{read} 没走这条取源请求")

    def test_reads_stop_at_the_limit_instead_of_after_it(self):
        """超限要在**读的过程中**停:整份读进来再丢掉,几百 MB 的响应照样会先落进
        内存,上限形同虚设。"""
        fn = self._fn("function readCapped(res, max)")
        self.assertIn("res.body.getReader()", fn)
        self.assertIn("reader.read()", fn)
        self.assertIn("total > max", fn, "读到一半就要判,不是读完再判")
        self.assertIn("reader.cancel()", fn, "超限的那条响应要就地取消")

        for read, call in (
            ("function readRaster(img)", "readCapped(res, CTX.IMAGE_MAX_BYTES)"),
            ("function readImage(img)", "readCapped(res, CTX.IMAGE_MAX_BYTES)"),
        ):
            self.assertIn(call, self._fn(read), f"{read} 没有走限额读取")
        self.assertNotIn("arrayBuffer()", self.js, "整份读进内存的那两个口子都不该在")
        self.assertNotIn("res.text()", self.js)

    def test_raster_images_send_the_image_itself(self):
        """位图送的是图像本身,不只是替代文本 —— 图里的文字与结构只在像素里。"""
        fn = self._fn("function readRaster(img)")
        self.assertIn("altTextOf(img)", fn, "替代文本留着,和图像一并送")
        self.assertIn('chart: "image"', fn)
        self.assertIn("key: img.src", fn)
        self.assertIn("readCapped(res, CTX.IMAGE_MAX_BYTES)", fn, "体积那一关在读的过程中")
        self.assertIn("sniffImageType(bytes)", fn, "种类按字节开头认")
        self.assertIn("base64Of(bytes)", fn)
        self.assertIn("mediaType: mediaType", fn)
        self.assertIn("imageData: base64Of(bytes)", fn)

    def test_raster_fetch_is_limited_in_source_type_and_size(self):
        """三道限制:来源(同源且不跟重定向)、类型(四种之一,按字节)、体积(读的过程中
        不超过上限)。"""
        read = self._fn("function readRaster(img)")
        self.assertIn("sameOriginUrl(img.src)", read, "来源:跨域不取")
        self.assertIn("looksLikeRaster(res)", read, "类型:先按 content-type 筛一道")
        self.assertIn("readCapped(res, CTX.IMAGE_MAX_BYTES)", read, "体积:读的过程中限额")

        sniff = self._fn("function sniffImageType(bytes)")
        for sig in ("0x89", "0xd8", "0x46", "0x52"):
            self.assertIn(sig, sniff, f"字节签名里少了 {sig}")
        for kind in ("image/png", "image/jpeg", "image/gif", "image/webp"):
            self.assertIn(kind, sniff)
        self.assertIn("return null", sniff, "认不出就返回 null,由调用方回落")

        header = self._fn("function looksLikeRaster(res)")
        self.assertIn("content-type", header)
        self.assertIn("CTX.RASTER_TYPES.indexOf(type) >= 0", header)

        self.assertIn("if (bytes === null || bytes.length === 0) return null;", read)

    def test_base64_is_built_in_chunks(self):
        """五十万个码元一次 apply 会把调用栈撑爆,分块拼。"""
        fn = self._fn("function base64Of(bytes)")
        self.assertIn("B64_CHUNK", fn)
        self.assertIn("String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK))", fn)
        self.assertIn('btoa(parts.join(""))', fn)

    def test_failing_any_limit_falls_back_to_the_written_text(self):
        """三道里任何一道不过,都退回只带文字说明的那条路 —— 与原本的行为一致。"""
        fn = self._fn("function readRaster(img)")
        self.assertIn('var text = altTextOf(img) || missingText("image", ordinal, "作者没有写替代文本")', fn)
        self.assertEqual(fn.count("mediaType:"), 1, "只有取到图像的那一条分支带 mediaType")
        self.assertIn('got === null ? { chart: "image", source: text, key: img.src } : got', fn)

    def test_every_path_has_a_written_fallback(self):
        """取不到任何文字时写一句说明 —— 它是这条语境唯一的可读内容。"""
        missing = self._fn("function missingText(chart, ordinal, why)")
        self.assertIn("chartName(chart)", missing)
        self.assertIn("为什么", self.raw, "兜底文案要说清哪一张、什么图、为什么没有内容")

        for why in ("源码没有取到", "图里的文字没有取到", "作者没有写替代文本"):
            self.assertIn(why, self.js, f"缺少这条兜底:{why}")

        read = self._fn("function readChart(el)")
        self.assertIn("readImage(el)", read)
        self.assertIn("missingText(\"mermaid\"", read)
        self.assertIn('key: "by-position:" + ordinal', read, "源码没收上来时按位置认这张图")

    def test_source_is_never_empty(self):
        """每条返回都用 `||` 兜住:forChart 见空 source 不造条目,按钮就白点了。"""
        image = self._fn("function readImage(img)")
        self.assertIn('labels || altTextOf(img) || missingText("svg"', image)
        self.assertEqual(
            self._fn("function readRaster(img)").count("|| missingText("),
            1,
            "位图那条兜底",
        )


class TestUntrustedSvgIsNeverExecuted(unittest.TestCase):
    """图是作者写的,和其它正文一样不可信。"""

    @classmethod
    def setUpClass(cls):
        cls.raw = CHART_JS.read_text(encoding="utf-8")
        cls.js = _strip_comments(cls.raw)

    def test_no_html_parsing_sink_takes_page_content(self):
        for sink in ("outerHTML", "insertAdjacentHTML", "importNode", "adoptNode", "createContextualFragment"):
            self.assertNotIn(sink, self.js, f"图表内容不得经过 {sink}")

        assignments = re.findall(r"\.innerHTML\s*=\s*([^;]+);", self.js)
        self.assertEqual(
            assignments,
            ["ASK_ICON"],
            f"这个文件里唯一的 innerHTML 写自己定义的那颗图标;实际:{assignments}",
        )

    def test_svg_is_parsed_inert_and_only_text_leaves_it(self):
        fn = self.js[self.js.index("function svgLabels(markup)") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn('parseFromString(markup, "image/svg+xml")', fn, "解析成惰性文档:脚本不跑、事件不触发、外链不加载")
        self.assertIn("textContent", fn)
        self.assertNotIn("appendChild", fn, "解析出来的节点从不进本文档")

    def test_source_text_reaches_the_dom_as_text(self):
        """兜底文案与取到的文字经 textContent 摆上语境条,不经过任何解析。"""
        chat = _strip_comments(CHAT_JS.read_text(encoding="utf-8"))
        fn = chat[chat.index("const renderCtx = ()") :]
        fn = fn[: fn.index("\n  };") + 5]
        self.assertIn("text.textContent = CTX ? CTX.excerptOf(item) : \"\"", fn)


class TestChartHandsOffThroughTheSharedContract(unittest.TestCase):
    """形状、去重与那道边界都在 context-item.js,这里不自己拼条目。"""

    @classmethod
    def setUpClass(cls):
        cls.js = _strip_comments(CHART_JS.read_text(encoding="utf-8"))
        cls.ctx = _strip_comments(CTX_JS.read_text(encoding="utf-8"))

    def test_context_is_built_in_exactly_one_place(self):
        self.assertEqual(self.js.count("CTX.forChart("), 1, "图表语境的构造只允许有一处")

    def test_chart_module_never_builds_or_sends_an_item_itself(self):
        for forbidden in ("CTX.upsert(", "CTX.toPayload(", "CTX.forSelection(", "CTX.forAnnotation("):
            self.assertNotIn(forbidden, self.js, f"chart-context.js 不该自己碰 {forbidden}")

    def test_handoff_goes_through_the_chat_panel_export(self):
        fn = self.js[self.js.index("function handOff(found)") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("window.__aipmChat", fn)
        self.assertIn("chat.attachContext(item)", fn)

    def test_handoff_carries_the_image_through(self):
        """取源取到的图像内容要一路交给 forChart —— 少带一个字段,位图那半边就白取。"""
        fn = self.js[self.js.index("function handOff(found)") :]
        fn = fn[: fn.index("\n  }") + 4]
        for field in ("mediaType: found.mediaType", "imageData: found.imageData"):
            self.assertIn(field, fn)

    def test_the_two_front_end_modules_agree_on_the_raster_types(self):
        js_types = re.search(r"var RASTER_TYPES = \[([^\]]*)\]", self.ctx).group(1)
        js_types = [t.strip().strip('"') for t in js_types.split(",")]
        ts_src = (ROOT / "agent-server" / "src" / "context.ts").read_text(encoding="utf-8")
        ts_types = re.search(r"RASTER_MEDIA_TYPES = \[([^\]]*)\]", ts_src).group(1)
        ts_types = [t.strip().strip("'") for t in ts_types.split(",")]
        self.assertEqual(js_types, ts_types, "前后端对「哪些格式算位图」必须给出同一个答案")
        self.assertEqual(
            sorted(js_types),
            ["image/gif", "image/jpeg", "image/png", "image/webp"],
            "模型 API 收的就是这四种",
        )

    def test_the_two_front_end_modules_agree_on_the_image_size(self):
        """前端按字节判、后端按 base64 字符判,两处说的是同一个尺寸 —— 对不上就会
        出现「前端放行、后端拒收」。"""
        ts_src = (ROOT / "agent-server" / "src" / "context.ts").read_text(encoding="utf-8")
        chars = int(re.search(r"imageData: ([\d_]+)", ts_src).group(1).replace("_", ""))
        js_bytes = int(re.search(r"var IMAGE_MAX_BYTES = (\d+)", self.ctx).group(1))
        self.assertEqual(chars, (js_bytes + 2) // 3 * 4, "base64 上限与原始字节上限对不上")

    def test_chat_panel_members_used_here_are_all_exported(self):
        api = _strip_comments(CHAT_JS.read_text(encoding="utf-8"))
        api = api[api.index("window.__aipmChat = {") :]
        api = api[: api.index("\n  };") + 5]
        exported = set(re.findall(r"^\s+(\w+):\s", api, flags=re.M))
        used = set(re.findall(r"\bchat\.(\w+)", self.js))
        self.assertTrue(exported, "没解析出 window.__aipmChat 导出的成员")
        self.assertLessEqual(used, exported, f"chart-context.js 用了没导出的成员:{sorted(used - exported)}")

    def test_failures_are_reported_not_swallowed(self):
        """语境条满了、面板没挂上,按钮点下去都不该毫无动静。"""
        fn = self.js[self.js.index("function handOff(found)") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("flash(", fn)
        self.assertIn('res.code === "context_full"', fn)
        self.assertIn("CTX.MAX_ITEMS", fn)

    def test_the_two_front_end_modules_agree_on_the_chart_kinds(self):
        js_kinds = re.search(r"var CHART_KINDS = \[([^\]]*)\]", self.ctx).group(1)
        js_kinds = [k.strip().strip('"') for k in js_kinds.split(",")]
        ts_kinds = re.search(r"CHART_KINDS = \[([^\]]*)\]", (ROOT / "agent-server" / "src" / "context.ts").read_text(encoding="utf-8")).group(1)
        ts_kinds = [k.strip().strip("'") for k in ts_kinds.split(",")]
        self.assertEqual(js_kinds, ts_kinds, "前后端对「哪些种类算图表」必须给出同一个答案")


if __name__ == "__main__":
    unittest.main()
