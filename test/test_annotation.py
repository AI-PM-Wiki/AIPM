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


def _strip_comments(src: str) -> str:
    """Drop /* ... */ comments so contract assertions only read code."""
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def _decl(block: str, prop: str) -> str:
    """Return the value of a rule block's last ``prop:`` declaration."""
    hits = re.findall(rf"(?:^|[\s;{{]){re.escape(prop)}\s*:\s*([^;]+);", block)
    return hits[-1].strip() if hits else ""


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

    def test_entry_button_is_a_toggle(self):
        """入口是开关,不是「只负责开」:开着时再点一次要收起。

        与助手 FAB 的区别:助手的 FAB 在面板开着时整个隐藏(.is-hidden),
        所以它不需要「再点一次」;批注入口一直可见,收起只能由它自己承担。
        """
        block = _block(self.js, 'entry.addEventListener("click"')
        self.assertIn("if (open)", block)
        self.assertIn('panels.close("annotation"', block)
        self.assertIn('panels.claim("annotation")', block)

    def test_entry_icon_flips_between_chevrons(self):
        """入口两个状态各一枚方向箭头:收起态 ‹、展开态 ›。

        箭头指面板**将要移动的方向** —— 面板停靠在右侧,所以收起时向左(拉出来)、
        展开时向右(推回去)。刻意不用叉:页头那个叉会和面板头部自己的关闭叉在
        同一屏里打架(验收意见)。收起路径(叉按钮 / Esc / 遮罩 / 下拉)都经
        syncChrome,所以图标始终跟得上。
        """
        self.assertIn("chevronLeft:", self.js)
        self.assertIn("chevronRight:", self.js)
        sync = _block(self.js, "function syncEntry()")
        self.assertIn("ICON.chevronLeft", sync)
        self.assertIn("ICON.chevronRight", sync)
        self.assertIn("aria-expanded", sync)
        self.assertNotIn("ICON.close", sync, "页头不该出现叉(那是面板头部自己的图标)")
        # 由 syncChrome 驱动 —— 忘了接上,图标就跟不上开合
        self.assertIn("syncEntry();", _block(self.js, "function syncChrome()"))


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
        self.assertIn("var bodyText = escapeText(anno.body);", self.js)
        self.assertIn("body.textContent = bodyText;", self.js)
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


