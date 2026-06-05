const fs = require("fs");
const path = require("path");

const releaseService = require("./releaseService");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const DEFAULT_RELEASE_SRC = path.join(STORAGE_DIR, "public", "releases");
const DEFAULT_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ||
  process.env.FOSU_STATIC_RELEASE_BASE_URL ||
  "https://class.katelya.eu.org/static/releases";
const STATUS_PATH = path.join(STORAGE_DIR, "static-release-sync-status.json");
const DEFAULT_LOCK_STALE_MS = 15 * 60 * 1000;
const REQUIRED_FILES = [
  "manifest.json",
  "index/class/all.json",
  "empty-room/index.json",
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
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

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function joinUrl(base, ...parts) {
  const root = String(base || "").replace(/\/+$/g, "");
  const suffix = parts.map(trimSlashes).filter(Boolean).join("/");
  return suffix ? `${root}/${suffix}` : root;
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getConfig(env = process.env) {
  const src = path.resolve(env.RELEASE_PACK_SRC || DEFAULT_RELEASE_SRC);
  const dst = env.OPENRESTY_STATIC_RELEASE_DIR
    ? path.resolve(env.OPENRESTY_STATIC_RELEASE_DIR)
    : "";
  const publicBaseUrl = env.PUBLIC_BASE_URL || env.FOSU_STATIC_RELEASE_BASE_URL || DEFAULT_PUBLIC_BASE_URL;
  const keepLatestN = Math.max(3, Number(env.STATIC_RELEASE_KEEP_LATEST || 3) || 3);
  const lockPath = path.resolve(env.STATIC_RELEASE_SYNC_LOCK || path.join(dst || src, ".static-release-sync.lock"));
  return {
    enabled: truthy(env.STATIC_RELEASE_SYNC_ENABLED),
    src,
    dst,
    publicBaseUrl,
    keepLatestN,
    lockPath,
    statusPath: path.resolve(env.STATIC_RELEASE_SYNC_STATUS_PATH || STATUS_PATH),
    verifyHttp: env.STATIC_RELEASE_SYNC_VERIFY_HTTP !== "false",
  };
}

function assertSafeDirectory(label, dirPath) {
  const resolved = path.resolve(dirPath || "");
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new Error(`${label} must not be filesystem root`);
  }
  return resolved;
}

function assertInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(base, target);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function acquireLock(lockPath, options = {}) {
  ensureDir(path.dirname(lockPath));
  const staleMs = Number(options.staleMs || DEFAULT_LOCK_STALE_MS) || DEFAULT_LOCK_STALE_MS;
  const tryOpen = () => fs.openSync(lockPath, "wx");
  let fd;
  try {
    fd = tryOpen();
  } catch (error) {
    if (error && error.code === "EEXIST") {
      const current = readJsonFile(lockPath, {});
      const lockedAt = current.lockedAt ? Date.parse(current.lockedAt) : 0;
      if (lockedAt && Date.now() - lockedAt > staleMs) {
        fs.unlinkSync(lockPath);
        fd = tryOpen();
      } else {
        const lockError = new Error("Static release sync is already running");
        lockError.code = "STATIC_SYNC_LOCKED";
        lockError.lockPath = lockPath;
        throw lockError;
      }
    } else {
      throw error;
    }
  }
  fs.writeFileSync(fd, JSON.stringify({
    pid: process.pid,
    lockedAt: new Date().toISOString(),
  }, null, 2));
  return () => {
    try { fs.closeSync(fd); } catch (error) {}
    try { fs.unlinkSync(lockPath); } catch (error) {}
  };
}

function copyFileIfChanged(srcFile, dstFile) {
  ensureDir(path.dirname(dstFile));
  const srcStat = fs.statSync(srcFile);
  let shouldCopy = true;
  if (fs.existsSync(dstFile)) {
    const dstStat = fs.statSync(dstFile);
    shouldCopy = srcStat.size !== dstStat.size || Math.floor(srcStat.mtimeMs) !== Math.floor(dstStat.mtimeMs);
  }
  if (shouldCopy) {
    fs.copyFileSync(srcFile, dstFile);
    fs.utimesSync(dstFile, srcStat.atime, srcStat.mtime);
  }
  return shouldCopy;
}

function mirrorDirectory(srcDir, dstDir) {
  assertSafeDirectory("source directory", srcDir);
  assertSafeDirectory("target directory", dstDir);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    const error = new Error(`Release pack source does not exist: ${srcDir}`);
    error.code = "STATIC_SYNC_SOURCE_MISSING";
    throw error;
  }
  ensureDir(dstDir);
  const srcEntries = new Set(fs.readdirSync(srcDir));
  fs.readdirSync(dstDir).forEach((name) => {
    if (srcEntries.has(name)) return;
    const target = path.join(dstDir, name);
    if (!assertInside(dstDir, target)) return;
    fs.rmSync(target, { recursive: true, force: true });
  });

  let copiedFiles = 0;
  let copiedBytes = 0;
  fs.readdirSync(srcDir, { withFileTypes: true }).forEach((entry) => {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      const child = mirrorDirectory(srcPath, dstPath);
      copiedFiles += child.copiedFiles;
      copiedBytes += child.copiedBytes || 0;
      return;
    }
    if (entry.isFile()) {
      if (copyFileIfChanged(srcPath, dstPath)) {
        copiedFiles += 1;
        copiedBytes += fs.statSync(srcPath).size;
      }
    }
  });
  return { copiedFiles, copiedBytes };
}

