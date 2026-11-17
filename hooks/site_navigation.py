"""Render navigation for the current content space."""

from pathlib import Path

from jinja2 import ChoiceLoader, FileSystemLoader
from mkdocs.structure.nav import Navigation


def _site_navigation(nav, current, config):
    appearance = config.extra["site_switcher"]
    return {
        "current": current.title,
        "sites": [
            {
                "name": space.title,
                "url": next(page.url for page in nav.pages if space in page.ancestors),
                "icon": appearance[space.title]["icon"],
                "placeholder": appearance[space.title].get("placeholder", False),
            }
            for space in nav
        ],
    }


def on_env(env, **kwargs):
    env.loader = ChoiceLoader([
        FileSystemLoader(Path(__file__).parent / "templates"),
        env.loader,
    ])
    return env


def on_page_context(context, nav, config, **kwargs):
    space = next(item for item in nav if item.active)
    page = context["page"]
    for attribute in ("previous_page", "next_page"):
        adjacent = getattr(page, attribute)
        if adjacent is not None and space not in adjacent.ancestors:
            setattr(page, attribute, None)
    context["site_navigation"] = _site_navigation(nav, space, config)
    context["nav"] = Navigation(space.children, nav.pages)
    return context


def on_template_context(context, template_name, config, **kwargs):
    if template_name == "404.html":
        nav = context["nav"]
        context["site_navigation"] = _site_navigation(nav, nav.items[0], config)
        context["nav"] = Navigation(nav.items[0].children, nav.pages)
    return context
