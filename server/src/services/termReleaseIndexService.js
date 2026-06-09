const fs = require("fs");
const path = require("path");

const termRegistryService = require("./termRegistryService");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const RELEASES_DIR = path.join(STORAGE_DIR, "releases");
const TERM_INDEX_PATH = path.join(RELEASES_DIR, "term-index.json");

let cache = null;
let cacheMtimeMs = 0;

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed == null ? fallback : parsed;
  } catch (error) {
    safeLog("term-release-index-read-json-failed", { filePath, error: error.message });
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (cleanupError) {}
  }
}

function normalizeIndex(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const terms = source.terms && typeof source.terms === "object" ? source.terms : {};
  const normalizedTerms = {};
  Object.keys(terms).forEach((term) => {
    const validation = termRegistryService.validateTermId(term);
    if (!validation.valid) return;
    const item = terms[term] || {};
    normalizedTerms[term] = {
      activeReleaseVersion: String(item.activeReleaseVersion || "").trim(),
      previousReleaseVersion: String(item.previousReleaseVersion || "").trim(),
      updatedAt: String(item.updatedAt || nowIso()),
    };
  });
  const activeTerm = source.activeTerm && termRegistryService.validateTermId(source.activeTerm).valid
    ? source.activeTerm
    : "";
  return {
    schemaVersion: 1,
    activeTerm,
    updatedAt: String(source.updatedAt || nowIso()),
    terms: normalizedTerms,
  };
}

function readIndex() {
  ensureDir(RELEASES_DIR);
  try {
    if (fs.existsSync(TERM_INDEX_PATH)) {
      const stat = fs.statSync(TERM_INDEX_PATH);
      if (cache && cacheMtimeMs === stat.mtimeMs) return cache;
      cache = normalizeIndex(readJsonFile(TERM_INDEX_PATH, {}));
      cacheMtimeMs = stat.mtimeMs;
      return cache;
    }
  } catch (error) {
    safeLog("term-release-index-read-failed", { error: error.message });
  }

  const registry = termRegistryService.readRegistry();
  const active = registry && registry.terms.find((item) => item.status === "current");
  const initial = normalizeIndex({
    activeTerm: active && active.term || "",
    terms: Object.fromEntries((registry && registry.terms || []).map((item) => [item.term, {
      activeReleaseVersion: item.releaseVersion || "",
      previousReleaseVersion: "",
      updatedAt: item.updatedAt || nowIso(),
    }])),
  });
  writeIndex(initial);
  return initial;
}

function writeIndex(index) {
  const normalized = normalizeIndex(Object.assign({}, index, { updatedAt: nowIso() }));
  writeJsonAtomic(TERM_INDEX_PATH, normalized);
  cache = normalized;
  cacheMtimeMs = fs.existsSync(TERM_INDEX_PATH) ? fs.statSync(TERM_INDEX_PATH).mtimeMs : 0;
  return normalized;
}

function getTermRelease(term) {
  const id = termRegistryService.validateTermId(term).valid ? term : "";
  if (!id) return null;
  const index = readIndex();
  return index.terms[id] || null;
}

function getActiveReleaseVersionForTerm(term) {
  const item = getTermRelease(term);
  return item && item.activeReleaseVersion || "";
}

function bindRelease(term, releaseVersion, options = {}) {
  const validation = termRegistryService.validateTermId(term);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.code = validation.error;
    throw error;
  }
  const version = String(releaseVersion || "").trim();
  if (!version) {
    const error = new Error("RELEASE_VERSION_REQUIRED");
    error.code = "RELEASE_VERSION_REQUIRED";
    throw error;
  }
  const index = readIndex();
  const previous = index.terms[validation.term] || {};
  index.terms[validation.term] = {
    activeReleaseVersion: version,
    previousReleaseVersion: options.previousReleaseVersion !== undefined
      ? String(options.previousReleaseVersion || "")
      : String(previous.activeReleaseVersion || previous.previousReleaseVersion || ""),
    updatedAt: nowIso(),
  };
  if (options.activeTerm === true) {
    index.activeTerm = validation.term;
  }
  return writeIndex(index);
}

function activateTerm(term, releaseVersion) {
  return bindRelease(term, releaseVersion, { activeTerm: true });
}

function listPinnedReleases() {
  const index = readIndex();
  const pinned = new Set();
  Object.values(index.terms || {}).forEach((item) => {
    if (item.activeReleaseVersion) pinned.add(item.activeReleaseVersion);
    if (item.previousReleaseVersion) pinned.add(item.previousReleaseVersion);
  });
  return Array.from(pinned);
}

function getTermReleaseSummary() {
  const index = readIndex();
  return Object.entries(index.terms || {}).map(([term, item]) => ({
    term,
    activeReleaseVersion: item.activeReleaseVersion || "",
    previousReleaseVersion: item.previousReleaseVersion || "",
    updatedAt: item.updatedAt || "",
    active: index.activeTerm === term,
  })).sort((left, right) => String(right.term).localeCompare(String(left.term)));
}

module.exports = {
  TERM_INDEX_PATH,
  activateTerm,
  bindRelease,
  getActiveReleaseVersionForTerm,
  getTermRelease,
  getTermReleaseSummary,
  listPinnedReleases,
  readIndex,
  writeIndex,
};
