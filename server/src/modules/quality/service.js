/**
 * Quality ignores domain service — versioned ignore rules.
 * Report generation remains in admin.js for now; mark/unmark is shared.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const QUALITY_IGNORES_PATH = path.join(STORAGE_DIR, "quality-ignores.json");

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
    fs.renameSync(tmp, filePath);
  } catch {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function makeVersion(rules) {
  return `qi_${crypto.createHash("sha256").update(JSON.stringify(rules || [])).digest("hex").slice(0, 16)}`;
}

function readDoc() {
  try {
    if (fs.existsSync(QUALITY_IGNORES_PATH)) {
      const raw = JSON.parse(fs.readFileSync(QUALITY_IGNORES_PATH, "utf8"));
      if (Array.isArray(raw)) {
        return { version: makeVersion(raw), rules: raw, updatedAt: null };
      }
      if (raw && typeof raw === "object") {
        return {
          version: raw.version || makeVersion(raw.rules || []),
          rules: Array.isArray(raw.rules) ? raw.rules : [],
          updatedAt: raw.updatedAt || null,
        };
      }
    }
  } catch {
    /* fallthrough */
  }
  return { version: makeVersion([]), rules: [], updatedAt: null };
}

function listIgnores() {
  return readDoc();
}

function prepareMarkIgnoreMutation(rule, options = {}) {
  const doc = readDoc();
  const expected = options.expectedVersion || options.ifMatch;
  if (options.requireIfMatch && !expected) {
    const err = new Error("If-Match required for quality mark");
    err.statusCode = 428;
    err.code = "PRECONDITION_REQUIRED";
    err.currentVersion = doc.version;
    throw err;
  }
  if (expected && expected !== doc.version) {
    const err = new Error("quality ignores conflict");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = doc.version;
    throw err;
  }
  const entry = {
    id: rule.id || `qi_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    fingerprint: rule.fingerprint || rule.key || "",
    reason: rule.reason || "",
    severity: rule.severity || "info",
    category: rule.category || "general",
    createdAt: new Date().toISOString(),
    ignored: rule.ignored !== false,
  };
  if (!entry.fingerprint) {
    const err = new Error("fingerprint is required");
    err.statusCode = 400;
    throw err;
  }
  const nextRules = doc.rules.filter((r) => r.fingerprint !== entry.fingerprint);
  nextRules.push(entry);
  const version = makeVersion(nextRules);
  const out = { version, updatedAt: new Date().toISOString(), rules: nextRules };
  return {
    version: doc.version,
    out,
    entry,
    nextVersion: version,
    rules: nextRules,
    backupData: { version: doc.version, updatedAt: doc.updatedAt, rules: doc.rules },
  };
}

function commitPreparedQualityMutation(prepared) {
  if (!prepared || !prepared.version || !prepared.out) {
    const err = new Error("invalid prepared quality mutation");
    err.statusCode = 400;
    err.code = "PREPARED_MUTATION_INVALID";
    throw err;
  }
  const current = readDoc();
  if (current.version !== prepared.version) {
    const err = new Error("quality ignores conflict");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = current.version;
    throw err;
  }
  writeJsonAtomic(QUALITY_IGNORES_PATH, prepared.out);
  return { version: prepared.nextVersion, etag: prepared.nextVersion, rule: prepared.entry, rules: prepared.rules };
}

function markIgnore(rule, options = {}) {
  return commitPreparedQualityMutation(prepareMarkIgnoreMutation(rule, options));
}

function prepareUnmarkIgnoreMutation(fingerprint, options = {}) {
  const doc = readDoc();
  const expected = options.expectedVersion || options.ifMatch;
  if (options.requireIfMatch && !expected) {
    const err = new Error("If-Match required");
    err.statusCode = 428;
    err.code = "PRECONDITION_REQUIRED";
    throw err;
  }
  if (expected && expected !== doc.version) {
    const err = new Error("quality ignores conflict");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = doc.version;
    throw err;
  }
  const nextRules = doc.rules.filter((r) => r.fingerprint !== fingerprint);
  const version = makeVersion(nextRules);
  return {
    version: doc.version,
    out: {
    version,
    updatedAt: new Date().toISOString(),
    rules: nextRules,
    },
    nextVersion: version,
    rules: nextRules,
    backupData: { version: doc.version, updatedAt: doc.updatedAt, rules: doc.rules },
  };
}

function unmarkIgnore(fingerprint, options = {}) {
  return commitPreparedQualityMutation(prepareUnmarkIgnoreMutation(fingerprint, options));
}

module.exports = {
  QUALITY_IGNORES_PATH,
  listIgnores,
  prepareMarkIgnoreMutation,
  prepareUnmarkIgnoreMutation,
  commitPreparedQualityMutation,
  markIgnore,
  unmarkIgnore,
};
