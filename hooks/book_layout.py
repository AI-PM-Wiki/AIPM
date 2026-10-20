"""Keep article footers focused on discussion."""

from bs4 import BeautifulSoup


def on_post_page(output, **kwargs):
    document = BeautifulSoup(output, "html.parser")
    credits = document.select_one(".page-copyright")
    if credits is not None:
        separator = credits.find_previous_sibling()
        if separator is not None and separator.name == "hr":
            separator.decompose()
        credits.decompose()
    return str(document)
