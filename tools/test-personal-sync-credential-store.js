const assert = require("assert");

const sessions = {};
let activeToken = "";
global.wx = {
  getStorageSync(key) {
    if (key === "FOSU_SECURITY_SESSION") return sessions[activeToken] || null;
    return sessions[key] || null;
  },
  setStorageSync(key, value) { sessions[key] = value; },
  removeStorageSync(key) { delete sessions[key]; },
};

function useOwner(owner) {
  const payload = Buffer.from(JSON.stringify({ openidHash: owner })).toString("base64").replace(/=+$/g, "");
  activeToken = owner;
  sessions[owner] = {
    sessionToken: `${payload}.sig`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  sessions.FOSU_SECURITY_SESSION = sessions[owner];
}

function loadStore() {
  const storePath = require.resolve("../miniprogram/services/personalSyncCredentialStore");
  const sessionPath = require.resolve("../miniprogram/services/securitySessionService");
  delete require.cache[storePath];
  delete require.cache[sessionPath];
  return require("../miniprogram/services/personalSyncCredentialStore");
}

useOwner("owner-a");
let store = loadStore();
const recent = require("../miniprogram/services/recentStudentImportService");
assert.strictEqual(store.read(), null);
const saved = store.saveSuccessfulLogin({ studentId: "20250000101", password: "secret-a" });
assert.strictEqual(saved.studentId, "20250000101");
assert.strictEqual(saved.password, "secret-a");
assert.strictEqual(store.read().password, "secret-a");

useOwner("owner-b");
store = loadStore();
assert.strictEqual(store.read(), null);
store.saveSuccessfulLogin({ studentId: "20250000999", password: "secret-b" });

useOwner("owner-a");
store = loadStore();
assert.strictEqual(store.read().password, "secret-a");
store.saveSuccessfulLogin({ studentId: "20250000101", password: "secret-new" });
assert.strictEqual(store.read().password, "secret-new");
const beforeInvalid = store.read().password;
assert.strictEqual(beforeInvalid, "secret-new");
store.clearPassword();
assert.strictEqual(store.read().password, "");
assert.strictEqual(store.read().studentId, "20250000101");

store.saveSuccessfulLogin({ studentId: "20250000101", password: "secret-new" });
store.confirmIdentity({ studentId: "20250000101", confirmedStudentName: "王同学" });
assert.strictEqual(store.sameConfirmedIdentity(store.read(), "20250000101", "王同学"), true);
assert.strictEqual(store.sameConfirmedIdentity(store.read(), "20250000101", "李示例"), false);
store.remove();
assert.strictEqual(store.read(), null);

const recentRecord = recent.writeLocalRecentImport({
  schemaVersion: 1,
  studentId: "20250000101",
  importedAt: new Date().toISOString(),
  schedule: { courses: [{ courseName: "动物解剖学" }], metadata: {} },
  importedCourses: [{ courseName: "动物解剖学" }],
});
assert.strictEqual(Object.prototype.hasOwnProperty.call(recentRecord, "password"), false);
assert.ok(!JSON.stringify(recentRecord).includes("secret"));

const fs = require("fs");
const path = require("path");
const sources = [
  "miniprogram/services/personalSyncCredentialStore.js",
  "miniprogram/pages/personal-sync/personal-sync.js",
  "miniprogram/services/recentStudentImportService.js",
].map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
assert.ok(!/console\.(log|info|debug|warn)\([^)]*password/i.test(sources));
assert.ok(!sources.includes("console.log(this.savedCredential)"));
assert.ok(!sources.includes("recentImport.password"));
console.log("personal sync credential store ok");
