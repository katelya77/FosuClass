const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const jobService = require("./jobService");
const releaseService = require("./releaseService");
const stagingUploadService = require("./stagingUploadService");
const releaseWorkerManager = require("./releaseWorkerManager");
const termRegistryService = require("./termRegistryService");
const termReleaseIndexService = require("./termReleaseIndexService");
const performanceMonitorService = require("./performanceMonitorService");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
const STATE_PATH = path.join(STORAGE_DIR, "maintenance-status.json");
const AUDIT_PATH = path.join(DATA_DIR, "maintenance-audit.jsonl");

let maintenanceRunning = false;
let statusCache = null;
let statusCacheAt = 0;

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

function appendAudit(action, summary) {
  try {
    ensureDir(DATA_DIR);
    fs.appendFileSync(AUDIT_PATH, `${JSON.stringify({
      time: new Date().toISOString(),
      action,
      summary,
    })}\n`, "utf-8");
  } catch (error) {
    safeLog("maintenance-audit-write-failed", { error: error.message });
  }
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function numEnv(name, fallback, min) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min == null ? value : min, value);
}

function getConfig() {
  return {
    enabled: boolEnv("FOSU_MAINTENANCE_ENABLED", false),
    intervalHours: numEnv("FOSU_MAINTENANCE_INTERVAL_HOURS", 24, 1),
    releaseRetentionCount: numEnv("FOSU_RELEASE_RETENTION_COUNT", 3, 1),
    releaseRetentionDays: numEnv("FOSU_RELEASE_RETENTION_DAYS", 30, 1),
    jobSuccessRetentionDays: numEnv("FOSU_JOB_SUCCESS_RETENTION_DAYS", 14, 1),
    jobFailedRetentionDays: numEnv("FOSU_JOB_FAILED_RETENTION_DAYS", 30, 1),
    stagingFileRetentionDays: numEnv("FOSU_STAGING_FILE_RETENTION_DAYS", 14, 1),
    duplicateUploadRetentionDays: numEnv("FOSU_DUPLICATE_UPLOAD_RETENTION_DAYS", 7, 1),
    failedUploadRetentionDays: numEnv("FOSU_FAILED_UPLOAD_RETENTION_DAYS", 7, 1),
    incompleteUploadRetentionHours: numEnv("FOSU_INCOMPLETE_UPLOAD_RETENTION_HOURS", 24, 1),
    supersededUploadFileRetentionDays: numEnv("FOSU_SUPERSEDED_UPLOAD_FILE_RETENTION_DAYS", 30, 1),
    archiveMetadataRetentionDays: numEnv("FOSU_ARCHIVE_METADATA_RETENTION_DAYS", 90, 1),
    termDeletionRetentionDays: numEnv("FOSU_TERM_DELETION_RETENTION_DAYS", 7, 1),
    tempRetentionHours: numEnv("FOSU_TEMP_RETENTION_HOURS", 24, 1),
    logRetentionDays: numEnv("FOSU_LOG_RETENTION_DAYS", 30, 1),
    logRotateSizeMb: numEnv("FOSU_LOG_ROTATE_SIZE_MB", 10, 1),
    diskWarningPercent: numEnv("FOSU_DISK_WARNING_PERCENT", 80, 1),
    diskCriticalPercent: numEnv("FOSU_DISK_CRITICAL_PERCENT", 90, 1),
    minFreeDiskGb: numEnv("FOSU_MIN_FREE_DISK_GB", 5, 0),
  };
}

function isInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath || "");
  const relative = path.relative(base, target);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRm(targetPath, dryRun) {
  const resolved = path.resolve(targetPath);
  if (!isInside(STORAGE_DIR, resolved) && !isInside(DATA_DIR, resolved)) {
    return { deleted: false, bytes: 0, reason: "outside-managed-roots" };
  }
  const bytes = getPathSize(resolved, { maxFiles: 10000 }).bytes;
  if (!dryRun) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  return { deleted: true, bytes };
}

function getAgeMs(stat) {
  return Date.now() - (stat && stat.mtimeMs || Date.now());
}

function olderThan(stat, ms) {
  return getAgeMs(stat) > ms;
}

function getPathSize(targetPath, options = {}) {
  const maxFiles = Number(options.maxFiles || 5000) || 5000;
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  function walk(current) {
    if (!fs.existsSync(current) || files >= maxFiles) return;
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      files += 1;
      bytes += stat.size;
      return;
    }
    if (!stat.isDirectory()) return;
    dirs += 1;
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      walk(path.join(current, entry.name));
    });
  }
  try {
    walk(targetPath);
  } catch (error) {
    return { files, dirs, bytes, error: error.message };
  }
  return { files, dirs, bytes };
}

