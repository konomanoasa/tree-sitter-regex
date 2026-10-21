import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { grammars, root } from "../scripts/tree-sitter.js";
import { parseCst, selectNodes } from "./support/cst.js";
import {
  guaranteedPcre2ScopeDepth,
  parse,
  parseSummary,
  posixGrammars,
  pyregexGrammars,
} from "./support/parser.js";

const largeLiteralCharacters = 80_000;
const repeatedExpressionCount = 16_000;
const spacedAtomCount = 40_000;
const incompleteCollatingSymbolCount = 80_000;
const nestedGroupDepth = 2_000;
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
  const result = parseCst(cstOutput, cstSource, "pyregex");
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
    () => parseCst("", cstSource, "pyregex"),
    /parser produced no CST root/,
  );
  assert.throws(
    () => parseCst(cstOutput, `${cstSource}a`, "pyregex"),
    /root must reach the edited source end/,
  );
  assert.throws(
    () =>
      parseCst(
        "0:0 - 0:1   wrong_root\n0:0 - 0:1     pattern",
        "a",
        "ecmaregex",
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
    assert.deepEqual(parseCst(cst, "a", "ecmaregex"), {
      status: 1,
      cst,
      recovery: true,
    });
  }
  const cst = "0:0 - 0:1   ERROR";
  assert.deepEqual(parseCst(cst, "a", "ecmaregex", 1), {
    status: 1,
    cst,
    recovery: false,
  });
});

function parseCorpus(text) {
  const sections = text.split("==================\n");
  assert.equal(sections.shift(), "", "corpus must begin with a header");
  assert.equal(sections.length % 2, 0, "corpus headers must be paired");
  const cases = [];
  for (let index = 0; index < sections.length; index += 2) {
    const [name, ...attributes] = sections[index].trimEnd().split("\n");
    assert.ok(name, "corpus case must have a name");
    const languages = [];
    for (const attribute of attributes) {
      if (attribute === ":cst" || attribute === ":error") continue;
      const match = /^:language\(([a-z0-9_]+)\)$/.exec(attribute);
      assert.ok(match, `unsupported corpus attribute: ${attribute}`);
      assert.ok(!languages.includes(match[1]), `${name}: duplicate language`);
      languages.push(match[1]);
    }
    assert.ok(languages.length > 0, `${name}: missing language`);
    const parts = sections[index + 1].split("\n------------------\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, languages, source });
  }
  return cases;
}

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
  { name: "ecmaregex", unicode: false, sets: false },
  { name: "ecmaregex_u", unicode: true, sets: false },
  { name: "ecmaregex_v", unicode: true, sets: true },
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

for (const grammar of pyregexGrammars.slice(1)) {
  test(`${grammar.name}: public nodes and fields match ${pyregexGrammars[0].name}`, () => {
    assert.deepEqual(publicSchema(grammar), publicSchema(pyregexGrammars[0]));
  });
}

for (const grammar of pyregexGrammars) {
  test(`${grammar.name}: names, numbers, literals, and comment content are public terminal nodes`, () => {
    const types = [
      "comment_content",
      "decimal_digits",
      "group_id",
      "group_name",
      "literal_character",
    ];
    assert.deepEqual(
      publicSchema(grammar).filter(({ type }) => types.includes(type)),
      types.map((type) => ({ named: true, type })),
    );
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
      ...(bre
        ? [
            [
              "long group body",
              `${open}${"x".repeat(largeLiteralCharacters)}${close}`,
            ],
            [
              "deep groups with concatenated bodies",
              `${open.repeat(depth)}abc${`${close}de`.repeat(depth)}`,
            ],
          ]
        : []),
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
