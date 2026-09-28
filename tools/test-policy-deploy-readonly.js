const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-policy-deploy-"));
const script = fs.readFileSync(path.join(__dirname, "../server/scripts/verify-campus-sync-policy.js"), "utf8");
assert.ok(!script.includes('method: "PUT"') && !script.includes("dailyLimit: 9") && !script.includes("actions/resume"));
const policyFile = path.join(dir, "policy.json");
const controlFile = path.join(dir, "control.json");
const policyBody = JSON.stringify({ version: 1, rateLimit: 4, rateWindowSeconds: 720, dailyLimit: 7, globalActiveCap: 8, updatedAt: "2026-09-25T01:02:03.000Z", updatedBy: "human-admin" });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(policyFile, policyBody);
fs.writeFileSync(controlFile, JSON.stringify({ paused: true, pausedAt: "2026-09-25T01:02:03.000Z", pausedBy: "human-admin" }));
const env = Object.assign({}, process.env, { CAMPUS_SYNC_OPS_DIR: dir, NODE_ENV: "test" });
delete env.ADMIN_API_TOKEN;
const first = spawnSync(process.execPath, [path.join(__dirname, "../server/scripts/verify-campus-sync-policy.js")], { env, encoding: "utf8" });
const second = spawnSync(process.execPath, [path.join(__dirname, "../server/scripts/verify-campus-sync-policy.js")], { env, encoding: "utf8" });
if (first.status !== 0) {
  console.error(first.stdout);
  console.error(first.stderr);
  process.exit(1);
}
assert.strictEqual(second.status, 0);
assert.ok(first.stdout.includes("POLICY_UNCHANGED=true"));
assert.ok(first.stdout.includes("CONTROL_UNCHANGED=true"));
assert.strictEqual(fs.readFileSync(policyFile, "utf8"), policyBody);
assert.strictEqual(JSON.parse(fs.readFileSync(controlFile, "utf8")).paused, true);
assert.strictEqual(first.stdout, second.stdout);
console.log("policy-deploy-readonly PASS");
