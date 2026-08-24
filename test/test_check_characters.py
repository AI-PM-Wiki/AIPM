import unittest

from scripts.char_check import find_bad_chars, str_2_unicode


class TestStr2Unicode(unittest.TestCase):
    def test_cjk_comma(self):
        self.assertEqual(str_2_unicode("，"), "\\uff0c")

    def test_zero_width_space(self):
        self.assertEqual(str_2_unicode("​"), "\\u200b")

    def test_ascii_unchanged(self):
        self.assertEqual(str_2_unicode("abc"), "abc")


class TestFindBadChars(unittest.TestCase):
    def test_finds_matching_keys(self):
        char_map = {"，": "逗号", "​": "零宽空格"}
        self.assertEqual(find_bad_chars("a，b", char_map), ["，"])

    def test_returns_all_in_map_order(self):
        char_map = {"a": "1", "b": "2", "c": "3"}
        self.assertEqual(find_bad_chars("cbac", char_map), ["a", "b", "c"])

    def test_clean_text_returns_empty(self):
        self.assertEqual(find_bad_chars("hello", {"，": "x"}), [])

    def test_empty_char_map(self):
        self.assertEqual(find_bad_chars("anything", {}), [])


if __name__ == "__main__":
    unittest.main()
