const fs = require("fs");
const path = require("path");

const releaseService = require("./releaseService");
const runtimePointerService = require("./runtimePointerService");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const DEFAULT_RELEASE_SRC = path.join(STORAGE_DIR, "public", "releases");
const DEFAULT_RUNTIME_SRC = path.join(STORAGE_DIR, "public", "runtime");
const DEFAULT_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ||
  process.env.FOSU_STATIC_RELEASE_BASE_URL ||
  "https://class.katelya.eu.org/static/releases";
const DEFAULT_RUNTIME_PUBLIC_URL = "https://class.katelya.eu.org/static/runtime";
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
  const runtimeSrc = path.resolve(env.RUNTIME_POINTER_SRC || DEFAULT_RUNTIME_SRC);
  const dst = env.OPENRESTY_STATIC_RELEASE_DIR
    ? path.resolve(env.OPENRESTY_STATIC_RELEASE_DIR)
    : "";
  const runtimeDst = env.OPENRESTY_STATIC_RUNTIME_DIR
    ? path.resolve(env.OPENRESTY_STATIC_RUNTIME_DIR)
    : "";
  const publicBaseUrl = env.PUBLIC_BASE_URL || env.FOSU_STATIC_RELEASE_BASE_URL || DEFAULT_PUBLIC_BASE_URL;
  const runtimePublicBaseUrl = env.FOSU_STATIC_RUNTIME_BASE_URL ||
    env.PUBLIC_RUNTIME_BASE_URL ||
    publicBaseUrl.replace(/\/releases\/?$/i, "/runtime") ||
    DEFAULT_RUNTIME_PUBLIC_URL;
  const keepLatestN = Math.max(3, Number(env.STATIC_RELEASE_KEEP_LATEST || 3) || 3);
  const lockPath = path.resolve(env.STATIC_RELEASE_SYNC_LOCK || path.join(dst || src, ".static-release-sync.lock"));
  const httpTimeoutMs = Math.max(1000, Number(env.STATIC_RELEASE_SYNC_HTTP_TIMEOUT_MS || 8000) || 8000);
  const verifyConcurrency = Math.max(1, Math.min(2, Number(env.STATIC_RELEASE_VERIFY_CONCURRENCY || 2) || 2));
  return {
    enabled: truthy(env.STATIC_RELEASE_SYNC_ENABLED),
    src,
    runtimeSrc,
    dst,
    runtimeDst,
    publicBaseUrl,
    runtimePublicBaseUrl,
    keepLatestN,
    lockPath,
    statusPath: path.resolve(env.STATIC_RELEASE_SYNC_STATUS_PATH || STATUS_PATH),
    verifyHttp: env.STATIC_RELEASE_SYNC_VERIFY_HTTP !== "false",
    httpTimeoutMs,
    verifyConcurrency,
  };
}

function progressJob(job, progress, phase, data) {
  if (!job || typeof job.progress !== "function") return;
  job.progress(progress, phase, Object.assign({ phase }, data || {}));
}

function isVerifiedHttpStatus(status) {
  const code = Number(status);
  return code === 200 || code === 206;
}

function isHeadUnsupportedStatus(status) {
  const code = Number(status);
  return code === 403 || code === 405 || code === 501;
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

function countFilesAndBytes(dirPath) {
  const summary = { totalFiles: 0, totalBytes: 0 };
  function walk(current) {
    if (!fs.existsSync(current)) return;
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      summary.totalFiles += 1;
      summary.totalBytes += stat.size;
      return;
    }
    if (!stat.isDirectory()) return;
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      walk(path.join(current, entry.name));
    });
  }
  walk(dirPath);
  return summary;
}

