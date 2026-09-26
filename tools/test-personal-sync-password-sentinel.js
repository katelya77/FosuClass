const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SENTINEL = "school-password-sentinel-9f3a";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sentinel-"));
process.env.CAMPUS_SYNC_OPS_DIR = dir;
process.env.CAMPUS_AGENT_TOKEN = "sentinel-agent-token";
process.env.CAMPUS_AGENT_SIGNING_SECRET = "sentinel-agent-mac";
const store = fs.readFileSync(path.join(__dirname, "../miniprogram/services/personalSyncCredentialStore.js"), "utf8");
assert.ok(store.includes("FOSU_PERSONAL_SYNC_CREDENTIAL_V1"));
assert.ok(!/createCipher|xor|btoa|AES/i.test(store));
const policy = require("../server/src/services/campusSyncPolicyService");
const control = require("../server/src/services/campusSyncControl");
policy.resetForTests();
policy.update({ dailyLimit: 4, rateLimit: 4, rateWindowSeconds: 720, globalActiveCap: 8 }, "admin-test");
control.pause("admin-test");
function walk(root) {
  return fs.readdirSync(root).map((name) => path.join(root, name)).flatMap((file) => {
    return fs.statSync(file).isDirectory() ? walk(file) : [file];
  });
}
const blob = walk(dir).map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert.ok(!blob.includes(SENTINEL));
assert.ok(!blob.includes("sentinel-agent-token"));
console.log("personal-sync-password-sentinel PASS");
