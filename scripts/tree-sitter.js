#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dirname, "..");
const configuration = JSON.parse(
  readFileSync(join(root, "tree-sitter.json"), "utf8"),
);
if (
  !Array.isArray(configuration.grammars) ||
  configuration.grammars.length === 0
) {
  throw new Error("tree-sitter.json must define at least one grammar.");
}
for (const grammar of configuration.grammars) {
  for (const field of ["name", "path", "scope"]) {
    if (typeof grammar[field] !== "string" || grammar[field].length === 0) {
      throw new Error(
        `tree-sitter.json grammar ${field} must be a non-empty string.`,
      );
    }
  }
}
const grammars = Object.freeze(
  configuration.grammars.map(
    ({ "external-files": externalFiles, highlights, name, path, scope }) =>
      Object.freeze({
        externalFiles: Object.freeze([].concat(externalFiles ?? [])),
        highlights,
        name,
        path,
        scope,
      }),
  ),
);
const executable = join(
  root,
  "node_modules",
  "tree-sitter-cli",
  process.platform === "win32" ? "tree-sitter.exe" : "tree-sitter",
);
const missingCliMessage = "Tree-sitter CLI is missing; run npm ci.";

function copyFiles(paths, destinationRoot) {
  for (const path of paths) {
    const destination = join(destinationRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, path), destination, { recursive: true });
  }
}

function resultStatus(result) {
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(missingCliMessage, { cause: result.error });
    }
    throw result.error;
  }
  return result.status ?? 1;
}

function createTreeSitter(environment = {}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "tree-sitter-regex-"));
  const cacheDirectory = join(
    root,
    "node_modules",
    ".cache",
    "tree-sitter-regex",
  );
  const configDirectory = join(temporaryDirectory, "config");
  const libraryDirectory = join(temporaryDirectory, "lib");
  const treeSitterConfigDirectory = join(configDirectory, "tree-sitter");
  const parserDirectory = join(temporaryDirectory, "parsers");

  try {
    mkdirSync(cacheDirectory, { recursive: true });
    mkdirSync(libraryDirectory);
    mkdirSync(treeSitterConfigDirectory, { recursive: true });
    copyFiles(
      new Set([
        "tree-sitter.json",
        ...grammars.flatMap((grammar) => [
          join(grammar.path, "src"),
          grammar.highlights,
          ...grammar.externalFiles,
        ]),
      ]),
      join(parserDirectory, "tree-sitter-regex"),
    );
    writeFileSync(
      join(treeSitterConfigDirectory, "config.json"),
      `${JSON.stringify({ "parser-directories": [parserDirectory] }, null, 2)}\n`,
    );
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  let closed = false;
  return Object.freeze({
    configPath: join(treeSitterConfigDirectory, "config.json"),
    close() {
      if (!closed) {
        closed = true;
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
    run(arguments_, options = {}) {
      if (closed) {
        throw new Error("Tree-sitter runner is closed.");
      }
      const { env = {}, ...spawnOptions } = options;
      return spawnSync(executable, arguments_, {
        cwd: root,
        windowsHide: true,
        ...spawnOptions,
        env: {
          ...process.env,
          APPDATA: configDirectory,
          LOCALAPPDATA: cacheDirectory,
          TREE_SITTER_DIR: treeSitterConfigDirectory,
          TREE_SITTER_LIBDIR: libraryDirectory,
          TREE_SITTER_SEED: process.env.TREE_SITTER_SEED ?? "1",
          XDG_CACHE_HOME: cacheDirectory,
          XDG_CONFIG_HOME: configDirectory,
          ...environment,
          ...env,
        },
      });
    },
  });
}

function runChecked(runner, arguments_, options = { stdio: "inherit" }) {
  return resultStatus(runner.run(arguments_, options));
}

function generateParsers(outputRoot = root) {
  for (const grammar of grammars) {
    const output = join(outputRoot, grammar.path, "src");
    mkdirSync(output, { recursive: true });
    const status = resultStatus(
      spawnSync(
        executable,
        [
          "generate",
          join(root, grammar.path, "grammar.js"),
          "--abi",
          "latest",
          "--output",
          output,
        ],
        { cwd: root, windowsHide: true, stdio: "inherit" },
      ),
    );
    if (status !== 0) {
      return status;
    }
  }
  return 0;
}

function testCorpus(arguments_) {
  if (
    arguments_.some(
      (argument) =>
        ["--update", "--debug-graph", "--open-log"].includes(argument) ||
        /^-[d0rh]*[uD]/.test(argument),
    )
  ) {
    throw new Error(
      "test-corpus deletes its isolated copy; --update, --debug-graph, and --open-log would lose their output.",
    );
  }
  const testRoot = mkdtempSync(join(root, ".tree-sitter-regex-test-"));
  let runner;

  try {
    copyFiles(
      [
        "common",
        "package.json",
        ...grammars.flatMap(({ path, highlights }) => [
          join(path, "grammar.js"),
          join(path, "src"),
          highlights,
        ]),
        join("test", "corpus"),
        "tree-sitter.json",
      ],
      testRoot,
    );
    runner = createTreeSitter();
    return runChecked(runner, ["test", ...arguments_], {
      cwd: testRoot,
      stdio: "inherit",
    });
  } finally {
    try {
      runner?.close();
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }
}

function fuzzParsers(runner, arguments_) {
  const directory = mkdtempSync(join(tmpdir(), "tree-sitter-regex-fuzz-"));
  try {
    for (const { name, path } of grammars) {
      const library = join(
        directory,
        `${name}.${process.platform === "win32" ? "dll" : "so"}`,
      );
      const buildStatus = runChecked(runner, [
        "build",
        join(root, path),
        "--output",
        library,
      ]);
      if (buildStatus !== 0) return buildStatus;
      const result = runner.run(
        ["fuzz", "--lib-path", library, "--lang-name", name, ...arguments_],
        {
          encoding: "utf8",
          env: { NO_COLOR: "1" },
          maxBuffer: 16 * 1024 * 1024,
          timeout: 600_000,
          killSignal: "SIGKILL",
        },
      );
      const status = resultStatus(result);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      if (status !== 0) return status;
      // The CLI can report failed fuzz cases while returning exit status zero.
      if (
        /^[1-9][0-9]* .+ corpus tests failed fuzzing$/m.test(
          result.stdout + result.stderr,
        )
      )
        return 1;
    }
    return 0;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function main(arguments_) {
  const [command, ...rest] = arguments_;
  if (command === "generate-all") {
    if (rest.length !== 0) {
      throw new Error("Usage: node scripts/tree-sitter.js generate-all");
    }
    return generateParsers();
  }
  if (command === "test-corpus") {
    return testCorpus(rest);
  }

  const runner = createTreeSitter();
  try {
    if (command === "fuzz-all") return fuzzParsers(runner, rest);
    return runChecked(runner, arguments_);
  } finally {
    runner.close();
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}

export { createTreeSitter, generateParsers, grammars, root };
