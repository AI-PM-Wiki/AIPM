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
        """两颗按钮共用一段几何(绝对定位、页头高度内的方命中区),入口自己贴右边缘。"""
        shared = _block(self.css, ".md-header .md-header__button.aipm-anno-entry,")
        self.assertIn("position: absolute", shared)
        self.assertIn("top: 0", shared)
        self.assertIn("width: 2.4rem", shared)
        self.assertRegex(
            self.css, r"\.md-header \.md-header__button\.aipm-anno-entry \{[^}]*right:\s*0;"
        )

    def test_smart_button_sits_left_of_the_entry(self):
        """智能高亮在入口左边一站(right: 2.4rem 对上入口的 right: 0),DOM 里也排在
        入口前 —— 面板关着时它是这一页唯一的智能高亮入口。"""
        self.assertRegex(
            self.css, r"\.md-header \.md-header__button\.aipm-anno-smart \{[^}]*right:\s*2\.4rem;"
        )
        mount = _block(self.js, "function mountEntry()")
        self.assertLess(mount.index("appendChild(smartBtn)"), mount.index("appendChild(entry)"))

    def test_header_reserves_room_for_the_button_pair(self):
        self.assertRegex(self.css, r"\.md-header__inner\s*\{[^}]*padding-inline-end:\s*4\.8rem")

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
        self.assertIn("revealPanel()", block)
        # 打开那一路抽成了 revealPanel(),入口与智能高亮共用同一份
        self.assertIn('panels.claim("annotation")', _block(self.js, "function revealPanel()"))

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
        """高亮只换底色,文字颜色 inherit —— 暗色下正文对比度不被拉低。

        面板引文行里那层是同一笔的副本,和正文里的 <mark> 合用同一条规则 ——
        判据因此落在共用的那一条上,两边都跑不掉。"""
        block = _block(self.anno_css, ".aipm-anno-mark,\n.aipm-anno__quote-ink {")
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
        """建议条标注来源,回退可解释。

        来源写的是**模型 id**(jev-1.13.0 / deepseek-flash…),不写死 provider 名 ——
        兜底那一路是可配的 Anthropic 兼容端点,印死名字会跟真实模型自相矛盾。
        """
        self.assertIn('if (source === "jev") return "Jev"', self.js)
        self.assertIn('if (source === "llm") return "备用模型"', self.js)
        self.assertIn("payload.fallbackFrom", self.js)

    def test_unavailable_degrades_without_breaking_annotations(self):
        """503 时只禁用智能高亮按钮,批注主功能不受影响。"""
        block = _block(self.js, "function smartHighlight(")
        self.assertIn("res.status === 503", block)
        self.assertIn("smartBtn.disabled = true", block)

    def test_rate_limit_cooldown(self):
        block = _block(self.js, "function smartHighlight(")
        self.assertIn("res.status === 429", block)
        self.assertIn("cooldownUntil", block)

    def test_same_page_result_is_reused(self):
        self.assertIn("suggestCache[page]", self.js)


class TestRegenerateIsAdminOnly(unittest.TestCase):
    """站长在面板页头那支笔上点「重新生成」。

    两条容易悄悄回退的约定:
    - 默认仍是缓存优先,只有重新生成这一条路跳过页内那层缓存;
    - 重新生成要认人:前端只对站长把图标做成开关,服务端另有一道闸(未登录 401、
      非站长 403),两处缺一不可 —— 判分一次就是一次真金白银的调用。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.auth = AUTH_JS.read_text(encoding="utf-8")
        cls.server_src = ROOT / "annotation-server" / "src"

    def _server_file(self, rel):
        path = self.server_src / rel
        if not path.exists():  # pragma: no cover - 子模块未检出
            self.skipTest("annotation-server 子模块未检出")
        return path.read_text(encoding="utf-8")

    # ---- 前端 ----

    def test_the_page_cache_is_read_first_unless_refreshing(self):
        block = _block(self.js, "function smartHighlight(")
        self.assertIn("if (!refresh && suggestCache[page])", block)

    def test_refresh_rides_along_with_the_session(self):
        block = _block(self.js, "function smartHighlight(")
        self.assertIn("refresh: refresh", block)
        self.assertIn("auth.token()", block)

    def test_the_head_icon_becomes_a_button_only_for_the_admin(self):
        block = _block(self.js, "function syncHeadIcon()")
        self.assertIn("auth.isAdmin()", block)
        self.assertIn('classList.toggle("is-regenerate", on)', block)
        # 命中区与悬停底色沿用面板里那族图标按钮,不另起一套
        self.assertIn('classList.toggle("aipm-anno__iconbtn", on)', block)
        # 「不是站长」不能用 disabled 表达:那说的是「按不动」
        self.assertNotIn("disabled", block)

    def test_the_head_icon_is_wired_to_both_input_paths(self):
        self.assertIn('els.headIcon.addEventListener("click", headIconRegenerate)', self.js)
        self.assertIn('els.headIcon.addEventListener("keydown"', self.js)
        self.assertIn("smartHighlight({ refresh: true })", self.js)
        # 监听器常驻,身份却会变 —— 每次触发都要重新问一遍
        handler = _block(self.js, "function headIconRegenerate()")
        self.assertIn("auth.isAdmin()", handler)

    def test_the_head_icon_keeps_its_shape_for_everyone_else(self):
        """面板的标记不为站长换图形、也不为站长换位置:多出来的只有命中区与悬停底色。"""
        self.assertIn('class="aipm-anno__head-icon"', self.js)
        rule = _block(self.css, ".aipm-anno__head-icon.is-regenerate svg")
        self.assertIn("var(--md-accent-fg-color)", rule)

    def test_the_two_entry_points_do_not_double_spend(self):
        """一次重新生成就是一轮判分;连点两下不该各走一遍「缓存未命中」。"""
        block = _block(self.js, "function setSmartBusy(")
        self.assertIn("smartBtn.disabled = on", block)
        self.assertIn('els.headIcon.classList.toggle("is-busy", on)', block)
        self.assertIn("if (smartBusy) return;", _block(self.js, "function smartHighlight("))

    def test_the_head_icon_state_follows_the_login(self):
        """未登录 → 登录 → 退出登录这条来回里,标记必须跟着身份走。"""
        self.assertIn("syncHeadIcon();", _block(self.js, "auth.onChange(function ()"))
        self.assertIn("syncHeadIcon();", self.js[self.js.index("auth.ready().then(") :])

    def test_the_admin_flag_comes_from_the_server(self):
        self.assertIn("isAdmin: isAdmin", self.auth)
        self.assertIn("res.body.admin === true", self.auth)

    # ---- 服务端 ----

    def test_the_refresh_flag_is_gated_at_the_route(self):
        block = _block(self._server_file("server.ts"), "async function handleSuggest(")
        self.assertIn("parsed.data.refresh", block)
        self.assertIn("login_required", block)
        self.assertIn("isAdmin(actor, config.adminLogins)", block)
        self.assertIn("forbidden", block)

    def test_the_admin_list_is_configurable(self):
        self.assertIn("ADMIN_LOGINS", self._server_file("config.ts"))
        self.assertIn(
            "export function isAdmin(actor: Author, adminLogins: string[])",
            self._server_file("annotations.ts"),
        )

    def test_refresh_skips_the_cache_but_not_the_guardrails(self):
        """绕开的是缓存那一层。限流、并发与预算仍在它后面 —— 重新生成照样要花钱,
        不该因为它是站长点的就放过护栏。"""
        block = _block(self._server_file("highlight/index.ts"), "async suggest(")
        self.assertIn("raw.refresh !== true", block)
        cache = block.index("raw.refresh !== true")
        self.assertLess(cache, block.index("this.limiter.tryAcquire(ipKey)"))
        self.assertLess(cache, block.index("this.semaphore.acquire("))


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


class TestSmartHighlightBlockSources(unittest.TestCase):
    """issue #87:送去判分的块必须是「站内正文索引里找得到的文字」。

    前端按 DOM 抽块,抽到的未必都是页面正文 —— 主题模板塞进 article 的页脚版权行
    (partials/comments.html)就不在索引里(索引按 page.content 建),原文送去只会被
    服务端判为「不属于该页」。而服务端那条 400 会整批判死:改之前每一页都有一块
    验不过,首页的 hero 眉题更是第一块,用户看到的就是「智能高亮失败:块 b0 的文本
    不属于该页面(not_in_page)」。

    两侧各钉一条:前端把模板块挡在编号之后(保住 id→段落映射,服务端同页缓存按页面
    内容哈希共享),服务端逐块给结论、只丢验不过的块并降级,一块都验不过才 400。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.index_store_path = ROOT / "annotation-server" / "src" / "index-store.ts"
        cls.highlight_path = ROOT / "annotation-server" / "src" / "highlight" / "index.ts"

    def test_template_chrome_is_not_sent_as_a_block(self):
        block = _block(self.js, "function extractBlocks(")
        self.assertIn('el.closest(".page-copyright")', block)

    def test_chrome_filter_runs_after_numbering(self):
        """模板块要占一个编号但不送出:改编号会让别人缓存里的建议落到错段落。"""
        block = _block(self.js, "function extractBlocks(")
        numbered = block.index('var id = "b" + seq++;')
        skipped = block.index('el.closest(".page-copyright")')
        self.assertGreater(
            skipped, numbered, "模板文字的过滤必须在编号之后(与已高亮块同一条理由)"
        )

    def _server_source(self, path, marker):
        """读子模块里服务端的源码;修复还没随 gitlink 同步进来时跳过。

        子模块 gitlink 由 Bump Submodules 工作流每 6h 从子模块 main 同步一次:
        在这条修复合入子模块 main 之前,这里读到的还是旧代码。跳过的理由必须写明,
        免得「测试绿了」被当成「服务端也有这条修复」。
        """
        if not path.exists():
            self.skipTest("annotation-server 子模块未检出")
        src = path.read_text(encoding="utf-8")
        if marker not in src:
            self.skipTest(f"{path.name} 尚未同步到含 {marker} 的 commit")
        return src

    def test_server_decodes_index_entities(self):
        """索引是构建期 html.escape 过的:不解码,含 < > & 引号 撇号的段落全验不过。"""
        src = self._server_source(self.index_store_path, "normalizeIndexText")
        block = _block(src, "export function normalizeIndexText(")
        self.assertIn("decodeEntities(", block)
        self.assertIn("stripIndexTags(", block)

    def test_server_drops_unverifiable_blocks_instead_of_rejecting_the_batch(self):
        index_store = self._server_source(self.index_store_path, "normalizeIndexText")
        block = _block(index_store, "export function verifyBlocks(")
        self.assertIn("accepted", block)
        self.assertIn("rejected", block)
        self.assertNotIn("reason: 'not_in_page' };", block)

        service = self._server_source(self.highlight_path, "verdict.accepted.length === 0")
        guard = _block(service, "if (verdict.accepted.length === 0)")
        self.assertIn("blocks_not_in_page", guard, "一块都验不过才 400")
        self.assertIn(
            "const degraded: DegradedBlock[] = rejected.map(",
            service,
            "被丢掉的块要进 degraded,不能静默吞掉",
        )


