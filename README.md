# tree-sitter-regex

[![CI](https://github.com/konomanoasa/tree-sitter-regex/actions/workflows/ci.yaml/badge.svg)](https://github.com/konomanoasa/tree-sitter-regex/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-regex)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-regex)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) regular expression grammars for:

- ECMAScript 2026 regular expression literal bodies (`/.../`)
- Python 3.14 `re` patterns in raw `str` literals
- POSIX.1-2024 BRE and ERE

## Installation

```sh
npm install @konomanoasa/tree-sitter-regex
```

## Grammars

This repository contains the following seven grammars.

| Grammar | Selection |
| --- | --- |
| `javascript_regex` | ECMAScript, neither `u` nor `v` |
| `javascript_regex_u` | ECMAScript, `u` |
| `javascript_regex_v` | ECMAScript, `v` |
| `posix_bre` | POSIX BRE |
| `posix_ere` | POSIX ERE |
| `python_re` | Python, initial `VERBOSE` disabled |
| `python_re_verbose` | Python, initial `VERBOSE` enabled |

## Development

```sh
npm install
npm run parse:javascript -- pattern.txt
npm run parse:javascript:u -- pattern.txt
npm run parse:javascript:v -- pattern.txt
npm run parse:posix:bre -- pattern.txt
npm run parse:posix:ere -- pattern.txt
npm run parse:python -- pattern.txt
npm run parse:python:verbose -- pattern.txt
```

## Specifications

- [ECMAScript 2026 regular expression patterns](https://tc39.es/ecma262/2026/multipage/text-processing.html#sec-patterns)
- [ECMAScript 2026 regular expression literals](https://tc39.es/ecma262/2026/multipage/ecmascript-language-lexical-grammar.html#sec-literals-regular-expression-literals)
- [ECMAScript 2026 Annex B regular expression patterns](https://tc39.es/ecma262/2026/multipage/additional-ecmascript-features-for-web-browsers.html#sec-regular-expressions-patterns)
- [POSIX.1-2024 regular expressions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap09.html)
- [Python 3.14 regular expression syntax](https://docs.python.org/3.14/library/re.html#regular-expression-syntax)
- [Python 3.14 string and bytes literals](https://docs.python.org/3.14/reference/lexical_analysis.html#string-and-bytes-literals)

## Licenses

- [MIT](LICENSE)
- [Unicode License V3](LICENSE-UNICODE) (Unicode data)
