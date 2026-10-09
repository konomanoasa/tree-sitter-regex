import assert from "node:assert/strict";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { applyEdits, parse, parseSummary } from "./support/parser.js";

const standard = grammars.find(({ name }) => name === "pcre2");

function nodes(result, type) {
  return result.rows.filter((row) => new RegExp(`(^| )${type}( |$)`).test(row));
}

test("PCRE2 constructs retain their distinct syntax nodes", () => {
  const cases = [
    ["a(b|c)*", "repetition"],
    ["(?:a)(?>b)", "atomic_group"],
    ["(?x:a b)c d", "scoped_flags_group"],
    [String.raw`\Qabc\E+`, "quote_end"],
    [String.raw`[a-z\d]`, "class_range"],
    ["[]a-]", "character_class"],
    ["[[:<:]]word[[:>:]]", "word_boundary_assertion"],
    ["[[:alpha:][:^digit:]]", "posix_character_class"],
    ["(?[ [a-z] & ![q] ])", "class_intersection"],
    [String.raw`(?[ \p{L} | (\d - [3]) ^ [a] ])`, "class_symmetric_difference"],
    [String.raw`(?<foo>a)\k<foo>`, "backreference"],
    ["(?'foo'a)(?P<bar>b)(?P=bar)", "named_capturing_group"],
    [String.raw`(?|(a)|(b)(c))\11`, "octal_escape"],
    [String.raw`\g{-1}\g2\g{name}\k'name'`, "backreference"],
    [
      String.raw`(?R)(?0)(?-1)(?+2)(?&name)(?P>name)\g<name>\g'1'`,
      "subroutine_call",
    ],
    ["(?R(1,<name>,'other'))", "group_list"],
    ["(?=a)(?!b)(?<=c)(?<!d)(?*e)(?<*f)", "non_atomic_lookbehind_assertion"],
    [
      "(*pla:a)(*nla:b)(*plb:c)(*nlb:d)(*napla:e)(*naplb:f)",
      "non_atomic_lookahead_assertion",
    ],
    ["(*atomic:a)(*sr:b)(*asr:c)", "atomic_script_run_group"],
    ["(*scs:(1,<name>)a)", "scan_substring_assertion"],
    ["(?(1)a|b)(?(name)c)(?(<name>)d)(?('name')e)", "conditional_group"],
    ["(?(R)a)(?(R1)b)(?(R&name)c)(?(DEFINE)d)", "condition_name"],
    ["(?(VERSION>=10.49)a|b)(?(?=x)y|z)", "assertion_condition"],
    ["(?(?C9)(?=a)abc|def)", "callout"],
    ["(*ACCEPT)??(*PRUNE:)(*ACCEPT:)", "repetition"],
    ["(?C)(?C123)(?C'abc''def')(?C{a}}b})", "callout_string"],
    [
      "(*ACCEPT)(*FAIL)(*F)(*COMMIT)(*PRUNE:tag)(*SKIP:tag)(*THEN)(*MARK:tag)(*:tag)",
      "control_verb",
    ],
    ["(*UTF)(*UCP)(*LIMIT_MATCH=42)(*ANYCRLF)(?x)# hello\ra", "start_option"],
    [
      String.raw`\x41\x{1F600}\o{101}\N{U+41}\p{sc: Latin}\PL`,
      "unicode_property",
    ],
    [
      String.raw`\a\e\f\n\r\t\cA\0\777\8\A\b\B\K\R\X\C\N\z`,
      "control_character_escape",
    ],
    ["a{ 2 , 4 }?b{,3}+c{4,}d{12}", "quantifier"],
    ["a{,}b{no}c{1", "literal_character"],
    ["\0\\\0😀[\0😀]", "literal_escape"],
    ["(?C'\0😀')(?#\0😀)(*MARK:\0😀)", "callout_content"],
    [
      String.raw`\x4Z\o{ 101 }\N{ U+41 }\g{ -1 }\k{ name }`,
      "escape_whitespace",
    ],
    ["\\p{\r\x0b\x0c^L\r\x0b\x0cu}", "escape_whitespace"],
  ];
  for (const [source, type] of cases) {
    const result = parse(standard, source);
    assert.equal(result.status, 0, `${source}\n${result.rows.join("\n")}`);
    assert.ok(nodes(result, type).length > 0, `${source}: missing ${type}`);
  }
});

test("PCRE2 uses standard escapes, capturing parentheses, and literal layout initially", () => {
  const quoted = parse(standard, String.raw`(?<x>a)\k<x>\Q+\E`);
  assert.equal(quoted.status, 0);
  assert.equal(nodes(quoted, "quantifier").length, 0);
  assert.equal(nodes(quoted, "literal_character").length, 2);
  const hexadecimal = parse(standard, String.raw`\x{41}`);
  assert.equal(hexadecimal.status, 0);
  assert.equal(nodes(hexadecimal, "hex_escape").length, 1);
  assert.equal(nodes(hexadecimal, "repetition").length, 0);
  const capture = parse(standard, "(a)".repeat(11) + String.raw`\118`);
  assert.equal(capture.status, 0);
  assert.equal(nodes(capture, "capturing_group").length, 11);
  assert.equal(nodes(capture, "octal_escape").length, 1);
  const eleven = parse(standard, "(a)".repeat(11) + String.raw`\11`);
  assert.equal(eleven.status, 0);
  assert.equal(nodes(eleven, "numeric_backreference").length, 1);
  const spacing = parse(standard, "a b[a b] #c\nd");
  assert.equal(spacing.status, 0, spacing.rows.join("\n"));
  assert.equal(nodes(spacing, "verbose_whitespace").length, 0);
  assert.equal(nodes(spacing, "verbose_comment").length, 0);
  assert.equal(nodes(spacing, "literal_character").length, 8);
  assert.equal(nodes(spacing, "class_character").length, 3);
});

