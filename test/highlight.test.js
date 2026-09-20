import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createTreeSitter, grammars, root } from "../scripts/tree-sitter.js";

function decodeEntities(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function renderedCaptures(html, source) {
  const start = html.indexOf("<pre><code>");
  const end = html.indexOf("</code></pre>");
  assert.ok(start >= 0 && end >= start, html);
  const content = html.slice(start + "<pre><code>".length, end);
  const stack = [];
  const captures = [];
  let text = "";
  for (const part of content.matchAll(
    /<span class='([^']*)'>|<\/span>|([^<]+)/g,
  )) {
    if (part[1] !== undefined) stack.push(part[1].replaceAll(" ", "."));
    else if (part[0] === "</span>") assert.notEqual(stack.pop(), undefined);
    else {
      const decoded = decodeEntities(part[2]);
      text += decoded;
      captures.push(
        ...Array(Buffer.byteLength(decoded)).fill(stack.at(-1) ?? ""),
      );
    }
  }
  assert.equal(stack.length, 0, "unclosed highlight span");
  assert.equal(
    text.replace(/\n$/, ""),
    source.replace(/\n$/, ""),
    "rendered source differs from the input",
  );
  return captures;
}

function createHighlighter({ directory, root, run, captureNames }) {
  const parserDirectory = join(directory, "parsers");
  mkdirSync(parserDirectory);
  // CLI discovery requires a tree-sitter-* entry even when the checkout is renamed.
  symlinkSync(root, join(parserDirectory, "tree-sitter-test"), "junction");
  const configPath = join(directory, "highlight.json");
  const capturePath = join(directory, "captures.txt");
  writeFileSync(
    configPath,
    JSON.stringify({
      "parser-directories": [parserDirectory],
      theme: Object.fromEntries(
        captureNames.map((name, index) => [name, index + 17]),
      ),
    }),
  );
  writeFileSync(capturePath, `${captureNames.join("\n")}\n`);

  return (scope, source, valid = true) => {
    const path = join(directory, "highlight.txt");
    writeFileSync(path, source);
    if (valid) {
      const parsed = run(["parse", "--cst", "--scope", scope, path]);
      assert.doesNotMatch(parsed, /^[0-9: \t-]+•/m, parsed);
    }
    const captures = renderedCaptures(
      run([
        "highlight",
        "--check",
        "--captures-path",
        capturePath,
        "--config-path",
        configPath,
        "--html",
        "--layout",
        "fragment",
        "--style",
        "classes",
        "--scope",
        scope,
        path,
      ]),
      source,
    );
    for (const capture of captures) {
      assert.ok(
        capture === "" || captureNames.includes(capture),
        `unexpected final capture: ${capture}`,
      );
    }
    return captures;
  };
}

function assertCaptures(source, actual, ranges) {
  const bytes = Buffer.from(source);
  const expected = Array(bytes.length).fill("");
  let previousEnd = 0;
  for (const [start, end, capture] of ranges) {
    assert.ok(
      Number.isSafeInteger(start) && start >= previousEnd,
      "expected ranges must be ordered and disjoint",
    );
    assert.ok(
      Number.isSafeInteger(end) && end > start && end <= bytes.length,
      "expected range exceeds source bytes",
    );
    expected.fill(capture, start, end);
    previousEnd = end;
  }
  // HTML emits line breaks outside spans; compare colors on source characters.
  for (const [index, byte] of bytes.entries()) {
    if (byte !== 10)
      assert.equal(
        actual[index],
        expected[index],
        `byte ${index} in ${JSON.stringify(source)}`,
      );
  }
}

const captureNames = [
  "character.special",
  "comment",
  "keyword.modifier",
  "label",
  "number",
  "operator",
  "punctuation.bracket",
  "punctuation.delimiter",
  "punctuation.special",
  "string.escape",
  "string.regexp",
];

