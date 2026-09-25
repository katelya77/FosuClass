const fs = require("fs");

const base = process.env.POLICY_VERIFY_BASE || "http://127.0.0.1:3000";
const token = process.env.ADMIN_API_TOKEN || "";

function fail(message) {
  const error = new Error(message);
  error.policyVerify = true;
  throw error;
}

function numbers(policy) {
  return {
    rateLimit: policy && policy.rateLimit,
    rateWindowSeconds: policy && policy.rateWindowSeconds,
    dailyLimit: policy && policy.dailyLimit,
    globalActiveCap: policy && policy.globalActiveCap,
    updatedAt: policy && policy.updatedAt || null,
    updatedBy: policy && policy.updatedBy || "",
  };
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function readRemote() {
  if (!token) return null;
  const response = await fetch(base + "/api/admin/campus-sync/policy", {
    headers: {
      "x-admin-token": token,
      "x-fosu-client": "service",
    },
  });
  if (!response.ok) fail("GET policy HTTP " + response.status);
  const json = await response.json();
  if (!json || json.success !== true || !json.policy) fail("GET policy was not a snapshot");
  return json.policy;
}

async function main() {
  const policy = require("../src/services/campusSyncPolicyService");
  const control = require("../src/services/campusSyncControl");
  const beforePolicy = numbers(policy.reload());
  const beforeControl = control.reload();
  const remote = await readRemote();
  const afterPolicy = numbers(policy.reload());
  const afterControl = control.reload();
  const policyFile = policy.policyFile();
  if (process.env.NODE_ENV === "production" && !policyFile.startsWith("/app/storage/")) fail("policy file is not on the storage volume");
  const saved = readJson(policyFile);
  if (saved && (saved.dailyLimit !== afterPolicy.dailyLimit || saved.rateLimit !== afterPolicy.rateLimit || saved.rateWindowSeconds !== afterPolicy.rateWindowSeconds || saved.globalActiveCap !== afterPolicy.globalActiveCap)) {
    fail("runtime policy does not match persisted policy");
  }
  if (remote && (remote.dailyLimit !== afterPolicy.dailyLimit || remote.rateLimit !== afterPolicy.rateLimit || remote.rateWindowSeconds !== afterPolicy.rateWindowSeconds || remote.globalActiveCap !== afterPolicy.globalActiveCap)) {
    fail("GET policy does not match runtime policy");
  }
  try { fs.accessSync(require("path").dirname(policyFile), fs.constants.W_OK); } catch (error) { fail("policy directory is not writable"); }
  const unchanged = JSON.stringify(beforePolicy) === JSON.stringify(afterPolicy) && beforeControl.paused === afterControl.paused && beforeControl.pausedAt === afterControl.pausedAt;
  console.log("POLICY BEFORE DEPLOY " + JSON.stringify(beforePolicy));
  console.log("POLICY AFTER DEPLOY " + JSON.stringify(afterPolicy));
  console.log("POLICY_UNCHANGED=" + unchanged);
  console.log("CONTROL BEFORE DEPLOY " + JSON.stringify({ paused: beforeControl.paused, pausedAt: beforeControl.pausedAt }));
  console.log("CONTROL AFTER DEPLOY " + JSON.stringify({ paused: afterControl.paused, pausedAt: afterControl.pausedAt }));
  console.log("CONTROL_UNCHANGED=" + (beforeControl.paused === afterControl.paused && beforeControl.pausedAt === afterControl.pausedAt));
  console.log("campus-sync-policy-verify readonly storage=" + (afterPolicy.storageStatus || policy.snapshot().storageStatus));
  if (!unchanged) fail("read-only verification changed policy or control");
}

main().catch((error) => {
  console.error("campus-sync-policy-verify failed: " + (error && error.message || "request failed"));
  process.exit(1);
});
