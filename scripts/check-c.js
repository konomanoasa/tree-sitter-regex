#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { grammars, root } from "./tree-sitter.js";

const scannerConfigurations = {
  javascript_regex: ["javascript", "-DJAVASCRIPT_REGEX_MODE=0"],
  javascript_regex_u: ["javascript", "-DJAVASCRIPT_REGEX_MODE=1"],
  javascript_regex_v: ["javascript", "-DJAVASCRIPT_REGEX_MODE=2"],
  python_re: ["python", "-DPYTHON_RE_INITIAL_VERBOSE=0"],
  python_re_verbose: ["python", "-DPYTHON_RE_INITIAL_VERBOSE=1"],
};
const scannerVariants = grammars.map((grammar) => {
  const configuration = scannerConfigurations[grammar.name];
  if (configuration === undefined)
    throw new Error(`Unsupported scanner grammar ${grammar.name}.`);
  const [family, modeArgument] = configuration;
  const includeDirectory = join(root, grammar.path, "src");
  return {
    family,
    modeArgument,
    includeDirectory,
    name: grammar.name,
    source: join(includeDirectory, "scanner.c"),
    contract: join(root, "test", "scanner.test.c"),
  };
});
const sources = [
  ...new Set(
    grammars.flatMap(({ externalFiles }) =>
      externalFiles
        .filter((file) => file.endsWith(".h"))
        .map((file) => join(root, file)),
    ),
  ),
  ...scannerVariants.map((variant) => variant.source),
  join(root, "test", "scanner.test.c"),
];

function executableCandidates(name) {
  if (process.platform !== "win32") {
    return [name];
  }
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
    .split(";")
    .filter(Boolean);
  return [
    name,
    ...extensions.map((extension) => name + extension.toLowerCase()),
  ];
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findExecutable(name, directories) {
  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    if (isExecutable(name)) {
      return name;
    }
    throw new Error(`Cannot execute ${name}.`);
  }
  for (const directory of directories) {
    for (const candidate of executableCandidates(name)) {
      const path = join(directory, candidate);
      if (isExecutable(path)) {
        return path;
      }
    }
  }
  throw new Error(`Cannot find ${name} on PATH.`);
}

function output(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim() ||
        `${command} exited with ${result.status}.`,
    );
  }
  return result.stdout.trim();
}

function versionMajor(command) {
  const version = output(command, ["--version"]);
  const match = version.match(/version ([0-9]+)/);
  if (match === null) {
    throw new Error(`Cannot determine the version of ${command}.`);
  }
  return Number(match[1]);
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    stdio: "inherit",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(`${command} exited with ${result.status}.`);
    error.exitStatus = result.status ?? 1;
    throw error;
  }
}

function llvmCommands() {
  if (process.platform === "darwin") {
    const llvmDirectory = join(output("brew", ["--prefix", "llvm"]), "bin");
    return {
      clang: findExecutable(join(llvmDirectory, "clang"), []),
      clangd: findExecutable(join(llvmDirectory, "clangd"), []),
      clangFormat: findExecutable(join(llvmDirectory, "clang-format"), []),
    };
  }

  const pathDirectories = (process.env.PATH ?? "").split(delimiter);
  const clangFormat = findExecutable(
    process.env.CLANG_FORMAT ?? "clang-format",
    pathDirectories,
  );
  const clangDirectory = dirname(realpathSync(clangFormat));
  return {
    clang: findExecutable(
      process.env.CLANG ?? "clang",
      process.env.CLANG === undefined ? [clangDirectory] : pathDirectories,
    ),
    clangd: findExecutable(
      process.env.CLANGD ?? "clangd",
      process.env.CLANGD === undefined ? [clangDirectory] : pathDirectories,
    ),
    clangFormat,
  };
}

function checkExternalTokenOrder(clang, compilerArguments, variant, directory) {
  const grammar = JSON.parse(
    readFileSync(join(variant.includeDirectory, "grammar.json"), "utf8"),
  );
  const assertions = grammar.externals.map(({ name }, index) => {
    const enumerator = name.replace(/^_/, "").toUpperCase();
    return `typedef char external_${index}[${enumerator} == ${index} ? 1 : -1];`;
  });
  const count =
    variant.family === "python"
      ? "LITERAL_CHARACTER_VERBOSE + 1"
      : "TOKEN_COUNT";
  assertions.push(
    `typedef char external_count[${count} == ${grammar.externals.length} ? 1 : -1];`,
  );
  const source = join(directory, `scanner-indices-${variant.name}.c`);
  writeFileSync(
    source,
    `#include ${JSON.stringify(variant.source.replaceAll("\\", "/"))}\n${assertions.join("\n")}\n`,
  );
  run(clang, [...compilerArguments, "-fsyntax-only", source]);
}

function main() {
  const arguments_ = process.argv.slice(2);
  const write = arguments_.includes("--write");
  const sanitize = arguments_.includes("--sanitize");
  if (
    new Set(arguments_).size !== arguments_.length ||
    arguments_.some(
      (argument) => !["--write", "--sanitize"].includes(argument),
    ) ||
    (write && arguments_.length !== 1)
  ) {
    throw new Error("Usage: node scripts/check-c.js [--write | --sanitize]");
  }

  const { clang, clangd, clangFormat } = llvmCommands();
  if (
    new Set([
      versionMajor(clang),
      versionMajor(clangd),
      versionMajor(clangFormat),
    ]).size !== 1
  ) {
    throw new Error(
      "clang, clangd, and clang-format must use the same LLVM release.",
    );
  }

  if (write) {
    run(clangFormat, ["-i", ...sources]);
    return;
  }

  if (arguments_.length === 0) {
    for (const source of sources) {
      run(clangd, ["--log=error", "--tweaks=", `--check=${source}`]);
    }
    run(clangFormat, ["--dry-run", "--Werror", ...sources]);
  }
  const sanitizerArguments = sanitize
    ? [
        "-fsanitize=address,undefined",
        "-fno-sanitize-recover=undefined",
        "-fno-omit-frame-pointer",
        "-g",
      ]
    : [];

  const testDirectory = mkdtempSync(
    join(tmpdir(), "tree-sitter-regex-scanner."),
  );
  try {
    for (const standard of ["c99", "c17"]) {
      for (const variant of scannerVariants) {
        const compilerArguments = [
          ...sanitizerArguments,
          `-std=${standard}`,
          "-Wall",
          "-Wextra",
          "-Werror",
          "-pedantic",
          "-I",
          variant.includeDirectory,
        ];
        checkExternalTokenOrder(
          clang,
          compilerArguments,
          variant,
          testDirectory,
        );

        const executableSuffix = process.platform === "win32" ? ".exe" : "";
        const testBinary = join(
          testDirectory,
          `scanner-${variant.name}-${standard}${executableSuffix}`,
        );
        run(clang, [
          ...compilerArguments,
          variant.modeArgument,
          ...(variant.family === "python"
            ? ["-DPYTHON_RE_LANGUAGE=python_re_test"]
            : []),
          variant.contract,
          "-o",
          testBinary,
        ]);
        run(testBinary, []);
        process.stdout.write(
          `${variant.name}: scanner tests passed (${standard.toUpperCase()})\n`,
        );
      }
    }
  } finally {
    rmSync(testDirectory, { force: true, recursive: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitStatus ?? 1;
}
