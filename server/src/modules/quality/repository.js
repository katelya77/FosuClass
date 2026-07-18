const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const QUALITY_IGNORES_PATH = path.join(STORAGE_DIR, "quality-ignores.json");

function makeVersion(rules) {
  return `qi_${crypto.createHash("sha256").update(JSON.stringify(rules || [])).digest("hex").slice(0, 16)}`;
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    try { fs.renameSync(tempPath, filePath); } catch (_) {
      fs.copyFileSync(tempPath, filePath);
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

function readIgnoreDocument() {
  try {
    if (!fs.existsSync(QUALITY_IGNORES_PATH)) return { version: makeVersion([]), updatedAt: null, rules: [] };
    const raw = JSON.parse(fs.readFileSync(QUALITY_IGNORES_PATH, "utf8"));
    if (Array.isArray(raw)) return { version: makeVersion(raw), updatedAt: null, rules: raw };
    if (raw && typeof raw === "object") {
      const rules = Array.isArray(raw.rules) ? raw.rules : [];
      return { version: raw.version || makeVersion(rules), updatedAt: raw.updatedAt || null, rules };
    }
  } catch (_) {
    // A malformed isolated ignore file is treated as empty, matching legacy reads.
  }
  return { version: makeVersion([]), updatedAt: null, rules: [] };
}

function conflict(currentVersion) {
  const error = new Error("quality ignores conflict");
  error.statusCode = 409;
  error.code = "CONFLICT";
  error.currentVersion = currentVersion;
  return error;
}

function requireVersion(doc, options) {
  const expectedVersion = options.expectedVersion || options.ifMatch;
  if (options.requireIfMatch && !expectedVersion) {
    const error = new Error("If-Match required for quality mutation");
    error.statusCode = 428;
    error.code = "PRECONDITION_REQUIRED";
    error.currentVersion = doc.version;
    throw error;
  }
  if (expectedVersion && expectedVersion !== doc.version) throw conflict(doc.version);
}

function normalizeRule(rule) {
  const fingerprint = String(rule && (rule.fingerprint || rule.key) || "").trim();
  if (!fingerprint) {
    const error = new Error("fingerprint is required");
    error.statusCode = 400;
    throw error;
  }
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

function prepareIgnoreMutation(input, options = {}) {
  const doc = readIgnoreDocument();
  requireVersion(doc, options);
  const action = input && input.action || "mark";
  const fingerprint = action === "unmark" ? String(input.fingerprint || "").trim() : "";
  if (action === "unmark" && !fingerprint) {
    const error = new Error("fingerprint is required");
    error.statusCode = 400;
    throw error;
  }
  const rule = action === "unmark" ? null : normalizeRule(input);
  const rules = action === "unmark"
    ? doc.rules.filter((item) => (item.fingerprint || `${item.type || ""}::${item.target || ""}`) !== fingerprint)
    : doc.rules.filter((item) => (item.fingerprint || `${item.type || ""}::${item.target || ""}`) !== rule.fingerprint).concat(rule);
  const out = { version: makeVersion(rules), updatedAt: new Date().toISOString(), rules };
  return {
    version: doc.version,
    out,
    nextVersion: out.version,
    updatedAt: out.updatedAt,
    rules,
    rule,
    backupData: { version: doc.version, updatedAt: doc.updatedAt, rules: doc.rules },
  };
}

function commitPreparedIgnoreMutation(prepared) {
  if (!prepared || !prepared.version || !prepared.out) {
    const error = new Error("invalid prepared quality mutation");
    error.statusCode = 400;
    error.code = "PREPARED_MUTATION_INVALID";
    throw error;
  }
  const current = readIgnoreDocument();
  if (current.version !== prepared.version) throw conflict(current.version);
  writeJsonAtomic(QUALITY_IGNORES_PATH, prepared.out);
  return {
    version: prepared.nextVersion,
    etag: prepared.nextVersion,
    updatedAt: prepared.updatedAt,
    rules: prepared.rules,
    rule: prepared.rule || undefined,
  };
}

module.exports = {
  QUALITY_IGNORES_PATH,
  readIgnoreDocument,
  prepareIgnoreMutation,
  commitPreparedIgnoreMutation,
};
