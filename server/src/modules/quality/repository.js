const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { acquireExclusiveFileLock } = require("../../services/exclusiveFileLockService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const QUALITY_IGNORES_PATH = path.join(STORAGE_DIR, "quality-ignores.json");

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

function acquireFileLock(filePath) {
  return acquireExclusiveFileLock(filePath, {
    codePrefix: "QUALITY_IGNORES",
    waitMs: Number(process.env.FOSU_QUALITY_IGNORE_LOCK_WAIT_MS || 1000),
    staleMs: Number(process.env.FOSU_QUALITY_IGNORE_LOCK_STALE_MS || 30000),
  });
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
