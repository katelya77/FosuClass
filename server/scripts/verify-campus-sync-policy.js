const fs = require("fs");

const base = process.env.POLICY_VERIFY_BASE || "http://127.0.0.1:3000";
const token = process.env.ADMIN_API_TOKEN || "";

function fail(message) {
  const error = new Error(message);
  error.policyVerify = true;
  throw error;
}

async function call(method, urlPath, body) {
  const response = await fetch(base + urlPath, {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
      "x-fosu-client": "service",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch (error) { json = null; }
  if (!response.ok || !json || json.success !== true) fail(method + " " + urlPath + " HTTP " + response.status);
  return json;
}

async function main() {
  if (process.argv.includes("--persisted")) {
    const policy = require("../src/services/campusSyncPolicyService");
    policy.reload();
    const current = policy.current();
    if (current.dailyLimit !== 10 || current.rateLimit !== 5 || current.rateWindowSeconds !== 600 || current.globalActiveCap !== 10) {
      fail("persisted policy was not the production default");
    }
    console.log("campus-sync-policy-verify persisted=10");
    return;
  }
  if (!token) fail("empty ADMIN_API_TOKEN");
  const defaults = { rateLimit: 5, rateWindowSeconds: 600, dailyLimit: 10, globalActiveCap: 10 };
  try {
    await call("PUT", "/api/admin/campus-sync/policy", Object.assign({}, defaults, { dailyLimit: 9 }));
    const applied = await call("GET", "/api/admin/campus-sync/policy");
    if (!applied.policy || applied.policy.dailyLimit !== 9) fail("GET dailyLimit was not 9");
    const policy = require("../src/services/campusSyncPolicyService");
    policy.reload();
    if (policy.current().dailyLimit !== 9) fail("runtime current() was not 9");
    console.log("campus-sync-policy-verify applied=9");
  } finally {
    await call("PUT", "/api/admin/campus-sync/policy", defaults);
    const restored = await call("GET", "/api/admin/campus-sync/policy");
    if (!restored.policy || restored.policy.dailyLimit !== 10 || restored.policy.rateLimit !== 5 || restored.policy.rateWindowSeconds !== 600 || restored.policy.globalActiveCap !== 10) {
      fail("defaults were not restored");
    }
  }
  const policy = require("../src/services/campusSyncPolicyService");
  const file = policy.policyFile();
  if (process.env.NODE_ENV === "production" && !file.startsWith("/app/storage/")) fail("policy file is not on the storage volume");
  if (!fs.existsSync(file)) fail("policy.json missing at " + file);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (saved.dailyLimit !== 10) fail("persisted dailyLimit was not restored");
  console.log("campus-sync-policy-verify restored=10 file=present");
}

main().catch((error) => {
  console.error("campus-sync-policy-verify failed: " + (error && error.message || "request failed"));
  process.exit(1);
});
