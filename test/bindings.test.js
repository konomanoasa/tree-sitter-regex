import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ecmaregex,
  ecmaregex_u,
  ecmaregex_v,
  pcre2,
  posix_bre,
  posix_ere,
  pyregex,
  pyregex_verbose,
} from "@konomanoasa/tree-sitter-regex";
import Parser from "tree-sitter";

const cases = [
  {
    name: "ecmaregex",
    language: ecmaregex,
    source: String.raw`(?<name>a+)\k<name>`,
    rootType: "pattern",
  },
  {
    name: "ecmaregex_u",
    language: ecmaregex_u,
    source: String.raw`\u{1F600}`,
    rootType: "pattern",
  },
  {
    name: "ecmaregex_v",
    language: ecmaregex_v,
    source: String.raw`[\q{ab|cd}]`,
    rootType: "pattern",
  },
  {
    name: "pcre2",
    language: pcre2,
    source: String.raw`(?<name>a+)\k<name>`,
    rootType: "pattern",
  },
  {
    name: "posix_bre",
    language: posix_bre,
    source: String.raw`\(a\)\1`,
    rootType: "basic_reg_exp",
  },
  {
    name: "posix_ere",
    language: posix_ere,
    source: "(a|b)+",
    rootType: "extended_reg_exp",
  },
  {
    name: "pyregex",
    language: pyregex,
    source: "(?P<name>a+)(?P=name)",
    rootType: "pattern",
  },
  {
    name: "pyregex_verbose",
    language: pyregex_verbose,
    source: "a # comment\n b",
    rootType: "pattern",
  },
];

for (const { name, language, source, rootType } of cases) {
  test(`Node.js ${name} parses its syntax and exposes node metadata and highlights`, () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);
    assert.equal(tree.rootNode.type, rootType);
    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.text, source);
    assert.ok(
      language.nodeTypeInfo.some(
        (node) => node.type === rootType && node.named,
      ),
    );
    const query = new Parser.Query(language, language.HIGHLIGHTS_QUERY);
    const sample = parser.parse("a");
    assert.deepEqual(
      query
        .captures(sample.rootNode)
        .filter(({ name }) => name === "string.regexp")
        .map(({ name, node }) => [name, node.text]),
      [["string.regexp", "a"]],
    );
  });
}
