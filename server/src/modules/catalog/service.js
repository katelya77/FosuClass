/**
 * Catalog meta domain service — versioned metadata edits.
 * List/stats remain served by admin routes using shared release data readers;
 * meta write path is centralized here for Legacy + Vue.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const CATALOG_META_PATH = path.join(STORAGE_DIR, "catalog-meta.json");

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

function readMetaDoc() {
  try {
    if (fs.existsSync(CATALOG_META_PATH)) {
      const data = JSON.parse(fs.readFileSync(CATALOG_META_PATH, "utf8"));
      if (data && typeof data === "object" && !Array.isArray(data)) {
        if (!data.__meta) {
          return {
            __meta: {
              version: makeVersion(data),
              updatedAt: new Date().toISOString(),
            },
            entries: data,
          };
        }
        return data;
      }
    }
  } catch {
    /* fallthrough */
  }
  return {
    __meta: { version: makeVersion({}), updatedAt: new Date().toISOString() },
    entries: {},
  };
}

function makeVersion(entries) {
  const basis = JSON.stringify(entries || {});
  return `catmeta_${crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

function getCatalogMeta() {
  const doc = readMetaDoc();
  // legacy flat shape for existing list mappers
  return doc.entries || doc;
}

function getCatalogMetaDocument() {
  const doc = readMetaDoc();
  const entries = doc.entries || {};
  const version = (doc.__meta && doc.__meta.version) || makeVersion(entries);
  return {
    version,
    etag: version,
    updatedAt: (doc.__meta && doc.__meta.updatedAt) || null,
    entries,
  };
}

function prepareCatalogMetaEntryMutation(key, patch, options = {}) {
  const doc = getCatalogMetaDocument();
  const expected = options.expectedVersion || options.ifMatch || options.version;
  if (options.requireIfMatch && !expected) {
    const err = new Error("If-Match required for catalog meta update");
    err.statusCode = 428;
    err.code = "PRECONDITION_REQUIRED";
    err.currentVersion = doc.version;
    throw err;
  }
  if (expected && expected !== doc.version) {
    const err = new Error("catalog meta was modified by another request");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = doc.version;
    throw err;
  }
  const k = String(key || "").trim();
  if (!k) {
    const err = new Error("meta key is required");
    err.statusCode = 400;
    throw err;
  }
  const entries = JSON.parse(JSON.stringify(doc.entries || {}));
  const prev = entries[k] || {};
  const next = Object.assign({}, prev, patch || {}, {
    updatedAt: new Date().toISOString(),
  });
  entries[k] = next;
  const version = makeVersion(entries);
  const out = {
    __meta: { version, updatedAt: new Date().toISOString() },
    entries,
  };
  return {
    version: doc.version,
    key: k,
    entry: next,
    out,
    nextVersion: version,
    backupData: { __meta: { version: doc.version, updatedAt: doc.updatedAt }, entries: doc.entries },
  };
}

function commitPreparedCatalogMetaEntryMutation(prepared) {
  if (!prepared || !prepared.version || !prepared.out || !prepared.key) {
    const err = new Error("invalid prepared catalog meta mutation");
    err.statusCode = 400;
    err.code = "PREPARED_MUTATION_INVALID";
    throw err;
  }
  const current = getCatalogMetaDocument();
  if (current.version !== prepared.version) {
    const err = new Error("catalog meta was modified by another request");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = current.version;
    throw err;
  }
  writeJsonAtomic(CATALOG_META_PATH, prepared.out);
  return { key: prepared.key, entry: prepared.entry, version: prepared.nextVersion, etag: prepared.nextVersion };
}

function saveCatalogMetaEntry(key, patch, options = {}) {
  return commitPreparedCatalogMetaEntryMutation(prepareCatalogMetaEntryMutation(key, patch, options));
}

function saveCatalogMetaBulk(entriesPatch, options = {}) {
  const doc = getCatalogMetaDocument();
  const expected = options.expectedVersion || options.ifMatch;
  if (options.requireIfMatch && !expected) {
    const err = new Error("If-Match required");
    err.statusCode = 428;
    err.code = "PRECONDITION_REQUIRED";
    throw err;
  }
  if (expected && expected !== doc.version) {
    const err = new Error("catalog meta conflict");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = doc.version;
    throw err;
  }
  Object.assign(doc.entries, entriesPatch || {});
  const version = makeVersion(doc.entries);
  writeJsonAtomic(CATALOG_META_PATH, {
    __meta: { version, updatedAt: new Date().toISOString() },
    entries: doc.entries,
  });
  return { version, etag: version, entries: doc.entries };
}

module.exports = {
  CATALOG_META_PATH,
  getCatalogMeta,
  getCatalogMetaDocument,
  prepareCatalogMetaEntryMutation,
  commitPreparedCatalogMetaEntryMutation,
  saveCatalogMetaEntry,
  saveCatalogMetaBulk,
  makeVersion,
};
