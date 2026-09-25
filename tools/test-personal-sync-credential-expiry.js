const assert = require("assert");
const fs = require("fs");
const path = require("path");
const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");

assert.ok(page.includes("INVALID_CREDENTIALS"));
assert.ok(page.includes("LOGIN_REJECTED"));
assert.ok(page.includes("personalSyncCredentialStore.clearPassword()"));
assert.ok(page.includes("已保存的学校账号密码可能已失效，请重新输入。"));
assert.ok(page.includes("usingSavedPassword"));
const invalidBranch = page.slice(page.indexOf("handlePersonalSyncFailure"), page.indexOf("async validateAndPreviewStudentImport"));
assert.ok(invalidBranch.includes("clearPassword"));
assert.ok(!invalidBranch.includes("TIMEOUT"));
assert.ok(!invalidBranch.includes("AGENT_OFFLINE") || invalidBranch.includes("showStudentImportError"));
console.log("personal sync credential expiry ok");
