/**
 * Principal-scoped explicit preferences.
 *
 * Only values the user explicitly asks the assistant to remember are accepted.
 * Values are encrypted at rest and are never keyed by a client supplied id.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../../exclusiveFileLockService");
const { principalShard } = require("./conversationPrincipalService");

const SCHEMA_VERSION = "user-preferences.v1";
const ALLOWED_KEYS = Object.freeze([
  "preferredName",
  "campus",
  "defaultReminderLeadMinutes",
]);

function typedError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || 400;
  return error;
}

function normalizeValue(key, value) {
  if (key === "preferredName") {
    const name = String(value || "").trim().replace(/[，。！？,.!?]+$/g, "").slice(0, 24);
    if (!name || !/^[\u3400-\u9fffA-Za-z0-9·\-\s]{1,24}$/.test(name)) return null;
    return name;
  }
  if (key === "campus") {
    const campus = String(value || "").trim();
    return ["仙溪校区", "江湾校区"].includes(campus) ? campus : null;
  }
  if (key === "defaultReminderLeadMinutes") {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes >= 5 && minutes <= 180
      ? Math.round(minutes)
      : null;
  }
  return null;
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function encryptObject(value, secret, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(String(aad || "")));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptObject(envelope, secret, aad) {
  if (!envelope || envelope.algorithm !== "aes-256-gcm") return {};
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(envelope.iv || "", "base64")
  );
  decipher.setAAD(Buffer.from(String(aad || "")));
  decipher.setAuthTag(Buffer.from(envelope.tag || "", "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext || "", "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plain);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

class UserPreferenceService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.dataDir
      || process.env.FOSU_USER_PREFERENCE_DATA_DIR
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"), "ai", "user-preferences")
    );
    this.secret = String(options.secret || process.env.FOSU_AGENT_MEMORY_SECRET || "");
  }

  assertPrincipal(principal) {
    if (!principal || principal.authenticated !== true || !principal.principalKey) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    return String(principal.principalKey);
  }

  assertWritable() {
    if (this.secret.length < 16) {
      throw typedError("Memory encryption is not configured", "MEMORY_SECRET_UNAVAILABLE", 503);
    }
  }

  filePath(principalKey) {
    return path.join(this.rootDir, principalShard(principalKey), "preferences.json");
  }

  withLock(principalKey, callback) {
    const filePath = this.filePath(principalKey);
    ensureDir(path.dirname(filePath));
    const release = acquireExclusiveFileLock(filePath, {
      lockPath: `${filePath}.lock`,
      codePrefix: "USER_PREFERENCE",
      waitMs: 1200,
      staleMs: 30000,
    });
    try {
      return callback(filePath);
    } finally {
      release();
    }
  }

  readUnlocked(filePath, principalKey) {
    if (!this.secret || !fs.existsSync(filePath)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (raw.schemaVersion !== SCHEMA_VERSION) return {};
      return decryptObject(raw.encrypted, this.secret, principalKey);
    } catch (_) {
      return {};
    }
  }

  writeUnlocked(filePath, principalKey, values) {
    this.assertWritable();
    const clean = {};
    ALLOWED_KEYS.forEach((key) => {
      const normalized = normalizeValue(key, values[key]);
      if (normalized !== null) clean[key] = normalized;
    });
    if (!Object.keys(clean).length) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    writeJsonAtomic(filePath, {
      schemaVersion: SCHEMA_VERSION,
      principalShard: principalShard(principalKey),
      updatedAt: new Date().toISOString(),
      encrypted: encryptObject(clean, this.secret, principalKey),
    });
  }

  getObject(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => this.readUnlocked(filePath, principalKey));
  }

  list(input = {}) {
    const values = this.getObject(input);
    return {
      success: true,
      items: ALLOWED_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(values, key)).map((key) => ({
        key,
        value: values[key],
        scope: "cloud_sync",
      })),
    };
  }

  upsert(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    if (input.explicit !== true || input.memoryMode !== "cloud_sync") {
      return { success: true, persisted: false, reason: "cloud_sync_not_enabled" };
    }
    const entries = input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values
      : { [input.key]: input.value };
    const normalizedPatch = {};
    Object.keys(entries).forEach((key) => {
      if (!ALLOWED_KEYS.includes(key)) return;
      const value = normalizeValue(key, entries[key]);
      if (value !== null) normalizedPatch[key] = value;
    });
    if (!Object.keys(normalizedPatch).length) {
      throw typedError("Preference is invalid", "PREFERENCE_INVALID", 400);
    }
    this.withLock(principalKey, (filePath) => {
      const current = this.readUnlocked(filePath, principalKey);
      this.writeUnlocked(filePath, principalKey, Object.assign({}, current, normalizedPatch));
    });
    return { success: true, persisted: true, keys: Object.keys(normalizedPatch) };
  }

  remove(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const key = String(input.key || "");
    if (!ALLOWED_KEYS.includes(key)) {
      throw typedError("Preference key is invalid", "PREFERENCE_KEY_INVALID", 400);
    }
    let deleted = false;
    this.withLock(principalKey, (filePath) => {
      const current = this.readUnlocked(filePath, principalKey);
      deleted = Object.prototype.hasOwnProperty.call(current, key);
      delete current[key];
      this.writeUnlocked(filePath, principalKey, current);
    });
    return { success: true, deleted };
  }

  clear(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    let deleted = 0;
    this.withLock(principalKey, (filePath) => {
      const current = this.readUnlocked(filePath, principalKey);
      deleted = Object.keys(current).length;
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    return { success: true, deleted };
  }
}

const defaultUserPreferenceService = new UserPreferenceService();

module.exports = {
  ALLOWED_KEYS,
  UserPreferenceService,
  defaultUserPreferenceService,
  normalizeValue,
};