function mirrorDirectory(srcDir, dstDir, options = {}) {
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
  const stats = options.stats || { processedFiles: 0, copiedFiles: 0, copiedBytes: 0 };
  fs.readdirSync(srcDir, { withFileTypes: true }).forEach((entry) => {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      const child = mirrorDirectory(srcPath, dstPath, Object.assign({}, options, { stats }));
      copiedFiles += child.copiedFiles;
      copiedBytes += child.copiedBytes || 0;
      return;
    }
    if (entry.isFile()) {
      stats.processedFiles += 1;
      if (copyFileIfChanged(srcPath, dstPath)) {
        copiedFiles += 1;
        const bytes = fs.statSync(srcPath).size;
        copiedBytes += bytes;
        stats.copiedFiles += 1;
        stats.copiedBytes += bytes;
      }
      if (typeof options.onFile === "function" && (stats.processedFiles === 1 || stats.processedFiles % 100 === 0)) {
        options.onFile(Object.assign({}, stats));
      }
    }
  });
  return { copiedFiles, copiedBytes, processedFiles: stats.processedFiles };
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

function syncRuntimePointerFile(config, releaseVersion) {
  if (!config.runtimeDst) {
    const error = new Error("OPENRESTY_STATIC_RUNTIME_DIR is required for static runtime sync");
    error.code = "STATIC_RUNTIME_TARGET_MISSING";
    throw error;
  }
  const runtimeSrcRoot = assertSafeDirectory("RUNTIME_POINTER_SRC", config.runtimeSrc);
  const runtimeDstRoot = assertSafeDirectory("OPENRESTY_STATIC_RUNTIME_DIR", config.runtimeDst);
  let pointer = runtimePointerService.readActivePointer();
  if (!pointer || pointer.releaseVersion !== releaseVersion) {
    try {
      pointer = runtimePointerService.ensureActivePointer({ releaseVersion, allowInactiveTerm: true });
    } catch (error) {
      safeLog("static-runtime-pointer-ensure-failed", {
        releaseVersion,
        code: error.code || "",
        message: error.message,
      });
    }
  }
  const srcFile = path.join(runtimeSrcRoot, "active.json");
  const dstFile = path.join(runtimeDstRoot, "active.json");
  if (!assertInside(runtimeSrcRoot, srcFile) || !assertInside(runtimeDstRoot, dstFile)) {
    const error = new Error("Invalid runtime pointer sync path");
    error.code = "STATIC_RUNTIME_INVALID_PATH";
    throw error;
  }
  if (!fs.existsSync(srcFile)) {
    const error = new Error(`Runtime active pointer source does not exist: ${srcFile}`);
    error.code = "STATIC_RUNTIME_SOURCE_MISSING";
    throw error;
  }
  const copied = copyFileIfChanged(srcFile, dstFile);
  const stat = fs.statSync(dstFile);
  return {
    runtimeSrcFile: srcFile,
    runtimeDstFile: dstFile,
    runtimeCopied: copied,
    runtimeBytes: stat.size,
    runtimeReleaseVersion: pointer && pointer.releaseVersion || releaseVersion,
  };
}

async function fetchUrlMetadata(url, method, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    const result = {
      url,
      method,
      ok: isVerifiedHttpStatus(response.status),
      status: response.status,
      latencyMs: Date.now() - startedAt,
      contentType: response.headers.get("content-type") || "",
      cacheControl: response.headers.get("cache-control") || "",
      contentEncoding: response.headers.get("content-encoding") || "",
      etag: response.headers.get("etag") || "",
      lastModified: response.headers.get("last-modified") || "",
    };
    if (response.body && typeof response.body.cancel === "function") {
      try { await response.body.cancel(); } catch (error) {}
    }
    return result;
  } catch (error) {
    return {
      url,
      method,
      ok: false,
      status: "error",
      latencyMs: Date.now() - startedAt,
      code: error.name === "AbortError" ? "STATIC_SYNC_URL_TIMEOUT" : (error.code || "STATIC_SYNC_URL_FETCH_FAILED"),
      message: error.message,
      contentType: "",
      cacheControl: "",
      contentEncoding: "",
      etag: "",
      lastModified: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyHttpUrl(url, timeoutMs) {
  if (!/^https?:\/\//i.test(url)) {
    return { url, ok: true, skipped: true, reason: "non-http-url" };
  }
  const head = await fetchUrlMetadata(url, "HEAD", timeoutMs);
  if (head.ok || !isHeadUnsupportedStatus(head.status)) {
    return head;
  }
  const ranged = await fetchUrlMetadata(url, "GET", timeoutMs, { Range: "bytes=0-0" });
  return Object.assign({}, ranged, {
    fallbackFrom: "HEAD",
    headStatus: head.status,
  });
}

async function verifyPublicUrls(version, publicBaseUrl, options = {}) {
  const urls = REQUIRED_FILES.map((relativePath) => joinUrl(publicBaseUrl, version, relativePath));
  if (options.verifyHttp === false) {
    return urls.map((url) => ({ url, ok: true, skipped: true, reason: "disabled" }));
  }
  const results = new Array(urls.length);
  const timeoutMs = Number(options.timeoutMs || 8000) || 8000;
  const concurrency = Math.max(1, Math.min(2, Number(options.concurrency || 2) || 2));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await verifyHttpUrl(urls[index], timeoutMs);
    }
  }));
  const failed = results.filter((item) => !item.ok);
  if (failed.length) {
    const error = new Error(`Static release URL verification failed: ${failed.map((item) => item.url).join(", ")}`);
    error.code = "STATIC_SYNC_URL_VERIFY_FAILED";
    error.results = results;
    throw error;
  }
  return results;
}

