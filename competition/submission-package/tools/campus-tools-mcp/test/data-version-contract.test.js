"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const contractsPath = path.join(__dirname, "..", "src", "contracts.ts");
const contracts = fs.readFileSync(contractsPath, "utf8");

test("CompetitionDataVersion contract admits v1, v2, and v3 while preserving the compatibility default", () => {
  for (const version of ["competition-demo-v1", "competition-demo-v2", "competition-demo-v3"]) {
    assert.match(contracts, new RegExp(`CompetitionDataVersion[\\s\\S]{0,240}${version}`), `CompetitionDataVersion must include ${version}`);
    assert.match(contracts, new RegExp(`DATA_VERSIONS[\\s\\S]{0,240}${version}`), `DATA_VERSIONS must include ${version}`);
  }
  assert.match(contracts, /DATA_VERSION:\s*CompetitionDataVersion\s*=\s*"competition-demo-v1"/,
    "compatibility default DATA_VERSION must remain competition-demo-v1");
});
