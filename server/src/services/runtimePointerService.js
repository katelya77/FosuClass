const fs = require("fs");
const path = require("path");

const termRegistryService = require("./termRegistryService");
const { SmallJsonCache, ensureDir, statJsonFile, writeJsonAtomic } = require("../utils/jsonFileStore");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const PUBLIC_DIR = path.join(STORAGE_DIR, "public");
const RUNTIME_DIR = path.join(PUBLIC_DIR, "runtime");
const ACTIVE_RUNTIME_PATH = path.join(RUNTIME_DIR, "active.json");

const cache = new SmallJsonCache({ maxEntries: 20 });

function nowIso() {
  return new Date().toISOString();
}

function getReleaseService() {
  // Lazy require avoids making releaseService <-> runtimePointerService initialization order brittle.
  return require("./releaseService");
}

function getTermReleaseIndexService() {
  return require("./termReleaseIndexService");
}

function pickUrl(value, fallback) {
  return String(value || fallback || "").trim();
}

function buildUrls(manifest) {
  const releaseVersion = manifest && (manifest.releaseVersion || manifest.version) || "";
  const staticReleaseUrl = manifest && manifest.staticReleaseUrl || (releaseVersion ? `/static/releases/${releaseVersion}` : "");
  const indexUrls = manifest && manifest.indexUrls || {};
  return {
    staticRelease: staticReleaseUrl,
    manifest: pickUrl(manifest && manifest.manifestUrl, staticReleaseUrl ? `${staticReleaseUrl}/manifest.json` : ""),
    bootstrap: pickUrl(manifest && (manifest.bootstrapUrl || manifest.catalogUrl), staticReleaseUrl ? `${staticReleaseUrl}/bootstrap.json` : ""),
    catalog: pickUrl(manifest && (manifest.catalogUrl || manifest.bootstrapUrl), staticReleaseUrl ? `${staticReleaseUrl}/bootstrap.json` : ""),
    schoolCatalog: pickUrl(manifest && (manifest.schoolCatalogUrl || manifest.catalogUrl || manifest.bootstrapUrl), staticReleaseUrl ? `${staticReleaseUrl}/bootstrap.json` : ""),
    calendar: pickUrl(manifest && manifest.calendarUrl, staticReleaseUrl ? `${staticReleaseUrl}/calendar.json` : ""),
    classIndex: pickUrl(indexUrls.class, staticReleaseUrl ? `${staticReleaseUrl}/index/class/all.json` : ""),
    teacherIndex: pickUrl(indexUrls.teacher, staticReleaseUrl ? `${staticReleaseUrl}/index/teacher/all.json` : ""),
    classroomIndex: pickUrl(indexUrls.classroom, staticReleaseUrl ? `${staticReleaseUrl}/index/classroom/all.json` : ""),
    courseIndex: pickUrl(indexUrls.course, staticReleaseUrl ? `${staticReleaseUrl}/index/course/all.json` : ""),
    emptyRoom: pickUrl(manifest && manifest.emptyRoomUrl, staticReleaseUrl ? `${staticReleaseUrl}/empty-room/index.json` : ""),
    detailPattern: pickUrl(manifest && manifest.detailUrlPattern, staticReleaseUrl ? `${staticReleaseUrl}/detail/{type}/{id}.json` : ""),
  };
}

function normalizePointer(source) {
  const pointer = source && typeof source === "object" ? source : {};
  const activeTerm = String(pointer.activeTerm || pointer.term || pointer.termConfig && pointer.termConfig.term || "").trim();
  const releaseVersion = String(pointer.releaseVersion || pointer.version || pointer.termConfig && pointer.termConfig.releaseVersion || "").trim();
  if (!activeTerm || !releaseVersion) return null;
  const urls = pointer.urls || pointer.staticUrls || {};
  const termConfig = pointer.termConfig || null;
  const semesterText = pointer.semesterText || termConfig && termConfig.semesterText || "";
  return {
    success: pointer.success !== false,
    schemaVersion: 1,
    activeTerm,
    term: activeTerm,
    semester: pointer.semester || activeTerm,
    semesterText,
    releaseVersion,
    updatedAt: pointer.updatedAt || nowIso(),
    cacheEpoch: Number(pointer.cacheEpoch || 0) || 0,
    forceRefreshToken: pointer.forceRefreshToken || "",
    termConfig,
    urls,
    staticUrls: pointer.staticUrls || urls,
    manifestUrl: pointer.manifestUrl || urls.manifest || "",
    calendarUrl: pointer.calendarUrl || urls.calendar || "",
    bootstrapUrl: pointer.bootstrapUrl || urls.bootstrap || urls.catalog || "",
    catalogUrl: pointer.catalogUrl || urls.catalog || urls.bootstrap || "",
    classCatalogUrl: pointer.classCatalogUrl || urls.classIndex || "",
    schoolCatalogUrl: pointer.schoolCatalogUrl || urls.schoolCatalog || urls.catalog || "",
    source: pointer.source || "static-runtime-active",
  };
}

