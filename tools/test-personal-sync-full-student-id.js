const assert = require("assert");
const { isFullStudentId, mergeDisplayStudentId } = require("../miniprogram/services/personalSyncSurface");

assert.strictEqual(isFullStudentId("20250000101"), true);
assert.strictEqual(isFullStudentId("2025****0101"), false);
assert.strictEqual(mergeDisplayStudentId("20250000101", "2025****0101"), "20250000101");
assert.strictEqual(mergeDisplayStudentId("2025****0101", "20250000101"), "20250000101");
assert.strictEqual(mergeDisplayStudentId("", "2025****0101"), "");
console.log("personal sync full student id ok");