class TestSmartbarNoticeScope(unittest.TestCase):
    """建议条这一行的三条验收意见(2026-09-22)。

    用户看到的原话:通知显示不全(「智能高亮 · 来源 Claude (由 Jev 回退) deep」)、
    「10 段未判定又是什么鬼」、通知不随页面切换。三条都钉在这里,免得改回去也能跑。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def test_source_line_uses_the_model_id(self):
        """「来源」一律说服务端回的模型 id。

        写死 provider 名会撒谎:兜底那一路是可配的 Anthropic 兼容端点,线上指到
        DeepSeek 时条子上却印着「来源 Claude」,后面还跟着 deepseek-flash。
        """
        self.assertIn("function judgeLabel(payload)", self.js)
        block = _block(self.js, "function judgeLabel(payload)")
        self.assertIn("payload.model", block)
        self.assertNotIn('"Claude"', self.js)

    def test_head_wraps_instead_of_truncating(self):
        """标题行换行、不省略 —— 截掉尾巴的「来源」等于没写。"""
        block = _block(self.css, ".aipm-anno__smart-head {")
        self.assertNotIn("text-overflow: ellipsis", block)
        self.assertNotIn("white-space: nowrap", block)
        self.assertIn("min-width: 0", block, "可缩:不然会把关闭按钮顶出条子")

    def test_deliberate_skips_are_not_reported_as_undecided(self):
        """「N 段未判定」只数真失败,不数刻意跳过的段落。

        过短、代码块、导航、重复、不值得高亮、超出每页上限 —— 这些是设计内的跳过,
        数量还随页面结构浮动,摆成「10 段未判定」只会让人以为坏了。
        """
        deliberate = _block(self.js, "var DELIBERATE_SKIP = {")
        for reason in ("too_short", "code", "navigation", "duplicate", "not_worth", "over_page_limit"):
            self.assertIn(reason, deliberate, f"{reason} 是刻意跳过,不该计进未判定")
        for reason in ("not_in_page", "no_answer", "budget_exhausted"):
            self.assertNotIn(reason, deliberate, f"{reason} 是真失败,必须报出来")
        block = _block(self.js, "function renderSuggestions(payload, page)")
        self.assertIn("DELIBERATE_SKIP[code]", block)
        self.assertIn("段没能判定", block)
        self.assertNotIn('" 段未判定"', self.js)

    def test_smartbar_follows_the_page(self):
        """换页后条子不能继续说上一页的事。"""
        page_change = _block(self.js, "function onPageChange(")
        self.assertIn("syncSmartbar();", page_change)
        sync = _block(self.js, "function syncSmartbar()")
        self.assertIn("suggestCache[page]", sync, "新页有缓存就直接摆出来")
        self.assertIn('setSmartbar("", "")', sync, "没有缓存就收起")

    def test_dismissal_is_per_page_and_beats_the_auto_restore(self):
        """用户亲手关掉的条子不许自动弹回来 —— 但「关掉」只对那一页作数。

        「换页时收起」与「用户点了叉」是同一个可见结果(条子不见了),得分两个状态
        记:前者换回来要能自动恢复,后者不能。第一版把它们混成一个 hidden 判断,
        结果是换页再回来时缓存好的结果也摆不出来了。
        """
        self.assertIn("var smartbarDismissed = null;", self.js)
        close = self.js[self.js.index("smartClose.addEventListener") :]
        close = close[: close.index("});")]
        self.assertIn("smartbarDismissed = pagePath();", close)
        sync = _block(self.js, "function syncSmartbar()")
        self.assertIn("if (smartbarDismissed === page) return;", sync)
        # 有新内容要显示时,「关过」的记号清掉
        self.assertIn("smartbarDismissed = null;", _block(self.js, "function setSmartbar(text, kind)"))
        self.assertIn(
            "smartbarDismissed = null;", _block(self.js, "function renderSuggestions(payload, page)")
        )

    def test_fallback_parenthetical_wraps_as_one_piece(self):
        """「(Jev 不可用)」整体换行,不能断在「不可」和「用」之间。"""
        why = _block(self.css, ".aipm-anno__smart-why {")
        self.assertIn("white-space: nowrap", why)
        render = _block(self.js, "function renderSuggestions(payload, page)")
        self.assertIn('why.className = "aipm-anno__smart-why";', render)
        self.assertIn("createTextNode", render, "逐段 append 文本节点")
        self.assertNotIn("innerHTML =", render, "不拼 HTML 字符串")

    def test_cached_result_rebinds_block_ranges(self):
        """缓存里的 Range 指向上一份 DOM:按块 id 重绑,绑不上的块宁可丢掉。"""
        self.assertIn("function withLiveBlocks(payload)", self.js)
        block = _block(self.js, "function withLiveBlocks(payload)")
        self.assertIn("extractBlocks(true)", block, "已落过高亮的块也要取到(否则它会「不存在」)")
        self.assertIn("out.blocks = blocks;", block)
        render = _block(self.js, "function renderSuggestions(payload, page)")
        self.assertIn("payload = withLiveBlocks(payload);", render)

    def test_smartbar_records_which_page_it_describes(self):
        self.assertIn("var smartbarPage = null;", self.js)
        block = _block(self.js, "function setSmartbar(text, kind)")
        self.assertIn("smartbarPage = pagePath();", block)
        self.assertIn("smartbarPage = null;", block)
        render = _block(self.js, "function renderSuggestions(payload, page)")
        self.assertIn("smartbarPage = page || pagePath();", render)


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
        block = _block(self.js, "function extractBlocks(")
        self.assertIn('el.querySelector("mark.aipm-anno-mark")', block)

    def test_smart_highlight_is_a_two_state_toggle(self):
        """建议不再逐条罗列,只有「全部高亮 / 全部关闭」两态。"""
        self.assertNotIn("aipm-anno__smart-list", self.js)
        self.assertNotIn("aipm-anno__smart-item", self.css)
        block = _block(self.js, "function renderSuggestions(payload")
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

    def test_panel_head_keeps_only_account_and_close(self):
        """智能高亮搬去了页头:面板页头这一串只剩账号与关闭(顺序即视觉顺序),
        账号是头一颗。"""
        head = self.js[
            self.js.index('class="aipm-anno__iconbtn aipm-anno__account"') :
            self.js.index('class="aipm-anno__iconbtn aipm-anno__close"')
        ]
        self.assertIn("用 GitHub 登录", head)
        self.assertNotIn("aipm-anno__smart", head)

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
        # 智能高亮按钮不在面板里了,不随模式显隐;跟着模式一起收的是它那条回执
        self.assertNotIn("aipm-anno__smart", block)
        self.assertIn('setSmartbar("", "")', block)

    def test_smart_button_is_not_hidden_by_the_panel_mode(self):
        """按钮站在面板外面,显隐就不该再跟着面板里的模式走 —— 面板关着的时候用户
        看不见当前是哪一份列表,一颗「有时在、有时不在」的页头按钮就是没来由的
        闪烁。所以它一直可见,点击时自己把面板切回批注模式并叫出来。"""
        block = _block(self.js, "function smartHighlight(")
        self.assertIn('panelMode = "annotations"', block)
        self.assertIn("revealPanel()", block)
        self.assertNotIn("smartBtn.hidden", self.js)
        # 面板里的 iconbtn 不再有需要 [hidden] 收回的那一颗,规则随之删掉
        self.assertNotIn(".aipm-anno__iconbtn[hidden]", self.css)

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
        self.assertIn("repliesBox(anno", item)
        box = _block(self.js, "function repliesBox(anno, opts)")
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
        box = _block(self.js, "function repliesBox(anno, opts)")
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
        self.assertIn("登录后回复", _block(self.js, "function cardReplyButton(anno)"))

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
        """两颗图标按钮各给一个 margin-left:auto 的话,富余空间会被**平摊**成两段
        —— 账号就飘到中间去了。auto 只能落在这一串的第一颗身上。

        头一颗曾经是智能高亮,还配着一条「它 [hidden] 时把 auto 交接给账号」的相邻
        兄弟规则;那颗按钮搬去页头之后,这一串固定是账号 → 关闭,交接规则也就没有
        存在的理由。"""
        head = self.css[self.css.index(".aipm-anno__head .aipm-anno__account {") :]
        head = head[: head.index(".aipm-anno__iconbtn {")]
        self.assertIn("margin-left: auto", head)
        # 账号与关闭自己**不**再各要一份,这一串里也不再提智能高亮
        self.assertNotIn(".aipm-anno__head .aipm-anno__close {", head)
        self.assertNotIn(".aipm-anno__head .aipm-anno__smart", self.css)
        # 顺序即视觉顺序:账号 → 关闭
        panel = self.js[self.js.index("var panel = document.createElement(\"div\");") :]
        panel = panel[: panel.index("document.body.appendChild(panel)")]
        order = [panel.index("aipm-anno__account"), panel.index("aipm-anno__close")]
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
        for shared in ("repliesBox(anno", "cardTools(anno)", "itemActions(anno,"):
            self.assertIn(shared, item)
            self.assertIn(shared.split("(")[0], comment)
        self.assertEqual(self.js.count("function repliesBox("), 1)
        self.assertEqual(self.js.count("function itemActions("), 1)
        self.assertEqual(self.js.count("function cardTools("), 1)

    def test_both_cards_share_one_reply_hierarchy(self):
        """回复那套层级只有**一份**实现,批注卡与评论卡都从它出来 —— 「收起回复」、
        逐层折叠、@ 拍平、翻页、计数全在 repliesBox 里。谁要是给其中一边另写一套,
        两边的层级迟早会漂,而漂的那一边没人会立刻发现。
        """
        item = _block(self.js, "function renderItem(anno, isOrphan)")
        comment = _block(self.js, "function renderCommentItem(anno)")
        # 批注卡多传一个「默认折起来」—— 层级本身仍是同一份实现
        self.assertIn("repliesBox(anno, { cardFold: true, folded: true })", item)
        self.assertIn("repliesBox(anno, { cardFold: true })", comment)
        for fn in (
            "function repliesBox(",
            "function replyHead(",
            "function replyBody(",
            "function replyViewOf(",
            "function plannedRows(",
            "function ancestorChain(",
        ):
            self.assertEqual(self.js.count(fn), 1, f"{fn} 应当只有一份实现")
        # 回复区不认面板模式:层级与折叠对「批注 / 评论」两边是同一件事,
        # 一旦这里出现 panelMode 分支,就意味着两边开始各走各的
        box = _block(self.js, "function repliesBox(anno, opts)")
        self.assertNotIn("panelMode", box)

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
        cls.box = _block(cls.js, "function repliesBox(anno, opts)")

    def test_replies_are_walked_as_a_tree(self):
        box = self.box
        self.assertIn("childrenOf", box)
        self.assertIn("paintReply", box)
        # 子回复紧跟在父回复后面铺开(第三个参数是这个楼层还剩几行可铺)
        self.assertIn("paintReply(kids[i], depth + 1, budget)", box)
        # 顶层:没有父级的、以及父级已经找不到的(悬空 parentId),都从同一个桶里出来
        self.assertIn('byId[r.parentId] ? r.parentId : ""', box)
        self.assertIn('childrenOf[""]', box)
        # 平铺那条老路(照数组顺序 forEach,深度事后另算)整个撤掉
        self.assertNotIn("depthOf(", box)

    def test_editor_sits_inside_the_floor_it_answers(self):
        """回某一条回复时,输入框落在那条下面、它已有的回复之前 —— 写的时候看见的
        位置就是发出去之后的位置(新回复成为它的第一条子回复)。"""
        box = self.box
        self.assertIn("if (replyingHere && replyParent === r.id) {", box)
        self.assertIn("appendEditor(Math.min(depth + 1, MAX_DEPTH));", box)
        self.assertLess(
            box.index("appendEditor(Math.min(depth + 1, MAX_DEPTH))"),
            box.index("paintReply(kids[i], depth + 1, budget)"),
        )
        # 回整条批注(不是某条回复)→ 排在整棵树后面
        self.assertIn("if (replyingHere && replyParent === null) appendEditor(0);", box)

    def test_reply_box_carries_the_depth_it_will_join(self):
        """回复框跟着它将要成为的那一层缩进 —— 写的时候看见的层次,就是发出去之后
        的层次。档位与 .aipm-anno__reply 的缩进一致(只封一档),两者算的是同一个值:
        --aipm-anno-thread-inset(一条回复的正文离卡片左沿有多远)。"""
        self.assertIn('form.setAttribute("data-depth"', self.box)
        self.assertEqual(
            _decl(_block(self.css, ".aipm-anno__replybox[data-depth] {"), "margin-left"),
            _decl(_block(self.css, ".aipm-anno__reply[data-depth] {"), "margin-left"),
        )
        self.assertIn(
            "--aipm-anno-thread-inset: calc(.5rem + 2px)",
            _block(self.css, ".aipm-anno__replies {"),
        )


class TestReplyShowsItsAuthor(unittest.TestCase):
    """回复的落款:头像 + 显示名 + @handle + 楼主角标。

    一条回复上只挂一串 login 时,读者得靠那串字母在脑子里记住谁是谁 —— 一条
    几十层的高楼里这根本记不住。头像能在一眼之内分清(这也是 B 站与 YouTube 的
    回复列表都带头像的原因);显示名与 handle 一起给,是因为显示名可以重名、
    handle 不会,只给一个就总有一头说不清。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.head = _block(cls.js, "function replyHead(anno, reply)")

    def test_a_reply_carries_an_avatar(self):
        self.assertIn("avatarOf(reply.author)", self.head)
        # 回复是缩进一层的二级内容,头像比评论卡顶栏那颗小一档
        self.assertIn('av.classList.add("is-sm")', self.head)
        self.assertIn("width: 1.15rem", _block(self.css, ".aipm-anno__cavatar.is-sm {"))

    def test_a_reply_shows_the_display_name_and_the_handle(self):
        """GitHub 的 name 是可以不填的,所以显示名要退回 handle;handle 则另给
        一份,只在两个名字不一样的时候出现(一样时说两遍是口吃)。"""
        self.assertIn("displayNameOf(reply.author)", self.head)
        self.assertIn("loginOf(reply.author)", self.head)
        self.assertIn("aipm-anno__reply-handle", self.head)
        self.assertIn("if (name !== login)", self.head)
        fn = _block(self.js, "function displayNameOf(author)")
        self.assertIn("|| loginOf(author)", fn)
        # handle 与显示名同格:名字是这一行唯一有弹性的,挤不下时两个一起省略
        self.assertIn('who.appendChild(handle)', self.head)
        self.assertIn("text-overflow: ellipsis", _block(self.css, ".aipm-anno__reply-who {"))

    def test_the_floor_owner_wears_a_badge(self):
        """「这条是楼主的」。几十层的高楼里作者本人的一句话比别人的重,而这个
        信息只有 githubId 说得清 —— 名字可以重,认不出来。"""
        self.assertIn("isFloorOwner(anno, reply)", self.head)
        self.assertIn('badge.textContent = "作者"', self.head)
        self.assertIn("is-author", self.head)
        self.assertIn("var(--md-accent-fg-color)", _block(self.css, ".aipm-anno__badge.is-author {"))
        fn = _block(self.js, "function isFloorOwner(anno, reply)")
        self.assertIn("owner.githubId === who.githubId", fn)
        # githubId 为 0 的是「本机」那份本地落款,不是任何人的账号
        self.assertIn("if (!(owner.githubId > 0)) return false;", fn)