function listReleaseDirs(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      return {
        version: entry.name,
        path: fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((left, right) => Number(right.mtimeMs || 0) - Number(left.mtimeMs || 0));
}

function pruneOldReleases(dstRoot, keepVersions, keepLatestN) {
  const keep = new Set((keepVersions || []).filter(Boolean));
  const releases = listReleaseDirs(dstRoot);
  releases.slice(0, keepLatestN).forEach((item) => keep.add(item.version));
  const pruned = [];
  releases.forEach((item) => {
    if (keep.has(item.version)) return;
    if (!assertInside(dstRoot, item.path)) return;
    fs.rmSync(item.path, { recursive: true, force: true });
    pruned.push(item.version);
  });
  return {
    keptReleases: releases.filter((item) => keep.has(item.version)).map((item) => item.version),
    prunedReleases: pruned,
  };
}

function verifyLocalFiles(dstReleaseDir) {
  const missing = REQUIRED_FILES.filter((relativePath) => !fs.existsSync(path.join(dstReleaseDir, relativePath)));
  if (missing.length) {
    const error = new Error(`Static release sync verification failed: missing ${missing.join(", ")}`);
    error.code = "STATIC_SYNC_VERIFY_MISSING";
    error.missing = missing;
    throw error;
  }
  return REQUIRED_FILES.map((relativePath) => path.join(dstReleaseDir, relativePath));
}

async function verifyHttpUrl(url, timeoutMs) {
  if (!/^https?:\/\//i.test(url)) {
    return { url, ok: true, skipped: true, reason: "non-http-url" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    const ok = response.status >= 200 && response.status < 300;
    return {
      url,
      ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      cacheControl: response.headers.get("cache-control") || "",
      contentEncoding: response.headers.get("content-encoding") || "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyPublicUrls(version, publicBaseUrl, options = {}) {
  const urls = REQUIRED_FILES.map((relativePath) => joinUrl(publicBaseUrl, version, relativePath));
  if (options.verifyHttp === false) {
    return urls.map((url) => ({ url, ok: true, skipped: true, reason: "disabled" }));
  }
  const results = [];
  for (const url of urls) {
    results.push(await verifyHttpUrl(url, Number(options.timeoutMs || 8000) || 8000));
  }
  const failed = results.filter((item) => !item.ok);
  if (failed.length) {
    const error = new Error(`Static release URL verification failed: ${failed.map((item) => item.url).join(", ")}`);
    error.code = "STATIC_SYNC_URL_VERIFY_FAILED";
    error.results = results;
    throw error;
  }
  return results;
}

function recordStatus(patch, config = getConfig()) {
  const previous = readJsonFile(config.statusPath, {});
  const next = Object.assign({}, previous, patch || {}, {
    updatedAt: new Date().toISOString(),
    config: {
      enabled: config.enabled,
      src: config.src,
      dst: config.dst,
      publicBaseUrl: config.publicBaseUrl,
      keepLatestN: config.keepLatestN,
    },
  });
  writeJsonAtomic(config.statusPath, next);
  return next;
}

function getActiveVersion(fallbackVersion) {
  const version = fallbackVersion || releaseService.getActiveReleaseInfo()?.version || "";
  return releaseService.normalizeVersion(version);
}

async function syncStaticRelease(version, options = {}) {
  const config = Object.assign({}, getConfig(options.env || process.env), options.config || {});
  const releaseVersion = getActiveVersion(version || options.version);
  if (!releaseVersion) {
    const error = new Error("No release version available for static sync");
    error.code = "STATIC_SYNC_NO_VERSION";
    throw error;
  }
  if (!config.dst) {
    const error = new Error("OPENRESTY_STATIC_RELEASE_DIR is required for static release sync");
    error.code = "STATIC_SYNC_TARGET_MISSING";
    throw error;
  }

  const srcRoot = assertSafeDirectory("RELEASE_PACK_SRC", config.src);
  const dstRoot = assertSafeDirectory("OPENRESTY_STATIC_RELEASE_DIR", config.dst);
  const srcReleaseDir = path.join(srcRoot, releaseVersion);
  const dstReleaseDir = path.join(dstRoot, releaseVersion);
  if (!assertInside(srcRoot, srcReleaseDir) || !assertInside(dstRoot, dstReleaseDir)) {
    const error = new Error("Invalid release sync path");
    error.code = "STATIC_SYNC_INVALID_PATH";
    throw error;
  }

  let releaseLock = null;
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  recordStatus({
    status: "running",
    success: false,
    releaseVersion,
    startedAt,
    lastAttemptAt: startedAt,
    message: "Static release sync running",
  }, config);

  try {
    releaseLock = acquireLock(config.lockPath, options);
    const mirror = mirrorDirectory(srcReleaseDir, dstReleaseDir);
    const activeVersion = releaseService.getActiveReleaseInfo()?.version || "";
    const retention = pruneOldReleases(dstRoot, [releaseVersion, activeVersion], config.keepLatestN);
    const localFiles = verifyLocalFiles(dstReleaseDir);
    const verifiedUrls = await verifyPublicUrls(releaseVersion, config.publicBaseUrl, {
      verifyHttp: config.verifyHttp,
      timeoutMs: options.timeoutMs || 8000,
    });
    const finishedAt = new Date().toISOString();
    return recordStatus({
      status: "success",
      success: true,
      releaseVersion,
      syncedReleaseVersion: releaseVersion,
      syncedAt: finishedAt,
      lastSyncTime: finishedAt,
      lastSuccessAt: finishedAt,
      lastAttemptAt: startedAt,
      lastDurationMs: Date.now() - startedMs,
      srcReleaseDir,
      dstReleaseDir,
      copiedFiles: mirror.copiedFiles,
      filesCopied: mirror.copiedFiles,
      copiedBytes: mirror.copiedBytes || 0,
      bytesCopied: mirror.copiedBytes || 0,
      localFiles,
      verifiedUrls,
      staticManifestUrl: joinUrl(config.publicBaseUrl, releaseVersion, "manifest.json"),
      staticClassIndexUrl: joinUrl(config.publicBaseUrl, releaseVersion, "index/class/all.json"),
      staticEmptyRoomIndexUrl: joinUrl(config.publicBaseUrl, releaseVersion, "empty-room/index.json"),
      keptReleases: retention.keptReleases,
      prunedReleases: retention.prunedReleases,
      message: "Static release sync completed",
    }, config);
  } catch (error) {
    safeLog("static-release-sync-failed", {
      releaseVersion,
      code: error.code || "",
      message: error.message,
    });
    recordStatus({
      status: "failed",
      success: false,
      releaseVersion,
      failedAt: new Date().toISOString(),
      lastAttemptAt: startedAt,
      lastDurationMs: Date.now() - startedMs,
      code: error.code || "STATIC_SYNC_FAILED",
      message: error.message,
      verificationResults: error.results || [],
    }, config);
    throw error;
  } finally {
    if (releaseLock) releaseLock();
  }
}

async function syncIfEnabled(version, options = {}) {
  const config = Object.assign({}, getConfig(options.env || process.env), options.config || {});
  if (!config.enabled) {
    return recordStatus({
      status: "disabled",
      success: true,
      releaseVersion: getActiveVersion(version || options.version),
      message: "STATIC_RELEASE_SYNC_ENABLED is not true",
    }, config);
  }
  return syncStaticRelease(version, Object.assign({}, options, { config }));
}

function getSyncStatus(options = {}) {
  const config = Object.assign({}, getConfig(options.env || process.env), options.config || {});
  const status = readJsonFile(config.statusPath, null);
  const activeVersion = getActiveVersion(options.version);
  const publicBaseUrl = config.publicBaseUrl;
  const configured = Boolean(config.dst);
  const targetDirExists = Boolean(config.dst && fs.existsSync(config.dst));
  let targetDirWritable = false;
  if (targetDirExists) {
    try {
      fs.accessSync(config.dst, fs.constants.W_OK);
      targetDirWritable = true;
    } catch (error) {
      targetDirWritable = false;
    }
  }
  const releaseVersion = status?.releaseVersion || activeVersion || "";
  const syncedReleaseVersion = status?.syncedReleaseVersion || (status?.success ? status?.releaseVersion : "") || "";
  const versionMatched = Boolean(activeVersion && syncedReleaseVersion && activeVersion === syncedReleaseVersion);
  const releaseDirs = configured ? listReleaseDirs(config.dst).slice(0, config.keepLatestN) : [];
  const retainedReleases = releaseDirs.map((item) => ({
    version: item.version,
    role: item.version === activeVersion ? "active" : "retained",
    mtimeMs: item.mtimeMs,
  }));
  const verified = Array.isArray(status?.verifiedUrls) ? status.verifiedUrls : Array.isArray(status?.verificationResults) ? status.verificationResults : [];
  const urlStatus = (relativePath) => {
    const found = verified.find((item) => String(item.url || "").includes(`/${trimSlashes(relativePath)}`));
    if (!found) return { status: "not-collected", latencyMs: null, cacheControl: "", contentEncoding: "" };
    return {
      status: found.ok ? (found.status || 200) : (found.status || "failed"),
      latencyMs: found.latencyMs == null ? null : found.latencyMs,
      cacheControl: found.cacheControl || "",
      contentEncoding: found.contentEncoding || "",
    };
  };
  const manifestUrlStatus = urlStatus("manifest.json");
  const classIndexUrlStatus = urlStatus("index/class/all.json");
  const emptyRoomUrlStatus = urlStatus("empty-room/index.json");
  let needsSync = false;
  let needsSyncReason = "";
  if (!config.enabled) {
    needsSyncReason = "feature-disabled";
  } else if (!configured) {
    needsSync = true;
    needsSyncReason = "target-dir-not-configured";
  } else if (!targetDirExists) {
    needsSync = true;
    needsSyncReason = "target-dir-missing";
  } else if (!targetDirWritable) {
    needsSync = true;
    needsSyncReason = "target-dir-not-writable";
  } else if (!activeVersion) {
    needsSyncReason = "no-active-release";
  } else if (!versionMatched) {
    needsSync = true;
    needsSyncReason = syncedReleaseVersion ? "version-mismatch" : "not-synced-yet";
  } else if (status?.status === "failed") {
    needsSync = true;
    needsSyncReason = "last-sync-failed";
  } else {
    needsSyncReason = "version-matched";
  }
  return Object.assign({
    status: config.enabled ? "not-run" : "disabled",
    success: !config.enabled,
    enabled: config.enabled,
    configured,
    targetDir: config.dst,
    targetDirExists,
    targetDirWritable,
    activeReleaseVersion: activeVersion,
    releaseVersion,
    syncedReleaseVersion,
    versionMatched,
    lastAttemptAt: status?.lastAttemptAt || status?.startedAt || null,
    lastSuccessAt: status?.lastSuccessAt || status?.lastSyncTime || status?.syncedAt || null,
    lastDurationMs: status?.lastDurationMs || null,
    lastError: status?.message && status?.status === "failed" ? status.message : "",
    filesCopied: status?.filesCopied || status?.copiedFiles || 0,
    bytesCopied: status?.bytesCopied || status?.copiedBytes || 0,
    retainedReleases,
    retainedReleaseVersions: retainedReleases.map((item) => item.version),
    retentionLimit: config.keepLatestN,
    manifestUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "manifest.json") : "",
    manifestStatus: manifestUrlStatus.status,
    manifestLatencyMs: manifestUrlStatus.latencyMs,
    classIndexUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "index/class/all.json") : "",
    classIndexStatus: classIndexUrlStatus.status,
    emptyRoomUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "empty-room/index.json") : "",
    emptyRoomStatus: emptyRoomUrlStatus.status,
    cacheControl: manifestUrlStatus.cacheControl || classIndexUrlStatus.cacheControl || emptyRoomUrlStatus.cacheControl || "",
    contentEncoding: manifestUrlStatus.contentEncoding || classIndexUrlStatus.contentEncoding || emptyRoomUrlStatus.contentEncoding || "",
    syncJobId: status?.syncJobId || "",
    needsSync,
    needsSyncReason,
    staticManifestUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "manifest.json") : "",
    staticClassIndexUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "index/class/all.json") : "",
    staticEmptyRoomIndexUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "empty-room/index.json") : "",
    keptReleases: retainedReleases.map((item) => item.version),
    config: {
      enabled: config.enabled,
      src: config.src,
      dst: config.dst,
      publicBaseUrl: config.publicBaseUrl,
      keepLatestN: config.keepLatestN,
    },
  }, status || {});
}

module.exports = {
  REQUIRED_FILES,
  acquireLock,
  getConfig,
  getSyncStatus,
  joinUrl,
  mirrorDirectory,
  pruneOldReleases,
  syncIfEnabled,
  syncStaticRelease,
  verifyLocalFiles,
  verifyPublicUrls,
};
