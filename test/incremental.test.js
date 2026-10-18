import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { hasRecovery } from "./support/cst.js";
import {
  applyEdits,
  cache,
  javascriptLanguages,
  parse,
  parseFile,
  parseSequence,
} from "./support/parser.js";

const fuzzSeed = 1n;
const fuzzIterations = 100;
const editsPerHistory = 5;
const maximumFragments = 3;
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
    "python_re",
    "python_re_verbose",
    "js_regex_u",
    "js_regex_v",
  ].includes(name),
)) {
  test(`${grammar.name}: long concatenations preserve CST through UTF-8 edits and undo`, () => {
    const repetitions = 256;
    const units = ["a", "a[bc]*d"];
    if (grammar.name.startsWith("js_regex"))
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
  return function* (fragments, insertions, joinSource) {
    for (let iteration = 0; iteration < fuzzIterations; iteration++) {
      const parts = [];
      const count = 1 + next(maximumFragments);
      for (let part = 0; part < count; part++) {
        parts.push(fragments[next(fragments.length)]);
      }
      const initial = joinSource(parts);
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
  javascript: [
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
    if (grammar.name.startsWith("js_regex")) {
      fragments.push("(?<name>a)\\k<name>");
      if (grammar.name === "js_regex") fragments.push("\\8", "{x}");
      else fragments.push("\\u{61}", "\\p{L}");
      if (grammar.name === "js_regex_v")
        fragments.push("[a&&b]", "[a--b]", "[\\q{ab|cd}]");
    } else if (grammar.name.startsWith("posix_")) {
      fragments.push("[[:alpha:]]", "[[.ch.]]", "[[=a=]]", "[a-]", "[]a]");
      if (grammar.name === "posix_bre")
        fragments.push(String.raw`\(a\)\1`, String.raw`a\{1,3\}`, "^*a$");
      else fragments.push("a*?");
    } else if (grammar.name === "pcre2") {
      fragments.push(
        "(?n)(a)",
        "(?xx)[a b]",
        "(?x:a #c\nb)",
        String.raw`(?|(a)|(b)(c))\11`,
        String.raw`\Q(a)\E+`,
        String.raw`\x{41}`,
        String.raw`\u{41}`,
        "(*CR)(?x)#a\rb",
        "(?[[a]&![b]])",
        "(?C'arg')",
        "(*SKIP:tag)",
      );
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
    assert.equal(checked, fuzzIterations * editsPerHistory);
    assert.ok(compared > 0);
    context.diagnostic(
      `${grammar.name}: checked ${checked} generated edit states, compared ${compared} valid CSTs`,
    );
  }
});
