#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { generateParsers, grammars, root } from "./tree-sitter.js";

const generatedPaths = [
  "grammar.json",
  "node-types.json",
  "parser.c",
  join("tree_sitter", "alloc.h"),
  join("tree_sitter", "array.h"),
  join("tree_sitter", "parser.h"),
].sort((left, right) => left.localeCompare(right));

function files(directory, prefix = "") {
  const paths = [];
  for (const entry of readdirSync(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) paths.push(...files(directory, path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

function different(left, right) {
  try {
    return !readFileSync(left).equals(readFileSync(right));
  } catch (error) {
    if (error && error.code === "ENOENT") return true;
    throw error;
  }
}

function main() {
  const unicode = spawnSync(
    process.execPath,
    [join(root, "scripts", "generate-unicode.js"), "--check"],
    { stdio: "inherit" },
  );
  if (unicode.error) throw unicode.error;
  if (unicode.status !== 0) return 1;
  const generatedRoot = mkdtempSync(
    join(tmpdir(), "tree-sitter-regex-generated-"),
  );
  try {
    const status = generateParsers(generatedRoot);
    if (status !== 0) return status;
    const stale = [];
    const languageVersions = new Map();
    for (const grammar of grammars) {
      const directory = join(generatedRoot, grammar.path, "src");
      const actualPaths = files(directory);
      if (JSON.stringify(actualPaths) !== JSON.stringify(generatedPaths)) {
        throw new Error(
          `${grammar.path}: unexpected generated files ${JSON.stringify(actualPaths)}`,
        );
      }
      for (const path of generatedPaths) {
        const repositoryPath = join(root, grammar.path, "src", path);
        if (different(join(directory, path), repositoryPath))
          stale.push(relative(root, repositoryPath));
      }
      const parser = readFileSync(join(directory, "parser.c"), "utf8");
      const version = parser.match(/^#define LANGUAGE_VERSION ([0-9]+)$/m);
      if (version === null)
        throw new Error(`${grammar.name}: missing Tree-sitter ABI version`);
      languageVersions.set(grammar.name, Number(version[1]));
    }
    if (stale.length > 0) {
      console.error("Generated parser files are stale or missing:");
      for (const path of stale) console.error(`  ${path}`);
      console.error("Run npm run generate and review the results.");
      return 1;
    }
    if (new Set(languageVersions.values()).size !== 1) {
      console.error(
        "Generated parsers use different Tree-sitter ABI versions:",
      );
      for (const [name, version] of languageVersions)
        console.error(`  ${name}: ${version}`);
      return 1;
    }
    return 0;
  } finally {
    rmSync(generatedRoot, { recursive: true, force: true });
  }
}

process.exitCode = main();
