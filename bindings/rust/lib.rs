use tree_sitter_language::LanguageFn;

unsafe extern "C" {
  fn tree_sitter_javascript_regex() -> *const ();
  fn tree_sitter_javascript_regex_u() -> *const ();
  fn tree_sitter_javascript_regex_v() -> *const ();
  fn tree_sitter_posix_bre() -> *const ();
  fn tree_sitter_posix_ere() -> *const ();
  fn tree_sitter_python_re() -> *const ();
  fn tree_sitter_python_re_verbose() -> *const ();
}

pub const LANGUAGE_JAVASCRIPT: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_javascript_regex) };

pub const LANGUAGE_JAVASCRIPT_U: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_javascript_regex_u) };

pub const LANGUAGE_JAVASCRIPT_V: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_javascript_regex_v) };

pub const LANGUAGE_POSIX_BRE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_posix_bre) };

pub const LANGUAGE_POSIX_ERE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_posix_ere) };

pub const LANGUAGE_PYTHON: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_python_re) };

pub const LANGUAGE_PYTHON_VERBOSE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_python_re_verbose) };

pub const NODE_TYPES_JAVASCRIPT: &str =
  include_str!("../../javascript_regex/src/node-types.json");

pub const NODE_TYPES_JAVASCRIPT_U: &str =
  include_str!("../../javascript_regex_u/src/node-types.json");

pub const NODE_TYPES_JAVASCRIPT_V: &str =
  include_str!("../../javascript_regex_v/src/node-types.json");

pub const NODE_TYPES_POSIX_BRE: &str =
  include_str!("../../posix_bre/src/node-types.json");

pub const NODE_TYPES_POSIX_ERE: &str =
  include_str!("../../posix_ere/src/node-types.json");

pub const NODE_TYPES_PYTHON: &str =
  include_str!("../../python_re/src/node-types.json");

pub const NODE_TYPES_PYTHON_VERBOSE: &str =
  include_str!("../../python_re_verbose/src/node-types.json");

pub const HIGHLIGHTS_QUERY_JAVASCRIPT: &str =
  include_str!("../../javascript_regex/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_JAVASCRIPT_U: &str =
  include_str!("../../javascript_regex_u/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_JAVASCRIPT_V: &str =
  include_str!("../../javascript_regex_v/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_POSIX_BRE: &str =
  include_str!("../../posix_bre/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_POSIX_ERE: &str =
  include_str!("../../posix_ere/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_PYTHON: &str =
  include_str!("../../python_re/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_PYTHON_VERBOSE: &str =
  include_str!("../../python_re_verbose/queries/highlights.scm");
