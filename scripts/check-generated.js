import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { generateParsers, grammars, packageName, root } from "./tree-sitter.js";

const prerequisiteScripts = ["generate-unicode.js"];

const generatedPaths = [
  "grammar.json",
  "node-types.json",
  "parser.c",
  join("tree_sitter", "alloc.h"),
  join("tree_sitter", "array.h"),
  join("tree_sitter", "parser.h"),
].sort();

function listFiles(directory, prefix = "") {
  const paths = [];
  for (const entry of readdirSync(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) {
      paths.push(...listFiles(directory, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

function different(left, right) {
  try {
    return !readFileSync(left).equals(readFileSync(right));
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

function readDefinition(parser, name, path) {
  const match = parser.match(new RegExp(`^#define ${name} ([0-9]+)$`, "m"));
  if (match === null) {
    throw new Error(`${path} does not define ${name} as an integer`);
  }
  return Number(match[1]);
}

function languageVersion(grammar, generatedRoot) {
  const parserPath = join(generatedRoot, grammar.path, "src", "parser.c");
  return readDefinition(
    readFileSync(parserPath, "utf8"),
    "LANGUAGE_VERSION",
    relative(generatedRoot, parserPath),
  );
}

function main(arguments_) {
  if (arguments_.length !== 0) {
    throw new Error("Usage: node scripts/check-generated.js");
  }
  for (const script of prerequisiteScripts) {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", script), "--check"],
      {
        cwd: root,
        stdio: "inherit",
        timeout: 60_000,
        killSignal: "SIGKILL",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return 1;
  }

  const generatedRoot = mkdtempSync(
    join(tmpdir(), `${packageName}-generated-`),
  );
  try {
    if (generateParsers(generatedRoot) !== 0) return 1;

    let failed = false;
    const stale = [];
    for (const grammar of grammars) {
      const generatedDirectory = join(generatedRoot, grammar.path, "src");
      const actualPaths = listFiles(generatedDirectory);
      if (JSON.stringify(actualPaths) !== JSON.stringify(generatedPaths)) {
        console.error(`${grammar.name}: generated file manifest differs.`);
        console.error(`Expected:\n${generatedPaths.join("\n")}`);
        console.error(`Actual:\n${actualPaths.join("\n")}`);
        failed = true;
      }
      for (const path of generatedPaths) {
        const generatedPath = join(generatedDirectory, path);
        const repositoryPath = join(root, grammar.path, "src", path);
        if (different(generatedPath, repositoryPath)) {
          stale.push(relative(root, repositoryPath));
        }
      }
    }
    if (stale.length > 0) {
      console.error("Generated parser files are stale or missing:");
      for (const path of stale) console.error(`  ${path}`);
      console.error("Run npm run generate and review the results.");
      failed = true;
    }

    const languageVersions = new Map(
      grammars.map((grammar) => [
        grammar.name,
        languageVersion(grammar, generatedRoot),
      ]),
    );
    if (new Set(languageVersions.values()).size !== 1) {
      console.error(
        "Generated parsers use different Tree-sitter ABI versions:",
      );
      for (const [name, version] of languageVersions) {
        console.error(`  ${name}: ${version}`);
      }
      failed = true;
    }
    return failed ? 1 : 0;
  } finally {
    rmSync(generatedRoot, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