test("PCRE2 inline option and capture changes survive edits and resets", () => {
  const cases = [
    ["(?x:a b)c d", { byte: 2, deleteBytes: 1, insert: "xx" }],
    [
      "(?n)(a)".repeat(11) + String.raw`\11`,
      { byte: 2, deleteBytes: 1, insert: "-n" },
    ],
    ["(?x)# a\nb c", { byte: 0, deleteBytes: 0, insert: "(*CR)" }],
    ["(?x)[a b] c", { byte: 2, deleteBytes: 1, insert: "xx" }],
    [String.raw`\Q(a)\E(b)\11`, { byte: 0, deleteBytes: 2, insert: "" }],
    [
      "(?|(a)|(b)(c))(d)".repeat(4) + String.raw`\11`,
      { byte: 2, deleteBytes: 1, insert: ":" },
    ],
    ["(?<x>a", { byte: 6, deleteBytes: 0, insert: ")" }],
  ];
  for (const [source, edit] of cases) {
    const expected = parse(standard, applyEdits(source, [edit]).toString());
    assert.equal(expected.status, 0, expected.rows.join("\n"));
    const actual = parse(standard, source, [edit]);
    assert.deepEqual(actual, expected, `${source}`);
  }
});

test("PCRE2 rejects incomplete structures using standard recovery", () => {
  for (const source of [
    "(",
    "[",
    "[]",
    "(?",
    "(?<name>",
    "\\",
    String.raw`\j`,
    "[a-\\d]",
    "(?[a])",
    "a(**)",
    String.raw`\k<1>`,
    String.raw`\k'-1'`,
    String.raw`\k{ +1 }`,
    String.raw`[a-\Q]`,
    String.raw`[\d-\Q]`,
    "(?[ [a]\n])",
    "(?[ [a]#c\n])",
    "(?[(?#c)[a]])",
    String.raw`(?[\Qa\E])`,
    String.raw`(?[[a]\Q&\E[b]])`,
    "(?(DEFINE)a|b)",
  ]) {
    const first = parse(standard, source);
    assert.equal(first.status, 1, source);
    assert.deepEqual(parse(standard, source), first, source);
  }
});

test("PCRE2 scopes restore options and branch reset reuses capture numbers", () => {
  const cases = [
    { source: "(?:(?n)(a)|(b))(c)", capturing: 1, noncapturing: 3, spacing: 0 },
    {
      source: "(?n)(?<a>x)(y)(?-n)(z)",
      capturing: 1,
      noncapturing: 1,
      spacing: 0,
    },
    {
      source: "(?nxx)(?^:(a b))c d",
      capturing: 1,
      noncapturing: 0,
      spacing: 1,
    },
    {
      source: String.raw`(?|${"()".repeat(11)}|())\11`,
      capturing: 12,
      noncapturing: 0,
      spacing: 0,
    },
  ];
  for (const { source, capturing, noncapturing, spacing } of cases) {
    const result = parse(standard, source);
    assert.equal(result.status, 0, result.rows.join("\n"));
    assert.equal(nodes(result, "capturing_group").length, capturing, source);
    assert.equal(
      nodes(result, "non_capturing_group").length,
      noncapturing,
      source,
    );
    assert.equal(nodes(result, "verbose_whitespace").length, spacing, source);
  }
  const branch = parse(standard, String.raw`(?|${"()".repeat(10)}|())\11`);
  assert.equal(branch.status, 0);
  assert.equal(nodes(branch, "octal_escape").length, 1);
  const many = parse(standard, "()".repeat(118) + String.raw`\118`);
  assert.equal(many.status, 0);
  assert.equal(nodes(many, "numeric_backreference").length, 1);
});

test("PCRE2 newline directives determine comment boundaries", () => {
  for (const [directive, comment] of [
    ["LF", "#a\rb\nc"],
    ["CR", "#a\nb\rc"],
    ["CRLF", "#a\rb\nc\r\nd"],
    ["ANYCRLF", "#a\r\nc"],
    ["ANY", "#a\u0085c"],
    ["NUL", "#a\nb\0c"],
  ]) {
    const result = parse(standard, `(*${directive})(?x)${comment}`);
    assert.equal(result.status, 0);
    assert.equal(nodes(result, "verbose_comment").length, 1, directive);
    assert.equal(nodes(result, "literal_character").length, 1, directive);
  }
});

test("PCRE2 rejects alternate escapes and invalid Unicode scalars", () => {
  for (const source of [
    String.raw`\x{110000}`,
    String.raw`\x{D800}`,
    String.raw`\uD800`,
    String.raw`\u{110000}`,
    String.raw`\u0041`,
    String.raw`\u{41}`,
    String.raw`\U`,
  ]) {
    assert.equal(parse(standard, source).status, 1, source);
  }
});

test("PCRE2 serialization bounds use standard recovery without truncating scope state", () => {
  for (const { opening, count, successful } of [
    { opening: "(?:", count: 1000, successful: true },
    { opening: "(?:", count: 1014, successful: false },
    { opening: "(?|", count: 112, successful: true },
    { opening: "(?|", count: 114, successful: false },
  ]) {
    const source = `${opening.repeat(count)}a${")".repeat(count)}`;
    assert.equal(
      parseSummary(standard, source).successful,
      successful,
      `${opening}: ${count}`,
    );
  }
});