class TestRepliesAreFoldedAndPaged(unittest.TestCase):
    """回复多了以后的读法:楼层先露几条、顶层回复翻页。

    与 B 站、YouTube 同一个办法 —— 一条热评底下挂着几十条回复时,列表不该被它
    一条占满;顶层回复积到几百条时,一面墙不如翻页好找。缩进另有一条:到顶之后
    不再往右缩,改口称「回复 @某人」(见 TestDeepRepliesGoFlat)。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.box = _block(cls.js, "function repliesBox(anno, opts)")

    def test_the_state_outlives_a_single_render(self):
        """面板每敲一个字就整个重建一遍 —— 展开态要是记在节点上,刚展开的那几条
        会当场收回去。所以它存在模块级的 replyView 里,按批注 id 分。"""
        self.assertIn("var replyView = {};", self.js)
        fn = _block(self.js, "function replyViewOf(annoId)")
        self.assertIn("replyView[annoId]", fn)
        self.assertIn("var view = replyViewOf(anno.id);", self.box)

    def test_every_level_folds_on_its_own(self):
        """折叠逐层独立:每个节点只管自己那几条**直接**子回复。一个楼层底下挂了
        几十条、其中某一条底下又挂了几十条,两处各收各的 —— 一刀切在楼层上的话,
        这两种「很多」只能一起收,想看其中一个就得把整层铺开。"""
        box = self.box
        self.assertIn("var REPLY_PREVIEW = 3;", self.js)
        self.assertIn("var limit = limitOf(r, kids, openSet, closedSet);", box)
        fn = _block(self.js, "function limitOf(node, kids, openSet, closedSet)")
        self.assertIn("if (closedSet[node.id] === true) return 0;", fn)
        self.assertIn("if (openSet[node.id] === true) return kids.length;", fn)
        self.assertIn("return Math.min(REPLY_PREVIEW, kids.length);", fn)
        # 开合态按**节点 id** 记,不按楼层 —— 楼层也只是个节点
        self.assertIn("openSet[r.id] === true", box)
        self.assertIn('view.open[node.id] = how === "open";', box)
        self.assertIn('view.closed[node.id] = how === "closed";', box)
        # 三个方向各有自己的说法:收着的说「还藏了几条」、预览的说「还剩几条」、
        # 全铺的说「收回去」
        self.assertIn('label = "展开 " + kids.length + " 条回复";', box)
        self.assertIn('label = "展开剩余 " + rest + " 条回复";', box)
        self.assertIn('label = "收起回复";', box)
        # 「收起」只挂缩进最深那一档(原始批注/评论 → 回复):它的三条预览是有用的,
        # 不该再多一颗按钮;更深的不挂 —— 理由见 TestChainOfRepliesGetsOneFold
        self.assertIn("var sweepable = depth === MAX_DEPTH && kids.length > 0;", box)
        # 每颗开合缩进到它将要展开的那一层**的实际**档位(封顶之后),否则一屏上
        # 几颗分不清谁管谁,深过封顶的那几颗还会飘到它露出的那几条右边
        self.assertIn("Math.min(depth + 1, MAX_DEPTH),", box)
        # 档位与回复一致:两条规则算的是同一个值(见 .aipm-anno__reply[data-depth])
        self.assertEqual(
            _decl(_block(self.css, ".aipm-anno__reply-more[data-depth] {"), "margin-left"),
            _decl(_block(self.css, ".aipm-anno__reply[data-depth] {"), "margin-left"),
        )

    def test_a_cut_level_keeps_quiet_about_how_many_are_left(self):
        """被楼层总额截断的那一层**不挂**开合:那一刻「还剩几条」是总额说了算,
        挂在这儿会报一个只数了本层的数,点下去也补不齐(补得齐的那颗在楼层末尾)。"""
        box = self.box
        self.assertIn("var got = paintReply(kids[i], depth + 1, budget);", box)
        self.assertIn("if (got === 0) break;", box)
        self.assertIn("if (painted >= limit) {", box)

    def test_a_floor_stops_at_a_row_cap(self):
        """逐层折叠治的是「某一层特别宽」,治不了「每一层都不少」—— 每层露 3 条,
        四层下去就是 1 + 3 + 9 + 27,再深一层又翻三倍。楼层那道总行数上限兜这个底。"""
        box = self.box
        self.assertIn("var REPLY_ROWS_MAX = 20;", self.js)
        self.assertIn("var cap = view.rows[floor.id] || REPLY_ROWS_MAX;", box)
        self.assertIn("paintReply(floor, 0, { left: cap })", box)
        # 一行都铺不出来就回头:行数在入口扣,报出来的数才与实际铺的对得上
        self.assertIn("if (budget.left <= 0) return 0;", box)
        self.assertIn("budget.left--;", box)
        self.assertIn("plannedRows(childrenOf, openSet, closedSet, floor) - paintedRows", box)
        self.assertIn('"本层还有 " + cut + " 条回复"', box)
        self.assertIn("view.rows[floor.id] = cap + REPLY_ROWS_MAX;", box)
        # 「本该铺几行」按当前开合态算,不看上限 —— 两个数一减才是被截掉的
        fn = _block(self.js, "function limitOf(node, kids, openSet, closedSet)")
        self.assertIn("openSet[node.id] === true", fn)
        self.assertIn("closedSet[node.id] === true", fn)

    def test_top_level_replies_are_paged(self):
        self.assertIn("var REPLY_PAGE = 20;", self.js)
        self.assertIn("floors.slice(0, page * REPLY_PAGE)", self.box)
        self.assertIn('"展开更多回复(" + restFloors + " 条)"', self.box)
        self.assertIn("view.page = page + 1;", self.box)
        self.assertIn("var restFloors = floors.length - shownFloors.length;", self.box)

    def test_the_reply_being_answered_is_forced_into_view(self):
        """正在回复的那一条必须看得见。逐层折叠之后,**沿途每一层**都得放开 ——
        只放开楼层不够,中间任何一层收着,它还是画不出来。"""
        box = self.box
        self.assertIn(
            "var editorChain = replyingHere && replyParent "
            "? ancestorChain(byId, byId[replyParent]) : [];",
            box,
        )
        self.assertIn("editorChain.forEach(function (id) {", box)
        self.assertIn("openSet[id] = true;", box)
        self.assertIn("page = Math.max(page, Math.floor(i / REPLY_PAGE) + 1);", box)
        # 强行放出来只对这一次渲染有效,不写回 view
        self.assertNotIn("view.open[id] = true", box)

    def test_a_fresh_reply_opens_its_way_back_into_view(self):
        """自己刚发的那条恒挂在父级的**最后**,而父级那一层要是正收着(只露前几
        条),它正好落在折叠外面 —— 所以发之前要沿途放开,不然发完就像没发出去。"""
        fn = _block(self.js, "function openReplyTarget(anno, parentId)")
        self.assertIn("ancestorChain(byId, byId[parentId]).forEach(function (id) {", fn)
        self.assertIn("view.open[id] = true;", fn)
        # 回整条批注时新回复是一条新的顶层楼层,落在最后一页 —— 翻到那一页
        self.assertIn("view.page = Math.max(view.page, Math.floor(floors / REPLY_PAGE) + 1);", fn)
        post = _block(self.js, "function postReply(anno, body, parentId)")
        self.assertIn("openReplyTarget(anno, parentId);", post)

    def test_the_count_only_shows_when_there_is_something_to_manage(self):
        self.assertIn("if (replies.length > REPLY_PREVIEW) {", self.box)
        self.assertIn('"共 " + replies.length + " 条回复"', self.box)
        self.assertIn("color: var(--md-default-fg-color--light)", _block(self.css, ".aipm-anno__replies-count {"))

    def test_the_expanders_share_one_shape(self):
        """三处开合(层里那颗、整段末尾那颗、批注卡上那颗)是同一件事(把没铺出来的
        铺出来),所以同一套形:文字链的样子、按钮的行为(能聚焦、能回车),但不带
        按钮的框。"""
        self.assertIn("moreButton(", self.box)
        self.assertIn('"aipm-anno__reply-more"', self.box)
        self.assertIn('"aipm-anno__replies-more"', self.box)
        self.assertIn('"aipm-anno__replies-fold"', self.box)
        rule = _block(
            self.css,
            ".aipm-anno__reply-more,\n.aipm-anno__replies-more,\n.aipm-anno__replies-fold {",
        )
        self.assertIn("border: 0", rule)
        self.assertIn("background: transparent", rule)
        self.assertIn(".aipm-anno__reply-more:focus-visible,", self.css)


class TestReplyToReplyHasItsOwnFold(unittest.TestCase):
    """「回复回复」那一层也有自己的展开与折叠。

    第一层(原始批注/评论 → 回复)的默认是「先露三条」,那是给人扫的。再往里那一层
    (回复 → 回复回复)本来常常只有一两条,「先露三条」在那儿等于没有折叠 —— 想收
    根本收不掉。所以那一层走另一套:只要它有回复回复,就给一颗开合。

    注意这说的是缩进最深的那一档(MAX_DEPTH),不是「除楼层外的每一层」—— 后者会给
    一条单传链的每一节都挂一颗,摞成一串一模一样的「收起回复」,见
    TestChainOfRepliesGetsOneFold。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.box = _block(cls.js, "function repliesBox(anno, opts)")

    def test_the_second_level_always_gets_a_fold(self):
        self.assertIn("var sweepable = depth === MAX_DEPTH && kids.length > 0;", self.box)
        self.assertIn('label = "收起回复";', self.box)
        self.assertIn("var closed = closedSet[r.id] === true;", self.box)
        self.assertIn("limitOf(r, kids, openSet, closedSet)", self.box)

    def test_the_first_level_keeps_its_preview(self):
        """第一层不挂那颗「收起」—— 那儿的「先露三条」是有用的预览,不该再多一颗
        按钮;多到超过三条时本来就有「展开剩余 N 条 / 收起回复」那一套。"""
        fn = _block(self.js, "function limitOf(node, kids, openSet, closedSet)")
        self.assertIn("return Math.min(REPLY_PREVIEW, kids.length);", fn)
        self.assertIn("var sweepable = depth === MAX_DEPTH && kids.length > 0;", self.box)
        # depth 的那道闸只卡「收起」那一支:「还剩几条」到处都要挂得出来,否则深层
        # 铺不下的回复就永远露不出来了
        self.assertIn('label = "展开剩余 " + rest + " 条回复";', self.box)
        sweep = self.box.index("} else if (sweepable) {")
        rest = self.box.index('label = "展开剩余 " + rest + " 条回复";')
        self.assertLess(rest, sweep)

    def test_folding_is_a_three_way_state(self):
        """一条不露 / 先露三条 / 全铺 —— 三个方向各有各的说法,不能混成一个开关。"""
        fn = _block(self.js, "function limitOf(node, kids, openSet, closedSet)")
        self.assertIn("if (closedSet[node.id] === true) return 0;", fn)
        self.assertIn("if (openSet[node.id] === true) return kids.length;", fn)
        self.assertIn('label = "展开 " + kids.length + " 条回复";', self.box)
        self.assertIn('label = "展开剩余 " + rest + " 条回复";', self.box)
        self.assertIn('view.closed[node.id] = how === "closed";', self.box)
        # 「本该铺几行」也要认收起来的那一态,否则楼层那道总额会报错数
        plan = _block(self.js, "function plannedRows(childrenOf, openSet, closedSet, node)")
        self.assertIn("limitOf(node, kids, openSet, closedSet)", plan)