class TestUiReviewRound(unittest.TestCase):
    """第二轮验收(2026-09-21)定下的界面契约。

    这几条都是「改回去也照样能跑、但用户会立刻看出来」的那类,所以钉在源码上。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def test_headings_are_not_highlight_candidates(self):
        """标题不再送判:单独成条时是一句没头没尾的标题(「产品设计要点」)。"""
        line = next(
            l for l in self.js.splitlines() if l.strip().startswith("var BLOCK_SELECTOR")
        )
        for tag in ("h2", "h3", "h4", "h5"):
            self.assertNotIn(tag, line, f"标题 {tag} 又混进候选块了")
        self.assertIn("p", line)
        self.assertIn("blockquote", line)

    def test_already_highlighted_blocks_are_skipped(self):
        """块内的 mark 要用 querySelector 找 —— closest 是往上找,永远命中不了。"""
        block = _block(self.js, "function extractBlocks()")
        self.assertIn('el.querySelector("mark.aipm-anno-mark")', block)

    def test_smart_highlight_is_a_two_state_toggle(self):
        """建议不再逐条罗列,只有「全部高亮 / 全部关闭」两态。"""
        self.assertNotIn("aipm-anno__smart-list", self.js)
        self.assertNotIn("aipm-anno__smart-item", self.css)
        block = _block(self.js, "function renderSuggestions(payload)")
        self.assertIn("全部高亮(", block)
        self.assertIn("全部关闭(", block)
        self.assertIn("smartAnnos()", block)

    def test_smart_batch_lands_as_local_only(self):
        """智能高亮落库只落到「仅本机」,且带 origin 标记以便整批撤销。"""
        block = _block(self.js, "function applySmart(payload)")
        self.assertIn('origin: "smart"', block)
        self.assertIn('visibility: "local"', block)
        self.assertNotIn("/api/annotations", block)

    def test_duplicate_落库_is_blocked_at_apply_time(self):
        """点第二次不能重复落 —— 靠落库前重新核对块上有没有 mark。"""
        block = _block(self.js, "function applySmart(payload)")
        self.assertIn("blockMarked(block)", block)

    def test_account_button_sits_between_smart_and_close(self):
        """账号按钮夹在智能高亮与关闭之间(顺序即视觉顺序)。"""
        head = self.js[
            self.js.index('class="aipm-anno__iconbtn aipm-anno__smart"') :
            self.js.index('class="aipm-anno__iconbtn aipm-anno__close"')
        ]
        self.assertIn("aipm-anno__account", head)

    def test_composer_is_a_draft_card(self):
        """编辑区渲染成一张「新批注」卡,复用列表项的骨架与文案规则。"""
        card = _block(self.js, "function buildEditor(")
        self.assertIn('"aipm-anno__draft"', card)
        self.assertIn('"新批注"', card)
        block = _block(self.js, "function syncComposer()")
        self.assertIn("visLabel(", block)
        self.assertIn("els.draft.setAttribute(\"data-color\"", block)

    def test_visibility_picker_is_a_menu_right_of_save(self):
        """三态收进保存键右侧那颗箭头里(分体按钮);未登录点公开/私有走登录引导。"""
        card = _block(self.js, "function buildEditor(")
        self.assertLess(card.index("aipm-anno__save"), card.index("buildVisPicker()"))
        picker = _block(self.js, "function buildVisPicker(")
        self.assertIn("aipm-anno__vismenu", picker)
        for vis in ("public", "private", "local"):
            self.assertIn(f'data-vis="{vis}"', picker)
        # 右半颗只有箭头,当前范围由草稿卡的 meta 行说明
        self.assertIn("ICON.caret", picker)
        handler = _block(self.js, 'els.vislist.addEventListener("click"')
        self.assertIn("loginForDraft(", handler)
        self.assertIn('vis === "public" || vis === "private"', handler)

    def test_the_logged_out_explainer_is_gone(self):
        """用户点名删掉的那行提示不许回来。"""
        self.assertNotIn("只会存在这台设备上", self.js)
        self.assertNotIn("用 GitHub 登录后可以保存为公开或私有", self.js)


class TestUiRoundThree(unittest.TestCase):
    """第三轮验收:分栏折叠与筛选 / 全页评论 / 卡片一致性 / 内联编辑卡。"""

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.store = STORE_JS.read_text(encoding="utf-8")

    # ---- 分栏:折叠与整栏显示是两件事 ----

    def test_group_head_has_a_fold_and_an_eye(self):
        head = _block(self.js, "function groupHead(")
        self.assertIn('"fold-group"', head)
        self.assertIn('"toggle-group"', head)
        self.assertIn('"aria-expanded"', head)
        self.assertIn('"aria-pressed"', head)

    def test_both_states_are_persisted(self):
        """折叠态与「整栏不显示」都落进 prefs,刷新后保持。"""
        self.assertIn("collapsedLocal:", self.store)
        self.assertIn("collapsedPrivate:", self.store)
        self.assertIn("collapsedPublic:", self.store)
        prefs = _block(self.store, "function prefs()")
        self.assertIn("showLocal:", prefs)
        # 默认展开:不是 === true 就当展开
        self.assertIn("=== true", prefs)

    def test_position_key_falls_back_in_three_steps(self):
        block = _block(self.js, "function positionKey(")
        self.assertIn("offsetOf(", block)
        self.assertIn('"TextPositionSelector"', block)
        self.assertIn("Infinity", block)

    def test_orphans_are_excluded_from_the_sort_key(self):
        """applyAll 先写 resolved 再 markRange,孤儿两处都在 —— 排序前必须先排除。"""
        self.assertIn("if (!orphanIds[anno.id])", _block(self.js, "function positionKey("))
        # orphanIds 由 applyAll 维护,render 只读
        self.assertIn("orphanIds = {};", _block(self.js, "function applyAll()"))

    def test_list_is_sorted_by_document_position(self):
        """批注按正文位置排;评论另有一套排序比较器(见 TestUiRoundFour)。"""
        block = _block(self.js, "function render()")
        self.assertIn("visible.sort(panelMode === \"comments\" ? commentComparator(commentSort) : byPosition)", block)

    # ---- 全页评论 ----

    def test_page_comments_are_never_orphans(self):
        """全页评论本来就没有位置,画不出高亮也不该被打成「未在正文中定位」。"""
        block = _block(self.js, "function applyAll()")
        self.assertIn("isPageComment(anno)", block)
        self.assertIn("continue;", block)

    def test_page_comment_target_carries_the_scope_flag(self):
        self.assertIn('scope: "page"', _block(self.js, "function submitAnnotation("))

    def test_title_toggles_between_annotations_and_comments(self):
        block = _block(self.js, "function syncMode()")
        self.assertIn('"评论"', block)
        self.assertIn('"批注"', block)
        self.assertIn("els.smart.hidden", block)

    def test_smart_button_hidden_attribute_actually_hides(self):
        """iconbtn 是 inline-flex,作者样式优先于 UA 的 [hidden]{display:none} ——
        少一条 .aipm-anno__iconbtn[hidden] 的收回规则,评论模式下智能高亮按钮
        会照样杵在页头。"""
        css = self.css
        rule = css[css.index(".aipm-anno__iconbtn[hidden]") :]
        rule = rule[: rule.index("}")]
        self.assertIn("display: none", rule)

    def test_comment_mode_still_offers_the_selection_toolbar(self):
        """在评论视图里划词也要出悬浮窗(第三轮验收第 6 条),而且落了批注要切回
        批注视图 —— 否则新卡片落在一个只列整页评论的列表里,看起来像没反应。"""
        handler = self.js[self.js.index('document.addEventListener("selectionchange"') :]
        handler = handler[: handler.index("toolbar.addEventListener")]
        self.assertNotIn('panelMode === "comments"', handler)
        # 切视图那句抽成了 showInAnnotations():划词落高亮(不写字)那条路也要切,
        # 两个入口共用一份,不再是 startCreate 里的私有动作。
        helper = _block(self.js, "function showInAnnotations()")
        self.assertIn('panelMode = "annotations"', helper)
        self.assertIn("showInAnnotations()", _block(self.js, "function startCreate()"))
        self.assertIn("showInAnnotations()", _block(self.js, "function quickHighlight()"))

    def test_comment_mode_has_its_own_new_entry(self):
        """没有划词这个动作,就得有一颗看得见的「写一条评论」。"""
        self.assertIn('"new-comment"', _block(self.js, "function render()"))
        self.assertIn("startPageComment()", self.js)

    # ---- 卡片:四个操作各归其位 ----

    def test_card_actions_are_positioned_not_listed(self):
        """改色在左上角圆点、编辑与删除在右上角 —— 都是按钮,不是底部那排文字链。
        铅笔与叉抽进了 cardTools(),由批注卡与评论卡共用。"""
        item = _block(self.js, "function renderItem(anno, isOrphan)")
        self.assertIn("aipm-anno__dotwrap", item)
        self.assertIn('dot.type = "button"', item)
        self.assertIn("cardTools(anno)", item)
        tools = _block(self.js, "function cardTools(")
        # 断言的是「两颗带 data-action 的图标按钮」这件事,不锁具体的类名 ——
        # 类名从 item-edit/item-close 换成共用的 ibtn 时,这条契约没变。
        self.assertIn('"edit"', tools)
        self.assertIn('"delete"', tools)
        self.assertIn("ICON.edit", tools)
        self.assertIn("startEdit(anno)", tools)
        self.assertIn("removeAnnotation(anno)", tools)
        for gone in ('actionButton("改色"', 'actionButton("删除"', 'actionButton("编辑"'):
            self.assertNotIn(gone, item)
            self.assertNotIn(gone, tools)

    def test_recolour_goes_through_the_dot_popover(self):
        self.assertIn("function togglePop(", self.js)
        pop = _block(self.js, "function togglePop(")
        self.assertIn("styleHtml()", pop)
        self.assertIn("swatchHtml()", pop)
        self.assertIn("apply({ color: color })", pop)
        self.assertIn("closePop()", _block(self.js, "function render()"))

    def test_highlight_only_cards_use_a_badge(self):
        item = _block(self.js, "function renderItem(anno, isOrphan)")
        self.assertIn('"仅高亮"', item)
        self.assertNotIn("(只有高亮,没有文字)", self.js)

    # ---- 内联编辑卡 ----

    def test_editor_is_produced_by_render(self):
        """列表整体重建,编辑器只能现场产出 —— 不能再有面板底部那条常驻表单。"""
        self.assertIn("materializeEditor()", _block(self.js, "function render()"))
        shell = self.js[: self.js.index("function render()")]
        self.assertNotIn("aipm-anno__composer", shell)
        self.assertNotIn("aipm-anno__input", shell)

    def test_edit_happens_in_place(self):
        item = _block(self.js, "function renderItem(anno, isOrphan)")
        self.assertIn('editorDraft.kind === "edit"', item)

    def test_create_editor_is_sorted_like_a_card(self):
        """新建的批注卡落在它选中那段文字的位置上,而不是钉在面板底部。"""
        self.assertIn("positionKey({", _block(self.js, "function draftKey()"))
        self.assertIn("positionKey({", _block(self.js, "function draftKey()"))

    def test_edit_can_change_visibility(self):
        """服务端批注的可见性可以就地改;本机批注改成公开/私有就是「连这次编辑
        一起上传」,不能只上传旧正文。"""
        block = _block(self.js, "function submitEditor()")
        self.assertIn("patch.visibility", block)
        self.assertIn("uploadLocal(", block)

    def test_a_draft_remembers_what_it_was_editing(self):
        """编辑到一半去登录,回来要接着编那一条 —— 当成新建的话草稿没有选区,
        用户只会撞上「先在正文里选中一段话」。"""
        draft = _block(self.js, "function draftForLogin()")
        self.assertIn("resumeId:", draft)
        self.assertIn("resumeKind:", draft)
        restore = _block(self.js, "function maybeRestoreDraft()")
        self.assertIn("draft.resumeId", restore)

    def test_reply_editor_nests_under_its_parent(self):
        item = _block(self.js, "function renderItem(anno, isOrphan)")
        self.assertIn("repliesBox(anno)", item)
        box = _block(self.js, "function repliesBox(anno)")
        self.assertIn('editorDraft.kind === "reply"', box)
        self.assertIn("aipm-anno__replies", box)

    # ---- 账号 ----

    def test_account_icon_switches_with_login_state(self):
        block = _block(self.js, "function syncAccountButton()")
        self.assertIn("ICON.login", block)
        self.assertIn("aipm-anno__avatar", block)
        # avatarUrl 是可选字段,缺了要退回登录名首字母
        self.assertIn("avatarUrl", block)
        self.assertIn("avatar--letter", block)

    # ---- 移动端 ----

    def test_mobile_opens_the_editor_at_the_tallest_snap(self):
        """手机上一划词就要写字,抽屉不能停在 peek 那一条上。"""
        self.assertIn('setSnap("expanded"', _block(self.js, "function beginEditor("))

    def test_peek_height_follows_the_inline_editor(self):
        """编辑卡搬进列表之后,peek 不能再量那条已经不存在的底部输入区。"""
        block = _block(self.js, "function refreshPeek()")
        self.assertIn("els.composer ||", block)
        self.assertNotIn("els.composer.offsetHeight", block)

    def test_compact_does_not_fade_the_editor(self):
        self.assertIn(
            ".aipm-anno.is-compact .aipm-anno__list > *:not(.aipm-anno__composer)",
            self.css,
        )

    # ---- 样式 ----

    def test_card_is_a_positioning_context(self):
        self.assertIn("position: relative;", _block(self.css, ".aipm-anno__item {"))

    def test_split_button_squares_the_touching_corners(self):
        """分体按钮的圆角必须写在 border-radius 简写之后,否则会被一并重置。"""
        save = self.css.index(".aipm-anno__actions .aipm-anno__save {")
        plain = self.css.index("border-radius: .3rem;", save)
        squared = self.css.index("border-top-right-radius: 0;", save)
        self.assertLess(plain, squared)

    def test_split_button_reads_as_one_control(self):
        """保存 + 可见范围是一颗分体按钮,不是两颗挨着的按钮。三条各自都能把它拆成
        两颗,所以逐条钉住:底色与字色右半跟左半同一套(右半自己描一圈线就成了一颗
        独立的描边按钮,跟实心的左半拼在一起最割裂);左半去掉右边框、右半整颗不描边,
        两个盒子正好相接,缝里叠不出两层边框(那条发丝线交给右半用 inset 阴影画在
        填充色上);右半 align-self: stretch 跟着行高走,行高由「取消」「保存」这类
        文字按钮定 —— 自己算一套内边距就差出几个像素,一眼看出是两颗。
        """
        # 基础规则在文件里排在 .aipm-anno__actions 那条之前,index 取到的就是它
        base_vis = _block(self.css, ".aipm-anno__visbtn {")
        row = _block(self.css, ".aipm-anno__actions .aipm-anno__vismenu {")
        # 从 visbtn 之后切,避开头一条 .aipm-anno__save 是与 cancel 合写的那条
        after_vis = self.css[self.css.index(".aipm-anno__actions .aipm-anno__visbtn {"):]
        save = _block(after_vis, ".aipm-anno__actions .aipm-anno__save {")
        self.assertEqual(_decl(base_vis, "background"), "var(--md-accent-fg-color)")
        self.assertEqual(_decl(base_vis, "color"), "var(--md-accent-bg-color)")
        self.assertEqual(_decl(base_vis, "border"), "0")
        self.assertEqual(_decl(save, "border-right"), "0")
        self.assertEqual(_decl(row, "align-self"), "stretch")
        self.assertIn("box-shadow", _block(self.css, ".aipm-anno__actions .aipm-anno__visbtn {"))


class TestUiRoundFour(unittest.TestCase):
    """第四轮验收:任意显隐 / 三类画法 / 悬浮窗完整选择 / 评论排序 /
    回复的回复与权限 / 点赞。"""

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.store = STORE_JS.read_text(encoding="utf-8")

    # ---- 分栏:随意的显隐 ----

    def test_the_eye_guard_is_gone(self):
        """第三轮那道「至少留一栏」的护栏按验收意见撤掉 —— 支持随意显隐。"""
        block = self.js[self.js.index('els.list.addEventListener("click"') :]
        block = block[: block.index("els.account.addEventListener")]
        self.assertNotIn("left.length === 0", block)
        self.assertNotIn("orphansShown", block)
        self.assertIn("setPrefs(showPatch)", block)

    def test_the_eye_hides_the_items_not_the_group(self):
        """眼睛收走的是这一栏的**内容**,不是这一栏本身:标题、条数与那只眼睛都留在
        原地(标题变淡)。连标题一起收的话,点过的那只眼睛会跟着标题一起没了 ——
        它自己就长在标题上,那一栏再也叫不回来。"""
        block = _block(self.js, "function render()")
        self.assertNotIn("if (!shown && !draftHere) return;", block)
        self.assertIn("var hidden = prefs[groupShownKey(g.key)] === false;", block)
        self.assertLess(
            block.index("appendChild(groupHead("), block.index("if (hidden ||")
        )

    def test_a_hidden_column_keeps_its_head_even_when_empty(self):
        """空栏平时不露头(一页干净的时候不该挂着三行 0),被眼睛收走的那一栏例外:
        标题与眼睛是唯一的回来路。"""
        block = _block(self.js, "function render()")
        self.assertIn("if (visible.length === 0 && !draftHere && !hidden) return;", block)

    def test_empty_panel_counts_content_not_chrome(self):
        """面板空不空只看真正的内容。判据不能是 childNodes.length —— 排序条与
        「写一条评论」常驻在列表里,那样会被误判成「还有内容」,评论视图下那句
        「还没有人…」就永远露不了面。"""
        body = _block(self.js, "function render(")
        self.assertIn("contentCount", body)
        self.assertIn("if (contentCount === 0) {", body)
        self.assertNotIn("if (els.list.childNodes.length === 0)", body)

    # ---- 三类画法 ----

    def test_three_styles_are_offered_as_icons(self):
        styles = self.js[self.js.index("var STYLES = [") : self.js.index("var COMMENT_SORTS")]
        for sid in ("underline", "highlight", "both"):
            self.assertIn(f'id: "{sid}"', styles)
        self.assertIn("icon:", styles)
        # 图标按钮,不是文字按钮
        builder = _block(self.js, "function styleHtml()")
        self.assertIn("st.icon", builder)
        self.assertIn("aipm-anno__tb-style", builder)
        self.assertIn('aria-label="', builder)
        # 按钮正面是图标,文字只进 title / aria-label
        self.assertIn("st.icon +", builder)
        self.assertIn('"</button>"', builder)

    def test_the_show_all_button_is_gone(self):
        """「显示全部」是第三轮那颗「回来的路」的补丁 —— 那时三栏收光后面板上只剩
        一句空白,因为眼睛自己长在被收走的标题上。现在标题一直留着,点哪只眼睛都能
        回来,那颗按钮没得可走了,不许回潮。"""
        block = _strip_comments(_block(self.js, "function render()"))
        self.assertNotIn('"show-all"', block)
        self.assertNotIn("显示全部", _strip_comments(self.js))

    def test_hiding_a_column_also_takes_its_page_highlights(self):
        """眼睛收走的那一栏,正文里对应的高亮也跟着收。收的是**画上去的那一笔**,
        不是那段文字:mark 仍旧裹着原文,只把底色与下划线撤掉 —— display/visibility
        一类的规则会把正文挖出几个洞,行高也跟着跳。"""
        mark = _block(self.js, "function markRange(")
        self.assertIn('setAttribute("data-group", groupOf(anno))', mark)
        sync = _block(self.js, "function syncGroupVisibility(")
        self.assertIn('cl.toggle("aipm-anno-hide-" + g, off)', sync)
        self.assertIn('prefs[prefKey("show", g)] === false', sync)
        self.assertIn('document.querySelectorAll', sync)
        render = _block(self.js, "function render()")
        self.assertIn("syncGroupVisibility();", render)
        for group in ("public", "private", "local"):
            rule = _block(
                self.css,
                f'.aipm-anno-hide-{group} .aipm-anno-mark[data-group="{group}"]',
            )
            self.assertEqual(_decl(rule, "background"), "transparent")
            self.assertEqual(_decl(rule, "border-bottom-color"), "transparent")
            self.assertNotIn("display", rule)
            self.assertNotIn("visibility", rule)

    def test_hidden_highlights_leave_the_tab_order(self):
        """收走的那几条也不再留在 Tab 序列里:看不见的东西被键盘停在上面,焦点环会
        凭空画在一段没有任何标记的文字上。aria-label 不能撤 —— 打成 aria-hidden 会
        把那段正文一起读没了。"""
        sync = _block(self.js, "function syncGroupVisibility(")
        self.assertIn('setAttribute("tabindex", off ? "-1" : "0")', sync)
        self.assertNotIn("aria-hidden", _strip_comments(sync))

    def test_a_hidden_column_takes_its_orphans_with_it(self):
        """未在正文中定位的那些也属于它原来那一栏,眼睛收走一栏时不许从这里漏回来。"""
        block = _block(self.js, "function render(")
        self.assertIn("shownOrphans", block)
        self.assertIn("prefs[groupShownKey(groupOf(anno))] !== false", block)
        self.assertNotIn("String(orphans.length)", block)

    def test_the_comments_eye_never_touches_the_page(self):
        """评论不锚正文,评论那一栏的眼睛只管列表 —— 它不该碰正文里的高亮。
        两边因此各存一份键:在评论面板里收掉一栏,文章该怎么画还怎么画。"""
        key = _block(self.js, "function groupShownKey(")
        self.assertIn('panelMode === "comments" ? "showComments" : "show"', key)
        # 正文那一侧读的始终是批注那份键,不看当前在哪个模式
        sync = _block(self.js, "function syncGroupVisibility(")
        self.assertIn('prefs[prefKey("show", g)] === false', sync)
        self.assertNotIn("groupShownKey", _strip_comments(sync))
        self.assertNotIn("panelMode", _strip_comments(sync))
        # 分组头 / 列表 / 未定位组 / 眼睛的点击:四处都走模式各自的那份键
        for marker in ("function groupHead(", "function render()",
                       'els.list.addEventListener("click"'):
            block = _block(self.js, marker)
            self.assertNotIn('prefKey("show"', _strip_comments(block))

    def test_both_eyes_persist_under_their_own_keys(self):
        """两份键都要落进 store 的白名单 —— prefs() 只回列出来的那几个,
        漏掉的话 setPrefs 写进去、读出来就没了(点完眼睛像没反应)。"""
        prefs = _block(self.store, "function prefs()")
        for name in ("showLocal", "showPrivate", "showPublic",
                     "showCommentsLocal", "showCommentsPrivate", "showCommentsPublic"):
            self.assertIn(f"{name}: p.{name} !== false", prefs)

    def test_store_owns_the_style_whitelist(self):
        self.assertIn('ANNO_STYLES = ["underline", "highlight", "both"]', self.store)
        self.assertIn('DEFAULT_STYLE = "highlight"', self.store)

    def test_unknown_style_falls_back(self):
        fn = _block(self.js, "function styleOf(")
        self.assertIn("store.ANNO_STYLES.indexOf(st)", fn)

    def test_marks_carry_the_style(self):
        mark = _block(self.js, "function markRange(")
        self.assertIn('mark.setAttribute("data-style", styleOf(anno))', mark)
        for style in ("underline", "highlight", "both"):
            self.assertIn(f'[data-style="{style}"]', self.css)
        # 墨色与底色两个变量,画法决定用哪个
        self.assertIn("--aipm-mark-wash", self.css)
        self.assertIn("--aipm-mark-ink", self.css)

    # ---- 悬浮窗 ----

    def test_toolbar_is_one_row_of_style_colour_pen_and_close(self):
        """一行:画法 / 颜色 / 写批注 / 收起。顺序即视觉顺序。"""
        bar = self.js[self.js.index("toolbar.innerHTML =") :]
        bar = bar[: bar.index("document.body.appendChild(toolbar)")]
        self.assertIn("styleHtml()", bar)
        self.assertIn("swatchHtml()", bar)
        self.assertLess(bar.index("styleHtml()"), bar.index("swatchHtml()"))
        self.assertLess(bar.index("swatchHtml()"), bar.index("aipm-anno__tb-annotate"))
        self.assertLess(bar.index("aipm-anno__tb-annotate"), bar.index("aipm-anno__tb-cancel"))
        # 一行:没有第二行的那种行容器
        self.assertNotIn("aipm-anno__tb-row", bar)
        self.assertNotIn("aipm-anno__tb-spacer", bar)

    def test_toolbar_drops_the_visibility_chips(self):
        """可见范围不在这条悬浮窗上问了 —— 划词挑颜色是「把这段划出来」,
        犯不着每次先答一遍给谁看。那个选择留在编辑卡的菜单里。"""
        self.assertNotIn("visChipsHtml", self.js)
        self.assertNotIn("aipm-anno__tb-vis", self.js)
        self.assertNotIn("aipm-anno__tb-vis", self.css)
        bar = self.js[self.js.index("toolbar.innerHTML =") :]
        bar = bar[: bar.index("document.body.appendChild(toolbar)")]
        for vis in ("公开", "私有", "仅本机"):
            self.assertNotIn(vis, bar)

    def test_the_pen_button_is_icon_only(self):
        """「写批注」三个字去掉,只留一支笔 —— 但它仍要能被读到、被悬停解释。"""
        bar = self.js[self.js.index("toolbar.innerHTML =") :]
        bar = bar[: bar.index("document.body.appendChild(toolbar)")]
        pen = bar[bar.index("aipm-anno__tb-annotate") :]
        pen = pen[: pen.index("</button>")]
        self.assertIn("ICON.pen", pen)
        self.assertNotIn("<span>", pen)
        self.assertIn('aria-label="写批注"', pen)
        self.assertIn('title="写批注"', pen)

    def test_picking_a_colour_highlights_without_opening_the_editor(self):
        """选色 = 当场落这条高亮:不开面板,也不要一个字。"""
        handler = self.js[self.js.index('toolbar.addEventListener("click"') :]
        handler = handler[: handler.index("\n  /*")]
        swatch_branch = handler[handler.index('closest(".aipm-anno__swatch")') :]
        swatch_branch = swatch_branch[: swatch_branch.index("return;")]
        self.assertIn("quickHighlight()", swatch_branch)
        self.assertIn("store.setLastColor(activeColor)", swatch_branch)
        self.assertNotIn("startCreate()", swatch_branch)
        self.assertNotIn("beginEditor", swatch_branch)

    def test_quick_highlight_lands_an_empty_body_annotation(self):
        """纯高亮没有文字,这是服务端明确允许的(annotations.ts 的 allowEmpty),
        所以这条路没有绕开任何校验。"""
        fn = _block(self.js, "function quickHighlight()")
        self.assertIn('submitAnnotation(selectors, "", visibility, false)', fn)
        self.assertIn("hideToolbar()", fn)
        self.assertNotIn("beginEditor", fn)
        self.assertNotIn("openPanel", fn)
        for vis in ("public", "private", "local"):
            self.assertNotIn(f'data-vis="{vis}"', fn)

    def test_only_the_pen_opens_the_editor(self):
        """写字这件事只有笔那条路要。"""
        handler = self.js[self.js.index('toolbar.addEventListener("click"') :]
        handler = handler[: handler.index("\n  /*")]
        pen = handler[handler.index("aipm-anno__tb-annotate") :]
        self.assertIn("startCreate()", pen)
        self.assertIn("beginEditor", _block(self.js, "function startCreate()"))

    def test_quick_highlight_stays_quiet_when_it_works(self):
        """落上了就是落上了,不再弹一条「已高亮 · 仅本机」:高亮当场画在正文里,
        看得见,那句话只是把视线从被划的那段拉到屏幕底下去。
        页面上的 toast 留着给**失败**用 —— 面板没开的时候,面板里那两条提示条
        都够不着,没有它「没划上」会看起来像「划上了」。"""
        self.assertNotIn("flash(", _block(self.js, "function quickHighlight()"))
        self.assertNotIn("VIS_SHORT", self.js, "短标签只剩道贺那句话在用,一并删掉")
        self.assertIn("aipm-anno__toast", self.css)
        self.assertIn("aipm-anno__toast", self.js)
        fn = _block(self.js, "function flash(")
        self.assertIn("toast.hidden = false", fn)
        self.assertIn("setTimeout", fn)
        self.assertIn("flash(text", _block(self.js, "function setHint("))

    # ---- 新卡落位 ----

    def test_new_card_lands_where_its_text_is(self):
        block = _block(self.js, "function render()")
        self.assertIn("draftRank", block)
        self.assertIn("draftRank <= positionKey(anno)", block)

    def test_new_comment_editor_lands_on_the_button_slot(self):
        """新评论的编辑卡就长在「写一条评论」那颗按钮的位置上 —— 不是另起一张按
        位置插进分栏里(评论压根没有正文位置),发出去之后也还在这一条上。"""
        block = _block(self.js, "function render()")
        self.assertIn("editorDraft.page === true ? materializeEditor()", block)
        self.assertIn('"new-comment"', block)
        # 评论不走 draftSlot:编辑卡在上面那颗按钮的位置上,不参与分组
        slot = _block(self.js, "function draftSlot()")
        self.assertIn('if (panelMode === "comments") return null;', slot)
        # 于是 render 里不再需要「评论钉在最上面」那个特例
        self.assertNotIn("-Infinity", block)

    # ---- 评论排序 ----

    def test_comment_sort_has_two_modes(self):
        """「热度 / 最新发布 / 最多回复」收成「最热 / 最新」两颗 —— 「最多回复」
        并进「最热」,因为热度本来就是点赞 + 回复。"""
        sorts = self.js[
            self.js.index("var COMMENT_SORTS = [") : self.js.index("function isPageComment(")
        ]
        self.assertIn('{ id: "hot", label: "最热" }', sorts)
        self.assertIn('{ id: "newest", label: "最新" }', sorts)
        self.assertNotIn("mostReplies", sorts)
        self.assertIn('COMMENT_SORTS = ["hot", "newest"]', self.store)
        self.assertNotIn("mostReplies", self.store)

    def test_sort_row_carries_no_label(self):
        """「排序」这个提示语按验收意见去掉 —— 芯片自己写着「最热 / 最新」,
        语义交给 radiogroup 的 aria-label。"""
        row = _block(self.js, "function sortRow()")
        self.assertNotIn("aipm-anno__sort-label", row)
        self.assertIn('setAttribute("aria-label", "评论排序")', row)
        self.assertNotIn("aipm-anno__sort-label", self.css)

    def test_most_replies_is_folded_into_hot(self):
        """两颗芯片背后只有两条分支:最新按时间,最热按热度。"""
        fn = _block(self.js, "function commentComparator(sort)")
        self.assertIn('sort === "newest"', fn)
        self.assertIn("hotOf(b) - hotOf(a)", fn)
        self.assertNotIn("mostReplies", fn)

    def test_hot_is_likes_plus_replies(self):
        self.assertIn("(anno.likeCount || 0) + repliesOf(anno)", _block(self.js, "function hotOf("))

    def test_sort_is_persisted_and_switchable(self):
        row = _block(self.js, "function sortRow()")
        self.assertIn('store.setPrefs({ commentSort: s.id })', row)
        self.assertIn("is-active", row)
        # 批注不参与评论排序
        self.assertIn("commentComparator(commentSort) : byPosition", _block(self.js, "function render()"))

    # ---- 回复 ----

    def test_reply_box_is_not_a_draft_card(self):
        """回复框与新批注卡故意不同形:不要颜色、画法、可见范围那些「批注自己的」控件。"""
        box = _block(self.js, "function buildReplyEditor(")
        self.assertIn("aipm-anno__replybox", box)
        self.assertNotIn("aipm-anno__draft", box)
        self.assertNotIn("swatchHtml()", box)
        self.assertNotIn("buildVisPicker()", box)
        self.assertIn('save.textContent = "回复"', box)

    def test_reply_to_a_reply_carries_parent_id(self):
        start = _block(self.js, "function startReply(anno, reply)")
        self.assertIn("parentId: reply ? reply.id : null", start)
        box = _block(self.js, "function repliesBox(anno)")
        self.assertIn("replyParent === r.id", box)
        self.assertIn("data-depth", box)

    def test_replies_go_through_the_reply_endpoint(self):
        """回复**不能**走 PATCH 的整数组 replies —— 那条是「仅作者」的,
        而回复的定义就是别人回你。"""
        fn = _block(self.js, "function postReply(")
        self.assertIn('"/replies"', fn)
        self.assertIn('method: "POST"', fn)
        self.assertNotIn("patchAnnotation(", fn)

    def test_logged_out_can_only_touch_local(self):
        """未登录只能在本机批注与回复:服务端那两条路都要记名。"""
        can = _block(self.js, "function canReply(")
        self.assertIn("if (isLocal(anno)) return true", can)
        self.assertIn("auth.isLoggedIn()", can)
        self.assertIn("登录后回复", _block(self.js, "function itemActions(anno, isOrphan)"))

    def test_reply_deletion_respects_authorship(self):
        can = _block(self.js, "function canDeleteReply(")
        self.assertIn("reply.author.githubId === me.githubId", can)
        self.assertIn("canEdit(anno)", can)
        fn = _block(self.js, "function removeReply(")
        self.assertIn("/replies/", fn)
        self.assertIn('method: "DELETE"', fn)

    # ---- 点赞 ----

    def test_like_button_only_on_server_annotations(self):
        acts = _block(self.js, "function itemActions(anno, isOrphan)")
        self.assertIn("if (!isLocal(anno)) acts.appendChild(likeButton(anno))", acts)
        btn = _block(self.js, "function likeButton(")
        self.assertIn("ICON.heart", btn)
        self.assertIn("ICON.heartOutline", btn)
        self.assertIn("likeCount", btn)

    def test_liking_needs_login(self):
        fn = _block(self.js, "function toggleLike(")
        self.assertIn("auth.login(location.href)", fn)
        self.assertIn('method: liked ? "DELETE" : "PUT"', fn)
        # 就地更新,不整页重拉(点赞是高频轻动作,重拉会把列表滚回顶部)
        self.assertIn("anno.likeCount = res.body.annotation.likeCount", fn)

    # ---- 发出去的形状 ----

    def test_style_is_sent_on_create(self):
        fn = _block(self.js, "function submitAnnotation(")
        self.assertIn("style: activeStyle", fn)

    def test_style_and_colour_are_patched_together(self):
        fn = _block(self.js, "function submitEditor()")
        self.assertIn("style: activeStyle", fn)
        self.assertIn("apply({ style: nextStyle })", self.js)
        self.assertIn("apply({ color: color })", self.js)
        # 已存卡片把这两个回调接到 patchAnnotation 上,服务端 PATCH 支持 style
        self.assertIn("patchAnnotation(anno, patch);", self.js)

class TestUiRoundFive(unittest.TestCase):
    """第五轮验收:页头收拢到右侧 / 评论卡另起一套 / 评论编辑卡落在入口按钮上。"""

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    # ---- 页头:账号与关闭贴右边 ----

    def test_head_actions_are_pushed_right_as_one_group(self):
        """三颗图标按钮各给一个 margin-left:auto 的话,富余空间会被**平摊**成三段
        —— 智能高亮飘在中间、账号飘在三分之二处,看起来是三颗各管各的散点。auto
        只能落在这一串的第一颗身上;评论模式下第一颗被藏起来,靠相邻兄弟规则交接。"""
        head = self.css[self.css.index(".aipm-anno__head .aipm-anno__smart {") :]
        head = head[: head.index(".aipm-anno__iconbtn {")]
        self.assertIn("margin-left: auto", head)
        self.assertIn(".aipm-anno__smart[hidden] + .aipm-anno__account", head)
        # 账号与关闭自己**不**再各要一份
        account = self.css[self.css.index(".aipm-anno__head .aipm-anno__smart[hidden]") :]
        account = account[: account.index(".aipm-anno__iconbtn {")]
        self.assertNotIn(".aipm-anno__head .aipm-anno__account {", account)
        self.assertNotIn(".aipm-anno__head .aipm-anno__close {", account)
        # 顺序即视觉顺序:智能高亮 → 账号 → 关闭
        panel = self.js[self.js.index("var panel = document.createElement(\"div\");") :]
        panel = panel[: panel.index("document.body.appendChild(panel)")]
        order = [panel.index("aipm-anno__smart"), panel.index("aipm-anno__account"), panel.index("aipm-anno__close")]
        self.assertEqual(order, sorted(order))

    # ---- 评论卡:另起一套骨架 ----

    def test_comment_card_does_not_reuse_the_annotation_skeleton(self):
        """评论不锚正文,批注卡顶栏那一排(色点、引文、可见范围、角标)在这里全是
        空的 —— 它要的是另一套:谁、什么时候、说了什么。"""
        item = _block(self.js, "function renderCommentItem(anno)")
        self.assertIn("aipm-anno__comment", item)
        for gone in ("aipm-anno__dotwrap", "aipm-anno__item-quote", "aipm-anno__item-body", "data-color"):
            self.assertNotIn(gone, item)
        # 它自己的骨架在 CSS 里另起一块,不复用 .aipm-anno__item 的规则
        self.assertIn(".aipm-anno__comment {", self.css)
        self.assertIn(".aipm-anno__cbody {", self.css)

    def test_comment_card_shows_avatar_name_and_time(self):
        head = _block(self.js, "function commentHead(")
        self.assertIn("avatarOf(author)", head)
        self.assertIn("aipm-anno__cname", head)
        self.assertIn("aipm-anno__ctime", head)
        self.assertIn("relTime(iso)", head)
        # 头像缺了要退回首字母,而不是留一块空白
        avatar = _block(self.js, "function avatarOf(")
        self.assertIn("avatarUrl", avatar)
        self.assertIn("is-letter", avatar)
        self.assertIn("error", avatar)
        # 时间戳走 <time> 并带完整时间做 title
        self.assertIn('t.dateTime = iso', head)
        self.assertIn("t.title = absTime(iso)", head)

    def test_relative_time_falls_back_to_a_date(self):
        fn = _block(self.js, "function relTime(iso)")
        for unit in ("刚刚", "分钟前", "小时前", "天前"):
            self.assertIn(unit, fn)
        self.assertIn("absTime(iso).slice(0, 10)", fn)

    def test_mine_gets_a_left_line(self):
        """评论没有颜色那套语言,「这条是我的」只能靠左边线。"""
        item = _block(self.js, "function renderCommentItem(anno)")
        self.assertIn('setAttribute("data-mine"', item)
        self.assertIn("canEdit(anno)", item)
        rule = self.css[self.css.index('.aipm-anno__comment[data-mine="true"]') :]
        rule = rule[: rule.index("}")]
        self.assertIn("border-left-color", rule)

    def test_comment_cards_are_measured_for_peek(self):
        """抽屉的 peek 高度按「一张卡」算 —— 评论卡得进这条查询,否则评论视图下
        peek 会掉到占位高度。"""
        self.assertIn('.aipm-anno__comment"', _block(self.js, "function refreshPeek()"))

    # ---- 评论编辑卡 ----

    def test_comment_editor_shares_the_comment_skeleton(self):
        """写的时候看到的排版,就是发出去之后的排版。"""
        fn = _block(self.js, "function buildCommentEditor(")
        self.assertIn("aipm-anno__comment is-draft", fn)
        self.assertIn('form.setAttribute("data-editor", "comment")', fn)
        # 评论没有画法与颜色,那些控件一个都不该在
        for gone in ("swatchHtml()", "styleHtml()"):
            self.assertNotIn(gone, fn)
        self.assertIn("buildVisPicker()", fn)

    def test_comment_placeholder_is_not_the_annotation_one(self):
        """「写点什么(可留空,只做高亮)」是批注的话 —— 评论既不能留空,也没有
        高亮可做。"""
        fn = _block(self.js, "function buildCommentEditor(")
        self.assertIn("写下你的评论…", fn)
        self.assertNotIn("写点什么", fn)
        # 批注那条路原样保留
        self.assertIn("写点什么(可留空,只做高亮)…", _block(self.js, "function buildEditor("))

    def test_comment_editor_shows_the_range_as_a_badge(self):
        """「这条会落到哪儿」在评论编辑卡上是右上角的角标,不是并进名字那一行 ——
        并进去的话未登录时会读成「本机 · 仅本机」,两句各说各的。"""
        fn = _block(self.js, "function buildCommentEditor(")
        self.assertIn("visBadge", fn)
        self.assertIn("head.appendChild(visBadge)", fn)
        sync = _block(self.js, "function syncComposer()")
        self.assertIn("if (els.draftVisBadge) {", sync)
        self.assertIn('els.draftMeta.textContent = me || "本机";', sync)
        # 批注草稿卡那条路原样保留:它没有角标位置,可见范围并进名字里
        self.assertIn('(me || "本机") + " · " + label.text', sync)

    def test_comment_card_carries_no_redundant_visibility_flag(self):
        """这一条在哪个分栏里,分栏标题已经写着;卡片上再标一遍是同一句话说两次。"""
        item = _block(self.js, "function renderCommentItem(anno)")
        self.assertNotIn('setAttribute("data-vis"', item)
        self.assertIn('setAttribute("data-mine"', item)
        self.assertNotIn(".aipm-anno__comment[data-vis", self.css)

    def test_comment_body_cannot_be_empty(self):
        fn = _block(self.js, "function submitEditor()")
        self.assertIn('setHint("评论不能是空的。")', fn)
        # 批注仍然允许空正文(那就是「只划线不写字」)
        self.assertNotIn('setHint("批注不能是空的。")', fn)

    def test_editor_dispatch_covers_three_shapes(self):
        fn = _block(self.js, "function materializeEditor()")
        self.assertIn("buildReplyEditor(editorDraft)", fn)
        self.assertIn("isCommentDraft()", fn)
        self.assertIn("buildCommentEditor(editorDraft)", fn)
        self.assertIn("buildEditor(editorDraft)", fn)
        # 只有新评论在全页评论的编辑卡落在那颗按钮的位置上
        self.assertIn("editorDraft.page === true", _block(self.js, "function render()"))

    def test_login_round_trip_remembers_a_page_comment(self):
        """编辑到一半去登录,回来要回到同一个位置上 —— 忘了 scope 就会拿不到选区
        的评论草稿去走批注那条路。"""
        draft = _block(self.js, "function draftForLogin()")
        self.assertIn('isCommentDraft() ? "page" : null', draft)
        restore = _block(self.js, "function maybeRestoreDraft()")
        self.assertIn('page: draft.scope === "page"', restore)

    # ---- 共用件 ----

    def test_shared_pieces_are_shared(self):
        """回复区与底部操作链两边长得一样,不该各抄一份 —— 抄一份就会各自漂移。"""
        item = _block(self.js, "function renderItem(anno, isOrphan)")
        comment = _block(self.js, "function renderCommentItem(anno)")
        for shared in ("repliesBox(anno)", "cardTools(anno)", "itemActions(anno,"):
            self.assertIn(shared, item)
            self.assertIn(shared.split("(")[0], comment)
        self.assertEqual(self.js.count("function repliesBox("), 1)
        self.assertEqual(self.js.count("function itemActions("), 1)
        self.assertEqual(self.js.count("function cardTools("), 1)

    def test_aria_labels_follow_the_card_type(self):
        tools = _block(self.js, "function cardTools(")
        self.assertIn('isPageComment(anno) ? "评论" : "批注"', tools)
        self.assertIn('"编辑这条" + what', tools)
        self.assertIn('"删除这条" + what', tools)


class TestReplyThreadFollowsItsParent(unittest.TestCase):
    """楼层按「谁回了谁」排,不是照收到的顺序平铺。

    平铺时后写的那条总落在最末尾:回第一层的那条会排在「顶层第二条」底下,缩进
    还是一层 —— 读起来就是「回的是顶层第二条」,回复挂到了不是它回的那条名下。
    回复挨着它回的那条站,缩进才说明得了问题。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.box = _block(cls.js, "function repliesBox(anno)")

    def test_replies_are_walked_as_a_tree(self):
        box = self.box
        self.assertIn("childrenOf", box)
        self.assertIn("paintReply", box)
        # 子回复紧跟在父回复后面铺开
        self.assertIn("paintReply(child, depth + 1)", box)
        # 顶层:没有父级的、以及父级已经找不到的(悬空 parentId),都从同一个桶里出来
        self.assertIn('byId[r.parentId] ? r.parentId : ""', box)
        self.assertIn('childrenOf[""]', box)
        # 平铺那条老路(照数组顺序 forEach,深度事后另算)整个撤掉
        self.assertNotIn("depthOf(", box)

    def test_editor_sits_inside_the_floor_it_answers(self):
        """回某一条回复时,输入框落在那条下面、它已有的回复之前 —— 写的时候看见的
        位置就是发出去之后的位置(新回复成为它的第一条子回复)。"""
        box = self.box
        self.assertIn("if (replyingHere && replyParent === r.id) appendEditor(depth + 1);", box)
        self.assertLess(
            box.index("appendEditor(depth + 1)"), box.index("paintReply(child, depth + 1)")
        )
        # 回整条批注(不是某条回复)→ 排在整棵树后面
        self.assertIn("if (replyingHere && replyParent === null) appendEditor(0);", box)

    def test_reply_box_carries_the_depth_it_will_join(self):
        """回复框跟着它将要成为的那一层缩进 —— 写的时候看见的层次,就是发出去之后
        的层次。两档与 .aipm-anno__reply 的缩进一致。"""
        self.assertIn('form.setAttribute("data-depth"', self.box)
        self.assertIn(
            "margin-left: .7rem", _block(self.css, '.aipm-anno__replybox[data-depth="1"] {')
        )
        self.assertIn(
            "margin-left: 1.4rem", _block(self.css, '.aipm-anno__replybox[data-depth="2"] {')
        )