const cases = [
  {
    name: "HTML-sensitive Unicode literals retain source bytes and captures",
    languages: grammars.map(({ name }) => name),
    source: `é😀<&>"'`,
    captures: [[0, 11, "string.regexp"]],
  },

  {
    name: "empty patterns have no captures",
    languages: grammars
      .map(({ name }) => name)
      .filter((name) => !name.startsWith("posix_")),
    source: "",
    captures: [],
  },
  {
    name: "an empty regular expression has no captures",
    languages: ["posix_bre", "posix_ere"],
    source: "",
    captures: [],
    valid: false,
  },
  {
    name: "UTF-8 characters and literal punctuation retain literal captures",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: "é 😀-_,;:#",
    captures: [[0, 13, "string.regexp"]],
  },
  {
    name: "assertions differ from literal characters and wildcard",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`^a|.$\b\B`,
    captures: [
      [0, 1, "operator"],
      [1, 2, "string.regexp"],
      [2, 3, "operator"],
      [3, 4, "character.special"],
      [4, 9, "operator"],
    ],
  },
  {
    name: "group punctuation is split by role for all lookarounds",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: "(a)(?:b)(?=c)(?!d)(?<=e)(?<!f)",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "string.regexp"],
      [2, 4, "punctuation.bracket"],
      [4, 5, "punctuation.special"],
      [5, 6, "punctuation.delimiter"],
      [6, 7, "string.regexp"],
      [7, 9, "punctuation.bracket"],
      [9, 10, "punctuation.special"],
      [10, 11, "operator"],
      [11, 12, "string.regexp"],
      [12, 14, "punctuation.bracket"],
      [14, 15, "punctuation.special"],
      [15, 16, "operator"],
      [16, 17, "string.regexp"],
      [17, 19, "punctuation.bracket"],
      [19, 20, "punctuation.special"],
      [20, 22, "operator"],
      [22, 23, "string.regexp"],
      [23, 25, "punctuation.bracket"],
      [25, 26, "punctuation.special"],
      [26, 28, "operator"],
      [28, 29, "string.regexp"],
      [29, 30, "punctuation.bracket"],
    ],
  },
  {
    name: "inline modifiers and quantifiers use their separate leaf roles",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: "(?im-s:a+?b*?c??d{12,34}?e{2,}f{3})",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 4, "keyword.modifier"],
      [4, 5, "operator"],
      [5, 6, "keyword.modifier"],
      [6, 7, "punctuation.delimiter"],
      [7, 8, "string.regexp"],
      [8, 10, "operator"],
      [10, 11, "string.regexp"],
      [11, 13, "operator"],
      [13, 14, "string.regexp"],
      [14, 16, "operator"],
      [16, 17, "string.regexp"],
      [17, 18, "punctuation.bracket"],
      [18, 20, "number"],
      [20, 21, "punctuation.delimiter"],
      [21, 23, "number"],
      [23, 24, "punctuation.bracket"],
      [24, 25, "operator"],
      [25, 26, "string.regexp"],
      [26, 27, "punctuation.bracket"],
      [27, 28, "number"],
      [28, 29, "punctuation.delimiter"],
      [29, 30, "punctuation.bracket"],
      [30, 31, "string.regexp"],
      [31, 32, "punctuation.bracket"],
      [32, 33, "number"],
      [33, 35, "punctuation.bracket"],
    ],
  },
  {
    name: "named groups and references preserve escaped UTF-8 identifier leaves",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`(?<$_é\u0061>x)\k<$_é\u0061>`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "punctuation.bracket"],
      [3, 7, "label"],
      [7, 13, "string.escape"],
      [13, 14, "punctuation.bracket"],
      [14, 15, "string.regexp"],
      [15, 16, "punctuation.bracket"],
      [16, 18, "punctuation.special"],
      [18, 19, "punctuation.bracket"],
      [19, 23, "label"],
      [23, 29, "string.escape"],
      [29, 30, "punctuation.bracket"],
    ],
  },
  {
    name: "ordinary surrogate-pair name leaves retain labels before identifier validation",
    languages: ["javascript_regex"],
    source: String.raw`(?<😀𐐀>)\k<😀𐐀>`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "punctuation.bracket"],
      [3, 11, "label"],
      [11, 13, "punctuation.bracket"],
      [13, 15, "punctuation.special"],
      [15, 16, "punctuation.bracket"],
      [16, 24, "label"],
      [24, 25, "punctuation.bracket"],
    ],
  },
  {
    name: "braced Unicode identifier escapes retain their bracket captures",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`(?<\u{61}>x)\k<a>`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "punctuation.bracket"],
      [3, 5, "string.escape"],
      [5, 6, "punctuation.bracket"],
      [6, 8, "string.escape"],
      [8, 10, "punctuation.bracket"],
      [10, 11, "string.regexp"],
      [11, 12, "punctuation.bracket"],
      [12, 14, "punctuation.special"],
      [14, 15, "punctuation.bracket"],
      [15, 16, "label"],
      [16, 17, "punctuation.bracket"],
    ],
  },
  {
    name: "character escapes retain source leaves for prefixes and digits",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`\n\r\t\f\v\cA\0\x41\u0041\/`,
    captures: [[0, 27, "string.escape"]],
  },
  {
    name: "numeric backreferences are escapes rather than repetition counts",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`(a)\1`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "string.regexp"],
      [2, 3, "punctuation.bracket"],
      [3, 5, "string.escape"],
    ],
  },
  {
    name: "escaped regex punctuation remains an escape",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`\^\$\.\*\+\?\(\)\[\]\{\}\|`,
    captures: [[0, 26, "string.escape"]],
  },
  {
    name: "classic classes separate range operators and backspace escape leaves",
    languages: ["javascript_regex", "javascript_regex_u"],
    source: String.raw`[a-z\d\b]`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "string.regexp"],
      [2, 3, "operator"],
      [3, 4, "string.regexp"],
      [4, 6, "character.special"],
      [6, 8, "string.escape"],
      [8, 9, "punctuation.bracket"],
    ],
  },
  {
    name: "Unicode set classes preserve the backspace terminal as one leaf",
    languages: ["javascript_regex_v"],
    source: String.raw`[a-z\d\b]`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "string.regexp"],
      [2, 3, "operator"],
      [3, 4, "string.regexp"],
      [4, 6, "character.special"],
      [6, 8, "string.escape"],
      [8, 9, "punctuation.bracket"],
    ],
  },
  {
    name: "all shorthand character classes keep special character captures",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`\d\D\s\S\w\W[\D\s\S\w\W]`,
    captures: [
      [0, 12, "character.special"],
      [12, 13, "punctuation.bracket"],
      [13, 23, "character.special"],
      [23, 24, "punctuation.bracket"],
    ],
  },
  {
    name: "classic class hyphens remain literal at both edges",
    languages: ["javascript_regex", "javascript_regex_u"],
    source: "[-a-]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 4, "string.regexp"],
      [4, 5, "punctuation.bracket"],
    ],
  },
  {
    name: "Annex B identity octal and literal fallback spellings differ",
    languages: ["javascript_regex"],
    source: String.raw`\8\11\c_\p{L}]}{`,
    captures: [
      [0, 5, "string.escape"],
      [5, 8, "string.regexp"],
      [8, 10, "string.escape"],
      [10, 16, "string.regexp"],
    ],
  },
  {
    name: "Annex B class control escapes include numeric and underscore payloads",
    languages: ["javascript_regex"],
    source: String.raw`[\c1\c_]`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 7, "string.escape"],
      [7, 8, "punctuation.bracket"],
    ],
  },
  {
    name: "Annex B reference markers without named groups are identity escapes",
    languages: ["javascript_regex"],
    source: String.raw`\k<a>`,
    captures: [
      [0, 2, "string.escape"],
      [2, 5, "string.regexp"],
    ],
  },
  {
    name: "Annex B invalid braced quantifiers keep structural token classifications",
    languages: ["javascript_regex"],
    source: "{2,1}a{2,1}",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "number"],
      [2, 3, "punctuation.delimiter"],
      [3, 4, "number"],
      [4, 5, "punctuation.bracket"],
      [5, 6, "string.regexp"],
      [6, 7, "punctuation.bracket"],
      [7, 8, "number"],
      [8, 9, "punctuation.delimiter"],
      [9, 10, "number"],
      [10, 11, "punctuation.bracket"],
    ],
  },
  {
    name: "Unicode code points and surrogate pairs preserve distinct leaf ranges",
    languages: ["javascript_regex_u", "javascript_regex_v"],
    source: String.raw`\u{41}\uD83D\uDE00`,
    captures: [
      [0, 2, "string.escape"],
      [2, 3, "punctuation.bracket"],
      [3, 5, "string.escape"],
      [5, 6, "punctuation.bracket"],
      [6, 18, "string.escape"],
    ],
  },
  {
    name: "Unicode property payloads exclude braces and equality operators",
    languages: ["javascript_regex_u", "javascript_regex_v"],
    source: String.raw`\p{L}\P{gc=Lu}\p{scx=Latn}`,
    captures: [
      [0, 2, "character.special"],
      [2, 3, "punctuation.bracket"],
      [3, 4, "character.special"],
      [4, 5, "punctuation.bracket"],
      [5, 7, "character.special"],
      [7, 8, "punctuation.bracket"],
      [8, 10, "character.special"],
      [10, 11, "operator"],
      [11, 13, "character.special"],
      [13, 14, "punctuation.bracket"],
      [14, 16, "character.special"],
      [16, 17, "punctuation.bracket"],
      [17, 20, "character.special"],
      [20, 21, "operator"],
      [21, 25, "character.special"],
      [25, 26, "punctuation.bracket"],
    ],
  },
  {
    name: "property spelling is highlighted without validating Unicode names",
    languages: ["javascript_regex_u", "javascript_regex_v"],
    source: String.raw`\p{A_=B_2}`,
    captures: [
      [0, 2, "character.special"],
      [2, 3, "punctuation.bracket"],
      [3, 5, "character.special"],
      [5, 6, "operator"],
      [6, 9, "character.special"],
      [9, 10, "punctuation.bracket"],
    ],
  },
  {
    name: "Unicode sets separate nested brackets operators and class strings",
    languages: ["javascript_regex_v"],
    source: String.raw`[[a-z]&&[^x]][\p{L}--\q{a|é|\n}]`,
    captures: [
      [0, 2, "punctuation.bracket"],
      [2, 3, "string.regexp"],
      [3, 4, "operator"],
      [4, 5, "string.regexp"],
      [5, 6, "punctuation.bracket"],
      [6, 8, "operator"],
      [8, 9, "punctuation.bracket"],
      [9, 10, "operator"],
      [10, 11, "string.regexp"],
      [11, 14, "punctuation.bracket"],
      [14, 16, "character.special"],
      [16, 17, "punctuation.bracket"],
      [17, 18, "character.special"],
      [18, 19, "punctuation.bracket"],
      [19, 21, "operator"],
      [21, 23, "punctuation.special"],
      [23, 24, "punctuation.bracket"],
      [24, 25, "string.regexp"],
      [25, 26, "operator"],
      [26, 28, "string.regexp"],
      [28, 29, "operator"],
      [29, 31, "string.escape"],
      [31, 33, "punctuation.bracket"],
    ],
  },
  {
    name: "Unicode set reserved punctuation stays escaped",
    languages: ["javascript_regex_v"],
    source: "[\\&\\-\\!\\#\\%\\,\\:\\;\\<\\=\\>\\@\\`\\~\\b]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 31, "string.escape"],
      [31, 32, "punctuation.bracket"],
    ],
  },
  {
    name: "character class negation differs from a literal caret",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: "[^^]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "operator"],
      [2, 3, "string.regexp"],
      [3, 4, "punctuation.bracket"],
    ],
  },
  {
    name: "multi-digit backreferences keep every decimal leaf escaped",
    languages: ["javascript_regex", "javascript_regex_u", "javascript_regex_v"],
    source: String.raw`()()()()()()()()()()\10`,
    captures: [
      [0, 20, "punctuation.bracket"],
      [20, 23, "string.escape"],
    ],
  },
  {
    name: "Annex B literal backslashes in classes keep literal capture roles",
    languages: ["javascript_regex"],
    source: String.raw`[\c]`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 3, "string.regexp"],
      [3, 4, "punctuation.bracket"],
    ],
  },
  {
    name: "Annex B surrogate escapes remain separate fixed-width escapes",
    languages: ["javascript_regex"],
    source: String.raw`\uD83D\uDE00`,
    captures: [[0, 12, "string.escape"]],
  },
  {
    name: "Annex B quantifiable assertions distinguish introducer and quantifier",
    languages: ["javascript_regex"],
    source: "(?=a)?",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "operator"],
      [3, 4, "string.regexp"],
      [4, 5, "punctuation.bracket"],
      [5, 6, "operator"],
    ],
  },
  {
    name: "empty class string alternatives retain only real separator leaves",
    languages: ["javascript_regex_v"],
    source: String.raw`[\q{|a||}]`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 3, "punctuation.special"],
      [3, 4, "punctuation.bracket"],
      [4, 5, "operator"],
      [5, 6, "string.regexp"],
      [6, 8, "operator"],
      [8, 10, "punctuation.bracket"],
    ],
  },
  {
    name: "Unicode multi-digit references retain maximal spelling without resolving groups",
    languages: ["javascript_regex_u", "javascript_regex_v"],
    source: String.raw`\12+\100?`,
    captures: [
      [0, 3, "string.escape"],
      [3, 4, "operator"],
      [4, 8, "string.escape"],
      [8, 9, "operator"],
    ],
  },
  {
    name: "ordinary characters retain literal punctuation and UTF-8 byte ranges",
    languages: ["python_re"],
    source: "é -{}]:,#",
    captures: [[0, 10, "string.regexp"]],
  },
  {
    name: "wildcard, alternation, anchors and boundary escapes",
    languages: ["python_re", "python_re_verbose"],
    source: String.raw`^.|\b\B\A\z\Z$`,
    captures: [
      [0, 1, "operator"],
      [1, 2, "character.special"],
      [2, 14, "operator"],
    ],
  },
  {
    name: "character class negation, range and class escape",
    languages: ["python_re", "python_re_verbose"],
    source: String.raw`[^a-z\d\D\s\S\w\W]`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "operator"],
      [2, 3, "string.regexp"],
      [3, 4, "operator"],
      [4, 5, "string.regexp"],
      [5, 17, "character.special"],
      [17, 18, "punctuation.bracket"],
    ],
  },
  {
    name: "character class punctuation and whitespace remain literal",
    languages: ["python_re", "python_re_verbose"],
    source: "[.^$(){}|?*+ #-]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 15, "string.regexp"],
      [15, 16, "punctuation.bracket"],
    ],
  },
  {
    name: "leading closing bracket and trailing dash are class characters",
    languages: ["python_re", "python_re_verbose"],
    source: "[]-]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 3, "string.regexp"],
      [3, 4, "punctuation.bracket"],
    ],
  },
  {
    name: "backspace and split numeric escapes inside a character class",
    languages: ["python_re", "python_re_verbose"],
    source: String.raw`[\b\1\077\x41\N{SPACE}]`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 15, "string.escape"],
      [15, 16, "punctuation.bracket"],
      [16, 21, "string.escape"],
      [21, 23, "punctuation.bracket"],
    ],
  },
  {
    name: "literal and control escapes retain complete leaves",
    languages: ["python_re", "python_re_verbose"],
    source: "\\n\\a\\f\\r\\t\\v\\/\\#\\ \\\\",
    captures: [[0, 20, "string.escape"]],
  },
  {
    name: "hexadecimal, Unicode and named Unicode escapes split their payloads",
    languages: ["python_re", "python_re_verbose"],
    source: String.raw`\x41\u0041\U00000041\N{LATIN CAPITAL LETTER A}`,
    captures: [
      [0, 22, "string.escape"],
      [22, 23, "punctuation.bracket"],
      [23, 45, "string.escape"],
      [45, 46, "punctuation.bracket"],
    ],
  },
  {
    name: "octal escapes and numeric references classify each public leaf",
    languages: ["python_re", "python_re_verbose"],
    source: String.raw`\0\077\123\1\99`,
    captures: [[0, 15, "string.escape"]],
  },
  {
    name: "capturing, non-capturing, lookaround and atomic groups separate marker roles",
    languages: ["python_re", "python_re_verbose"],
    source: "()(?:a)(?=b)(?!c)(?<=d)(?<!e)(?>f)",
    captures: [
      [0, 3, "punctuation.bracket"],
      [3, 4, "punctuation.special"],
      [4, 5, "punctuation.delimiter"],
      [5, 6, "string.regexp"],
      [6, 8, "punctuation.bracket"],
      [8, 9, "punctuation.special"],
      [9, 10, "operator"],
      [10, 11, "string.regexp"],
      [11, 13, "punctuation.bracket"],
      [13, 14, "punctuation.special"],
      [14, 15, "operator"],
      [15, 16, "string.regexp"],
      [16, 18, "punctuation.bracket"],
      [18, 19, "punctuation.special"],
      [19, 21, "operator"],
      [21, 22, "string.regexp"],
      [22, 24, "punctuation.bracket"],
      [24, 25, "punctuation.special"],
      [25, 27, "operator"],
      [27, 28, "string.regexp"],
      [28, 30, "punctuation.bracket"],
      [30, 31, "punctuation.special"],
      [31, 32, "operator"],
      [32, 33, "string.regexp"],
      [33, 34, "punctuation.bracket"],
    ],
  },
  {
    name: "named capture and reference preserve multibyte name ranges",
    languages: ["python_re", "python_re_verbose"],
    source: "(?P<é>a)(?P=é)",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 3, "punctuation.special"],
      [3, 4, "punctuation.bracket"],
      [4, 6, "label"],
      [6, 7, "punctuation.bracket"],
      [7, 8, "string.regexp"],
      [8, 10, "punctuation.bracket"],
      [10, 12, "punctuation.special"],
      [12, 13, "operator"],
      [13, 15, "label"],
      [15, 16, "punctuation.bracket"],
    ],
  },
  {
    name: "conditional numeric and named references use labels",
    languages: ["python_re", "python_re_verbose"],
    source: "(?(12)a|b)(?(name)c|d)",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "punctuation.bracket"],
      [3, 5, "label"],
      [5, 6, "punctuation.bracket"],
      [6, 7, "string.regexp"],
      [7, 8, "operator"],
      [8, 9, "string.regexp"],
      [9, 11, "punctuation.bracket"],
      [11, 12, "punctuation.special"],
      [12, 13, "punctuation.bracket"],
      [13, 17, "label"],
      [17, 18, "punctuation.bracket"],
      [18, 19, "string.regexp"],
      [19, 20, "operator"],
      [20, 21, "string.regexp"],
      [21, 22, "punctuation.bracket"],
    ],
  },
  {
    name: "inline flags classify complete flag sets and disabling operators",
    languages: ["python_re", "python_re_verbose"],
    source: "(?im)(?ai-ms:a)",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 4, "keyword.modifier"],
      [4, 6, "punctuation.bracket"],
      [6, 7, "punctuation.special"],
      [7, 9, "keyword.modifier"],
      [9, 10, "operator"],
      [10, 12, "keyword.modifier"],
      [12, 13, "punctuation.delimiter"],
      [13, 14, "string.regexp"],
      [14, 15, "punctuation.bracket"],
    ],
  },
  {
    name: "global verbose flags make subsequent layout and comments non-literal",
    languages: ["python_re", "python_re_verbose"],
    source: "(?imx) a # note\n b",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 5, "keyword.modifier"],
      [5, 6, "punctuation.bracket"],
      [7, 8, "string.regexp"],
      [9, 15, "comment"],
      [17, 18, "string.regexp"],
    ],
  },
  {
    name: "disabling verbose flags makes spaces and hash characters literal",
    languages: ["python_re", "python_re_verbose"],
    source: "(?-x: #)",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "operator"],
      [3, 4, "keyword.modifier"],
      [4, 5, "punctuation.delimiter"],
      [5, 7, "string.regexp"],
      [7, 8, "punctuation.bracket"],
    ],
  },
  {
    name: "nested verbose scopes restore non-verbose outer layout",
    languages: ["python_re"],
    source: "(?x:a (?-x: b#c) d # note\n e) f",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "keyword.modifier"],
      [3, 4, "punctuation.delimiter"],
      [4, 5, "string.regexp"],
      [6, 7, "punctuation.bracket"],
      [7, 8, "punctuation.special"],
      [8, 9, "operator"],
      [9, 10, "keyword.modifier"],
      [10, 11, "punctuation.delimiter"],
      [11, 15, "string.regexp"],
      [15, 16, "punctuation.bracket"],
      [17, 18, "string.regexp"],
      [19, 25, "comment"],
      [27, 28, "string.regexp"],
      [28, 29, "punctuation.bracket"],
      [29, 31, "string.regexp"],
    ],
  },
  {
    name: "nested verbose scopes restore verbose outer layout",
    languages: ["python_re_verbose"],
    source: "(?x:a (?-x: b#c) d # note\n e) f",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 3, "keyword.modifier"],
      [3, 4, "punctuation.delimiter"],
      [4, 5, "string.regexp"],
      [6, 7, "punctuation.bracket"],
      [7, 8, "punctuation.special"],
      [8, 9, "operator"],
      [9, 10, "keyword.modifier"],
      [10, 11, "punctuation.delimiter"],
      [11, 15, "string.regexp"],
      [15, 16, "punctuation.bracket"],
      [17, 18, "string.regexp"],
      [19, 25, "comment"],
      [27, 28, "string.regexp"],
      [28, 29, "punctuation.bracket"],
      [30, 31, "string.regexp"],
    ],
  },
  {
    name: "comment groups expose markers, content and brackets separately",
    languages: ["python_re", "python_re_verbose"],
    source: "(?#é)(?#)",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 5, "comment"],
      [5, 7, "punctuation.bracket"],
      [7, 8, "punctuation.special"],
      [8, 9, "comment"],
      [9, 10, "punctuation.bracket"],
    ],
  },
  {
    name: "verbose classes and escaped layout preserve literal roles",
    languages: ["python_re_verbose"],
    source: String.raw`[ #] \#\  #é
`,
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 3, "string.regexp"],
      [3, 4, "punctuation.bracket"],
      [5, 9, "string.escape"],
      [10, 13, "comment"],
    ],
  },
  {
    name: "quantifiers separate operators, counts and interval punctuation",
    languages: ["python_re", "python_re_verbose"],
    source: "a*b+?c??d*+e{12}f{2,4}?g{,3}+h{,}",
    captures: [
      [0, 1, "string.regexp"],
      [1, 2, "operator"],
      [2, 3, "string.regexp"],
      [3, 5, "operator"],
      [5, 6, "string.regexp"],
      [6, 8, "operator"],
      [8, 9, "string.regexp"],
      [9, 11, "operator"],
      [11, 12, "string.regexp"],
      [12, 13, "punctuation.bracket"],
      [13, 15, "number"],
      [15, 16, "punctuation.bracket"],
      [16, 17, "string.regexp"],
      [17, 18, "punctuation.bracket"],
      [18, 19, "number"],
      [19, 20, "punctuation.delimiter"],
      [20, 21, "number"],
      [21, 22, "punctuation.bracket"],
      [22, 23, "operator"],
      [23, 24, "string.regexp"],
      [24, 25, "punctuation.bracket"],
      [25, 26, "punctuation.delimiter"],
      [26, 27, "number"],
      [27, 28, "punctuation.bracket"],
      [28, 29, "operator"],
      [29, 30, "string.regexp"],
      [30, 31, "punctuation.bracket"],
      [31, 32, "punctuation.delimiter"],
      [32, 33, "punctuation.bracket"],
    ],
  },
  {
    name: "verbose layout between operand and quantifier remains unhighlighted",
    languages: ["python_re_verbose"],
    source: "a # repeat\n +?",
    captures: [
      [0, 1, "string.regexp"],
      [2, 10, "comment"],
      [12, 14, "operator"],
    ],
  },
  {
    name: "expression operators differ from literal characters and the wildcard",
    languages: ["posix_ere"],
    source: "^a.$|b*c+d?",
    captures: [
      [0, 1, "operator"],
      [1, 2, "string.regexp"],
      [2, 3, "character.special"],
      [3, 5, "operator"],
      [5, 6, "string.regexp"],
      [6, 7, "operator"],
      [7, 8, "string.regexp"],
      [8, 9, "operator"],
      [9, 10, "string.regexp"],
      [10, 11, "operator"],
    ],
  },
  {
    name: "quoted characters are escapes",
    languages: ["posix_ere"],
    source: String.raw`\(\.\\`,
    captures: [[0, 6, "string.escape"]],
  },
  {
    name: "interval counts and the repetition modifier keep distinct roles",
    languages: ["posix_ere"],
    source: "a{1,2}?",
    captures: [
      [0, 1, "string.regexp"],
      [1, 2, "punctuation.bracket"],
      [2, 3, "number"],
      [3, 4, "punctuation.delimiter"],
      [4, 5, "number"],
      [5, 6, "punctuation.bracket"],
      [6, 7, "operator"],
    ],
  },
  {
    name: "groups own their delimiters",
    languages: ["posix_ere"],
    source: "(a|b)*",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "string.regexp"],
      [2, 3, "operator"],
      [3, 4, "string.regexp"],
      [4, 5, "punctuation.bracket"],
      [5, 6, "operator"],
    ],
  },
  {
    name: "bracket expressions separate literal hyphens from the range operator",
    languages: ["posix_bre", "posix_ere"],
    source: "[^]a-z-]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "operator"],
      [2, 4, "string.regexp"],
      [4, 5, "operator"],
      [5, 7, "string.regexp"],
      [7, 8, "punctuation.bracket"],
    ],
  },
  {
    name: "compound bracket elements keep their delimiters and payload roles",
    languages: ["posix_bre", "posix_ere"],
    source: "[[.ch.][=a=][:alpha:]]",
    captures: [
      [0, 3, "punctuation.bracket"],
      [3, 5, "string.regexp"],
      [5, 9, "punctuation.bracket"],
      [9, 10, "string.regexp"],
      [10, 14, "punctuation.bracket"],
      [14, 19, "character.special"],
      [19, 22, "punctuation.bracket"],
    ],
  },
  {
    name: "expression operators differ from literal characters and the wildcard",
    languages: ["posix_bre"],
    source: String.raw`^a.$\|b*c\+d\?`,
    captures: [
      [0, 1, "operator"],
      [1, 2, "string.regexp"],
      [2, 3, "character.special"],
      [3, 6, "operator"],
      [6, 7, "string.regexp"],
      [7, 8, "operator"],
      [8, 9, "string.regexp"],
      [9, 11, "operator"],
      [11, 12, "string.regexp"],
      [12, 14, "operator"],
    ],
  },
  {
    name: "quoted characters are escapes",
    languages: ["posix_bre"],
    source: String.raw`\^\.\\`,
    captures: [[0, 6, "string.escape"]],
  },
  {
    name: "interval counts keep distinct roles",
    languages: ["posix_bre"],
    source: String.raw`a\{1,2\}`,
    captures: [
      [0, 1, "string.regexp"],
      [1, 3, "punctuation.bracket"],
      [3, 4, "number"],
      [4, 5, "punctuation.delimiter"],
      [5, 6, "number"],
      [6, 8, "punctuation.bracket"],
    ],
  },
  {
    name: "subexpressions own their delimiters and back-references are escapes",
    languages: ["posix_bre"],
    source: String.raw`\(a\)\1`,
    captures: [
      [0, 2, "punctuation.bracket"],
      [2, 3, "string.regexp"],
      [3, 5, "punctuation.bracket"],
      [5, 7, "string.escape"],
    ],
  },
  {
    name: "an unmatched closer retains its literal capture after a group",
    languages: ["posix_ere"],
    source: "(a))",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "string.regexp"],
      [2, 3, "punctuation.bracket"],
      [3, 4, "string.regexp"],
    ],
  },
  {
    name: "an opening bracket range endpoint keeps its literal capture",
    languages: ["posix_bre", "posix_ere"],
    source: "[a-[]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "string.regexp"],
      [2, 3, "operator"],
      [3, 4, "string.regexp"],
      [4, 5, "punctuation.bracket"],
    ],
  },
  {
    name: "a collating symbol meta character payload stays literal",
    languages: ["posix_bre", "posix_ere"],
    source: "[[.].]]",
    captures: [
      [0, 3, "punctuation.bracket"],
      [3, 4, "string.regexp"],
      [4, 7, "punctuation.bracket"],
    ],
  },
];

let runner;
let directory;
let highlight;

before(() => {
  directory = mkdtempSync(join(tmpdir(), "regex-highlight-"));
  runner = createTreeSitter();
  highlight = createHighlighter({
    directory,
    root,
    run: checked,
    captureNames,
  });
});

after(() => {
  runner?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function checked(arguments_) {
  const result = runner.run(arguments_, { encoding: "utf8", timeout: 60_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /Non-standard highlight captures/);
  return result.stdout;
}

// Inspect rendered HTML because query assertions accept overridden captures too.
for (const { name, languages, source, captures, valid = true } of cases) {
  for (const language of languages) {
    const grammar = grammars.find(({ name }) => name === language);
    test(`${language}: ${name}`, () => {
      assertCaptures(source, highlight(grammar.scope, source, valid), captures);
    });
  }
}

for (const grammar of grammars) {
  test(`${grammar.name}: incomplete patterns retain their source without error colors`, () => {
    for (const source of ["(", "[a", "a\\", "(?<"]) {
      for (const capture of highlight(grammar.scope, source, false)) {
        assert.ok(capture === "" || captureNames.includes(capture), capture);
      }
    }
  });
}
