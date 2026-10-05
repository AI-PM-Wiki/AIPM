"""Agent proposal confirmation over a real browser and loopback HTTP services."""
from __future__ import annotations

import unittest

from playwright.sync_api import sync_playwright

from check_agent_annotation import PAGE, TOOL, _Stack, _js
from harness import ANNO_ORIGIN, Browser, assert_no_page_errors


class AgentConfirmationAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stack = _Stack()

    @classmethod
    def tearDownClass(cls):
        cls.stack.close()

    def setUp(self):
        self.stack.api.reset()
        self.browser = Browser(self.stack.pw, self.stack.site.base, also_ours=(ANNO_ORIGIN,))
        self.addCleanup(self.browser.close)
        self.page = self.browser.page
        self.page.goto(self.stack.site.base + PAGE, wait_until="load")
        self.session = self.stack.api.login()
        self.page.evaluate(
            "(raw) => localStorage.setItem('aipm-anno-auth', raw)",
            _js(self.session),
        )
        self.page.add_init_script("window.__aipmAnnoAgentEnabled = true")
        self.page.reload(wait_until="load")
        self.page.wait_for_function(
            "() => window.__aipmIntegrityReady === true || window.__aipmIntegrityFailed === true",
            timeout=10000,
        )
        state = self.page.evaluate("""() => ({ ready: window.__aipmIntegrityReady,
            failed: window.__aipmIntegrityFailed, chat: !!window.__aipmChat,
            store: !!window.__aipmAnnoStore, auth: !!window.__aipmAnnoAuth,
            scripts: [...document.scripts].map(script => script.src).filter(Boolean) })""")
        self.assertTrue(state["ready"] and state["chat"] and state["store"] and state["auth"],
                        f"integrity boot state: {state}; page errors: {self.browser.page_errors}; "
                        f"console errors: {self.browser.console_errors}")
        self.page.click(".aipm-chat__fab")
        self.page.wait_for_selector(".aipm-chat__input", state="visible")

    def propose(self, visibility: str, body: str, paragraph_index: int = 0) -> None:
        anchor = self.page.evaluate(
            """(paragraphIndex) => {
                const p = document.querySelectorAll('.md-content__inner p')[paragraphIndex];
                if (!p) throw new Error("missing paragraph index " + paragraphIndex);
                const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode()) && node.textContent.trim().length === 0) {}
                if (!node) throw new Error("paragraph has no selectable text at index " + paragraphIndex);
                const text = node.textContent;
                const start = 4;
                const end = Math.min(text.length, start + 18);
                const range = document.createRange();
                range.setStart(node, start);
                range.setEnd(node, end);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                document.dispatchEvent(new Event('selectionchange'));
                return { quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - 8), start),
                    suffix: text.slice(end, end + 8) };
            }""",
            paragraph_index,
        )
        self.page.click(".aipm-anno__tb-ask")
        self.page.wait_for_selector(".aipm-chat__ctx-chip", state="visible")
        self.stack.model.set_script([
            {"tools": [{"name": TOOL, "input": {**anchor, "visibility": visibility, "body": body}}]},
            {"text": "请在确认卡片核对这条建议。"},
        ])
        self.page.fill(".aipm-chat__input", "请结合所选内容提出一条批注建议。" + self.stack.model.instruction)
        self.stack.model.instruction = ""
        self.page.click(".aipm-chat__send")
        self.page.wait_for_function(
            "() => !document.querySelector('.aipm-chat__send').classList.contains('is-stop')"
        )
        self.page.locator(".aipm-chat__proposal").last.wait_for(state="visible")

    def open_confirmation(self):
        card = self.page.locator(".aipm-chat__proposal").last
        card.get_by_role("button", name="查看批注建议").click()
        frame = card.frame_locator('iframe[title="受保护内容"]')
        frame.locator("#agree").wait_for(state="visible")
        return frame

    def accepted(self, frame, visibility: str) -> None:
        frame.locator("#agree").click()
        frame.get_by_text(f"已写入：{visibility}").wait_for()

    def permit_posts(self) -> list[dict]:
        return [r for r in self.stack.api.requests
                if r["method"] == "POST" and r["path"] == "/api/annotation-permits"]

    def test_local_confirmation_stays_on_device(self):
        self.propose("local", "只保存在本机的建议")
        frame = self.open_confirmation()
        self.assertIn("最终可见范围：仅本机", frame.locator("#visibility").inner_text())
        self.assertEqual(self.stack.api.writes(), [])
        self.assertEqual(self.permit_posts(), [])
        outbound_bodies = []
        self.page.on("request", lambda request: outbound_bodies.append(request.post_data or "")
                     if request.method == "POST" else None)

        self.accepted(frame, "仅本机")
        local = self.page.evaluate("""() => {
            const data = JSON.parse(localStorage.getItem('aipm-anno-local') || '{"pages":{}}');
            return Object.values(data.pages || {}).flat();
        }""")
        self.assertEqual(len(local), 1)
        self.assertEqual(local[0]["visibility"], "local")
        self.assertEqual(self.stack.api.writes(), [])
        self.assertEqual(self.permit_posts(), [])
        self.assertFalse(any("只保存在本机的建议" in body for body in outbound_bodies))
        assert_no_page_errors(self, self.browser)

    def test_user_selected_visibility_overrides_the_proposal(self):
        self.propose("local", "用户选择公开的建议")
        card = self.page.locator(".aipm-chat__proposal").last
        choices = card.get_by_role("group", name="批注可见范围")
        choices.get_by_role("button", name="公开").click()
        self.assertEqual(choices.get_by_role("button", name="公开").get_attribute("aria-pressed"), "true")
        frame = self.open_confirmation()
        self.assertIn("最终可见范围：公开", frame.locator("#visibility").inner_text())
        self.assertEqual(self.stack.api.writes(), [])
        self.assertEqual(self.permit_posts(), [])
        self.accepted(frame, "公开")
        self.assertEqual(self.stack.api.writes()[0]["body"]["visibility"], "public")
        self.assertEqual(len(self.permit_posts()), 1)
        self.page.reload(wait_until="load")
        self.page.wait_for_function(
            "() => window.__aipmIntegrityReady === true && window.__aipmChat && window.__aipmAnnoStore"
        )
        self.page.click(".aipm-chat__fab")
        card = self.page.locator(".aipm-chat__proposal").last
        card.wait_for(state="visible")
        choices = card.get_by_role("group", name="批注可见范围")
        self.assertEqual(choices.get_by_role("button", name="公开").get_attribute("aria-pressed"), "true")
        self.assertTrue(choices.get_by_role("button", name="仅本机").is_disabled())
        frame = self.open_confirmation()
        self.assertIn("已写入：公开", frame.locator("#state").inner_text())
        self.assertEqual(len(self.stack.api.writes()), 1)
        self.assertEqual(len(self.permit_posts()), 1)
        assert_no_page_errors(self, self.browser)

    def test_public_and_private_confirmations_use_the_users_session(self):
        for paragraph_index, (visibility, label) in enumerate(
            (("public", "公开"), ("private", "仅自己可见"))
        ):
            with self.subTest(visibility=visibility):
                self.stack.api.reset()
                self.propose(visibility, f"已确认的{label}建议", paragraph_index)
                frame = self.open_confirmation()
                self.assertIn(f"最终可见范围：{label}", frame.locator("#visibility").inner_text())
                self.assertEqual(self.stack.api.writes(), [])
                self.accepted(frame, label)

                writes = self.stack.api.writes()
                permits = self.permit_posts()
                self.assertEqual(len(writes), 1)
                self.assertEqual(len(permits), 1)
                self.assertEqual(writes[0]["authorization"], f"Bearer {self.session['token']}")
                self.assertEqual(permits[0]["authorization"], f"Bearer {self.session['token']}")
                self.assertIn(writes[0]["permit"], self.stack.api.permits)
                self.assertEqual(writes[0]["body"]["visibility"], visibility)
                self.assertEqual(permits[0]["body"], writes[0]["body"])
        assert_no_page_errors(self, self.browser)

    def test_integrity_pending_blocks_until_resources_are_ready(self):
        self.propose("public", "等待资源校验的建议")
        self.page.evaluate("""() => {
            window.__aipmIntegrityReady = false;
            window.__aipmIntegrityFailed = false;
            window.dispatchEvent(new Event('aipm-integrity-change'));
        }""")
        frame = self.open_confirmation()
        self.assertTrue(frame.locator("#agree").is_disabled())
        self.assertIn("资源校验中", frame.locator("#state").inner_text())
        self.assertEqual(self.permit_posts(), [])
        self.assertEqual(self.stack.api.writes(), [])

        self.page.evaluate("""() => {
            window.__aipmIntegrityReady = true;
            window.dispatchEvent(new Event('aipm-integrity-change'));
        }""")
        self.accepted(frame, "公开")
        self.assertEqual(len(self.permit_posts()), 1)
        self.assertEqual(len(self.stack.api.writes()), 1)
        assert_no_page_errors(self, self.browser)

    def test_integrity_failure_prevents_any_permission_or_write_request(self):
        self.propose("private", "资源校验失败的建议")
        self.page.evaluate("""() => {
            window.__aipmIntegrityReady = false;
            window.__aipmIntegrityFailed = true;
            window.dispatchEvent(new Event('aipm-integrity-change'));
        }""")
        frame = self.open_confirmation()
        self.assertTrue(frame.locator("#agree").is_disabled())
        self.assertIn("资源校验失败", frame.locator("#state").inner_text())
        self.assertEqual(self.permit_posts(), [])
        self.assertEqual(self.stack.api.writes(), [])
        assert_no_page_errors(self, self.browser)

    def test_unknown_write_is_reconciled_after_refresh_without_another_write(self):
        self.propose("private", "刷新后查询原请求")
        frame = self.open_confirmation()
        self.stack.api.drop_next_write_response = True
        with self.page.expect_event(
            "requestfailed",
            predicate=lambda request: request.method == "POST" and request.url.endswith("/api/annotations"),
        ):
            frame.locator("#agree").click()
        frame.get_by_text("结果未知；只能查询原请求，不能再次提交。").wait_for()
        self.assertEqual(len(self.stack.api.writes()), 1)
        self.assertEqual(len(self.permit_posts()), 1)

        self.page.reload(wait_until="load")
        self.page.wait_for_function(
            "() => window.__aipmIntegrityReady === true && window.__aipmChat && window.__aipmAnnoStore"
        )
        self.page.click(".aipm-chat__fab")
        card = self.page.locator(".aipm-chat__proposal").last
        card.wait_for(state="visible")
        frame = self.open_confirmation()
        self.assertIn("结果未知", frame.locator("#state").inner_text())
        frame.locator("#check").click()
        frame.get_by_text("已写入：仅自己可见").wait_for()
        self.assertEqual(len(self.stack.api.writes()), 1)
        self.assertEqual(len(self.permit_posts()), 1)
        request_id = self.stack.api.writes()[0]["body"]["requestId"]
        queries = [
            event for event in self.stack.api.requests
            if event["method"] == "GET"
            and event["path"].startswith("/api/annotation-requests/")
        ]
        self.assertEqual(
            [(event["path"], event["responseStatus"]) for event in queries],
            [(f"/api/annotation-requests/{request_id}", 200)],
        )


if __name__ == "__main__":
    unittest.main()
