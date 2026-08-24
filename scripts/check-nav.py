#!/usr/bin/env python3
"""校验 mkdocs.yml nav 与 docs/ 源文件一一对应(CI step;不并入本地 4 条门禁)。

三类问题:
- 失效路径:nav 中登记但 docs/ 下不存在的文件
- 未登记页(孤儿页):docs/ 下存在但 nav 未登记的 .md 页面
- 其余(mkdocs 自动收录)不视为问题;非 .md 资源(_static/、图片等)不参与核对,
  exclude_docs 配置排除的文件同样跳过。

用法:uv run python scripts/check-nav.py
"""

import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent


class _ConfigLoader(yaml.SafeLoader):
    """mkdocs.yml 含 python 标签(如 slugify: !!python/name:pymdownx.slugs.uslugify),
    本脚本只读取 nav/docs_dir/exclude_docs,未知 python 标签一律按普通标量忽略。"""


_ConfigLoader.add_multi_constructor(
    "tag:yaml.org,2002:python/",
    lambda loader, tag_suffix, node: loader.construct_scalar(node),
)


def collect_nav_paths(nav, paths):
    """递归收集 nav 中的源文件路径(相对 docs_dir)。"""
    if isinstance(nav, dict):
        for children in nav.values():
            if isinstance(children, str):
                paths.add(children)
            else:
                collect_nav_paths(children, paths)
    elif isinstance(nav, list):
        for item in nav:
            if isinstance(item, str):
                paths.add(item)
            else:
                collect_nav_paths(item, paths)


def main():
    config = yaml.load(
        (REPO_ROOT / "mkdocs.yml").read_text(encoding="utf-8"),
        Loader=_ConfigLoader,
    )
    docs_dir = REPO_ROOT / config.get("docs_dir", "docs")
    exclude_docs = set((config.get("exclude_docs") or {}).keys())

    nav_paths = set()
    collect_nav_paths(config.get("nav", []), nav_paths)

    # 1) 失效路径:nav 登记但文件不存在
    missing = sorted(p for p in nav_paths if not (docs_dir / p).is_file())

    # 2) 孤儿页:docs/ 下 .md 未登记且未被 exclude_docs 排除
    orphan = sorted(
        str(p.relative_to(docs_dir))
        for p in docs_dir.rglob("*.md")
        if str(p.relative_to(docs_dir)) not in nav_paths
        and str(p.relative_to(docs_dir)) not in exclude_docs
    )

    problems = 0
    for p in missing:
        print(f"FAIL: nav 登记路径不存在: {p}")
        problems += 1
    for p in orphan:
        print(f"FAIL: docs/ 下未登记页面(孤儿页): {p}")
        problems += 1
    if problems:
        print(f"check-nav: FAILED({problems} 处)")
        return 1
    print(f"check-nav: OK(nav {len(nav_paths)} 页 ↔ docs/ 全量核对一致)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
