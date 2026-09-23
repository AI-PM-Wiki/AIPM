"""Agent 写批注这条通路的真实浏览器用例(2026-09-23)。

    uv run python3 test/browser/run.py annotation

跑的是完整一条路:真站点(mkdocs build 出来的那份)、真浏览器、真 agent-server、
假模型 API、以及一份**真的批注服务夹具**(真 HTTP、真跨源)。假模型那一轮里回一个
tool_use,agent-server 那边真的执行工具、把建议经 SSE 交给页面;页面上出现一张卡,
点「采纳」之后由批注面板写下去。于是「模型提了什么」「页面上点了什么」「批注服务
收到了什么」是同一次运行里可以对着看的三端。

覆盖这条通路要锁住的每一件事:

- **真的写得下去**:采纳之后批注服务收到了那一条,正文里也画出来了 —— 走的是用户
  自己的会话(带他自己的 bearer token),不是助手那一侧直连;
- **可见范围由用户挑定**:卡上三档可切换,挑中哪一档就写哪一档;
- **仅本机一个字节都不出网**:采纳之后本地存下了,批注服务**一条写入记录都没有**;
- **未登录选公开/私有不会静默出网**:不写、存成草稿、页面走去登录;
- **引文不在正文里就不写**:锚不到就没有可写的位置,卡片上直说,而不是静默丢或写歪;
- **换页之后那条建议写不下去**:卡片还在,但它说的那一页已经不是当前这一页;
- **模型提的那一条不会被助手这一侧直接写**:写入这件事在页面上只有「采纳」这一下。
"""
from __future__ import annotations

import json
import unittest

from playwright.sync_api import sync_playwright

from harness import (
    ANNO_ORIGIN,
    ANNO_TOKEN,
    ANNO_USER,
    WORK,
    AgentServer,
    AnnotationApi,
    Browser,
    StaticSite,
    StubModel,
    assert_no_page_errors,
    build_site,
)

#: 用例跑在这一页上:正文有段落、有稳定的小标题,引文从它里面取。
PAGE = "/ai/rag/"

#: 助手在页面上提建议用的那个工具名(模型侧看到的全名)。
TOOL = "mcp__wiki__propose_annotation"


class _Stack:
    """一整套跑得起来的东西:真站点、假模型、真的 agent-server、批注服务夹具。

    建站要几十秒,整份文件共用一份。`max_turns` 给 3:一条建议要用掉两轮
    (提建议 → 收到工具结果再作答),留一轮余量。
    """

    def __init__(self):
        self.site_dir = build_site(WORK / "site-annotation")
        self.site = StaticSite(self.site_dir)
        self.model = StubModel()
        self.server = AgentServer(self.site, self.model, max_turns=3)
        self.api = AnnotationApi()
        self.pw = sync_playwright().start()

    def close(self) -> None:
        self.server.close()
        self.model.close()
        self.api.close()
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


