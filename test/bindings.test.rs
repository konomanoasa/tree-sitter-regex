use konomanoasa_tree_sitter_regex as grammar;
use std::ops::ControlFlow;
use tree_sitter::{
  InputEdit, Language, ParseOptions, ParseState, Parser, Point, Query,
};

#[test]
fn parses_valid_source() {
  for (language, node_types, highlights, source, root_kind) in [
    (
      grammar::LANGUAGE_JS,
      grammar::NODE_TYPES_JS,
      grammar::HIGHLIGHTS_QUERY_JS,
      r"(?<name>a+)\k<name>",
      "pattern",
    ),
    (
      grammar::LANGUAGE_JS_U,
      grammar::NODE_TYPES_JS_U,
      grammar::HIGHLIGHTS_QUERY_JS_U,
      r"\u{1F600}",
      "pattern",
    ),
    (
      grammar::LANGUAGE_JS_V,
      grammar::NODE_TYPES_JS_V,
      grammar::HIGHLIGHTS_QUERY_JS_V,
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
    (
      grammar::LANGUAGE_PCRE2,
      grammar::NODE_TYPES_PCRE2,
      grammar::HIGHLIGHTS_QUERY_PCRE2,
      r"(?<name>a+)\k<name>",
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
fn posix_group_and_repetition_fields_resolve_to_direct_children() {
  for (language, source, expected) in [
    (
      grammar::LANGUAGE_POSIX_BRE,
      r"\(\)",
      vec![
        ("nondupl_bre", "opening", 0..2),
        ("nondupl_bre", "closing", 2..4),
      ],
    ),
    (
      grammar::LANGUAGE_POSIX_BRE,
      r"\(\(a\)\)\{2,3\}",
      vec![
        ("nondupl_bre", "opening", 0..2),
        ("nondupl_bre", "expression", 2..7),
        ("nondupl_bre", "closing", 7..9),
        ("nondupl_bre", "opening", 2..4),
        ("nondupl_bre", "expression", 4..5),
        ("nondupl_bre", "closing", 5..7),
        ("bre_dupl_symbol", "minimum", 11..12),
        ("bre_dupl_symbol", "maximum", 13..14),
      ],
    ),
    (
      grammar::LANGUAGE_POSIX_ERE,
      "()",
      vec![
        ("ere_expression", "opening", 0..1),
        ("ere_expression", "closing", 1..2),
      ],
    ),
    (
      grammar::LANGUAGE_POSIX_ERE,
      "((a)){2,3}?",
      vec![
        ("ere_expression", "opening", 0..1),
        ("ere_expression", "expression", 1..4),
        ("ere_expression", "closing", 4..5),
        ("ere_expression", "opening", 1..2),
        ("ere_expression", "expression", 2..3),
        ("ere_expression", "closing", 3..4),
        ("ere_dupl_symbol", "minimum", 6..7),
        ("ere_dupl_symbol", "maximum", 8..9),
        ("ere_dupl_symbol", "modifier", 10..11),
      ],
    ),
  ] {
    let mut parser = Parser::new();
    parser.set_language(&language.into()).unwrap();
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error(), "{source}");
    let mut pending = vec![tree.root_node()];
    let mut fields = Vec::new();
    while let Some(node) = pending.pop() {
      let mut cursor = node.walk();
      let mut children = Vec::new();
      if cursor.goto_first_child() {
        loop {
          let child = cursor.node();
          if let Some(field) = cursor.field_name() {
            assert_eq!(
              node.child_by_field_name(field),
              Some(child),
              "{source}"
            );
            assert_eq!(child.parent(), Some(node), "{source}");
            fields.push((node.kind(), field, child.byte_range()));
          }
          children.push(child);
          if !cursor.goto_next_sibling() {
            break;
          }
        }
      }
      pending.extend(children.into_iter().rev());
    }
    assert_eq!(fields, expected, "{source}");
  }
}

#[test]
fn pcre2_name_and_decimal_leaves_are_nonempty_unless_missing() {
  let mut parser = Parser::new();
  parser
    .set_language(&grammar::LANGUAGE_PCRE2.into())
    .unwrap();
  for source in [
    r"(?<name>a){012}(?(VERSION=1001.01001)b)\k<name>",
    r"\k<>",
    "(?<>a)",
    "(*LIMIT_MATCH=)",
    "(?(VERSION=)a)",
    "(?(VERSION=10.)a)",
  ] {
    let tree = parser.parse(source, None).unwrap();
    let mut pending = vec![tree.root_node()];
    while let Some(node) = pending.pop() {
      if matches!(node.kind(), "group_name" | "decimal_digits") {
        assert_eq!(node.child_count(), 0, "{source}: {}", node.kind());
        assert_eq!(
          node.byte_range().is_empty(),
          node.is_missing(),
          "{source}: {}",
          node.kind()
        );
      }
      pending.extend(node.children(&mut node.walk()));
    }
  }
}

#[test]
fn fresh_parse_after_prefix_deletion_excludes_the_new_initial_bom() {
  let edited_source = "\u{feff}a";
  for (language, prefix) in [
    (grammar::LANGUAGE_POSIX_ERE, "a|"),
    (grammar::LANGUAGE_JS_U, "a|"),
    (grammar::LANGUAGE_JS_V, "a|"),
    (grammar::LANGUAGE_PYTHON, "a|"),
    (grammar::LANGUAGE_PYTHON_VERBOSE, "a|"),
    (grammar::LANGUAGE_PCRE2, "^"),
  ] {
    let source = format!("{prefix}{edited_source}");
    let mut parser = Parser::new();
    parser.set_language(&language.into()).unwrap();
    let mut old_tree = parser.parse(&source, None).unwrap();
    assert!(!old_tree.root_node().has_error());
    old_tree.edit(&InputEdit {
      start_byte: 0,
      old_end_byte: prefix.len(),
      new_end_byte: 0,
      start_position: Point::new(0, 0),
      old_end_position: Point::new(0, prefix.len()),
      new_end_position: Point::new(0, 0),
    });

    let tree = parser.parse(edited_source, None).unwrap();
    assert!(!tree.root_node().has_error());
    let mut pending = vec![tree.root_node()];
    let mut leaves = Vec::new();
    while let Some(node) = pending.pop() {
      assert_eq!(node.byte_range(), 3..4);
      assert_eq!(node.start_position(), Point::new(0, 3));
      assert_eq!(node.end_position(), Point::new(0, 4));
      if node.child_count() == 0 {
        leaves.push(node.utf8_text(edited_source.as_bytes()).unwrap());
      }
      pending.extend(node.children(&mut node.walk()));
    }
    assert_eq!(leaves, ["a"]);
  }
}

#[test]
fn python_alternations_resumed_after_cancels_match_uninterrupted_parses() {
  for language in [grammar::LANGUAGE_PYTHON, grammar::LANGUAGE_PYTHON_VERBOSE] {
    let mut parser = Parser::new();
    parser.set_language(&language.into()).unwrap();
    let mut cancels = 0;
    for count in 2..=64 {
      let alternatives = vec!["a"; count].join("|");
      for source in [format!("x{alternatives}"), format!("({alternatives})")] {
        let expected = parser.parse(&source, None).unwrap();
        assert!(!expected.root_node().has_error(), "{source}");
        let bytes = source.as_bytes();
        let tree = loop {
          let mut cancel = |_: &ParseState| {
            cancels += 1;
            ControlFlow::Break(())
          };
          if let Some(tree) = parser.parse_with_options(
            &mut |byte, _| bytes.get(byte..).unwrap_or_default(),
            None,
            Some(ParseOptions::new().progress_callback(&mut cancel)),
          ) {
            break tree;
          }
        };
        assert_eq!(
          tree.root_node().to_sexp(),
          expected.root_node().to_sexp(),
          "{source}"
        );
      }
    }
    assert!(cancels > 0);
  }
}

#[test]
fn uses_distinct_grammars() {
  let languages = [
    grammar::LANGUAGE_JS,
    grammar::LANGUAGE_JS_U,
    grammar::LANGUAGE_JS_V,
    grammar::LANGUAGE_POSIX_BRE,
    grammar::LANGUAGE_POSIX_ERE,
    grammar::LANGUAGE_PYTHON,
    grammar::LANGUAGE_PYTHON_VERBOSE,
    grammar::LANGUAGE_PCRE2,
  ]
  .map(Language::new);
  for (index, language) in languages.iter().enumerate() {
    for other in &languages[index + 1..] {
      assert_ne!(language, other);
    }
  }
}
