use tree_sitter::{Language, Parser, Query};
use tree_sitter_regex as grammar;

#[test]
fn parses_valid_source_and_compiles_highlights_for_each_grammar() {
  for (language, source, root_kind, query) in [
    (
      grammar::LANGUAGE_JAVASCRIPT,
      r"(?<name>a+)\k<name>",
      "pattern",
      grammar::HIGHLIGHTS_QUERY_JAVASCRIPT,
    ),
    (
      grammar::LANGUAGE_JAVASCRIPT_U,
      r"\u{1F600}",
      "pattern",
      grammar::HIGHLIGHTS_QUERY_JAVASCRIPT_U,
    ),
    (
      grammar::LANGUAGE_JAVASCRIPT_V,
      r"[\q{ab|cd}]",
      "pattern",
      grammar::HIGHLIGHTS_QUERY_JAVASCRIPT_V,
    ),
    (
      grammar::LANGUAGE_POSIX_BRE,
      r"\(a\)\1",
      "basic_reg_exp",
      grammar::HIGHLIGHTS_QUERY_POSIX_BRE,
    ),
    (
      grammar::LANGUAGE_POSIX_ERE,
      "(a|b)+",
      "extended_reg_exp",
      grammar::HIGHLIGHTS_QUERY_POSIX_ERE,
    ),
    (
      grammar::LANGUAGE_PYTHON,
      "(?P<name>a+)(?P=name)",
      "pattern",
      grammar::HIGHLIGHTS_QUERY_PYTHON,
    ),
    (
      grammar::LANGUAGE_PYTHON_VERBOSE,
      "a # comment\n b",
      "pattern",
      grammar::HIGHLIGHTS_QUERY_PYTHON_VERBOSE,
    ),
  ] {
    let language = language.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let tree = parser.parse(source, None).unwrap();
    let root = tree.root_node();
    assert_eq!(root.kind(), root_kind, "{source}");
    assert_eq!(root.byte_range(), 0..source.len(), "{source}");
    assert!(!root.has_error(), "{source}");
    Query::new(&language, query).unwrap();
  }
}

#[test]
fn uses_distinct_grammars() {
  let languages = [
    grammar::LANGUAGE_JAVASCRIPT,
    grammar::LANGUAGE_JAVASCRIPT_U,
    grammar::LANGUAGE_JAVASCRIPT_V,
    grammar::LANGUAGE_POSIX_BRE,
    grammar::LANGUAGE_POSIX_ERE,
    grammar::LANGUAGE_PYTHON,
    grammar::LANGUAGE_PYTHON_VERBOSE,
  ]
  .map(Language::new);
  for (index, language) in languages.iter().enumerate() {
    for other in &languages[index + 1..] {
      assert_ne!(language, other);
    }
  }
}
