import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { hasRecovery, selectNodes } from "./support/cst.js";
import {
  applyEdits,
  cache,
  ecmaregexLanguages,
  parse,
  parseFile,
  parseSequence,
  posixGrammars,
  pyregexGrammars,
  unicodeLanguages,
} from "./support/parser.js";

const pcre2Grammar = grammars.find(({ name }) => name === "pcre2");

const fuzzSeed = 1n;
const historiesPerSource = 2;
const editsPerHistory = 4;
const maximumDeletionBytes = 2;
const undoChanceDenominator = 3;
const randomStateBits = 64;
const randomOutputShift = 32n;
const randomMultiplier = 6364136223846793005n;
const randomIncrement = 1n;

for (const grammar of grammars.filter(({ name }) =>
  [
    "pcre2",
    "posix_bre",
    "posix_ere",
    "pyregex",
    "pyregex_verbose",
    "ecmaregex_u",
    "ecmaregex_v",
  ].includes(name),
)) {
  test(`${grammar.name}: long concatenations preserve CST through UTF-8 edits and undo`, () => {
    const repetitions = 256;
    const units = ["a", "a[bc]*d"];
    if (grammar.name.startsWith("ecmaregex"))
      units.push("a{2,3}?b", String.raw`a\u{41}b`, "a(?<x>b)c");
    if (grammar.name === "posix_bre")
      units.push(String.raw`a\{2,3\}b`, String.raw`a\(bc\)d`);
    const wrappers = [["", ""]];
    if (grammar.name === "posix_bre")
      wrappers.push([String.raw`x\(`, String.raw`\)y`]);
    for (const unit of units) {
      for (const [opening, closing] of wrappers) {
        const source = `${opening}${unit.repeat(repetitions)}${closing}`;
        const original = parse(grammar, source);
        assert.equal(original.status, 0);
        for (const index of [0, repetitions / 2, repetitions - 1]) {
          const byte = opening.length + index * unit.length;
          const edited = `${source.slice(0, byte)}é${source.slice(byte + 1)}`;
          const forward = { byte, deleteBytes: 1, insert: "é" };
          const reverse = { byte, deleteBytes: 2, insert: "a" };
          const expected = parse(grammar, edited);
          assert.equal(expected.status, 0);
          assert.deepEqual(parse(grammar, source, [forward]), expected);
          assert.deepEqual(
            parse(grammar, source, [forward, reverse]),
            original,
          );
        }
      }
    }
  });
}

