import html
import json
import logging
import os
import re
import shutil
import subprocess
import gzip
import hashlib
import importlib
from datetime import datetime

def _nav_math():
    raw_re = r"\\\((.+?)\\\)"
    target = r'<span class="arithmatex">\(\1\)</span>'
    r = re.compile(raw_re)
    def nav_math(s):
        return r.sub(target, s).replace(" <span", "&nbsp;<span").replace("</span> ", "</span>&nbsp;")
    return nav_math

def on_env(env, config, files, **kwargs):
    env.filters["nav_math"] = _nav_math()
    return env

def on_config(config, **kwargs):
    # mkdocs 内置 search 插件会把经典主题的搜索 UI(search/main.js)注入每页,
    # 本仓库用 Material 模板渲染搜索,该脚本是死代码且依赖经典主题的 base_url 全局变量,
    # 每页加载都会抛 ReferenceError。hook 在插件 on_config 之后执行,这里摘掉它。
    try:
        config["extra_javascript"].remove("search/main.js")
    except ValueError:
        pass
    # RSS:注册零依赖插件,点亮 base.html 的 `{% if "rss" in config.plugins %}` 分支
    # (输出 feed_rss_created.xml / feed_rss_updated.xml 两个 alternate 链接)。
    config["plugins"]["rss"] = RSSFeedPlugin()
    # sitemap:接管 built-in sitemap。注册同名键后 mkdocs 核心的 _build_sitemap
    # 会跳过自带生成(否则其 on_post_build 之后生成会把 lastmod 覆盖回构建日),
    # 完整 sitemap.xml 由 SitemapPlugin.on_post_build 生成(真实 git lastmod)。
    config["plugins"]["sitemap"] = SitemapPlugin()
    return config

def _chunk_sentences(text):
    """按中文句子边界(。！？!?)切块;无句号的超长块(代码/表格/列表)再按停顿符硬切。"""
    chunks = []
    for s in re.split(r"(?<=[。！？!?])", text):
        s = s.strip()
        if not s:
            continue
        while len(s) > 150:
            # 在 [20, 120] 区间找最后一个停顿符,找不到就硬切 120 字
            cut = max([120] + [
                p for p in (s.rfind(c, 0, 120) for c in "，,、;； ")
                if p >= 20
            ])
            chunks.append(s[: cut + 1].rstrip())
            s = s[cut + 1:].strip()
        if s:
            chunks.append(s)
    return chunks

_jieba = None
_jieba_missing_warned = False

def _segment_text(text):
    """jieba 预分词:词间插空格,使索引侧按 /[\\s\\-]/ 切词后 key=真实词
    (否则中文整段 text 是单个 key,查询侧 segment() 贪心退化到单字,如"会计"错配"会")。

    jieba 惰性 import + 缺依赖优雅降级:返回 None 时调用方跳过该 doc 分词,构建不炸。
    """
    global _jieba, _jieba_missing_warned
    if _jieba is None:
        try:
            import jieba
            _jieba = jieba
        except ImportError:
            if not _jieba_missing_warned:
                logging.getLogger("mkdocs").warning(
                    "search-jieba: jieba 未安装,中文搜索索引不做预分词(多字查询可能退化为单字)"
                )
                _jieba_missing_warned = True
            return None
    return " ".join(_jieba.cut(text))

# ============================================================================
# Agent 可发现性 + 性能减法(2026-08-27,P1 审计承接)
# 全部零依赖:仅 stdlib + mkdocs 内置类;字符串/正则优先,避免全量序列化改动 HTML。
# ============================================================================

try:
    from mkdocs.structure.nav import Link, Page, Section
except Exception:  # pragma: no cover - 防御:极老 mkdocs 无此结构时降级
    Link = Page = Section = None

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\s+[+-]\d{4}$")
_EPOCH = datetime(1970, 1, 1)

# git 日期映射缓存:{repo_root: (lastmod_map, firstmod_map)}
_git_maps_cache = {}

