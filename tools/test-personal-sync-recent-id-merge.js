const assert = require("assert");

const store = {};
global.wx = {
  getStorageSync(key) { return store[key]; },
  setStorageSync(key, value) { store[key] = value; },
  removeStorageSync(key) { delete store[key]; },
};

const payload = Buffer.from(JSON.stringify({ openidHash: "owner-test" })).toString("base64").replace(/=+$/g, "");
store.FOSU_SECURITY_SESSION = {
  sessionToken: `${payload}.sig`,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const recent = require("../miniprogram/services/recentStudentImportService");

const v1 = recent.writeLocalRecentImport({
  schemaVersion: 1,
  studentId: "20250000101",
  studentName: "王同学",
  importedAt: new Date().toISOString(),
  schedule: { courses: [{ courseName: "动物解剖学" }], metadata: { className: "" } },
  importedCourses: [{ courseName: "动物解剖学" }],
});
assert.strictEqual(v1.schemaVersion, 2);
assert.strictEqual(v1.localDisplayStudentId, "20250000101");

const masked = recent.writeLocalRecentImport({
  schemaVersion: 1,
  studentId: "2025****0101",
  studentIdMasked: "2025****0101",
  importedAt: new Date().toISOString(),
  schedule: { courses: [{ courseName: "动物解剖学" }] },
  importedCourses: [{ courseName: "动物解剖学" }],
});
assert.strictEqual(masked.localDisplayStudentId, "20250000101");
assert.strictEqual(masked.studentId, "20250000101");

const withRemarks = recent.writeLocalRecentImport({
  schemaVersion: 2,
  studentId: "2025****0101",
  pageRemarks: ["大学体育3……"],
  importedAt: new Date().toISOString(),
  schedule: { courses: [{ courseName: "动物解剖学" }] },
  importedCourses: [{ courseName: "动物解剖学" }],
});
assert.deepStrictEqual(withRemarks.pageRemarks, ["大学体育3……"]);
assert.strictEqual(withRemarks.localDisplayStudentId, "20250000101");
console.log("personal sync recent id merge ok");
