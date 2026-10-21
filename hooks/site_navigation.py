"""Render navigation for the current content space."""

from mkdocs.structure.nav import Navigation


def on_page_context(context, nav, **kwargs):
    space = next(item for item in nav if item.active)
    context["nav"] = Navigation(space.children, nav.pages)
    return context


def on_template_context(context, template_name, **kwargs):
    if template_name == "404.html":
        nav = context["nav"]
        context["nav"] = Navigation(nav.items[0].children, nav.pages)
    return context