# 构建过程累积的页面对象(on_page_context 每页回调;on_post_build 消费)。
# mkdocs 1.6 不把 File/Page 集合暴露给 on_post_build,只能在逐页事件里收。
_BUILT_PAGES = []


def on_page_context(context, page, config, nav, **kwargs):
    _BUILT_PAGES.append(page)
    return context


def _repo_root(config):
    return os.path.dirname(os.path.abspath(config["config_file_path"]))


def _all_pages(config):
    """构建后的全部文档页(on_page_context 累积)。

    mkdocs 1.6 不会把 File/Page 集合写入 config['files'] 或 config['nav'].pages
    传给 on_post_build,故在逐页事件 on_page_context 里收齐。
    """
    return list(_BUILT_PAGES)


def _iter_built_pages(config):
    """Yield (page, file) 对,仅文档页。"""
    for page in _all_pages(config):
        file = getattr(page, "file", None)
        if file is None:
            continue
        yield page, file


def _git_date_maps(repo):
    """一次性跑 `git log --name-only` 拿全库每个文件的最近/首次提交日期。

    返回 (lastmod_map, firstmod_map),键为 repo 根相对路径(如 docs/ai/evaluation.md),
    值为 `%ci` 格式字符串(如 2026-08-25 11:14:48 +0800)。
    git log 输出最新在前;首次出现=最近提交;--reverse 时首次出现=首次提交。
    """
    def run(extra):
        try:
            return subprocess.check_output(
                ["git", "-C", repo, "-c", "core.quotepath=false",
                 "log", "--format=%ci", "--name-only"] + extra,
                stderr=subprocess.DEVNULL, text=True)
        except Exception:
            return ""

    def parse(out, mapping):
        current = None
        for line in out.splitlines():
            line = line.rstrip()
            if not line:
                continue
            if _DATE_RE.match(line):
                current = line
            elif current and line not in mapping:
                mapping[line] = current

    lastmod, firstmod = {}, {}
    parse(run([]), lastmod)
    parse(run(["--reverse"]), firstmod)
    return lastmod, firstmod


def _file_git_dates(config, file):
    """返回 (firstmod_str, lastmod_str) 或 (None, None)。"""
    src = getattr(file, "abs_src_path", None)
    if not src:
        return (None, None)
    repo = _repo_root(config)
    if repo not in _git_maps_cache:
        _git_maps_cache[repo] = _git_date_maps(repo)
    lastmod_map, firstmod_map = _git_maps_cache[repo]
    rel = os.path.relpath(src, repo)
    return (firstmod_map.get(rel), lastmod_map.get(rel))


def _to_datetime(s):
    """`%ci` 日期串 → naive datetime;失败返回 None。"""
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", s.strip())
    if m:
        try:
            return datetime(int(m[1]), int(m[2]), int(m[3]),
                            int(m[4]), int(m[5]), int(m[6]))
        except ValueError:
            return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s.strip())
    if m:
        try:
            return datetime(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    return None


def _to_rfc822(dt):
    """datetime → RFC822(本库 git 提交统一 +0800)。"""
    if dt is None:
        return ""
    return dt.strftime("%a, %d %b %Y %H:%M:%S") + " +0800"


def _xml_escape(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))


def _page_frontmatter_date(page):
    meta = getattr(page, "meta", None) or {}
    for key in ("date", "更新时间", "updated", "lastmod", "modified"):
        val = meta.get(key)
        if val:
            return _to_datetime(str(val))
    return None


def _first_paragraph_text(html_content):
    """从渲染 HTML 提取首段纯文本(去标签/实体),作为一句话描述。"""
    if not html_content:
        return ""
    m = re.search(r"<p(?:\s[^>]*)?>(.*?)</p>", html_content, re.S)
    text = m.group(1) if m else html_content
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:300]


def _page_description(page):
    meta = getattr(page, "meta", None) or {}
    desc = meta.get("description")
    if desc:
        return str(desc).strip()
    return _first_paragraph_text(getattr(page, "content", "") or "")