for (const language of ecmaregexLanguages) {
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
          byte: Buffer.byteLength(parts.slice(0, index).join("")),
          deleteBytes: Buffer.byteLength(parts[index]),
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

function createEditHistoryGenerator() {
  let seed = fuzzSeed;
  function next(maximum) {
    seed = BigInt.asUintN(
      randomStateBits,
      seed * randomMultiplier + randomIncrement,
    );
    return Number(seed >> randomOutputShift) % maximum;
  }
  return function* (sources, insertions) {
    const historyCount = sources.length * historiesPerSource;
    for (let iteration = 0; iteration < historyCount; iteration++) {
      const initial = sources[iteration % sources.length];
      let source = Buffer.from(initial);
      const edits = [];
      let undo;
      for (let step = 0; step < editsPerHistory; step++) {
        let edit;
        if (undo !== undefined && next(undoChanceDenominator) === 0) {
          edit = undo;
        } else {
          const position = next(source.length + 1);
          const insert = next(2) === 0 || position === source.length;
          edit = insert
            ? {
                byte: position,
                deleteBytes: 0,
                insert: insertions[next(insertions.length)],
              }
            : {
                byte: position,
                deleteBytes: Math.min(
                  next(maximumDeletionBytes) + 1,
                  source.length - position,
                ),
                insert: "",
              };
        }
        undo = {
          byte: edit.byte,
          deleteBytes: Buffer.byteLength(edit.insert),
          insert: source
            .subarray(edit.byte, edit.byte + edit.deleteBytes)
            .toString(),
        };
        edits.push(edit);
        source = applyEdits(source, [edit]);
        yield {
          initial,
          source,
          edits: [...edits],
          context: `seed ${fuzzSeed}, iteration ${iteration}, source ${JSON.stringify(initial)}, edits ${JSON.stringify(edits)}`,
        };
      }
    }
  };
}

const reproducedSources = {
  pcre2: [
    String.raw`(?xx)(?<x>a)\k<x>[a b]`,
    String.raw`(?|(a)|(b))\11`,
    String.raw`\Q(a)\E+`,
    "(*CR)(?x)#comment\na\rb",
    "(?<x>",
  ],
  ecmascript: [
    String.raw`(?<x>a)\k<x>[b-d]{2,}`,
    String.raw`\1`,
    String.raw`\u{41}|(a`,
    "[a-",
    "a**",
  ],
  python: [
    "(?x)(?P<n>a)(?P=n) #c\nb",
    "(?(1)a|b",
    String.raw`\N{NAME`,
    "a{ 2}|*b",
  ],
  posix: ["[[:alpha:]]a*", "[[.ch", "[a-]x", "a\\"],
};

for (const grammar of grammars) {
  test(`${grammar.name}: parsing after other sources reproduces every CST including recovery artifacts`, () => {
    const sources = reproducedSources[grammar.path.split("/")[0]];
    assert.ok(sources, grammar.name);
    const paths = sources.map((source, index) => {
      const path = join(cache, `reproduced-${index}.txt`);
      writeFileSync(path, source);
      return path;
    });
    const alone = paths.flatMap((path) =>
      parseFile(path, grammar.name).cst.split("\n"),
    );
    assert.ok(
      hasRecovery(alone.join("\n")),
      "the sources must cover recovery artifacts",
    );
    assert.deepEqual(
      parseSequence([...paths, ...paths], grammar.name),
      [...alone, ...alone],
      "an earlier source must not change a later CST",
    );
  });
}

const fuzzInsertions = "abcxyz12!{}();,\n\\/*[]().^$|+?-:=# \t<>";

test("regex: fixed-seed generated histories converge", (context) => {
  const generateHistories = createEditHistoryGenerator();
  for (const grammar of grammars) {
    const sources = [...reproducedSources[grammar.path.split("/")[0]]];
    if (grammar.name === "ecmaregex") sources.push(String.raw`\8`, "{x}");
    if (grammar.name === "ecmaregex_v")
      sources.push("[a&&b]", "[a--b]", String.raw`[\q{ab|cd}]`);
    if (grammar.name === "posix_bre")
      sources.push(String.raw`\(a\)\1`, String.raw`a\{1,3\}`);
    if (grammar.name === "posix_ere") sources.push("(a|b)+?");
    let checked = 0;
    let compared = 0;
    for (const history of generateHistories(sources, fuzzInsertions)) {
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
    assert.equal(
      checked,
      sources.length * historiesPerSource * editsPerHistory,
    );
    assert.ok(compared > 0);
    context.diagnostic(
      `${grammar.name}: checked ${checked} generated edit states, compared ${compared} valid CSTs`,
    );
  }
});

const ecmaregexEditCases = [
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
    languages: ecmaregexLanguages,
    before: String.raw`\1()()()()()()()()()()`,
    after: String.raw`\10()()()()()()()()()()`,
    byte: 2,
    deleteBytes: 0,
    insert: "0",
  },
  {
    name: "a third digit reclassifies a reference using the full number and mode",
    languages: ecmaregexLanguages,
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
    languages: ecmaregexLanguages,
    before: "a|b",
    after: "a||b",
    byte: 2,
    deleteBytes: 0,
    insert: "|",
  },
  {
    name: "removing and restoring a group closer recovers the normal body",
    languages: ecmaregexLanguages,
    before: "(a|b)c",
    after: "(a|bc",
    byte: 4,
    deleteBytes: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "adding a leading class caret inserts a separate negation token",
    languages: ecmaregexLanguages,
    before: "[a]",
    after: "[^a]",
    byte: 1,
    deleteBytes: 0,
    insert: "^",
  },
  {
    name: "removing the first class member reclassifies a caret as negation",
    languages: ecmaregexLanguages,
    before: "[a^]",
    after: "[^]",
    byte: 1,
    deleteBytes: 1,
    insert: "",
  },
  {
    name: "editing a modifier preserves its scoped body",
    languages: ecmaregexLanguages,
    before: "(?i:a)",
    after: "(?m:a)",
    byte: 2,
    deleteBytes: 1,
    insert: "m",
  },
  {
    name: "an identifier edit after a multibyte character preserves the group delimiters",
    languages: ecmaregexLanguages,
    before: "(?<名>a)",
    after: "(?<名x>a)",
    byte: 6,
    deleteBytes: 0,
    insert: "x",
  },
  {
    name: "replacing a BMP name start with a supplementary character changes its lexical branch",
    languages: ecmaregexLanguages,
    before: "(?<名>a)",
    after: "(?<𐐀>a)",
    byte: 3,
    deleteBytes: 3,
    insert: "𐐀",
  },
  {
    name: "an ordinary supplementary name part stays syntax before identifier validation",
    before: String.raw`(?<a𐐀>)\k<a𐐀>`,
    after: String.raw`(?<a😀>)\k<a𐐀>`,
    byte: 4,
    deleteBytes: 4,
    insert: "😀",
  },
  {
    name: "joining body surrogate escapes respects each language's character unit",
    languages: ecmaregexLanguages,
    before: String.raw`\uD800x\uDC00+`,
    after: String.raw`\uD800\uDC00+`,
    byte: 6,
    deleteBytes: 1,
    insert: "",
  },
  {
    name: "joining class surrogate escapes updates both their structure and ranges",
    languages: ecmaregexLanguages,
    before: String.raw`[\uD800x\uDC00]`,
    after: String.raw`[\uD800\uDC00]`,
    byte: 7,
    deleteBytes: 1,
    insert: "",
  },
  {
    name: "an edit on a later line preserves UTF-8 byte columns",
    languages: ecmaregexLanguages,
    before: "a\nb",
    after: "a\n😀b",
    byte: 2,
    deleteBytes: 0,
    insert: "😀",
  },
  {
    name: "a NUL source character does not terminate scanning before an edit",
    languages: ecmaregexLanguages,
    before: "\0a",
    after: "\0😀a",
    byte: 1,
    deleteBytes: 0,
    insert: "😀",
  },
  {
    name: "an interior U+FEFF source character remains a literal during edits",
    languages: ecmaregexLanguages,
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
    languages: ["ecmaregex", "ecmaregex_u"],
    before: "[a-😀]",
    after: "[a-]",
    byte: 3,
    deleteBytes: 4,
    insert: "",
  },
  {
    name: "a repeated reserved punctuation becomes an error inside a Unicode set",
    languages: ["ecmaregex_v"],
    before: "[!a]",
    after: "[!!a]",
    byte: 2,
    deleteBytes: 0,
    insert: "!",
    afterError: true,
  },
  {
    name: "a second ampersand changes a union into an intersection",
    languages: ["ecmaregex_v"],
    before: "[a&b]",
    after: "[a&&b]",
    byte: 3,
    deleteBytes: 0,
    insert: "&",
  },
  {
    name: "a third ampersand invalidates an intersection",
    languages: ["ecmaregex_v"],
    before: "[a&&b]",
    after: "[a&&&b]",
    byte: 4,
    deleteBytes: 0,
    insert: "&",
    afterError: true,
  },
  {
    name: "reserved punctuation lookahead also updates inside a class string",
    languages: ["ecmaregex_v"],
    before: String.raw`[\q{!a}]`,
    after: String.raw`[\q{!!a}]`,
    byte: 5,
    deleteBytes: 0,
    insert: "!",
    afterError: true,
  },
  {
    name: "escaping a class string separator merges its alternatives",
    languages: ["ecmaregex_v"],
    before: String.raw`[\q{a|b}]`,
    after: String.raw`[\q{a\|b}]`,
    byte: 5,
    deleteBytes: 0,
    insert: "\\",
  },
  {
    name: "escaping an early class string closer changes the ownership of its suffix",
    languages: ["ecmaregex_v"],
    before: String.raw`[\q{a}b}]`,
    after: String.raw`[\q{a\}b}]`,
    byte: 5,
    deleteBytes: 0,
    insert: "\\",
    beforeError: true,
  },
  {
    name: "removing and restoring a nested class closer updates syntax",
    languages: ["ecmaregex_v"],
    before: "[[a]&&[b]]",
    after: "[[a&&[b]]",
    byte: 3,
    deleteBytes: 1,
    insert: "",
    afterError: true,
  },
  {
    name: "an intersection edit after a non-BMP character uses a byte offset",
    languages: ["ecmaregex_v"],
    before: "[😀&b]",
    after: "[😀&&b]",
    byte: 6,
    deleteBytes: 0,
    insert: "&",
  },
  {
    name: "a second hyphen changes a range into subtraction",
    languages: ["ecmaregex_v"],
    before: "[a-b]",
    after: "[a--b]",
    byte: 3,
    deleteBytes: 0,
    insert: "-",
  },
  {
    name: "replacing both operator characters changes the set operation",
    languages: ["ecmaregex_v"],
    before: "[a&&b]",
    after: "[a--b]",
    byte: 2,
    deleteBytes: 2,
    insert: "--",
  },
  {
    name: "a digit following a class string null escape requires recovery",
    languages: ["ecmaregex_v"],
    before: String.raw`[\q{\0}]`,
    after: String.raw`[\q{\00}]`,
    byte: 6,
    deleteBytes: 0,
    insert: "0",
    afterError: true,
  },
];

for (const [index, scenario] of ecmaregexEditCases.entries()) {
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
  for (const language of scenario.languages ?? ["ecmaregex"]) {
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
        if (reverse ? scenario.afterError : scenario.beforeError) return;
        const restore = {
          byte: edit.byte,
          deleteBytes: Buffer.byteLength(edit.insert),
          insert: Buffer.from(before)
            .subarray(edit.byte, edit.byte + edit.deleteBytes)
            .toString(),
        };
        assert.deepEqual(
          parseFile(beforePath, language, [edit, restore]),
          parseFile(beforePath, language),
          "undoing the edit must restore the fresh CST",
        );
      });
    }
  }
}

