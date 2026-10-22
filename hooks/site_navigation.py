"""Render navigation for the current content space."""

from pathlib import Path

from jinja2 import ChoiceLoader, FileSystemLoader
from mkdocs.structure.nav import Navigation


def on_env(env, **kwargs):
    env.loader = ChoiceLoader([
        FileSystemLoader(Path(__file__).parent / "templates"),
        env.loader,
    ])
    return env


def on_page_context(context, nav, **kwargs):
    space = next(item for item in nav if item.active)
    page = context["page"]
    for attribute in ("previous_page", "next_page"):
        adjacent = getattr(page, attribute)
        if adjacent is not None and space not in adjacent.ancestors:
            setattr(page, attribute, None)
    context["nav"] = Navigation(space.children, nav.pages)
    return context


def on_template_context(context, template_name, **kwargs):
    if template_name == "404.html":
        nav = context["nav"]
        context["nav"] = Navigation(nav.items[0].children, nav.pages)
    return context
