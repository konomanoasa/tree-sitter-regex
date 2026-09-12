import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  unicodeIdContinue,
  unicodeIdStart,
} from "../common/javascript/unicode.js";
import { createTreeSitter, grammars, root } from "../scripts/tree-sitter.js";

let cache;
let runner;

before(() => {
  cache = mkdtempSync(join(tmpdir(), "tree-sitter-regex-parser-"));
  runner = createTreeSitter({ NO_COLOR: "1" });
});

after(() => {
  try {
    runner?.close();
  } finally {
    if (cache !== undefined) rmSync(cache, { recursive: true, force: true });
  }
});

function parseFile(path, language, edits = []) {
  const grammar = grammars.find(({ name }) => name === language);
  assert.ok(grammar, language);
  const arguments_ = [
    "parse",
    "--scope",
    grammar.scope,
    "--encoding",
    "utf8",
    "--cst",
    path,
  ];
  if (edits.length > 0) {
    arguments_.push(
      "--edits",
      ...edits.map((edit) => `${edit.start} ${edit.delete} ${edit.insert}`),
    );
  }
  const result = runner.run(arguments_, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.ok(
    result.status === 0 || result.status === 1,
    result.stderr || result.stdout,
  );
  const cst = result.stdout
    .split("\n")
    .filter((line) => /^[0-9]/.test(line))
    .join("\n");
  assert.ok(cst.length > 0, result.stderr || result.stdout);
  if (result.status === 0) assert.ok(cst.includes("pattern"), cst);
  return { status: result.status, cst };
}

const allLanguages = [
  "javascript_regex",
  "javascript_regex_u",
  "javascript_regex_v",
];
const unicodeLanguages = ["javascript_regex_u", "javascript_regex_v"];

const cases = [
  {
    name: "editing an empty pattern initializes capture information from the new source",
    before: "",
    after: String.raw`\1()`,
    start: 0,
    delete: 0,
    insert: String.raw`\1()`,
  },
  {
    name: "a capture appended at EOF changes an earlier octal escape",
    before: String.raw`\1`,
    after: String.raw`\1()`,
    start: 2,
    delete: 0,
    insert: "()",
  },
  {
    name: "a later second capture changes a decimal escape before both groups",
    before: String.raw`\2(a)`,
    after: String.raw`\2(a)(b)`,
    start: 5,
    delete: 0,
    insert: "(b)",
  },
  {
    name: "changing a later noncapture into a capture updates earlier escapes",
    before: String.raw`\1(?:a)`,
    after: String.raw`\1(a)`,
    start: 3,
    delete: 2,
    insert: "",
  },
  {
    name: "a later ninth capture changes an identity escape into a reference",
    before: String.raw`\9()()()()()()()()`,
    after: String.raw`\9()()()()()()()()()`,
    start: 18,
    delete: 0,
    insert: "()",
  },
  {
    name: "a named capture appended at EOF changes an earlier k escape",
    before: String.raw`\k<x>`,
    after: String.raw`\k<x>(?<x>a)`,
    start: 5,
    delete: 0,
    insert: "(?<x>a)",
  },
  {
    name: "naming an existing capture changes an earlier k escape",
    before: String.raw`\k<x>(a)`,
    after: String.raw`\k<x>(?<x>a)`,
    start: 6,
    delete: 0,
    insert: "?<x>",
  },
  {
    name: "a later named capture invalidates an earlier class k identity escape",
    before: String.raw`[\k](a)`,
    after: String.raw`[\k](?<x>a)`,
    start: 5,
    delete: 0,
    insert: "?<x>",
    afterError: true,
  },
  {
    name: "escaping a class opener exposes a later capture to the whole pattern scan",
    before: String.raw`\1[(a)]`,
    after: String.raw`\1\[(a)]`,
    start: 2,
    delete: 0,
    insert: "\\",
  },
  {
    name: "removing and restoring a class closer updates capture classification",
    before: String.raw`\1[a](b)`,
    after: String.raw`\1[a(b)`,
    start: 4,
    delete: 1,
    insert: "",
    afterError: true,
  },

  {
    name: "a later capture changes references across non-BMP source bytes",
    before: String.raw`😀\1x`,
    after: String.raw`😀\1x()`,
    start: 7,
    delete: 0,
    insert: "()",
  },
  {
    name: "a second digit changes a valid reference into an octal escape",
    before: String.raw`\1(a)`,
    after: String.raw`\11(a)`,
    start: 2,
    delete: 0,
    insert: "1",
  },
  {
    name: "a second digit extends a reference when the full number has a capture",
    languages: allLanguages,
    before: String.raw`\1()()()()()()()()()()`,
    after: String.raw`\10()()()()()()()()()()`,
    start: 2,
    delete: 0,
    insert: "0",
  },
  {
    name: "a third digit reclassifies a reference using the full number and mode",
    languages: allLanguages,
    before: String.raw`\10()()()()()()()()()()`,
    after: String.raw`\100()()()()()()()()()()`,
    start: 3,
    delete: 0,
    insert: "0",
  },
  {
    name: "appending a digit changes a null escape into an octal prefix",
    before: String.raw`\0`,
    after: String.raw`\08`,
    start: 2,
    delete: 0,
    insert: "8",
  },
  {
    name: "completing a hexadecimal spelling replaces its identity escape",
    before: String.raw`\x4`,
    after: String.raw`\x41`,
    start: 3,
    delete: 0,
    insert: "1",
  },
  {
    name: "completing a Unicode spelling replaces its identity escape",
    before: String.raw`\u004`,
    after: String.raw`\u0041`,
    start: 5,
    delete: 0,
    insert: "1",
  },
  {
    name: "an ASCII letter completes a body control escape",
    before: String.raw`\c`,
    after: String.raw`\cA`,
    start: 2,
    delete: 0,
    insert: "A",
  },
  {
    name: "a digit completes a class control escape",
    before: String.raw`[\c]`,
    after: String.raw`[\c1]`,
    start: 3,
    delete: 0,
    insert: "1",
  },
  {
    name: "a closing brace changes literal characters into an interval",
    before: "a{2",
    after: "a{2}",
    start: 3,
    delete: 0,
    insert: "}",
  },
  {
    name: "completing an operandless interval exposes the Annex B production",
    before: "{2",
    after: "{2}",
    start: 2,
    delete: 0,
    insert: "}",
  },
  {
    name: "editing before the initial token resets the whole pattern information",
    before: String.raw`\1(a)`,
    after: String.raw`x\1(a)`,
    start: 0,
    delete: 0,
    insert: "x",
  },
  {
    name: "inserting an empty alternative preserves expression precedence",
    languages: allLanguages,
    before: "a|b",
    after: "a||b",
    start: 2,
    delete: 0,
    insert: "|",
  },
  {
    name: "removing and restoring a group closer recovers the normal body",
    languages: allLanguages,
    before: "(a|b)c",
    after: "(a|bc",
    start: 4,
    delete: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "adding a leading class caret inserts a separate negation token",
    languages: allLanguages,
    before: "[a]",
    after: "[^a]",
    start: 1,
    delete: 0,
    insert: "^",
  },
  {
    name: "removing the first class member reclassifies a caret as negation",
    languages: allLanguages,
    before: "[a^]",
    after: "[^]",
    start: 1,
    delete: 1,
    insert: "",
  },
  {
    name: "editing a modifier preserves its scoped body",
    languages: allLanguages,
    before: "(?i:a)",
    after: "(?m:a)",
    start: 2,
    delete: 1,
    insert: "m",
  },
  {
    name: "an identifier edit after a multibyte character preserves the group delimiters",
    languages: allLanguages,
    before: "(?<名>a)",
    after: "(?<名x>a)",
    start: 6,
    delete: 0,
    insert: "x",
  },
  {
    name: "joining body surrogate escapes respects each language's character unit",
    languages: allLanguages,
    before: String.raw`\uD800x\uDC00+`,
    after: String.raw`\uD800\uDC00+`,
    start: 6,
    delete: 1,
    insert: "",
  },
  {
    name: "joining class surrogate escapes updates both their structure and ranges",
    languages: allLanguages,
    before: String.raw`[\uD800x\uDC00]`,
    after: String.raw`[\uD800\uDC00]`,
    start: 7,
    delete: 1,
    insert: "",
  },
  {
    name: "an edit on a later line preserves UTF-8 byte columns",
    languages: allLanguages,
    before: "a\nb",
    after: "a\n😀b",
    start: 2,
    delete: 0,
    insert: "😀",
  },
  {
    name: "a NUL source character does not terminate scanning before an edit",
    languages: allLanguages,
    before: "\0a",
    after: "\0😀a",
    start: 1,
    delete: 0,
    insert: "😀",
  },
  {
    name: "an interior U+FEFF source character remains a literal during edits",
    languages: allLanguages,
    before: "a\uFEFF",
    after: "a\uFEFFb",
    start: 4,
    delete: 0,
    insert: "b",
  },
  {
    name: "adding a body digit invalidates a Unicode null escape",
    languages: unicodeLanguages,
    before: String.raw`\0`,
    after: String.raw`\01`,
    start: 2,
    delete: 0,
    insert: "1",
    afterError: true,
  },

  {
    name: "adding a class digit invalidates a Unicode null escape",
    languages: unicodeLanguages,
    before: String.raw`[\0]`,
    after: String.raw`[\01]`,
    start: 3,
    delete: 0,
    insert: "1",
    afterError: true,
  },
  {
    name: "completing a code point escape removes its missing brace",
    languages: unicodeLanguages,
    before: String.raw`\u{41`,
    after: String.raw`\u{41}`,
    start: 5,
    delete: 0,
    insert: "}",
    beforeError: true,
  },
  {
    name: "removing and restoring a property closer updates syntax",
    languages: unicodeLanguages,
    before: String.raw`[\p{L}]`,
    after: String.raw`[\p{L]`,
    start: 5,
    delete: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "removing a non-BMP endpoint turns a basic class range into two members",
    languages: ["javascript_regex", "javascript_regex_u"],
    before: "[a-😀]",
    after: "[a-]",
    start: 3,
    delete: 4,
    insert: "",
  },
  {
    name: "a repeated reserved punctuation becomes an error inside a Unicode set",
    languages: ["javascript_regex_v"],
    before: "[!a]",
    after: "[!!a]",
    start: 2,
    delete: 0,
    insert: "!",
    afterError: true,
  },
  {
    name: "a second ampersand changes a union into an intersection",
    languages: ["javascript_regex_v"],
    before: "[a&b]",
    after: "[a&&b]",
    start: 3,
    delete: 0,
    insert: "&",
  },
  {
    name: "a third ampersand invalidates an intersection",
    languages: ["javascript_regex_v"],
    before: "[a&&b]",
    after: "[a&&&b]",
    start: 4,
    delete: 0,
    insert: "&",
    afterError: true,
  },
  {
    name: "reserved punctuation lookahead also updates inside a class string",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{!a}]`,
    after: String.raw`[\q{!!a}]`,
    start: 5,
    delete: 0,
    insert: "!",
    afterError: true,
  },
  {
    name: "escaping a class string separator merges its alternatives",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{a|b}]`,
    after: String.raw`[\q{a\|b}]`,
    start: 5,
    delete: 0,
    insert: "\\",
  },
  {
    name: "escaping an early class string closer changes the ownership of its suffix",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{a}b}]`,
    after: String.raw`[\q{a\}b}]`,
    start: 5,
    delete: 0,
    insert: "\\",
    beforeError: true,
  },
  {
    name: "removing and restoring a nested class closer updates syntax",
    languages: ["javascript_regex_v"],
    before: "[[a]&&[b]]",
    after: "[[a&&[b]]",
    start: 3,
    delete: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "an intersection edit after a non-BMP character uses a byte offset",
    languages: ["javascript_regex_v"],
    before: "[😀&b]",
    after: "[😀&&b]",
    start: 6,
    delete: 0,
    insert: "&",
  },
  {
    name: "a second hyphen changes a range into subtraction",
    languages: ["javascript_regex_v"],
    before: "[a-b]",
    after: "[a--b]",
    start: 3,
    delete: 0,
    insert: "-",
  },
  {
    name: "replacing both operator characters changes the set operation",
    languages: ["javascript_regex_v"],
    before: "[a&&b]",
    after: "[a--b]",
    start: 2,
    delete: 2,
    insert: "--",
  },
  {
    name: "a digit following a class string null escape requires recovery",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{\0}]`,
    after: String.raw`[\q{\00}]`,
    start: 6,
    delete: 0,
    insert: "0",
    afterError: true,
  },
];

