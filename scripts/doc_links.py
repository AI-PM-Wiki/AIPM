"""Scan docs/*.md for in-repo Markdown/HTML links and heading anchors.

External http(s)/mailto/tel links are skipped (same policy as CI htmltest).
Heading ids use MkDocs' slugify (pymdownx.slugs.slugify case=lower) plus
Python-Markdown toc uniqueness (`_1`, `_2`, …).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

from markdown.extensions.toc import unique
from pymdownx.slugs import slugify

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = REPO_ROOT / "docs"

_slugify = slugify(case="lower")

SKIP_SCHEMES = frozenset({"http", "https", "mailto", "tel", "data", "javascript"})
FENCE_RE = re.compile(r"^```.*?^```", re.MULTILINE | re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`]+`")
MD_LINK_RE = re.compile(
    r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)"
)
HTML_REF_RE = re.compile(r"""(?:href|src)\s*=\s*['"]([^'"]+)['"]""", re.IGNORECASE)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
HEADING_INLINE_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
HEADING_CODE_RE = re.compile(r"`([^`]+)`")


def _visible_markdown(text: str) -> str:
    """Drop fenced and inline code so example links/headings are not checked."""
    return INLINE_CODE_RE.sub(" ", FENCE_RE.sub(" ", text))


def heading_slugs(text: str) -> set[str]:
    ids: set[str] = set()
    for match in HEADING_RE.finditer(_visible_markdown(text)):
        title = match.group(2).strip()
        title = re.sub(r"\s+#+\s*$", "", title)
        title = HEADING_INLINE_LINK_RE.sub(r"\1", title)
        title = HEADING_CODE_RE.sub(r"\1", title)
        unique(_slugify(title, "-"), ids)
    return ids


def extract_hrefs(text: str) -> list[str]:
    visible = _visible_markdown(text)
    found = [match.group(1).strip() for match in MD_LINK_RE.finditer(visible)]
    found.extend(match.group(1).strip() for match in HTML_REF_RE.finditer(visible))
    return found


def _is_external(href: str) -> bool:
    parsed = urlparse(href)
    if parsed.scheme.lower() in SKIP_SCHEMES:
        return True
    return href.startswith("//")


def resolve_target(source: Path, href: str) -> Path | None:
    """Return the docs path a local href should open, or None if unresolvable."""
    parsed = urlparse(href)
    raw_path = unquote(parsed.path)

    if raw_path.startswith("/"):
        candidate = DOCS_DIR / raw_path.lstrip("/")
    elif raw_path == "":
        candidate = source
    else:
        candidate = source.parent / raw_path

    try:
        docs_root = DOCS_DIR.resolve()
        candidate = candidate.resolve()
        candidate.relative_to(docs_root)
    except (OSError, ValueError):
        return None

    if candidate.is_file():
        return candidate
    if candidate.is_dir():
        index = candidate / "index.md"
        return index if index.is_file() else None
    if candidate.suffix:
        return None
    md = candidate.with_suffix(".md")
    if md.is_file():
        return md
    index = candidate / "index.md"
    if index.is_file():
        return index
    return None


def check_href(source: Path, href: str, slug_cache: dict[Path, set[str]]) -> str | None:
    """Return an error message, or None if the href is fine / out of scope."""
    if not href or href == "#":
        return None
    if _is_external(href):
        return None

    fragment = unquote(urlparse(href).fragment)
    target = resolve_target(source, href)
    if target is None:
        rel = source.relative_to(REPO_ROOT)
        return f"{rel}: missing target {href}"

    if not fragment:
        return None
    slugs = slug_cache.setdefault(
        target, heading_slugs(target.read_text(encoding="utf-8"))
    )
    if fragment not in slugs:
        rel = source.relative_to(REPO_ROOT)
        dest = target.relative_to(REPO_ROOT)
        return f"{rel}: missing heading #{fragment} in {dest}"
    return None


def iter_markdown_files() -> list[Path]:
    return sorted(DOCS_DIR.rglob("*.md"))


def collect_problems() -> list[str]:
    slug_cache: dict[Path, set[str]] = {}
    problems: list[str] = []
    seen: set[tuple[Path, str]] = set()
    for path in iter_markdown_files():
        for href in extract_hrefs(path.read_text(encoding="utf-8")):
            key = (path, href)
            if key in seen:
                continue
            seen.add(key)
            error = check_href(path, href, slug_cache)
            if error:
                problems.append(error)
    return problems


def main() -> int:
    problems = collect_problems()
    if problems:
        print(f"check-doc-links: FAILED ({len(problems)} 处)")
        for item in problems:
            print(f"FAIL: {item}")
        return 1
    print(f"check-doc-links: OK ({len(iter_markdown_files())} pages)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
