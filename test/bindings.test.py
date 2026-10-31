import unittest
from types import CapsuleType

import tree_sitter_regex as grammar
from tree_sitter import Language, Parser, Query, QueryCursor


class BindingsTest(unittest.TestCase):
    def test_languages_parse_source_and_packaged_queries_capture_literals(self):
        for name, factory, highlights, source, root in [
            (
                "ecmaregex",
                grammar.language_ecmaregex,
                grammar.HIGHLIGHTS_QUERY_ECMAREGEX,
                b"(?<name>a+)\\k<name>",
                "pattern",
            ),
            (
                "ecmaregex_u",
                grammar.language_ecmaregex_u,
                grammar.HIGHLIGHTS_QUERY_ECMAREGEX_U,
                b"\\u{1F600}",
                "pattern",
            ),
            (
                "ecmaregex_v",
                grammar.language_ecmaregex_v,
                grammar.HIGHLIGHTS_QUERY_ECMAREGEX_V,
                b"[\\q{ab|cd}]",
                "pattern",
            ),
            (
                "pcre2",
                grammar.language_pcre2,
                grammar.HIGHLIGHTS_QUERY_PCRE2,
                b"(?<name>a+)\\k<name>",
                "pattern",
            ),
            (
                "posix_bre",
                grammar.language_posix_bre,
                grammar.HIGHLIGHTS_QUERY_POSIX_BRE,
                b"\\(a\\)\\1",
                "basic_reg_exp",
            ),
            (
                "posix_ere",
                grammar.language_posix_ere,
                grammar.HIGHLIGHTS_QUERY_POSIX_ERE,
                b"(a|b)+",
                "extended_reg_exp",
            ),
            (
                "pyregex",
                grammar.language_pyregex,
                grammar.HIGHLIGHTS_QUERY_PYREGEX,
                b"(?P<name>a+)(?P=name)",
                "pattern",
            ),
            (
                "pyregex_verbose",
                grammar.language_pyregex_verbose,
                grammar.HIGHLIGHTS_QUERY_PYREGEX_VERBOSE,
                b"a # comment\n b",
                "pattern",
            ),
        ]:
            with self.subTest(language=name):
                capsule = factory()
                self.assertIsInstance(capsule, CapsuleType)
                language = Language(capsule)
                self.assertEqual(language.name, name)
                parser = Parser(language)
                tree = parser.parse(source)
                self.assertEqual(tree.root_node.type, root)
                self.assertFalse(tree.root_node.has_error)
                self.assertEqual(tree.root_node.text, source)
                query = Query(language, highlights)
                tree = parser.parse(b"a")
                captures = QueryCursor(query).captures(tree.root_node)
                self.assertEqual(
                    [node.text for node in captures["string.regexp"]], [b"a"]
                )


if __name__ == "__main__":
    unittest.main()