async function verifyPublicRuntimeUrl(publicBaseUrl, options = {}) {
  const url = joinUrl(publicBaseUrl, "active.json");
  if (options.verifyHttp === false) {
    return { url, ok: true, skipped: true, reason: "disabled" };
  }
  const result = await verifyHttpUrl(url, Number(options.timeoutMs || 8000) || 8000);
  if (!result.ok) {
    const error = new Error(`Static runtime URL verification failed: ${url}`);
    error.code = "STATIC_RUNTIME_URL_VERIFY_FAILED";
    error.results = [result];
    throw error;
  }
  return result;
}

function recordStatus(patch, config = getConfig()) {
  const previous = readJsonFile(config.statusPath, {});
  const next = Object.assign({}, previous, patch || {}, {
    updatedAt: new Date().toISOString(),
    config: {
      enabled: config.enabled,
      src: config.src,
      dst: config.dst,
      runtimeSrc: config.runtimeSrc,
      runtimeDst: config.runtimeDst,
      publicBaseUrl: config.publicBaseUrl,
      runtimePublicBaseUrl: config.runtimePublicBaseUrl,
      keepLatestN: config.keepLatestN,
      verifyHttp: config.verifyHttp,
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
  const job = options.job || null;
  progressJob(job, 10, "checking-config", {});
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
  const previousStatus = readJsonFile(config.statusPath, {});
  recordStatus({
    status: "running",
    success: false,
    releaseVersion,
    startedAt,
    lastAttemptAt: startedAt,
    phase: "checking-config",
    message: "Static release sync running",
  }, config);

  try {
    releaseLock = acquireLock(config.lockPath, options);
    progressJob(job, 18, "checking-source", { releaseVersion, srcReleaseDir });
    if (!fs.existsSync(srcReleaseDir) || !fs.statSync(srcReleaseDir).isDirectory()) {
      const error = new Error(`Release pack source does not exist: ${srcReleaseDir}`);
      error.code = "STATIC_SYNC_SOURCE_MISSING";
      throw error;
    }
    const sourceSummary = countFilesAndBytes(srcReleaseDir);
    progressJob(job, 25, "copying-files", {
      releaseVersion,
      totalFiles: sourceSummary.totalFiles,
      totalBytes: sourceSummary.totalBytes,
      processedFiles: 0,
      copiedBytes: 0,
    });
    const mirror = mirrorDirectory(srcReleaseDir, dstReleaseDir, {
      onFile: (stats) => {
        const ratio = sourceSummary.totalFiles > 0 ? stats.processedFiles / sourceSummary.totalFiles : 1;
        progressJob(job, Math.min(58, 25 + Math.floor(ratio * 33)), "copying-files", {
          releaseVersion,
          totalFiles: sourceSummary.totalFiles,
          processedFiles: stats.processedFiles,
          copiedFiles: stats.copiedFiles,
          copiedBytes: stats.copiedBytes,
        });
      },
    });
    progressJob(job, 62, "verifying-local", {
      releaseVersion,
      totalFiles: sourceSummary.totalFiles,
      processedFiles: mirror.processedFiles || sourceSummary.totalFiles,
      copiedFiles: mirror.copiedFiles,
      copiedBytes: mirror.copiedBytes || 0,
    });
    const localFiles = verifyLocalFiles(dstReleaseDir);
    progressJob(job, 74, "verifying-public-url", { releaseVersion });
    const verifiedUrls = await verifyPublicUrls(releaseVersion, config.publicBaseUrl, {
      verifyHttp: config.verifyHttp,
      timeoutMs: options.timeoutMs || config.httpTimeoutMs,
      concurrency: config.verifyConcurrency,
    });
    progressJob(job, 82, "syncing-runtime-pointer", { releaseVersion });
    const runtimeSync = syncRuntimePointerFile(config, releaseVersion);
    const verifiedRuntimeUrl = await verifyPublicRuntimeUrl(config.runtimePublicBaseUrl, {
      verifyHttp: config.verifyHttp,
      timeoutMs: options.timeoutMs || config.httpTimeoutMs,
    });
    progressJob(job, 86, "pruning-old-releases", { releaseVersion });
    const activeVersion = releaseService.getActiveReleaseInfo()?.version || "";
    const retention = pruneOldReleases(dstRoot, [
      releaseVersion,
      activeVersion,
      previousStatus.syncedReleaseVersion,
      previousStatus.releaseVersion,
    ], config.keepLatestN);
    const finishedAt = new Date().toISOString();
    const result = recordStatus({
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
      verifiedRuntimeUrl,
      runtimeSrcFile: runtimeSync.runtimeSrcFile,
      runtimeDstFile: runtimeSync.runtimeDstFile,
      runtimeCopied: runtimeSync.runtimeCopied,
      runtimeBytes: runtimeSync.runtimeBytes,
      runtimeReleaseVersion: runtimeSync.runtimeReleaseVersion,
      staticManifestUrl: joinUrl(config.publicBaseUrl, releaseVersion, "manifest.json"),
      staticRuntimeActiveUrl: joinUrl(config.runtimePublicBaseUrl, "active.json"),
      staticClassIndexUrl: joinUrl(config.publicBaseUrl, releaseVersion, "index/class/all.json"),
      staticEmptyRoomIndexUrl: joinUrl(config.publicBaseUrl, releaseVersion, "empty-room/index.json"),
      keptReleases: retention.keptReleases,
      prunedReleases: retention.prunedReleases,
      phase: "completed",
      totalFiles: sourceSummary.totalFiles,
      processedFiles: mirror.processedFiles || sourceSummary.totalFiles,
      message: "Static release sync completed",
    }, config);
    progressJob(job, 96, "completed", {
      releaseVersion,
      copiedFiles: mirror.copiedFiles,
      copiedBytes: mirror.copiedBytes || 0,
      retainedReleases: retention.keptReleases,
    });
    return result;
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
      phase: error.code === "STATIC_SYNC_URL_VERIFY_FAILED" ? "verifying-public-url" : "failed",
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

function isUrlVerificationComplete(status, config = getConfig()) {
  if (!config.verifyHttp) return true;
  const verified = Array.isArray(status?.verifiedUrls) ? status.verifiedUrls : Array.isArray(status?.verificationResults) ? status.verificationResults : [];
  return REQUIRED_FILES.every((relativePath) => {
    const found = verified.find((item) => String(item.url || "").includes(`/${trimSlashes(relativePath)}`));
    return Boolean(found && found.ok && isVerifiedHttpStatus(found.status || 200));
  });
}

async function reconcileStaticRelease(version, options = {}) {
  const config = Object.assign({}, getConfig(options.env || process.env), options.config || {});
  const job = options.job || null;
  progressJob(job, 10, "checking-config", {});
  const releaseVersion = getActiveVersion(version || options.version);
  if (!config.enabled) {
    return syncIfEnabled(releaseVersion, Object.assign({}, options, { config }));
  }
  if (!releaseVersion) {
    const error = new Error("No active release available for static reconcile");
    error.code = "STATIC_RECONCILE_NO_ACTIVE_RELEASE";
    throw error;
  }
  if (!config.dst) {
    const error = new Error("OPENRESTY_STATIC_RELEASE_DIR is required for static reconcile");
    error.code = "STATIC_SYNC_TARGET_MISSING";
    throw error;
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const status = getSyncStatus({ version: releaseVersion, config });
  const dstReleaseDir = path.join(config.dst, releaseVersion);
  const localReady = Boolean(status.targetReleaseDirExists && status.localRequiredFilesPresent && status.versionMatched);
  if (localReady && status.success !== false && status.status !== "failed") {
    try {
      progressJob(job, 72, "verifying-public-url", { releaseVersion });
      const verifiedUrls = await verifyPublicUrls(releaseVersion, config.publicBaseUrl, {
        verifyHttp: config.verifyHttp,
        timeoutMs: options.timeoutMs || config.httpTimeoutMs,
        concurrency: config.verifyConcurrency,
      });
      const runtimeSync = syncRuntimePointerFile(config, releaseVersion);
      const verifiedRuntimeUrl = await verifyPublicRuntimeUrl(config.runtimePublicBaseUrl, {
        verifyHttp: config.verifyHttp,
        timeoutMs: options.timeoutMs || config.httpTimeoutMs,
      });
      const finishedAt = new Date().toISOString();
      const result = recordStatus({
        status: "unchanged",
        success: true,
        releaseVersion,
        syncedReleaseVersion: releaseVersion,
        syncedAt: status.syncedAt || status.lastSuccessAt || finishedAt,
        lastSyncTime: status.lastSyncTime || status.lastSuccessAt || finishedAt,
        lastSuccessAt: finishedAt,
        lastAttemptAt: startedAt,
        lastDurationMs: Date.now() - startedMs,
        srcReleaseDir: path.join(config.src, releaseVersion),
        dstReleaseDir,
        copiedFiles: 0,
        filesCopied: 0,
        copiedBytes: 0,
        bytesCopied: 0,
        localFiles: REQUIRED_FILES.map((relativePath) => path.join(dstReleaseDir, relativePath)),
        verifiedUrls,
        verifiedRuntimeUrl,
        runtimeSrcFile: runtimeSync.runtimeSrcFile,
        runtimeDstFile: runtimeSync.runtimeDstFile,
        runtimeCopied: runtimeSync.runtimeCopied,
        runtimeBytes: runtimeSync.runtimeBytes,
        runtimeReleaseVersion: runtimeSync.runtimeReleaseVersion,
        staticManifestUrl: joinUrl(config.publicBaseUrl, releaseVersion, "manifest.json"),
        staticRuntimeActiveUrl: joinUrl(config.runtimePublicBaseUrl, "active.json"),
        staticClassIndexUrl: joinUrl(config.publicBaseUrl, releaseVersion, "index/class/all.json"),
        staticEmptyRoomIndexUrl: joinUrl(config.publicBaseUrl, releaseVersion, "empty-room/index.json"),
        keptReleases: status.keptReleases || status.retainedReleaseVersions || [],
        prunedReleases: [],
        phase: "completed",
        message: "Static release already synced; URL verification passed",
      }, config);
      progressJob(job, 96, "completed", { releaseVersion, copiedFiles: 0, copiedBytes: 0 });
      return result;
    } catch (error) {
      recordStatus({
        status: "failed",
        success: false,
        releaseVersion,
        failedAt: new Date().toISOString(),
        lastAttemptAt: startedAt,
        lastDurationMs: Date.now() - startedMs,
        code: error.code || "STATIC_RECONCILE_FAILED",
        message: error.message,
        phase: "verifying-public-url",
        verificationResults: error.results || [],
      }, config);
      throw error;
    }
  }

  progressJob(job, 18, "checking-source", {
    releaseVersion,
    reason: status.needsSyncReason || "needs-sync",
  });
  return syncStaticRelease(releaseVersion, Object.assign({}, options, { config }));
}

function getSyncStatus(options = {}) {
  const config = Object.assign({}, getConfig(options.env || process.env), options.config || {});
  const status = readJsonFile(config.statusPath, null);
  const activeVersion = getActiveVersion(options.version);
  const publicBaseUrl = config.publicBaseUrl;
  const configured = Boolean(config.dst);
  const targetDirExists = Boolean(config.dst && fs.existsSync(config.dst));
  const runtimeConfigured = Boolean(config.runtimeDst);
  const runtimeDirExists = Boolean(config.runtimeDst && fs.existsSync(config.runtimeDst));
  let targetDirWritable = false;
  if (targetDirExists) {
    try {
      fs.accessSync(config.dst, fs.constants.W_OK);
      targetDirWritable = true;
    } catch (error) {
      targetDirWritable = false;
    }
  }
  let runtimeDirWritable = false;
  if (runtimeDirExists) {
    try {
      fs.accessSync(config.runtimeDst, fs.constants.W_OK);
      runtimeDirWritable = true;
    } catch (error) {
      runtimeDirWritable = false;
    }
  }
  const releaseVersion = status?.releaseVersion || activeVersion || "";
  const syncedReleaseVersion = status?.syncedReleaseVersion || (status?.success ? status?.releaseVersion : "") || "";
  const versionMatched = Boolean(activeVersion && syncedReleaseVersion && activeVersion === syncedReleaseVersion);
  const targetReleaseDir = activeVersion && config.dst ? path.join(config.dst, activeVersion) : "";
  const targetReleaseDirExists = Boolean(targetReleaseDir && fs.existsSync(targetReleaseDir) && fs.statSync(targetReleaseDir).isDirectory());
  const runtimeActivePath = config.runtimeDst ? path.join(config.runtimeDst, "active.json") : "";
  const runtimeActiveExists = Boolean(runtimeActivePath && fs.existsSync(runtimeActivePath));
  const missingRequiredFiles = targetReleaseDirExists
    ? REQUIRED_FILES.filter((relativePath) => !fs.existsSync(path.join(targetReleaseDir, relativePath)))
    : REQUIRED_FILES.slice();
  const localRequiredFilesPresent = Boolean(targetReleaseDirExists && missingRequiredFiles.length === 0);
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
  const runtimeVerified = status?.verifiedRuntimeUrl || {};
  const runtimeUrlStatus = runtimeVerified.url ? {
    status: runtimeVerified.ok ? (runtimeVerified.status || 200) : (runtimeVerified.status || "failed"),
    latencyMs: runtimeVerified.latencyMs == null ? null : runtimeVerified.latencyMs,
    cacheControl: runtimeVerified.cacheControl || "",
    contentEncoding: runtimeVerified.contentEncoding || "",
  } : { status: "not-collected", latencyMs: null, cacheControl: "", contentEncoding: "" };
  const urlVerificationComplete = isUrlVerificationComplete(status, config);
  const urlVerificationFailed = [manifestUrlStatus, classIndexUrlStatus, emptyRoomUrlStatus]
    .some((item) => item.status !== "not-collected" && !isVerifiedHttpStatus(item.status));
  const fullySynced = Boolean(
    config.enabled &&
    configured &&
    runtimeConfigured &&
    targetDirExists &&
    targetDirWritable &&
    runtimeDirExists &&
    runtimeDirWritable &&
    runtimeActiveExists &&
    activeVersion &&
    versionMatched &&
    localRequiredFilesPresent &&
    status?.success !== false &&
    status?.status !== "failed" &&
    urlVerificationComplete
  );
  let needsSync = false;
  let needsSyncReason = "";
  if (!config.enabled) {
    needsSyncReason = "feature-disabled";
  } else if (!configured) {
    needsSync = true;
    needsSyncReason = "target-dir-not-configured";
  } else if (!runtimeConfigured) {
    needsSync = true;
    needsSyncReason = "runtime-dir-not-configured";
  } else if (!targetDirExists) {
    needsSync = true;
    needsSyncReason = "target-dir-missing";
  } else if (!runtimeDirExists) {
    needsSync = true;
    needsSyncReason = "runtime-dir-missing";
  } else if (!targetDirWritable) {
    needsSync = true;
    needsSyncReason = "target-dir-not-writable";
  } else if (!runtimeDirWritable) {
    needsSync = true;
    needsSyncReason = "runtime-dir-not-writable";
  } else if (!activeVersion) {
    needsSyncReason = "no-active-release";
  } else if (!runtimeActiveExists) {
    needsSync = true;
    needsSyncReason = "runtime-active-missing";
  } else if (!targetReleaseDirExists) {
    needsSync = true;
    needsSyncReason = "target-release-missing";
  } else if (!localRequiredFilesPresent) {
    needsSync = true;
    needsSyncReason = "required-files-missing";
  } else if (!versionMatched) {
    needsSync = true;
    needsSyncReason = syncedReleaseVersion ? "version-mismatch" : "not-synced-yet";
  } else if (status?.status === "failed") {
    needsSync = true;
    needsSyncReason = "last-sync-failed";
  } else if (!urlVerificationComplete) {
    needsSync = true;
    needsSyncReason = urlVerificationFailed ? "url-verification-failed" : "url-verification-pending";
  } else {
    needsSyncReason = "already-synced";
  }
  return Object.assign({
    status: config.enabled ? "not-run" : "disabled",
    success: !config.enabled,
    enabled: config.enabled,
    configured,
    runtimeConfigured,
    targetDir: config.dst,
    runtimeTargetDir: config.runtimeDst,
    targetDirExists,
    runtimeDirExists,
    targetDirWritable,
    runtimeDirWritable,
    targetReleaseDir,
    targetReleaseDirExists,
    runtimeActivePath,
    runtimeActiveExists,
    localRequiredFilesPresent,
    missingRequiredFiles,
    activeReleaseVersion: activeVersion,
    releaseVersion,
    syncedReleaseVersion,
    versionMatched,
    fullySynced,
    urlVerificationComplete,
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
    runtimeActiveUrl: joinUrl(config.runtimePublicBaseUrl, "active.json"),
    runtimeActiveStatus: runtimeUrlStatus.status,
    runtimeActiveLatencyMs: runtimeUrlStatus.latencyMs,
    runtimeCacheControl: runtimeUrlStatus.cacheControl,
    cacheControl: manifestUrlStatus.cacheControl || classIndexUrlStatus.cacheControl || emptyRoomUrlStatus.cacheControl || "",
    contentEncoding: manifestUrlStatus.contentEncoding || classIndexUrlStatus.contentEncoding || emptyRoomUrlStatus.contentEncoding || "",
    syncJobId: status?.syncJobId || "",
    needsSync,
    needsSyncReason,
    staticManifestUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "manifest.json") : "",
    staticRuntimeActiveUrl: joinUrl(config.runtimePublicBaseUrl, "active.json"),
    staticClassIndexUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "index/class/all.json") : "",
    staticEmptyRoomIndexUrl: activeVersion ? joinUrl(publicBaseUrl, activeVersion, "empty-room/index.json") : "",
    keptReleases: retainedReleases.map((item) => item.version),
    config: {
      enabled: config.enabled,
      src: config.src,
      dst: config.dst,
      runtimeSrc: config.runtimeSrc,
      runtimeDst: config.runtimeDst,
      publicBaseUrl: config.publicBaseUrl,
      runtimePublicBaseUrl: config.runtimePublicBaseUrl,
      keepLatestN: config.keepLatestN,
      verifyHttp: config.verifyHttp,
      httpTimeoutMs: config.httpTimeoutMs,
      verifyConcurrency: config.verifyConcurrency,
    },
  }, status || {});
}

module.exports = {
  REQUIRED_FILES,
  acquireLock,
  countFilesAndBytes,
  getConfig,
  getSyncStatus,
  joinUrl,
  mirrorDirectory,
  pruneOldReleases,
  reconcileStaticRelease,
  syncIfEnabled,
  syncStaticRelease,
  verifyHttpUrl,
  verifyLocalFiles,
  verifyPublicRuntimeUrl,
  verifyPublicUrls,
};
