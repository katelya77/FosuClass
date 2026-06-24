const crypto = require("crypto");
const { sm2 } = require("sm-crypto");

const DEFAULT_KEY_TTL_SECONDS = 5 * 60;
const DEFAULT_PREVIEW_TTL_SECONDS = 10 * 60;
const KEY_PREFIX = "fosu_import_key_";
const PREVIEW_PREFIX = "fosu_import_preview_";

const keyStore = new Map();
const previewStore = new Map();

function nowMs() {
  return Date.now();
}

function randomId(prefix) {
  return `${prefix}${crypto.randomBytes(18).toString("base64url")}`;
}

function cleanupStore(store) {
  const now = nowMs();
  for (const [key, value] of store.entries()) {
    if (!value || Number(value.expiresAtMs || 0) <= now) {
      store.delete(key);
    }
  }
}

function createPublicKeyChallenge(options = {}) {
  cleanupStore(keyStore);
  const ttlSeconds = Math.max(60, Number(options.ttlSeconds || process.env.FOSU_IMPORT_KEY_TTL_SECONDS || DEFAULT_KEY_TTL_SECONDS) || DEFAULT_KEY_TTL_SECONDS);
  const keyId = randomId(KEY_PREFIX);
  const nonce = crypto.randomBytes(18).toString("base64url");
  const rsaPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const sm2Pair = sm2.generateKeyPairHex();
  keyStore.set(keyId, {
    keyId,
    nonce,
    privateKey: rsaPair.privateKey,
    rsaPrivateKey: rsaPair.privateKey,
    sm2PrivateKey: sm2Pair.privateKey,
    algorithms: ["SM2", "RSA-OAEP"],
    createdAtMs: nowMs(),
    expiresAtMs: nowMs() + ttlSeconds * 1000,
  });
  return {
    keyId,
    publicKey: rsaPair.publicKey,
    publicKeys: {
      SM2: sm2Pair.publicKey,
      "RSA-OAEP": rsaPair.publicKey,
    },
    sm2PublicKey: sm2Pair.publicKey,
    nonce,
    expiresIn: ttlSeconds,
    algorithms: ["SM2", "RSA-OAEP"],
    preferredAlgorithm: "SM2",
  };
}

function takePrivateKeyChallenge(keyId) {
  cleanupStore(keyStore);
  const id = String(keyId || "").trim();
  if (!id) return null;
  const record = keyStore.get(id);
  keyStore.delete(id);
  if (!record || record.expiresAtMs <= nowMs()) {
    return null;
  }
  return record;
}

function clearPrivateKeyChallenge(record) {
  if (!record) return;
  record.privateKey = null;
  record.rsaPrivateKey = null;
  record.sm2PrivateKey = null;
  record.nonce = null;
}

function createPreviewToken(payload, options = {}) {
  cleanupStore(previewStore);
  const ttlSeconds = Math.max(60, Number(options.ttlSeconds || process.env.FOSU_IMPORT_PREVIEW_TTL_SECONDS || DEFAULT_PREVIEW_TTL_SECONDS) || DEFAULT_PREVIEW_TTL_SECONDS);
  const token = randomId(PREVIEW_PREFIX);
  previewStore.set(token, Object.assign({}, payload || {}, {
    importPreviewToken: token,
    createdAtMs: nowMs(),
    expiresAtMs: nowMs() + ttlSeconds * 1000,
    ttlSeconds,
    consumed: false,
  }));
  return {
    token,
    expiresIn: ttlSeconds,
  };
}

function getPreview(token) {
  cleanupStore(previewStore);
  const key = String(token || "").trim();
  if (!key) return null;
  const record = previewStore.get(key);
  if (!record || record.expiresAtMs <= nowMs()) {
    previewStore.delete(key);
    return null;
  }
  return record;
}

function takePreview(token) {
  const key = String(token || "").trim();
  const record = getPreview(key);
  if (!record) return null;
  previewStore.delete(key);
  record.consumed = true;
  return record;
}

function deletePreview(token) {
  return previewStore.delete(String(token || "").trim());
}

function __resetForTest() {
  keyStore.clear();
  previewStore.clear();
}

function __setPreviewForTest(token, record) {
  previewStore.set(token, Object.assign({}, record || {}, {
    importPreviewToken: token,
  }));
}

module.exports = {
  __resetForTest,
  __setPreviewForTest,
  clearPrivateKeyChallenge,
  createPreviewToken,
  createPublicKeyChallenge,
  deletePreview,
  getPreview,
  takePreview,
  takePrivateKeyChallenge,
};