class TestChainOfRepliesGetsOneFold(unittest.TestCase):
    """一条「单传链」只挂一颗「收起回复」,不每节挂一颗。

    每层的开合都挂在**自己那一行后面**,而缩进到 MAX_DEPTH 就封顶 —— 再深的回复
    全铺在同一个档位上。于是「凡是底下有回复就挂一颗」这条规则,在一条 A→B→C→D
    的链上会挂出三颗一模一样的「收起回复」,而且它们挨在一起、又各自收着不同的
    深度,点哪颗全靠猜(实际截图里就是三颗摞成一串)。

    改法不是去重,是把挂的位置钉死在**缩进最深那一档**:一个槽位里那一层回复只能
    收自己下面那串「回复回复」,一档一颗。相邻两颗之间必定隔着行,不可能再连成一片;
    而「回复回复的展开与折叠」(这一档能收掉它底下的一切)照旧成立。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.box = _block(cls.js, "function repliesBox(anno, opts)")

    def test_only_the_deepest_indent_level_owns_the_sweep(self):
        self.assertIn("var MAX_DEPTH = 1;", self.js)
        self.assertIn("var sweepable = depth === MAX_DEPTH && kids.length > 0;", self.box)
        # 深过封顶的那几层缩进一样、铺的位置也挨着,谁都不许再挂
        self.assertNotIn("depth >= 1 && kids.length > 0", self.box)

    def test_the_sweep_is_anchored_to_the_level_it_hides(self):
        """那颗按钮缩进到它将要开合的那一档:它收的是自己底下那串,不是整个槽位。"""
        self.assertIn("var kids = childrenOf[r.id] || [];", self.box)
        self.assertIn("var limit = limitOf(r, kids, openSet, closedSet);", self.box)
        self.assertIn("Math.min(depth + 1, MAX_DEPTH),", self.box)
        # 收的是**这一条之下**的树,所以节点还是自己 —— 状态记在 r.id 上
        self.assertIn('view.open[node.id] = how === "open";', self.box)

    def test_a_chain_still_has_somewhere_to_collapse(self):
        """链上那一颗必须真的有:楼层(第 0 层)不挂「收起」,所以链根(第 1 层)
        得自己顶上 —— 否则整条链一颗开合都没有,只能整张卡一起收。"""
        self.assertIn("var sweepable = depth === MAX_DEPTH && kids.length > 0;", self.box)
        # 第 0 层只在超过预览条数时才挂,且走的是另一支(「展开剩余」),不是 sweep
        self.assertIn('label = "展开剩余 " + rest + " 条回复";', self.box)


class TestCommentPanelFoldsAllOriginalComments(unittest.TestCase):
    """评论面板一次收放所有原始评论的回复区。

    原始评论一多,一条条点开太慢:想通读讨论要全展开,想只看大家说了什么要全收起来。
    它抄的是单张卡同一个状态字段(view.folded),所以不是另一套开关 —— 全收之后再
    单独点开某一条,以那一次为准。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.row = _block(cls.js, "function sortRow()")
        cls.fn = _block(cls.js, "function foldAllComments(folded)")

    def test_the_two_controls_live_in_the_comment_control_row(self):
        self.assertIn('"全部展开"', self.row)
        self.assertIn('"全部折叠"', self.row)
        self.assertIn("foldAllComments(", self.row)
        # 排序是单选组,这两颗不是它的选项 —— 摆在 radiogroup 外面
        self.assertIn('group.setAttribute("role", "radiogroup")', self.row)
        self.assertLess(self.row.index('group.setAttribute("role", "radiogroup")'),
                        self.row.index('"全部展开"'))

    def test_it_covers_every_original_comment_not_the_annotations(self):
        """只认全页评论(原始评论)。批注卡不归评论面板这一行管 —— 它们有自己的
        默认收起,被这两颗顺手改了才是怪事。"""
        self.assertIn("publicList.concat(privateList).concat(localList)", self.fn)
        self.assertIn("if (!isPageComment(anno)) return;", self.fn)
        self.assertIn("replyViewOf(anno.id).folded = folded;", self.fn)

    def test_it_reuses_the_per_card_state(self):
        """与单张卡共用一个字段:全收之后再点开某一条,那条就该是开的。"""
        self.assertIn("card.folded === undefined", _block(self.js, "function repliesBox(anno, opts)"))
        self.assertIn("replyViewOf(anno.id).folded = folded;", self.fn)


