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

    def test_panel_width_within_prd_range(self):
        m = re.search(r"--aipm-chat-w:\s*clamp\(([^)]+)\)", self.css)
        self.assertIsNotNone(m)
        lo, _, hi = [v.strip() for v in m.group(1).split(",")]
        self.assertEqual(lo, "20rem")   # 320px 最小宽
        self.assertEqual(hi, "26.25rem")  # 420px 最大宽

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
        peek = float(re.search(r"SHEET_PEEK_VH = ([\d.]+)", self.js).group(1))
        half = float(re.search(r"SHEET_HALF_VH = ([\d.]+)", self.js).group(1))
        gap = int(re.search(r"SHEET_TOP_GAP = (\d+)", self.js).group(1))
        self.assertGreaterEqual(peek, 0.18)
        self.assertLessEqual(peek, 0.25)
        self.assertGreaterEqual(half, 0.45)
        self.assertLessEqual(half, 0.60)
        self.assertGreaterEqual(gap, 12)
        self.assertLessEqual(gap, 24)

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
        self.assertNotIn("requestAnimationFrame", self.js)

    # -- 无障碍 / 动效 -----------------------------------------------------
    def test_modal_semantics_follow_snap(self):
        self.assertIn('panel.setAttribute("role", mode === "dock" ? "complementary" : "dialog")', self.js)
        self.assertIn('panel.setAttribute("aria-modal", modal ? "true" : "false")', self.js)

    def test_reduced_motion_disables_transitions(self):
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.css)


if __name__ == "__main__":
    unittest.main()