function hasCompletePointerPayload(pointer) {
  if (!pointer) return false;
  const termConfig = pointer.termConfig || {};
  const urls = pointer.urls || pointer.staticUrls || {};
  return Boolean(
    pointer.cacheEpoch &&
    termConfig.termStartDate &&
    (termConfig.semesterText || pointer.semesterText) &&
    (pointer.calendarUrl || urls.calendar) &&
    (pointer.bootstrapUrl || pointer.catalogUrl || urls.bootstrap || urls.catalog) &&
    (pointer.classCatalogUrl || urls.classIndex) &&
    (pointer.schoolCatalogUrl || urls.schoolCatalog || urls.catalog)
  );
}

function buildPointerFromManifest(manifest) {
  if (!manifest || manifest.success === false) return null;
  const term = manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
  const releaseVersion = manifest.releaseVersion || manifest.version || "";
  if (!term || !releaseVersion) return null;
  const registryRecord = termRegistryService.getTerm(term);
  const rawTermConfig = manifest.termConfig && typeof manifest.termConfig === "object" ? manifest.termConfig : {};
  const termConfig = termRegistryService.normalizeTermRecord({
    term,
    semesterText: rawTermConfig.semesterText || manifest.semesterText || registryRecord && registryRecord.semesterText || "",
    termStartDate: rawTermConfig.termStartDate || manifest.termStartDate || registryRecord && registryRecord.termStartDate || "",
    totalWeeks: rawTermConfig.totalWeeks || manifest.totalWeeks || registryRecord && registryRecord.totalWeeks,
    weekStart: rawTermConfig.weekStart || manifest.weekStart || registryRecord && registryRecord.weekStart || "monday",
    status: "ready",
    releaseVersion,
    dataAvailable: true,
    updatedAt: manifest.updatedAt || manifest.publishedAt || nowIso(),
    source: rawTermConfig.source || manifest.source || "release-manifest",
  }, { allowLegacyCurrentTermFallback: true });
  return normalizePointer({
    activeTerm: term,
    semester: manifest.semester || term,
    semesterText: termConfig.semesterText || manifest.semesterText || "",
    releaseVersion,
    updatedAt: manifest.updatedAt || manifest.publishedAt || nowIso(),
    cacheEpoch: manifest.cacheEpoch || manifest.dataEpoch || Date.parse(manifest.updatedAt || "") || Date.now(),
    forceRefreshToken: manifest.forceRefreshToken || "",
    termConfig,
    urls: buildUrls(manifest),
    staticUrls: buildUrls(manifest),
    source: "release-manifest",
  });
}

function readActivePointer() {
  return normalizePointer(cache.read(ACTIVE_RUNTIME_PATH, null));
}

function getActivePointerStats() {
  return statJsonFile(ACTIVE_RUNTIME_PATH);
}

function shouldRebuildExistingPointer(pointer, options = {}) {
  if (!pointer || options.force) return true;
  if (!hasCompletePointerPayload(pointer)) return true;
  const activeTerm = termRegistryService.getActiveTerm();
  if (activeTerm && activeTerm.term) {
    if (pointer.activeTerm !== activeTerm.term) return true;
    if (activeTerm.releaseVersion && pointer.releaseVersion !== activeTerm.releaseVersion) return true;
  }
  if (options.term && pointer.activeTerm !== options.term) return true;
  if (options.releaseVersion && pointer.releaseVersion !== options.releaseVersion) return true;
  return false;
}