class TestAnnotationCardFoldsItsRepliesByDefault(unittest.TestCase):
    """批注卡的回复区默认折起来,评论卡不折。

    批注面板是拿来扫读正文里那些标记的:一屏十几条批注,每条都摊开几十行回复就
    没法扫了。评论区反过来 —— 去评论面板就是来看对话的,再折一道只是多一次点击。
    所以差异落在**两张卡各自的传参**上,不是落在 repliesBox 里判面板模式:实现
    仍然是同一份,只是默认态不同。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.box = _block(cls.js, "function repliesBox(anno, opts)")

    def test_the_annotation_card_asks_for_the_folded_default(self):
        item = _block(self.js, "function renderItem(anno, isOrphan)")
        comment = _block(self.js, "function renderCommentItem(anno)")
        self.assertIn("repliesBox(anno, { cardFold: true, folded: true })", item)
        # 评论卡也传 cardFold(「全部折叠」要靠它),但**不传** folded —— 默认展开
        self.assertIn("repliesBox(anno, { cardFold: true })", comment)
        self.assertNotIn("folded: true", comment)
        # 实现仍然只有一份
        self.assertEqual(self.js.count("function repliesBox("), 1)

    def test_folded_shows_one_particle_carrying_the_count(self):
        box = self.box
        self.assertIn("var cardFold = !!(opts && opts.cardFold) && replies.length > 0;", box)
        self.assertIn(
            "card.folded === undefined ? !!(opts && opts.folded) : card.folded === true", box
        )
        self.assertIn('"展开 " + replies.length + " 条回复"', box)
        self.assertIn("aipm-anno__replies-fold", box)
        # 折起来的那一版就是全部:下面那整套(树、折叠、翻页)一行都不铺
        fold_at = box.index("return wrap;")
        self.assertLess(fold_at, box.index("var childrenOf = {};"))
        # 一条回复都没有时连这颗都不挂 —— 「展开 0 条回复」是废话
        self.assertIn("replies.length > 0;", box)

    def test_unfolding_leaves_a_way_back(self):
        """「默认收起」不能是一次性开关:点开一次就从此摊着,等于没有默认。"""
        box = self.box
        self.assertIn('"收起全部回复"', box)
        self.assertIn("card.folded = true;", box)

    def test_the_folded_state_outlives_a_single_render(self):
        """与逐层折叠同一个道理:面板每敲一个字就整个重建一遍,状态记在节点上会
        当场弹回去。"""
        self.assertIn("v = { page: 1, open: {}, closed: {}, rows: {} };", self.js)
        # 三态:没点过就是 undefined,按各张卡自己的默认来
        self.assertIn("card.folded === undefined", self.box)
        self.assertIn("card.folded = false;", self.box)

    def test_an_open_editor_is_never_folded_away(self):
        """在折起来的批注卡上点「回复」,等于说要看这块回复区 —— 输入框得有落脚
        的地方,不然它落在一块没有任何出处的空白里。"""
        self.assertIn("if (cardFolded && !replyingHere) {", self.box)
        start = _block(self.js, "function startReply(anno, reply)")
        self.assertIn("replyViewOf(anno.id).folded = false;", start)
        # 发完那次重渲染也不能把它折回去
        post = _block(self.js, "function openReplyTarget(anno, parentId)")
        self.assertIn("view.folded = false;", post)

    def test_the_particle_looks_like_the_other_expanders(self):
        rule = _block(
            self.css,
            ".aipm-anno__reply-more,\n.aipm-anno__replies-more,\n.aipm-anno__replies-fold {",
        )
        self.assertIn("border: 0", rule)
        self.assertIn("background: transparent", rule)
        self.assertIn(
            ".aipm-anno__reply-more:focus-visible,\n"
            ".aipm-anno__replies-more:focus-visible,\n"
            ".aipm-anno__replies-fold:focus-visible {",
            self.css,
        )
        # 它是整块回复区的开关,不往里缩进
        self.assertNotIn(".aipm-anno__replies-fold[data-depth]", self.css)


class TestDeepRepliesGoFlat(unittest.TestCase):
    """缩进只封一档:原始评论 → 回复 → 回复回复,再往里的那条改口称「回复 @某人」。

    400px 宽的面板里,第二档缩进之后正文就只剩一条竖线 —— 层次改由文字说清,
    而不是由左边的空白说清。这正是 B 站与 YouTube 的做法(楼中楼之间的回复一律
    平铺,靠 @ 指认对象)。那颗 @ 还可点:点一下跳到被回复的那一条,高楼里
    「他到底在回谁」因此不用靠猜。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")
        cls.box = _block(cls.js, "function repliesBox(anno, opts)")
        cls.body = _block(cls.js, "function replyBody(anno, reply, parent)")

    def test_past_the_cap_the_depth_is_spelled_out_in_words(self):
        self.assertIn("depth > MAX_DEPTH && r.parentId", self.box)
        self.assertIn("replyBody(anno, r, over || null)", self.box)
        self.assertIn('"回复 @" + displayNameOf(parent.author)', self.body)
        # 名字与正文之间要有个分界 —— 显示名可以很长,没有它两句会连成一串
        self.assertIn('createTextNode("：")', self.body)
        # 父级悬空时取不到,那就不说 —— 它按顶层渲染
        self.assertIn("byId[r.parentId] : null", self.box)
        # 缩进只封一档
        self.assertIn("var MAX_DEPTH = 1;", self.box)
        self.assertIn("String(Math.min(depth, MAX_DEPTH))", self.box)

    def test_the_at_mark_jumps_to_the_reply_it_answers(self):
        self.assertIn("jumpToReply(anno, reply.parentId)", self.body)
        self.assertIn("aipm-anno__reply-at", self.body)
        fn = _block(self.js, "function jumpToReply(anno, replyId)")
        # 先展开、先翻页,再滚 —— 不在 DOM 里的节点滚不动
        self.assertIn("view.open[floor] = true;", fn)
        self.assertIn("view.page = Math.max(", fn)
        self.assertIn("pendingFocus = replyId;", fn)
        self.assertIn("render();", fn)

    def test_the_scroll_waits_until_the_node_is_in_the_document(self):
        """repliesBox 建出来的节点在 append 到列表之前不属于文档,那时候滚不动 ——
        所以跳转落在 render 的末尾。」"""
        render = _block(self.js, "function render()")
        self.assertIn("if (pendingFocus !== null) {", render)
        self.assertIn("pendingFocus = null;", render)
        self.assertIn("scrollIntoView({ block: \"center\", behavior: \"smooth\" })", render)
        self.assertIn('classList.add("is-flash")', render)
        # 闪一下的样子与被点的高亮同款
        self.assertIn(
            "background: var(--md-default-fg-color--lightest)",
            _block(self.css, ".aipm-anno__reply.is-flash {"),
        )

    def test_the_at_mark_looks_like_a_link_but_is_a_button(self):
        """它不导航到任何地址,只是个跳转动作 —— 用 <button> 才能被键盘停住。
        面板里「这次点击算不算点在正文上」靠 e.target.closest("button") 判断,
        它因此也不会顺手清掉正文的选区。"""
        rule = _block(self.css, ".aipm-anno__reply-at {")
        self.assertIn("color: var(--md-accent-fg-color)", rule)
        self.assertIn("background: transparent", rule)
        self.assertIn('at.type = "button"', self.body)


