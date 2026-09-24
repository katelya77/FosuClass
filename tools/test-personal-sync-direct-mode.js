const assert = require("assert");
const fs = require("fs");
const path = require("path");

const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.wxml"), "utf8");
const aiDoc = fs.readFileSync(path.join(__dirname, "../docs/ai-agent-compliance.md"), "utf8");

assert.ok(wxml.includes("需连接佛山大学校园网或校园 VPN"));
assert.ok(page.includes("studentForm.password\": \"\""));
assert.ok(page.includes("onHide("));
assert.ok(page.includes("clearActiveDirectSecrets"));
assert.ok(page.includes("DIRECT_SYNC_CANCELLED"));
assert.ok(page.includes("CAMPUS_NETWORK_REQUIRED"));
assert.ok(page.includes("重新检测"));
assert.ok(page.includes("XLS导入"));
assert.ok(page.includes("DIRECT_MODE_UNSUPPORTED"));
assert.ok(page.includes("INTERACTIVE_CHALLENGE_REQUIRED"));
assert.ok(page.includes("/api/schedule-import/fosu/confirm"));
assert.ok(page.includes("setCurrentScheduleTarget"));
assert.ok(!/wx\.setStorage(Sync)?\(\s*["'][^"']*(password|cookie|ticket)/i.test(page));
assert.ok(aiDoc.includes("个人课表同步页面"));
console.log("test-personal-sync-direct-mode passed");
