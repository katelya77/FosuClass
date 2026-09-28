const crypto = require("crypto");

const DEFAULT_PREVIEW_TTL_SECONDS = 10 * 60;
const PREVIEW_PREFIX = "fosu_import_preview_";
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
  createPreviewToken,
  deletePreview,
  getPreview,
  takePreview,
};
