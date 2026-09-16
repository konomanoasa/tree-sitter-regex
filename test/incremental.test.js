import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import {
  applyEdits,
  cache,
  javascriptLanguages,
  parse,
  parseFile,
  pythonGrammars,
  selectNodes,
  unicodeLanguages,
} from "./support/parser.js";

const cases = [
  {
    name: "editing an empty pattern initializes capture information from the new source",
    before: "",
    after: String.raw`\1()`,
    byte: 0,
    deleteBytes: 0,
    insert: String.raw`\1()`,
  },
  {
    name: "a capture appended at EOF changes an earlier octal escape",
    before: String.raw`\1`,
    after: String.raw`\1()`,
    byte: 2,
    deleteBytes: 0,
    insert: "()",
  },
  {
    name: "a later second capture changes a decimal escape before both groups",
    before: String.raw`\2(a)`,
    after: String.raw`\2(a)(b)`,
    byte: 5,
    deleteBytes: 0,
    insert: "(b)",
  },
  {
    name: "changing a later noncapture into a capture updates earlier escapes",
    before: String.raw`\1(?:a)`,
    after: String.raw`\1(a)`,
    byte: 3,
    deleteBytes: 2,
    insert: "",
  },
  {
    name: "a later ninth capture changes an identity escape into a reference",
    before: String.raw`\9()()()()()()()()`,
    after: String.raw`\9()()()()()()()()()`,
    byte: 18,
    deleteBytes: 0,
    insert: "()",
  },
  {
    name: "a named capture appended at EOF changes an earlier k escape",
    before: String.raw`\k<x>`,
    after: String.raw`\k<x>(?<x>a)`,
    byte: 5,
    deleteBytes: 0,
    insert: "(?<x>a)",
  },
  {
    name: "naming an existing capture changes an earlier k escape",
    before: String.raw`\k<x>(a)`,
    after: String.raw`\k<x>(?<x>a)`,
    byte: 6,
    deleteBytes: 0,
    insert: "?<x>",
  },
  {
    name: "a later named capture invalidates an earlier class k identity escape",
    before: String.raw`[\k](a)`,
    after: String.raw`[\k](?<x>a)`,
    byte: 5,
    deleteBytes: 0,
    insert: "?<x>",
    afterError: true,
  },
  {
    name: "escaping a class opener exposes a later capture to the whole pattern scan",
    before: String.raw`\1[(a)]`,
    after: String.raw`\1\[(a)]`,
    byte: 2,
    deleteBytes: 0,
    insert: "\\",
  },
  {
    name: "removing and restoring a class closer updates capture classification",
    before: String.raw`\1[a](b)`,
    after: String.raw`\1[a(b)`,
    byte: 4,
    deleteBytes: 1,
    insert: "",
    afterError: true,
  },

  {
    name: "a later capture changes references across non-BMP source bytes",
    before: String.raw`😀\1x`,
    after: String.raw`😀\1x()`,
    byte: 7,
    deleteBytes: 0,
    insert: "()",
  },
  {
    name: "a second digit changes a valid reference into an octal escape",
    before: String.raw`\1(a)`,
    after: String.raw`\11(a)`,
    byte: 2,
    deleteBytes: 0,
    insert: "1",
  },
  {
    name: "a second digit extends a reference when the full number has a capture",
    languages: javascriptLanguages,
    before: String.raw`\1()()()()()()()()()()`,
    after: String.raw`\10()()()()()()()()()()`,
    byte: 2,
    deleteBytes: 0,
    insert: "0",
  },
  {
    name: "a third digit reclassifies a reference using the full number and mode",
    languages: javascriptLanguages,
    before: String.raw`\10()()()()()()()()()()`,
    after: String.raw`\100()()()()()()()()()()`,
    byte: 3,
    deleteBytes: 0,
    insert: "0",
  },
  {
    name: "appending a digit changes a null escape into an octal prefix",
    before: String.raw`\0`,
    after: String.raw`\08`,
    byte: 2,
    deleteBytes: 0,
    insert: "8",
  },
  {
    name: "completing a hexadecimal spelling replaces its identity escape",
    before: String.raw`\x4`,
    after: String.raw`\x41`,
    byte: 3,
    deleteBytes: 0,
    insert: "1",
  },
  {
    name: "completing a Unicode spelling replaces its identity escape",
    before: String.raw`\u004`,
    after: String.raw`\u0041`,
    byte: 5,
    deleteBytes: 0,
    insert: "1",
  },
  {
    name: "an ASCII letter completes a body control escape",
    before: String.raw`\c`,
    after: String.raw`\cA`,
    byte: 2,
    deleteBytes: 0,
    insert: "A",
  },
  {
    name: "a digit completes a class control escape",
    before: String.raw`[\c]`,
    after: String.raw`[\c1]`,
    byte: 3,
    deleteBytes: 0,
    insert: "1",
  },
  {
    name: "a closing brace changes literal characters into an interval",
    before: "a{2",
    after: "a{2}",
    byte: 3,
    deleteBytes: 0,
    insert: "}",
  },
  {
    name: "completing an operandless interval exposes the Annex B production",
    before: "{2",
    after: "{2}",
    byte: 2,
    deleteBytes: 0,
    insert: "}",
  },
  {
    name: "editing before the initial token resets the whole pattern information",
    before: String.raw`\1(a)`,
    after: String.raw`x\1(a)`,
    byte: 0,
    deleteBytes: 0,
    insert: "x",
  },
  {
    name: "inserting an empty alternative preserves expression precedence",
    languages: javascriptLanguages,
    before: "a|b",
    after: "a||b",
    byte: 2,
    deleteBytes: 0,
    insert: "|",
  },
  {
    name: "removing and restoring a group closer recovers the normal body",
    languages: javascriptLanguages,
    before: "(a|b)c",
    after: "(a|bc",
    byte: 4,
    deleteBytes: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "adding a leading class caret inserts a separate negation token",
    languages: javascriptLanguages,
    before: "[a]",
    after: "[^a]",
    byte: 1,
    deleteBytes: 0,
    insert: "^",
  },
  {
    name: "removing the first class member reclassifies a caret as negation",
    languages: javascriptLanguages,
    before: "[a^]",
    after: "[^]",
    byte: 1,
    deleteBytes: 1,
    insert: "",
  },
  {
    name: "editing a modifier preserves its scoped body",
    languages: javascriptLanguages,
    before: "(?i:a)",
    after: "(?m:a)",
    byte: 2,
    deleteBytes: 1,
    insert: "m",
  },
  {
    name: "an identifier edit after a multibyte character preserves the group delimiters",
    languages: javascriptLanguages,
    before: "(?<名>a)",
    after: "(?<名x>a)",
    byte: 6,
    deleteBytes: 0,
    insert: "x",
  },
  {
    name: "joining body surrogate escapes respects each language's character unit",
    languages: javascriptLanguages,
    before: String.raw`\uD800x\uDC00+`,
    after: String.raw`\uD800\uDC00+`,
    byte: 6,
    deleteBytes: 1,
    insert: "",
  },
  {
    name: "joining class surrogate escapes updates both their structure and ranges",
    languages: javascriptLanguages,
    before: String.raw`[\uD800x\uDC00]`,
    after: String.raw`[\uD800\uDC00]`,
    byte: 7,
    deleteBytes: 1,
    insert: "",
  },
  {
    name: "an edit on a later line preserves UTF-8 byte columns",
    languages: javascriptLanguages,
    before: "a\nb",
    after: "a\n😀b",
    byte: 2,
    deleteBytes: 0,
    insert: "😀",
  },
  {
    name: "a NUL source character does not terminate scanning before an edit",
    languages: javascriptLanguages,
    before: "\0a",
    after: "\0😀a",
    byte: 1,
    deleteBytes: 0,
    insert: "😀",
  },
  {
    name: "an interior U+FEFF source character remains a literal during edits",
    languages: javascriptLanguages,
    before: "a\uFEFF",
    after: "a\uFEFFb",
    byte: 4,
    deleteBytes: 0,
    insert: "b",
  },
  {
    name: "adding a body digit invalidates a Unicode null escape",
    languages: unicodeLanguages,
    before: String.raw`\0`,
    after: String.raw`\01`,
    byte: 2,
    deleteBytes: 0,
    insert: "1",
    afterError: true,
  },

  {
    name: "adding a class digit invalidates a Unicode null escape",
    languages: unicodeLanguages,
    before: String.raw`[\0]`,
    after: String.raw`[\01]`,
    byte: 3,
    deleteBytes: 0,
    insert: "1",
    afterError: true,
  },
  {
    name: "completing a code point escape removes its missing brace",
    languages: unicodeLanguages,
    before: String.raw`\u{41`,
    after: String.raw`\u{41}`,
    byte: 5,
    deleteBytes: 0,
    insert: "}",
    beforeError: true,
  },
  {
    name: "removing and restoring a property closer updates syntax",
    languages: unicodeLanguages,
    before: String.raw`[\p{L}]`,
    after: String.raw`[\p{L]`,
    byte: 5,
    deleteBytes: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "removing a non-BMP endpoint turns a basic class range into two members",
    languages: ["javascript_regex", "javascript_regex_u"],
    before: "[a-😀]",
    after: "[a-]",
    byte: 3,
    deleteBytes: 4,
    insert: "",
  },
  {
    name: "a repeated reserved punctuation becomes an error inside a Unicode set",
    languages: ["javascript_regex_v"],
    before: "[!a]",
    after: "[!!a]",
    byte: 2,
    deleteBytes: 0,
    insert: "!",
    afterError: true,
  },
  {
    name: "a second ampersand changes a union into an intersection",
    languages: ["javascript_regex_v"],
    before: "[a&b]",
    after: "[a&&b]",
    byte: 3,
    deleteBytes: 0,
    insert: "&",
  },
  {
    name: "a third ampersand invalidates an intersection",
    languages: ["javascript_regex_v"],
    before: "[a&&b]",
    after: "[a&&&b]",
    byte: 4,
    deleteBytes: 0,
    insert: "&",
    afterError: true,
  },
  {
    name: "reserved punctuation lookahead also updates inside a class string",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{!a}]`,
    after: String.raw`[\q{!!a}]`,
    byte: 5,
    deleteBytes: 0,
    insert: "!",
    afterError: true,
  },
  {
    name: "escaping a class string separator merges its alternatives",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{a|b}]`,
    after: String.raw`[\q{a\|b}]`,
    byte: 5,
    deleteBytes: 0,
    insert: "\\",
  },
  {
    name: "escaping an early class string closer changes the ownership of its suffix",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{a}b}]`,
    after: String.raw`[\q{a\}b}]`,
    byte: 5,
    deleteBytes: 0,
    insert: "\\",
    beforeError: true,
  },
  {
    name: "removing and restoring a nested class closer updates syntax",
    languages: ["javascript_regex_v"],
    before: "[[a]&&[b]]",
    after: "[[a&&[b]]",
    byte: 3,
    deleteBytes: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "an intersection edit after a non-BMP character uses a byte offset",
    languages: ["javascript_regex_v"],
    before: "[😀&b]",
    after: "[😀&&b]",
    byte: 6,
    deleteBytes: 0,
    insert: "&",
  },
  {
    name: "a second hyphen changes a range into subtraction",
    languages: ["javascript_regex_v"],
    before: "[a-b]",
    after: "[a--b]",
    byte: 3,
    deleteBytes: 0,
    insert: "-",
  },
  {
    name: "replacing both operator characters changes the set operation",
    languages: ["javascript_regex_v"],
    before: "[a&&b]",
    after: "[a--b]",
    byte: 2,
    deleteBytes: 2,
    insert: "--",
  },
  {
    name: "a digit following a class string null escape requires recovery",
    languages: ["javascript_regex_v"],
    before: String.raw`[\q{\0}]`,
    after: String.raw`[\q{\00}]`,
    byte: 6,
    deleteBytes: 0,
    insert: "0",
    afterError: true,
  },
];

for (const [index, scenario] of cases.entries()) {
  const beforeBytes = Buffer.from(scenario.before);
  const insertion = Buffer.from(scenario.insert);
  const removed = beforeBytes.subarray(
    scenario.byte,
    scenario.byte + scenario.deleteBytes,
  );
  assert.equal(
    applyEdits(scenario.before, [scenario]).toString("utf8"),
    scenario.after,
    scenario.name,
  );
  for (const language of scenario.languages ?? ["javascript_regex"]) {
    for (const reverse of [false, true]) {
      test(`${language}: ${scenario.name} (${reverse ? "reverse" : "forward"})`, () => {
        const before = reverse ? scenario.after : scenario.before;
        const afterText = reverse ? scenario.before : scenario.after;
        const expectedError = reverse
          ? scenario.beforeError
          : scenario.afterError;
        const edit = {
          byte: scenario.byte,
          deleteBytes: reverse ? insertion.length : scenario.deleteBytes,
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
    languages: javascriptLanguages,
    before: String.raw`()\1`,
    edits: [
      {
        name: "delete the reference digit",
        byte: 3,
        deleteBytes: 1,
        insert: "",
        after: "()\\",
        error: true,
      },
      {
        name: "restore the reference digit",
        byte: 3,
        deleteBytes: 0,
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
        byte: 6,
        deleteBytes: 0,
        insert: "?<x>",
        after: String.raw`\k<x>(?<x>a)`,
      },
      {
        name: "remove the named capture",
        byte: 5,
        deleteBytes: 7,
        insert: "",
        after: String.raw`\k<x>`,
      },
      {
        name: "move the identity escape into a class",
        byte: 0,
        deleteBytes: 5,
        insert: String.raw`[\k]`,
        after: String.raw`[\k]`,
      },
      {
        name: "make the earlier class escape invalid",
        byte: 4,
        deleteBytes: 0,
        insert: "(?<x>a)",
        after: String.raw`[\k](?<x>a)`,
        error: true,
      },
      {
        name: "recover the earlier class escape",
        byte: 4,
        deleteBytes: 7,
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
        byte: 6,
        deleteBytes: 1,
        insert: "",
        after: String.raw`\uD800\uDC00`,
      },
      {
        name: "quantify the pair",
        byte: 12,
        deleteBytes: 0,
        insert: "+",
        after: String.raw`\uD800\uDC00+`,
      },
      {
        name: "split the pair into two escapes",
        byte: 3,
        deleteBytes: 1,
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
        byte: 4,
        deleteBytes: 0,
        insert: "&",
        after: "[a&&&b]",
        error: true,
      },
      {
        name: "restore the intersection",
        byte: 4,
        deleteBytes: 1,
        insert: "",
        after: "[a&&b]",
      },
      {
        name: "replace it with subtraction",
        byte: 2,
        deleteBytes: 2,
        insert: "--",
        after: "[a--b]",
      },
      {
        name: "open an outer class",
        byte: 0,
        deleteBytes: 0,
        insert: "[",
        after: "[[a--b]",
        error: true,
      },
      {
        name: "close the outer class",
        byte: 7,
        deleteBytes: 0,
        insert: "]",
        after: "[[a--b]]",
      },
    ],
  },
];

for (const [index, history] of histories.entries()) {
  let current = history.before;
  for (const [step, edit] of history.edits.entries()) {
    assert.equal(
      applyEdits(current, [edit]).toString("utf8"),
      edit.after,
      edit.name,
    );
    current = edit.after;
    for (const language of history.languages) {
      test(`${language}: ${history.name}: ${edit.name}`, () => {
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

for (const language of javascriptLanguages) {
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
          byte: parts.slice(0, index).join("").length,
          deleteBytes: parts[index].length,
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
for (const grammar of pythonGrammars) {
  for (const { name, source, edited, edit, reverse } of incrementalCases) {
    test(`${grammar.name}: incremental ${name}`, () => {
      assert.equal(applyEdits(source, [edit]).toString("utf8"), edited);
      assert.equal(applyEdits(edited, [reverse]).toString("utf8"), source);
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

function createEditHistoryGenerator() {
  let seed = 1n;
  function next(maximum) {
    seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1n);
    return Number(seed >> 32n) % maximum;
  }
  return function* (fragments, insertions, joinSource) {
    for (let iteration = 0; iteration < 100; iteration++) {
      const parts = [];
      const count = 1 + next(3);
      for (let part = 0; part < count; part++) {
        parts.push(fragments[next(fragments.length)]);
      }
      const initial = joinSource(parts);
      let source = Buffer.from(initial);
      const edits = [];
      for (let step = 0; step < 5; step++) {
        const position = next(source.length + 1);
        const insert = next(2) === 0 || position === source.length;
        const edit = insert
          ? {
              byte: position,
              deleteBytes: 0,
              insert: insertions[next(insertions.length)],
            }
          : {
              byte: position,
              deleteBytes: Math.min(next(2) + 1, source.length - position),
              insert: "",
            };
        edits.push(edit);
        source = applyEdits(source, [edit]);
        yield {
          initial,
          source,
          edits: [...edits],
          context: `seed 1, iteration ${iteration}, source ${JSON.stringify(initial)}, edits ${JSON.stringify(edits)}`,
        };
      }
    }
  };
}

const fuzzFragments = [
  "a",
  ".",
  "[abc]",
  "(a|b)",
  "a*",
  "^a$",
  "\\d+",
  "(?:a)",
  "a{1,3}",
  "[^a]",
  "",
  "(",
  "[",
  "\\",
  "a**",
  "(a)\\1",
];

const fuzzInsertions = "abcxyz12!{}();,\n\\/*[]().^$|+?-:=# \t<>";

test("regex: fixed-seed generated histories converge", (context) => {
  const generateHistories = createEditHistoryGenerator();
  for (const grammar of grammars) {
    const fragments = [...fuzzFragments];
    if (grammar.name.startsWith("javascript_regex")) {
      fragments.push("(?<name>a)\\k<name>");
      if (grammar.name === "javascript_regex") fragments.push("\\8", "{x}");
      else fragments.push("\\u{61}", "\\p{L}");
      if (grammar.name === "javascript_regex_v")
        fragments.push("[a&&b]", "[a--b]", "[\\q{ab|cd}]");
    } else {
      fragments.push(
        "(?P<name>a)(?P=name)",
        "(?x:a #c\nb)",
        "(?#note)",
        "(?>a)",
        "(?(1)a|b)",
      );
    }
    let checked = 0;
    let compared = 0;
    for (const history of generateHistories(
      fragments,
      fuzzInsertions,
      (parts) => parts.join(""),
    )) {
      const label = `${grammar.name}: ${history.context}`;
      const fresh = parse(grammar, history.source);
      const incremental = parse(grammar, history.initial, history.edits);
      if (fresh.status === 0) {
        assert.equal(incremental.status, 0, label);
        assert.deepEqual(incremental.rows, fresh.rows, label);
        compared += 1;
      }
      checked += 1;
    }
    assert.equal(checked, 500);
    assert.ok(compared > 0);
    context.diagnostic(
      `${grammar.name}: checked ${checked} generated edit states, compared ${compared} valid CSTs`,
    );
  }
});

for (const grammar of grammars) {
  test(`${grammar.name}: every byte inside a Unicode payload can be deleted and repaired through an edit history`, () => {
    const prefix = "(";
    const suffix = ")+|z";
    const source = "(é😀)+|z";
    const changed = "(x)+|z";
    const payloadByte = 1;
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
        { byte: payloadByte, deleteBytes: 5, insert: "é😀" },
        { byte: payloadByte, deleteBytes: 6, insert: "x" },
        { byte: payloadByte, deleteBytes: 1, insert: "é😀" },
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
        const owner =
          grammar.name === "javascript_regex"
            ? "operand: extended_atom"
            : grammar.name.startsWith("javascript_regex")
              ? "operand: atom"
              : "operand: capturing_group";
        const end = step === 2 ? 2 : 7;
        for (const result of [fresh, incremental]) {
          assert.equal(result.status, 0, label);
          assert.deepEqual(
            selectNodes(result, ['")"']),
            [['")"', `0:${end}-0:${end + 1}`, owner]],
            label,
          );
        }
        assert.deepEqual(incremental.rows, fresh.rows, label);
      }
    }
  });
}
