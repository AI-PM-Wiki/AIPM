"""锁住「批注面板 ↔ AI 助手」这条互通路径的约定(AIPM#107 第一步)。

这一步交付的是一条完整的通路:正文里划选一段话(或面板里的一条批注)→ 悬浮窗 /
卡片上的「问助手」→ 语境条 → 随提问发到问答后端 → 进入模型上下文。

容易在改动中悄悄回退的几条:

- **语境条目的构造只有一处**。形状、去重、「仅本机不出本机」这三件事都在
  context-item.js;面板与助手两边都只调它,谁都不自己拼一个上下文对象。
  多一处构造点就多一处能绕开那条边界的路。
- **仅本机的批注进不了语境**。它的承诺是「只在那台设备上」,而语境会离开
  浏览器。前端在 forAnnotation 里挡,服务端在 visibility 的取值里挡,两道闸
  各自成立;两边的用例都跑。
- **同一条来源连送两次只有一条语境**。参照 poco-ai/Agentero#614:按 id 追加会
  让同一条来源排出一串重复条目,而删其中一条又会把同 id 的其余条目一起删掉。
- **不带 context 的请求行为不变**。老客户端(浏览器缓存里的旧 JS、脚本调用)
  不带这个字段,拿到的 prompt 与这次改动之前逐字相同。
- 服务端那侧的取值上限与前端同源:ContextItem 的每个字段长度、条数上限,
  两边对「多长算超限」必须给出同一个答案。
"""

from __future__ import annotations

import re
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MKCONFIG = ROOT / "mkdocs.yml"
ANNO_JS = ROOT / "docs" / "_static" / "js" / "annotation.js"
ANNO_CSS = ROOT / "docs" / "_static" / "css" / "annotation.css"
CHAT_JS = ROOT / "docs" / "_static" / "js" / "chat-widget.js"
CHAT_CSS = ROOT / "docs" / "_static" / "css" / "chat-widget.css"
CTX_JS = ROOT / "docs" / "_static" / "js" / "context-item.js"
CTX_CHECK = ROOT / "test" / "js" / "context-item-check.mjs"
AGENT_SERVER = ROOT / "agent-server"
SRV_TS = AGENT_SERVER / "src" / "server.ts"
AGENT_TS = AGENT_SERVER / "src" / "agent.ts"
CTX_TS = AGENT_SERVER / "src" / "context.ts"
UNIT_TS = AGENT_SERVER / "src" / "unit-check.ts"


def _strip_comments(src: str) -> str:
    """去掉 /* ... */ 注释,断言只读代码。"""
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _squash(src: str) -> str:
    """把空白压平,方便跨行匹配。"""
    return re.sub(r"\s+", " ", src)


