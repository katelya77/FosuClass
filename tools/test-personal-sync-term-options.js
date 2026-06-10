const assert = require("assert");
const { buildImportTermOptions } = require("../miniprogram/services/personalTermOptionsService");

const result = buildImportTermOptions([
  { term: "2025-2026-2", semesterText: "当前", status: "current", dataAvailable: true },
  { term: "2026-2027-1", semesterText: "未来", status: "planned", dataAvailable: false },
  { term: "2024-2025-2", semesterText: "历史", status: "archived", dataAvailable: true },
  { term: "2023-2024-2", semesterText: "禁用", status: "disabled", dataAvailable: true },
], "2025-2026-2", "");

assert.deepStrictEqual(result.semesterOptions, ["2025-2026-2", "2026-2027-1", "2024-2025-2"]);
assert.strictEqual(result.records.find((item) => item.term === "2026-2027-1").importable, false);
assert.strictEqual(result.records.find((item) => item.term === "2024-2025-2").archived, true);
assert.strictEqual(result.pickerEnabled, true);

const single = buildImportTermOptions([
  { term: "2025-2026-2", status: "current", dataAvailable: true },
], "2025-2026-2", "");
assert.strictEqual(single.pickerEnabled, false);

console.log("test-personal-sync-term-options passed");
