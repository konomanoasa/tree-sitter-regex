use tree_sitter_language::LanguageFn;

unsafe extern "C" {
  fn tree_sitter_js_regex() -> *const ();
  fn tree_sitter_js_regex_u() -> *const ();
  fn tree_sitter_js_regex_v() -> *const ();
  fn tree_sitter_pcre2() -> *const ();
  fn tree_sitter_posix_bre() -> *const ();
  fn tree_sitter_posix_ere() -> *const ();
  fn tree_sitter_python_re() -> *const ();
  fn tree_sitter_python_re_verbose() -> *const ();
}

pub const LANGUAGE_JS: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_js_regex) };

pub const LANGUAGE_JS_U: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_js_regex_u) };

pub const LANGUAGE_JS_V: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_js_regex_v) };

pub const LANGUAGE_PCRE2: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_pcre2) };

pub const LANGUAGE_POSIX_BRE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_posix_bre) };

pub const LANGUAGE_POSIX_ERE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_posix_ere) };

pub const LANGUAGE_PYTHON: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_python_re) };

pub const LANGUAGE_PYTHON_VERBOSE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_python_re_verbose) };

pub const NODE_TYPES_JS: &str =
  include_str!("../../javascript/regex/src/node-types.json");

pub const NODE_TYPES_JS_U: &str =
  include_str!("../../javascript/regex_u/src/node-types.json");

pub const NODE_TYPES_JS_V: &str =
  include_str!("../../javascript/regex_v/src/node-types.json");

pub const NODE_TYPES_POSIX_BRE: &str =
  include_str!("../../posix/bre/src/node-types.json");

pub const NODE_TYPES_POSIX_ERE: &str =
  include_str!("../../posix/ere/src/node-types.json");

pub const NODE_TYPES_PYTHON: &str =
  include_str!("../../python/re/src/node-types.json");

pub const NODE_TYPES_PYTHON_VERBOSE: &str =
  include_str!("../../python/re_verbose/src/node-types.json");

pub const HIGHLIGHTS_QUERY_JS: &str =
  include_str!("../../javascript/regex/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_JS_U: &str =
  include_str!("../../javascript/regex_u/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_JS_V: &str =
  include_str!("../../javascript/regex_v/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_POSIX_BRE: &str =
  include_str!("../../posix/bre/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_POSIX_ERE: &str =
  include_str!("../../posix/ere/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_PYTHON: &str =
  include_str!("../../python/re/queries/highlights.scm");

pub const HIGHLIGHTS_QUERY_PYTHON_VERBOSE: &str =
  include_str!("../../python/re_verbose/queries/highlights.scm");

pub const NODE_TYPES_PCRE2: &str =
  include_str!("../../pcre2/src/node-types.json");
pub const HIGHLIGHTS_QUERY_PCRE2: &str =
  include_str!("../../pcre2/queries/highlights.scm");
