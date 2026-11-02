import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import load from "node-gyp-build";

const binding = load(fileURLToPath(new URL("../..", import.meta.url)));

function language(name, path) {
  const result = binding[name];
  result.nodeTypeInfo = JSON.parse(
    readFileSync(
      new URL(`../../${path}/src/node-types.json`, import.meta.url),
      "utf8",
    ),
  );
  result.HIGHLIGHTS_QUERY = readFileSync(
    new URL(`../../${path}/queries/highlights.scm`, import.meta.url),
    "utf8",
  );
  return result;
}

export const ecmaregex = language("ecmaregex", "ecmascript/ecmaregex");
export const ecmaregex_u = language("ecmaregex_u", "ecmascript/ecmaregex_u");
export const ecmaregex_v = language("ecmaregex_v", "ecmascript/ecmaregex_v");
export const pcre2 = language("pcre2", "pcre2");
export const posix_bre = language("posix_bre", "posix/bre");
export const posix_ere = language("posix_ere", "posix/ere");
export const pyregex = language("pyregex", "python/pyregex");
export const pyregex_verbose = language(
  "pyregex_verbose",
  "python/pyregex_verbose",
);
