use tree_sitter_language::LanguageFn;

unsafe extern "C" {
  fn tree_sitter_ecmaregex() -> *const ();
  fn tree_sitter_ecmaregex_u() -> *const ();
  fn tree_sitter_ecmaregex_v() -> *const ();
  fn tree_sitter_pcre2() -> *const ();
  fn tree_sitter_posix_bre() -> *const ();
  fn tree_sitter_posix_ere() -> *const ();
  fn tree_sitter_pyregex() -> *const ();
  fn tree_sitter_pyregex_verbose() -> *const ();
}

pub const LANGUAGE_ECMAREGEX: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_ecmaregex) };
pub const NODE_TYPES_ECMAREGEX: &str =
  include_str!("../../ecmascript/ecmaregex/src/node-types.json");
pub const HIGHLIGHTS_QUERY_ECMAREGEX: &str =
  include_str!("../../ecmascript/ecmaregex/queries/highlights.scm");

pub const LANGUAGE_ECMAREGEX_U: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_ecmaregex_u) };
pub const NODE_TYPES_ECMAREGEX_U: &str =
  include_str!("../../ecmascript/ecmaregex_u/src/node-types.json");
pub const HIGHLIGHTS_QUERY_ECMAREGEX_U: &str =
  include_str!("../../ecmascript/ecmaregex_u/queries/highlights.scm");

pub const LANGUAGE_ECMAREGEX_V: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_ecmaregex_v) };
pub const NODE_TYPES_ECMAREGEX_V: &str =
  include_str!("../../ecmascript/ecmaregex_v/src/node-types.json");
pub const HIGHLIGHTS_QUERY_ECMAREGEX_V: &str =
  include_str!("../../ecmascript/ecmaregex_v/queries/highlights.scm");

pub const LANGUAGE_PCRE2: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_pcre2) };
pub const NODE_TYPES_PCRE2: &str =
  include_str!("../../pcre2/src/node-types.json");
pub const HIGHLIGHTS_QUERY_PCRE2: &str =
  include_str!("../../pcre2/queries/highlights.scm");

pub const LANGUAGE_POSIX_BRE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_posix_bre) };
pub const NODE_TYPES_POSIX_BRE: &str =
  include_str!("../../posix/bre/src/node-types.json");
pub const HIGHLIGHTS_QUERY_POSIX_BRE: &str =
  include_str!("../../posix/bre/queries/highlights.scm");

pub const LANGUAGE_POSIX_ERE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_posix_ere) };
pub const NODE_TYPES_POSIX_ERE: &str =
  include_str!("../../posix/ere/src/node-types.json");
pub const HIGHLIGHTS_QUERY_POSIX_ERE: &str =
  include_str!("../../posix/ere/queries/highlights.scm");

pub const LANGUAGE_PYREGEX: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_pyregex) };
pub const NODE_TYPES_PYREGEX: &str =
  include_str!("../../python/pyregex/src/node-types.json");
pub const HIGHLIGHTS_QUERY_PYREGEX: &str =
  include_str!("../../python/pyregex/queries/highlights.scm");

pub const LANGUAGE_PYREGEX_VERBOSE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_pyregex_verbose) };
pub const NODE_TYPES_PYREGEX_VERBOSE: &str =
  include_str!("../../python/pyregex_verbose/src/node-types.json");
pub const HIGHLIGHTS_QUERY_PYREGEX_VERBOSE: &str =
  include_str!("../../python/pyregex_verbose/queries/highlights.scm");
