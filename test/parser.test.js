import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  unicodeIdContinue,
  unicodeIdStart,
} from "../common/javascript/unicode.js";
import { grammars, root } from "../scripts/tree-sitter.js";
import {
  cache,
  parse,
  parseFile,
  parseSummary,
  posixGrammars,
  pythonGrammars,
  selectNodes,
} from "./support/parser.js";

const sourceCharacterLeaves = {
  javascript_regex: Array(5).fill("source_character"),
  javascript_regex_u: Array(5).fill("source_character"),
  javascript_regex_v: Array(5).fill("source_character"),
  python_re: [
    "literal_character",
    "literal_character",
    "literal_character",
    "class_character",
    "literal_character",
  ],
  python_re_verbose: [
    "literal_character",
    "literal_character",
    "literal_character",
    "class_character",
    "literal_character",
  ],
  posix_bre: [
    "ordinary_character",
    "ordinary_character",
    "ordinary_character",
    "collating_element_single",
    "ordinary_character",
  ],
  posix_ere: [
    "ordinary_character",
    "ordinary_character",
    "ordinary_character",
    "collating_element_single",
    "ordinary_character",
  ],
};

const sourceCharacterRanges = [
  ["0:0", "0:1"],
  ["0:1", "0:4"],
  ["0:4", "0:5"],
  ["0:6", "0:7"],
  ["0:8", "0:12"],
];

for (const grammar of grammars) {
  test(`${grammar.name}: NUL, interior FEFF and non-BMP characters retain source byte ranges`, () => {
    const leaves = sourceCharacterLeaves[grammar.name];
    const pattern = new RegExp(
      `^([0-9]+:[0-9]+) +- +([0-9]+:[0-9]+) +(${[...new Set(leaves)].join("|")}) \``,
    );
    const result = parse(grammar, "a\uFEFF\0[\0]😀");
    assert.equal(result.status, 0);
    const ranges = result.rows.flatMap((line) => {
      const match = pattern.exec(line);
      return match ? [[match[3], match[1], match[2]]] : [];
    });
    assert.deepEqual(
      ranges,
      leaves.map((leaf, index) => [leaf, ...sourceCharacterRanges[index]]),
    );
  });
}

