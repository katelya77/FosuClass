const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const PROCESS_STARTED_AT = Date.now();
const PROCESS_INSTANCE_ID = crypto.randomBytes(12).toString("hex");
const ownedLocks = new Map();

function linuxProcessStartIdentity(pid) {
  if (process.platform !== "linux") return "";
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return "";
    const fieldsAfterCommand = stat.slice(close + 2).trim().split(/\s+/);
    return String(fieldsAfterCommand[19] || "");
  } catch (_) { return ""; }
}

const PROCESS_START_IDENTITY = linuxProcessStartIdentity(process.pid);

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockError(message, code, statusCode = 500, cause) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (cause) error.cause = cause;
  return error;
}

function fileIdentity(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.size}`;
  } catch (_) { return null; }
}

function validMetadata(details) {
  return Boolean(details)
    && typeof details === "object"
    && !Array.isArray(details)
    && Number.isInteger(details.pid)
    && details.pid > 0
    && typeof details.token === "string"
    && details.token.trim().length > 0
    && typeof details.instanceId === "string"
    && details.instanceId.trim().length > 0
    && typeof details.createdAt === "string"
    && Number.isFinite(Date.parse(details.createdAt));
}

function matchesOwned(lockPath, record, requireToken = true) {
  if (!record || !record.identity) return false;
  const identity = fileIdentity(lockPath);
  if (!identity || identity !== record.identity) return false;
  if (!requireToken) return true;
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return held && held.token === record.token;
  } catch (_) { return false; }
}

function retire(lockPath, label, codes) {
  const retired = `${lockPath}.${label}.${process.pid}.${crypto.randomBytes(3).toString("hex")}`;
  fs.renameSync(lockPath, retired);
  try { fs.unlinkSync(retired); } catch (error) {
    throw lockError("exclusive lock retired but cleanup failed", codes.release, 500, error);
  }
}

function reclaimStale(lockPath, staleMs, codes) {
  let stat;
  let details = null;
  let observedIdentity = null;
  try {
    stat = fs.statSync(lockPath);
    observedIdentity = fileIdentity(lockPath);
    try { details = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch (_) {}
  } catch (_) { return false; }
  const valid = validMetadata(details);
  if (!valid && Date.now() - stat.mtimeMs < staleMs) return false;
  if (valid) {
    try {
      process.kill(details.pid, 0);
      const observedStartIdentity = linuxProcessStartIdentity(details.pid);
      const pidWasReused = Boolean(details.processStartIdentity && observedStartIdentity && details.processStartIdentity !== observedStartIdentity);
      const priorSamePidInstance = details.pid === process.pid
        && details.instanceId !== PROCESS_INSTANCE_ID
        && Date.parse(details.createdAt) < PROCESS_STARTED_AT;
      if (!priorSamePidInstance && !pidWasReused) return false;
    } catch (error) {
      if (error && error.code !== "ESRCH") return false;
    }
  }
  try {
    if (fileIdentity(lockPath) !== observedIdentity) return false;
    if (valid) {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (!current || current.token !== details.token || current.instanceId !== details.instanceId) return false;
    }
    retire(lockPath, valid ? `stale-${details.token}` : "stale-invalid", codes);
    return true;
  } catch (_) { return false; }
}

function withReclaimGuard(lockPath, codes, callback) {
  const guardPath = `${lockPath}.reclaim`;
  const token = crypto.randomBytes(12).toString("hex");
  let identity = null;
  try {
    fs.writeFileSync(guardPath, JSON.stringify({ pid: process.pid, token, instanceId: PROCESS_INSTANCE_ID, createdAt: new Date().toISOString() }), { encoding: "utf8", flag: "wx", mode: 0o600 });
    identity = fileIdentity(guardPath);
  } catch (error) {
    if (error && error.code === "EEXIST") return false;
    throw lockError("exclusive lock reclamation guard failed", codes.failed, 500, error);
  }
  try {
    callback();
    return true;
  } finally {
    try {
      const held = JSON.parse(fs.readFileSync(guardPath, "utf8"));
      if (fileIdentity(guardPath) !== identity || held.token !== token) throw new Error("reclamation guard ownership changed");
      fs.unlinkSync(guardPath);
    } catch (error) {
      throw lockError("exclusive lock reclamation guard could not be released", codes.release, 500, error);
    }
  }
}

function reclaimOwnedAbandoned(lockPath, codes) {
  for (const record of ownedLocks.values()) {
    if (!record.abandoned || record.lockPath !== lockPath || !matchesOwned(lockPath, record)) continue;
    try {
      retire(lockPath, `abandoned-${record.token}`, codes);
      ownedLocks.delete(record.token);
      return true;
    } catch (_) { return false; }
  }
  return false;
}

function discardNew(lockPath, record, codes) {
  if (!matchesOwned(lockPath, record)) return false;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.unlinkSync(lockPath); return true; } catch (error) {
      if (error && error.code === "ENOENT") return true;
      lastError = error;
      wait(5);
    }
  }
  try {
    if (!matchesOwned(lockPath, record)) return false;
    retire(lockPath, "aborted", codes);
    return true;
  } catch (error) { throw lockError("failed to discard newly-created exclusive lock", codes.release, 500, error || lastError); }
}

function releaseOwned(lockPath, token, codes) {
  const record = ownedLocks.get(token);
  let held = null;
  let readError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { held = JSON.parse(fs.readFileSync(lockPath, "utf8")); readError = null; break; } catch (error) { readError = error; wait(5); }
  }
  if (readError) {
    try {
      if (!matchesOwned(lockPath, record, false)) throw new Error("owned lock identity changed");
      retire(lockPath, `unverified-${token}`, codes);
      ownedLocks.delete(token);
      return { warning: { code: codes.release } };
    } catch (error) {
      if (record) record.abandoned = true;
      throw lockError("cannot recover unreadable owned exclusive lock", codes.release, 500, error);
    }
  }
  if (!held || held.token !== token) throw lockError("exclusive lock ownership changed", codes.release);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.unlinkSync(lockPath); ownedLocks.delete(token); return undefined; } catch (error) { lastError = error; wait(5); }
  }
  try { retire(lockPath, "released", codes); ownedLocks.delete(token); } catch (error) {
    if (record) record.abandoned = true;
    throw lockError("failed to release exclusive lock", codes.release, 500, error || lastError);
  }
  return undefined;
}

function acquireExclusiveFileLock(filePath, options = {}) {
  const target = path.resolve(filePath);
  const lockPath = options.lockPath ? path.resolve(options.lockPath) : `${target}.lock`;
  const reclaimGuardPath = `${lockPath}.reclaim`;
  const waitMs = Number(options.waitMs === undefined ? 1000 : options.waitMs);
  const staleMs = Number(options.staleMs === undefined ? 30000 : options.staleMs);
  const prefix = String(options.codePrefix || "EXCLUSIVE_FILE").replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
  const codes = { failed: `${prefix}_LOCK_FAILED`, timeout: `${prefix}_LOCK_TIMEOUT`, release: `${prefix}_LOCK_RELEASE_FAILED` };
  const token = crypto.randomBytes(12).toString("hex");
  const startedAt = Date.now();
  while (Date.now() - startedAt <= waitMs) {
    let attempted = false;
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      if (fs.existsSync(reclaimGuardPath)) { wait(10); continue; }
      attempted = true;
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token, instanceId: PROCESS_INSTANCE_ID, processStartIdentity: PROCESS_START_IDENTITY, createdAt: new Date().toISOString() }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      const record = { token, lockPath, identity: fileIdentity(lockPath), abandoned: false };
      ownedLocks.set(token, record);
      if (fs.existsSync(reclaimGuardPath)) {
        discardNew(lockPath, record, codes);
        ownedLocks.delete(token);
        wait(10);
        continue;
      }
      return () => releaseOwned(lockPath, token, codes);
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        const record = attempted && { token, lockPath, identity: fileIdentity(lockPath), abandoned: true };
        if (record && matchesOwned(lockPath, record)) {
          ownedLocks.set(token, record);
          try { discardNew(lockPath, record, codes); ownedLocks.delete(token); } catch (cleanupError) { throw lockError("exclusive lock initialization cleanup failed", codes.release, 500, cleanupError); }
        }
        throw lockError("exclusive lock acquisition failed", codes.failed, 500, error);
      }
      if (reclaimOwnedAbandoned(lockPath, codes)) continue;
      withReclaimGuard(lockPath, codes, () => { reclaimStale(lockPath, staleMs, codes); });
      wait(10);
    }
  }
  throw lockError("timed out waiting for exclusive lock", codes.timeout, 503);
}

function acquireExclusiveFileLocks(filePaths, options = {}) {
  const releases = [];
  try {
    for (const filePath of Array.from(new Set(filePaths.map((item) => path.resolve(item)))).sort()) {
      releases.push(acquireExclusiveFileLock(filePath, options));
    }
  } catch (error) {
    for (const release of releases.reverse()) { try { release(); } catch (_) {} }
    throw error;
  }
  return () => {
    const warnings = [];
    let firstError = null;
    for (const release of releases.reverse()) {
      try {
        const result = release();
        if (result && result.warning) warnings.push(result.warning);
      } catch (error) { if (!firstError) firstError = error; }
    }
    if (firstError) throw firstError;
    return warnings.length ? { warnings } : undefined;
  };
}

module.exports = { acquireExclusiveFileLock, acquireExclusiveFileLocks };