class TestContextItemModule(unittest.TestCase):
    """语境条目的构造与去重收在一个文件里。"""

    @classmethod
    def setUpClass(cls):
        cls.src = _strip_comments(_read(CTX_JS))
        cls.mk = _read(MKCONFIG)

    def test_module_is_injected_before_both_panels(self):
        block = self.mk.split("extra_javascript:")[1].split("extra_css:")[0]
        entries = [e.split("?", 1)[0] for e in re.findall(r"-\s*'([^']+)'", block)]
        self.assertIn("_static/js/context-item.js", entries, "mkdocs.yml 未注入 context-item.js")
        self.assertIn("_static/js/panel-shared.js", entries)
        self.assertLess(
            entries.index("_static/js/context-item.js"),
            entries.index("_static/js/panel-shared.js"),
            "context-item.js 必须排在 panel-shared.js 之前:hooks 追加的两个面板脚本都读它",
        )

    def test_exports_the_shared_entry_points(self):
        for name in ("forSelection", "forAnnotation", "upsert", "remove", "toPayload"):
            self.assertIn(f"{name}: {name}", self.src, f"window.__aipmContext 未导出 {name}")

    def test_limits_match_the_server_side(self):
        ts = _read(CTX_TS)
        js_limits = dict(
            (key, int(value))
            for key, value in re.findall(r"(\w+): (\d+)", re.search(r"var LIMITS = (\{[^}]*\})", self.src).group(1))
        )
        self.assertEqual(len(js_limits), 6, f"前端的 LIMITS 少了解析不出的项:{js_limits}")
        for key, value in js_limits.items():
            self.assertIn(f"{key}: {value}", ts, f"服务端 CONTEXT_LIMITS.{key} 与前端不一致")
        js_max = int(re.search(r"var MAX_ITEMS = (\d+)", self.src).group(1))
        self.assertIn(f"CONTEXT_MAX_ITEMS = {js_max}", ts)

    def test_local_never_becomes_context(self):
        fn = self.src[self.src.index("function forAnnotation(") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn('visibility !== "public" && visibility !== "private"', fn)
        self.assertIn("return null", fn)

    def test_upsert_refreshes_in_place(self):
        fn = self.src[self.src.index("function upsert(") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("items[i] = item", fn, "同 id 的条目应在原位刷新")
        self.assertNotIn("push", fn.split("items.length >= MAX_ITEMS")[0], "同 id 时不得追加")


class TestAnnotationPanelHandsOffContext(unittest.TestCase):
    """批注面板只负责挑出「正在读的东西」,不自己拼语境。"""

    @classmethod
    def setUpClass(cls):
        cls.js = _strip_comments(_read(ANNO_JS))
        cls.css = _strip_comments(_read(ANNO_CSS))

    def test_toolbar_has_ask_button_right_of_the_pen(self):
        html = self.js[self.js.index("toolbar.innerHTML") :]
        html = html[: html.index("document.body.appendChild(toolbar)")]
        self.assertIn("aipm-anno__tb-ask", html, "悬浮窗缺少「问助手」")
        self.assertLess(
            html.index("aipm-anno__tb-annotate"),
            html.index("aipm-anno__tb-ask"),
            "「问助手」应在「写批注」右侧",
        )
        self.assertLess(html.index("aipm-anno__tb-ask"), html.index("aipm-anno__tb-cancel"))
        self.assertIn(".aipm-anno__tb-ask", self.css, "缺少这颗按钮的样式")

    def test_toolbar_click_routes_to_the_ask_path(self):
        self.assertIn('closest(".aipm-anno__tb-ask")', self.js)
        self.assertIn("askAboutSelection()", self.js)

    def test_selection_ask_locks_the_selection_then_clears_it(self):
        fn = self.js[self.js.index("function askAboutSelection()") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("ctxItem.forSelection(", fn, "划选那条路必须走共享的构造入口")
        self.assertIn("hideToolbar()", fn)
        self.assertIn("clearSelection()", fn, "动作已完成的路径要撤掉选区,否则悬浮窗会被招回来")

    def test_card_button_is_disabled_for_local_only(self):
        fn = self.js[self.js.index("function askButton(") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("isLocal(anno)", fn)
        self.assertIn("b.disabled = true", fn, "仅本机那条必须按不动")
        self.assertIn("askAssistant(annotationContext(anno))", fn)

    def test_context_is_built_in_exactly_one_place(self):
        self.assertEqual(
            self.js.count("ctxItem.forSelection("),
            1,
            "划选语境的构造只允许有一处",
        )
        self.assertEqual(
            self.js.count("ctxItem.forAnnotation("),
            1,
            "批注语境的构造只允许有一处",
        )
        self.assertEqual(
            self.js.count("attachContext("),
            1,
            "只有 askAssistant 能把手里的条目交给助手面板",
        )

    def test_quote_falls_back_to_the_anchored_text(self):
        fn = self.js[self.js.index("function annotatedText(") :]
        fn = fn[: fn.index("\n  }") + 4]
        self.assertIn("resolved[anno.id]", fn, "应优先取正文里锚好的那一段")
        self.assertIn("字符", fn, "位置描述那种兜底不该当成原文送出去")


class TestChatPanelConsumesContext(unittest.TestCase):
    """助手面板把语境摆出来、随提问发出去、并跟着会话留下来。"""

    @classmethod
    def setUpClass(cls):
        cls.js = _strip_comments(_read(CHAT_JS))
        cls.css = _strip_comments(_read(CHAT_CSS))

    def test_context_bar_sits_above_the_input(self):
        composer = self.js[self.js.index('class="aipm-chat__composer"') :]
        composer = composer[: composer.index("</form>")]
        self.assertIn("aipm-chat__ctxbar", composer, "语境条应在输入卡片里")
        self.assertLess(
            composer.index("aipm-chat__ctxbar"),
            composer.index("aipm-chat__input"),
            "语境条在输入框上方",
        )
        self.assertIn(".aipm-chat__ctxbar", self.css)
        self.assertIn('order: -2', self.css, "窄条形态里语境条要排在附件之上")

    def test_exposes_attach_context_to_the_annotation_panel(self):
        api = self.js[self.js.index("window.__aipmChat = {") :]
        self.assertIn("attachContext:", api)
        self.assertIn("SHARED.claim(\"chat\")", api, "开面板要跟点 FAB 走同一条互斥路")
        self.assertIn("isOpen:", api)

    def test_send_carries_context(self):
        post = self.js[self.js.index("const postUser = (text, files, context)") :]
        post = post[: post.index("\n  };") + 5]
        self.assertIn("history.push({ role: \"user\", content: sent, context: ctxItems })", _squash(post))
        self.assertIn("runTurn(sent, ctxItems)", post)

        turn = self.js[self.js.index("const runTurn = async (message, context)") :]
        turn = turn[: turn.index("\n  };") + 5]
        self.assertIn("CTX.toPayload(context)", turn)
        self.assertIn("if (wire.length) body.context = wire", turn, "没有语境时不带这个字段")

    def test_history_sent_to_the_server_stays_two_fielded(self):
        turn = self.js[self.js.index("const runTurn = async (message, context)") :]
        turn = turn[: turn.index("\n  };") + 5]
        self.assertIn(
            ".map((m) => ({ role: m.role, content: m.content }))",
            _squash(turn),
            "语境随行,不进 history —— 发出去的 history 仍然只有 role 与 content",
        )

    def test_regenerate_replays_the_same_context(self):
        fn = self.js[self.js.index("const regenerate = (aiWrap)") :]
        fn = fn[: fn.index("\n  };") + 5]
        self.assertIn("runTurn(rec.content, rec.context || [])", fn)

    def test_user_bubble_keeps_a_record_of_the_context(self):
        fn = self.js[self.js.index("const addUserBubble = (text, files, context)") :]
        fn = fn[: fn.index("\n  };") + 5]
        self.assertIn("aipm-chat__ctx-inline", fn, "气泡上要留一份,回头翻会话才看得见当时拿哪段话问的")
        self.assertIn(".aipm-chat__ctx-inline", self.css)

    def test_restored_context_is_shape_checked(self):
        self.assertIn("sanitizeCtx", self.js)
        fn = self.js[self.js.index("const sanitizeCtx = (list)") :]
        fn = fn[: fn.index("\n  };") + 5]
        self.assertIn('"selection"', fn)
        self.assertIn('"annotation"', fn)


class TestServerAcceptsContext(unittest.TestCase):
    """问答后端认识 context,并且自己不接受「仅本机」。"""

    @classmethod
    def setUpClass(cls):
        cls.srv = _read(SRV_TS)
        cls.agent = _read(AGENT_TS)
        cls.ctx = _read(CTX_TS)

    def test_schema_takes_context_with_an_empty_default(self):
        schema = self.srv[self.srv.index("const ChatBodySchema") :]
        schema = schema[: schema.index("\n});") + 4]
        self.assertIn("context: z.array(ContextItemSchema).max(CONTEXT_MAX_ITEMS).default([])", _squash(schema))

    def test_visibility_enum_excludes_local(self):
        item = self.srv[self.srv.index("const ContextItemSchema") :]
        item = item[: item.index("\n});") + 4]
        self.assertIn("z.enum(['public', 'private'])", _squash(item))
        self.assertNotIn("'local'", item, "「仅本机」不该有进服务端的取值")

    def test_context_reaches_the_agent(self):
        self.assertIn("context: parsed.context", self.srv)
        self.assertIn("context?: ContextItem[]", self.agent)

    def test_prompt_puts_context_before_the_question(self):
        fn = self.agent[self.agent.index("function buildPrompt(") :]
        fn = fn[: fn.index("\n}") + 2]
        self.assertIn("renderContext(context, siteBase)", fn)
        self.assertLess(fn.index("renderContext("), fn.index("'用户(最新问题):'"), "语境在问题之前")
        self.assertIn("if (lines.length === 0) return message", _squash(fn), "三者都空时逐字返回原 message")

    def test_renderer_is_zero_dependency_and_declares_data_not_instructions(self):
        self.assertNotIn("import", _strip_comments(self.ctx).split("\n\n")[0], "context.ts 要保持零依赖,才能被 unit-check 直接跑")
        self.assertIn("不是指令", self.ctx)
        self.assertIn("renderContext", _read(UNIT_TS), "unit-check 要覆盖语境的渲染")


class TestContextItemBehaviour(unittest.TestCase):
    """真正跑一遍 context-item.js —— 上面那些是形状,这里是行为。"""

    @unittest.skipUnless(shutil.which("node"), "需要 node 才能跑浏览器脚本的行为断言")
    def test_node_check_passes(self):
        proc = subprocess.run(
            ["node", str(CTX_CHECK)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("全部通过", proc.stdout)
        self.assertGreaterEqual(proc.stdout.count("PASS"), 30, proc.stdout)


if __name__ == "__main__":
    unittest.main()
