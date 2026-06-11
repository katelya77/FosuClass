const fs = require("fs");
const path = require("path");

const { SmallJsonCache, ensureDir, readJsonFile, statJsonFile, writeJsonAtomic } = require("../utils/jsonFileStore");

const SUMMARY_FILE_NAME = "summary.json";
const HEALTH_SUMMARY_FILE_NAME = "health-summary.json";
const cache = new SmallJsonCache({ maxEntries: 200 });

function nowIso() {
  return new Date().toISOString();
}

function readSmallJson(filePath, fallback = null) {
  return cache.read(filePath, fallback);
}

function summaryPathForFiles(files) {
  return files && files.releaseDir ? path.join(files.releaseDir, SUMMARY_FILE_NAME) : "";
}

function healthSummaryPathForFiles(files) {
  return files && files.releaseDir ? path.join(files.releaseDir, HEALTH_SUMMARY_FILE_NAME) : "";
}

function normalizeVersion(value) {
  return String(value || "").trim();
}

function pickUpdatedAt(manifest, stat) {
  return manifest && (manifest.publishedAt || manifest.updatedAt || manifest.generatedAt) ||
    stat && stat.mtime && stat.mtime.toISOString && stat.mtime.toISOString() ||
    "";
}

function buildQuickHealthFromManifest(manifest, fallback = {}) {
  const pack = manifest && manifest.pack || {};
  const health = manifest && manifest.packHealth || {};
  return {
    success: true,
    healthy: manifest ? manifest.validation?.valid !== false : false,
    manifestExists: Boolean(manifest),
    manifestValid: Boolean(manifest && (manifest.releaseVersion || manifest.version)),
    counts: manifest && manifest.counts || fallback.counts || {},
    resourceCounts: manifest && manifest.resourceCounts || fallback.resourceCounts || null,
    detailCounts: pack.detail || fallback.detailCounts || {},
    indexCounts: pack.index || fallback.indexCounts || {},
    emptyRoomHealth: health.emptyRoom || fallback.emptyRoomHealth || {},
    durationMs: 0,
    source: "manifest-summary",
  };
}

function buildSummaryFromManifest(version, manifest, files, options = {}) {
  const stat = files && files.releaseDir && fs.existsSync(files.releaseDir)
    ? fs.statSync(files.releaseDir)
    : null;
  const releaseVersion = normalizeVersion(
    version ||
    manifest && (manifest.releaseVersion || manifest.version)
  );
  const updatedAt = pickUpdatedAt(manifest, stat) || options.updatedAt || "";
  const deepHealth = files ? readSmallJson(healthSummaryPathForFiles(files), null) : null;
  const active = options.active || {};
  const quickHealth = options.quickHealth || buildQuickHealthFromManifest(manifest, options);
  return {
    success: true,
    schemaVersion: 1,
    summaryStatus: manifest ? "from-manifest" : "missing-summary",
    version: releaseVersion,
    releaseVersion,
    term: manifest && (manifest.term || manifest.semester) || active.term || active.semester || "",
    semester: manifest && (manifest.semester || manifest.term) || active.semester || active.term || "",
    termConfig: manifest && manifest.termConfig || active.termConfig || null,
    createdAt: manifest && (manifest.createdAt || manifest.generatedAt) || "",
    generatedAt: manifest && manifest.generatedAt || "",
    updatedAt,
    publishedAt: active.activatedAt || active.publishedAt || manifest && manifest.publishedAt || "",
    activatedAt: active.activatedAt || "",
    active: Boolean(active && active.version === releaseVersion),
    archived: Boolean(manifest && manifest.archived),
    canonicalHash: active.canonicalHash || manifest && manifest.canonicalHash || "",
    counts: manifest && manifest.counts || active.counts || {},
    resourceCounts: manifest && manifest.resourceCounts || active.resourceCounts || null,
    quickHealth,
    releasePack: quickHealth,
    packBytes: Number(manifest && manifest.size && manifest.size.packBytes || 0) || 0,
    snapshotBytes: Number(manifest && manifest.size && manifest.size.snapshotBytes || 0) || 0,
    indexBytes: Number(manifest && manifest.size && manifest.size.indexBytes || 0) || 0,
    detailBytes: Number(manifest && manifest.size && manifest.size.detailBytes || 0) || 0,
    deepHealthLastRunAt: deepHealth && (deepHealth.completedAt || deepHealth.updatedAt || deepHealth.startedAt) || "",
    deepHealthStatus: deepHealth && (deepHealth.status || (deepHealth.healthy ? "healthy" : "failed")) || "not-run",
    deepHealthJobId: deepHealth && deepHealth.jobId || "",
    source: manifest ? "release-manifest" : "release-directory",
  };
}

