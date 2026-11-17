"""Module navigation follows the real MkDocs navigation tree."""

from pathlib import Path
import unittest

from mkdocs.config import load_config
from mkdocs.structure.files import get_files
from mkdocs.structure.nav import get_navigation

from hooks.site_navigation import on_page_context, on_template_context


ROOT = Path(__file__).resolve().parents[1]


class SiteNavigationCase(unittest.TestCase):
    def setUp(self):
        self.config = load_config(str(ROOT / "mkdocs.yml"))

    def navigation(self):
        return get_navigation(get_files(self.config), self.config)

    def page_context(self, nav, path):
        page = next(page for page in nav.pages if page.file.src_uri == path)
        page.active = True
        return on_page_context({"page": page}, nav, self.config)

    def test_reordering_topics_updates_the_module_entry(self):
        knowledge = next(item["专业知识"] for item in self.config.nav if "专业知识" in item)
        nav = self.navigation()
        context = self.page_context(nav, "computer-science/index.md")
        entry = next(site for site in context["site_navigation"]["sites"] if site["name"] == "专业知识")
        self.assertEqual(entry["url"], "computer-science/")

        management = next(item for item in knowledge if "工商管理" in item)
        knowledge.remove(management)
        knowledge.insert(0, management)
        nav = self.navigation()
        context = self.page_context(nav, "computer-science/index.md")
        entry = next(site for site in context["site_navigation"]["sites"] if site["name"] == "专业知识")
        self.assertEqual(entry["url"], "management/")

    def test_moving_a_topic_updates_its_current_module(self):
        knowledge = next(item["专业知识"] for item in self.config.nav if "专业知识" in item)
        technology = next(item["技术"] for item in self.config.nav if "技术" in item)
        topic = next(item for item in knowledge if "计算机科学" in item)
        knowledge.remove(topic)
        technology.insert(0, topic)
        nav = self.navigation()
        context = self.page_context(nav, "computer-science/index.md")
        self.assertEqual(context["site_navigation"]["current"], "技术")
        entry = next(site for site in context["site_navigation"]["sites"] if site["name"] == "技术")
        self.assertEqual(entry["url"], "computer-science/")

    def test_404_follows_the_first_module(self):
        product = next(item for item in self.config.nav if "产品" in item)
        self.config.nav.remove(product)
        self.config.nav.insert(0, product)
        nav = self.navigation()
        context = on_template_context({"nav": nav}, "404.html", self.config)
        self.assertEqual(context["site_navigation"]["current"], "产品")
        self.assertEqual(context["site_navigation"]["sites"][0]["name"], "产品")
        self.assertEqual(context["site_navigation"]["sites"][0]["url"], "product-manager/")


if __name__ == "__main__":
    unittest.main()
