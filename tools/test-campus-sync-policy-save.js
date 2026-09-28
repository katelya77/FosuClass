const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-policy-save-"));
const policy = require("../server/src/services/campusSyncPolicyService");
const quota = require("../server/src/services/campusSyncQuotaStore");
const assets = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminCampusSyncAssets.js"), "utf8");

policy.resetForTests();
assert.strictEqual(policy.parseStrictInt("10"), 10);
assert.strictEqual(policy.parseStrictInt(10), 10);
["10abc", "", null, Number.NaN, Infinity, 1.5, "1.5"].forEach((value) => {
  assert.strictEqual(policy.parseStrictInt(value), null, String(value));
});
assert.strictEqual(policy.parseStrictInt(-1), -1);
assert.throws(() => policy.update({ dailyLimit: "10abc" }, "admin"), (error) => error.code === "CAMPUS_SYNC_POLICY_REJECTED");
assert.throws(() => policy.update({ dailyLimit: 1.5 }, "admin"), (error) => error.code === "CAMPUS_SYNC_POLICY_REJECTED");
assert.throws(() => policy.update({ dailyLimit: 999999 }, "admin"), (error) => error.code === "CAMPUS_SYNC_POLICY_REJECTED");

const changed = policy.update({ dailyLimit: "9", rateLimit: "5", rateWindowSeconds: "600", globalActiveCap: "10" }, "admin");
assert.strictEqual(changed.after.dailyLimit, 9);
assert.strictEqual(policy.current().dailyLimit, 9);
policy.reload();
assert.strictEqual(policy.current().dailyLimit, 9);
assert.strictEqual(quota.consume("policy-save-user", Date.parse("2026-09-25T04:00:00.000Z")).public.dailyLimit, 9);
policy.update({ dailyLimit: 10, rateLimit: 5, rateWindowSeconds: 600, globalActiveCap: 10 }, "admin");
assert.ok(assets.includes("JSON.stringify(body)"));
assert.ok(assets.includes("正在保存"));
assert.ok(!assets.includes("body: body"));
console.log("campus-sync-policy-save PASS");
