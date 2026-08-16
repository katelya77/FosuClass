/*
 * R48 Widget V3 — 模板语法检查（零依赖）
 * 断言每个 widget 的 template.txt：
 *   1) ADP 标签配对平衡（Card/Col/Row/Caption/Title/Badge/Divider/ListView/ListViewItem/Button/Text）
 *   2) ${...} 引用的顶层字段存在于对应 widget schema.json（排除 map 回调局部变量）
 *   3) 不包含外部网络资源引用
 * 运行：node tests/test-template-syntax.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");

const WIDGETS = ["schedule", "classroom", "conflict", "day-plan", "campus-overview", "choice", "recovery"];

const OPEN_TAGS = ["Card", "Col", "Row", "ListView", "ListViewItem", "Text", "Title", "Badge", "Caption"];
const SELF_CLOSING_TAGS = ["Divider", "Button"];
const ALL_TAGS = [...OPEN_TAGS, ...SELF_CLOSING_TAGS];

// map 回调局部变量：不视为 schema 顶层字段
const LOCAL_IDENTIFIERS = new Set([
  "item", "day", "action", "actionIndex", "index", "warning", "filter", "week",
  "campus", "metric", "teacher", "teacherIndex",
]);

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message.split("\n").join("\n    ")}`);
  }
}

function scanTags(template) {
  const tags = [];
  let i = 0;
  while (i < template.length) {
    const lt = template.indexOf("<", i);
    if (lt === -1) break;
    const nameMatch = /^<\/?[A-Za-z][A-Za-z0-9]*/.exec(template.slice(lt));
    if (!nameMatch) {
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[0].replace(/[</>]/g, "");
    let j = lt + nameMatch[0].length;
    let braceDepth = 0;
    let quote = null;
    while (j < template.length) {
      const ch = template[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "{") {
        braceDepth += 1;
      } else if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (ch === ">" && braceDepth === 0) {
        break;
      }
      j += 1;
    }
    const full = template.slice(lt, j + 1);
    tags.push({ full, tag });
    i = j + 1;
  }
  return tags;
}

function parseTags(template) {
  const stack = [];
  const errors = [];
  for (const { full, tag } of scanTags(template)) {
    if (!ALL_TAGS.includes(tag)) {
      errors.push(`未知标签：<${tag}>`);
      continue;
    }
    if (full.startsWith("</")) {
      const top = stack.pop();
      if (top !== tag) {
        errors.push(`标签不匹配：期望 </${top || "?"}> 实际 </${tag}>`);
      }
    } else if (!full.endsWith("/>")) {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    errors.push(`未闭合标签：<${stack.join(", ")}>`);
  }
  return errors;
}

function templateIdentifiers(template) {
  const identifiers = new Set();
  const regex = /\$\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    const expr = match[1].replace(/^[\s\[]+/, "");
    const head = expr.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (head && !LOCAL_IDENTIFIERS.has(head[0])) {
      identifiers.add(head[0]);
    }
  }
  return identifiers;
}

console.log("== test-template-syntax ==");

check("标签配对平衡且只使用允许的 ADP 标签", () => {
  for (const widget of WIDGETS) {
    const template = fs.readFileSync(path.join(ROOT, widget, "template.txt"), "utf8");
    const errors = parseTags(template);
    assert.deepStrictEqual(errors, [], `${widget}/template.txt: ${errors.join("; ")}`);
  }
});

check("模板 ${...} 引用的顶层字段均存在于对应 schema", () => {
  for (const widget of WIDGETS) {
    const template = fs.readFileSync(path.join(ROOT, widget, "template.txt"), "utf8");
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, widget, "schema.json"), "utf8"));
    const props = new Set(Object.keys(schema.properties || {}));
    const identifiers = templateIdentifiers(template);
    for (const id of identifiers) {
      assert.ok(props.has(id), `${widget}/template.txt: 引用字段 "${id}" 不在 schema.properties 中`);
    }
  }
});

check("模板不包含外部网络资源引用", () => {
  for (const widget of WIDGETS) {
    const template = fs.readFileSync(path.join(ROOT, widget, "template.txt"), "utf8");
    assert.ok(!/https?:\/\//.test(template), `${widget}/template.txt: 包含外部 URL`);
    assert.ok(!/<img\b/i.test(template), `${widget}/template.txt: 包含 <img>`);
  }
});

check("button onClickAction 使用 sys.chat 协议", () => {
  for (const widget of WIDGETS) {
    const template = fs.readFileSync(path.join(ROOT, widget, "template.txt"), "utf8");
    const buttons = template.match(/<Button\b[^>]*>/g) || [];
    for (const button of buttons) {
      assert.match(button, /sys\.chat/, `${widget}: <Button> 缺少 sys.chat onClickAction`);
      assert.match(button, /payload/, `${widget}: <Button> 缺少 payload`);
    }
  }
});

if (failures > 0) {
  console.error(`\ntest-template-syntax: ${failures} 项失败`);
  process.exit(1);
}
console.log("test-template-syntax: 全部通过");