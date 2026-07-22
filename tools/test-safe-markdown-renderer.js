#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const {
  parseMarkdown,
  sanitizeLink,
} = require("../miniprogram/packageXiaofu/services/safeMarkdown");

function block(ast, type) {
  return ast.blocks.find((item) => item.type === type);
}

function run() {
  const source = [
    "# 课程行动建议",
    "",
    "**重点**、*说明*、~~过期~~ 与 `inline()`。",
    "",
    "- 带伞",
    "- 提前出发",
    "",
    "1. 查看课表",
    "2. 前往教室",
    "",
    "> 事实来自课表工具。",
    "",
    "---",
    "",
    "```js",
    "const room = 'B8-203';",
    "console.log(room);",
    "```",
    "",
    "| 课程 | 时间 | 教室 |",
    "| --- | ---: | :--- |",
    "| 动物解剖学 | 14:30 | B8-203 |",
    "",
    "[佛大官网](https://www.fosu.edu.cn/news) [危险链接](javascript:alert(1))",
    "<script>alert('x')</script><img src=x onerror=alert(1)>",
  ].join("\n");

  const ast = parseMarkdown(source);
  assert.strictEqual(ast.type, "document");
  assert.strictEqual(ast.truncated, false);
  assert.strictEqual(block(ast, "heading").level, 1);
  assert.ok(block(ast, "paragraph").inlines.some((item) => item.bold && item.text === "重点"));
  assert.ok(block(ast, "paragraph").inlines.some((item) => item.italic && item.text === "说明"));
  assert.ok(block(ast, "paragraph").inlines.some((item) => item.deleted && item.text === "过期"));
  assert.ok(block(ast, "paragraph").inlines.some((item) => item.code && item.text === "inline()"));
  assert.strictEqual(ast.blocks.filter((item) => item.type === "list").length, 2);
  assert.strictEqual(block(ast, "quote").text, "事实来自课表工具。");
  assert.ok(block(ast, "divider"));
  assert.strictEqual(block(ast, "code").language, "js");
  assert.ok(block(ast, "code").text.includes("B8-203"));
  assert.strictEqual(block(ast, "table").headers.length, 3);
  assert.strictEqual(block(ast, "table").rows[0][2].text, "B8-203");

  const serialized = JSON.stringify(ast);
  assert.ok(serialized.includes("https://www.fosu.edu.cn/news"));
  assert.ok(!serialized.toLowerCase().includes("javascript:"));
  assert.ok(!serialized.toLowerCase().includes("<script"));
  assert.ok(!serialized.toLowerCase().includes("onerror="));
  assert.strictEqual(sanitizeLink("https://jwxt.fosu.edu.cn/home"), "https://jwxt.fosu.edu.cn/home");
  assert.strictEqual(sanitizeLink("https://github.com/katelya77/FosuClass/issues"), "https://github.com/katelya77/FosuClass/issues");
  assert.strictEqual(sanitizeLink("https://evil.example/path"), "");
  assert.strictEqual(sanitizeLink("data:text/html;base64,abc"), "");

  const long = parseMarkdown("长".repeat(20000));
  assert.strictEqual(long.truncated, true);
  assert.strictEqual(long.collapsible, true);
  assert.ok(long.charCount <= 12000);
  assert.ok(long.blocks.length <= 120);

  const componentDir = path.join(root, "miniprogram/packageXiaofu/components/safe-markdown");
  const wxml = fs.readFileSync(path.join(componentDir, "index.wxml"), "utf8");
  const js = fs.readFileSync(path.join(componentDir, "index.js"), "utf8");
  const pageWxml = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
  const pageJson = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.json"), "utf8");

  assert.ok(wxml.includes("scroll-x"));
  assert.ok(wxml.includes("onCopyCode"));
  assert.ok(wxml.includes("onCopyLink"));
  assert.ok(wxml.includes("onToggleExpanded"));
  assert.ok(!wxml.includes("<rich-text"));
  assert.ok(js.includes("parseMarkdown"));
  assert.ok(pageWxml.includes("<safe-markdown"));
  assert.ok(pageJson.includes('"safe-markdown"'));

  console.log("test-safe-markdown-renderer: PASS");
}

run();
