const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../../exclusiveFileLockService");

const SCHEMA_VERSION = "wechat-recipient.v1";

function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function shardFor(principalKey) {
  return crypto.createHash("sha256").update(String(principalKey || "")).digest("hex").slice(0, 24);
}

function encrypt(value, secret, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(value, secret, aad) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(value.iv || "", "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(value.tag || "", "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext || "", "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

class WechatRecipientVault {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.dataDir
      || process.env.FOSU_WECHAT_RECIPIENT_DATA_DIR
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"), "ai", "wechat-recipients")
    );
    this.secret = String(
      options.secret
      || process.env.FOSU_WECHAT_RECIPIENT_SECRET
      || process.env.FOSU_AGENT_REMINDER_SECRET
      || ""
    );
  }

  isConfigured() {
    return this.secret.length >= 16;
  }

  filePath(principalKey) {
    return path.join(this.rootDir, shardFor(principalKey), "recipient.json");
  }

  withLock(principalKey, callback) {
    const filePath = this.filePath(principalKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const release = acquireExclusiveFileLock(filePath, {
      lockPath: `${filePath}.lock`,
      codePrefix: "WECHAT_RECIPIENT",
      waitMs: 1200,
      staleMs: 30000,
    });
    try {
      return callback(filePath, shardFor(principalKey));
    } finally {
      release();
    }
  }

  store(input = {}) {
    const principalKey = String(input.principalKey || "");
    const openid = String(input.openid || "");
    if (!this.isConfigured() || !principalKey || !openid) {
      return { success: true, stored: false, reason: "recipient_vault_unavailable" };
    }
    return this.withLock(principalKey, (filePath, shard) => {
      writeAtomic(filePath, {
        schemaVersion: SCHEMA_VERSION,
        principalShard: shard,
        updatedAt: new Date().toISOString(),
        encrypted: encrypt({
          principalHash: crypto.createHash("sha256").update(principalKey).digest("hex"),
          openid: openid.slice(0, 128),
          appid: String(input.appid || "").slice(0, 64),
          updatedAt: new Date().toISOString(),
        }, this.secret, shard),
      });
      return { success: true, stored: true };
    });
  }

  get(input = {}) {
    const principalKey = String(input.principalKey || "");
    if (!this.isConfigured() || !principalKey) return null;
    return this.withLock(principalKey, (filePath, shard) => {
      try {
        if (!fs.existsSync(filePath)) return null;
        const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (envelope.schemaVersion !== SCHEMA_VERSION) return null;
        const value = decrypt(envelope.encrypted, this.secret, shard);
        const expected = crypto.createHash("sha256").update(principalKey).digest("hex");
        return value && value.principalHash === expected ? value : null;
      } catch (_) {
        return null;
      }
    });
  }

  remove(input = {}) {
    const principalKey = String(input.principalKey || "");
    if (!principalKey) return { success: true, deleted: false };
    return this.withLock(principalKey, (filePath) => {
      const deleted = fs.existsSync(filePath);
      if (deleted) fs.unlinkSync(filePath);
      return { success: true, deleted };
    });
  }
}

const defaultWechatRecipientVault = new WechatRecipientVault();

module.exports = {
  WechatRecipientVault,
  defaultWechatRecipientVault,
  shardFor,
};
