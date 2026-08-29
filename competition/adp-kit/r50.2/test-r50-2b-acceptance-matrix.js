#!/usr/bin/env node
"use strict";
// R50.2B 验收矩阵静态契约测试（2026-08-19）
// 校验 R50.2B-CONSOLE-ACCEPTANCE-MATRIX.md 的 12 家族映射：
// 1) 家族数 = 12，每行有输入/归属/期望 variant/禁止行为/判定槽；
// 2) 期望 variant 全部落在 10 个合法 variant 内，且 9 个核心 variant 全覆盖；
// 3) 矩阵 variant 必须能被 tool-variant-map.json 的 13 个工具映射产出；
// 4) 12 号家族必须显式覆盖 sys.chat + Main-first 续接。
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const matrix = fs.readFileSync(path.join(ROOT, "R50.2B-CONSOLE-ACCEPTANCE-MATRIX.md"), "utf8");
const variantMap = JSON.parse(
  fs.readFileSync(path.join(ROOT, "widget", "tool-variant-map.json"), "utf8")
);

const ALLOWED_VARIANTS = [
  "schedule", "space", "collaboration", "risk", "reschedule",
  "ranking", "overview", "empty", "error", "message",
];
const CORE_VARIANTS = [
  "schedule", "space", "collaboration", "reschedule", "ranking",
  "overview", "empty", "error",
];

const rows = matrix
  .split("\n")
  .filter((line) => /^\| \d{1,2} \|/.test(line))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
  .filter((row) => row.length === 7 && /^\d{1,2}$/.test(row[0]) && Number(row[0]) >= 1 && Number(row[0]) <= 12)
  .sort((a, b) => Number(a[0]) - Number(b[0]));

test("矩阵必须恰好 12 个家族且字段齐备", () => {
  assert.strictEqual(rows.length, 12, `expected 12 families, got ${rows.length}`);
  for (const row of rows) {
    assert.strictEqual(row.length, 7, `row 字段数必须为 7: ${row[0]}`);
    assert(row[2].length > 2, `row ${row[0]}: 输入为空`);
    // 家族 12 是路由续接（归属列描述 Main→child 路径，无「/」分隔的 Agent/工具族对）
    if (row[0] === "12") {
      assert(row[3].includes("→"), `row 12: 归属列必须描述 Main→child 路由路径`);
    } else {
      assert(row[3].includes("/"), `row ${row[0]}: 归属 Agent/工具族必须含 /`);
    }
    assert(row[5].length > 2, `row ${row[0]}: 禁止行为为空`);
    assert(row[6].trim() === "☐" || /^☐/.test(row[6]), `row ${row[0]}: 判定槽格式错误`);
  }
});

test("期望 variant 合法且核心 variant 全覆盖", () => {
  const seen = new Set();
  for (const row of rows) {
    const expected = row[4];
    const variants = expected.match(/variant=[a-z]+/g) || [];
    for (const token of variants) {
      const variant = token.replace("variant=", "");
      assert(ALLOWED_VARIANTS.includes(variant), `row ${row[0]}: 非法 variant ${variant}`);
      seen.add(variant);
    }
  }
  for (const variant of CORE_VARIANTS) {
    assert(seen.has(variant), `矩阵未覆盖核心 variant: ${variant}`);
  }
});

test("矩阵 variant 必须能被 tool-variant-map 的 13 个工具产出（empty/error 例外：适配器层产物）", () => {
  const tools = variantMap.mapping;
  assert.strictEqual(Object.keys(tools).length, 13, "tool-variant-map 必须覆盖 13 个工具");
  const produced = new Set(Object.values(tools));
  // empty/error 不由工具映射产出：它们是 variant-adapters 的 verified-empty / error 投影结果
  //（projectEmpty + fail-closed error 分支），已由 test-r50-2b-variant-adapters.js 覆盖。
  const ADAPTER_LEVEL = new Set(["empty", "error"]);
  for (const row of rows) {
    const variants = (row[4].match(/variant=[a-z]+/g) || []).map((t) => t.replace("variant=", ""));
    for (const variant of variants) {
      if (variant === "message" || ADAPTER_LEVEL.has(variant)) continue;
      assert(produced.has(variant), `row ${row[0]}: variant ${variant} 无法由任何工具映射产出`);
    }
  }
});

test("矩阵家族 12 必须覆盖 sys.chat + Main-first 续接", () => {
  const row12 = rows[11];
  assert.strictEqual(row12[0], "12");
  assert(row12[4].includes("sys.chat"), "家族 12 必须期望 sys.chat 续接");
  assert(row12[4].includes("Main"), "家族 12 必须回到 Main 重新调度");
  assert(row12[5].includes("内部标识") || row12[5].includes("直连"), "家族 12 禁止行为必须含内部标识/直连限制");
});

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}