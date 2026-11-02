{
  "targets": [
    {
      "target_name": "tree_sitter_regex_binding",
      "sources": [
        "bindings/node/binding.cc",
        "ecmascript/ecmaregex/src/parser.c",
        "ecmascript/ecmaregex/src/scanner.c",
        "ecmascript/ecmaregex_u/src/parser.c",
        "ecmascript/ecmaregex_u/src/scanner.c",
        "ecmascript/ecmaregex_v/src/parser.c",
        "ecmascript/ecmaregex_v/src/scanner.c",
        "pcre2/src/parser.c",
        "pcre2/src/scanner.c",
        "posix/bre/src/parser.c",
        "posix/bre/src/scanner.c",
        "posix/ere/src/parser.c",
        "posix/ere/src/scanner.c",
        "python/pyregex/src/parser.c",
        "python/pyregex/src/scanner.c",
        "python/pyregex_verbose/src/parser.c",
        "python/pyregex_verbose/src/scanner.c"
      ],
      "include_dirs": [
        "ecmascript/ecmaregex/src",
        "ecmascript/ecmaregex_u/src",
        "ecmascript/ecmaregex_v/src",
        "pcre2/src",
        "posix/bre/src",
        "posix/ere/src",
        "python/pyregex/src",
        "python/pyregex_verbose/src"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except"
      ],
      "cflags_c": ["-std=c17"],
      "cflags_cc": ["-std=c++17"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/utf-8"],
          "AdditionalOptions!": ["-std:c++20"],
          "LanguageStandard": "stdcpp17",
          "LanguageStandard_C": "stdc17"
        }
      },
      "target_conditions": [
        [
          "OS==\"mac\"",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_C_LANGUAGE_STANDARD": "c17",
              "MACOSX_DEPLOYMENT_TARGET": "14.0"
            }
          }
        ]
      ]
    }
  ]
}