test("javascript_regex_v: a class string retains NUL and empty alternatives", () => {
  const path = join(cache, "class-string-nul.txt");
  writeFileSync(path, "[\\q{\0||a}]");
  const result = parseFile(path, "javascript_regex_v");
  assert.equal(result.status, 0);
  const ranges = [
    ...result.cst.matchAll(
      /^([0-9]+:[0-9]+) +- +([0-9]+:[0-9]+) +(source_character `|"[|]")/gm,
    ),
  ].map((match) => [match[1], match[2]]);
  assert.deepEqual(ranges, [
    ["0:4", "0:5"],
    ["0:5", "0:6"],
    ["0:6", "0:7"],
    ["0:7", "0:8"],
  ]);
});

const ownershipCases = [
  {
    name: "repetition owns Unicode operand and verbose layout before its quantifier",
    source: "(?x:é #c\n*)z",
    expected: [
      ["operand: literal_character `é`", "0:4-0:6", "repetition"],
      ["verbose_whitespace ` `", "0:6-0:7", "repetition"],
      ["verbose_comment `#c`", "0:7-0:9", "repetition"],
      ["verbose_whitespace", "0:9-1:0", "repetition"],
      ["quantifier: quantifier", "1:0-1:1", "repetition"],
      ['"*"', "1:0-1:1", "quantifier: quantifier"],
      ['")"', "1:1-1:2", "scoped_flags_group"],
    ],
  },
  {
    name: "conditional branches own their documented yes and no patterns",
    source: "(?(1)a|b)|z",
    expected: [
      ["condition: group_id `1`", "0:3-0:4", "conditional_group"],
      ['")"', "0:4-0:5", "conditional_group"],
      ["yes_pattern: concatenation", "0:5-0:6", "conditional_group"],
      ['"|"', "0:6-0:7", "conditional_group"],
      ["no_pattern: concatenation", "0:7-0:8", "conditional_group"],
      ['")"', "0:8-0:9", "conditional_group"],
      ['"|"', "0:9-0:10", "body: alternation"],
    ],
  },
  {
    name: "literal ranges use UTF-8 bytes and retain one node per code point",
    source: "é😀",
    expected: [
      ["literal_character `é`", "0:0-0:2", "concatenation"],
      ["literal_character `😀`", "0:2-0:6", "concatenation"],
    ],
  },
  {
    name: "Unicode line and paragraph separators remain literal characters",
    source: "\u2028\u2029",
    expected: [
      ["literal_character `\u2028`", "0:0-0:3", "concatenation"],
      ["literal_character `\u2029`", "0:3-0:6", "concatenation"],
    ],
  },
];

const initialLayoutCases = [
  {
    name: "python_re",
    expected: [
      ["literal_character ` `", "0:0-0:1", "concatenation"],
      ["literal_character `#`", "0:1-0:2", "concatenation"],
      ["literal_character `x`", "0:2-0:3", "concatenation"],
    ],
  },
  {
    name: "python_re_verbose",
    expected: [
      ["verbose_whitespace ` `", "0:0-0:1", "pattern"],
      ["verbose_comment `#x`", "0:1-0:3", "pattern"],
    ],
  },
];

const initialLayoutLabels = initialLayoutCases.flatMap(({ expected }) =>
  expected.map(([label]) => label),
);

for (const grammar of pythonGrammars) {
  for (const { name, source, expected } of ownershipCases) {
    test(`${grammar.name}: ${name}`, () => {
      const result = parse(grammar, source);
      assert.equal(result.status, 0);
      assert.deepEqual(
        selectNodes(
          result,
          expected.map(([label]) => label),
        ),
        expected,
      );
    });
  }
}

for (const { name, expected } of initialLayoutCases) {
  test(`${name}: whitespace and comment classification follows its initial mode`, () => {
    const grammar = pythonGrammars.find((grammar) => grammar.name === name);
    assert.ok(grammar);
    const result = parse(grammar, " #x");
    assert.equal(result.status, 0);
    assert.deepEqual(selectNodes(result, initialLayoutLabels), expected);
  });
}

for (const grammar of pythonGrammars) {
  test(`${grammar.name}: scoped flags support 2048 nested alternating verbose modes`, () => {
    const depth = 2048;
    const headers = Array.from({ length: depth }, (_, index) =>
      index % 2 === 0 ? "(?x:" : "(?-x:",
    ).join("");
    const source = `${headers}a b${") ".repeat(depth)}`;
    assert.equal(parseSummary(grammar, source).successful, true);
  });
}

const profiles = [
  { name: "javascript_regex", unicode: false, sets: false },
  { name: "javascript_regex_u", unicode: true, sets: false },
  { name: "javascript_regex_v", unicode: true, sets: true },
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
  test(`${profile.name}: raw identifier characters respect the BMP boundary and supplementary extremes`, () => {
    for (const [source, expected] of [
      ["(?<\uffff>)(?<a\uffff>)", false],
      ["(?<\u{10000}>)(?<a\u{10000}>)", true],
      ["(?<\u{10ffff}>)(?<a\u{10ffff}>)", !profile.unicode],
    ]) {
      assert.equal(parseSummary(grammar, source).successful, expected, source);
    }
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

for (const grammar of pythonGrammars.slice(1)) {
  test(`${grammar.name}: public nodes and fields match ${pythonGrammars[0].name}`, () => {
    assert.deepEqual(publicSchema(grammar), publicSchema(pythonGrammars[0]));
  });
}

const start = new RegExp(`^${unicodeIdStart}$`, "u");

const continuation = new RegExp(`^${unicodeIdContinue}$`, "u");

test("regex: Unicode 17 identifiers include the new scripts and distinguish letters, marks, digits, and gaps", () => {
  const cases = [
    [0x10940, true, true],
    [0x10959, true, true],
    [0x1095a, false, false],
    [0x11db0, true, true],
    [0x11dd8, true, true],
    [0x11dd9, true, true],
    [0x11ddb, true, true],
    [0x11ddc, false, false],
    [0x11de0, false, true],
    [0x11de9, false, true],
    [0x11dea, false, false],
    [0x16ea0, true, true],
    [0x16ed3, true, true],
    [0x16ed4, false, false],
    [0x1e6c0, true, true],
    [0x1e6e3, false, true],
    [0x1e6f6, false, false],
    [0x323b0, true, true],
    [0x33479, true, true],
    [0x3347a, false, false],
  ];
  for (const [codePoint, expectedStart, expectedContinue] of cases) {
    const character = String.fromCodePoint(codePoint);
    const label = `U+${codePoint.toString(16).toUpperCase()}`;
    assert.equal(start.test(character), expectedStart, `${label} ID_Start`);
    assert.equal(
      continuation.test(character),
      expectedContinue,
      `${label} ID_Continue`,
    );
  }
});

test("regex: Unicode properties preserve the distinction from ECMAScript identifier additions", () => {
  const cases = [
    ["A", true, true],
    ["z", true, true],
    ["0", false, true],
    ["$", false, false],
    ["_", false, true],
    ["\u0301", false, true],
    ["\u200c", false, true],
    ["\u200d", false, true],
    ["\u0000", false, false],
    ["\ud800", false, false],
    ["\udfff", false, false],
    ["\u{10ffff}", false, false],
  ];
  for (const [character, expectedStart, expectedContinue] of cases) {
    assert.equal(
      start.test(character),
      expectedStart,
      JSON.stringify(character),
    );
    assert.equal(
      continuation.test(character),
      expectedContinue,
      JSON.stringify(character),
    );
  }
});

test("regex: generated classes contain the published Unicode 17 property totals", () => {
  let starts = 0;
  let continuations = 0;
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    const character = String.fromCodePoint(codePoint);
    if (start.test(character)) starts += 1;
    if (continuation.test(character)) continuations += 1;
  }
  assert.equal(starts, 145916);
  assert.equal(continuations, 149240);
});

const malformedCases = [
  {
    name: "incomplete inline flag header",
    languages: ["python_re", "python_re_verbose"],
    source: "(?x a#b\nc|d\n",
  },
  {
    name: "global inline flags after a consuming expression",
    languages: ["python_re"],
    source: "a(?x)b c\\\n",
  },
  {
    name: "missing scoped closer",
    languages: ["python_re"],
    source: "(?x:a #c\nb\n",
  },
  {
    name: "verbose layout cannot split a scoped flag header",
    languages: ["python_re_verbose"],
    source: "(? x:a|b\n",
  },
  {
    name: "layout cannot separate the noncapture introducer from its separator",
    languages: ["python_re", "python_re_verbose"],
    source: "(? :a)",
  },
  {
    name: "layout cannot separate the named reference introducer from its operator",
    languages: ["python_re", "python_re_verbose"],
    source: "(?P =name)",
  },
  {
    name: "capturing group without a closing parenthesis",
    languages: ["python_re"],
    source: "a(z|q\n",
  },
  {
    name: "missing comment group closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?#abc\n",
  },
  {
    name: "incomplete hexadecimal escape before a scoped group closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?x:\\x0)\\\n",
  },
  {
    name: "incomplete hexadecimal escape before a complete escape",
    languages: ["python_re", "python_re_verbose"],
    source: "\\x0\\n\\\n",
  },
  {
    name: "hexadecimal escape with a nonhexadecimal digit",
    languages: ["python_re", "python_re_verbose"],
    source: "\\xG\\\n",
  },
  {
    name: "Unicode escape without a character name",
    languages: ["python_re", "python_re_verbose"],
    source: "\\N{}\\\n",
  },
  {
    name: "unknown ASCII-letter escape",
    languages: ["python_re", "python_re_verbose"],
    source: "\\q|z\\\n",
  },
  {
    name: "incomplete hexadecimal escape before an alternative",
    languages: ["python_re", "python_re_verbose"],
    source: "\\xF|z\\\n",
  },
  {
    name: "incomplete short Unicode escape",
    languages: ["python_re", "python_re_verbose"],
    source: "\\u123|z\\\n",
  },
  {
    name: "incomplete long Unicode escape",
    languages: ["python_re", "python_re_verbose"],
    source: "\\U0000000|z\\\n",
  },
  {
    name: "unterminated named Unicode escape",
    languages: ["python_re", "python_re_verbose"],
    source: "\\N{NAME|z\\\n",
  },
  {
    name: "unterminated group",
    languages: ["python_re", "python_re_verbose"],
    source: "a(\\x41|z\\\n",
  },
  {
    name: "capturing group without a name",
    languages: ["python_re", "python_re_verbose"],
    source: "(?P<>a)\\\n",
  },
  {
    name: "capturing group without its closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(a|b\\\n",
  },
  {
    name: "non-capturing group without its closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?:a\\\n",
  },
  {
    name: "named group without its closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?P<n>a\\\n",
  },
  {
    name: "nested groups without their closers",
    languages: ["python_re", "python_re_verbose"],
    source: "((a\\\n",
  },
  {
    name: "incomplete class escape",
    languages: ["python_re", "python_re_verbose"],
    source: "[\\xA]|z\\\n",
  },
  {
    name: "missing class closer",
    languages: ["python_re", "python_re_verbose"],
    source: "[a|)#\n",
  },
  {
    name: "unknown escape before a class bracket",
    languages: ["python_re", "python_re_verbose"],
    source: "[\\q[]\\\n",
  },
  {
    name: "empty named backreference",
    languages: ["python_re", "python_re_verbose"],
    source: "(?P=)\\\n",
  },
  {
    name: "conditional group without its closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?P<n>a)(?(n)b|c\\\n",
  },
  {
    name: "unterminated named reference",
    languages: ["python_re", "python_re_verbose"],
    source: "(?P=name|z\\\n",
  },
  {
    name: "unexpected closer",
    languages: ["python_re", "python_re_verbose"],
    source: "a)b|c\\\n",
  },
  {
    name: "empty conditional",
    languages: ["python_re", "python_re_verbose"],
    source: "(?())|z\\\n",
  },
  {
    name: "incomplete conditional condition",
    languages: ["python_re", "python_re_verbose"],
    source: "(?(1a|b\\\n",
  },
  {
    name: "extra conditional separator",
    languages: ["python_re", "python_re_verbose"],
    source: "(?(1)a|b|)\\\n",
  },
  {
    name: "extra separator inside nested conditional and scoped flags",
    languages: ["python_re", "python_re_verbose"],
    source: "(?x:(?(1)[a|)]|b|c)q)\n",
  },
  {
    name: "named group without its name terminator",
    languages: ["python_re", "python_re_verbose"],
    source: "((?P<]a)|z\\\n",
  },
  {
    name: "verbose layout cannot split a lookbehind introducer",
    languages: ["python_re_verbose"],
    source: "(?< =a)|z\\\n",
  },
  {
    name: "lookahead assertion without its closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?=a\\\n",
  },
  {
    name: "lookbehind assertion without its closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?<=a\\\n",
  },
  {
    name: "atomic group without its closer",
    languages: ["python_re", "python_re_verbose"],
    source: "(?>a\\\n",
  },
  {
    name: "whitespace inside a quantifier modifier",
    languages: ["python_re_verbose"],
    source: "a{ 2}|a* ?b|c\\\n",
  },
  {
    name: "orphan and nested quantifiers",
    languages: ["python_re", "python_re_verbose"],
    source: "*a|{2}b|c**d|e*?+f|g{2}*h\\\n",
  },
  {
    name: "zero-width atoms do not become repetition operands",
    languages: ["python_re", "python_re_verbose"],
    source: "^*a|$+b|\\A?c|\\b{2}d\\\n",
  },
];
for (const grammar of pythonGrammars) {
  for (const { name, languages, source } of malformedCases) {
    if (!languages.includes(grammar.name)) continue;
    test(`${grammar.name}: malformed ${name} uses standard recovery`, () => {
      assert.equal(parse(grammar, source).status, 1);
    });
  }
}

test("posix_ere: an unmatched close parenthesis is an ordinary character", () => {
  const grammar = posixGrammars.find(({ name }) => name === "posix_ere");
  const result = parse(grammar, "(a))");
  assert.equal(result.status, 0);
  assert.deepEqual(selectNodes(result, ['")"', "ordinary_character `)`"]), [
    ['")"', "0:2-0:3", "ere_expression"],
    ["ordinary_character `)`", "0:3-0:4", "one_char_or_coll_elem_ere"],
  ]);
});

test("posix_ere: a group closer cannot supply a missing branch operand", () => {
  const grammar = posixGrammars.find(({ name }) => name === "posix_ere");
  for (const source of ["()a)", "(()))", "(a|)b)", "(a|)*b)"]) {
    assert.equal(parse(grammar, source).status, 1, source);
  }
});

test("posix_bre: unescaped parentheses are ordinary characters", () => {
  const grammar = posixGrammars.find(({ name }) => name === "posix_bre");
  const result = parse(grammar, "(a))");
  assert.equal(result.status, 0);
  assert.deepEqual(
    selectNodes(result, ["ordinary_character `(`", "ordinary_character `)`"]),
    [
      ["ordinary_character `(`", "0:0-0:1", "one_char_or_coll_elem_bre"],
      ["ordinary_character `)`", "0:2-0:3", "one_char_or_coll_elem_bre"],
      ["ordinary_character `)`", "0:3-0:4", "one_char_or_coll_elem_bre"],
    ],
  );
});

for (const grammar of posixGrammars) {
  test(`${grammar.name}: a range endpoint cannot split a compound opener`, () => {
    for (const source of ["[a-[:alpha:]]", "[a-[=x=]]"]) {
      assert.equal(parse(grammar, source).status, 1, source);
    }
    for (const source of ["[a-[]", "[a-[.z.]]", "[[]"]) {
      assert.equal(parse(grammar, source).status, 0, source);
    }
  });
}

function regexOperators({ name }) {
  const backslash = name === "posix_bre" ? "\\" : "";
  return {
    alternation: `${backslash}|`,
    close: `${backslash})`,
    open: `${backslash}(`,
  };
}

for (const grammar of grammars) {
  const { alternation, close, open } = regexOperators(grammar);

  test(`${grammar.name}: large literals, alternatives and nested groups parse through EOF`, () => {
    for (const [name, source] of [
      ["long literal", "x".repeat(80_000)],
      ["wide alternatives", `${`a${alternation}`.repeat(16_000)}a`],
      ["deep groups", `${open.repeat(2000)}a${close.repeat(2000)}`],
      ["space-separated atoms", "a ".repeat(40_000)],
    ]) {
      assert.equal(parseSummary(grammar, source).successful, true, name);
    }
  });

  test(`${grammar.name}: long unterminated constructs parse through EOF with native recovery`, () => {
    const sources = [`${open}${"x".repeat(80_000)}`];
    if (posixGrammars.includes(grammar)) sources.push("[[.".repeat(80_000));
    for (const source of sources) {
      assert.equal(parseSummary(grammar, source).successful, false);
    }
  });

  test(`${grammar.name}: a parser timeout cannot pass as complete recovery`, () => {
    assert.throws(() =>
      parseSummary(grammar, `a${alternation}`.repeat(16_000), 1),
    );
  });
}

test("regex: corpus fuzz propagates CLI failures even when its exit status is zero", () => {
  const directory = mkdtempSync(join(tmpdir(), "tree-sitter-fuzz-exit-#-"));
  const preload = join(directory, "cli.mjs");
  const script = join(import.meta.dirname, "..", "scripts", "tree-sitter.js");
  const fixtures = [
    {
      name: "successful CLI output",
      status: 0,
      stdout: "0 test_language corpus tests failed fuzzing\n",
      stderr: "",
      expectedStatus: 0,
    },
    {
      name: "failed fuzz case with successful CLI exit status",
      status: 0,
      stdout: "1 test_language corpus tests failed fuzzing\n",
      stderr: "",
      expectedStatus: 1,
    },
    {
      name: "failed CLI exit status",
      status: 1,
      stdout: "",
      stderr: "fuzz command failed\n",
      expectedStatus: 1,
    },
  ];
  try {
    for (const fixture of fixtures) {
      writeFileSync(
        preload,
        `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const fixture = ${JSON.stringify(fixture)};
childProcess.spawnSync = (_command, arguments_) => {
  if (arguments_.includes("build")) return { status: 0, stdout: "", stderr: "" };
  if (arguments_.includes("fuzz")) return fixture;
  throw new Error("unexpected CLI invocation");
};
syncBuiltinESMExports();
`,
      );
      const result = spawnSync(
        process.execPath,
        ["--import", pathToFileURL(preload).href, script, "fuzz-all"],
        {
          encoding: "utf8",
          timeout: 60_000,
          killSignal: "SIGKILL",
        },
      );
      assert.ifError(result.error);
      assert.equal(
        result.status,
        fixture.expectedStatus,
        `${fixture.name}\n${result.stdout}${result.stderr}`,
      );
      assert.ok(
        result.stdout.includes(fixture.stdout),
        `${fixture.name}: CLI stdout is missing`,
      );
      assert.ok(
        result.stderr.includes(fixture.stderr),
        `${fixture.name}: CLI stderr is missing`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