function getDiskStatus() {
  try {
    if (typeof fs.statfsSync !== "function") {
      return { supported: false, totalBytes: 0, freeBytes: 0, usedPercent: null };
    }
    const stat = fs.statfsSync(STORAGE_DIR);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const usedPercent = totalBytes > 0 ? Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(2)) : null;
    return { supported: true, totalBytes, freeBytes, usedPercent };
  } catch (error) {
    return { supported: false, totalBytes: 0, freeBytes: 0, usedPercent: null, error: error.message };
  }
}

function getReleaseKeepSet(config) {
  const keep = new Set();
  const active = releaseService.getActiveReleaseInfo();
  if (active && active.version) keep.add(active.version);
  termReleaseIndexService.listPinnedReleases().forEach((version) => keep.add(version));
  termRegistryService.listTerms({ includeDisabled: true }).forEach((term) => {
    if (term.releaseVersion) keep.add(term.releaseVersion);
  });
  releaseService.listReleases(Math.max(10, config.releaseRetentionCount + 2))
    .slice(0, config.releaseRetentionCount + 1)
    .forEach((item) => keep.add(item.version));
  return keep;
}

function listDirEntries(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    return { entry, name: entry.name, path: fullPath, stat: fs.statSync(fullPath) };
  });
}

function getUploadCleanupContext() {
  let active = null;
  try {
    active = releaseService.getActiveReleaseInfoFast && releaseService.getActiveReleaseInfoFast();
  } catch (error) {
    active = null;
  }
  const activeHash = String(active && active.canonicalHash || "").trim().toLowerCase();
  const activeVersion = String(active && (active.version || active.releaseVersion) || "").trim();
  let records = [];
  try {
    records = stagingUploadService.listUploadRecords({ limit: 5000, internal: true }).records || [];
  } catch (error) {
    records = [];
  }
  const byId = new Map();
  const latestPublishedByTerm = new Map();
  records.forEach((record) => {
    if (!record || !record.uploadId) return;
    byId.set(record.uploadId, record);
    const term = String(record.term || record.summary?.term || "").trim();
    const status = String(record.status || record.stagingState || "").toLowerCase();
    const published = status === "published" || Boolean(record.publishedReleaseVersion && !["unchanged", "duplicate", "superseded"].includes(status));
    if (!term || !published) return;
    const current = latestPublishedByTerm.get(term);
    const currentTime = Date.parse(current && (current.updatedAt || current.createdAt) || "") || 0;
    const nextTime = Date.parse(record.updatedAt || record.createdAt || "") || 0;
    if (!current || nextTime >= currentTime) latestPublishedByTerm.set(term, record);
  });
  return { activeHash, activeVersion, byId, latestPublishedByTerm };
}

function isActiveUploadRecord(record, context) {
  if (!record) return false;
  const version = String(record.publishedReleaseVersion || record.publishedVersion || record.releaseVersion || record.summary?.releaseVersion || "").trim();
  const status = String(record.status || record.stagingState || "").toLowerCase();
  return Boolean(record.active || status === "published" && context.activeVersion && version && context.activeVersion === version);
}

function collectUploadMaintenanceCandidates(config) {
  const candidates = [];
  const context = getUploadCleanupContext();
  const duplicateMs = config.duplicateUploadRetentionDays * 86400000;
  const failedMs = config.failedUploadRetentionDays * 86400000;
  const incompleteMs = config.incompleteUploadRetentionHours * 3600000;
  const supersededMs = config.supersededUploadFileRetentionDays * 86400000;
  const managedDirs = [
    { dir: path.join(STORAGE_DIR, "staging-uploads"), source: "cli" },
    { dir: path.join(STORAGE_DIR, "staging-direct-upload"), source: "direct" },
    { dir: path.join(STORAGE_DIR, "resource-upload-staging"), source: "resource" },
    { dir: path.join(STORAGE_DIR, "relay", "uploads"), source: "relay" },
  ];

  managedDirs.forEach(({ dir, source }) => {
    listDirEntries(dir).forEach((item) => {
      const record = context.byId.get(item.name);
      const status = String(record && (record.status || record.stagingState) || "").toLowerCase();
      const term = String(record && (record.term || record.summary?.term) || "").trim();
      const latestPublished = term ? context.latestPublishedByTerm.get(term) : null;
      if (record && isActiveUploadRecord(record, context)) {
        candidates.push({ type: "staging-upload-record", path: item.path, preserveReason: "active-upload", bytes: 0, uploadId: item.name });
        return;
      }
      if (latestPublished && latestPublished.uploadId === item.name) {
        candidates.push({ type: "staging-upload-record", path: item.path, preserveReason: "term-latest-published", bytes: 0, uploadId: item.name });
        return;
      }
      if (["duplicate", "unchanged"].includes(status) && olderThan(item.stat, duplicateMs)) {
        candidates.push({ type: "duplicate-upload", path: item.path, preserveReason: "", bytes: 0, uploadId: item.name, source });
        return;
      }
      if (status === "failed" || status === "validation-failed") {
        if (olderThan(item.stat, failedMs)) candidates.push({ type: "failed-upload", path: item.path, preserveReason: "", bytes: 0, uploadId: item.name, source });
        return;
      }
      if (["initialized", "uploading", "uploaded", "merging", "validating", "unknown"].includes(status || "unknown")) {
        if (olderThan(item.stat, incompleteMs)) candidates.push({ type: "incomplete-upload", path: item.path, preserveReason: "", bytes: 0, uploadId: item.name, source });
        return;
      }
      if (status === "superseded" && olderThan(item.stat, supersededMs)) {
        candidates.push({ type: "superseded-upload-original-file", path: item.path, preserveReason: "", bytes: 0, uploadId: item.name, source });
      }
    });
  });
  return candidates;
}

