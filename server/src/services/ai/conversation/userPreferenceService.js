/**
 * Principal-scoped low-risk preferences.
 *
 * Values are encrypted at rest and are never keyed by a client supplied id.
 * Enabling cloud_sync is functional authorization for low-risk User Memory
 * (name, campus, reminder lead, etc.). session_state does not write user prefs.
 * Sensitive credentials are never accepted.
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
  "preferredBuilding",
  "answerDetailLevel",
  "preferredClassName",
  "preferPersonalSchedule",
  "college",
  "major",
  "grade",
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
  if (key === "preferredBuilding") {
    const building = String(value || "").trim().slice(0, 24);
    return /^[A-Za-z0-9\u3400-\u9fff\-]{1,24}$/.test(building) ? building : null;
  }
  if (key === "answerDetailLevel") {
    const level = String(value || "").trim().toLowerCase();
    return ["concise", "detailed", "normal"].includes(level) ? level : null;
  }
  if (key === "preferredClassName") {
    const name = String(value || "").trim().slice(0, 40);
    return name && /班/.test(name) ? name : null;
  }
  if (key === "preferPersonalSchedule") {
    if (value === true || value === "true" || value === 1) return true;
    if (value === false || value === "false" || value === 0) return false;
    return null;
  }
  if (key === "college") {
    const college = String(value || "").trim().replace(/[，。！？,.!?]+$/g, "").slice(0, 16);
    return /^[㐀-鿿]{2,16}(学院|学部)$/.test(college) ? college : null;
  }
  if (key === "major") {
    const major = String(value || "").trim().replace(/[，。！？,.!?]+$/g, "").slice(0, 16);
    if (!/^[㐀-鿿A-Za-z]{2,16}$/.test(major)) return null;
    // 拒绝明显非专业的误抓：学院/大学机构名、身份词、场景词
    if (/(学院|大学|学部|学生|校区|老师|同学|专业)$/.test(major)) return null;
    return major;
  }
  if (key === "grade") {
    const grade = String(value || "").trim();
    return /^(大[一二三四五六]|20\d{2}级)$/.test(grade) ? grade : null;
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
    const updatedAt = new Date().toISOString();
    return {
      success: true,
      items: ALLOWED_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(values, key)).map((key) => ({
        key,
        value: values[key],
        scope: "cloud_sync",
        category: key === "preferredName" ? "称呼"
          : key === "campus" ? "校区"
            : key === "preferredBuilding" ? "常用楼栋"
              : key === "defaultReminderLeadMinutes" ? "默认提醒"
                : key === "answerDetailLevel" ? "回答偏好"
                  : key === "college" ? "学院"
                    : key === "major" ? "专业"
                      : key === "grade" ? "年级"
                        : "偏好",
        updatedAt,
        editable: true,
      })),
    };
  }

  upsert(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mode = String(input.memoryMode || "local_only");
    // Durable User Memory only under cloud_sync (cross-conversation / cross-device).
    // session_state and local_only never write preference files.
    if (input.explicit !== true || mode !== "cloud_sync") {
      return {
        success: true,
        persisted: false,
        reason: mode === "local_only" ? "local_only" : (mode === "session_state" ? "session_state_no_user_memory" : "not_authorized"),
      };
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