# ----------------------------------------------------------------------------
# 3.1 RSS 2.0(零依赖,极简插件;注册到 config.plugins['rss'])
# ----------------------------------------------------------------------------
def _rss_channel(config, entries, self_link):
    site_name = config.get("site_name", "AI-PM")
    site_url = config.get("site_url", "").rstrip("/")
    site_desc = config.get("site_description", "") or site_name
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "  <channel>",
        f"    <title>{_xml_escape(site_name)}</title>",
        f"    <link>{_xml_escape(site_url or '')}</link>",
        f"    <description>{_xml_escape(site_desc)}</description>",
        f'    <atom:link href="{_xml_escape(self_link)}" rel="self" type="application/rss+xml"/>',
    ]
    for e in entries:
        out.append("    <item>")
        out.append(f"      <title>{_xml_escape(e['title'])}</title>")
        out.append(f"      <link>{_xml_escape(e['link'])}</link>")
        out.append(f"      <description>{_xml_escape(e['description'])}</description>")
        out.append(f"      <pubDate>{_to_rfc822(e['dt'])}</pubDate>")
        out.append("    </item>")
    out.append("  </channel>")
    out.append("</rss>")
    return "\n".join(out) + "\n"


def _generate_rss(config):
    site_dir = config["site_dir"]
    site_url = config.get("site_url", "").rstrip("/")
    created, updated = [], []
    for page, file in _iter_built_pages(config):
        firstmod, lastmod = _file_git_dates(config, file)
        if not firstmod and not lastmod:
            continue
        title = page.title or os.path.splitext(os.path.basename(file.src_path))[0]
        link = getattr(page, "canonical_url", None) or (site_url + "/" + page.url)
        desc = _page_description(page)
        created_dt = _page_frontmatter_date(page) or _to_datetime(firstmod) or _to_datetime(lastmod)
        updated_dt = _to_datetime(lastmod) or _to_datetime(firstmod)
        if created_dt:
            created.append({"title": title, "link": link, "description": desc, "dt": created_dt})
        if updated_dt:
            updated.append({"title": title, "link": link, "description": desc, "dt": updated_dt})
    created.sort(key=lambda e: e["dt"] or _EPOCH, reverse=True)
    updated.sort(key=lambda e: e["dt"] or _EPOCH, reverse=True)
    base = site_url.rstrip("/")
    for name, entries in (("feed_rss_created.xml", created), ("feed_rss_updated.xml", updated)):
        xml = _rss_channel(config, entries, f"{base}/{name}")
        with open(os.path.join(site_dir, name), "w", encoding="utf-8") as f:
            f.write(xml)


class RSSFeedPlugin:
    """零依赖 RSS 2.0 生成插件。

    注册到 config.plugins['rss'] 后,base.html 的 `{% if "rss" in config.plugins %}`
    分支点亮,输出 feed_rss_created.xml / feed_rss_updated.xml 两个 alternate 链接。
    """

    def on_post_build(self, config, **kwargs):
        _generate_rss(config)


