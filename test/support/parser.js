import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, grammars } from "../../scripts/tree-sitter.js";

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

function applyEdits(source, edits) {
  let bytes = Buffer.from(source);
  for (const edit of edits) {
    const { byte, deleteBytes, insert } = edit;
    const description = JSON.stringify(edit);
    assert.ok(
      Number.isSafeInteger(byte) && byte >= 0,
      `invalid byte offset: ${description}`,
    );
    assert.ok(
      Number.isSafeInteger(deleteBytes) && deleteBytes >= 0,
      `invalid deletion length: ${description}`,
    );
    assert.equal(typeof insert, "string", `invalid insertion: ${description}`);
    assert.ok(
      byte <= bytes.length && deleteBytes <= bytes.length - byte,
      `edit exceeds ${bytes.length} source bytes: ${description}`,
    );
    bytes = Buffer.concat([
      bytes.subarray(0, byte),
      Buffer.from(insert),
      bytes.subarray(byte + deleteBytes),
    ]);
  }
  return bytes;
}

function formatEdit({ byte, deleteBytes, insert }) {
  return `${byte} ${deleteBytes} ${insert}`;
}

function sourceEndPoint(source) {
  const bytes = Buffer.from(source);
  let row = 0;
  for (const byte of bytes) if (byte === 10) row += 1;
  return `${row}:${bytes.length - bytes.lastIndexOf(10) - 1}`;
}

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
    arguments_.push("--edits", ...edits.map(formatEdit));
  }
  const result = runner.run(arguments_, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
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
  const end = /^[0-9]+:[0-9]+ +- +([0-9]+:[0-9]+)/.exec(cst)?.[1];
  assert.equal(
    end,
    sourceEndPoint(applyEdits(readFileSync(path), edits)),
    "root must reach the edited source end",
  );
  if (result.status === 0) {
    assert.ok(cst.includes("pattern"), cst);
  }
  const recovery = hasRecovery(cst);
  return { status: recovery ? 1 : result.status, cst, recovery };
}

const allLanguages = [
  "javascript_regex",
  "javascript_regex_u",
  "javascript_regex_v",
];

const unicodeLanguages = ["javascript_regex_u", "javascript_regex_v"];

const pythonGrammars = grammars.filter(
  ({ name }) => name === "python_re" || name === "python_re_verbose",
);

function parse(grammar, source, edits = []) {
  const path = join(cache, "pattern.txt");
  writeFileSync(path, source);
  const result = parseFile(path, grammar.name, edits);
  return {
    status: result.status,
    rows: result.cst.split("\n"),
    recovery: result.recovery,
  };
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

function parseSummary(grammar, source, timeout = 10_000_000) {
  const sourcePath = join(cache, "summary.txt");
  writeFileSync(sourcePath, source);
  const result = runner.run(
    [
      "parse",
      "--scope",
      grammar.scope,
      "--encoding",
      "utf8",
      "--quiet",
      "--json-summary",
      "--timeout",
      String(timeout),
      sourcePath,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.ifError(result.error);
  assert.ok(
    result.status === 0 || result.status === 1,
    result.stdout + result.stderr,
  );
  const start = result.stdout.indexOf("{\n");
  assert.notEqual(start, -1, "parser produced no summary");
  const { parse_summaries: summaries } = JSON.parse(result.stdout.slice(start));
  assert.equal(summaries?.length, 1, "parser produced no complete root");
  const summary = summaries[0];
  assert.equal(
    `${summary.end.row}:${summary.end.column}`,
    sourceEndPoint(source),
    "root must reach the source end",
  );
  assert.equal(
    summary.bytes,
    Buffer.byteLength(source),
    "parser omitted source bytes",
  );
  return summary;
}

function hasRecovery(cst) {
  return /^[0-9: \t-]+•/m.test(cst);
}

export {
  allLanguages,
  applyEdits,
  cache,
  hasRecovery,
  parse,
  parseFile,
  parseSummary,
  pythonGrammars,
  runner,
  selectNodes,
  unicodeLanguages,
};