function resolveActiveRuntimeManifest(options = {}) {
  const releaseService = getReleaseService();
  const termReleaseIndexService = getTermReleaseIndexService();
  const activeTerm = termRegistryService.getActiveTerm();
  const activeRelease = releaseService.getActiveReleaseInfo && releaseService.getActiveReleaseInfo() || null;
  const term = String(
    options.term ||
    activeTerm && activeTerm.term ||
    activeRelease && (activeRelease.term || activeRelease.semester) ||
    ""
  ).trim();
  const releaseVersion = String(
    options.releaseVersion ||
    activeTerm && activeTerm.releaseVersion ||
    term && termReleaseIndexService.getActiveReleaseVersionForTerm(term) ||
    activeRelease && (activeRelease.releaseVersion || activeRelease.version) ||
    ""
  ).trim();

  if (!releaseVersion) {
    const error = new Error("ACTIVE_RELEASE_VERSION_MISSING");
    error.code = "ACTIVE_RELEASE_VERSION_MISSING";
    error.term = term;
    throw error;
  }

  const manifest = releaseService.getReleasePackManifest(releaseVersion, term ? { term } : {});
  if (!manifest || manifest.success === false) {
    const error = new Error(manifest && (manifest.code || manifest.reasonCode) || "ACTIVE_RELEASE_MANIFEST_MISSING");
    error.code = manifest && (manifest.code || manifest.reasonCode) || "ACTIVE_RELEASE_MANIFEST_MISSING";
    error.term = term;
    error.releaseVersion = releaseVersion;
    throw error;
  }

  const manifestTerm = manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
  if (term && manifestTerm && manifestTerm !== term) {
    const error = new Error("RUNTIME_POINTER_TERM_MISMATCH");
    error.code = "RUNTIME_POINTER_TERM_MISMATCH";
    error.expectedTerm = term;
    error.actualTerm = manifestTerm;
    error.releaseVersion = releaseVersion;
    throw error;
  }

  return manifest;
}

function ensureActivePointer(options = {}) {
  const existing = readActivePointer();
  if (!shouldRebuildExistingPointer(existing, options)) {
    return existing;
  }
  const manifest = resolveActiveRuntimeManifest(options);
  return writeActivePointerForManifest(manifest, {
    allowInactiveTerm: options.allowInactiveTerm,
  });
}

function writeActivePointerForManifest(manifest, options = {}) {
  if (!manifest || manifest.success === false) {
    const error = new Error("RUNTIME_POINTER_MANIFEST_MISSING");
    error.code = "RUNTIME_POINTER_MANIFEST_MISSING";
    throw error;
  }
  const pointer = buildPointerFromManifest(manifest);
  if (!pointer) {
    const error = new Error("RUNTIME_POINTER_INVALID_MANIFEST");
    error.code = "RUNTIME_POINTER_INVALID_MANIFEST";
    throw error;
  }
  const activeTerm = termRegistryService.getActiveTerm();
  if (activeTerm && activeTerm.term && activeTerm.term !== pointer.activeTerm && !options.allowInactiveTerm) {
    const error = new Error("RUNTIME_POINTER_TERM_NOT_ACTIVE");
    error.code = "RUNTIME_POINTER_TERM_NOT_ACTIVE";
    error.activeTerm = activeTerm.term;
    error.pointerTerm = pointer.activeTerm;
    throw error;
  }
  ensureDir(RUNTIME_DIR);
  writeJsonAtomic(ACTIVE_RUNTIME_PATH, pointer);
  const openrestyRuntimeDir = process.env.OPENRESTY_STATIC_RUNTIME_DIR
    ? path.resolve(process.env.OPENRESTY_STATIC_RUNTIME_DIR)
    : "";
  if (openrestyRuntimeDir) {
    writeJsonAtomic(path.join(openrestyRuntimeDir, "active.json"), pointer);
  }
  cache.invalidate(ACTIVE_RUNTIME_PATH);
  return pointer;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  ACTIVE_RUNTIME_PATH,
  RUNTIME_DIR,
  buildPointerFromManifest,
  clearCache,
  ensureActivePointer,
  getActivePointerStats,
  readActivePointer,
  resolveActiveRuntimeManifest,
  writeActivePointerForManifest,
};
