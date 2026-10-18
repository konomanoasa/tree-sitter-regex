# tree-sitter-regex

[![CI](https://github.com/konomanoasa/tree-sitter-regex/actions/workflows/ci.yaml/badge.svg)](https://github.com/konomanoasa/tree-sitter-regex/actions/workflows/ci.yaml)
[![crates.io](https://img.shields.io/crates/v/konomanoasa-tree-sitter-regex)](https://crates.io/crates/konomanoasa-tree-sitter-regex)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-regex)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-regex)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammars for
ECMAScript 2026 regular expressions, PCRE2 10.49, POSIX.1-2024 BRE/ERE,
and Python 3.14 `re`.

## Installation

```sh
npm install @konomanoasa/tree-sitter-regex
```

## Grammars

Syntax differs across languages and options, so separate grammars are provided.

| Grammar             | Description                             |
| ------------------- | --------------------------------------- |
| `js_regex`          | ECMAScript 2026, neither `u` nor `v`    |
| `js_regex_u`        | ECMAScript 2026, `u`                    |
| `js_regex_v`        | ECMAScript 2026, `v`                    |
| `pcre2`             | PCRE2 10.49                             |
| `posix_bre`         | POSIX.1-2024 BRE                        |
| `posix_ere`         | POSIX.1-2024 ERE                        |
| `python_re`         | Python 3.14, initial `VERBOSE` disabled |
| `python_re_verbose` | Python 3.14, initial `VERBOSE` enabled  |

## Development

Development uses Node.js 24.21.0 or later.

```sh
npm install
npm run build
npm test
```

## Specifications

- [ECMAScript 2026 regular expression patterns](https://tc39.es/ecma262/2026/multipage/text-processing.html#sec-patterns)
- [ECMAScript 2026 regular expression literals](https://tc39.es/ecma262/2026/multipage/ecmascript-language-lexical-grammar.html#sec-literals-regular-expression-literals)
- [ECMAScript 2026 Annex B regular expression patterns](https://tc39.es/ecma262/2026/multipage/additional-ecmascript-features-for-web-browsers.html#sec-regular-expressions-patterns)
- [PCRE2 10.49 pattern syntax](https://raw.githubusercontent.com/PCRE2Project/pcre2/pcre2-10.49/doc/pcre2pattern.3)
- [PCRE2 10.49 API options](https://raw.githubusercontent.com/PCRE2Project/pcre2/pcre2-10.49/doc/pcre2api.3)
- [POSIX.1-2024 regular expressions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap09.html)
- [Python 3.14 regular expression syntax](https://docs.python.org/3.14/library/re.html#regular-expression-syntax)
- [Python 3.14 string and bytes literals](https://docs.python.org/3.14/reference/lexical_analysis.html#string-and-bytes-literals)

## Licenses

- [MIT](LICENSE)
- [Unicode License V3](LICENSE-UNICODE) (Unicode data)
