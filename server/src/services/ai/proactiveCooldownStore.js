/**
 * Durable, bounded proactive cooldown store.
 * Survives process restart; no plaintext OpenID (principalKey hash only).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../exclusiveFileLockService");

const SCHEMA_VERSION = "proactive-cooldown.v1";
const DEFAULT_MAX_RECORDS = 5000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function hashPrincipal(principalKey) {
  const raw = String(principalKey || "anon").slice(0, 128);
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

class ProactiveCooldownStore {
  constructor(options = {}) {
    const dataRoot = path.resolve(
      options.dataDir
      || process.env.FOSU_PROACTIVE_COOLDOWN_DIR
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"), "ai", "proactive-cooldown")
    );
    this.filePath = path.join(dataRoot, "cooldowns.json");
    this.maxRecords = Math.max(100, Number(options.maxRecords || DEFAULT_MAX_RECORDS) || DEFAULT_MAX_RECORDS);
    this.maxAgeMs = Math.max(60 * 1000, Number(options.maxAgeMs || DEFAULT_MAX_AGE_MS) || DEFAULT_MAX_AGE_MS);
  }

  withLock(callback) {
    ensureDir(path.dirname(this.filePath));
    const filePath = this.filePath;
    const release = acquireExclusiveFileLock(filePath, {
      lockPath: `${filePath}.lock`,
      codePrefix: "PROACTIVE_COOLDOWN",
      waitMs: 1200,
      staleMs: 30000,
    });
    try {
      return callback(filePath);
    } finally {
      try { release(); } catch (_) { /* ignore */ }
    }
  }

  readUnlocked(filePath) {
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), records: {} };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!raw || typeof raw !== "object") {
        return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), records: {} };
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: raw.updatedAt || new Date().toISOString(),
        records: raw.records && typeof raw.records === "object" ? raw.records : {},
      };
    } catch (_) {
      return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), records: {} };
    }
  }

  prune(records, now = Date.now()) {
    const next = {};
    Object.keys(records || {}).forEach((key) => {
      const until = Number(records[key] && records[key].until || records[key]) || 0;
      if (until > now && until - now < this.maxAgeMs * 2) {
        next[key] = { until, type: records[key] && records[key].type || "" };
      }
    });
    const keys = Object.keys(next);
    if (keys.length <= this.maxRecords) return next;
    keys.sort((a, b) => (next[a].until || 0) - (next[b].until || 0));
    const drop = keys.length - this.maxRecords;
    keys.slice(0, drop).forEach((key) => {
      delete next[key];
    });
    return next;
  }

  key(principalKey, suggestionType) {
    return `${hashPrincipal(principalKey)}:${String(suggestionType || "").slice(0, 40)}`;
  }

  isCooledDown(principalKey, suggestionType, now = Date.now()) {
    return this.withLock((filePath) => {
      const data = this.readUnlocked(filePath);
      const entry = data.records[this.key(principalKey, suggestionType)];
      const until = Number(entry && entry.until || 0) || 0;
      return now < until;
    });
  }

  markShown(principalKey, suggestionType, ttlMs, now = Date.now()) {
    const ttl = Math.max(60 * 1000, Number(ttlMs) || 60 * 60 * 1000);
    return this.withLock((filePath) => {
      const data = this.readUnlocked(filePath);
      data.records[this.key(principalKey, suggestionType)] = {
        until: now + ttl,
        type: String(suggestionType || "").slice(0, 40),
      };
      data.records = this.prune(data.records, now);
      data.updatedAt = new Date().toISOString();
      writeJsonAtomic(filePath, data);
      return true;
    });
  }

  clearPrincipal(principalKey) {
    const prefix = `${hashPrincipal(principalKey)}:`;
    return this.withLock((filePath) => {
      const data = this.readUnlocked(filePath);
      Object.keys(data.records).forEach((key) => {
        if (key.startsWith(prefix)) delete data.records[key];
      });
      data.updatedAt = new Date().toISOString();
      writeJsonAtomic(filePath, data);
      return true;
    });
  }

  /** Test helper: wipe all records */
  clearAll() {
    return this.withLock((filePath) => {
      writeJsonAtomic(filePath, {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        records: {},
      });
      return true;
    });
  }
}

const defaultProactiveCooldownStore = new ProactiveCooldownStore();

module.exports = {
  ProactiveCooldownStore,
  defaultProactiveCooldownStore,
  hashPrincipal,
};
