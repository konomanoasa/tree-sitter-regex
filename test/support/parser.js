import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, grammars } from "../../scripts/tree-sitter.js";
import { parseCst, sourceEndPoint } from "./cst.js";

const guaranteedPcre2ScopeDepth = 1_000;

const commandTimeoutMs = 60_000;
const cstOutputLimitBytes = 16 * 1024 * 1024;
const summaryTimeoutMicros = 10_000_000;

let cache;
let runner;

before(() => {
  cache = mkdtempSync(join(tmpdir(), "tree-sitter-regex-parser-"));
  try {
    runner = createTreeSitter();
  } catch (error) {
    rmSync(cache, { recursive: true, force: true });
    throw error;
  }
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

// The CLI exposes only the final CST, so edit histories replay short prefixes.
function runParse(paths, language, edits) {
  const grammar = grammars.find(({ name }) => name === language);
  assert.ok(grammar, language);
  const arguments_ = [
    "parse",
    "--scope",
    grammar.scope,
    "--encoding",
    "utf8",
    "--cst",
    ...paths,
  ];
  if (edits.length > 0) {
    arguments_.push("--edits", ...edits.map(formatEdit));
  }
  const result = runner.run(arguments_, {
    encoding: "utf8",
    maxBuffer: cstOutputLimitBytes,
    timeout: commandTimeoutMs,
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
  return { cst, status: result.status };
}

function parseSequence(paths, language) {
  return runParse(paths, language, []).cst.split("\n");
}

function parseFile(path, language, edits = []) {
  const { cst, status } = runParse([path], language, edits);
  return parseCst(cst, applyEdits(readFileSync(path), edits), language, status);
}

const ecmaregexLanguages = ["ecmaregex", "ecmaregex_u", "ecmaregex_v"];

const unicodeLanguages = ["ecmaregex_u", "ecmaregex_v"];

const pyregexGrammars = grammars.filter(
  ({ name }) => name === "pyregex" || name === "pyregex_verbose",
);

const posixGrammars = grammars.filter(({ name }) => name.startsWith("posix_"));

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

function parseSummary(grammar, source, timeoutMicros = summaryTimeoutMicros) {
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
      String(timeoutMicros),
      sourcePath,
    ],
    { encoding: "utf8", timeout: commandTimeoutMs },
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

export {
  applyEdits,
  cache,
  ecmaregexLanguages,
  guaranteedPcre2ScopeDepth,
  parse,
  parseFile,
  parseSequence,
  parseSummary,
  posixGrammars,
  pyregexGrammars,
  unicodeLanguages,
};