function applyEdit(text, edit) {
  const bytes = Buffer.from(text);
  return Buffer.concat([
    bytes.subarray(0, edit.start),
    Buffer.from(edit.insert),
    bytes.subarray(edit.start + edit.delete),
  ]).toString();
}

for (const [index, scenario] of cases.entries()) {
  const beforeBytes = Buffer.from(scenario.before);
  const insertion = Buffer.from(scenario.insert);
  const removed = beforeBytes.subarray(
    scenario.start,
    scenario.start + scenario.delete,
  );
  assert.equal(
    applyEdit(scenario.before, scenario),
    scenario.after,
    scenario.name,
  );
  for (const language of scenario.languages ?? ["javascript_regex"]) {
    for (const reverse of [false, true]) {
      test(`${scenario.name} (${language}, ${reverse ? "reverse" : "forward"})`, () => {
        const before = reverse ? scenario.after : scenario.before;
        const afterText = reverse ? scenario.before : scenario.after;
        const expectedError = reverse
          ? scenario.beforeError
          : scenario.afterError;
        const edit = {
          start: scenario.start,
          delete: reverse ? insertion.length : scenario.delete,
          insert: reverse ? removed.toString() : scenario.insert,
        };
        const beforePath = join(cache, `${index}-before.txt`);
        const afterPath = join(cache, `${index}-after.txt`);
        writeFileSync(beforePath, before);
        writeFileSync(afterPath, afterText);
        const fresh = parseFile(afterPath, language);
        assert.equal(fresh.status, expectedError ? 1 : 0);
        const incremental = parseFile(beforePath, language, [edit]);
        assert.equal(incremental.status, fresh.status);
        if (!expectedError) assert.deepEqual(incremental, fresh);
      });
    }
  }
}

