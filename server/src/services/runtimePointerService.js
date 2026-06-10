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

function buildUrls(manifest) {
  const releaseVersion = manifest && (manifest.releaseVersion || manifest.version) || "";
  const staticReleaseUrl = manifest && manifest.staticReleaseUrl || (releaseVersion ? `/static/releases/${releaseVersion}` : "");
  return {
    manifest: manifest && (manifest.manifestUrl || (staticReleaseUrl ? `${staticReleaseUrl}/manifest.json` : "")) || "",
    catalog: manifest && (manifest.catalogUrl || (staticReleaseUrl ? `${staticReleaseUrl}/bootstrap.json` : "")) || "",
    calendar: manifest && (manifest.calendarUrl || (staticReleaseUrl ? `${staticReleaseUrl}/calendar.json` : "")) || "",
    classIndex: manifest && manifest.indexUrls && manifest.indexUrls.class || (staticReleaseUrl ? `${staticReleaseUrl}/index/class/all.json` : ""),
  };
}

function normalizePointer(source) {
  const pointer = source && typeof source === "object" ? source : {};
  if (!pointer.activeTerm || !pointer.releaseVersion) return null;
  return {
    success: pointer.success !== false,
    schemaVersion: 1,
    activeTerm: pointer.activeTerm,
    term: pointer.activeTerm,
    releaseVersion: pointer.releaseVersion,
    updatedAt: pointer.updatedAt || nowIso(),
    cacheEpoch: Number(pointer.cacheEpoch || 0) || 0,
    forceRefreshToken: pointer.forceRefreshToken || "",
    termConfig: pointer.termConfig || null,
    urls: pointer.urls || {},
    source: pointer.source || "static-runtime-active",
  };
}

function buildPointerFromManifest(manifest) {
  if (!manifest || manifest.success === false) return null;
  const term = manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
  const releaseVersion = manifest.releaseVersion || manifest.version || "";
  if (!term || !releaseVersion) return null;
  const termConfig = manifest.termConfig || {
    term,
    semesterText: manifest.semesterText || "",
    termStartDate: manifest.termStartDate || "",
    totalWeeks: manifest.totalWeeks || 20,
    weekStart: manifest.weekStart || "monday",
  };
  return normalizePointer({
    activeTerm: term,
    releaseVersion,
    updatedAt: manifest.updatedAt || manifest.publishedAt || nowIso(),
    cacheEpoch: manifest.cacheEpoch || manifest.dataEpoch || Date.parse(manifest.updatedAt || "") || Date.now(),
    forceRefreshToken: manifest.forceRefreshToken || "",
    termConfig,
    urls: buildUrls(manifest),
    source: "release-manifest",
  });
}

function readActivePointer() {
  return normalizePointer(cache.read(ACTIVE_RUNTIME_PATH, null));
}

function getActivePointerStats() {
  return statJsonFile(ACTIVE_RUNTIME_PATH);
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
  getActivePointerStats,
  readActivePointer,
  writeActivePointerForManifest,
};
