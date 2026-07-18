/**
 * Catalog meta domain service — versioned metadata edits.
 * C1 operations use an unpublished, generation-versioned Catalog workspace;
 * meta write path is centralized here for Legacy + Vue.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const contracts = require("./contracts");
const repository = require("./repository");
const importService = require("./importService");

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

const EXPORT_COLUMNS = Object.freeze({
  class: ["id", "className", "collegeCode", "collegeName", "majorCode", "majorName", "grade", "semester", "coursesCount", "displayName", "note", "hidden", "tags"],
  teacher: ["id", "teacherName", "collegeName", "semester", "coursesCount", "classesCount", "displayName", "note", "hidden", "tags"],
  classroom: ["id", "roomName", "buildingName", "semester", "coursesCount", "occupationRate", "displayName", "note", "hidden", "tags"],
  course: ["id", "courseName", "collegeName", "semester", "teachersCount", "classesCount", "classroomsCount", "displayName", "note", "hidden", "tags"],
  major: ["id", "majorCode", "majorName", "collegeCode", "collegeName", "grade", "semester", "displayName", "note", "hidden", "tags"],
});

function filteredRows(query = {}) {
  const normalized = contracts.normalizeListQuery(query);
  const read = repository.rowsForType(normalized.type);
  let rows = read.rows;
  if (normalized.semester) rows = rows.filter((row) => row.semester === normalized.semester);
  if (normalized.keyword) {
    rows = rows.filter((row) => Object.values(row).some((value) => {
      if (Array.isArray(value)) return value.some((item) => String(item).toLowerCase().includes(normalized.keyword));
      return typeof value === "string" && value.toLowerCase().includes(normalized.keyword);
    }));
  }
  return { normalized, rows, source: read.snapshot.source, generationId: read.generation.generationId };
}

function listResources(query = {}) {
  const { normalized, rows, source, generationId } = filteredRows(query);
  const offset = (normalized.page - 1) * normalized.pageSize;
  return {
    items: rows.slice(offset, offset + normalized.pageSize),
    total: rows.length,
    page: normalized.page,
    pageSize: normalized.pageSize,
    totalPages: rows.length === 0 ? 0 : Math.ceil(rows.length / normalized.pageSize),
    source,
    generationId,
  };
}

function csvCell(value) {
  let text = Array.isArray(value) ? value.join("|") : value === undefined || value === null ? "" : String(value);
  if (/^[\t\r\n]/.test(text) || /^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportRows(query = {}) {
  const type = contracts.requireType(query.type);
  const format = String(query.format || "json").trim().toLowerCase();
  if (!new Set(["json", "csv"]).has(format)) throw contracts.typedError("catalog export format must be json or csv", "INVALID_EXPORT_FORMAT");
  const { rows, source, generationId } = filteredRows({ ...query, type, page: 1, pageSize: 100 });
  if (rows.length > 50000) throw contracts.typedError("catalog export exceeds the safe row limit", "EXPORT_TOO_LARGE", 413);
  const filename = `catalog-${type}${query.semester ? `-${String(query.semester).replace(/[^a-zA-Z0-9._-]/g, "-")}` : ""}.${format}`;
  if (format === "json") {
    return { rows, body: `${JSON.stringify(rows, null, 2)}\n`, contentType: "application/json; charset=utf-8", filename, source, generationId };
  }
  const columns = EXPORT_COLUMNS[type];
  const body = `\uFEFF${columns.map(csvCell).join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
  return { rows, body, columns, contentType: "text/csv; charset=utf-8", filename, source, generationId };
}

function getRelationships() {
  return repository.getRelationships();
}

function previewImport(document) {
  return importService.previewImport(document);
}

function applyImport(previewId, options) {
  return importService.applyImport(previewId, options);
}

module.exports = {
  _test: { csvCell },
  CATALOG_META_PATH,
  CATALOG_PREVIEWS_DIR: importService.CATALOG_PREVIEWS_DIR,
  EXPORT_COLUMNS,
  getCatalogTargetPath: repository.targetPathForType,
  applyImport,
  exportRows,
  getCatalogMeta,
  getCatalogMetaDocument,
  getRelationships,
  listResources,
  previewImport,
  prepareCatalogMetaEntryMutation,
  commitPreparedCatalogMetaEntryMutation,
  saveCatalogMetaEntry,
  saveCatalogMetaBulk,
  makeVersion,
};
