import assert from "node:assert/strict";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import {
  applyEdits,
  guaranteedPcre2ScopeDepth,
  parse,
  parseSummary,
  pyregexGrammars,
} from "./support/parser.js";

const unfinishedEscapeTimeoutMicros = 100_000;

const pcre2Grammar = grammars.find(({ name }) => name === "pcre2");

test("PCRE2 repaired name and decimal tokens match fresh parses", () => {
  for (const { source, edit, expectedSource } of [
    {
      source: String.raw`\k<>`,
      edit: { byte: 3, deleteBytes: 0, insert: "name" },
      expectedSource: String.raw`\k<name>`,
    },
    {
      source: "(?<>a)",
      edit: { byte: 3, deleteBytes: 0, insert: "é" },
      expectedSource: "(?<é>a)",
    },
    {
      source: "(*LIMIT_MATCH=)",
      edit: { byte: 14, deleteBytes: 0, insert: "001" },
      expectedSource: "(*LIMIT_MATCH=001)",
    },
    {
      source: "(?(VERSION=)a)",
      edit: { byte: 11, deleteBytes: 0, insert: "1001" },
      expectedSource: "(?(VERSION=1001)a)",
    },
    {
      source: "(?(VERSION=10.)a)",
      edit: { byte: 14, deleteBytes: 0, insert: "01001" },
      expectedSource: "(?(VERSION=10.01001)a)",
    },
  ]) {
    assert.equal(parse(pcre2Grammar, source).status, 1, source);
    assert.equal(applyEdits(source, [edit]).toString(), expectedSource);
    const expected = parse(pcre2Grammar, expectedSource);
    assert.equal(expected.status, 0, expectedSource);
    assert.deepEqual(parse(pcre2Grammar, source, [edit]), expected, source);
  }
});

test("PCRE2 repairs preserve lexical context and scope state", () => {
  for (const { source, edit, expectedSource } of [
    {
      source: "abc(de))xyz",
      edit: { byte: 7, deleteBytes: 1, insert: "" },
      expectedSource: "abc(de)xyz",
    },
    {
      source: "(a**){tail",
      edit: { byte: 3, deleteBytes: 1, insert: "" },
      expectedSource: "(a*){tail",
    },
    {
      source: "(?x)(a**) #tail\nb",
      edit: { byte: 7, deleteBytes: 1, insert: "" },
      expectedSource: "(?x)(a*) #tail\nb",
    },
    {
      source: "(a**)b",
      edit: { byte: 3, deleteBytes: 1, insert: "" },
      expectedSource: "(a*)b",
    },
    {
      source: "(a{2}*)b",
      edit: { byte: 5, deleteBytes: 1, insert: "" },
      expectedSource: "(a{2})b",
    },
    {
      source: "(?:^*)b",
      edit: { byte: 4, deleteBytes: 1, insert: "" },
      expectedSource: "(?:^)b",
    },
    {
      source: "(?:(?#x)*)b",
      edit: { byte: 8, deleteBytes: 1, insert: "" },
      expectedSource: "(?:(?#x))b",
    },
    {
      source: String.raw`(\x{41}\j)b`,
      edit: { byte: 8, deleteBytes: 1, insert: "n" },
      expectedSource: String.raw`(\x{41}\n)b`,
    },
    {
      source: String.raw`(?|(a{2}*)|(b))\2`,
      edit: { byte: 8, deleteBytes: 1, insert: "" },
      expectedSource: String.raw`(?|(a{2})|(b))\2`,
    },
    {
      source: "(?x:a**) b",
      edit: { byte: 6, deleteBytes: 1, insert: "" },
      expectedSource: "(?x:a*) b",
    },
    {
      source: "(?n:a**)(b)",
      edit: { byte: 6, deleteBytes: 1, insert: "" },
      expectedSource: "(?n:a*)(b)",
    },
    {
      source: String.raw`(?|(a)**|(b))\2`,
      edit: { byte: 7, deleteBytes: 1, insert: "" },
      expectedSource: String.raw`(?|(a)*|(b))\2`,
    },
    {
      source: String.raw`(a\j)b`,
      edit: { byte: 3, deleteBytes: 1, insert: "n" },
      expectedSource: String.raw`(a\n)b`,
    },
    {
      source: String.raw`(a\xG)b`,
      edit: { byte: 4, deleteBytes: 1, insert: "41" },
      expectedSource: String.raw`(a\x41)b`,
    },
    {
      source: String.raw`(a\xG\Q)|b\E)c`,
      edit: { byte: 4, deleteBytes: 1, insert: "41" },
      expectedSource: String.raw`(a\x41\Q)|b\E)c`,
    },
    {
      source: String.raw`([a\xG)|x])b`,
      edit: { byte: 5, deleteBytes: 1, insert: "41" },
      expectedSource: String.raw`([a\x41)|x])b`,
    },
    {
      source: String.raw`([a-\d)|x])b`,
      edit: { byte: 3, deleteBytes: 1, insert: "" },
      expectedSource: String.raw`([a\d)|x])b`,
    },
    {
      source: String.raw`(a**\Q)|b\E)c`,
      edit: { byte: 3, deleteBytes: 1, insert: "" },
      expectedSource: String.raw`(a*\Q)|b\E)c`,
    },
    {
      source: "(a**(?#|)b)c",
      edit: { byte: 3, deleteBytes: 1, insert: "" },
      expectedSource: "(a*(?#|)b)c",
    },
    {
      source: String.raw`(a\k<)|b>)c`,
      edit: { byte: 5, deleteBytes: 2, insert: "" },
      expectedSource: String.raw`(a\k<b>)c`,
    },
    {
      source: String.raw`(a\g{)|b})c`,
      edit: { byte: 5, deleteBytes: 2, insert: "" },
      expectedSource: String.raw`(a\g{b})c`,
    },
  ]) {
    assert.equal(parse(pcre2Grammar, source).status, 1, source);
    assert.equal(applyEdits(source, [edit]).toString(), expectedSource);
    const expected = parse(pcre2Grammar, expectedSource);
    assert.equal(expected.status, 0, expectedSource);
    assert.deepEqual(parse(pcre2Grammar, source, [edit]), expected, source);
  }
});

