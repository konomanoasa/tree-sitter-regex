import sys
from pathlib import Path

from setuptools import Extension, setup

Path("dist/metadata").mkdir(parents=True, exist_ok=True)

setup(
    options={
        "build": {"build_base": "dist/build"},
        "egg_info": {"egg_base": "dist/metadata"},
    },
    ext_modules=[
        Extension(
            "tree_sitter_regex.binding",
            sources=[
                "bindings/python/binding.c",
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
                "python/pyregex_verbose/src/scanner.c",
            ],
            include_dirs=[
                "ecmascript/ecmaregex/src",
                "ecmascript/ecmaregex_u/src",
                "ecmascript/ecmaregex_v/src",
                "pcre2/src",
                "posix/bre/src",
                "posix/ere/src",
                "python/pyregex/src",
                "python/pyregex_verbose/src",
            ],
            depends=[
                "ecmascript/common/scanner.h",
                "ecmascript/ecmaregex/src/tree_sitter/alloc.h",
                "ecmascript/ecmaregex/src/tree_sitter/array.h",
                "ecmascript/ecmaregex/src/tree_sitter/parser.h",
                "ecmascript/ecmaregex_u/src/tree_sitter/alloc.h",
                "ecmascript/ecmaregex_u/src/tree_sitter/array.h",
                "ecmascript/ecmaregex_u/src/tree_sitter/parser.h",
                "ecmascript/ecmaregex_v/src/tree_sitter/alloc.h",
                "ecmascript/ecmaregex_v/src/tree_sitter/array.h",
                "ecmascript/ecmaregex_v/src/tree_sitter/parser.h",
                "pcre2/src/tree_sitter/alloc.h",
                "pcre2/src/tree_sitter/array.h",
                "pcre2/src/tree_sitter/parser.h",
                "posix/bre/src/tree_sitter/alloc.h",
                "posix/bre/src/tree_sitter/array.h",
                "posix/bre/src/tree_sitter/parser.h",
                "posix/common/scanner.h",
                "posix/ere/src/tree_sitter/alloc.h",
                "posix/ere/src/tree_sitter/array.h",
                "posix/ere/src/tree_sitter/parser.h",
                "python/common/scanner.h",
                "python/pyregex/src/tree_sitter/alloc.h",
                "python/pyregex/src/tree_sitter/array.h",
                "python/pyregex/src/tree_sitter/parser.h",
                "python/pyregex_verbose/src/tree_sitter/alloc.h",
                "python/pyregex_verbose/src/tree_sitter/array.h",
                "python/pyregex_verbose/src/tree_sitter/parser.h",
            ],
            extra_compile_args=["/std:c17", "/utf-8"]
            if sys.platform == "win32"
            else ["-std=c17"],
        )
    ],
)
