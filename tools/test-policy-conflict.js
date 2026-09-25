const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-policy-conflict-"));
process.env.CAMPUS_SYNC_OPS_DIR = dir;
const policy = require("../server/src/services/campusSyncPolicyService");
policy.resetForTests();
const first = policy.update({ rateLimit: 4, rateWindowSeconds: 720, dailyLimit: 7, globalActiveCap: 8 }, "window-a");
const revision = policy.snapshot().revision;
assert.throws(() => policy.update({ dailyLimit: 6 }, "window-b", "stale"), (error) => error.code === "CAMPUS_SYNC_POLICY_CONFLICT");
assert.strictEqual(policy.snapshot().dailyLimit, 7);
const second = policy.update({ dailyLimit: 6 }, "window-a", revision);
assert.strictEqual(second.after.dailyLimit, 6);
assert.notStrictEqual(policy.snapshot().revision, revision);
console.log("policy-conflict PASS");