class TestReplyAndDeleteAreIcons(unittest.TestCase):
    """批注卡上的「回复 / 删除」不再写字,改用图标按钮。

    参照 hypothes.is 的卡片:回复是一支回勾箭头、删除是一个垃圾桶、编辑是铅笔 ——
    这几个动作在所有评论系统里都长着同一张脸,写字只会把一行按钮撑成一行字。
    名字挪进 title 与 aria-label(图标唯一的可读副本);删除另加一道二次确认 ——
    图标按钮比文字链好点错,而删掉的东西回不来。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    # ---- 图标按钮这件东西本身 ----

    def test_icon_button_keeps_its_name_in_the_attributes(self):
        """它没有文字,title 与 aria-label 就是它的名字 —— 少写 aria-label 等于
        对读屏软件隐身。"""
        fn = _block(self.js, "function ibtn(")
        self.assertIn('b.className = "aipm-anno__ibtn"', fn)
        self.assertIn("b.title = label", fn)
        self.assertIn('b.setAttribute("aria-label", label)', fn)
        self.assertIn("b.innerHTML = icon", fn)

    def test_icon_button_has_hover_and_focus_states(self):
        rule = _block(self.css, ".aipm-anno__ibtn {")
        self.assertIn("width: 1.4rem", rule)
        self.assertIn("height: 1.4rem", rule)
        self.assertIn("fill: currentColor", _block(self.css, ".aipm-anno__ibtn svg {"))
        self.assertIn(".aipm-anno__ibtn:hover {", self.css)
        self.assertIn(".aipm-anno__ibtn:focus-visible {", self.css)

    def test_the_old_text_link_tools_are_gone(self):
        """两颗按钮替掉了旧的 .aipm-anno__item-edit / __item-close,以及回复链上
        那两条文字链,别留半套。"""
        for gone in ("aipm-anno__item-edit", "aipm-anno__item-close", "function replyTool("):
            self.assertNotIn(gone, self.js)
            self.assertNotIn(gone, self.css)

    # ---- 回复:名字一行,操作固定在右端 ----

    def test_reply_tools_are_icons_not_words(self):
        box = _block(self.js, "function repliesBox(anno)")
        self.assertIn("aipm-anno__reply-tools", box)
        self.assertIn("ICON.reply", box)
        self.assertIn("ICON.trash", box)
        for gone in ('"回复"', '"删除"', 'replyTool("回复"', 'replyTool("删除"'):
            self.assertNotIn(gone, box)

    def test_every_reply_gets_a_head_line_of_its_own(self):
        """回复排成「头一行 + 正文」。操作按钮挂在这条回复自己的头一行右端,每条
        回复的按钮因此落在同一个横坐标上 —— 连排时它们跟在正文尾巴后面,一条一个
        位置,扫下去是散的。"""
        box = _block(self.js, "function repliesBox(anno)")
        self.assertIn("aipm-anno__reply-head", box)
        self.assertIn("aipm-anno__reply-body", box)
        self.assertIn("relTime(r.createdAt)", box)
        self.assertIn("display: flex", _block(self.css, ".aipm-anno__reply-head {"))

    def test_reply_tools_are_always_visible(self):
        """触屏没有 hover。原先那套「平时 opacity .55、悬停才实」在小屏上等于把
        按钮藏了一半 —— 现在靠一档浅灰压住存在感,不再用 opacity 藏。"""
        self.assertNotIn("opacity", _block(self.css, ".aipm-anno__reply-tools {"))
        self.assertNotIn(".aipm-anno__reply:hover .aipm-anno__reply-tools", self.css)

    # ---- 删除:垃圾桶 + 二次确认 ----

    def test_card_delete_is_a_trash_icon_not_a_close(self):
        """叉写在卡片右上角,点的人多半以为那张卡只是收起来 —— 它却是一按就删。
        垃圾桶没有第二种读法,也正好跟左边那支铅笔配成一对(编辑 / 删除)。"""
        tools = _block(self.js, "function cardTools(")
        self.assertIn("ICON.trash", tools)
        self.assertNotIn("ICON.close", tools)

    def test_delete_arms_first_and_fires_on_the_second_click(self):
        fn = _block(self.js, "function armDelete(")
        self.assertIn('classList.add("is-armed")', fn)
        self.assertIn("onConfirm()", fn)
        self.assertIn("ARMED_MS", fn)
        # 点在别处 = 改主意了;点在自己身上 = 第二次点击,不能当成「别处」
        self.assertIn('document.addEventListener("click", onDoc, true)', fn)
        self.assertIn("if (!btn.contains(e.target)) disarm()", fn)
        # 上了膛的样子得一直亮着,否则看不出这颗按钮已经换了意思
        self.assertIn("var(--aipm-anno-pink)", _block(self.css, ".aipm-anno__ibtn.is-armed,"))

    def test_both_deletes_go_through_the_same_armed_helper(self):
        """卡片右上角那颗与回复右端那颗走同一条路 —— 两处各写一遍必然会漂。"""
        tools = _block(self.js, "function cardTools(")
        self.assertIn("armDelete(del,", tools)
        self.assertIn("removeAnnotation(anno)", tools)
        box = _block(self.js, "function repliesBox(anno)")
        self.assertIn("armDelete(del,", box)
        self.assertIn("removeReply(anno, r)", box)

    # ---- 卡片底部那行 ----

    def test_the_bottom_row_reply_is_an_icon_too(self):
        acts = _block(self.js, "function itemActions(anno, isOrphan)")
        self.assertIn("iconButton(ICON.reply", acts)
        self.assertNotIn('actionButton("回复"', acts)

    def test_the_logged_out_reply_keeps_its_hint_in_the_title(self):
        """未登录看别人的批注,这颗按钮还在,只是名字换成「登录后回复」,点下去先
        去登录 —— 提示没丢,丢的只是那一行字。"""
        acts = _block(self.js, "function itemActions(anno, isOrphan)")
        self.assertIn('"登录后回复"', acts)
        self.assertIn("auth.loginForDraft(draftForLogin())", acts)

    def test_the_bottom_row_lines_up(self):
        """图标按钮自带内边距,点赞与文字链跟着它对齐高度,否则一行里一高一低。"""
        self.assertIn("height: 1.4rem", _block(self.css, ".aipm-anno__like {"))
        self.assertIn(
            "height: 1.4rem",
            _block(self.css, ".aipm-anno__item-actions .aipm-anno__link {"),
        )


class TestSnapAnimationStaysSmooth(unittest.TestCase):
    """三段抽屉吸附必须真的跑完那 240ms,别每帧被量具重置一次。

    批注面板的 peek 高度靠实测量出来(卡片高 + 把手 + 页头)。早先那版量之前先把
    面板切到 data-snap="peek"、量完再切回来,以为"同一个任务里做完,浏览器只画
    一帧"。可中间要读 offsetHeight / getComputedStyle —— 那是一次强制样式与布局,
    浏览器因此真的提交了 peek 这个中间态;列表是面板的 flex 子项,高度一变就触发
    ResizeObserver,回调又走 applyMetrics → refreshPeek → 再切一次。于是吸附动画
    每一帧都被 retarget 一次,过渡时钟永远停在 ~17ms:实测 240ms 的过渡两秒才蹭到
    目标高度的九成,落点还差几十像素,慢拖时干脆一动不动。

    AI 助手面板当年踩的是同一个坑(issue #73),修法是"量具只借几何、不碰停靠点
    状态"。批注面板不需要量具类 —— 它的把手与页头不随停靠点变形,卡片在滚动列表
    里始终按自然高度排版,所以直接不碰 data-snap 即可。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def test_peek_measure_never_fakes_the_snap_state(self):
        code = _strip_comments(_block(self.js, "function refreshPeek()"))
        # 量高度不改停靠点状态(注释里可以提,代码里不许写)
        self.assertNotIn("data-snap", code)
        self.assertNotIn("setAttribute", code)

    def test_metrics_are_not_rewritten_while_animating(self):
        """动画期间 ResizeObserver 每帧都来,不能让它每帧写一遍 CSS 变量。"""
        block = _block(self.js, "new ResizeObserver(function ()")
        self.assertIn('classList.contains("is-dragging")', block)
        self.assertIn('classList.contains("is-snapping")', block)
        # 动画落定后补一次对账,动画中间跳过的那些不会丢
        snap = _block(self.js, "function markSnapping()")
        self.assertIn("applyMetrics()", snap)

    def test_apply_metrics_is_idempotent(self):
        """值没变就不写 —— 改文档根上的 CSS 变量要作废整棵树的样式计算。"""
        block = _block(self.js, "function applyMetrics()")
        self.assertRegex(block, r"if \(key === appliedMetrics\) return;")

    def test_compact_fade_is_declared_in_both_directions(self):
        """淡出 120ms 跟手指;淡入要跟面板吸附同长,不能瞬跳。

        transition 取的是"变化之后"那条规则的声明:只在 .is-compact 里写,
        类一摘掉就退回基础规则,而基础规则里没有 opacity —— 淡入 0 → 1 无插值。
        """
        base = self.css.index(".aipm-anno__list > *:not(.aipm-anno__composer),")
        compact = self.css.index(
            ".aipm-anno.is-compact .aipm-anno__list > *:not(.aipm-anno__composer),"
        )
        self.assertLess(base, compact, "基础态那条要写在 compact 那条之前")
        base_rule = _block(self.css[base:], ".aipm-anno__list > *:not(.aipm-anno__composer),")
        self.assertIn("opacity var(--aipm-anno-dur)", base_rule)
        compact_rule = _block(
            self.css[compact:],
            ".aipm-anno.is-compact .aipm-anno__list > *:not(.aipm-anno__composer),",
        )
        self.assertIn("opacity .12s linear", compact_rule)



class TestScrimTracksTheFinger(unittest.TestCase):
    """抽屉后面那层压暗:既要跟手,又不能把缓动做两遍。

    1. **跟手**。早先遮罩明暗只由 data-level 推,而 data-level 只在松手/点按时提交
       (syncChrome 的四个调用点都不在拖拽路径上)。实测慢拖到 441px(二段是 464)
       背景仍全透明,松手才从 0 开始跑满 240ms —— 拖到哪儿都一样。
    2. **只走 opacity**。早先 opacity 与 background-color 一起过渡,屏幕上看到的压暗
       是两者相乘 = 0.2·p²,缓动做了两遍(实测 35% 进度处只有 24%,单次缓动应是
       49%);而且 background-color 是绘制属性,每帧都要整屏重栅格。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.shared = SHARED_JS.read_text(encoding="utf-8")
        cls.chat_js = CHAT_JS.read_text(encoding="utf-8")
        cls.chat_css = (ROOT / "docs" / "_static" / "css" / "chat-widget.css").read_text(encoding="utf-8")

    # ---- 1. 跟手 ----

    def test_shared_code_exposes_a_height_to_value_lerp(self):
        self.assertIn("function snapLerp(", self.shared)
        self.assertRegex(
            self.shared, r"SCRIM_AT\s*=\s*\{\s*peek:\s*0,\s*half:\s*0?\.5,\s*expanded:\s*1\s*\}"
        )
        self.assertIn("snapLerp: snapLerp,", self.shared)
        self.assertIn("SCRIM_AT: SCRIM_AT,", self.shared)

    def test_drag_height_is_published_every_frame(self):
        """共享件每帧把跟手高度交出来(只在拖动中,吸附动画由 CSS 过渡接管)。"""
        block = _block(self.shared, "function attachSheetDrag(")
        self.assertIn("opts.onDragHeight(h, m)", block)

    def test_both_panels_dim_the_scrim_while_dragging(self):
        """两个面板必须同一套:占同一块屏幕区域,互相 claim 时要接得上。"""
        for js, ns in ((self.js, "panels"), (self.chat_js, "SHARED")):
            self.assertIn("onDragStart", js)
            self.assertIn("onDragHeight", js)
            self.assertIn(
                "%s.snapLerp(%s.ORDER, m, h, %s.SCRIM_AT)" % (ns, ns, ns), js
            )
            self.assertIn('els.scrim.style.opacity = String(', js)

    def test_drag_scrim_is_not_transitioned(self):
        """跟手期间带过渡的话,每帧都在追一个移动的目标(和面板高度那条同理)。"""
        for css, prefix in ((self.css, "aipm-anno"), (self.chat_css, "aipm-chat")):
            rule = _block(css, ".%s__scrim.is-dragging {" % prefix)
            self.assertIn("transition: none;", rule)

    def test_release_and_close_hand_the_scrim_back_to_css(self):
        """松手/关闭时要撤掉 inline opacity,否则它会压过 data-level。"""
        pairs = (
            (self.js, "function clearDragHeight()", "function closePanel()"),
            (self.chat_js, "const clearDragHeight = () =>", "const closePanel = (via) =>"),
        )
        for js, clear_marker, close_marker in pairs:
            for marker in (clear_marker, close_marker):
                block = _block(js, marker)
                self.assertIn('els.scrim.classList.remove("is-dragging");', block)
                self.assertIn('els.scrim.style.opacity = "";', block)

    # ---- 2. 明暗只走 opacity ----

    def test_scrim_transitions_opacity_only(self):
        for css, prefix in ((self.css, "aipm-anno"), (self.chat_css, "aipm-chat")):
            # 只看声明:注释里正解释着为什么不该有 background-color
            rule = _strip_comments(_block(css, ".%s__scrim {" % prefix))
            self.assertIn("background: rgba(0, 0, 0, .4);", rule)
            self.assertNotIn("background-color", rule)
            self.assertIn('opacity: .5;', _block(css, '.%s__scrim[data-level="half"] {' % prefix))
            self.assertIn('opacity: 1;', _block(css, '.%s__scrim[data-level="full"] {' % prefix))

    def test_scrim_darkness_matches_the_previous_representation(self):
        """换了表示法,压暗的深浅不能跟着变(旧写法:背景 .2/.4、opacity 恒为 1)。"""
        for css, prefix in ((self.css, "aipm-anno"), (self.chat_css, "aipm-chat")):
            base = float(
                re.search(
                    r"\.%s__scrim \{[^}]*background: rgba\(0, 0, 0, (\.\d+)\)" % prefix,
                    css,
                    re.S,
                ).group(1)
            )
            half = float(
                re.search(
                    r'\.%s__scrim\[data-level="half"\] \{\s*opacity: (\.?\d+)' % prefix, css
                ).group(1)
            )
            full = float(
                re.search(
                    r'\.%s__scrim\[data-level="full"\] \{\s*opacity: (\.?\d+)' % prefix, css
                ).group(1)
            )
            self.assertAlmostEqual(base * half, 0.2, places=6)
            self.assertAlmostEqual(base * full, 0.4, places=6)

    def test_both_scrims_stay_verbatim_in_sync(self):
        """除去类名前缀,两份遮罩规则应当逐字相同 —— 一处改了另一处没跟上就会分叉。"""

        def block(css, prefix):
            start = css.index(".%s__scrim {" % prefix)
            end = css.index("html.", start)
            # 注释与空行不算分叉,比的是声明本身
            return re.sub(r"\s+", " ", _strip_comments(css[start:end])).strip().replace(
                prefix, "aipm-X"
            )

        self.assertEqual(
            block(self.css, "aipm-anno"), block(self.chat_css, "aipm-chat")
        )



class TestHidingAColumnDoesNotResizeTheList(unittest.TestCase):
    """收掉一栏只是「这几条先不看了」,不该顺手把整栏卡片撑宽。

    列表是 overflow-y: auto —— 内容够长才挂滚动条,不够长那条就整根撤掉。眼睛收掉
    一栏是让内容变短的最短路径,于是滚动条一走、内容区当场宽出一条:实测 1440×900
    收掉「公开」栏,.aipm-anno__list 的 clientWidth 从 387 跳到 402,卡片与分组头
    跟着右移 15px(357 → 372)。变的是宽度,不是排版,所以看起来像整栏抖了一下。

    scrollbar-gutter: stable 让槽位常驻:有没有滚动条,内容宽度都是同一个值。
    代价是列表短的时候右边也留一条空槽 —— 比整栏文字横跳一次安静得多。
    认不得这条属性的浏览器(老 Safari)退回原先的样子,不比现在更坏。
    """

    @classmethod
    def setUpClass(cls):
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def test_the_list_reserves_its_scrollbar_gutter(self):
        rule = _strip_comments(_block(self.css, "\n.aipm-anno__list {"))
        # 得先是滚动容器,stable 才有意义;写 stable 的同时不能把 overflow-y 拿掉
        self.assertIn("overflow-y: auto;", rule)
        self.assertIn("scrollbar-gutter: stable;", rule)
        # both-edges 会在左边也多留一条,内容整体左移 —— 那不是这里要的
        self.assertNotIn("both-edges", rule)

    def test_the_list_is_the_only_scrolling_box_in_the_panel(self):
        """修的是面板里唯一的滚动容器。再长出第二个,就另开一处同样的跳变 ——
        这条断言是提醒,不是禁令:真要加,得照着上面那条一起给槽位。"""
        rule = _strip_comments(self.css)
        scrollables = re.findall(r"(?:^|[;{\s])overflow(?:-y)?:\s*(?:auto|scroll)", rule)
        self.assertEqual(len(scrollables), 1)


class TestUiRoundSix(unittest.TestCase):
    """第六轮:标题按钮要看得出来是按钮 —— 「能点」不能只在悬停时才说。"""

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def test_title_wears_an_outline_at_rest(self):
        """原先这颗按钮只有一条 :hover 底色 —— 那等于把「这里能点」只讲给鼠标听:
        触屏没有悬停,键盘更是什么都看不见。所以静息态就得有轮廓:边框 + 胶囊圆角,
        底色留空(紧挨着它的条数徽章是**实底无框**的,一虚一实才不会混成一片)。

        边框色钉 --md-default-fg-color--lighter 而不是页头那条发丝线
        --aipm-anno-line:后者在两套配色下都是 12% 的白/黑,做分隔够用,勾控件
        轮廓时暗色下几乎看不见。退回发丝线 = 暗色下这颗按钮又变回一段纯文字。
        """
        rule = _block(self.css, ".aipm-anno__title {")
        self.assertIn(
            "border: 1px solid var(--md-default-fg-color--lighter)", rule
        )
        self.assertIn("border-radius: 999px", rule)
        self.assertIn("cursor: pointer", rule)
        self.assertIn("background: transparent", rule)
        self.assertNotIn("border: 0", rule)

    def test_title_carries_a_swap_glyph(self):
        """光有边框还不说明点下去会怎样;尾巴上那对反向箭头才是「会换一份列表」
        那句话。它得写在按钮里面,并且 aria-hidden —— 名字已经由 title /
        aria-label 说了,读屏不该把图标也念一遍。
        """
        self.assertIn("swap:", self.js)
        panel = self.js[self.js.index('var panel = document.createElement("div");') :]
        panel = panel[: panel.index("document.body.appendChild(panel)")]
        button = panel[panel.index("aipm-anno__title") :]
        button = button[: button.index("aipm-anno__count")]
        self.assertIn("aipm-anno__title-label", button)
        self.assertIn("ICON.swap", button)
        self.assertIn('aria-hidden="true"', self.js[self.js.index("swap:") :][:200])

    def test_the_mode_flip_rewrites_only_the_label(self):
        """每次换模式都要改按钮正面的字,改的必须是那个 label span —— 对整颗按钮写
        textContent 会把尾巴上的图标一并抹掉,换一次模式按钮就秃了。

        aria-label 跟着当前模式走:读屏该听到「点下去会发生什么」(切到评论),
        而不是一句恒定的「切换批注与评论」。
        """
        block = _block(self.js, "function syncMode()")
        self.assertIn("els.titleLabel.textContent = label", block)
        self.assertNotIn("els.title.textContent", block)
        self.assertIn('els.title.setAttribute("aria-label", hint)', block)
        self.assertIn('els.title.setAttribute("aria-pressed"', block)


if __name__ == "__main__":
    unittest.main()
