use std::{env, path::Path};

fn main() {
  let mut build = cc::Build::new();
  build.std("c17");
  if build.get_compiler().is_like_msvc() {
    build.flag("-utf-8");
  }
  if env::var("TARGET").expect("Cargo must provide TARGET")
    == "wasm32-unknown-unknown"
  {
    let headers = env::var_os("DEP_TREE_SITTER_LANGUAGE_WASM_HEADERS")
      .expect("tree-sitter-language must provide WebAssembly headers");
    build.include(&headers);
    println!("cargo::rerun-if-changed={}", Path::new(&headers).display());
  }

  for (name, path) in [
    ("js_regex", "javascript/regex"),
    ("js_regex_u", "javascript/regex_u"),
    ("js_regex_v", "javascript/regex_v"),
    ("pcre2", "pcre2"),
    ("posix_bre", "posix/bre"),
    ("posix_ere", "posix/ere"),
    ("python_re", "python/re"),
    ("python_re_verbose", "python/re_verbose"),
  ] {
    let directory = format!("{path}/src");
    let library = format!("tree-sitter-{}", name.replace('_', "-"));
    println!("cargo::rerun-if-changed={directory}");
    let directory = Path::new(&directory);
    build
      .clone()
      .include(directory)
      .files([directory.join("parser.c"), directory.join("scanner.c")])
      .compile(&library);
  }
  println!("cargo::rerun-if-changed=javascript/common/scanner.h");
  println!("cargo::rerun-if-changed=posix/common/scanner.h");
  println!("cargo::rerun-if-changed=python/common/scanner.h");
}