function readReleaseSummary(version, files, options = {}) {
  const summaryPath = summaryPathForFiles(files);
  const active = options.active || {};
  const stored = summaryPath ? readSmallJson(summaryPath, null) : null;
  if (stored && stored.version) {
    const quickHealth = options.quickHealth || stored.quickHealth || stored.releasePack || null;
    return Object.assign({}, stored, {
      success: true,
      summaryStatus: stored.summaryStatus || "generated",
      active: Boolean(active && active.version === stored.version),
      activatedAt: active.activatedAt || stored.activatedAt || "",
      publishedAt: active.activatedAt || active.publishedAt || stored.publishedAt || "",
      canonicalHash: active.canonicalHash || stored.canonicalHash || "",
      quickHealth: quickHealth || buildQuickHealthFromManifest(null, stored),
      releasePack: quickHealth || stored.releasePack || buildQuickHealthFromManifest(null, stored),
    });
  }
  const manifest = files ? readSmallJson(files.manifestPath, null) || readSmallJson(path.join(files.publicReleaseDir || "", "manifest.json"), null) : null;
  return buildSummaryFromManifest(version, manifest, files, Object.assign({}, options, {
    active,
    quickHealth: options.quickHealth,
  }));
}

function writeReleaseSummary(version, manifest, files, options = {}) {
  if (!files || !files.releaseDir) return null;
  const summary = Object.assign(
    {},
    buildSummaryFromManifest(version, manifest, files, options),
    {
      summaryStatus: "generated",
      generatedSummaryAt: nowIso(),
    }
  );
  const target = summaryPathForFiles(files);
  ensureDir(path.dirname(target));
  writeJsonAtomic(target, summary);
  cache.invalidate(target);
  return summary;
}

function writeDeepHealthSummary(files, status, options = {}) {
  if (!files || !files.releaseDir) return null;
  const target = healthSummaryPathForFiles(files);
  const summary = {
    schemaVersion: 1,
    status: status && status.healthy ? "healthy" : "failed",
    healthy: Boolean(status && status.healthy),
    releaseVersion: status && (status.releaseVersion || status.version) || options.version || "",
    version: status && (status.version || status.releaseVersion) || options.version || "",
    jobId: options.jobId || "",
    startedAt: options.startedAt || "",
    completedAt: nowIso(),
    totalBytes: status && status.totalBytes || 0,
    detailCounts: status && status.detailCounts || {},
    missing: status && status.missing || [],
    hashErrors: status && status.hashErrors || [],
    workerPid: options.workerPid || process.pid,
  };
  ensureDir(path.dirname(target));
  writeJsonAtomic(target, summary);
  cache.invalidate(target);
  return summary;
}

function getSummaryStats(files) {
  const summaryPath = summaryPathForFiles(files);
  return summaryPath ? statJsonFile(summaryPath) : null;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  HEALTH_SUMMARY_FILE_NAME,
  SUMMARY_FILE_NAME,
  buildQuickHealthFromManifest,
  buildSummaryFromManifest,
  clearCache,
  getSummaryStats,
  healthSummaryPathForFiles,
  readReleaseSummary,
  readSmallJson,
  summaryPathForFiles,
  writeDeepHealthSummary,
  writeReleaseSummary,
};
