const assert = require("assert");
const fs = require("fs");
const path = require("path");
const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
const presenter = fs.readFileSync(path.join(__dirname, "../miniprogram/services/personalSyncErrorPresenter.js"), "utf8");

assert.ok(presenter.includes("INVALID_CREDENTIALS"));
assert.ok(presenter.includes("学号或密码错误"));
assert.ok(page.includes("personalSyncCredentialStore.clearPassword()"));
assert.ok(page.includes("presentPersonalSyncFailure"));
assert.ok(page.includes("usingSavedPassword"));
const invalidBranch = page.slice(page.indexOf("presentPersonalSyncFailure"), page.indexOf("async validateAndPreviewStudentImport"));
assert.ok(invalidBranch.includes("clearPassword"));
assert.ok(invalidBranch.includes("学号或密码错误") || page.includes("personalSyncErrorPresenter") || page.includes("applyPersonalSyncFailure"));
console.log("personal sync credential expiry ok");
