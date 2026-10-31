use konomanoasa_tree_sitter_regex as grammar;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

#[test]
fn parses_valid_source() {
  for (language, node_types, highlights, source, root_kind) in [
    (
      grammar::LANGUAGE_ECMAREGEX,
      grammar::NODE_TYPES_ECMAREGEX,
      grammar::HIGHLIGHTS_QUERY_ECMAREGEX,
      r"(?<name>a+)\k<name>",
      "pattern",
    ),
    (
      grammar::LANGUAGE_ECMAREGEX_U,
      grammar::NODE_TYPES_ECMAREGEX_U,
      grammar::HIGHLIGHTS_QUERY_ECMAREGEX_U,
      r"\u{1F600}",
      "pattern",
    ),
    (
      grammar::LANGUAGE_ECMAREGEX_V,
      grammar::NODE_TYPES_ECMAREGEX_V,
      grammar::HIGHLIGHTS_QUERY_ECMAREGEX_V,
      r"[\q{ab|cd}]",
      "pattern",
    ),
    (
      grammar::LANGUAGE_PCRE2,
      grammar::NODE_TYPES_PCRE2,
      grammar::HIGHLIGHTS_QUERY_PCRE2,
      r"(?<name>a+)\k<name>",
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
      grammar::LANGUAGE_PYREGEX,
      grammar::NODE_TYPES_PYREGEX,
      grammar::HIGHLIGHTS_QUERY_PYREGEX,
      "(?P<name>a+)(?P=name)",
      "pattern",
    ),
    (
      grammar::LANGUAGE_PYREGEX_VERBOSE,
      grammar::NODE_TYPES_PYREGEX_VERBOSE,
      grammar::HIGHLIGHTS_QUERY_PYREGEX_VERBOSE,
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
    let query = Query::new(&language, highlights).unwrap();
    let sample = parser.parse("a", None).unwrap();
    let mut cursor = QueryCursor::new();
    let mut captures =
      cursor.captures(&query, sample.root_node(), b"a".as_slice());
    let mut literals = Vec::new();
    while let Some((matched, index)) = captures.next() {
      let capture = matched.captures()[*index];
      if query.capture_names()[capture.index as usize] == "string.regexp" {
        literals.push((capture.node.start_byte(), capture.node.end_byte()));
      }
    }
    assert_eq!(literals, [(0, 1)]);
  }
}
