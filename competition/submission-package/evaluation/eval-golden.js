#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { GOLDEN_CASES } = require("./golden-cases");
const { executeCase, sourceSha256 } = require("./golden-oracle");
const dataset = require("../mock-data/competition-demo-v1.json");

const goldenPath = path.join(__dirname, "golden-results.json");
assert(fs.existsSync(goldenPath), "缺少 golden-results.json；必须先显式生成并审阅");
const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

assert.strictEqual(golden.schema, "campus-tools-golden/v1");
assert.strictEqual(golden.reviewRequired, true);
assert.strictEqual(golden.caseCount, golden.cases.length);
assert(golden.caseCount >= 30, "Golden 案例必须至少 30 个");
assert.strictEqual(golden.dataVersion, dataset.meta.dataVersion, "dataVersion 已变化，需重新审阅 Golden");
assert.strictEqual(golden.dataHash, dataset.dataHash, "匿名数据事实已变化，需重新审阅 Golden");
assert.strictEqual(golden.oracleSourceSha256, sourceSha256(), "CampusTools/Golden case 源码已变化，需重新审阅 Golden");
assert.deepStrictEqual(golden.cases.map((item) => ({ id: item.id, tool: item.tool, input: item.input })), GOLDEN_CASES);

let passed = 0;
for (const expectedCase of golden.cases) {
  const actual = executeCase(expectedCase);
  assert.deepStrictEqual(actual, expectedCase, `Golden 事实不一致：${expectedCase.id}`);
  passed += 1;
}
console.log(`Golden Result passed: ${passed}/${golden.caseCount}, dataVersion=${golden.dataVersion}, dataHash=${golden.dataHash}, verified=100%`);