function collectMaintenanceCandidates(config) {
  const candidates = [];
  const keepReleases = getReleaseKeepSet(config);
  const releaseDaysMs = config.releaseRetentionDays * 86400000;
  const tempMs = config.tempRetentionHours * 3600000;
  const jobSuccessMs = config.jobSuccessRetentionDays * 86400000;
  const jobFailedMs = config.jobFailedRetentionDays * 86400000;
  const stagingMs = config.stagingFileRetentionDays * 86400000;
  const termDeletionMs = config.termDeletionRetentionDays * 86400000;

  listDirEntries(releaseService.RELEASES_DIR).forEach((item) => {
    if (!item.entry.isDirectory()) return;
    if (item.name.includes(".building-") && olderThan(item.stat, 6 * 3600000)) {
      candidates.push({ type: "stale-building-release", path: item.path, preserveReason: "", bytes: 0 });
      return;
    }
    if (keepReleases.has(item.name)) {
      candidates.push({ type: "release", path: item.path, preserveReason: "active-or-last-known-good", bytes: 0 });
      return;
    }
    if (olderThan(item.stat, releaseDaysMs)) {
      candidates.push({ type: "old-release", path: item.path, preserveReason: "", bytes: 0 });
    }
  });

  const publicKeep = new Set(keepReleases);
  listDirEntries(releaseService.PUBLIC_RELEASES_DIR).forEach((item) => {
    if (!item.entry.isDirectory()) return;
    if (item.name.includes(".building-") && olderThan(item.stat, 6 * 3600000)) {
      candidates.push({ type: "stale-building-public-release", path: item.path, preserveReason: "", bytes: 0 });
      return;
    }
    if (!publicKeep.has(item.name) && olderThan(item.stat, releaseDaysMs)) {
      candidates.push({ type: "orphan-public-release", path: item.path, preserveReason: "", bytes: 0 });
    }
  });

  candidates.push(...collectUploadMaintenanceCandidates(config));

  listDirEntries(path.join(STORAGE_DIR, "backups", "term-deletions")).forEach((item) => {
    if (item.entry.isDirectory() && olderThan(item.stat, termDeletionMs)) {
      candidates.push({ type: "expired-term-deletion-backup", path: item.path, preserveReason: "", bytes: 0 });
    }
  });

  listDirEntries(jobService.JOBS_DIR).forEach((item) => {
    if (!item.entry.isFile() || !item.name.endsWith(".json")) return;
    const job = readJsonFile(item.path, {});
    if (job.status === "queued" || job.status === "running") {
      candidates.push({ type: "job", path: item.path, preserveReason: "running-job", bytes: 0 });
      return;
    }
    const ttl = job.status === "failed" ? jobFailedMs : jobSuccessMs;
    if (olderThan(item.stat, ttl)) {
      candidates.push({ type: "old-job", path: item.path, preserveReason: "", bytes: item.stat.size });
    }
  });

  [DATA_DIR, STORAGE_DIR].forEach((dirPath) => {
    listDirEntries(dirPath).forEach((item) => {
      if (item.entry.isFile() && /\.(log|jsonl)$/i.test(item.name) && item.stat.size > config.logRotateSizeMb * 1024 * 1024) {
        candidates.push({ type: "oversized-log", path: item.path, preserveReason: "compress", bytes: item.stat.size });
      }
    });
  });

  return candidates;
}

