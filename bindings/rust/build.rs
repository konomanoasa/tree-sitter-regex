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

  let grammars = [
    ("ecmascript/ecmaregex/src", "tree-sitter-ecmaregex"),
    ("ecmascript/ecmaregex_u/src", "tree-sitter-ecmaregex-u"),
    ("ecmascript/ecmaregex_v/src", "tree-sitter-ecmaregex-v"),
    ("pcre2/src", "tree-sitter-pcre2"),
    ("posix/bre/src", "tree-sitter-posix-bre"),
    ("posix/ere/src", "tree-sitter-posix-ere"),
    ("python/pyregex/src", "tree-sitter-pyregex"),
    ("python/pyregex_verbose/src", "tree-sitter-pyregex-verbose"),
  ];
  for (directory, _) in grammars {
    println!("cargo::rerun-if-changed={directory}");
  }
  for header in [
    "ecmascript/common/scanner.h",
    "posix/common/scanner.h",
    "python/common/scanner.h",
  ] {
    println!("cargo::rerun-if-changed={header}");
  }

  for (directory, library) in grammars {
    let directory = Path::new(directory);
    build
      .clone()
      .include(directory)
      .files([directory.join("parser.c"), directory.join("scanner.c")])
      .compile(library);
  }
}