class TestTheThreadBarBelongsToEachReply(unittest.TestCase):
    """左边那条灰条挂在**每一条**回复上,不是长在整段回复上。

    以前它是 .aipm-anno__replies 的 border-left:从「共 N 条回复」一路拉到最底下,
    一根不断的线,一层楼里几条回复看着像一整块。挂到条目上之后,条与条之间随条目
    间距自然断开,一层里有几条一眼数得清 —— 缩进一档的那几条本来就是这么长的,
    现在两层一个样。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def test_the_box_itself_brings_no_bar(self):
        rule = _block(self.css, ".aipm-anno__replies {")
        self.assertEqual(_decl(rule, "border-left"), "")
        self.assertEqual(_decl(rule, "padding-left"), "")

    def test_every_reply_carries_it(self):
        rule = _block(self.css, ".aipm-anno__reply {")
        self.assertEqual(
            _decl(rule, "border-left"), "2px solid var(--md-default-fg-color--lightest)"
        )
        self.assertEqual(_decl(rule, "padding-left"), ".5rem")
        # 缩进一档的那条不再自己写一遍灰条 —— 灰条与呼吸在上面那条里,它只补横移
        deep = _block(self.css, ".aipm-anno__reply[data-depth] {")
        self.assertEqual(_decl(deep, "border-left"), "")
        self.assertEqual(_decl(deep, "padding-left"), "")
        self.assertEqual(
            _decl(deep, "margin-left"), "calc(var(--aipm-anno-thread-inset) + .7rem)"
        )

    def test_the_gap_between_bars_is_the_item_spacing(self):
        """条与条之间的间隔不是另画的一笔 —— 就是条目自己那 .3rem 的上下边距。"""
        self.assertEqual(_decl(_block(self.css, ".aipm-anno__reply {"), "margin"), ".3rem 0")

    def test_the_rows_without_a_bar_line_up_with_the_ones_that_have_it(self):
        """回复区里那几行不是回复的东西(「共 N 条回复」、「展开更多回复」、回复框)
        没有灰条可挂,靠同一个值补齐灰条那份宽度 —— 否则它们会比回复正文更靠左,
        整段回复的左沿就长短不一了。"""
        self.assertEqual(
            _decl(_block(self.css, ".aipm-anno__replies {"), "--aipm-anno-thread-inset"),
            "calc(.5rem + 2px)",
        )
        rule = _block(
            self.css,
            ".aipm-anno__replies-count,\n.aipm-anno__replies-more,\n.aipm-anno__replybox {",
        )
        self.assertEqual(_decl(rule, "margin-left"), "var(--aipm-anno-thread-inset)")
        # 这条挂在回复区那一节的末尾:三条规则各自的 margin 简写都在它前面,
        # 否则会被那些简写里的 margin-left: 0 盖掉
        self.assertLess(self.css.index(rule), self.css.index(".aipm-anno__input--reply {"))


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
        head = _block(self.js, "function replyHead(anno, reply)")
        self.assertIn("aipm-anno__reply-tools", head)
        self.assertIn("ICON.reply", head)
        self.assertIn("ICON.trash", head)
        for gone in ('"回复"', '"删除"', 'replyTool("回复"', 'replyTool("删除"'):
            self.assertNotIn(gone, head)

    def test_every_reply_gets_a_head_line_of_its_own(self):
        """回复排成「头一行 + 正文」。操作按钮挂在这条回复自己的头一行右端,每条
        回复的按钮因此落在同一个横坐标上 —— 连排时它们跟在正文尾巴后面,一条一个
        位置,扫下去是散的。头一行与正文各自成块,回复列表因此读起来是「一个人
        一句话」,而不是一长串文字。"""
        box = _block(self.js, "function repliesBox(anno, opts)")
        head = _block(self.js, "function replyHead(anno, reply)")
        body = _block(self.js, "function replyBody(anno, reply, parent)")
        self.assertIn("replyHead(anno, r)", box)
        self.assertIn("replyBody(anno, r,", box)
        self.assertIn("aipm-anno__reply-head", head)
        self.assertIn("relTime(reply.createdAt)", head)
        self.assertIn("aipm-anno__reply-body", body)
        self.assertIn("display: flex", _block(self.css, ".aipm-anno__reply-head {"))
        self.assertEqual(self.js.count("function replyHead("), 1)
        self.assertEqual(self.js.count("function replyBody("), 1)

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
        head = _block(self.js, "function replyHead(anno, reply)")
        self.assertIn("armDelete(del,", head)
        self.assertIn("removeReply(anno, reply)", head)

    # ---- 回复按钮的位置 ----

    def test_the_reply_button_stands_with_the_other_card_tools(self):
        """回勾箭头从卡片底部那行搬到了右上角,跟铅笔垃圾桶站在一起 —— 与每条回复
        右端那颗同一个位置逻辑:谁的回话按钮就贴在谁那一行的右端。底部那行不再有
        图标按钮,它只剩点赞与「上传 / 重新锚定」那几条文字链。"""
        acts = _block(self.js, "function itemActions(anno, isOrphan)")
        self.assertNotIn("ICON.reply", acts)
        head = _block(self.js, "function cardReplyButton(anno)")
        self.assertIn("iconButton(ICON.reply", head)
        self.assertNotIn('actionButton("回复"', head)
        for card in ("function renderItem(anno, isOrphan)", "function renderCommentItem(anno)"):
            block = _block(self.js, card)
            self.assertIn("cardReplyButton(anno)", block)
            self.assertIn("cardTools(anno)", block)
            # 回勾箭头在编辑 / 删除之前:垃圾桶在最右,与每条回复那一行一致
            self.assertLess(
                block.index("cardReplyButton(anno)"), block.index("cardTools(anno)")
            )
        # 搬走之后那条「底部这行给正文色」的规则没有对象了,别留下
        self.assertNotIn(".aipm-anno__item-actions .aipm-anno__ibtn", self.css)

    def test_every_card_keeps_a_way_to_reply(self):
        """回不成时(未登录看别人的批注)这颗按钮还在,只是名字换成「登录后回复」,
        点下去先去登录 —— 提示没丢,丢的只是那一行字。它与可编辑是两回事:未登录
        时铅笔垃圾桶都不在,这颗还在,所以没有跟 cardTools 合成一颗。"""
        head = _block(self.js, "function cardReplyButton(anno)")
        self.assertIn('"登录后回复"', head)
        self.assertIn("auth.loginForDraft(draftForLogin())", head)
        self.assertNotIn("canEdit(", head)
        # 底部那行会整行消失(一条操作都没有),回复按钮不能跟着它一起没
        self.assertIn("if (acts.childNodes.length > 0)", self.js)

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
        --aipm-anno-line:发丝线是给「分隔」用的,深色下也只到 20% 白(见 extra.css
        3. 节),拿去勾控件轮廓仍然太轻;--lighter 两套配色都是 40%,静息态看得清。
        退回发丝线 = 暗色下这颗按钮又变回一段纯文字。

        (2026-09-21 之前,--aipm-anno-line 别名写在 :root 上,深色下实际取到的是
        亮色那份 rgba(0,0,0,.12),黑底黑线整条消失 —— 那是求值域写错,已改到
        body。但发丝线即便修好也不适合当控件轮廓,所以这条判据不变。)
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


class TestUiRoundSeven(unittest.TestCase):
    """第七轮:面板里的引文要长得跟正文里那一笔一样,点它还要能回到正文。"""

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    # ---- 引文 = 正文里那一笔的副本 ----

    def test_the_quote_is_not_a_grey_bar_any_more(self):
        """引文从前是一条灰杠加一段灰字,跟正文里画的那一笔毫无关系。现在它的
        底色与下划线由卡片上的 data-style / data-color 决定 —— 面板上看到的引文,
        就该跟文章里那段被画上的话长得一样。"""
        rule = _block(self.css, ".aipm-anno__item-quote {")
        self.assertNotIn("border-left", rule)
        self.assertNotIn("--md-default-fg-color--light", rule)
        self.assertIn("cursor: pointer", rule)

    def test_the_paint_lands_on_an_inline_layer(self):
        """底色与下划线必须落在**行内**那一层上:落在块级的 <blockquote> 上会拉成
        一条通栏色带(只划线那种画法最露馅:整行底下一条直线,连字与字之间的空档也
        划过去),而正文里那一笔是贴着字的。"""
        item = _block(self.js, "function renderItem(")
        self.assertIn("q.appendChild(quoteInk(", item)
        ink = _block(self.js, "function quoteInk(")
        self.assertIn("aipm-anno__quote-ink", ink)
        self.assertIn('ink.setAttribute("data-style", style)', ink)
        base = _block(self.css, ".aipm-anno__quote-ink {")
        self.assertIn("background: transparent", base)
        self.assertIn("border-bottom: 2px solid transparent", base)
        for style in ("underline", "highlight", "both"):
            self.assertIn(f'.aipm-anno__quote-ink[data-style="{style}"]', self.css)

    def test_the_colour_table_is_shared_not_copied(self):
        """色值表只写一份:这条批注是什么色本来就记在卡片的 data-color 上,引文那层
        继承就拿到了。再抄五遍的话,日后加第六个色必然只改一处。"""
        for color in ("yellow", "green", "blue", "pink", "purple"):
            self.assertIn(f'.aipm-anno__item[data-color="{color}"]', self.css)
            self.assertIn(f'.aipm-anno__draft[data-color="{color}"]', self.css)
        self.assertNotIn(".aipm-anno__quote-ink[data-color=", self.css)

    def test_the_draft_quote_matches_the_saved_one(self):
        """「写的时候看到的排版,就是发出去之后的排版」—— 草稿卡上的引文走同一层
        quoteInk,不再自己留一条左边线。"""
        editor = _block(self.js, "function buildEditor(")
        self.assertIn("quoteInk(activeStyle", editor)
        rule = _block(self.css, ".aipm-anno__quote {")
        self.assertNotIn("border-left-color: inherit", rule)

    # ---- 点引文跳回正文 ----

    def test_the_quote_is_a_button_that_is_not_a_button(self):
        """它是「跳回正文」的入口,就得按按钮那一套写(role + tabindex + 名字);
        但不能真做成 <button> —— 引文是可以被选中、复制走的一段话,而面板对按钮的
        mousedown 一律 preventDefault,那样就选不动了。"""
        item = _block(self.js, "function renderItem(")
        self.assertIn('q.setAttribute("role", "button")', item)
        self.assertIn('q.setAttribute("tabindex", "0")', item)
        self.assertIn("q.setAttribute(\"aria-label\",", item)

    def test_enter_and_space_jump_too(self):
        """role="button" 就得配键盘:回车与空格都要算数,否则那颗按钮只有鼠标能用。"""
        i = self.js.index("键盘走同一条路")
        block = self.js[i : self.js.index("反方向", i)]
        self.assertIn('e.key !== "Enter"', block)
        self.assertIn('e.key !== " "', block)
        self.assertIn("jumpFromQuote(q)", block)

    def test_a_drag_inside_the_quote_does_not_jump(self):
        """引文是可以被选中、复制走的一段话。拖选完松手会送来一次 click,那不是
        「回去」的意思。两道闸门拦它 —— 只看选区拦不住:手滑到那行文字的末尾之外
        松手时浏览器会把选区收回去(实测),所以还得看指针挪没挪窝。"""
        i = self.js.index("var quotePress = null;")
        block = self.js[i : self.js.index("键盘走同一条路", i)]
        self.assertIn("quotePress", block)
        self.assertIn("Math.abs(e.clientX - quotePress.x) > 4", block)
        self.assertIn("q.contains(sel.anchorNode)", block)

    def test_the_jump_prefers_the_passages_own_mark(self):
        """先找这条批注自己那一笔 <mark>;找不到才退到文字所在的那个块 —— 退的那一
        档对应「锚到了、但那段文字已被别人的高亮占住」(同一句话被两个人划线),
        文字确实在页面上,只是那一笔不在它名下。"""
        fn = _block(self.js, "function passageAnchor(")
        self.assertIn("mark.aipm-anno-mark[data-anno-id=", fn)
        self.assertIn("resolved[anno.id]", fn)
        self.assertIn("closest(BLOCK_SELECTOR)", fn)

    def test_a_passage_with_no_position_says_so(self):
        """两样都没有(真没定位到)时给一句回执 —— 点了没反应比说一句更糟。"""
        fn = _block(self.js, "function jumpToPassage(")
        self.assertIn("flash(", fn)
        self.assertIn("return", fn)

    def test_the_sheet_gets_out_of_the_way_first(self):
        """手机上面板是一张抽屉:半开或近全屏时正文正压在它底下,直接滚过去会
        「跳了等于没跳」。先把抽屉收回头一档(peek),落点才在面板外面。"""
        fn = _block(self.js, "function jumpToPassage(")
        self.assertIn('mode === "sheet"', fn)
        self.assertIn('snap !== "peek"', fn)
        self.assertIn('setSnap("peek")', fn)

    def test_the_landing_is_ringed_in_the_annotations_own_ink(self):
        """页面是平滑滚过去的,光看落点认不出「到了」的是哪一段 —— 那一段先亮一圈。
        光圈用这条批注自己的墨色,才认得出亮的是刚点的那条;退到整个块上时那块身上
        没有墨色,才退回主题强调色。"""
        fn = _block(self.js, "function jumpToPassage(")
        self.assertIn("aipm-anno-flash", fn)
        rule = _block(self.css, ".aipm-anno-flash {")
        self.assertIn("var(--aipm-mark-ink, var(--md-accent-fg-color))", rule)
        self.assertIn("outline", rule)

class TestTheFloatingToolbarNeverStrands(unittest.TestCase):
    """第八轮:划词悬浮窗只能跟「当前这一次划词」一样长寿。

    它是 position: fixed 的,锚点(被划的那段话)却是正文里会动的东西 —— 页面一滚、
    面板一开、窗口一缩放,那个坐标就跟锚点对不上了。之前没有任何一条路会收它,于是
    它一直挂在屏幕上、压在各组件上面(用户报的「它会一直悬浮在那里」)。这一组把
    「什么时候该收」和「收的时候动了什么」都钉住。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")

    # ---- 该收的三个出口 ----

    def test_opening_the_panel_takes_it_with_it(self):
        """点页头那颗入口按钮并不保证把正文选区收掉(实测 headless Chromium 下就不
        收),所以不能指望 selectionchange 顺手清掉 —— 开面板那一步得自己收。"""
        fn = _block(self.js, "function openPanel()")
        self.assertIn("hideToolbar()", fn)
        # 收起那一侧本来就有,别在重构里丢掉
        self.assertIn("hideToolbar()", _block(self.js, "function closePanel()"))

    def test_a_page_scroll_takes_it_too(self):
        """scroll 不冒泡 —— 挂在 window 的捕获相上才收得到所有滚动容器。"""
        block = self.js[self.js.index('window.addEventListener(\n    "scroll"') :]
        block = block[: block.index("onViewportChange")] if "onViewportChange" in block else block
        self.assertIn("hideToolbar()", block)
        self.assertIn("capture: true", block)
        self.assertIn("passive: true", block)

    def test_a_viewport_change_takes_it_too(self):
        """窗口缩放 / 转屏 / 停靠↔抽屉换形态:正文重排,坐标同样作废。"""
        fn = self.js[self.js.index("var onViewportChange = function () {") :]
        fn = fn[: fn.index("};")]
        self.assertIn("hideToolbar()", fn)
        self.assertIn("applyMode()", fn)

    # ---- 收的判据:锚点动没动 ----

    def test_only_the_scrollers_that_carry_the_anchor_count(self):
        """判据是「这个滚动容器里有没有锚点」,不是「有没有发生滚动」。侧栏、目录、
        面板自己的列表滚起来时锚点纹丝不动,收掉工具条才是错的 —— 用户手里那段话
        还在原地,画法/颜色那几颗按钮没理由消失。"""
        block = self.js[self.js.index('window.addEventListener(\n    "scroll"') :]
        self.assertIn("target.contains(anchor)", block)
        self.assertIn("pendingSelection.range.startContainer", block)

    def test_the_scroll_path_leaves_the_selection_alone(self):
        """滚滚页面收工具条,绝不能顺手把正文选区撤掉:「重新锚定」的整个流程就是
        「在正文里选好一段话,回到面板点那颗按钮」,撤了选区那条路就只剩一句
        「先在正文里选中一段话」。"""
        block = self.js[self.js.index('window.addEventListener(\n    "scroll"') :]
        block = block[: block.index("var onViewportChange")]
        self.assertNotIn("clearSelection", block)
        self.assertNotIn("removeAllRanges", block)
        # 反过来:重新锚定读的是**活着的**正文选区,不是工具条那份 pendingSelection
        self.assertIn("selectionInContent()", _block(self.js, "function reanchor("))

    # ---- 落完的那一笔:不能原地弹回来 ----

    def test_the_quick_highlight_drops_the_selection(self):
        """挑完颜色它还赖着不走:落高亮要往正文里插 <mark>,而选区就在被插的节点
        之间 —— DOM 一变,浏览器再报一次 selectionchange,handler 又把工具条摆回
        同一个位置。撤掉选区,这条回路才断;留着的话顺手再点一下还会叠出第二条。"""
        fn = _block(self.js, "function quickHighlight()")
        self.assertIn("hideToolbar()", fn)
        self.assertIn("clearSelection()", fn)
        helper = _block(self.js, "function clearSelection()")
        self.assertIn("removeAllRanges()", helper)

    def test_the_panel_reveal_takes_it_even_when_the_panel_is_already_open(self):
        """点 ✨ 时面板常常已经开着 —— 那条路会从 openPanel 的 `if (open) return`
        上早退,把「开面板就收浮窗」整个跳过去。所以这一收得写在 revealPanel 的
        最前面,早退之前。"""
        fn = _block(self.js, "function revealPanel()")
        self.assertIn("hideToolbar()", fn)
        self.assertLess(
            fn.index("hideToolbar()"), fn.index("if (open) return"),
            "hideToolbar 必须在早退之前",
        )

    def test_the_smart_highlight_does_not_leave_it_hanging_over_the_panel(self):
        """✨ 判的是整页正文,跟手上选中那一段无关,接下来还要往正文里插一整批
        <mark> —— 选区留着的话,DOM 一动又会把浮窗摆回面板前面。"""
        fn = _block(self.js, "function smartHighlight(")
        self.assertIn("revealPanel()", fn)
        self.assertIn("clearSelection()", fn)

    def test_the_floating_window_still_follows_the_selection_it_has(self):
        """收归收,该出的时候还得照出:selectionchange 那条路一点没动 —— 选区内、
        点空白、选区内 … 这套显隐仍然是它的本职。"""
        handler = self.js[self.js.index('document.addEventListener("selectionchange"') :]
        handler = handler[: handler.index("toolbar.addEventListener")]
        self.assertIn("showToolbar(range)", handler)
        self.assertIn("pendingSelection = { range: range", handler)