function runMaintenance(options = {}) {
  if (maintenanceRunning) {
    const error = new Error("storage maintenance is already running");
    error.code = "MAINTENANCE_ALREADY_RUNNING";
    error.statusCode = 409;
    throw error;
  }
  maintenanceRunning = true;
  const started = Date.now();
  const dryRun = options.dryRun !== false;
  const config = getConfig();
  const report = {
    success: true,
    dryRun,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    scannedCandidates: 0,
    deletedFiles: 0,
    deletedDirs: 0,
    reclaimedBytes: 0,
    skippedActive: 0,
    skippedPinned: 0,
    skippedRunningJobs: 0,
    errors: [],
    actions: [],
  };

  try {
    const candidates = collectMaintenanceCandidates(config);
    const uploadRecordCountBefore = stagingUploadService.listUploadRecords({ limit: 5000, internal: true }).recordTotal || 0;
    const removedUploadIds = new Set();
    report.scannedCandidates = candidates.length;
    candidates.forEach((candidate) => {
      if (candidate.preserveReason) {
        if (candidate.preserveReason.includes("active")) report.skippedActive += 1;
        if (candidate.preserveReason.includes("pinned")) report.skippedPinned += 1;
        if (candidate.preserveReason.includes("running-job")) report.skippedRunningJobs += 1;
        report.actions.push(Object.assign({}, candidate, { action: "skip" }));
        return;
      }
      try {
        const result = safeRm(candidate.path, dryRun);
        if (result.deleted) {
          const statWasDir = !path.extname(candidate.path);
          report.reclaimedBytes += result.bytes || candidate.bytes || 0;
          if (statWasDir) report.deletedDirs += 1;
          else report.deletedFiles += 1;
          report.actions.push(Object.assign({}, candidate, { action: dryRun ? "would-delete" : "delete", bytes: result.bytes || candidate.bytes || 0 }));
          if (!dryRun && candidate.uploadId) removedUploadIds.add(String(candidate.uploadId));
        } else {
          report.actions.push(Object.assign({}, candidate, { action: "skip", preserveReason: result.reason }));
        }
      } catch (error) {
        report.errors.push({ path: candidate.path, message: error.message });
      }
    });
    if (!dryRun && removedUploadIds.size) {
      const rebuilt = stagingUploadService.rebuildUploadRecordIndex({
        reason: "storage-maintenance",
        dropUploadIds: Array.from(removedUploadIds),
      });
      report.uploadRecordCompaction = {
        before: uploadRecordCountBefore,
        after: Number(rebuilt && rebuilt.records && rebuilt.records.length || 0),
        removed: Math.max(0, uploadRecordCountBefore - Number(rebuilt && rebuilt.records && rebuilt.records.length || 0)),
      };
    } else {
      report.uploadRecordCompaction = {
        before: uploadRecordCountBefore,
        after: uploadRecordCountBefore,
        removed: 0,
        dryRun,
      };
    }
    report.durationMs = Date.now() - started;
    const state = Object.assign({}, readJsonFile(STATE_PATH, {}), {
      lastRunAt: report.startedAt,
      lastDurationMs: report.durationMs,
      lastDryRun: dryRun,
      lastReport: Object.assign({}, report, { actions: report.actions.slice(0, 100) }),
      nextRunAt: new Date(Date.now() + config.intervalHours * 3600000).toISOString(),
    });
    writeJsonAtomic(STATE_PATH, state);
    appendAudit(dryRun ? "maintenance-preview" : "maintenance-run", {
      reclaimedBytes: report.reclaimedBytes,
      deletedFiles: report.deletedFiles,
      deletedDirs: report.deletedDirs,
      errors: report.errors.length,
    });
    return report;
  } finally {
    maintenanceRunning = false;
  }
}

function gzipAndRotateLog(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  const archivePath = `${filePath}.${new Date().toISOString().slice(0, 10)}.gz`;
  fs.writeFileSync(archivePath, zlib.gzipSync(fs.readFileSync(filePath)));
  fs.truncateSync(filePath, 0);
  return { archivePath, originalBytes: stat.size };
}

