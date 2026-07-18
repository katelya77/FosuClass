const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const QUALITY_IGNORES_PATH = path.join(STORAGE_DIR, "quality-ignores.json");
const LOCK_WAIT_MS = Number(process.env.FOSU_QUALITY_IGNORE_LOCK_WAIT_MS || 1000);
const LOCK_STALE_MS = Number(process.env.FOSU_QUALITY_IGNORE_LOCK_STALE_MS || 30000);
const PROCESS_STARTED_AT = Date.now();
const PROCESS_INSTANCE_ID = crypto.randomBytes(12).toString("hex");
const ownedLocks = new Map();

function makeVersion(rules) {
  return `qi_${crypto.createHash("sha256").update(JSON.stringify(rules || [])).digest("hex").slice(0, 16)}`;
}

function typedError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function malformed(error) {
  return typedError(`quality ignores cannot be read: ${error && error.message || "malformed data"}`, "QUALITY_IGNORES_MALFORMED");
}

function readIgnoreDocument() {
  let text;
  try {
    text = fs.readFileSync(QUALITY_IGNORES_PATH, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return { version: makeVersion([]), updatedAt: null, rules: [] };
    throw malformed(error);
  }
  let raw;
  try { raw = JSON.parse(text); } catch (error) { throw malformed(error); }
  if (Array.isArray(raw)) return { version: makeVersion(raw), updatedAt: null, rules: raw };
  if (!raw || typeof raw !== "object" || (raw.rules !== undefined && !Array.isArray(raw.rules))) {
    throw malformed(new Error("ignore document must be an array or an object with rules"));
  }
  const rules = raw.rules || [];
  return { version: raw.version || makeVersion(rules), updatedAt: raw.updatedAt || null, rules };
}

function conflict(currentVersion) {
  const error = typedError("quality ignores conflict", "CONFLICT", 409);
  error.currentVersion = currentVersion;
  return error;
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function fileIdentity(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.size}`;
  } catch (_) { return null; }
}

function reclaimStaleLock(lockPath) {
  let stat;
  let details = null;
  try {
    stat = fs.statSync(lockPath);
    try { details = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch (_) {}
  } catch (_) { return false; }
  const now = Date.now();
  if (!details) {
    if (now - stat.mtimeMs < LOCK_STALE_MS) return false;
  }
  if (details && Number.isInteger(details.pid) && details.pid > 0) {
    try {
      process.kill(details.pid, 0);
      const createdAt = Date.parse(details.createdAt || "");
      const priorSamePidInstance = details.pid === process.pid
        && details.instanceId !== PROCESS_INSTANCE_ID
        && Number.isFinite(createdAt)
        && createdAt < PROCESS_STARTED_AT;
      if (!priorSamePidInstance) return false;
    } catch (error) {
      if (error.code && error.code !== "ESRCH") return false;
    }
  }
  const retired = `${lockPath}.stale.${details && details.token || "invalid"}.${process.pid}.${crypto.randomBytes(3).toString("hex")}`;
  try {
    fs.renameSync(lockPath, retired);
    fs.unlinkSync(retired);
    return true;
  } catch (_) { return false; }
}

function releaseError(message, cause) {
  const error = typedError(message, "QUALITY_IGNORES_LOCK_RELEASE_FAILED");
  error.cause = cause;
  return error;
}

function retireLock(lockPath, label) {
  const retired = `${lockPath}.${label}.${process.pid}.${crypto.randomBytes(3).toString("hex")}`;
  fs.renameSync(lockPath, retired);
  try { fs.unlinkSync(retired); } catch (error) { throw releaseError("quality ignore lock retired but cleanup failed", error); }
}

function matchesOwnedLock(lockPath, record, requireToken = true) {
  if (!record || !record.identity) return false;
  const identity = fileIdentity(lockPath);
  if (!identity || identity !== record.identity) return false;
  if (!requireToken) return true;
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return held && held.token === record.token;
  } catch (_) { return false; }
}

function reclaimOwnedAbandoned(lockPath) {
  for (const record of ownedLocks.values()) {
    if (!record.abandoned || record.lockPath !== lockPath) continue;
    if (!matchesOwnedLock(lockPath, record)) continue;
    try {
      retireLock(lockPath, `abandoned-${record.token}`);
      ownedLocks.delete(record.token);
      return true;
    } catch (_) { return false; }
  }
  return false;
}

function discardNewLock(lockPath, record) {
  if (!matchesOwnedLock(lockPath, record)) return false;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.unlinkSync(lockPath); return true; } catch (error) {
      if (error && error.code === "ENOENT") return true;
      lastError = error;
      wait(5);
    }
  }
  try {
    if (!matchesOwnedLock(lockPath, record)) return false;
    retireLock(lockPath, "aborted");
    return true;
  } catch (error) { throw releaseError("failed to discard newly-created quality ignore lock", error || lastError); }
}

function releaseOwnedLock(lockPath, token) {
  const record = ownedLocks.get(token);
  let held = null;
  let readError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      held = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      readError = null;
      break;
    } catch (error) {
      readError = error;
      wait(5);
    }
  }
  if (readError) {
    try {
      if (!matchesOwnedLock(lockPath, record, false)) throw new Error("owned lock identity changed");
      retireLock(lockPath, `unverified-${token}`);
      ownedLocks.delete(token);
      return { warning: { code: "QUALITY_IGNORES_LOCK_RELEASE_FAILED" } };
    } catch (error) {
      if (record) record.abandoned = true;
      throw releaseError("cannot recover unreadable owned quality ignore lock", error);
    }
  }
  if (!held || held.token !== token) throw releaseError("quality ignore lock ownership changed");
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.unlinkSync(lockPath); ownedLocks.delete(token); return; } catch (error) { lastError = error; wait(5); }
  }
  try {
    retireLock(lockPath, "released");
    ownedLocks.delete(token);
  } catch (error) {
    if (record) record.abandoned = true;
    throw releaseError("failed to release quality ignore lock", error || lastError);
  }
}

function acquireFileLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  const token = crypto.randomBytes(12).toString("hex");
  while (Date.now() - startedAt <= LOCK_WAIT_MS) {
    let writeAttempted = false;
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      writeAttempted = true;
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        token,
        instanceId: PROCESS_INSTANCE_ID,
        createdAt: new Date().toISOString(),
      }), { encoding: "utf8", flag: "wx" });
      ownedLocks.set(token, { token, lockPath, identity: fileIdentity(lockPath), abandoned: false });
      return () => releaseOwnedLock(lockPath, token);
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        const record = writeAttempted && { token, lockPath, identity: fileIdentity(lockPath), abandoned: true };
        if (record && matchesOwnedLock(lockPath, record)) {
          ownedLocks.set(token, record);
          try {
            discardNewLock(lockPath, record);
            ownedLocks.delete(token);
          } catch (cleanupError) { throw releaseError("quality ignore lock initialization cleanup failed", cleanupError); }
        }
        throw typedError(`quality ignore lock failed: ${error && error.message || "unknown"}`, "QUALITY_IGNORES_LOCK_FAILED");
      }
      if (reclaimOwnedAbandoned(lockPath)) continue;
      reclaimStaleLock(lockPath);
      wait(10);
    }
  }
  throw typedError("timed out waiting for quality ignore lock", "QUALITY_IGNORES_LOCK_TIMEOUT", 503);
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw typedError(`quality ignore replacement failed: ${error && error.message || "unknown"}`, "QUALITY_IGNORES_REPLACE_FAILED");
  }
}

function requireVersion(doc, options) {
  const expectedVersion = options.expectedVersion || options.ifMatch;
  if (options.requireIfMatch && !expectedVersion) {
    const error = typedError("If-Match required for quality mutation", "PRECONDITION_REQUIRED", 428);
    error.currentVersion = doc.version;
    throw error;
  }
  if (expectedVersion && expectedVersion !== doc.version) throw conflict(doc.version);
}

function normalizeRule(rule) {
  const fingerprint = String(rule && (rule.fingerprint || rule.key) || "").trim();
  if (!fingerprint) throw typedError("fingerprint is required", "QUALITY_IGNORE_FINGERPRINT_REQUIRED", 400);
  return {
    id: rule.id || `qi_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    fingerprint,
    reason: String(rule.reason || ""),
    severity: String(rule.severity || "info"),
    category: String(rule.category || "general"),
    createdAt: rule.createdAt || new Date().toISOString(),
    ignored: rule.ignored !== false,
  };
}

