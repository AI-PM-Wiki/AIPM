"""Assert the self-hosted annotation system's front-end contracts.

批注系统(issue #71)把原来嵌入的 hypothes.is 客户端整个换掉。以下断言锁住几条
一改就容易悄悄回退的契约:

- 运行时不再有任何 hypothes.is 依赖(embed.js、官方 JS、宿主元素样式);
- 入口按钮仍在页头右上角、贴浏览器右边缘(位置沿用 #67 的实现);
- 批注面板与 AI 助手面板**互斥**,靠 window.__aipmPanels 注册表串起来;
- 两个面板的抽屉拖拽走同一份共享实现,不再各抄一套;
- 色板 ≥5 色且亮/暗各一套,高亮文字颜色 inherit(暗色下正文对比度不被拉低);
- 两个判分 provider 的降级/回退分支都在,建议条带来源标注;
- 三态(公开 / 私有 / 仅本机)路径齐全,且前端**不存在把「仅本机」POST 出去的通路**。
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MKCONFIG = ROOT / "mkdocs.yml"
EXTRA_CSS = ROOT / "docs" / "_static" / "css" / "extra.css"
ANNO_CSS = ROOT / "docs" / "_static" / "css" / "annotation.css"
ANNO_JS = ROOT / "docs" / "_static" / "js" / "annotation.js"
STORE_JS = ROOT / "docs" / "_static" / "js" / "annotation-store.js"
AUTH_JS = ROOT / "docs" / "_static" / "js" / "annotation-auth.js"
SHARED_JS = ROOT / "docs" / "_static" / "js" / "panel-shared.js"
CHAT_JS = ROOT / "docs" / "_static" / "js" / "chat-widget.js"
HOOK = ROOT / "hooks" / "annotation.py"
SERVER_ANNOTATIONS_TS = (
    ROOT / "annotation-server" / "src" / "annotations.ts"
)


def _block(src: str, marker: str) -> str:
    """Return the brace-balanced block that starts at ``marker``."""
    start = src.index(marker)
    brace = src.index("{", start)
    depth = 0
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
    raise AssertionError(f"unbalanced block for {marker!r}")


class TestHypothesisIsGone(unittest.TestCase):
    """替换就替换干净,不留双轨。"""

    @classmethod
    def setUpClass(cls):
        cls.mk = MKCONFIG.read_text(encoding="utf-8")

    def test_no_official_embed_or_client_scripts(self):
        for needle in (
            "hypothes.is/embed.js",
            "_static/js/hypothesis.js",
            "_static/js/hypothesis-config.js",
        ):
            self.assertNotIn(needle, self.mk, f"mkdocs.yml 仍有 {needle}")

    def test_hypothesis_assets_are_deleted(self):
        self.assertFalse(
            (ROOT / "docs" / "_static" / "hypothesis").exists(),
            "自托管侧栏外壳目录应已删除",
        )
        for name in ("hypothesis.js", "hypothesis-config.js"):
            self.assertFalse(
                (ROOT / "docs" / "_static" / "js" / name).exists(),
                f"{name} 应已删除",
            )
        self.assertFalse(
            (ROOT / "test" / "test_hypothesis.py").exists(),
            "旧契约测试应已删除",
        )

    def test_no_hosted_sidebar_styles_left(self):
        """宿主元素(hypothesis-sidebar)的样式规则是死代码,一并清掉。"""
        for path in (
            ROOT / "docs" / "_static" / "css" / "chat-widget.css",
            EXTRA_CSS,
            ANNO_CSS,
        ):
            src = path.read_text(encoding="utf-8")
            self.assertNotIn("hypothesis-sidebar", src, f"{path.name} 仍有宿主元素样式")


class TestEntryButton(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = EXTRA_CSS.read_text(encoding="utf-8")
        cls.js = ANNO_JS.read_text(encoding="utf-8")

    def test_entry_button_sits_at_the_header_right_edge(self):
        block = _block(self.css, ".md-header .md-header__button.aipm-anno-entry")
        self.assertIn("position: absolute", block)
        self.assertIn("top: 0", block)
        self.assertIn("right: 0", block)

    def test_header_reserves_room_for_the_button(self):
        self.assertRegex(self.css, r"\.md-header__inner\s*\{[^}]*padding-inline-end:\s*2\.4rem")

    def test_button_is_injected_into_the_header(self):
        self.assertIn(".md-header__inner", self.js)
        self.assertIn("aipm-anno-entry", self.js)

    def test_mobile_search_covers_the_button(self):
        self.assertIn('[data-md-toggle="search"]:checked ~ .md-header .aipm-anno-entry', self.css)


class TestPanelsAreMutuallyExclusive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = SHARED_JS.read_text(encoding="utf-8")
        cls.anno = ANNO_JS.read_text(encoding="utf-8")
        cls.chat = CHAT_JS.read_text(encoding="utf-8")

    def test_shared_registry_exists(self):
        self.assertIn("window.__aipmPanels", self.shared)
        for fn in ("register", "claim", "close", "isOpen"):
            self.assertIn(f"{fn}: {fn}", self.shared, f"注册表缺少 {fn}")

    def test_both_panels_register(self):
        self.assertIn('register("annotation"', self.anno)
        self.assertIn('register("chat"', self.chat)

    def test_both_panels_switch_via_claim(self):
        """两个方向共用同一个动作:claim 先关另一个再开自己。"""
        self.assertIn('claim("annotation")', self.anno)
        self.assertIn('claim("chat")', self.chat)

    def test_registry_is_loaded_before_both_panels(self):
        mk = MKCONFIG.read_text(encoding="utf-8")
        # 共享件写成静态条目(hooks 追加的资源永远排在后面),因此天然在两个面板之前
        self.assertIn("_static/js/panel-shared.js?v=", mk)

    def test_drawer_drag_is_shared_not_copied(self):
        """两个面板都用共享件的 attachSheetDrag,不再各写一份拖拽实现。"""
        self.assertIn("attachSheetDrag", self.shared)
        self.assertIn("attachSheetDrag", self.anno)
        self.assertIn("attachSheetDrag", self.chat)
        for src, name in ((self.anno, "annotation.js"), (self.chat, "chat-widget.js")):
            self.assertNotIn("onDragDown", src, f"{name} 里还留着自写的拖拽实现")

    def test_both_panels_use_the_same_width_token(self):
        css = ANNO_CSS.read_text(encoding="utf-8")
        self.assertIn("--aipm-anno-w: var(--aipm-chat-w", css)


class TestPalette(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = STORE_JS.read_text(encoding="utf-8")
        cls.extra = EXTRA_CSS.read_text(encoding="utf-8")
        cls.anno_css = ANNO_CSS.read_text(encoding="utf-8")

    def test_at_least_five_colours(self):
        palette = self.store[
            self.store.index("var PALETTE = [") : self.store.index("var DEFAULT_COLOR")
        ]
        self.assertGreaterEqual(palette.count('{ id: "'), 5)
        for pid in ("yellow", "green", "blue", "pink", "purple"):
            self.assertIn(f'id: "{pid}"', palette)

    def test_light_and_dark_values(self):
        """色值定义在 extra.css 的 5.7 段(与批注入口按钮同处)。"""
        section = self.extra[self.extra.index("5.7 批注入口") :]
        light, _, slate = section.partition('[data-md-color-scheme="slate"]')
        self.assertGreaterEqual(len(re.findall(r"--aipm-anno-[\w-]+: #", light)), 5)
        self.assertGreaterEqual(len(re.findall(r"--aipm-anno-[\w-]+: #", slate)), 5)

    def test_marks_keep_the_text_colour(self):
        """高亮只换底色,文字颜色 inherit —— 暗色下正文对比度不被拉低。"""
        block = _block(self.anno_css, ".aipm-anno-mark {")
        self.assertIn("color: inherit", block)

    def test_number_keys_one_to_five(self):
        self.assertIn("/^[1-5]$/.test(e.key)", ANNO_JS.read_text(encoding="utf-8"))


class TestJudgeDegradation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.server_dir = ROOT / "annotation-server" / "src" / "highlight"

    def test_both_providers_exist(self):
        if not self.server_dir.exists():  # pragma: no cover - 子模块未检出
            self.skipTest("annotation-server 子模块未检出")
        for name in ("jev-provider.ts", "llm-provider.ts", "judge.ts", "rules.ts"):
            self.assertTrue((self.server_dir / name).exists(), f"缺少 {name}")

    def test_suggestions_carry_a_source_label(self):
        """建议条标注来源(「Jev」/「Claude」),回退可解释。"""
        self.assertIn('if (source === "jev") return "Jev"', self.js)
        self.assertIn('if (source === "llm") return "Claude"', self.js)
        self.assertIn("payload.fallbackFrom", self.js)

    def test_unavailable_degrades_without_breaking_annotations(self):
        """503 时只禁用智能高亮按钮,批注主功能不受影响。"""
        block = _block(self.js, "function smartHighlight()")
        self.assertIn("res.status === 503", block)
        self.assertIn("els.smart.disabled = true", block)

    def test_rate_limit_cooldown(self):
        block = _block(self.js, "function smartHighlight()")
        self.assertIn("res.status === 429", block)
        self.assertIn("cooldownUntil", block)

    def test_same_page_result_is_reused(self):
        self.assertIn("suggestCache[page]", self.js)


class TestThreeVisibilities(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.store = STORE_JS.read_text(encoding="utf-8")
        cls.auth = AUTH_JS.read_text(encoding="utf-8")

    def test_all_three_paths_are_offered(self):
        for vis in ("public", "private", "local"):
            self.assertIn(f'data-vis="{vis}"', self.js)

    def test_public_and_private_go_to_the_server(self):
        block = _block(self.js, "function submitAnnotation(")
        self.assertIn('"/api/annotations"', block)

    def test_local_annotations_never_reach_the_server(self):
        """「仅本机」只有 localStorage 一条路 —— 前端没有把它 POST 出去的通路。"""
        block = _block(self.js, "function submitAnnotation(")
        local_branch = block.index('if (visibility === "local")')
        server_call = block.index('"/api/annotations"')
        self.assertLess(
            local_branch,
            server_call,
            "「仅本机」分支必须在任何服务端调用之前返回",
        )
        # 两个「仅本机」分支都直接返回,落不到下面那段服务端调用
        for segment in block[:server_call].split('if (visibility === "local")')[1:]:
            self.assertIn("return", segment, "「仅本机」分支必须直接返回")
        # 请求体里的 visibility 用的是参数,不是字面量 —— 配合上面的提前返回,
        # 到得了 POST 的只可能是 public / private
        request_part = block[server_call:]
        self.assertIn("visibility: visibility", request_part)
        self.assertNotIn('visibility: "local"', request_part)

    def test_local_store_never_talks_to_the_network(self):
        for fn in ("localAdd", "localUpdate", "localRemove", "localList"):
            body = _block(self.store, f"function {fn}(")
            self.assertNotIn("fetch(", body, f"{fn} 不应触网")

    def test_quota_failure_is_surfaced_not_swallowed(self):
        self.assertIn("QuotaError", self.store)
        self.assertIn("本地存储已满", self.store)

    def test_draft_survives_the_oauth_round_trip(self):
        self.assertIn("saveDraft", self.store)
        self.assertIn("loginForDraft", self.auth)
        self.assertIn("maybeRestoreDraft", self.js)

    def test_token_never_stays_in_the_url(self):
        """一次性 code 换到 token 后立刻 replaceState 抹掉参数。"""
        block = _block(self.auth, "function consumeAuthCode()")
        self.assertIn("history.replaceState", block)
        self.assertIn("url.searchParams.delete(CODE_PARAM)", block)

    def test_session_is_a_bearer_token_not_a_cookie(self):
        self.assertIn('headers.Authorization = "Bearer " + opts.token', self.store)
        self.assertNotIn("credentials:", self.store)


class TestSharedPanelContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.mk = MKCONFIG.read_text(encoding="utf-8")

    def test_panel_is_mounted_on_body_top_level(self):
        self.assertIn("document.body.appendChild(panel)", self.js)
        self.assertIn("document.body.appendChild(toolbar)", self.js)

    def test_no_mutation_observer_rebuild(self):
        """换页后靠 document$ 重新加载与重锚,不写 MutationObserver 重建逻辑。"""
        self.assertNotIn("new MutationObserver", self.js)
        self.assertIn("document$.subscribe", self.js)

    def test_dock_narrowing_matches_the_chat_panel(self):
        self.assertIn("html.aipm-anno-mode--dock.aipm-anno-open .md-container", self.css)
        self.assertIn("margin-right: calc(var(--aipm-anno-w) + var(--aipm-anno-sbw))", self.css)

    def test_three_snap_points(self):
        for snap in ("peek", "half", "expanded"):
            self.assertIn(f'[data-snap="{snap}"]', self.css)

    def test_hook_is_registered_and_enabled(self):
        self.assertIn("- hooks/annotation.py", self.mk)
        self.assertIn("annotation:", self.mk)
        self.assertTrue(HOOK.exists(), "缺少构建期注入 hook")
        hook = HOOK.read_text(encoding="utf-8")
        for asset in (
            "annotation-store.js",
            "annotation-auth.js",
            "annotation.js",
            "annotation.css",
        ):
            self.assertIn(asset, hook)

    def test_script_load_order(self):
        """store → auth → panel:后一个在 IIFE 里直接读前一个的命名空间。"""
        hook = HOOK.read_text(encoding="utf-8")
        order = [
            hook.index("annotation-store.js"),
            hook.index("annotation-auth.js"),
            hook.index("annotation.js"),
        ]
        self.assertEqual(order, sorted(order), "注入顺序必须是 store → auth → panel")

    def test_reduced_motion(self):
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.css)

    def test_no_innerHTML_with_server_content(self):
        """批注正文一律 textContent 渲染(存储的 token 在 localStorage,有 XSS 面)。"""
        self.assertIn("body.textContent = escapeText(anno.body)", self.js)
        self.assertNotIn("innerHTML = anno.body", self.js)

    def test_block_ids_use_a_position_counter(self):
        """块 id 取「文档里的位置序号」而非「入选块序号」。

        已高亮的块会被 extractBlocks 跳过;若用入选项计数,同一页在不同客户端
        (批注多少不同)就会算出不同的 id→段落映射,而服务端同页缓存是按页面内容
        哈希共享的 —— id 会错配到别的段落上。
        """
        block = _block(self.js, "function extractBlocks(")
        self.assertIn('var id = "b" + seq++;', block)
        self.assertNotIn('id: "b" + out.length', block)

    def test_list_renders_without_opening_the_panel(self):
        """高亮在页面打开时就该可见,不依赖面板是否打开。"""
        block = _block(self.js, "function onPageChange(")
        self.assertIn("ensureAnnotationsLoaded();", block)
        self.assertNotIn("if (open) ensureAnnotationsLoaded();", block)

    def test_scope_mine_is_filtered_to_private(self):
        """scope=mine 回的是本人全部(含公开),直接 concat 会把自己的公开批注显示两遍。"""
        self.assertIn('a.visibility === "private"', self.js)
        self.assertIn("privateList = mine.filter(", self.js)

    def test_orphans_are_not_listed_twice(self):
        """未定位的批注只在未定位分组里出现一次。"""
        self.assertIn("orphanIds[a.id] = true;", self.js)
        self.assertIn("var visible = g.list.filter(", self.js)
        self.assertIn("return !orphanIds[anno.id];", self.js)

    def test_uploaded_local_copy_is_not_reanchored(self):
        """本地那条上传后不再重复渲染高亮(服务端那份负责),也不该变成孤儿。"""
        block = _block(self.js, "function applyAll(")
        self.assertIn("store.serverIdOf(anno.id)", block)
        self.assertIn("continue;", block)

    def test_fab_stays_reachable_while_annotation_panel_is_open(self):
        """批注面板开着时 FAB「询问助手」是切回 AI 面板的入口,不能被面板盖住。"""
        self.assertIn("html.aipm-anno-mode--dock.aipm-anno-open .aipm-chat__fab", self.css)
        self.assertIn("html.aipm-anno-mode--sheet.aipm-anno-open .aipm-chat__fab", self.css)

    def test_panel_buttons_keep_the_page_selection(self):
        """点面板里的按钮不该清掉正文选区(「重新锚定」正靠它)。"""
        self.assertIn('e.target.closest("button")', self.js)


@unittest.skipUnless(SERVER_ANNOTATIONS_TS.exists(), "annotation-server 子模块未检出")
class TestServerSideVisibilityRules(unittest.TestCase):
    """前后端同一条边界:服务端也不接受「仅本机」。"""

    def test_server_rejects_local_visibility(self):
        src = SERVER_ANNOTATIONS_TS.read_text(encoding="utf-8")
        block = _block(src, "export function normalizeVisibility(")
        self.assertIn("raw === 'public' || raw === 'private'", block)
        self.assertNotIn("local", block)


if __name__ == "__main__":
    unittest.main()
