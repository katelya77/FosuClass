const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const QUALITY_IGNORES_PATH = path.join(STORAGE_DIR, "quality-ignores.json");
const LOCK_WAIT_MS = Number(process.env.FOSU_QUALITY_IGNORE_LOCK_WAIT_MS || 1000);
const LOCK_STALE_MS = Number(process.env.FOSU_QUALITY_IGNORE_LOCK_STALE_MS || 30000);

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

function reclaimStaleLock(lockPath) {
  let stat;
  let details;
  try {
    stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < LOCK_STALE_MS) return false;
    details = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (_) { return false; }
  if (!details || !Number.isInteger(details.pid) || details.pid <= 0) return false;
  try {
    process.kill(details.pid, 0);
    return false;
  } catch (error) {
    if (error.code && error.code !== "ESRCH") return false;
  }
  const retired = `${lockPath}.stale.${details.token || "unknown"}.${process.pid}`;
  try {
    fs.renameSync(lockPath, retired);
    fs.unlinkSync(retired);
    return true;
  } catch (_) { return false; }
}

function acquireFileLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  const token = crypto.randomBytes(12).toString("hex");
  while (Date.now() - startedAt <= LOCK_WAIT_MS) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      const descriptor = fs.openSync(lockPath, "wx");
      try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }), "utf8"); }
      finally { fs.closeSync(descriptor); }
      return () => {
        try {
          const held = JSON.parse(fs.readFileSync(lockPath, "utf8"));
          if (held && held.token === token) fs.unlinkSync(lockPath);
        } catch (_) {}
      };
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw typedError(`quality ignore lock failed: ${error && error.message || "unknown"}`, "QUALITY_IGNORES_LOCK_FAILED");
      reclaimStaleLock(lockPath);
      wait(10);
    }
  }
  throw typedError("timed out waiting for quality ignore lock", "QUALITY_IGNORES_LOCK_TIMEOUT", 409);
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

function commitPreparedIgnoreMutation(prepared) {
  if (!prepared || !prepared.version || !prepared.out) throw typedError("invalid prepared quality mutation", "PREPARED_MUTATION_INVALID", 400);
  const release = acquireFileLock(QUALITY_IGNORES_PATH);
  try {
    const current = readIgnoreDocument();
    if (current.version !== prepared.version) throw conflict(current.version);
    writeJsonAtomic(QUALITY_IGNORES_PATH, prepared.out);
    return { version: prepared.nextVersion, etag: prepared.nextVersion, updatedAt: prepared.updatedAt, rules: prepared.rules, rule: prepared.rule || undefined };
  } finally {
    release();
  }
}

module.exports = { QUALITY_IGNORES_PATH, readIgnoreDocument, prepareIgnoreMutation, commitPreparedIgnoreMutation };
