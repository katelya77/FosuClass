/*
 * R48 Widget V3 — 全部测试汇总运行器
 * 运行：node tests/run-all.js
 */
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const HERE = __dirname;
const TESTS = ["test-schema.js", "test-adapter.js", "test-action-contract.js", "test-template-syntax.js", "test-no-external-deps.js"];

let failed = 0;
for (const test of TESTS) {
  const file = path.join(HERE, test);
  try {
    console.log(`\n>>> ${test}`);
    execFileSync(process.execPath, [file], { stdio: "inherit" });
  } catch (err) {
    failed += 1;
    console.error(`>>> ${test} 失败`);
  }
}

console.log(`\n==============================`);
if (failed > 0) {
  console.error(`run-all: ${failed}/${TESTS.length} 个测试文件失败`);
  process.exit(1);
}
console.log(`run-all: ${TESTS.length}/${TESTS.length} 个测试文件全部通过`);