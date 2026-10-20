"""Apply typography and discussion layout to book articles."""

from bs4 import BeautifulSoup


def on_page_content(html, **kwargs):
    document = BeautifulSoup(html, "html.parser")
    body = document.select_one(".book-original")
    if body is None:
        return html
    for paragraph in body.find_all("p", recursive=False):
        strong = paragraph.find("strong", recursive=False)
        if strong is None or len(paragraph.find_all(recursive=False)) != 1:
            continue
        if paragraph.get_text(strip=True) == strong.get_text(strip=True):
            classes = paragraph.get("class", [])
            if "book-emphasis-block" not in classes:
                paragraph["class"] = [*classes, "book-emphasis-block"]
    return str(document)


def on_post_page(output, **kwargs):
    document = BeautifulSoup(output, "html.parser")
    credits = document.select_one(".page-copyright")
    if credits is not None:
        separator = credits.find_previous_sibling()
        if separator is not None and separator.name == "hr":
            separator.decompose()
        credits.decompose()
    return str(document)