const ecmaregexEditHistories = [
  {
    name: "a dangling backslash exposes its missing reference digit",
    languages: ecmaregexLanguages,
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
    languages: ["ecmaregex"],
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
    languages: ["ecmaregex_v"],
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

for (const [index, history] of ecmaregexEditHistories.entries()) {
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

test("PCRE2 supplementary boundary decisions survive source edits", () => {
  for (const { source, edit } of [
    {
      source: "(*UTF)é",
      edit: { byte: 5, deleteBytes: 0, insert: "8" },
    },
    {
      source: "(*UTF8)é",
      edit: { byte: 5, deleteBytes: 1, insert: "" },
    },
    {
      source: "(*UTF8é",
      edit: { byte: 6, deleteBytes: 0, insert: ")" },
    },
    {
      source: String.raw`\N{2}`,
      edit: { byte: 3, deleteBytes: 1, insert: "U+41" },
    },
    {
      source: String.raw`\N{U+41}`,
      edit: { byte: 3, deleteBytes: 4, insert: "2" },
    },
    {
      source: String.raw`\N{2`,
      edit: { byte: 4, deleteBytes: 0, insert: "}" },
    },
    {
      source: "(?xx)(?x)[a b]",
      edit: { byte: 7, deleteBytes: 1, insert: "xx" },
    },
    { source: "(?i-m:a)", edit: { byte: 4, deleteBytes: 1, insert: "" } },
    { source: "[[:<:]]", edit: { byte: 7, deleteBytes: 0, insert: "*" } },
    { source: "(?(?#c)(?=a)b)", edit: { byte: 2, deleteBytes: 5, insert: "" } },
    { source: "(?(?=a)b)", edit: { byte: 2, deleteBytes: 0, insert: "(?#c)" } },
    {
      source: String.raw`\p{^Lu}`,
      edit: { byte: 3, deleteBytes: 0, insert: "_- " },
    },
  ]) {
    const expected = parse(pcre2Grammar, applyEdits(source, [edit]).toString());
    assert.equal(expected.status, 0, expected.rows.join("\n"));
    assert.deepEqual(parse(pcre2Grammar, source, [edit]), expected, source);
  }
});

test("PCRE2 condition prefix edits reclassify VERSION and R", () => {
  for (const { source, edit } of [
    {
      source: "(?(VERSIONX)a)",
      edit: { byte: 10, deleteBytes: 1, insert: "=10" },
    },
    {
      source: "(?(VERSIONX)a)",
      edit: { byte: 3, deleteBytes: 1, insert: "v" },
    },
    { source: "(?(Rx)a)", edit: { byte: 4, deleteBytes: 1, insert: "" } },
    { source: "(?(R)a)", edit: { byte: 4, deleteBytes: 0, insert: "&x" } },
  ]) {
    const expected = parse(pcre2Grammar, applyEdits(source, [edit]).toString());
    assert.equal(expected.status, 0, expected.rows.join("\n"));
    assert.deepEqual(parse(pcre2Grammar, source, [edit]), expected, source);
  }
});

test("PCRE2 POSIX delimiters and Unicode group names reparse after edits", () => {
  for (const { source, edit } of [
    { source: "[[:alpha]]", edit: { byte: 8, deleteBytes: 0, insert: ":" } },
    { source: "[[:alpha:]]", edit: { byte: 8, deleteBytes: 1, insert: "" } },
    { source: "[[.a.]]", edit: { byte: 4, deleteBytes: 1, insert: "" } },
    { source: "[[=a=]]", edit: { byte: 4, deleteBytes: 1, insert: "" } },
    {
      source: "(?<a>b)",
      edit: { byte: 3, deleteBytes: 1, insert: "\u{10940}\u{11de0}" },
    },
    {
      source: "(?<\u{10940}>b)",
      edit: { byte: 3, deleteBytes: 4, insert: "a" },
    },
  ]) {
    const expected = parse(pcre2Grammar, applyEdits(source, [edit]).toString());
    assert.equal(expected.status, 0, expected.rows.join("\n"));
    assert.deepEqual(parse(pcre2Grammar, source, [edit]), expected, source);
  }
});

test("PCRE2 inline option and capture changes survive edits and resets", () => {
  const noAutoCaptureGroupCount = 11;
  const branchResetRepetitions = 4;
  const cases = [
    ["(?x:a b)c d", { byte: 2, deleteBytes: 1, insert: "xx" }],
    [
      "(?n)(a)".repeat(noAutoCaptureGroupCount) + String.raw`\11`,
      { byte: 2, deleteBytes: 1, insert: "-n" },
    ],
    ["(?x)# a\nb c", { byte: 0, deleteBytes: 0, insert: "(*CR)" }],
    ["(?x)[a b] c", { byte: 2, deleteBytes: 1, insert: "xx" }],
    [String.raw`\Q(a)\E(b)\11`, { byte: 0, deleteBytes: 2, insert: "" }],
    [
      "(?|(a)|(b)(c))(d)".repeat(branchResetRepetitions) + String.raw`\11`,
      { byte: 2, deleteBytes: 1, insert: ":" },
    ],
    ["(?<x>a", { byte: 6, deleteBytes: 0, insert: ")" }],
  ];
  for (const [source, edit] of cases) {
    const expected = parse(pcre2Grammar, applyEdits(source, [edit]).toString());
    assert.equal(expected.status, 0, expected.rows.join("\n"));
    const actual = parse(pcre2Grammar, source, [edit]);
    assert.deepEqual(actual, expected, `${source}`);
  }
});
const posixEdits = [
  ...posixGrammars.flatMap(({ name }) => {
    const [opening, closing] =
      name === "posix_bre" ? ["\\(", "\\)"] : ["(", ")"];
    const languages = [name];
    const byte = opening.length;
    return [
      {
        name: "deleting a group body leaves only its delimiters",
        languages,
        source: `${opening}a${closing}`,
        edited: `${opening}${closing}`,
        edit: { byte, deleteBytes: 1, insert: "" },
        reverse: { byte, deleteBytes: 0, insert: "a" },
      },
      {
        name: "completing a bodyless group at EOF removes recovery",
        languages,
        source: opening,
        edited: `${opening}${closing}`,
        edit: { byte, deleteBytes: 0, insert: closing },
        reverse: { byte, deleteBytes: closing.length, insert: "" },
        sourceError: true,
      },
      {
        name: "deleting a nested group body preserves its quantifier",
        languages,
        source: `${opening}${opening}a${closing}*${closing}`,
        edited: `${opening}${opening}${closing}*${closing}`,
        edit: { byte: 2 * byte, deleteBytes: 1, insert: "" },
        reverse: { byte: 2 * byte, deleteBytes: 0, insert: "a" },
      },
    ];
  }),
  {
    name: "completing a BRE group closer after several terms restores the surrounding expressions",
    languages: ["posix_bre"],
    source: "a\\(bcd\\",
    edited: String.raw`a\(bcd\)`,
    edit: { byte: 7, deleteBytes: 0, insert: ")" },
    reverse: { byte: 7, deleteBytes: 1, insert: "" },
    sourceError: true,
  },
  {
    name: "appending a missing BRE group closer restores the surrounding expressions",
    languages: ["posix_bre"],
    source: String.raw`a\(bcd`,
    edited: String.raw`a\(bcd\)`,
    edit: { byte: 6, deleteBytes: 0, insert: String.raw`\)` },
    reverse: { byte: 6, deleteBytes: 2, insert: "" },
    sourceError: true,
  },
  {
    name: "an empty group supplies a missing alternative",
    languages: ["posix_ere"],
    source: "(a|)",
    edited: "(a|())",
    edit: { byte: 3, deleteBytes: 0, insert: "()" },
    reverse: { byte: 3, deleteBytes: 2, insert: "" },
    sourceError: true,
  },
  {
    name: "repairing a compound closing marker restores its delimiter leaves",
    languages: ["posix_bre", "posix_ere"],
    source: "[[.é].][=😀]x][:alpha:]]",
    edited: "[[.é].][=😀]=][:alpha:]]",
    edit: { byte: 15, deleteBytes: 1, insert: "=" },
    reverse: { byte: 15, deleteBytes: 1, insert: "x" },
    sourceError: true,
  },
  {
    name: "removing whitespace restores adjacent character class delimiter leaves",
    languages: ["posix_bre", "posix_ere"],
    source: "[[:alpha: ]]",
    edited: "[[:alpha:]]",
    edit: { byte: 9, deleteBytes: 1, insert: "" },
    reverse: { byte: 9, deleteBytes: 0, insert: " " },
    sourceError: true,
  },
  {
    name: "a compound opener replaces a literal opening bracket",
    languages: ["posix_bre", "posix_ere"],
    source: "[[:alpha:]]",
    edited: "[[xalpha:]]",
    edit: { byte: 2, deleteBytes: 1, insert: "x" },
    reverse: { byte: 2, deleteBytes: 1, insert: ":" },
  },
  {
    name: "extending a collating element changes single to multi",
    languages: ["posix_bre", "posix_ere"],
    source: "[[.a.]]",
    edited: "[[.ab.]]",
    edit: { byte: 4, deleteBytes: 0, insert: "b" },
    reverse: { byte: 4, deleteBytes: 1, insert: "" },
  },
  {
    name: "editing a collating symbol changes its meta classification",
    languages: ["posix_bre", "posix_ere"],
    source: "[[.a.]]",
    edited: "[[.].]]",
    edit: { byte: 3, deleteBytes: 1, insert: "]" },
    reverse: { byte: 3, deleteBytes: 1, insert: "a" },
  },
  {
    name: "a trailing literal hyphen becomes a range separator",
    languages: ["posix_bre", "posix_ere"],
    source: "[a-]",
    edited: "[a-z]",
    edit: { byte: 3, deleteBytes: 0, insert: "z" },
    reverse: { byte: 3, deleteBytes: 1, insert: "" },
  },
  {
    name: "inserting an opening parenthesis changes an unmatched closer",
    languages: ["posix_ere"],
    source: "a)b)",
    edited: "(a)b)",
    edit: { byte: 0, deleteBytes: 0, insert: "(" },
    reverse: { byte: 0, deleteBytes: 1, insert: "" },
  },
  {
    name: "repairing an empty branch restores the original group closer",
    languages: ["posix_ere"],
    source: "(a|)b)",
    edited: "(a|c)b)",
    edit: { byte: 3, deleteBytes: 0, insert: "c" },
    reverse: { byte: 3, deleteBytes: 1, insert: "" },
    sourceError: true,
  },
  {
    name: "appending a character changes a right anchor to a literal",
    languages: ["posix_bre"],
    source: "^a$",
    edited: "^a$b",
    edit: { byte: 3, deleteBytes: 0, insert: "b" },
    reverse: { byte: 3, deleteBytes: 1, insert: "" },
  },
  {
    name: "inserting a quoted pipe preserves a literal caret",
    languages: ["posix_bre"],
    source: "a^*b",
    edited: String.raw`a\|^*b`,
    edit: { byte: 1, deleteBytes: 0, insert: String.raw`\|` },
    reverse: { byte: 1, deleteBytes: 2, insert: "" },
  },
  {
    name: "appending a quoted pipe changes a right anchor to a literal",
    languages: ["posix_bre"],
    source: "^a$",
    edited: String.raw`^a$\|`,
    edit: { byte: 3, deleteBytes: 0, insert: String.raw`\|` },
    reverse: { byte: 3, deleteBytes: 2, insert: "" },
  },
  {
    name: "quoting a pipe preserves its following duplication symbol",
    languages: ["posix_bre"],
    source: "|*",
    edited: String.raw`\|*`,
    edit: { byte: 0, deleteBytes: 0, insert: "\\" },
    reverse: { byte: 0, deleteBytes: 1, insert: "" },
  },
  {
    name: "quoting a plus preserves its following interval",
    languages: ["posix_bre"],
    source: String.raw`+\{2\}`,
    edited: String.raw`\+\{2\}`,
    edit: { byte: 0, deleteBytes: 0, insert: "\\" },
    reverse: { byte: 0, deleteBytes: 1, insert: "" },
  },
  {
    name: "quoting a question mark preserves a literal operand",
    languages: ["posix_bre"],
    source: "a?",
    edited: String.raw`a\?`,
    edit: { byte: 1, deleteBytes: 0, insert: "\\" },
    reverse: { byte: 1, deleteBytes: 1, insert: "" },
  },
];

for (const grammar of posixGrammars) {
  for (const fixture of posixEdits) {
    if (!fixture.languages.includes(grammar.name)) continue;
    test(`${grammar.name}: incremental ${fixture.name}`, () => {
      const { source, edited, edit, reverse, sourceError } = fixture;
      assert.equal(applyEdits(source, [edit]).toString(), edited);
      assert.equal(applyEdits(edited, [reverse]).toString(), source);
      const original = parse(grammar, source);
      assert.equal(original.status, sourceError ? 1 : 0);
      const changed = parse(grammar, edited);
      assert.equal(changed.status, 0);
      assert.deepEqual(parse(grammar, source, [edit]), changed);
      if (!sourceError)
        assert.deepEqual(parse(grammar, edited, [reverse]), original);
      assert.deepEqual(parse(grammar, edited, [reverse, edit]), changed);
    });
  }
}

const pyregexEditCases = [
  {
    name: "pairing a trailing backslash completes a verbose comment",
    source: "(?x)#\\",
    edited: String.raw`(?x)#\\`,
    edit: { byte: 6, deleteBytes: 0, insert: "\\" },
    reverse: { byte: 6, deleteBytes: 1, insert: "" },
  },
  {
    name: "an escaped reference name closer requires a second closer",
    source: String.raw`(?P=a\)`,
    edited: String.raw`(?P=a\))`,
    edit: { byte: 7, deleteBytes: 0, insert: ")" },
    reverse: { byte: 7, deleteBytes: 1, insert: "" },
  },
  {
    name: "an escaped Unicode name brace requires a second closer",
    source: String.raw`\N{\}`,
    edited: String.raw`\N{\}}`,
    edit: { byte: 5, deleteBytes: 0, insert: "}" },
    reverse: { byte: 5, deleteBytes: 1, insert: "" },
  },
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
for (const grammar of pyregexGrammars) {
  for (const { name, source, edited, edit, reverse } of pyregexEditCases) {
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
const unicodePayloadClosings = {
  pcre2: ['")"', "operand: capturing_group"],
  ecmaregex: ['")"', "operand: extended_atom"],
  ecmaregex_u: ['")"', "operand: atom"],
  ecmaregex_v: ['")"', "operand: atom"],
  pyregex: ['")"', "operand: capturing_group"],
  pyregex_verbose: ['")"', "operand: capturing_group"],
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