const histories = [
  {
    name: "a dangling backslash exposes its missing reference digit",
    languages: allLanguages,
    before: String.raw`()\1`,
    edits: [
      {
        name: "delete the reference digit",
        start: 3,
        delete: 1,
        insert: "",
        after: "()\\",
        error: true,
      },
      {
        name: "restore the reference digit",
        start: 3,
        delete: 0,
        insert: "1",
        after: String.raw`()\1`,
      },
    ],
  },
  {
    name: "ordinary capture state across successive edits",
    languages: ["javascript_regex"],
    before: String.raw`\k<x>(a)`,
    edits: [
      {
        name: "name a later capture",
        start: 6,
        delete: 0,
        insert: "?<x>",
        after: String.raw`\k<x>(?<x>a)`,
      },
      {
        name: "remove the named capture",
        start: 5,
        delete: 7,
        insert: "",
        after: String.raw`\k<x>`,
      },
      {
        name: "move the identity escape into a class",
        start: 0,
        delete: 5,
        insert: String.raw`[\k]`,
        after: String.raw`[\k]`,
      },
      {
        name: "make the earlier class escape invalid",
        start: 4,
        delete: 0,
        insert: "(?<x>a)",
        after: String.raw`[\k](?<x>a)`,
        error: true,
      },
      {
        name: "recover the earlier class escape",
        start: 4,
        delete: 7,
        insert: "",
        after: String.raw`[\k]`,
      },
    ],
  },
  {
    name: "Unicode character units across successive edits",
    languages: unicodeLanguages,
    before: String.raw`\uD800x\uDC00`,
    edits: [
      {
        name: "join a surrogate pair",
        start: 6,
        delete: 1,
        insert: "",
        after: String.raw`\uD800\uDC00`,
      },
      {
        name: "quantify the pair",
        start: 12,
        delete: 0,
        insert: "+",
        after: String.raw`\uD800\uDC00+`,
      },
      {
        name: "split the pair into two escapes",
        start: 3,
        delete: 1,
        insert: "C",
        after: String.raw`\uDC00\uDC00+`,
      },
    ],
  },
  {
    name: "Unicode set recovery across successive edits",
    languages: ["javascript_regex_v"],
    before: "[a&&b]",
    edits: [
      {
        name: "invalidate the intersection",
        start: 4,
        delete: 0,
        insert: "&",
        after: "[a&&&b]",
        error: true,
      },
      {
        name: "restore the intersection",
        start: 4,
        delete: 1,
        insert: "",
        after: "[a&&b]",
      },
      {
        name: "replace it with subtraction",
        start: 2,
        delete: 2,
        insert: "--",
        after: "[a--b]",
      },
      {
        name: "open an outer class",
        start: 0,
        delete: 0,
        insert: "[",
        after: "[[a--b]",
        error: true,
      },
      {
        name: "close the outer class",
        start: 7,
        delete: 0,
        insert: "]",
        after: "[[a--b]]",
      },
    ],
  },
];

