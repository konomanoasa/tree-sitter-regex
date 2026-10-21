import assert from "node:assert/strict";

const rootNodes = {
  ecmaregex: "pattern",
  ecmaregex_u: "pattern",
  ecmaregex_v: "pattern",
  pcre2: "pattern",
  posix_bre: "basic_reg_exp",
  posix_ere: "extended_reg_exp",
  pyregex: "pattern",
  pyregex_verbose: "pattern",
};

function sourceEndPoint(source) {
  const bytes = Buffer.from(source);
  let row = 0;
  for (const byte of bytes) if (byte === 0x0a) row += 1;
  return `${row}:${bytes.length - bytes.lastIndexOf(0x0a) - 1}`;
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

function hasRecovery(cst) {
  return /^[0-9: \t-]+•/m.test(cst);
}

function parseCst(cst, source, language, status = 0) {
  const expectedRoot = rootNodes[language];
  assert.ok(expectedRoot, `unknown language: ${language}`);
  const root = /^[0-9]+:[0-9]+ +- +([0-9]+:[0-9]+) +•?([^ \n]+)/.exec(cst);
  assert.ok(root, "parser produced no CST root");
  assert.equal(
    root[1],
    sourceEndPoint(source),
    "root must reach the edited source end",
  );
  if (status === 0) assert.equal(root[2], expectedRoot, cst);
  const recovery = hasRecovery(cst);
  return { status: recovery ? 1 : status, cst, recovery };
}

export { hasRecovery, parseCst, selectNodes, sourceEndPoint };