class AgentAnnotationCase(unittest.TestCase):
    """这条通路共用的东西:那一整套服务,以及「提一条建议」「采纳它」这两下。"""

    def setUp(self):
        self.stack = stack()
        self.site = self.stack.site
        self.api = self.stack.api
        self.model = self.stack.model
        self.api.reset()
        self.browser = Browser(
            self.stack.pw,
            self.site.base,
            # 这个文件里批注服务是这条通路自己的一段:它上面的报错计入失败,
            # 不被当成第三方的记录挡下(见 harness.Browser)。
            also_ours=(ANNO_ORIGIN,),
        )
        self.page = self.browser.page
        self.page.goto(self.site.base + PAGE, wait_until="load")
        self.login()
        self.wait_annos_loaded()
        # 开助手面板 —— 与真实用户点 FAB 是同一条路(输入条在面板里,不开就填不进去)
        self.open_chat()

    def tearDown(self):
        self.browser.close()

    # ---- 页面上这几件工具 ----

    def login(self) -> None:
        """把一份会话放进 localStorage 再重新加载 —— 用户登录后回到站上就是这个状态。

        这一下不放进 `add_init_script`:那种脚本**每次导航都会再跑一遍**,于是用例
        里「把登录态摘掉」下一跳就被它盖回来了,未登录那条路根本走不到。"""
        self.page.evaluate(
            "(raw) => localStorage.setItem('aipm-anno-auth', raw)",
            _js({"token": ANNO_TOKEN, "user": ANNO_USER, "admin": False}),
        )
        self.page.reload(wait_until="load")
        self.page.wait_for_function("() => window.__aipmChat && window.__aipmAnno")

    def logout(self) -> None:
        """摘掉会话再重新加载 —— 未登录的人打开这一页就是这个状态。"""
        self.page.evaluate("() => localStorage.removeItem('aipm-anno-auth')")
        self.page.reload(wait_until="load")
        self.page.wait_for_function("() => window.__aipmChat && window.__aipmAnno")

    def open_chat(self) -> None:
        """开助手面板 —— 与真实用户点 FAB 是同一条路。

        面板的开关**不跨页面加载**:换页或刷新之后它是收起的,恢复出来的卡片因此
        先要有人把面板打开才看得见。用例照做,不绕过界面。"""
        if self.page.locator(".aipm-chat__input").is_visible():
            return
        self.page.click(".aipm-chat__fab")
        self.page.wait_for_selector(".aipm-chat__input", state="visible")

    def wait_annos_loaded(self) -> None:
        """等批注面板把这一页的批注读完(它自己那一趟请求回来)。

        不等的话,「服务端一条写入都没有」这种断言可能量在请求发出之前 —— 那是
        量早了,不是真的没发。"""
        self.page.wait_for_function(
            "() => performance.getEntriesByType('resource')"
            ".some((e) => e.name.includes('/api/annotations'))"
        )

    def select_text(self) -> dict:
        """在正文第一段里划一段话(真选区、真 selectionchange),返回那段引文。

        用真选区而不是直接调内部函数:悬浮窗是 `selectionchange` 摆出来的,这条路
        与用户手划逐字相同。"""
        return self.page.evaluate(
            """() => {
                const p = document.querySelector('.md-content__inner p');
                const node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
                const text = node.textContent;
                const start = 4;
                const end = Math.min(text.length, start + 18);
                const range = document.createRange();
                range.setStart(node, start);
                range.setEnd(node, end);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                document.dispatchEvent(new Event('selectionchange'));
                return {
                    quote: text.slice(start, end),
                    prefix: text.slice(Math.max(0, start - 8), start),
                    suffix: text.slice(end, end + 8)
                };
            }"""
        )

    def ask_about_selection(self) -> dict:
        """划选 → 悬浮窗的「问助手」:这一页因此进了语境,建议才有可写的页面。"""
        anchor = self.select_text()
        self.page.click(".aipm-anno__tb-ask")
        self.page.wait_for_selector(".aipm-chat__ctx-chip", state="visible")
        return anchor

    def propose(self, *, message: str = "把这段讲 RAG 的地方标一下", **proposal) -> dict:
        """划一段话、把它送进对话,再让假模型在下一轮提一条建议。

        `proposal` 是模型这一轮给工具的入参;**引文缺省就是刚才划的那一段** ——
        这正是真实用户会走的路(划一段话问助手,助手对这一段提建议)。要试别的引文
        (比如页面上根本没有的一句)就显式传 quote。

        返回刚才划的那段引文；服务端核对当前页面与选区所属页面。"""
        anchor = self.ask_about_selection()
        tool_input = {
            "quote": anchor["quote"],
            "prefix": anchor["prefix"],
            "suffix": anchor["suffix"],
        }
        tool_input.update(proposal)
        self.model.set_script(
            [
                {"tools": [{"name": TOOL, "input": tool_input}]},
                {"text": "已经在卡片里给你标出来了。"},
            ]
        )
        self.send(message)
        return anchor

    def send(self, text: str) -> dict:
        """发一句问话,等这一轮跑完,返回这一轮的请求体。"""
        before = len(self.browser.chat_bodies)
        self.page.fill(".aipm-chat__input", text)
        self.page.click(".aipm-chat__send")
        self.page.wait_for_function(
            "() => !document.querySelector('.aipm-chat__send').classList.contains('is-stop')"
        )
        self.assertGreater(len(self.browser.chat_bodies), before, "没有发出 /api/chat 请求")
        return self.browser.chat_bodies[-1]

    def card(self, index: int = 0):
        return self.page.locator(".aipm-chat__proposal").nth(index)

    def wait_card(self, index: int = 0) -> None:
        """等卡片露面 —— 它是随那一轮的 SSE 帧长出来的。"""
        self.card(index).wait_for(state="visible", timeout=8000)

    def adopt(self, index: int = 0, visibility: str | None = None) -> None:
        """点「采纳」。visibility 给了就先在卡上把可见范围切到那一档。"""
        card = self.card(index)
        if visibility is not None:
            card.locator(".aipm-chat__proposal-visbtn", has_text=VISIBILITY_LABEL[visibility]).click()
        card.locator(".aipm-chat__proposal-accept").click()

    def settle(self, index: int = 0) -> str:
        """等卡片给出结果(写完 / 失败 / 存成草稿),返回它写下的那句话。"""
        card = self.card(index)
        self.page.wait_for_function(
            """(el) => !!el.getAttribute('data-state') && el.getAttribute('data-state') !== 'writing'""",
            arg=card.element_handle(timeout=8000),
            timeout=8000,
        )
        return card.locator(".aipm-chat__proposal-state").inner_text()

    def marks(self) -> list[str]:
        return self.page.locator("mark.aipm-anno-mark").all_inner_texts()

    def wait_marks(self, count: int = 1) -> None:
        self.page.wait_for_function(
            "(n) => document.querySelectorAll('mark.aipm-anno-mark').length >= n",
            arg=count,
            timeout=8000,
        )

    def local_annotations(self) -> list[dict]:
        """本机批注(localStorage 里那一份)。"""
        return self.page.evaluate(
            """() => {
                const raw = localStorage.getItem('aipm-anno-local');
                const data = raw ? JSON.parse(raw) : { pages: {} };
                return Object.values(data.pages || {}).flat();
            }"""
        )

    def test_current_page_without_selection_can_receive_a_page_proposal(self):
        self.model.set_script([
            {"tools": [{"name": TOOL, "input": {"scope": "page", "body": "补充适用范围"}}]},
            {"text": "请确认建议。"},
        ])
        body = self.send("为当前文章提出一条评论建议")
        self.assertEqual(body["page"], PAGE)
        self.assertNotIn("context", body)
        self.wait_card()
        self.assertIn("整页", self.card().inner_text())
        self.assertIn(self.site.base + PAGE, json.dumps(self.model.messages()[-2:], ensure_ascii=False))
        self.adopt(visibility="local")
        self.assertIn("已写入", self.settle())
        self.assertEqual(self.local_annotations()[0]["page"], PAGE)
        self.assertEqual(self.api.writes(), [])
        assert_no_page_errors(self, self.browser)

    def test_new_turn_tracks_the_page_after_navigation(self):
        self.page.goto(self.site.base + "/ai/prompting/", wait_until="load")
        self.open_chat()
        self.model.set_script([
            {"tools": [{"name": TOOL, "input": {"scope": "page", "body": "补充适用范围"}}]},
            {"text": "请确认建议。"},
        ])
        body = self.send("针对当前文章提出建议")
        self.assertEqual(body["page"], "/ai/prompting/")
        self.assertNotIn("context", body)
        self.wait_card()
        self.adopt(visibility="local")
        self.assertIn("已写入", self.settle())
        self.assertEqual(self.local_annotations()[0]["page"], "/ai/prompting/")
        assert_no_page_errors(self, self.browser)

    def test_regeneration_keeps_the_original_page_after_navigation(self):
        self.model.set_script([
            {"tools": [{"name": TOOL, "input": {"scope": "page", "body": "补充适用范围"}}]},
            {"text": "请确认建议。"},
        ])
        self.send("针对当前文章提出建议")
        self.wait_card()
        self.page.goto(self.site.base + "/ai/prompting/", wait_until="load")
        self.open_chat()
        self.model.set_script([
            {"tools": [{"name": TOOL, "input": {"scope": "page", "body": "补充适用范围"}}]},
            {"text": "请确认建议。"},
        ])
        before = len(self.browser.chat_bodies)
        self.page.locator("[aria-label=\"重新生成回答\"]").last.click()
        self.page.wait_for_function("() => !document.querySelector(\".aipm-chat__send\").classList.contains(\"is-stop\")")
        self.assertEqual(len(self.browser.chat_bodies), before + 1)
        self.assertEqual(self.browser.chat_bodies[-1]["page"], PAGE)
        self.wait_card()
        self.adopt()
        self.assertIn("不在当前页面", self.settle())
        self.assertEqual(self.api.writes(), [])
        assert_no_page_errors(self, self.browser)

    # ---- 1. 真的写得下去 ----

    def test_a_proposal_is_written_by_the_users_own_session(self):
        """整条链路:划一段话问助手 → 模型提建议 → 采纳 → 批注服务收到这一条 → 正文里画出来。"""
        anchor = self.propose(
            body="这里是 RAG 的定义",
            color="blue",
            style="underline",
            visibility="public",
            note="建议标成结论色",
        )
        self.assertEqual(self.browser.chat_bodies[-1]["page"], PAGE)
        self.assertEqual(self.browser.chat_bodies[-1]["context"][0]["page"], PAGE)
        self.wait_card()

        card = self.card()
        self.assertIn(anchor["quote"], card.locator(".aipm-chat__proposal-quote").inner_text())
        self.assertIn("RAG", card.locator(".aipm-chat__proposal-body").inner_text())
        self.assertIn("建议标成结论色", card.locator(".aipm-chat__proposal-note").inner_text())
        # 模型说的那一档是卡上的缺省值(用户还能改)
        self.assertEqual(card.locator(".aipm-chat__proposal-visbtn[aria-pressed='true']").inner_text(), "公开")

        self.assertEqual(self.api.writes(), [], "还没点采纳,服务端不该收到写入")
        self.adopt()
        self.assertIn("已写入", self.settle())

        writes = self.api.writes()
        self.assertEqual(len(writes), 1, f"服务端收到的写入不是一条:{writes}")
        sent = writes[0]["body"]
        self.assertEqual(sent["page"], PAGE)
        self.assertEqual(sent["visibility"], "public")
        self.assertEqual(sent["color"], "blue")
        self.assertEqual(sent["style"], "underline")
        self.assertEqual(sent["body"], "这里是 RAG 的定义")
        self.assertEqual(writes[0]["authorization"], f"Bearer {ANNO_TOKEN}", "写入没有带用户自己的会话")
        selectors = sent["target"]["selectors"]
        self.assertEqual([s["type"] for s in selectors][:1], ["TextQuoteSelector"])
        self.assertEqual(selectors[0]["exact"], anchor["quote"], "发出去的不是页面上那段原文")
        self.wait_marks()
        self.assertIn(anchor["quote"], "".join(self.marks()))
        assert_no_page_errors(self, self.browser)

    # ---- 2. 可见范围由用户在卡上挑定 ----

    def test_the_visibility_the_user_picks_is_what_gets_written(self):
        """模型提的是公开,用户在卡上改成私有 —— 写下去的就是私有。"""
        self.propose(visibility="public", body="只给自己看")
        self.wait_card()
        self.adopt(visibility="private")
        self.assertIn("已写入", self.settle())

        writes = self.api.writes()
        self.assertEqual(len(writes), 1, f"服务端收到的写入不是一条:{writes}")
        self.assertEqual(writes[0]["body"]["visibility"], "private")
        public = [a for a in self.api.stored if a["visibility"] == "public"]
        self.assertEqual(public, [], "用户挑的是私有,却写成了公开")
        assert_no_page_errors(self, self.browser)

    # ---- 3. 仅本机一个字节都不出网 ----

    def test_a_local_proposal_never_reaches_the_server(self):
        """模型提「仅本机」(也是缺省档):采纳之后本地存下,服务端一条写入都没有。"""
        self.propose(body="留在自己机器上", note="这条不用发出去")
        self.wait_card()
        self.assertIn("仅本机", self.card().locator(".aipm-chat__proposal-visbtn[aria-pressed='true']").inner_text())

        self.adopt()
        self.assertIn("已写入", self.settle())
        self.assertIn("仅本机", self.settle())

        self.assertEqual(self.api.writes(), [], "仅本机那条出了网")
        local = self.local_annotations()
        self.assertEqual(len(local), 1, f"本机批注不是一条:{local}")
        self.assertEqual(local[0]["body"], "留在自己机器上")
        self.assertEqual(local[0]["visibility"], "local")
        self.wait_marks()
        assert_no_page_errors(self, self.browser)

    def test_visibility_is_locked_while_accepting(self):
        self.propose(visibility="public", body="公开建议")
        self.wait_card()
        result = self.page.evaluate("""() => {
            const card = document.querySelector('.aipm-chat__proposal');
            card.querySelector('.aipm-chat__proposal-accept').click();
            const buttons = [...card.querySelectorAll('.aipm-chat__proposal-visbtn')];
            const locked = buttons.every((button) => button.disabled);
            buttons.find((button) => button.textContent === '仅本机').click();
            const selected = card.querySelector('.aipm-chat__proposal-visbtn[aria-pressed="true"]');
            return { locked, selected: selected.textContent };
        }""")
        self.assertTrue(result["locked"])
        self.assertEqual(result["selected"], "公开")
        self.assertIn("已写入:公开", self.settle())
        self.assertEqual(len(self.api.writes()), 1)
        self.assertEqual(self.api.writes()[0]["body"]["visibility"], "public")
        assert_no_page_errors(self, self.browser)

    def test_page_comment_login_resumes_without_selectors(self):
        self.propose(scope="page", quote="", prefix="", suffix="", visibility="public", body="整页讨论")
        self.wait_card()
        self.logout()
        self.open_chat()
        self.wait_card()
        self.adopt()
        self.page.wait_for_function("""() => {
            const auth = JSON.parse(localStorage.getItem('aipm-anno-auth') || '{}');
            return !!auth.token && !localStorage.getItem('aipm-anno-draft');
        }""", timeout=8000)
        writes = self.api.writes()
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["body"]["target"], {"selectors": [], "scope": "page"})
        self.assertEqual(writes[0]["body"]["body"], "整页讨论")
        self.assertEqual(writes[0]["authorization"], f"Bearer {ANNO_TOKEN}")
        assert_no_page_errors(self, self.browser)

    def test_lost_response_keeps_original_visibility_after_reload(self):
        self.propose(visibility="public", body="响应丢失后保持公开")
        self.wait_card()
        self.api.drop_next_write_response = True
        self.adopt()
        self.assertIn("结果未知", self.settle())
        self.assertEqual(len(self.api.stored), 1)
        self.assertEqual(self.api.stored[0]["visibility"], "public")
        local_button = self.card().locator(".aipm-chat__proposal-visbtn", has_text="仅本机")
        self.assertTrue(local_button.is_disabled())
        self.page.reload(wait_until="load")
        self.open_chat()
        self.wait_card()
        local_button = self.card().locator(".aipm-chat__proposal-visbtn", has_text="仅本机")
        self.assertTrue(local_button.is_disabled())
        self.assertTrue(self.card().locator(".aipm-chat__proposal-dismiss").is_disabled())
        self.page.evaluate("() => document.querySelector('.aipm-chat__proposal-visbtn').click()")
        self.assertEqual(self.card().locator(".aipm-chat__proposal-visbtn[aria-pressed=true]").inner_text(), "公开")
        self.assertEqual(self.local_annotations(), [])


    def test_failed_write_is_retried_after_reload(self):
        self.propose(visibility="public", body="网络恢复后保存")
        self.wait_card()
        self.page.context.set_offline(True)
        self.adopt()
        self.assertIn("结果未知", self.settle())
        self.assertEqual(self.api.writes(), [])
        self.page.context.set_offline(False)
        self.page.reload(wait_until="load")
        self.open_chat()
        self.wait_card()
        self.adopt()
        self.assertIn("已写入:公开", self.settle())
        self.assertEqual(len(self.api.writes()), 1)
        self.assertEqual(self.api.writes()[0]["body"]["body"], "网络恢复后保存")


    # ---- 4. 未登录选公开/私有:不静默出网 ----

    def test_a_public_proposal_without_login_goes_through_the_login_round_trip(self):
        """未登录的人采纳一条公开的建议:不静默出网 —— 存成草稿、去登录、
        回跳之后由既有的草稿通路补发,那一条这才进到服务端。"""
        anchor = self.propose(visibility="public", body="要发出去的")
        self.wait_card()

        # 把登录态摘掉再点采纳 —— 与「本来就是未登录」是同一条路
        self.logout()
        self.open_chat()
        self.wait_card()
        self.assertEqual(self.api.writes(), [], "还没点采纳,服务端不该收到写入")

        self.adopt()

        # 这一趟会离开页面(夹具把 GitHub 那一半跳过去,直接带着一次性 code 回到
        # 本页),回来之后草稿自动补发 —— 卡片在导航里没了,所以这里等的是**结果**:
        # 正文里画出那一笔,而不是卡片上那句话。
        self.wait_marks()
        self.assertIn(anchor["quote"], "".join(self.marks()))
        assert_no_page_errors(self, self.browser)

        writes = self.api.writes()
        self.assertEqual(len(writes), 1, f"服务端收到的写入不是一条:{writes}")
        self.assertEqual(writes[0]["body"]["body"], "要发出去的")
        self.assertEqual(writes[0]["body"]["visibility"], "public")
        self.assertEqual(writes[0]["body"]["page"], PAGE)
        self.assertTrue(
            writes[0]["body"]["target"]["selectors"], "补发出去的那条没有锚点"
        )
        self.assertEqual(
            writes[0]["authorization"], f"Bearer {ANNO_TOKEN}", "补发没有带上登录后的会话"
        )
        self.assertEqual(
            [r for r in self.api.requests if r["method"] == "POST" and r["path"] == "/api/annotations"],
            writes,
            "服务端收到的写入请求不止这一条:未登录那一下也在写",
        )
        # 草稿被用掉:登录前那一份不该留在本地等到下次又发一遍
        self.assertIsNone(
            self.page.evaluate("() => localStorage.getItem('aipm-anno-draft')"),
            "草稿发出去之后没有清掉",
        )
        logins = self.api.logins()
        self.assertEqual(len(logins), 1, f"登录跳转不是一次:{logins}")
        self.assertIn(PAGE, logins[0]["params"]["return"], "登录回来回不到原来那一页")

    # ---- 5. 引文不在正文里就不写 ----

    def test_a_quote_that_is_not_on_the_page_is_refused(self):
        """模型编了一句页面上没有的话:锚不到就不写,卡片上直说。"""
        self.propose(quote="这句话在这一页上根本不存在,是模型编的", body="锚不上的批注")
        self.wait_card()
        self.adopt()

        state = self.settle()
        self.assertIn("不在本页正文里", state)
        self.assertEqual(self.api.writes(), [])
        self.assertEqual(self.local_annotations(), [])
        self.assertEqual(self.marks(), [])
        assert_no_page_errors(self, self.browser)

    # ---- 6. 换页之后写不下去 ----

    def test_a_proposal_for_a_page_the_reader_left_is_refused(self):
        """卡片还在,但它说的那一页已经不是当前这一页 —— 不写。"""
        self.propose(visibility="public", body="换页之后再采纳")
        self.wait_card()

        self.page.goto(self.site.base + "/", wait_until="load")
        self.page.wait_for_function("() => window.__aipmAnno")
        # 卡片属于会话、不属于页面:换页之后它还在(这一点是刻意的)
        self.open_chat()
        self.wait_card()
        self.adopt()
        self.assertIn("不在当前页面", self.settle())
        self.assertEqual(self.api.writes(), [], "换页之后把批注写到了别的页上")
        self.assertEqual(self.local_annotations(), [])
        assert_no_page_errors(self, self.browser)


#: 卡上三档的中文说法(与 chat-widget.js 的 PROPOSAL_VIS 同一份)。
VISIBILITY_LABEL = {
    "local": "仅本机",
    "private": "仅自己可见",
    "public": "公开",
}


def _js(value) -> str:
    return json.dumps(value, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
