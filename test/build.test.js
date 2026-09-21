import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { grammars, packageName, root } from "../scripts/tree-sitter.js";

const language = packageName.slice("tree-sitter-".length).replaceAll("-", "_");

function copyFiles(paths, directory) {
  for (const path of new Set(paths)) {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, path), destination, { recursive: true });
  }
}

test(`${language}: generated checks reject stale and missing files without rewriting them`, () => {
  const cache = join(root, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, `${packageName}-generated-check-`));
  try {
    copyFiles(
      [
        "package.json",
        "tree-sitter.json",
        "scripts",
        ...(existsSync(join(root, "common")) ? ["common"] : []),
        ...grammars.flatMap(({ path, externalFiles }) => [
          join(path, "grammar.js"),
          join(path, "src"),
          ...externalFiles,
        ]),
      ],
      directory,
    );

    function check() {
      const result = spawnSync(
        process.execPath,
        ["scripts/check-generated.js"],
        {
          cwd: directory,
          encoding: "utf8",
          timeout: 60_000,
          killSignal: "SIGKILL",
        },
      );
      assert.ifError(result.error);
      return result;
    }

    const clean = check();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const changedFiles = [];
    const missingFiles = [];
    for (const { path } of grammars) {
      const nodeTypes = join(path, "src", "node-types.json");
      const changed = `${readFileSync(join(directory, nodeTypes), "utf8")}\n`;
      writeFileSync(join(directory, nodeTypes), changed);
      changedFiles.push([nodeTypes, changed]);
      const parser = join(path, "src", "parser.c");
      rmSync(join(directory, parser));
      missingFiles.push(parser);
    }

    const stale = check();
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    for (const [path, expected] of changedFiles) {
      assert.ok(stale.stderr.includes(path), stale.stderr);
      assert.equal(readFileSync(join(directory, path), "utf8"), expected);
    }
    for (const path of missingFiles) {
      assert.ok(stale.stderr.includes(path), stale.stderr);
      assert.equal(existsSync(join(directory, path)), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(`${language}: corpus fuzz propagates CLI failures even when its exit status is zero`, () => {
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
    {
      name: "signal termination retains its cause",
      status: null,
      signal: "SIGTERM",
      stdout: "fuzz progress\n",
      stderr: "",
      expectedStatus: 1,
      expectedDiagnostic: "Tree-sitter CLI terminated by SIGTERM.\n",
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
      if (fixture.expectedDiagnostic !== undefined) {
        assert.ok(
          result.stderr.includes(fixture.expectedDiagnostic),
          `${fixture.name}: termination cause is missing`,
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
