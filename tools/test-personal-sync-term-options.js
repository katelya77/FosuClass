"use strict";

const assert = require("assert");
const { buildImportTermOptions } = require("../miniprogram/services/personalTermOptionsService");

const result = buildImportTermOptions([
  { term: "2026-2027-1", semesterText: "当前", status: "current", dataAvailable: true, releaseVersion: "r261" },
  { term: "2027-2028-1", semesterText: "未来", status: "planned", dataAvailable: false, releaseVersion: "" },
  { term: "2025-2026-2", semesterText: "历史", status: "archived", dataAvailable: true, releaseVersion: "r252" },
  { term: "2024-2025-2", semesterText: "空快照", status: "archived", dataAvailable: false, releaseVersion: "r242" },
  { term: "2023-2024-2", semesterText: "禁用", status: "disabled", dataAvailable: true, releaseVersion: "r232" },
], "2026-2027-1", "");

assert.deepStrictEqual(result.semesterOptions, ["2026-2027-1", "2025-2026-2"]);
assert.strictEqual(result.records.some((item) => item.term === "2027-2028-1"), false);
assert.strictEqual(result.records.find((item) => item.term === "2025-2026-2").archived, true);
assert.strictEqual(result.pickerEnabled, true);

const single = buildImportTermOptions([
  { term: "2026-2027-1", status: "current", dataAvailable: true, releaseVersion: "r261" },
], "2026-2027-1", "");
assert.strictEqual(single.pickerEnabled, false);

console.log("test-personal-sync-term-options passed");
