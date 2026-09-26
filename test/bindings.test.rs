use konomanoasa_tree_sitter_regex as grammar;
use tree_sitter::{Language, Parser, Query};

#[test]
fn parses_valid_source() {
  for (language, node_types, highlights, source, root_kind) in [
    (
      grammar::LANGUAGE_JAVASCRIPT,
      grammar::NODE_TYPES_JAVASCRIPT,
      grammar::HIGHLIGHTS_QUERY_JAVASCRIPT,
      r"(?<name>a+)\k<name>",
      "pattern",
    ),
    (
      grammar::LANGUAGE_JAVASCRIPT_U,
      grammar::NODE_TYPES_JAVASCRIPT_U,
      grammar::HIGHLIGHTS_QUERY_JAVASCRIPT_U,
      r"\u{1F600}",
      "pattern",
    ),
    (
      grammar::LANGUAGE_JAVASCRIPT_V,
      grammar::NODE_TYPES_JAVASCRIPT_V,
      grammar::HIGHLIGHTS_QUERY_JAVASCRIPT_V,
      r"[\q{ab|cd}]",
      "pattern",
    ),
    (
      grammar::LANGUAGE_POSIX_BRE,
      grammar::NODE_TYPES_POSIX_BRE,
      grammar::HIGHLIGHTS_QUERY_POSIX_BRE,
      r"\(a\)\1",
      "basic_reg_exp",
    ),
    (
      grammar::LANGUAGE_POSIX_ERE,
      grammar::NODE_TYPES_POSIX_ERE,
      grammar::HIGHLIGHTS_QUERY_POSIX_ERE,
      "(a|b)+",
      "extended_reg_exp",
    ),
    (
      grammar::LANGUAGE_PYTHON,
      grammar::NODE_TYPES_PYTHON,
      grammar::HIGHLIGHTS_QUERY_PYTHON,
      "(?P<name>a+)(?P=name)",
      "pattern",
    ),
    (
      grammar::LANGUAGE_PYTHON_VERBOSE,
      grammar::NODE_TYPES_PYTHON_VERBOSE,
      grammar::HIGHLIGHTS_QUERY_PYTHON_VERBOSE,
      "a # comment\n b",
      "pattern",
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
    assert!(node_types.contains(&format!("\"{root_kind}\"")), "{source}");
    Query::new(&language, highlights).unwrap();
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