class TestSmartbarNotificationsCanBeDismissed(unittest.TestCase):
    """通知条自己能收(issue #88)。

    条子上的报错/进行中原本只能等下一次通知把它顶掉 —— 报错会一直挂在那儿,而
    「正在分析…」跑到一半不想等了也没有出路。右端补一颗关闭按钮。

    几条容易回退的契约:
    - 按钮是**常驻节点**,不能写进 panel.innerHTML —— 条子正文是 textContent 整段
      重写的,写进壳子里的节点第一次重画就被摘掉,留下的引用指向孤儿,挂不回来;
    - 每一次重画(纯文字 / 结果条)都得把它 appendChild 回去;
    - 收起条子 ≠ 撤销结果:建议缓存不动,再点 ✨ 原地回来;
    - 正文要可缩(min-width:0),否则长通知会把自己撑到内容宽,把按钮顶出去。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def test_the_button_is_one_persistent_node(self):
        """常驻的那一个,不是每次现造的 —— 也就不能写在 panel.innerHTML 里。"""
        shell = self.js[
            self.js.index("panel.innerHTML =") : self.js.index("document.body.appendChild(panel)")
        ]
        self.assertNotIn("aipm-anno__smart-close", shell, "按钮又写回外壳里了")
        self.assertEqual(
            self.js.count('className = "aipm-anno__smart-close"'), 1, "关闭按钮被造了不止一个"
        )
        decl = self.js[self.js.index('var smartClose = document.createElement("button")') :]
        decl = decl[: decl.index("setSmartbar")]
        self.assertIn("ICON.close", decl)
        self.assertIn('setAttribute("aria-label"', decl)

    def test_every_repaint_puts_the_button_back(self):
        """两处重画都要挂回去:textContent 一清,按钮就跟着没了。"""
        self.assertIn("appendChild(smartClose)", _block(self.js, "function setSmartbar(text, kind)"))
        self.assertIn(
            "appendChild(smartClose)", _block(self.js, "function renderSuggestions(payload")
        )

    def test_dismissing_only_hides_the_strip(self):
        """收起不等于撤销:缓存留着,再点 ✨ 原地摆回来,不重新请求、不撞冷却。"""
        handler = self.js[self.js.index("smartClose.addEventListener") :]
        handler = _strip_comments(handler[: handler.index("});")])
        self.assertIn('setSmartbar("", "")', handler)
        self.assertNotIn("suggestCache", handler)
        self.assertNotIn("localRemove", handler)

    def test_the_message_can_shrink_so_the_button_never_gets_pushed_out(self):
        """flex 行里不给 min-width:0,长通知就撑到内容宽,把关闭按钮顶到条子外面 ——
        通知越长越关不掉,正好反了。"""
        rule = _block(self.css, ".aipm-anno__smart-text {")
        self.assertEqual(_decl(rule, "flex"), "1 1 auto")
        self.assertEqual(_decl(rule, "min-width"), "0")
        # 报错文案是让人读完的,换行而不是省略号收尾
        self.assertEqual(_decl(rule, "text-overflow"), "")

    def test_the_button_is_muted_until_hovered(self):
        """它站在条子上而不是页头,颜色跟着 data-kind 走(warn 粉 / busy 灰),
        压的只是不透明度。"""
        rule = _block(self.css, ".aipm-anno__smart-close {")
        self.assertEqual(_decl(rule, "flex"), "none")
        self.assertEqual(_decl(rule, "color"), "inherit")
        self.assertLess(float(_decl(rule, "opacity")), 1)
        self.assertIn(".aipm-anno__smart-close:hover", self.css)
        self.assertIn(".aipm-anno__smart-close:focus-visible", self.css)


class TestHeadIconTellsTheTwoListsApart(unittest.TestCase):
    """面板头上那颗图标得说明眼下是哪一份列表(AIPM-9)。

    批注锚在正文某一段上,评论对整页说话 —— 两份列表共用同一个面板,头图标跟着
    当前那一份走:批注是笔,评论是对话气泡。
    """

    @classmethod
    def setUpClass(cls):
        cls.js = ANNO_JS.read_text(encoding="utf-8")
        cls.css = ANNO_CSS.read_text(encoding="utf-8")

    def _icon_map(self):
        """ICON 表那一段源码。"""
        src = self.js[self.js.index("var ICON = {") :]
        return src[: src.index("\n  };")]

    def test_the_shell_opens_on_the_pen(self):
        """首屏那一份列表是批注,静态外壳里先摆笔 —— 它和默认的 panelMode 同值,
        不会先画一颗气泡再被 syncMode() 翻回去。"""
        shell = self.js[
            self.js.index("panel.innerHTML =") : self.js.index("document.body.appendChild(panel)")
        ]
        head = shell[shell.index("aipm-anno__head-icon") :]
        head = head[: head.index("aipm-anno__title")]
        self.assertIn("ICON.pen", head)
        self.assertIn('var panelMode = "annotations"', self.js)

    def test_switching_lists_swaps_the_head_icon(self):
        """两个模式的所有入口都走 syncMode(),换图标写在这里就够。"""
        block = _block(self.js, "function syncMode()")
        self.assertIn("els.headIcon.innerHTML = isComments ? ICON.comment : ICON.pen", block)
        # 换的是那颗 span。写 els.head.innerHTML 会把标题按钮、条数徽章、账号与
        # 关闭按钮一起抹掉,面板的头就秃了。
        self.assertNotIn("els.head.innerHTML", self.js)

    def test_the_comment_glyph_is_a_bubble_of_the_same_family(self):
        """气泡与同表其余图标一样:24 方格坐标系里的实心路径、对读屏隐藏。
        头图标是纯装饰,「这份列表是评论」由标题按钮上的字与 aria-pressed 说。"""
        icons = self._icon_map()
        self.assertIn("\n    comment:\n", icons)
        bubble = icons[icons.index("\n    comment:") :]
        bubble = bubble[: bubble.index("\n    close:")]
        self.assertIn('viewBox="0 0 24 24"', bubble)
        self.assertIn('aria-hidden="true"', bubble)
        self.assertIn("<path d=", bubble)
        self.assertNotIn("stroke", bubble)

    def test_one_rule_paints_whichever_glyph_is_inside(self):
        """两颗图标共用 .aipm-anno__head-icon svg 这一条:尺寸与配色写在选择器上,
        换图标不带动头部排版。"""
        rule = _block(self.css, ".aipm-anno__head-icon svg {")
        self.assertEqual(_decl(rule, "width"), _decl(rule, "height"))
        self.assertIn("fill: var(--md-accent-fg-color)", rule)

    def test_the_pen_still_marks_the_write_annotation_button(self):
        """笔没有从别处消失:工具栏上那颗「写批注」还是它。"""
        toolbar = self.js[self.js.index('var toolbar = document.createElement("div")') :]
        toolbar = toolbar[: toolbar.index("document.body.appendChild(toolbar)")]
        button = toolbar[toolbar.index("aipm-anno__tb-annotate") :]
        self.assertIn("ICON.pen", button)


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