function ruleFingerprint(item) { return item.fingerprint || `${item.type || ""}::${item.target || ""}`; }

function prepareIgnoreMutation(input, options = {}) {
  const doc = readIgnoreDocument();
  requireVersion(doc, options);
  const action = input && input.action || "mark";
  const fingerprint = action === "unmark" ? String(input.fingerprint || "").trim() : "";
  if (action === "unmark" && !fingerprint) throw typedError("fingerprint is required", "QUALITY_IGNORE_FINGERPRINT_REQUIRED", 400);
  const rule = action === "unmark" ? null : normalizeRule(input);
  const rules = action === "unmark"
    ? doc.rules.filter((item) => ruleFingerprint(item) !== fingerprint)
    : doc.rules.filter((item) => ruleFingerprint(item) !== rule.fingerprint).concat(rule);
  const out = { version: makeVersion(rules), updatedAt: new Date().toISOString(), rules };
  return { version: doc.version, out, nextVersion: out.version, updatedAt: out.updatedAt, rules, rule, backupData: { version: doc.version, updatedAt: doc.updatedAt, rules: doc.rules } };
}

function commitPreparedIgnoreMutation(prepared, options = {}) {
  if (!prepared || !prepared.version || !prepared.out) throw typedError("invalid prepared quality mutation", "PREPARED_MUTATION_INVALID", 400);
  const release = acquireFileLock(QUALITY_IGNORES_PATH);
  let result = null;
  try {
    const current = readIgnoreDocument();
    if (current.version !== prepared.version) throw conflict(current.version);
    if (typeof options.afterRead === "function") options.afterRead(current);
    writeJsonAtomic(QUALITY_IGNORES_PATH, prepared.out);
    result = { version: prepared.nextVersion, etag: prepared.nextVersion, updatedAt: prepared.updatedAt, rules: prepared.rules, rule: prepared.rule || undefined };
  } finally {
    try {
      const releaseResult = release();
      if (result && releaseResult && releaseResult.warning) result.lockWarning = releaseResult.warning;
    } catch (error) {
      if (!result) throw error;
      result.lockWarning = { code: "QUALITY_IGNORES_LOCK_RELEASE_FAILED" };
    }
  }
  return result;
}

module.exports = { QUALITY_IGNORES_PATH, readIgnoreDocument, prepareIgnoreMutation, commitPreparedIgnoreMutation };
