"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { run } = require("./process.js");

const ALLOWLIST = new Set(["campusflowAdpTools"]);

function planCloudBaseDeploy({ target, localHash, remoteHash }) {
  if (!ALLOWLIST.has(target)) throw new Error(`CloudBase target is not in allowlist: ${target}`);
  if (!localHash || !remoteHash) return { action: "BLOCKED_HASH_UNKNOWN", target };
  if (localHash === remoteHash) return { action: "NO_CHANGE", target };
  return { action: "DEPLOY_CHANGED_CODE", target, localHash, remoteHash };
}

function hashDirectory(root) {
  const hash = crypto.createHash("sha256");
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", ".DS_Store"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(root);
  files.sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function fetchRemoteCodeHash({ target, envId }) {
  if (!ALLOWLIST.has(target)) throw new Error(`CloudBase target is not in allowlist: ${target}`);
  if (!envId) return null;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-adp-cloudbase-read-"));
  try {
    const result = run("tcb", ["-e", envId, "fn", "code", "download", target, tempRoot, "--json"]);
    if (result.status !== 0) return null;
    function locateRoot(dir) {
      if (fs.existsSync(path.join(dir, "package.json")) || fs.existsSync(path.join(dir, "index.js"))) return dir;
      const directories = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      if (directories.length === 1) return locateRoot(path.join(dir, directories[0].name));
      return dir;
    }
    return hashDirectory(locateRoot(tempRoot));
  } finally {
    const resolved = fs.realpathSync(tempRoot);
    const tempBase = fs.realpathSync(os.tmpdir());
    if (!resolved.startsWith(`${tempBase}${path.sep}`)) throw new Error("unsafe temporary cleanup target");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function boundedWait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForRemoteHash({ target, envId, expectedHash, attempts = 4, fetcher = fetchRemoteCodeHash, wait = boundedWait }) {
  let hash = null;
  for (let index = 1; index <= attempts; index += 1) {
    hash = fetcher({ target, envId });
    if (hash === expectedHash) return { matched: true, attempts: index, hash };
    if (index < attempts) wait(1500);
  }
  return { matched: false, attempts, hash };
}

function deployChangedCode({ target, dir, envId, localHash, remoteHash, safe, confirm, healthUrl }) {
  const plan = planCloudBaseDeploy({ target, localHash, remoteHash });
  if (!safe || !confirm) return { mode: "dry-run", ...plan };
  if (plan.action !== "DEPLOY_CHANGED_CODE") return { mode: "safe", ...plan, deployed: false };
  if (!envId) throw new Error("CloudBase environment ID required from ignored local config or TCB_ENV_ID");
  const result = run("tcb", ["-e", envId, "fn", "code", "update", target, "--dir", dir, "--json"]);
  if (result.status !== 0) throw new Error("CloudBase code update failed; ADP Console changes were not attempted");
  const detail = run("tcb", ["-e", envId, "fn", "detail", target, "--json"]);
  if (detail.status !== 0) throw new Error("CloudBase post-deploy function detail smoke failed");
  const postHash = waitForRemoteHash({ target, envId, expectedHash: localHash });
  if (!postHash.matched) throw new Error("CloudBase post-deploy code hash verification failed");
  if (healthUrl) {
    const health = run("curl.exe", ["--fail", "--silent", "--show-error", "--max-time", "20", healthUrl]);
    if (health.status !== 0 || !/"status"\s*:\s*"ok"/.test(health.stdout)) throw new Error("CloudBase post-deploy health smoke failed");
  }
  return { mode: "safe", ...plan, deployed: true, postDeployDetail: "PASS", postDeployHash: "PASS", propagationAttempts: postHash.attempts, healthSmoke: healthUrl ? "PASS" : "NOT_CONFIGURED" };
}

module.exports = { ALLOWLIST, deployChangedCode, fetchRemoteCodeHash, hashDirectory, planCloudBaseDeploy, waitForRemoteHash };
