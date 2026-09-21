"""Assert the chat widget's page-level layout contract.

布局改版(2026-09-20,issue #66)后不再复用右侧 TOC 栏:桌面端是页面级右侧
面板(页面整体收窄),移动端是三段式底部抽屉。以下断言锁住几条容易回退的契约:

- 桌面停靠同时收窄 .md-header 与 .md-container(主题里两者是兄弟块级元素),
  且不再隐藏/替换 TOC;
- 移动抽屉三段停靠点的高度与近全屏顶部间隙落在 PRD 给定区间;
- peek 无遮罩、half/expanded 有遮罩并锁背景滚动;
- FAB/遮罩/面板挂在 body 顶层,不依赖 [data-md-component=container]
  (instant 导航换页不重建它们,也就不再需要 MutationObserver 重挂)。
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAT_CSS = ROOT / "docs" / "_static" / "css" / "chat-widget.css"
CHAT_JS = ROOT / "docs" / "_static" / "js" / "chat-widget.js"


class TestChatWidgetStyles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = CHAT_CSS.read_text(encoding="utf-8")
        cls.js = CHAT_JS.read_text(encoding="utf-8")

    # -- 断点 --------------------------------------------------------------
    def test_breakpoints_match_prd(self):
        # 1200px = 75em 桌面停靠;768px = 48em 移动抽屉
        self.assertIn("@media screen and (min-width: 75em)", self.css)
        self.assertIn('window.matchMedia("(min-width: 75em)")', self.js)
        self.assertIn('window.matchMedia("(max-width: 47.9875em)")', self.js)

    # -- 桌面停靠:页面整体保留并收窄,TOC 不被替换 ---------------------------
    def test_desktop_dock_narrows_page(self):
        self.assertIn("html.aipm-chat-mode--dock.aipm-chat-open .md-header", self.css)
        self.assertIn("html.aipm-chat-mode--dock.aipm-chat-open .md-container", self.css)
        self.assertIn(
            "margin-right: calc(var(--aipm-chat-w) + var(--aipm-chat-sbw))",
            self.css,
        )

    def test_toc_is_not_hidden_anymore(self):
        for src in (self.css, self.js):
            self.assertNotIn("md-sidebar--secondary", src)
            self.assertNotIn("md-nav--secondary", src)

    def test_panel_divider_matches_header_hairline(self):
        """桌面端面板左缘的竖线与页头交界发丝线用同一个颜色令牌(--pm-line)"""
        self.assertIn(
            "border-left: 1px solid var(--pm-line, var(--md-default-fg-color--lightest));",
            self.css,
        )

    def test_tabs_bottom_border_is_removed(self):
        """主题给 .md-tabs 的 1px 下边框与注入的发丝线叠成粗线,extra.css 里去掉"""
        extra = (ROOT / "docs" / "_static" / "css" / "extra.css").read_text(encoding="utf-8")
        self.assertIn("[data-md-color-primary] .md-tabs {", extra)
        self.assertIn("border-bottom: 0;", extra)

    def test_panel_width_within_prd_range(self):
        m = re.search(r"--aipm-chat-w:\s*clamp\(([^)]+)\)", self.css)
        self.assertIsNotNone(m)
        lo, _, hi = [v.strip() for v in m.group(1).split(",")]
        self.assertEqual(lo, "20rem")   # 320px 最小宽
        self.assertEqual(hi, "26.25rem")  # 420px 最大宽

    def test_message_list_reserves_its_scrollbar_gutter(self):
        """消息列不能因为「历史长了」而换一个宽度。

        .aipm-chat__msgs 是 overflow-y: auto:空历史时没有滚动条,历史第一次长过
        一屏时挂上,内容区当场窄一条 —— 实测同一条免责条在挂上滚动条前后
        362 → 351,列表 clientWidth 402 → 391。聊天恰恰是「内容一路长出来」的
        地方,这一刻必然发生,而且就发生在用户盯着新消息进来的那一下。

        scrollbar-gutter: stable 让槽位常驻,长与短都是同一个宽度(351)。代价是
        消息列恒比输入卡片(.aipm-chat__composer,372)窄一条滚动条 —— 这个差值在
        历史长过一屏之后本来就有,改的只是它不再来回变。批注面板的
        .aipm-anno__list 是同一条(那边由收掉一栏触发)。
        """
        msgs = re.search(r"\n\.aipm-chat__msgs \{(.*?)\}", self.css, re.S).group(1)
        self.assertIn("overflow-y: auto;", msgs)
        self.assertIn("scrollbar-gutter: stable;", msgs)
        # both-edges 会在左边也多留一条,内容整体左移 —— 那不是这里要的
        self.assertNotIn("both-edges", msgs)

    # -- 移动抽屉:三段停靠点 ----------------------------------------------
    def test_sheet_has_three_snap_points(self):
        for snap in ("peek", "half", "expanded"):
            with self.subTest(snap=snap):
                self.assertIn(
                    f'html.aipm-chat-mode--sheet .aipm-chat[data-snap="{snap}"]',
                    self.css,
                )
                self.assertIn(f'"{snap}"', self.js)

    def test_sheet_snap_heights_within_prd_range(self):
        half = float(re.search(r"SHEET_HALF_VH = ([\d.]+)", self.js).group(1))
        gap = int(re.search(r"SHEET_TOP_GAP = (\d+)", self.js).group(1))
        self.assertGreaterEqual(half, 0.45)
        self.assertLessEqual(half, 0.60)
        self.assertGreaterEqual(gap, 12)
        self.assertLessEqual(gap, 24)

    def test_peek_height_hugs_its_content(self):
        """页面优先态高度 = 手柄 + 标题 + 输入条(实测成长度,写进 CSS 变量)。

        刻意不用 18–25vh:那会把「手柄 + 标题 + 输入条」之外的空余也算进去,
        标题和输入框之间留一大块空白。这里只保留一个内容异常矮时的保底值。
        """
        floor = int(re.search(r"SHEET_PEEK_MIN = (\d+)", self.js).group(1))
        self.assertGreaterEqual(floor, 96)
        self.assertLessEqual(floor, 200)
        # CSS 必须是可直接过渡的长度,不能是 fit-content(否则吸附动画会瞬跳)
        peek_rule = re.search(
            r'html\.aipm-chat-mode--sheet \.aipm-chat\[data-snap="peek"\] \{(.*?)\}',
            self.css,
            re.S,
        ).group(1)
        self.assertIn("height: var(--aipm-chat-sheet-peek);", peek_rule)
        decls = re.sub(r"/\*.*?\*/", "", peek_rule, flags=re.S)   # 注释里提到 fit-content 不算
        self.assertNotIn("fit-content", decls)
        # 实测逻辑:手柄 + 头部 + 输入条 + 输入条底边距 + 顶边描边
        self.assertIn("const refreshPeek", self.js)
        self.assertIn("els.grip.offsetHeight + els.head.offsetHeight", self.js)

    def test_peek_shows_input_but_no_history(self):
        # 页面优先态:只露手柄 + 标题 + 输入条,消息区被隐藏
        self.assertIn(
            'html.aipm-chat-mode--sheet .aipm-chat[data-snap="peek"] .aipm-chat__msgs {',
            self.css,
        )
        self.assertNotIn("aipm-chat__peek-text", self.js)   # 旧的「最近一句」速览条已移除
        # 页面优先态没有历史消息,也就不需要清屏按钮
        self.assertIn(
            'html.aipm-chat-mode--sheet .aipm-chat[data-snap="peek"] .aipm-chat__clear {',
            self.css,
        )

    def test_first_two_snaps_use_compact_single_row_composer(self):
        for snap in ("peek", "half"):
            with self.subTest(snap=snap):
                self.assertIn(
                    f'html.aipm-chat-mode--sheet .aipm-chat[data-snap="{snap}"] .aipm-chat__composer',
                    self.css,
                )
        self.assertIn("flex-direction: row;", self.css)
        # 附件与发送按钮都推到输入框右侧
        self.assertIn("justify-content: flex-end;", self.css)

    def test_compact_composer_buttons_are_vertically_centered(self):
        """前两段的 [输入……][附件][发送] 单行时三个元素垂直居中对齐;
        输入框换行后按钮改贴最后一行(居中会让按钮悬在长输入中段)。"""
        composer_rule = re.search(
            r'html\.aipm-chat-mode--sheet \.aipm-chat\[data-snap="peek"\] \.aipm-chat__composer,'
            r'.*?\{(.*?)\}',
            self.css,
            re.S,
        ).group(1)
        self.assertIn("align-items: center;", composer_rule)
        self.assertNotIn("align-items: flex-end;", composer_rule)
        self.assertIn('.aipm-chat__composer.is-multiline {', self.css)
        # JS 依据输入框是否换行切换该类(空输入框不能误判:要先压掉 min-height 再量内容高)
        self.assertIn('classList.toggle("is-multiline"', self.js)
        self.assertIn('el.style.minHeight = "0";', self.js)

    def test_peek_measure_never_fakes_the_snap_state(self):
        """实测页面优先态高度时不得改写 data-snap(issue #73)。

        曾经的量具是把面板真的切到 `data-snap="peek"` 再切回来:测得准,却会在吸附
        动画中途把面板高度改写成 peek、把消息区 display:none —— 消息滚动层被拆掉
        重建,下一帧整片重栅格。二段/三段互切时输入条正好换形(单行窄条 ↔ 卡片),
        触发 composer 的 ResizeObserver 回调,这个窗口必然落在吸附动画里,消息区
        就闪一片。量具类 .is-peek-measure 只借 peek 的几何,与停靠点状态解耦。
        """
        # 不改写停靠点状态(只此一处曾写过字面量 "peek")
        self.assertNotIn('setAttribute("data-snap", "peek")', self.js)
        self.assertIn('classList.add("is-peek-measure")', self.js)
        self.assertIn('classList.remove("is-peek-measure")', self.js)
        # 量具自身引起的尺寸变化不再回头重测(免 ResizeObserver 回环)
        self.assertRegex(self.js, r"if \(measuringPeek\) return;")

        # 量具只并 peek 的那几条几何规则:手柄 / 头部 / 输入条
        for sel in (
            ".aipm-chat__grip",
            ".aipm-chat__head",
            ".aipm-chat__composer",
            ".aipm-chat__input",
            ".aipm-chat__inputrow",
            ".aipm-chat__attachbar",
        ):
            with self.subTest(sel=sel):
                self.assertIn(f".aipm-chat.is-peek-measure {sel} {{", self.css)

        # 面板高度与消息区显隐仍是 peek 停靠点专属,量具碰不到这两条
        peek_height_rule = re.search(
            r'html\.aipm-chat-mode--sheet \.aipm-chat\[data-snap="peek"\] \{(.*?)\}',
            self.css,
            re.S,
        ).group(1)
        self.assertNotIn("is-peek-measure", peek_height_rule)
        self.assertNotIn("is-peek-measure .aipm-chat__msgs", self.css)
        self.assertNotIn("is-peek-measure .aipm-chat__clear", self.css)

    def test_dragging_soft_hides_the_message_list(self):
        """拖拽/吸附期间消息区上缘渐隐,拖到半开以下整体淡出 —— 半行文字不再被硬切"""
        self.assertIn(".aipm-chat.is-dragging .aipm-chat__msgs,", self.css)
        self.assertIn(".aipm-chat.is-snapping .aipm-chat__msgs {", self.css)
        self.assertIn("mask-image: linear-gradient", self.css)
        self.assertIn(".aipm-chat.is-compact .aipm-chat__msgs {", self.css)
        self.assertIn('classList.toggle("is-compact", compact)', self.js)
        self.assertIn("markSnapping", self.js)

    def test_mobile_send_from_peek_raises_sheet(self):
        self.assertIn("const raiseForSend", self.js)
        self.assertIn('snap === "peek") setSnap("half")', self.js)

    def test_snap_heights_are_offered_as_css_vars(self):
        for var in (
            "--aipm-chat-sheet-peek",
            "--aipm-chat-sheet-half",
            "--aipm-chat-sheet-expanded",
        ):
            with self.subTest(var=var):
                self.assertIn(var, self.css)
                self.assertIn(var, self.js)

    # -- 遮罩与背景滚动锁定 -------------------------------------------------
    def test_peek_has_no_backdrop_but_half_and_expanded_do(self):
        self.assertIn('if (mode === "sheet") return snap === "peek" ? "none"', self.js)
        self.assertIn('.aipm-chat__scrim[data-level="half"]', self.css)
        self.assertIn('.aipm-chat__scrim[data-level="full"]', self.css)
        self.assertIn("pointer-events: none;", self.css)

    def test_backdrop_states_lock_document_scroll(self):
        self.assertIn("html.aipm-chat-locked", self.css)
        self.assertIn("overflow: hidden;", self.css)
        self.assertIn('cl.toggle("aipm-chat-locked", locked())', self.js)
        # 桌面停靠不锁背景(页面与面板各自独立滚动)
        self.assertIn('open && mode !== "dock"', self.js)

    # -- 挂载契约 ----------------------------------------------------------
    def test_widget_is_mounted_on_body_and_survives_instant_navigation(self):
        for expr in (
            "document.body.appendChild(fab)",
            "document.body.appendChild(scrim)",
            "document.body.appendChild(panel)",
        ):
            with self.subTest(expr=expr):
                self.assertIn(expr, self.js)
        # 不再插到页头交界线之后、不再需要观察器重挂
        self.assertNotIn("md-header__line", self.js)
        self.assertNotIn("MutationObserver", self.js)
        # 没有"逐帧对齐页头"的常驻循环(rAF 只用于松手后推迟一帧交回高度)
        self.assertNotIn("requestAnimationFrame(", self.js.split("const clearDragHeight")[0])

    # -- 无障碍 / 动效 -----------------------------------------------------
    def test_modal_semantics_follow_snap(self):
        self.assertIn('panel.setAttribute("role", mode === "dock" ? "complementary" : "dialog")', self.js)
        self.assertIn('panel.setAttribute("aria-modal", modal ? "true" : "false")', self.js)

    def test_reduced_motion_disables_transitions(self):
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.css)


if __name__ == "__main__":
    unittest.main()