for (const [index, history] of histories.entries()) {
  let current = history.before;
  for (const [step, edit] of history.edits.entries()) {
    assert.equal(applyEdit(current, edit), edit.after, edit.name);
    current = edit.after;
    for (const language of history.languages) {
      test(`${history.name}: ${edit.name} (${language})`, () => {
        const beforePath = join(cache, `history-${index}-before.txt`);
        const afterPath = join(cache, `history-${index}-after.txt`);
        writeFileSync(beforePath, history.before);
        writeFileSync(afterPath, edit.after);
        const fresh = parseFile(afterPath, language);
        assert.equal(fresh.status, edit.error ? 1 : 0);
        const incremental = parseFile(
          beforePath,
          language,
          history.edits.slice(0, step + 1),
        );
        assert.equal(incremental.status, fresh.status);
        if (!edit.error) assert.deepEqual(incremental, fresh);
      });
    }
  }
}

const profiles = [
  {
    name: "javascript_regex",
    path: "javascript_regex",
    scope: "source.javascript-regex",
    unicode: false,
    sets: false,
  },
  {
    name: "javascript_regex_u",
    path: "javascript_regex_u",
    scope: "source.javascript-regex.u",
    unicode: true,
    sets: false,
  },
  {
    name: "javascript_regex_v",
    path: "javascript_regex_v",
    scope: "source.javascript-regex.v",
    unicode: true,
    sets: true,
  },
];