const repairedGroupDepths = [1, 4, 20];

test("PCRE2 completed nested group headers preserve fields after closing repairs", () => {
  for (const opening of [
    "(?:",
    "(?<name>",
    "(?P<name>",
    "(?'name'",
    "(?|",
    "(?>",
    "(*atomic:",
    "(?nxx:",
    "(?=",
    "(?<=",
    "(*napla:",
    "(*sr:",
    "(*asr:",
    "(*scs:(1)",
    "(?(1)",
    "(?(DEFINE)",
    "(?(?=a)",
    "(?(?#c)(?=a)",
  ]) {
    for (const depth of repairedGroupDepths) {
      const source = `z${opening.repeat(depth)}a`;
      const closing = ")".repeat(depth);
      const expectedSource = `${source}${closing}b`;
      const edit = {
        byte: source.length,
        deleteBytes: 0,
        insert: `${closing}b`,
      };
      assert.equal(parse(pcre2Grammar, source).status, 1, source);
      assert.equal(applyEdits(source, [edit]).toString(), expectedSource);
      const expected = parse(pcre2Grammar, expectedSource);
      assert.equal(expected.status, 0, expectedSource);
      assert.deepEqual(parse(pcre2Grammar, source, [edit]), expected, source);
    }
  }
});

for (const grammar of pyregexGrammars) {
  test(`${grammar.name}: unfinished groups and escapes finish within the parser timeout`, () => {
    for (const source of ["(?-x:", "(?-x:a", "(?-x:\0", "\\", "a\\"]) {
      parseSummary(grammar, source, unfinishedEscapeTimeoutMicros);
    }
  });

  test(`${grammar.name}: a deleted scoped closer can be restored`, () => {
    const source = "(?-x:a)";
    const deletion = { byte: 6, deleteBytes: 1, insert: "" };
    const restoration = { byte: 6, deleteBytes: 0, insert: ")" };
    assert.equal(parse(grammar, source, [deletion]).status, 1);
    assert.deepEqual(
      parse(grammar, source, [deletion, restoration]),
      parse(grammar, source),
    );
  });
}

