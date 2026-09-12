# tree-sitter-regex

[![CI](https://github.com/konomanoasa/tree-sitter-regex/actions/workflows/ci.yml/badge.svg)](https://github.com/konomanoasa/tree-sitter-regex/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-regex)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-regex)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammars for
ECMAScript 2026 regular expression literal bodies (`/.../`) and Python 3.14
`re` patterns in raw `str` literals.

## Grammars

This repository contains the following five grammars.

| Grammar | Mode |
| --- | --- |
| `javascript_regex` | Neither `u` nor `v` |
| `javascript_regex_u` | `u` |
| `javascript_regex_v` | `v` |
| `python_re` | Initial `VERBOSE` disabled |
| `python_re_verbose` | Initial `VERBOSE` enabled |

## Installation

```sh
npm install @konomanoasa/tree-sitter-regex
```

## Development

```sh
npm install
npm run parse:javascript -- pattern.txt
npm run parse:javascript:u -- pattern.txt
npm run parse:javascript:v -- pattern.txt
npm run parse:python -- pattern.txt
npm run parse:python:verbose -- pattern.txt
```

## Specifications

- [ECMAScript 2026 regular expression patterns](https://tc39.es/ecma262/2026/multipage/text-processing.html#sec-patterns)
- [ECMAScript 2026 regular expression literals](https://tc39.es/ecma262/2026/multipage/ecmascript-language-lexical-grammar.html#sec-literals-regular-expression-literals)
- [ECMAScript 2026 Annex B regular expression patterns](https://tc39.es/ecma262/2026/multipage/additional-ecmascript-features-for-web-browsers.html#sec-regular-expressions-patterns)
- [Python 3.14 regular expression syntax](https://docs.python.org/3.14/library/re.html#regular-expression-syntax)
- [Python 3.14 string and bytes literals](https://docs.python.org/3.14/reference/lexical_analysis.html#string-and-bytes-literals)

## License

[MIT](LICENSE)

Unicode data: [Unicode License V3](LICENSE-UNICODE)
