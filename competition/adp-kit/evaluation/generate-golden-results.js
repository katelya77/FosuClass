#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { GOLDEN_CASES } = require("./golden-cases");
const { executeCase, sourceSha256 } = require("./golden-oracle");
const dataset = require("../mock-data/competition-demo-v1.json");

if (!process.argv.includes("--accept-reviewed")) {
  console.error("拒绝覆盖 Golden：请先审阅数据/工具差异，再显式使用 --accept-reviewed");
  process.exit(2);
}
if (GOLDEN_CASES.length < 30) throw new Error("Golden 成功案例不得少于 30 个");

const cases = GOLDEN_CASES.map(executeCase);
for (const item of cases) {
  if (!item.expected.success || !item.expected.verified) {
    throw new Error(`${item.id} 不是 success=true 且 verified=true 的 Golden 成功案例`);
  }
}
const output = {
  schema: "campus-tools-golden/v1",
  reviewRequired: true,
  dataVersion: dataset.meta.dataVersion,
  dataHash: dataset.dataHash,
  oracleSourceSha256: sourceSha256(),
  caseCount: cases.length,
  cases,
};
const target = path.join(__dirname, "golden-results.json");
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[accepted] golden=${cases.length} dataHash=${output.dataHash} sourceSha256=${output.oracleSourceSha256.slice(0, 12)}`);
