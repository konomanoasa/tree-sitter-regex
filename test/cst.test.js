import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { grammars, root } from "../scripts/tree-sitter.js";
import { parseCorpus } from "./support/corpus.js";
import { parseCst, selectNodes } from "./support/cst.js";
import {
  applyEdits,
  parse,
  parseSummary,
  posixGrammars,
  pythonGrammars,
} from "./support/parser.js";

const largeLiteralCharacters = 80_000;
const repeatedExpressionCount = 16_000;
const spacedAtomCount = 40_000;
const incompleteCollatingSymbolCount = 80_000;
const nestedGroupDepth = 2_000;
const guaranteedPcre2ScopeDepth = 1_000;
const pythonVerboseScopeDepth = 2_048;
const immediateParserTimeoutMicros = 1;

const pcre2Grammar = grammars.find(({ name }) => name === "pcre2");

const cstSource = "é\n(a)";
const cstOutput = [
  "0:0 - 1:3   pattern",
  "0:0 - 1:3     body: alternation",
  "0:0 - 1:3       concatenation",
  "0:0 - 0:2         literal_character `é`",
  "0:2 - 1:0         literal_character",
  "0:2 - 0:3           `\\n`",
  "1:0 - 1:3         capturing_group",
  '1:0 - 1:1           "("',
  "1:1 - 1:2           body: alternation",
  "1:1 - 1:2             concatenation",
  "1:1 - 1:2               literal_character `a`",
  '1:2 - 1:3           ")"',
].join("\n");

test("regex: CST helpers retain field owners and UTF-8 byte columns across lines", () => {
  const result = parseCst(cstOutput, cstSource, "python_re");
  assert.equal(result.status, 0);
  assert.equal(result.recovery, false);
  assert.equal(result.cst, cstOutput);
  assert.deepEqual(
    selectNodes({ rows: result.cst.split("\n") }, [
      "body: alternation",
      "literal_character `é`",
      "literal_character",
      "literal_character `a`",
      '")"',
    ]),
    [
      ["body: alternation", "0:0-1:3", "pattern"],
      ["literal_character `é`", "0:0-0:2", "concatenation"],
      ["literal_character", "0:2-1:0", "concatenation"],
      ["body: alternation", "1:1-1:2", "capturing_group"],
      ["literal_character `a`", "1:1-1:2", "concatenation"],
      ['")"', "1:2-1:3", "capturing_group"],
    ],
  );
});

test("regex: CST helpers reject truncated roots and misplaced root names", () => {
  assert.throws(
    () => parseCst("", cstSource, "python_re"),
    /parser produced no CST root/,
  );
  assert.throws(
    () => parseCst(cstOutput, `${cstSource}a`, "python_re"),
    /root must reach the edited source end/,
  );
  assert.throws(
    () =>
      parseCst(
        "0:0 - 0:1   wrong_root\n0:0 - 0:1     pattern",
        "a",
        "js_regex",
      ),
    assert.AssertionError,
  );
  for (const [language, rootNode] of [
    ["posix_bre", "basic_reg_exp"],
    ["posix_ere", "extended_reg_exp"],
  ]) {
    assert.equal(parseCst(`0:0 - 0:1   ${rootNode}`, "a", language).status, 0);
    assert.throws(
      () => parseCst("0:0 - 0:1   pattern", "a", language),
      assert.AssertionError,
    );
  }
});

test("regex: CST recovery includes missing nodes even when the CLI exits successfully", () => {
  for (const cst of [
    "0:0 - 0:1   •pattern",
    "0:0 - 0:1   pattern\n0:1 - 0:1     •MISSING",
    "0:0 - 0:1   pattern\n0:0 - 0:1     •ERROR",
  ]) {
    assert.deepEqual(parseCst(cst, "a", "js_regex"), {
      status: 1,
      cst,
      recovery: true,
    });
  }
  const cst = "0:0 - 0:1   ERROR";
  assert.deepEqual(parseCst(cst, "a", "js_regex", 1), {
    status: 1,
    cst,
    recovery: false,
  });
});

for (const file of readdirSync(join(root, "test", "corpus")).sort()) {
  if (!file.endsWith(".txt")) continue;
  const cases = parseCorpus(
    readFileSync(join(root, "test", "corpus", file), "utf8"),
  );
  for (const { name, languages, source } of cases) {
    for (const language of languages) {
      const grammar = grammars.find(({ name }) => name === language);
      assert.ok(grammar, `${file}: unknown language ${language}`);
      test(`${language}: corpus source bounds and fresh determinism: ${file}: ${name}`, () => {
        const first = parse(grammar, source);
        assert.deepEqual(parse(grammar, source), first);
      });
    }
  }
}