function getStorageStatus(options = {}) {
  const cacheMs = Number(options.cacheMs || 15000) || 15000;
  if (!options.force && statusCache && Date.now() - statusCacheAt < cacheMs) {
    return statusCache;
  }
  ensureDir(STORAGE_DIR);
  ensureDir(DATA_DIR);
  const config = getConfig();
  const previous = readJsonFile(STATE_PATH, {});
  const disk = getDiskStatus();
  const memory = process.memoryUsage();
  const runningJob = jobService.getRunningJobByLockGroup("release-heavy");
  const performance = performanceMonitorService.getSnapshot();
  const releaseDir = path.join(STORAGE_DIR, "releases");
  const publicReleaseDir = path.join(STORAGE_DIR, "public", "releases");
  const stagingDir = path.join(STORAGE_DIR, "staging-uploads");
  const jobsDir = jobService.JOBS_DIR;
  const sizeSummary = previous.sizeSummary || {};
  const warning = disk.usedPercent != null && disk.usedPercent >= config.diskWarningPercent;
  const critical = (
    disk.usedPercent != null && disk.usedPercent >= config.diskCriticalPercent
  ) || (disk.freeBytes && disk.freeBytes < config.minFreeDiskGb * 1024 * 1024 * 1024);

  statusCache = {
    success: true,
    serverTime: new Date().toISOString(),
    apiUptimeSeconds: Math.floor(process.uptime()),
    apiRssBytes: memory.rss,
    eventLoopDelay: performance.eventLoopDelay,
    eventLoopUtilization: performance.eventLoopUtilization,
    heapUsedBytes: memory.heapUsed,
    externalMemoryBytes: memory.external,
    workerStatus: runningJob ? "running" : "idle",
    runningJob: jobService.publicJob(runningJob),
    loadAverage: os.loadavg ? os.loadavg() : [0, 0, 0],
    disk,
    diskWarning: warning,
    diskCritical: critical,
    releaseBytes: sizeSummary.releaseBytes || null,
    publicReleaseBytes: sizeSummary.publicReleaseBytes || null,
    stagingBytes: sizeSummary.stagingBytes || null,
    jobAndLogBytes: sizeSummary.jobAndLogBytes || null,
    paths: {
      storage: STORAGE_DIR,
      releaseDir,
      publicReleaseDir,
      stagingDir,
      jobsDir,
    },
    lastMaintenanceAt: previous.lastRunAt || null,
    nextMaintenanceAt: previous.nextRunAt || null,
    lastMaintenanceReport: previous.lastReport || null,
    maintenanceRunning,
    config,
  };
  statusCacheAt = Date.now();
  return statusCache;
}

function scanStorageSizes() {
  const started = Date.now();
  const summary = {
    scannedAt: new Date().toISOString(),
    releaseBytes: getPathSize(path.join(STORAGE_DIR, "releases")).bytes,
    publicReleaseBytes: getPathSize(path.join(STORAGE_DIR, "public", "releases")).bytes,
    stagingBytes: getPathSize(path.join(STORAGE_DIR, "staging-uploads")).bytes +
      getPathSize(path.join(STORAGE_DIR, "staging-direct-upload")).bytes +
      getPathSize(path.join(STORAGE_DIR, "resource-upload-staging")).bytes,
    jobAndLogBytes: getPathSize(jobService.JOBS_DIR).bytes + getPathSize(DATA_DIR, { maxFiles: 5000 }).bytes,
    durationMs: Date.now() - started,
  };
  const previous = readJsonFile(STATE_PATH, {});
  writeJsonAtomic(STATE_PATH, Object.assign({}, previous, { sizeSummary: summary }));
  statusCache = null;
  return summary;
}

function assertReleaseCanStart(options = {}) {
  const status = getStorageStatus({ force: true });
  if (status.diskCritical && options.allowCritical !== true) {
    const error = new Error("Disk usage is critical; release-heavy jobs are blocked until storage maintenance runs.");
    error.code = "DISK_CRITICAL";
    error.statusCode = 507;
    error.status = status;
    throw error;
  }
  return status;
}

function scheduleMaintenance() {
  const config = getConfig();
  if (!config.enabled) return null;
  const run = () => {
    try {
      releaseWorkerManager.startReleaseJob("storage-maintenance", {
        dryRun: false,
        reason: "scheduled",
      });
    } catch (error) {
      safeLog("scheduled-maintenance-failed", { error: error.message });
    }
  };
  const initialDelay = Math.min(10 * 60 * 1000, Math.max(30000, Number(process.env.FOSU_MAINTENANCE_START_DELAY_MS || 60000)));
  const timer = setTimeout(run, initialDelay);
  const interval = setInterval(run, config.intervalHours * 3600000);
  if (timer.unref) timer.unref();
  if (interval.unref) interval.unref();
  return { timer, interval };
}

module.exports = {
  AUDIT_PATH,
  STATE_PATH,
  assertReleaseCanStart,
  collectMaintenanceCandidates,
  getConfig,
  getDiskStatus,
  getStorageStatus,
  gzipAndRotateLog,
  runMaintenance,
  scanStorageSizes,
  scheduleMaintenance,
};
