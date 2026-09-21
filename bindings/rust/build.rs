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

  for (directory, library) in [
    ("javascript_regex/src", "tree-sitter-javascript-regex"),
    ("javascript_regex_u/src", "tree-sitter-javascript-regex-u"),
    ("javascript_regex_v/src", "tree-sitter-javascript-regex-v"),
    ("posix_bre/src", "tree-sitter-posix-bre"),
    ("posix_ere/src", "tree-sitter-posix-ere"),
    ("python_re/src", "tree-sitter-python-re"),
    ("python_re_verbose/src", "tree-sitter-python-re-verbose"),
  ] {
    println!("cargo::rerun-if-changed={directory}");
    let directory = Path::new(directory);
    build
      .clone()
      .include(directory)
      .files([directory.join("parser.c"), directory.join("scanner.c")])
      .compile(library);
  }
  println!("cargo::rerun-if-changed=common/javascript/scanner.h");
  println!("cargo::rerun-if-changed=common/posix/scanner.h");
  println!("cargo::rerun-if-changed=common/python/scanner.h");
  println!("cargo::rerun-if-changed=common/scanner.h");
}