for (const profile of profiles) {
  const nodes = JSON.parse(
    readFileSync(join(root, profile.path, "src", "node-types.json"), "utf8"),
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

for (const language of allLanguages) {
  test(`${language}: replacing every fragment at every position preserves incremental CST`, () => {
    const fragments = ["a", "b", "(c)", "[d-f]", String.raw`\d`, "x?"];
    const parts = ["a", "b", "(c)"];
    const beforePath = join(cache, "generated-before.txt");
    const afterPath = join(cache, "generated-after.txt");
    writeFileSync(beforePath, parts.join(""));
    const edits = [];
    for (const insert of fragments) {
      for (let index = 0; index < parts.length; index++) {
        edits.push({
          start: parts.slice(0, index).join("").length,
          delete: parts[index].length,
          insert,
        });
        parts[index] = insert;
        writeFileSync(afterPath, parts.join(""));
        const fresh = parseFile(afterPath, language);
        assert.equal(fresh.status, 0);
        assert.deepEqual(
          parseFile(beforePath, language, edits),
          fresh,
          `${JSON.stringify(insert)} at position ${index}`,
        );
      }
    }
  });
}

const start = new RegExp(`^${unicodeIdStart}$`, "u");
const continuation = new RegExp(`^${unicodeIdContinue}$`, "u");

test("Unicode 17 identifiers include the new scripts and distinguish letters, marks, digits, and gaps", () => {
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

test("Unicode properties preserve the distinction from ECMAScript identifier additions", () => {
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

test("generated classes contain the published Unicode 17 property totals", () => {
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

for (const language of allLanguages) {
  test(`${language}: NUL, interior FEFF and non-BMP characters retain source byte ranges`, () => {
    const path = join(cache, "source-characters.txt");
    writeFileSync(path, "a\uFEFF\0[\0]😀");
    const result = parseFile(path, language);
    assert.equal(result.status, 0);
    const ranges = [
      ...result.cst.matchAll(
        /^([0-9]+:[0-9]+) +- +([0-9]+:[0-9]+) +source_character `/gm,
      ),
    ].map((match) => [match[1], match[2]]);
    assert.deepEqual(ranges, [
      ["0:0", "0:1"],
      ["0:1", "0:4"],
      ["0:4", "0:5"],
      ["0:6", "0:7"],
      ["0:8", "0:12"],
    ]);
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

const pythonGrammars = grammars.filter(
  ({ name }) => name === "python_re" || name === "python_re_verbose",
);

function parse(grammar, source, edits = []) {
  const path = join(cache, "pattern.txt");
  writeFileSync(path, source);
  const result = parseFile(
    path,
    grammar.name,
    edits.map(({ byte, deleteBytes, insert }) => ({
      start: byte,
      delete: deleteBytes,
      insert,
    })),
  );
  return { status: result.status, rows: result.cst.split("\n") };
}

function selectNodes(result, labels) {
  const stack = [];
  const selected = [];
  for (const line of result.rows) {
    const match = /^([0-9]+:[0-9]+) +- +([0-9]+:[0-9]+) +/.exec(line);
    assert.ok(match, line);
    const column = match[0].length;
    const label = line.slice(column);
    while (stack.length > 0 && stack.at(-1).column >= column) {
      stack.pop();
    }
    if (labels.includes(label)) {
      selected.push([label, `${match[1]}-${match[2]}`, stack.at(-1)?.label]);
    }
    stack.push({ column, label });
  }
  return selected;
}

function applyEdits(source, edits) {
  let bytes = Buffer.from(source);
  for (const { byte, deleteBytes, insert } of edits) {
    bytes = Buffer.concat([
      bytes.subarray(0, byte),
      Buffer.from(insert),
      bytes.subarray(byte + deleteBytes),
    ]);
  }
  return bytes.toString("utf8");
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

const incrementalCases = [
  {
    name: "changing global flags reclassifies trailing whitespace and comments",
    source: "(?i)a #c\nb",
    edited: "(?x)a #c\nb",
    edit: { byte: 2, deleteBytes: 1, insert: "x" },
    reverse: { byte: 2, deleteBytes: 1, insert: "i" },
  },
  {
    name: "disabling a scoped flag restores the outer mode after the group",
    source: "(?x:a b)c d",
    edited: "(?-x:a b)c d",
    edit: { byte: 2, deleteBytes: 1, insert: "-x" },
    reverse: { byte: 2, deleteBytes: 2, insert: "x" },
  },
  {
    name: "nested scoped mode edits invalidate descendants without leaking outward",
    source: "(?x:a(?-x:b c)d e)f g",
    edited: "(?x:a(?x:b c)d e)f g",
    edit: { byte: 7, deleteBytes: 1, insert: "" },
    reverse: { byte: 7, deleteBytes: 0, insert: "-" },
  },
  {
    name: "completing a global flag introducer changes layout classification",
    source: "(?x a b",
    edited: "(?x) a b",
    edit: { byte: 3, deleteBytes: 0, insert: ")" },
    reverse: { byte: 3, deleteBytes: 1, insert: "" },
  },
  {
    name: "an escaped LF extends a verbose comment across the next line",
    source: "(?x)a#c\nb|z",
    edited: "(?x)a#c\\\nb|z",
    edit: { byte: 7, deleteBytes: 0, insert: "\\" },
    reverse: { byte: 7, deleteBytes: 1, insert: "" },
  },
  {
    name: "closing a character class restores verbose layout after its bracket",
    source: "(?x)[a #] b",
    edited: "(?x)[a] #] b",
    edit: { byte: 6, deleteBytes: 0, insert: "]" },
    reverse: { byte: 6, deleteBytes: 1, insert: "" },
  },
  {
    name: "repairing a name introducer preserves the enclosing group boundary",
    source: "(?P<n>a",
    edited: "(?P<n>a)",
    edit: { byte: 7, deleteBytes: 0, insert: ")" },
    reverse: { byte: 7, deleteBytes: 1, insert: "" },
  },
  {
    name: "repairing a hexadecimal escape preserves the following alternative",
    source: String.raw`(\x0)|z`,
    edited: String.raw`(\x01)|z`,
    edit: { byte: 4, deleteBytes: 0, insert: "1" },
    reverse: { byte: 4, deleteBytes: 1, insert: "" },
  },
  {
    name: "removing an extra conditional separator keeps the real closer",
    source: "(?(1)a|b|c)|z",
    edited: "(?(1)a|bc)|z",
    edit: { byte: 8, deleteBytes: 1, insert: "" },
    reverse: { byte: 8, deleteBytes: 0, insert: "|" },
  },
  {
    name: "completing an interval reclassifies literal braces as a quantifier",
    source: "a{2",
    edited: "a{2}",
    edit: { byte: 3, deleteBytes: 0, insert: "}" },
    reverse: { byte: 3, deleteBytes: 1, insert: "" },
  },
  {
    name: "a third octal digit changes a numeric backreference into an escape",
    source: String.raw`\12|z`,
    edited: String.raw`\123|z`,
    edit: { byte: 3, deleteBytes: 0, insert: "3" },
    reverse: { byte: 3, deleteBytes: 1, insert: "" },
  },
  {
    name: "UTF-8 edits update byte ranges before a repeated atom",
    source: "é😀+|z",
    edited: "éa+|z",
    edit: { byte: 2, deleteBytes: 4, insert: "a" },
    reverse: { byte: 2, deleteBytes: 1, insert: "😀" },
  },
  {
    name: "adding real closers completes nested groups",
    source: "((a",
    edited: "((a))",
    edit: { byte: 3, deleteBytes: 0, insert: "))" },
    reverse: { byte: 3, deleteBytes: 2, insert: "" },
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
  for (const { name, languages, source } of malformedCases) {
    if (!languages.includes(grammar.name)) continue;
    test(`${grammar.name}: malformed ${name} uses standard recovery`, () => {
      assert.equal(parse(grammar, source).status, 1);
    });
  }

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

  for (const { name, source, edited, edit, reverse } of incrementalCases) {
    test(`${grammar.name}: incremental ${name}`, () => {
      assert.equal(applyEdits(source, [edit]), edited);
      assert.equal(applyEdits(edited, [reverse]), source);
      const original = parse(grammar, source);
      const changed = parse(grammar, edited);
      assert.equal(
        changed.status,
        0,
        "the completed source must parse without recovery",
      );
      assert.deepEqual(parse(grammar, source, [edit]), changed, "forward edit");
      const reversed = parse(grammar, edited, [reverse]);
      const roundTrip = parse(grammar, source, [edit, reverse]);
      if (original.status === 0) {
        assert.deepEqual(reversed, original, "reverse edit");
        assert.deepEqual(roundTrip, original, "edit and undo");
      }
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

for (const grammar of pythonGrammars.slice(1)) {
  test(`${grammar.name}: public nodes and fields match ${pythonGrammars[0].name}`, () => {
    assert.deepEqual(publicSchema(grammar), publicSchema(pythonGrammars[0]));
  });
}

for (const grammar of pythonGrammars) {
  test(`${grammar.name}: NUL, interior FEFF and non-BMP characters retain source byte ranges`, () => {
    const result = parse(grammar, "a\uFEFF\0[\0]😀");
    assert.equal(result.status, 0);
    const ranges = result.rows.flatMap((line) => {
      const match =
        /^([0-9]+:[0-9]+) +- +([0-9]+:[0-9]+) +(literal_character|class_character) `/.exec(
          line,
        );
      return match ? [[match[3], match[1], match[2]]] : [];
    });
    assert.deepEqual(ranges, [
      ["literal_character", "0:0", "0:1"],
      ["literal_character", "0:1", "0:4"],
      ["literal_character", "0:4", "0:5"],
      ["class_character", "0:6", "0:7"],
      ["literal_character", "0:8", "0:12"],
    ]);
  });

  test(`${grammar.name}: scoped flags support 2048 nested alternating verbose modes`, () => {
    const depth = 2048;
    const headers = Array.from({ length: depth }, (_, index) =>
      index % 2 === 0 ? "(?x:" : "(?-x:",
    ).join("");
    const source = `${headers}a b${") ".repeat(depth)}`;
    const path = join(cache, "deep-scopes.txt");
    writeFileSync(path, source);
    const result = runner.run(
      ["parse", "--quiet", "--scope", grammar.scope, path],
      { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
