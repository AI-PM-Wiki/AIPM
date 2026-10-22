"""Embed the book's endnotes beside their references as inert templates."""

from copy import deepcopy
from urllib.parse import urldefrag, urljoin

from bs4 import BeautifulSoup


def on_env(env, config, files, **kwargs):
    documents = []
    notes = {}
    for file in files.documentation_pages():
        if file.page is None or file.page.content is None:
            continue
        document = BeautifulSoup(file.page.content, "html.parser")
        body = document.select_one(".book-original")
        if body is None:
            continue
        url = "/" + file.url
        documents.append((file.page, url, document, body))
        for anchor in body.select('a[id^="footnote_content_"]'):
            identifier = anchor["id"]
            note = deepcopy(anchor.parent)
            backlink = note.select_one('a[href*="#footnote_quote_"]')
            if note.name != "p" or backlink is None:
                raise ValueError(f"Invalid book footnote: {url}#{identifier}")
            backlink.decompose()
            note.select_one(f'[id="{identifier}"]').decompose()
            for node in note.select("[id]"):
                del node["id"]
            for node in note.select("[href], [src]"):
                for attribute in ("href", "src"):
                    if node.has_attr(attribute):
                        node[attribute] = urljoin(url, node[attribute])
            key = (url, identifier)
            if key in notes:
                raise ValueError(f"Duplicate book footnote: {url}#{identifier}")
            notes[key] = note

    for page, url, document, body in documents:
        embedded = set()
        for link in body.select('a[href*="#footnote_content_"]'):
            destination, identifier = urldefrag(urljoin(url, link["href"]))
            note = notes[(destination, identifier)]
            template_id = "book-note-" + identifier
            link["data-book-footnote"] = template_id
            link["aria-haspopup"] = "dialog"
            link["aria-controls"] = "book-footnote-popover"
            link["aria-expanded"] = "false"
            link["role"] = "button"
            link["aria-label"] = "查看注释 " + link.get_text(strip=True)
            if template_id not in embedded:
                template = document.new_tag("template", id=template_id)
                template.append(deepcopy(note))
                document.append(template)
                embedded.add(template_id)
        page.content = str(document)
    return env