const profiles = [
  { name: "js_regex", unicode: false, sets: false },
  { name: "js_regex_u", unicode: true, sets: false },
  { name: "js_regex_v", unicode: true, sets: true },
];

for (const profile of profiles) {
  const grammar = grammars.find(({ name }) => name === profile.name);
  const nodes = JSON.parse(
    readFileSync(join(root, grammar.path, "src", "node-types.json"), "utf8"),
  );
  test(`${profile.name}: the root exposes an optional specification disjunction`, () => {
    assert.deepEqual(
      nodes.find(({ type }) => type === "pattern"),
      {
        type: "pattern",
        named: true,
        root: true,
        fields: {
          body: {
            multiple: false,
            required: false,
            types: [{ type: "disjunction", named: true }],
          },
        },
      },
    );
  });
  test(`${profile.name}: public escape and set nodes follow its mode`, () => {
    const names = new Set(
      nodes.filter(({ named }) => named).map(({ type }) => type),
    );
    assert.equal(names.has("legacy_octal_escape_sequence"), !profile.unicode);
    assert.equal(names.has("extended_atom"), !profile.unicode);
    assert.equal(names.has("invalid_braced_quantifier"), !profile.unicode);
    assert.equal(names.has("unicode_surrogate_pair"), !profile.unicode);
    assert.equal(
      names.has("unicode_property_value_expression"),
      profile.unicode,
    );
    assert.equal(names.has("code_point"), true);
    assert.equal(names.has("class_intersection"), profile.sets);
    assert.equal(names.has("class_subtraction"), profile.sets);
    assert.equal(names.has("class_string_disjunction"), profile.sets);
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value
      .map(normalize)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

function publicSchema(grammar) {
  const path = join(grammar.path, "src", "node-types.json");
  const nodeTypes = readJson(path);
  assert.ok(Array.isArray(nodeTypes), `${path} must be an array`);
  return normalize(
    nodeTypes.filter(
      ({ named, type }) =>
        named === true && typeof type === "string" && !type.startsWith("_"),
    ),
  );
}

test("PCRE2 names and decimal numbers are public terminal nodes", () => {
  const types = [
    "condition_name",
    "decimal_digits",
    "group_name",
    "group_number",
  ];
  assert.deepEqual(
    publicSchema(pcre2Grammar).filter(({ type }) => types.includes(type)),
    types.map((type) => ({ named: true, type })),
  );
});

for (const grammar of pythonGrammars.slice(1)) {
  test(`${grammar.name}: public nodes and fields match ${pythonGrammars[0].name}`, () => {
    assert.deepEqual(publicSchema(grammar), publicSchema(pythonGrammars[0]));
  });
}

for (const grammar of pythonGrammars) {
  test(`${grammar.name}: scoped flags support ${pythonVerboseScopeDepth} nested alternating verbose modes`, () => {
    const headers = Array.from(
      { length: pythonVerboseScopeDepth },
      (_, index) => (index % 2 === 0 ? "(?x:" : "(?-x:"),
    ).join("");
    const source = `${headers}a b${") ".repeat(pythonVerboseScopeDepth)}`;
    assert.equal(parseSummary(grammar, source).successful, true);
  });
}

for (const grammar of grammars) {
  const bre = grammar.name === "posix_bre";
  const depth =
    grammar.name === "pcre2" ? guaranteedPcre2ScopeDepth : nestedGroupDepth;
  const open = bre ? String.raw`\(` : "(";
  const close = bre ? String.raw`\)` : ")";
  const repeatedExpression = bre ? String.raw`a\?b\+c\|` : "a|";

  test(`${grammar.name}: large expressions and nested groups parse through EOF`, () => {
    for (const [name, source] of [
      ["long literal", "x".repeat(largeLiteralCharacters)],
      [
        bre ? "long quoted literals" : "wide alternatives",
        `${repeatedExpression.repeat(repeatedExpressionCount)}a`,
      ],
      ["deep groups", `${open.repeat(depth)}a${close.repeat(depth)}`],
      ["space-separated atoms", "a ".repeat(spacedAtomCount)],
    ]) {
      assert.equal(parseSummary(grammar, source).successful, true, name);
    }
  });

  test(`${grammar.name}: long unterminated constructs parse through EOF with native recovery`, () => {
    const sources = [`${open}${"x".repeat(largeLiteralCharacters)}`];
    if (posixGrammars.includes(grammar))
      sources.push("[[.".repeat(incompleteCollatingSymbolCount));
    for (const source of sources) {
      assert.equal(parseSummary(grammar, source).successful, false);
    }
  });

  test(`${grammar.name}: a parser timeout cannot pass as complete recovery`, () => {
    assert.throws(() =>
      parseSummary(
        grammar,
        repeatedExpression.repeat(repeatedExpressionCount),
        immediateParserTimeoutMicros,
      ),
    );
  });
}

test("PCRE2 serialization bounds use standard recovery without truncating scope state", () => {
  for (const { opening, count, successful } of [
    { opening: "(?:", count: guaranteedPcre2ScopeDepth, successful: true },
    { opening: "(?:", count: 1_014, successful: false },
    { opening: "(?|", count: 112, successful: true },
    { opening: "(?|", count: 114, successful: false },
  ]) {
    const source = `${opening.repeat(count)}a${")".repeat(count)}`;
    assert.equal(
      parseSummary(pcre2Grammar, source).successful,
      successful,
      `${opening}: ${count}`,
    );
  }
});

const unicodePayloadClosings = {
  pcre2: ['")"', "operand: capturing_group"],
  js_regex: ['")"', "operand: extended_atom"],
  js_regex_u: ['")"', "operand: atom"],
  js_regex_v: ['")"', "operand: atom"],
  python_re: ['")"', "operand: capturing_group"],
  python_re_verbose: ['")"', "operand: capturing_group"],
  posix_bre: ["ordinary_character `)`", "one_char_or_coll_elem_bre"],
  posix_ere: ['")"', "ere_expression"],
};

for (const grammar of grammars) {
  test(`${grammar.name}: every byte inside a Unicode payload can be deleted and repaired through an edit history`, () => {
    const prefix = "(";
    const suffix = ")+|z";
    const payload = "é😀";
    const source = `${prefix}${payload}${suffix}`;
    const changed = `${prefix}x${suffix}`;
    const payloadByte = Buffer.byteLength(prefix);
    const payloadLengthBytes = Buffer.byteLength(payload);
    const brokenPayloads = [
      [0xa9, 0xf0, 0x9f, 0x98, 0x80],
      [0xc3, 0xf0, 0x9f, 0x98, 0x80],
      [0xc3, 0xa9, 0x9f, 0x98, 0x80],
      [0xc3, 0xa9, 0xf0, 0x98, 0x80],
      [0xc3, 0xa9, 0xf0, 0x9f, 0x80],
      [0xc3, 0xa9, 0xf0, 0x9f, 0x98],
    ];
    for (const [removedByte, brokenPayload] of brokenPayloads.entries()) {
      const edits = [
        { byte: payloadByte + removedByte, deleteBytes: 1, insert: "" },
        {
          byte: payloadByte,
          deleteBytes: payloadLengthBytes - 1,
          insert: payload,
        },
        { byte: payloadByte, deleteBytes: payloadLengthBytes, insert: "x" },
        { byte: payloadByte, deleteBytes: 1, insert: payload },
      ];
      const expected = [
        Buffer.concat([
          Buffer.from(prefix),
          Buffer.from(brokenPayload),
          Buffer.from(suffix),
        ]),
        Buffer.from(source),
        Buffer.from(changed),
        Buffer.from(source),
      ];
      for (const [step, expectedSource] of expected.entries()) {
        const history = edits.slice(0, step + 1);
        const label = `UTF-8 byte ${removedByte}, edit ${step + 1}`;
        assert.deepEqual(applyEdits(source, history), expectedSource, label);
        const fresh = parse(grammar, expectedSource);
        const incremental = parse(grammar, source, history);
        if (step === 0) continue;
        const closing = unicodePayloadClosings[grammar.name];
        assert.ok(closing, grammar.name);
        const [node, owner] = closing;
        const end = expectedSource.length - Buffer.byteLength(suffix);
        for (const result of [fresh, incremental]) {
          assert.equal(result.status, 0, label);
          assert.deepEqual(
            selectNodes(result, [node]),
            [[node, `0:${end}-0:${end + 1}`, owner]],
            label,
          );
        }
        assert.deepEqual(incremental.rows, fresh.rows, label);
      }
    }
  });
}
