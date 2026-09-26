const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { presentPersonalSyncError } = require("../miniprogram/services/personalSyncErrorPresenter");
const source = require("../miniprogram/services/studentScheduleSource");

const first = presentPersonalSyncError({ code: "INTERACTIVE_CHALLENGE_REQUIRED" });
assert.strictEqual(first.title, "暂时无法自动同步");
assert.ok(first.content.includes("学校系统要求额外安全验证，暂时无法自动同步。"));
assert.ok(first.content.includes("请稍后再试；如持续出现，可先通过学校官方系统完成正常登录验证后再次同步。"));
assert.strictEqual(first.action, "acknowledge");

const cooled = presentPersonalSyncError({ code: "INTERACTIVE_CHALLENGE_REQUIRED", retryAfterSeconds: 480 });
assert.strictEqual(cooled.content, "学校系统刚刚要求额外验证，请稍后再尝试同步。");

[first, cooled].forEach((view) => {
  const text = view.title + view.content;
  assert.ok(!/CAS|WYZ|HMAC|challenge|authserver|100\.fosu|HTTP\s*\d{3}/i.test(text));
  assert.ok(!text.includes("INTERACTIVE_CHALLENGE_REQUIRED"));
});

assert.ok(source.TERMINAL_SYNC_CODES.has("INTERACTIVE_CHALLENGE_REQUIRED"));
assert.ok(source.TERMINAL_SYNC_CODES.has("INVALID_CREDENTIALS"));
assert.ok(source.TERMINAL_SYNC_CODES.has("PROFILE_ID_MISMATCH"));
assert.ok(source.TERMINAL_SYNC_CODES.has("STRUCTURE_CHANGED"));
const client = fs.readFileSync(path.join(__dirname, "../miniprogram/services/studentScheduleSource.js"), "utf8");
assert.ok(!client.includes("_campusRetries"));
assert.ok(!/return readViaCampusAgent\(Object\.assign/.test(client));

console.log("personal-sync-interactive-challenge PASS");