# ----------------------------------------------------------------------------
# 3.4 sitemap 真实 lastmod:完全接管 built-in sitemap
# ----------------------------------------------------------------------------
def _generate_sitemap(config):
    site_dir = config["site_dir"]
    site_url = config.get("site_url", "").rstrip("/")
    urls = []
    for page, file in _iter_built_pages(config):
        loc = getattr(page, "canonical_url", None) or (site_url + "/" + page.url)
        _, lastmod = _file_git_dates(config, file)
        lastmod_date = lastmod[:10] if lastmod else ""
        if lastmod_date:
            urls.append(f"    <url>\n      <loc>{_xml_escape(loc)}</loc>\n      <lastmod>{lastmod_date}</lastmod>\n    </url>")
        else:
            urls.append(f"    <url>\n      <loc>{_xml_escape(loc)}</loc>\n    </url>")
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
               + "\n".join(urls) + "\n</urlset>\n")
    with open(os.path.join(site_dir, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write(sitemap)
    # built-in sitemap 先于本 hook 生成过 sitemap.xml.gz(内容为构建日 lastmod),
    # 一并覆写为真实 lastmod 的 gzip 版,保持两份一致。
    with gzip.open(os.path.join(site_dir, "sitemap.xml.gz"), "wt", encoding="utf-8") as f:
        f.write(sitemap)


class SitemapPlugin:
    """接管 built-in sitemap:注册同名键使 mkdocs 核心跳过自带生成,
    on_post_build 生成含真实 lastmod(git log -1)的完整 sitemap.xml。"""

    def on_post_build(self, config, **kwargs):
        _generate_sitemap(config)


# ----------------------------------------------------------------------------
# 3.2 llms.txt + 3.3 .md 镜像 + 3.5 JSON-LD + 3.6 MathJax 按页加载
# ----------------------------------------------------------------------------
def _generate_llms_txt(config):
    site_dir = config["site_dir"]
    site_url = config.get("site_url", "").rstrip("/")
    site_name = config.get("site_name", "AI-PM")
    lines = [f"# {site_name}", ""]
    if config.get("site_description"):
        lines.append(config["site_description"])
        lines.append("")
    for page, file in _iter_built_pages(config):
        title = page.title or os.path.splitext(os.path.basename(file.src_path))[0]
        link = getattr(page, "canonical_url", None) or (site_url + "/" + page.url)
        desc = _page_description(page)
        if desc:
            lines.append(f"- [{title}]({link}): {desc}")
        else:
            lines.append(f"- [{title}]({link})")
    with open(os.path.join(site_dir, "llms.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def _mirror_markdown(config):
    site_dir = config["site_dir"]
    for page, file in _iter_built_pages(config):
        src = getattr(file, "abs_src_path", None)
        if not src or not os.path.exists(src):
            continue
        dst = os.path.join(site_dir, file.src_path)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)


def _resolve_nav_url(config, src):
    """把 nav 里的 src 路径(如 index.md / ai/evaluation.md)映射到页面 URL。"""
    src = str(src)
    for page, file in _iter_built_pages(config):
        if file.src_path == src:
            return page.url
    base = src[:-3] if src.endswith(".md") else src
    return base + "/"


def _section_url(config, children):
    """区块落地 URL:直接子项里第一个 `index.md` 页(如 business/index.md → business/)。"""
    for child in children:
        if isinstance(child, dict):
            for ctitle, ctarget in child.items():
                if isinstance(ctarget, str) and ctarget.endswith("index.md"):
                    return _resolve_nav_url(config, ctarget)
        elif isinstance(child, tuple) and isinstance(child[1], str) and child[1].endswith("index.md"):
            return _resolve_nav_url(config, child[1])
        elif Section is not None and isinstance(child, Section):
            for c in child.children:
                if isinstance(c, Page) and c.file and c.file.src_path.endswith("index.md"):
                    return c.url
    return None


def _nav_breadcrumbs(config):
    """从 config.nav 递归映射每页面包屑路径 → {page_url: [(name, url_or_None), ...]}。

    mkdocs 1.6 的 config['nav'] 在 on_post_build 时仍是原始 YAML 结构
    (list[dict]),不是 Navigation 对象,故按原始形态递归解析:
    - {section_title: [children]}  → 区块(落地 URL 取子项首个 index.md)
    - {page_title: 'path.md'}      → 页
    - (title, 'path.md') / (title, {children}) → 兼容 Navigation 展开后形态
    """
    site_url = config.get("site_url", "").rstrip("/") + "/"
    site_name = config.get("site_name", "AI-PM")
    crumbs = {}
    home_trail = [(site_name, site_url)]

    def walk(items, trail):
        for item in items:
            if isinstance(item, dict):
                for title, children in item.items():
                    if isinstance(children, str):
                        url = _resolve_nav_url(config, children)
                        crumbs[url] = trail + [(title, url)]
                    else:
                        sec_url = _section_url(config, children)
                        walk(children, trail + [(title, sec_url)])
            elif isinstance(item, tuple):
                title, target = item
                if isinstance(target, str):
                    url = _resolve_nav_url(config, target)
                    crumbs[url] = trail + [(title, url)]
                else:
                    sec_url = _section_url(config, target)
                    walk(target, trail + [(title, sec_url)])
            elif Section is not None and isinstance(item, Section):
                sec_url = None
                for c in item.children:
                    if isinstance(c, Page) and c.file and c.file.src_path.endswith("index.md"):
                        sec_url = c.url
                        break
                walk(item.children, trail + [(item.title, sec_url)])
            elif Page is not None and isinstance(item, Page):
                crumbs[item.url] = trail + [(item.title, item.url)]
            elif Link is not None and isinstance(item, Link):
                crumbs[item.url] = trail + [(item.title, item.url)]

    nav = config.get("nav")
    if isinstance(nav, list):
        walk(nav, home_trail)
    elif hasattr(nav, "items"):
        walk(nav.items, home_trail)

    # 首页兜底(index.md 通常不在 nav.items 顶层)
    for page, _ in _iter_built_pages(config):
        if getattr(page, "is_homepage", False):
            crumbs.setdefault(page.url, home_trail)
            break
    return crumbs


def _absolutize_url(url, site_url):
    if not url:
        return url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    base = site_url.rstrip("/") + "/"
    return base + url.lstrip("/")


def _breadcrumb_jsonld(trail, page, site_url):
    elements = []
    for name, url in trail:
        if elements and elements[-1][0] == name:
            continue  # 去重连续同名(「金融学」区块 + 同名 index 页)
        elements.append((name, url))
    items = []
    pos = 1
    last_idx = len(elements) - 1
    page_url = getattr(page, "canonical_url", None) or site_url or ""
    for i, (name, url) in enumerate(elements):
        if i == 0:
            item_url = _absolutize_url(url, site_url) or page_url
        elif i == last_idx:
            item_url = page_url
        else:
            item_url = _absolutize_url(url, site_url) or page_url
        items.append({"@type": "ListItem", "position": pos, "name": name, "item": item_url})
        pos += 1
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": items}


def _article_jsonld(page, config):
    meta = getattr(page, "meta", None) or {}
    firstmod, lastmod = _file_git_dates(config, page.file)
    created_dt = _page_frontmatter_date(page) or _to_datetime(firstmod) or _to_datetime(lastmod)
    modified_dt = _to_datetime(lastmod) or created_dt
    if not created_dt and not modified_dt:
        return None
    author = meta.get("author") or config.get("site_author") or "AI-PM Wiki"
    return {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": page.title,
        "datePublished": created_dt.strftime("%Y-%m-%d") if created_dt else None,
        "dateModified": modified_dt.strftime("%Y-%m-%d") if modified_dt else None,
        "author": {"@type": "Organization", "name": author},
        "mainEntityOfPage": {"@type": "WebPage",
                             "@id": getattr(page, "canonical_url", None) or ""},
    }


def _inject_jsonld(config):
    site_dir = config["site_dir"]
    site_url = config.get("site_url", "").rstrip("/")
    crumbs_map = _nav_breadcrumbs(config)
    for page, file in _iter_built_pages(config):
        html_path = os.path.join(site_dir, file.dest_path)
        if not os.path.exists(html_path):
            continue
        with open(html_path, encoding="utf-8") as f:
            content = f.read()
        head_end = content.find("</head>")
        if head_end == -1:
            continue
        scripts = []
        trail = crumbs_map.get(getattr(page, "url", ""))
        if trail:
            bc = _breadcrumb_jsonld(trail, page, site_url)
            if bc:
                scripts.append(bc)
        if not getattr(page, "is_homepage", False):
            article = _article_jsonld(page, config)
            if article:
                scripts.append(article)
        if not scripts:
            continue
        # 字符串插入 `</head>` 前,避免 bs4 全量序列化改动 HTML;
        # 已有 WebSite JSON-LD(首页)的页面追加不覆盖。
        injection = "".join(
            '<script type="application/ld+json">' + json.dumps(s, ensure_ascii=False) + "</script>"
            for s in scripts
        )
        content = content[:head_end] + injection + content[head_end:]
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(content)


# ============================================================================
# 站点性能:静态资源压缩 + 内容哈希长效缓存 + Webfont 非阻塞(2026-09-22,issue #91)
# ----------------------------------------------------------------------------
# 三步都在构建产物上就地生效,源码保持可读:
#   1. _minify_static_assets —— site/_static/{css,js} 就地压缩(rcssmin/rjsmin,
#      纯去注释与空白,不做标识符改名)。压缩器缺依赖/自检不过时保留原文件并告警,
#      任何情况下都不会把「压坏了」的资源发上线。
#   2. _optimize_pages —— 一次遍历每页 HTML,做两件事:
#      a) 把 _static 引用的 ?v= 换成产物内容哈希。原方案靠人工 bump 版本号,
#         漏 bump 就会让用户吃满一年的旧资源;内容哈希让击穿自动且必然。
#      b) 把 Google Fonts 样式表改成非阻塞加载(media=print + onload 切回 all,
#         附 <noscript> 兜底)。这条跨境请求在弱网/受限网络下曾长时间阻塞首屏,
#         改后 webfont 照常生效,只是不再堵渲染。
# 顺序:必须先压缩再算哈希,否则哈希对不上文件的最终字节。
# ============================================================================

# 参与压缩与内容哈希的静态资源扩展名(site/_static 下只有这两类)
STATIC_ASSET_EXTS = (".css", ".js")

# Google Fonts 样式表(主题 base.html 的 fonts 区块产出)
# 负向后顾排除 <noscript> 兜底里那一份,保证本函数幂等(重跑不会套娃)
_WEBFONT_LINK_RE = re.compile(
    r'(?<!<noscript>)<link rel="stylesheet" '
    r'href="(https://fonts\.googleapis\.com/[^"]+)">'
)

# _static 下的 CSS/JS 引用(可选已带 ?v=)。
# 用引号后瞻锚定「属性值开头」:页面正文里恰好写到 _static/ 路径的文字不该被改写。
# 前缀随页面而变:普通页是相对路径(../..),静态模板 404.html 是绝对路径(/),
# 两者都要覆盖,捕获后原样保留。
_STATIC_REF_RE = re.compile(
    r'(?<=["\'])((?:(?:\.{1,2})?/)*_static/(?:css|js)/[A-Za-z0-9._-]+)'
    r'(\?v=[^"\'&\s>]*)?'
)


# 压缩器句柄缓存:构建内只 import/告警一次
_MINIFIERS = {}


def _load_minifier(module_name, func_name):
    """惰性加载压缩器;缺依赖返回 None 且只告警一次(与 jieba 同款降级策略)。"""
    if module_name in _MINIFIERS:
        return _MINIFIERS[module_name]
    try:
        minifier = getattr(importlib.import_module(module_name), func_name)
    except (ImportError, AttributeError):
        logging.getLogger("mkdocs").warning(
            f"perf-minify: 未安装 {module_name},跳过对应资源压缩(uv sync 后即可生效)"
        )
        minifier = None
    _MINIFIERS[module_name] = minifier
    return minifier


def _macro_counts(css):
    """CSS 结构不变量:花括号与 at-rule 关键字计数。压缩只该动空白与注释。"""
    return (
        css.count("{"),
        css.count("}"),
        len(re.findall(r"@(?:media|keyframes|supports|font-face|import)\b", css)),
        css.count("url("),
    )


def _js_syntax_ok(code):
    """用 node --check 校验语法;node 不可用时返回 None(表示无法判定)。

    只做语法校验:压缩器是「去注释与空白」而非改名,语义等价的破坏基本都会
    先表现为语法错误(如模板串换引号后跨行未闭合)。
    """
    node = shutil.which("node")
    if not node:
        return None
    try:
        proc = subprocess.run(
            [node, "--check", "-"],
            input=code.encode("utf-8"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return proc.returncode == 0
    except OSError:
        return None


def _minify_static_assets(config):
    """就地压缩 site/_static 下的 CSS/JS,失败则保留原文件。"""
    static_dir = os.path.join(config["site_dir"], "_static")
    if not os.path.isdir(static_dir):
        return
    minifiers = {
        ".css": _load_minifier("rcssmin", "cssmin"),
        ".js": _load_minifier("rjsmin", "jsmin"),
    }
    log = logging.getLogger("mkdocs")
    saved = 0
    for dirpath, _dirnames, filenames in os.walk(static_dir):
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext not in STATIC_ASSET_EXTS:
                continue
            minify = minifiers.get(ext)
            if minify is None:
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as f:
                source = f.read()
            try:
                minified = minify(source)
            except Exception as exc:  # 压缩器抛错不该炸整个构建
                log.warning(f"perf-minify: {name} 压缩失败,保留原文件:{exc}")
                continue
            # 自检:压空、压得过狠一律视为可疑,保留原文件
            if not minified.strip() or len(minified) > len(source):
                log.warning(f"perf-minify: {name} 压缩结果异常,保留原文件")
                continue
            if ext == ".css":
                if _macro_counts(source) != _macro_counts(minified):
                    log.warning(f"perf-minify: {name} CSS 结构自检不通过,保留原文件")
                    continue
            else:
                if _js_syntax_ok(source) and _js_syntax_ok(minified) is False:
                    log.warning(f"perf-minify: {name} 压缩后 node --check 失败,保留原文件")
                    continue
            with open(path, "w", encoding="utf-8") as f:
                f.write(minified)
            saved += len(source) - len(minified)
    if saved:
        log.info(f"perf-minify: _static 压缩后共减少 {saved} 字节")


def _static_version_map(config):
    """{_static 相对路径: 内容哈希前 8 位},取自压缩后的最终产物字节。"""
    static_dir = os.path.join(config["site_dir"], "_static")
    versions = {}
    for dirpath, _dirnames, filenames in os.walk(static_dir):
        for name in filenames:
            if os.path.splitext(name)[1].lower() not in STATIC_ASSET_EXTS:
                continue
            path = os.path.join(dirpath, name)
            with open(path, "rb") as f:
                digest = hashlib.sha256(f.read()).hexdigest()[:8]
            rel = os.path.relpath(path, config["site_dir"]).replace(os.sep, "/")
            versions[rel] = digest
    return versions


def rewrite_static_versions(document, versions):
    """把 HTML 里 _static 引用的 ?v= 换成内容哈希;返回 (新 HTML, 改写次数)。

    未带 ?v= 的引用也补上:netlify.toml 对 /_static/css/*、/_static/js/* 给了
    一年缓存,少了版本参数就会被钉住一年。哈希表里没有的文件不动。
    """
    changed = 0

    def replace(match):
        nonlocal changed
        ref = match.group(1)
        # 版本表按站点根相对路径建键,这里剥掉相对前缀再查
        digest = versions.get(ref[ref.index("_static/") :])
        if digest is None:
            return match.group(0)
        changed += 1
        return f"{ref}?v={digest}"

    return _STATIC_REF_RE.sub(replace, document), changed


def defer_webfont_link(document):
    """把 Google Fonts 样式表改成非阻塞加载;返回 (新 HTML, 改写次数)。

    保留 preconnect,webfont 仍会加载并生效,只是不再挡住首屏渲染。
    """
    changed = 0

    def replace(match):
        nonlocal changed
        url = match.group(1)
        changed += 1
        return (
            f'<link rel="preload" as="style" href="{url}">'
            f'<link rel="stylesheet" href="{url}" media="print" '
            f"onload=\"this.media='all'\">"
            f'<noscript><link rel="stylesheet" href="{url}"></noscript>'
        )

    return _WEBFONT_LINK_RE.sub(replace, document), changed


def _iter_built_html(config):
    """遍历 site/ 下全部 HTML。

    不走 _iter_built_pages:那个列表由 on_page_context 逐页收集,静态模板
    (404.html)不在其中 —— 漏掉它,那页的 ?v= 就永远停在人工写的旧版本号上。
    """
    for dirpath, _dirnames, filenames in os.walk(config["site_dir"]):
        for name in filenames:
            if name.endswith(".html"):
                yield os.path.join(dirpath, name)


def _optimize_pages(config):
    """遍历每页 HTML:内容哈希版本号 + Webfont 非阻塞。"""
    versions = _static_version_map(config)
    rewritten = deferred = 0
    for html_path in _iter_built_html(config):
        with open(html_path, encoding="utf-8") as f:
            document = f.read()
        document, n_ver = rewrite_static_versions(document, versions)
        document, n_font = defer_webfont_link(document)
        if not (n_ver or n_font):
            continue
        rewritten += n_ver
        deferred += n_font
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(document)
    if rewritten or deferred:
        logging.getLogger("mkdocs").info(
            f"perf-pages: 改写 {rewritten} 处资源版本号、{deferred} 处 webfont 链接"
        )

def on_post_build(config, **kwargs):
    # 内置 search 插件把整页文本抹成一行(无 HTML 标签),Material 搜索 worker
    # 的摘要机制按块级标签切块,于是整页=一块,命中词所在"块"=全文。
    # 这里把 text 按句子切成 <p> 块,恢复「命中句摘要」(最多两句)。
    #
    # 另外:worker 索引侧按 /[\s\-]/ 切词,中文整段 text 是单个索引 key,查询侧
    # segment() 对精确 key 贪心最长匹配,"会计"无精确 key 会退化到单字"会"导致
    # 前缀通配全错配。修复:先用 jieba 预分词、词间插空格,再走句子切块。
    # 1) 搜索索引恢复命中句摘要(既有逻辑;search_index.json 缺失时跳过不炸)
    path = os.path.join(config["site_dir"], "search", "search_index.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            index = json.load(f)
        for doc in index.get("docs", []):
            text = doc.get("text")
            # 已切块(以 <p> 开头)或正文里本就有 <p> 字样的跳过;用 startswith
            # 而不是 "in",避免正文含代码示例("<p>")的文档被误判为已处理
            if not text or text.startswith("<p>"):
                continue
            # 1) jieba 预分词(词间插空格),让索引 key = 真实词
            segmented = _segment_text(text)
            if segmented is None:
                continue
            # 2) 再按句子包 <p> 块,恢复命中句摘要
            chunks = _chunk_sentences(segmented)
            # 3) 分块里是文档原文片段,可能带 HTML 标签字样(代码示例中的 <script> 等),
            #    写入索引前做实体转义,防 Material 搜索 worker 摘要经 innerHTML 渲染成存储型 XSS。
            #    必须在分词/切块之后转义:实体的 ";" 否则会变成切块停顿符。
            chunks = [html.escape(c) for c in chunks]
            if len(chunks) > 1:
                doc["text"] = "<p>" + "</p><p>".join(chunks) + "</p>"
            else:
                # 无句子边界的单块也须写入分词结果,否则该 doc 仍是整段单 key
                doc["text"] = html.escape(segmented)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False)

    # 2) Agent 可发现性(RSS/sitemap 由插件 on_post_build 完成)
    _generate_llms_txt(config)
    _mirror_markdown(config)
    _inject_jsonld(config)

    # 3) 站点性能:压缩 _static、再按最终字节算内容哈希、改写页面引用
    _minify_static_assets(config)
    _optimize_pages(config)
