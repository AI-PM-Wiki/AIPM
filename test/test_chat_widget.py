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
ANNO_CSS = ROOT / "docs" / "_static" / "css" / "annotation.css"
EXTRA_CSS = ROOT / "docs" / "_static" / "css" / "extra.css"
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

    def test_head_divider_matches_annotation_panel(self):
        """头部与内容区之间的发丝线:与批注面板 .aipm-anno__head 同款同色。

        两侧都是 1px 实线的 border-bottom,颜色令牌同为 --pm-line(即页头那条
        交界线),不写死 rgba;批注面板未加载时一并回落到主题的浅色描边。
        """
        head = re.search(r"\n\.aipm-chat__head \{(.*?)\}", self.css, re.S).group(1)
        self.assertIn(
            "border-bottom: 1px solid var(--pm-line, var(--md-default-fg-color--lightest));",
            head,
        )
        # 同一条线在批注面板里的名字:--aipm-anno-line 别名到同一个 --pm-line
        anno = ANNO_CSS.read_text(encoding="utf-8")
        anno_line = re.search(r"--aipm-anno-line:\s*([^;]+);", anno)

        self.assertIn("--pm-line", anno_line.group(1))

    def test_head_height_matches_site_header(self):
        """两个面板的页头与站点页头 .md-header 等高。

        停靠/浮层形态下面板顶在视口上缘、紧挨着页头:高度不一致,面板页头那条
        横向分割线就比页头下缘低一截,并排看是两级台阶。改之前实测三个值互不
        相同 —— 站点页头 48px、批注页头 50px、助手页头 61px。所以三处只留一个
        字面量(extra.css 的 --pm-header-h),其余按 token 读。

        高度要带 +1px:全站 box-sizing: border-box,只写 2.4rem 会把面板这条
        border-bottom 算进 2.4rem 里,线落在 47–48;页头的下缘线是 box-shadow、
        画在 2.4rem 之外,落在 48–49。DPR4 实测差一行,并排接不上。
        """
        extra = EXTRA_CSS.read_text(encoding="utf-8")
        self.assertIn("--pm-header-h: 2.4rem;", extra)

        # 吸顶发丝线的落点也是这个高度,一并绑上同一个 token
        line = re.search(r"\n\.md-header__line \{(.*?)\}", extra, re.S).group(1)
        self.assertIn("top: var(--pm-header-h);", line)

        # 两个面板的页头:高度读 token(+1px 的分隔线),且不再用上下 padding
        # 去撑(定高后 padding 只会把内容挤出去)
        for path, sel in ((CHAT_CSS, ".aipm-chat__head"), (ANNO_CSS, ".aipm-anno__head")):
            with self.subTest(sel=sel):
                rule = re.search(
                    r"\n" + re.escape(sel) + r" \{(.*?)\}", path.read_text(encoding="utf-8"), re.S
                ).group(1)
                self.assertIn("height: calc(var(--pm-header-h, 2.4rem) + 1px);", rule)
                self.assertNotIn("padding-top", rule)
                self.assertNotIn("padding-bottom", rule)

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

    def test_peek_drops_the_head_divider(self):
        """一段不画页头那条分隔线。

        一段时消息区是 display:none,页头与输入条之间空无一物 —— 这条线不划分任何
        两块内容,只是一道横贯整屏的杠;而且它比抽屉自己的上缘还显眼(暗色实测:
        线 20% 白、上缘 12%),内部分界反压过外部分界。抽屉里其余元素都是内缩的
        (手柄小胶囊、输入条左右各留 15px、顶部 1rem 圆角),通栏的线不属于这套
        语言。二段/三段消息区回来,线才重新有意义。
        """
        rule = re.search(
            r'html\.aipm-chat-mode--sheet \.aipm-chat\[data-snap="peek"\] \.aipm-chat__head \{(.*?)\}',
            self.css,
            re.S,
        )
        self.assertIsNotNone(rule, "一段的页头规则不见了")
        body = rule.group(1)
        self.assertIn("border-bottom-color: transparent;", body)
        # 只改颜色不改宽度:head 高度是 --pm-header-h + 1px 定死的,删 border 会让
        # 内容盒重排(见 test_head_height_matches_site_header)
        self.assertNotIn("border-bottom:", body)
        self.assertNotIn("height:", body)

        # 量具态不跟这条:它只量尺寸,而这条不动尺寸;真跟了会在转屏/开合时把线
        # 淡出又淡回,闪一下
        self.assertNotIn("is-peek-measure .aipm-chat__head", self.css)

        # 线的消失是跟着吸附动画淡出,不是啪地断掉
        head = re.search(r"\n\.aipm-chat__head \{(.*?)\}", self.css, re.S).group(1)
        self.assertIn(
            "transition: border-color var(--aipm-chat-dur) var(--aipm-chat-ease);", head
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

        # 量具只并 peek 的那几条几何规则:手柄 / 输入条
        # (头部不在其列 —— 它由 --pm-header-h 定高,peek 不再有自己的几何,
        #  量具态自然与 peek 一致,无需再并一条)
        for sel in (
            ".aipm-chat__grip",
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