const pyregexNumericEscapeEditCases = [
  {
    name: "repairing an out-of-range octal escape preserves the following alternative",
    source: String.raw`\400|z`,
    edited: String.raw`\377|z`,
    edit: { byte: 1, deleteBytes: 3, insert: "377" },
    reverse: { byte: 1, deleteBytes: 3, insert: "400" },
  },
  {
    name: "repairing an out-of-range class octal escape preserves the class",
    source: String.raw`[\777]`,
    edited: String.raw`[\377]`,
    edit: { byte: 2, deleteBytes: 1, insert: "3" },
    reverse: { byte: 2, deleteBytes: 1, insert: "7" },
  },
  {
    name: "removing a third octal digit restores a numeric backreference",
    source: String.raw`\400`,
    edited: String.raw`\40`,
    edit: { byte: 3, deleteBytes: 1, insert: "" },
    reverse: { byte: 3, deleteBytes: 0, insert: "0" },
  },
  {
    name: "removing a third octal digit restores a class octal escape",
    source: String.raw`[\400]`,
    edited: String.raw`[\40]`,
    edit: { byte: 4, deleteBytes: 1, insert: "" },
    reverse: { byte: 4, deleteBytes: 0, insert: "0" },
  },
  {
    name: "repairing a Unicode escape restores the maximum code point",
    source: String.raw`\U00110000|z`,
    edited: String.raw`\U0010FFFF|z`,
    edit: { byte: 2, deleteBytes: 8, insert: "0010FFFF" },
    reverse: { byte: 2, deleteBytes: 8, insert: "00110000" },
  },
  {
    name: "repairing a class Unicode escape restores the maximum code point",
    source: String.raw`[\U00110000]`,
    edited: String.raw`[\U0010FFFF]`,
    edit: { byte: 3, deleteBytes: 8, insert: "0010FFFF" },
    reverse: { byte: 3, deleteBytes: 8, insert: "00110000" },
  },
];
for (const grammar of pyregexGrammars) {
  for (const {
    name,
    source,
    edited,
    edit,
    reverse,
  } of pyregexNumericEscapeEditCases) {
    test(`${grammar.name}: incremental ${name}`, () => {
      assert.equal(applyEdits(source, [edit]).toString(), edited);
      assert.equal(applyEdits(edited, [reverse]).toString(), source);
      assert.equal(parse(grammar, source).status, 1);
      const expected = parse(grammar, edited);
      assert.equal(expected.status, 0);
      assert.equal(parse(grammar, edited, [reverse]).status, 1);
      assert.deepEqual(parse(grammar, source, [edit]), expected);
      assert.deepEqual(parse(grammar, edited, [reverse, edit]), expected);
    });
  }
}

const exhaustedPcre2ScopeDepth = 1_014;
const guaranteedBranchResetDepth = 112;
const exhaustedBranchResetDepth = 114;

test("PCRE2 serialization bounds use standard recovery without truncating scope state", () => {
  for (const { opening, count, successful } of [
    { opening: "(?:", count: guaranteedPcre2ScopeDepth, successful: true },
    { opening: "(?:", count: exhaustedPcre2ScopeDepth, successful: false },
    { opening: "(?|", count: guaranteedBranchResetDepth, successful: true },
    { opening: "(?|", count: exhaustedBranchResetDepth, successful: false },
  ]) {
    const source = `${opening.repeat(count)}a${")".repeat(count)}`;
    assert.equal(
      parseSummary(pcre2Grammar, source).successful,
      successful,
      `${opening}: ${count}`,
    );
  }
});

const pyregexVerboseScopeDepth = 2_048;

for (const grammar of pyregexGrammars) {
  test(`${grammar.name}: scoped flags support ${pyregexVerboseScopeDepth} nested alternating verbose modes`, () => {
    const headers = Array.from(
      { length: pyregexVerboseScopeDepth },
      (_, index) => (index % 2 === 0 ? "(?x:" : "(?-x:"),
    ).join("");
    const source = `${headers}a b${") ".repeat(pyregexVerboseScopeDepth)}`;
    assert.equal(parseSummary(grammar, source).successful, true);
  });
}
