const fs = require("fs");
const path = require("path");

const appConfigService = require("./appConfigService");
const releaseService = require("./releaseService");
const termRegistryService = require("./termRegistryService");
const termReleaseIndexService = require("./termReleaseIndexService");
const relayService = require("./relayService");
const stagingUploadService = require("./stagingUploadService");
const staticReleaseSyncService = require("./staticReleaseSyncService");
const releaseLifecycleService = require("./releaseLifecycleService");
const stagingSafetyService = require("./stagingSafetyService");
const stagingFingerprint = require("../utils/stagingFingerprint");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "admin-audit-log.jsonl");
const STAGING_LATEST_PATH = path.join(STORAGE_DIR, "staging-latest.json");

const FILE_MAP = {
  catalog: path.join(STORAGE_DIR, "catalog.json"),
  majors: path.join(STORAGE_DIR, "majors.json"),
  "class-schedules": path.join(STORAGE_DIR, "class-schedules.json"),
  "teacher-schedules": path.join(STORAGE_DIR, "teacher-schedules.json"),
  "classroom-schedules": path.join(STORAGE_DIR, "classroom-schedules.json"),
  "course-schedules": path.join(STORAGE_DIR, "course-schedules.json"),
  "sync-meta": path.join(STORAGE_DIR, "sync-meta.json"),
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return null;
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

function createBackup(type, sourceFile) {
  try {
    if (!fs.existsSync(sourceFile)) return;
    ensureDir(BACKUPS_DIR);
    const now = new Date();
    const pad = (num) => String(num).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const backupName = `${type}-${timestamp}.json`;
    const destPath = path.join(BACKUPS_DIR, backupName);
    fs.copyFileSync(sourceFile, destPath);
  } catch (error) {
    safeLog("create-backup-failed", { type, error: error.message });
  }
}

function backupActiveReleaseSnapshot() {
  const activeInfo = releaseService.getActiveReleaseInfo();
  if (!activeInfo || !activeInfo.version) return false;
  const activeFiles = releaseService.getReleaseFiles(activeInfo.version);
  if (!fs.existsSync(activeFiles.snapshotPath)) return false;
  createBackup("release-snapshot", activeFiles.snapshotPath);
  return true;
}

function writeAuditLog(reqMeta, action, moduleName, target, summary) {
  try {
    ensureDir(DATA_DIR);
    const logItem = {
      time: new Date().toISOString(),
      action,
      module: moduleName,
      target: target || "",
      operator: "admin",
      summary: summary || "",
      ip: reqMeta && reqMeta.ip || "",
    };
    fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(logItem)}\n`, "utf-8");
  } catch (error) {
    safeLog("write-audit-log-failed", { error: error.message });
  }
}

function getSyncMeta() {
  try {
    if (fs.existsSync(FILE_MAP["sync-meta"])) {
      return JSON.parse(fs.readFileSync(FILE_MAP["sync-meta"], "utf-8"));
    }
  } catch (error) {
    safeLog("read-sync-meta-failed", { error: error.message });
  }
  return {};
}

function getSnapshotFingerprint(snapshot) {
  if (!snapshot) return null;
  try {
    return stagingFingerprint.calculateFingerprint(snapshot);
  } catch (error) {
    return null;
  }
}

function getActiveCanonicalHash() {
  const active = releaseService.getActiveReleaseInfo();
  if (active && active.canonicalHash) return active.canonicalHash;
  const activeSnapshot = releaseService.readActiveReleaseSnapshot();
  const fingerprint = getSnapshotFingerprint(activeSnapshot);
  return fingerprint && fingerprint.canonicalHash || "";
}

function getStagingIncludeScopes(data) {
  return stagingSafetyService.getStagingIncludeScopes(data);
}

function getStagingClassSchedules(data) {
  return stagingSafetyService.getStagingClassSchedules(data);
}

function summarizeStagingData(data) {
  return stagingSafetyService.summarizeStagingData(data);
}

function areStagingCountsAllZero(counts) {
  return stagingSafetyService.areStagingCountsAllZero(counts);
}

function validateStagingData(data) {
  return stagingSafetyService.validateStagingData(data);
}

function buildStagingSafety(data, activeSnapshot) {
  return stagingSafetyService.buildStagingSafety(data, activeSnapshot);
}

function throwPublishError(code, message, extra) {
  const error = new Error(message || code || "publish failed");
  error.code = code || "";
  if (extra) Object.assign(error, extra);
  throw error;
}

async function writeReleasePackAndActivate(stagingData, job) {
  if (job) job.progress(18, "loading snapshot");
  const written = await releaseService.writeReleaseSnapshotAsync(stagingData, { job });
  const releaseVersion = written.version || written.releaseVersion;

  if (job) job.progress(66, "deep validating", { releaseVersion });
  const deepStatus = releaseService.getReleasePackStatus(releaseVersion);
  if (!deepStatus.healthy) {
    const error = new Error("Release Pack deep validation failed");
    error.code = "RELEASE_PACK_UNHEALTHY";
    error.status = deepStatus;
    throw error;
  }

  if (job) job.progress(72, "syncing OpenResty", { releaseVersion });
  const staticSync = await staticReleaseSyncService.syncIfEnabled(releaseVersion, { job });

  if (job) job.progress(82, "activating release", {
    releaseVersion,
    staticSyncStatus: staticSync.status,
  });
  const activated = releaseService.activateReleaseVersion(releaseVersion);
  return Object.assign({}, written, activated, { staticSync, deepStatus });
}

async function writeReleasePackAndBindReady(stagingData, job) {
  if (job) job.progress(18, "loading snapshot");
  const written = await releaseService.writeReleaseSnapshotAsync(stagingData, { job });
  const releaseVersion = written.version || written.releaseVersion;
  const term = stagingData.term || stagingData.semester || written.manifest && written.manifest.term || "";

  if (job) job.progress(66, "deep validating", { releaseVersion, term });
  const deepStatus = releaseService.getReleasePackStatus(releaseVersion);
  if (!deepStatus.healthy) {
    const error = new Error("Release Pack deep validation failed");
    error.code = "RELEASE_PACK_UNHEALTHY";
    error.status = deepStatus;
    throw error;
  }

  if (job) job.progress(72, "syncing OpenResty", { releaseVersion, term });
  const staticSync = await staticReleaseSyncService.syncIfEnabled(releaseVersion, { job });

  if (!termRegistryService.getTerm(term)) {
    termRegistryService.createPlannedTerm(Object.assign({}, stagingData.termConfig || {}, {
      term,
      source: "staging-publish",
    }));
  }
  termRegistryService.bindReleaseToTerm(term, releaseVersion, {
    status: "ready",
    source: "staging-publish-ready",
  });
  termReleaseIndexService.bindRelease(term, releaseVersion, { activeTerm: false });
  return Object.assign({}, written, {
    staticSync,
    deepStatus,
    readyOnly: true,
    term,
    releaseVersion,
  });
}

function updateSyncMetaFromStatus(status) {
  const counts = status.counts || {};
  const updatedAt = new Date().toISOString();
  const meta = getSyncMeta();
  meta.snapshot = {
    updatedAt,
    version: status.activeReleaseVersion,
    semester: status.semester,
    itemCount: counts.classScheduleCount || 0,
    syncSource: "local-sync-client",
  };
  meta.catalog = {
    updatedAt,
    itemCount: counts.collegeCount || counts.collegesCount || 0,
    syncSource: "local-sync-client",
  };
  meta.majors = {
    updatedAt,
    itemCount: counts.majorCount || counts.majorsCount || 0,
    syncSource: "local-sync-client",
  };
  meta["class-schedules"] = {
    updatedAt,
    itemCount: counts.classScheduleCount || 0,
    adminClassCount: counts.adminClassCount || 0,
    majorAggregateCount: counts.majorAggregateCount || 0,
    syncSource: "local-sync-client",
  };
  meta["teacher-schedules"] = {
    updatedAt,
    itemCount: counts.teacherScheduleCount || 0,
    syncSource: "local-sync-client",
  };
  meta["classroom-schedules"] = {
    updatedAt,
    itemCount: counts.classroomScheduleCount || 0,
    syncSource: "local-sync-client",
  };
  meta["course-schedules"] = {
    updatedAt,
    itemCount: counts.courseScheduleCount || 0,
    syncSource: "local-sync-client",
  };
  writeJsonAtomic(FILE_MAP["sync-meta"], meta);
  return { meta, updatedAt, counts };
}

function finalizeReleaseActivation(options = {}) {
  const status = releaseService.getReleaseStatus();
  const syncMeta = updateSyncMetaFromStatus(status);
  appConfigService.touchDataVersionForSyncKey("release", {
    updatedAt: syncMeta.updatedAt,
    releaseVersion: options.version || status.activeReleaseVersion,
    semester: status.semester,
    releaseNote: options.releaseNote || "Release activated",
  });
  if (options.auditAction) {
    writeAuditLog(options.auditReq || {}, options.auditAction, "sync-release", options.version || status.activeReleaseVersion, options.auditSummary || "");
  }
  return {
    status,
    updatedAt: syncMeta.updatedAt,
    counts: syncMeta.counts,
  };
}

async function runStagingPublish(input = {}, job) {
  const forcePublish = input.force === true;
  const readyOnly = input.readyOnly === true;
  const releaseNote = input.releaseNote || "";
  const auditReq = {
    ip: input.ip || "",
    headers: input.headers || {},
  };

  if (!fs.existsSync(STAGING_LATEST_PATH)) {
    throwPublishError("STAGING_MISSING", "Staging data does not exist. Upload staging JSON first.");
  }

  if (job) job.progress(12, "loading snapshot");
  const stagingData = JSON.parse(fs.readFileSync(STAGING_LATEST_PATH, "utf-8"));
  const activeSnapshot = releaseService.readActiveReleaseSnapshot();
  const stagingFingerprintInfo = getSnapshotFingerprint(stagingData);
  const activeCanonicalHash = getActiveCanonicalHash();
  if (stagingFingerprintInfo && stagingFingerprintInfo.canonicalHash && activeCanonicalHash && stagingFingerprintInfo.canonicalHash === activeCanonicalHash) {
    const lifecycle = releaseLifecycleService.reconcileLifecycle({
      reason: "publish-skip-active",
      uploadId: stagingData.stagingUploadId || "",
      sourceTaskId: stagingData.relayTaskId || "",
    });
    if (job) job.progress(95, "staging unchanged; skip publish", { canonicalHash: stagingFingerprintInfo.canonicalHash });
    return {
      success: true,
      skipped: true,
      unchanged: true,
      reason: "active-release",
      message: "Data unchanged; publish skipped",
      canonicalHash: stagingFingerprintInfo.canonicalHash,
      releaseVersion: releaseService.getActiveReleaseInfo() && releaseService.getActiveReleaseInfo().version || "",
      quickHealth: activeCanonicalHash ? releaseService.getReleasePackQuickHealth(releaseService.getActiveReleaseInfo() && releaseService.getActiveReleaseInfo().version || "") : null,
      lifecycle,
    };
  }

  if (job) job.progress(20, "normalizing data");
  const safety = buildStagingSafety(stagingData, activeSnapshot);
  if (!safety.allowPublish) {
    throwPublishError("STAGING_SAFETY_BLOCKED", "暂存数据未通过发布安全检查。", {
      blockers: safety.blockers,
      warnings: safety.warnings,
      blockerDetails: safety.blockerDetails,
      blockerCodes: safety.blockerCodes,
      warningDetails: safety.warningDetails,
      safetyReport: safety.safetyReport,
      safety,
    });
  }

  if (safety.requiresForceConfirm && !forcePublish) {
    throwPublishError("CLASS_COUNT_DROP_BLOCKED", "班级或资源统计下降过大，必须人工确认后才允许继续。", {
      safety,
    });
  }

  if (activeSnapshot) {
    const activeClassNames = (activeSnapshot.classSchedules || []).map((item) => item.className).filter(Boolean);
    const activeClassNamesSet = new Set(activeClassNames);
    const stagingClassNamesSet = new Set((stagingData.classSchedules || []).map((item) => item.className).filter(Boolean));
    const deletedClasses = activeClassNames.filter((name) => !stagingClassNamesSet.has(name));
    const addedClasses = (stagingData.classSchedules || [])
      .map((item) => item.className)
      .filter((name) => name && !activeClassNamesSet.has(name));
    const changeRate = (deletedClasses.length + addedClasses.length) / Math.max(activeClassNames.length, 1);
    if (changeRate > 0.5 && !forcePublish) {
      throwPublishError("BIG_CHANGE_BLOCKED", `暂存班级变化率为 ${(changeRate * 100).toFixed(2)}%，必须人工确认后才允许继续。`);
    }
  }

  if (job) job.progress(24, "backup active release");
  const activeInfo = releaseService.getActiveReleaseInfo();
  if (activeInfo && activeInfo.version) {
    const activeFiles = releaseService.getReleaseFiles(activeInfo.version);
    if (fs.existsSync(activeFiles.snapshotPath)) {
      createBackup("release-snapshot", activeFiles.snapshotPath);
    }
  }

  const activeTerm = termRegistryService.getActiveTerm();
  const stagingTerm = stagingData.term || stagingData.semester || "";
  const shouldActivate = Boolean(!readyOnly && activeTerm && activeTerm.term === stagingTerm);
  const publishResult = shouldActivate
    ? await writeReleasePackAndActivate(stagingData, job)
    : await writeReleasePackAndBindReady(stagingData, job);
  if (!shouldActivate) {
    const status = releaseService.getReleaseStatus();
    writeAuditLog(auditReq, "prepare-ready", "sync-release", publishResult.releaseVersion, `Prepared ready release ${publishResult.releaseVersion} for term ${stagingTerm}`);
    if (stagingData.stagingUploadId) {
      stagingUploadService.markUploadPublished(stagingData.stagingUploadId, publishResult.releaseVersion);
    }
    if (stagingData.relayUploadId) {
      relayService.markUploadPublished(stagingData.relayUploadId, publishResult.releaseVersion);
    }
    const lifecycle = releaseLifecycleService.reconcileLifecycle({
      reason: "publish-ready",
      uploadId: stagingData.stagingUploadId || "",
      sourceTaskId: stagingData.relayTaskId || "",
    });
    releaseService.clearDerivedCache();
    const quickHealth = releaseService.getReleasePackQuickHealth(publishResult.releaseVersion);
    if (job) job.progress(90, "ready release prepared", { releaseVersion: publishResult.releaseVersion, term: stagingTerm });
    return {
      success: true,
      message: "Staging release prepared for term; not activated",
      readyOnly: true,
      version: publishResult.releaseVersion,
      releaseVersion: publishResult.releaseVersion,
      term: stagingTerm,
      semester: stagingTerm,
      activeTerm: status.term || status.semester || "",
      counts: publishResult.manifest && publishResult.manifest.counts || {},
      quickHealth,
      deepStatus: publishResult.deepStatus,
      staticSync: publishResult.staticSync,
      lifecycle,
    };
  }
  const status = releaseService.getReleaseStatus();
  const syncMeta = updateSyncMetaFromStatus(status);

  appConfigService.touchDataVersionForSyncKey("release", {
    updatedAt: syncMeta.updatedAt,
    releaseVersion: status.activeReleaseVersion,
    semester: status.semester,
    releaseNote: releaseNote || stagingData.releaseNote || "Published from admin staging",
  });

  writeAuditLog(auditReq, "publish", "sync-release", status.activeReleaseVersion, `Published staging release ${status.activeReleaseVersion}`);
  if (stagingData.stagingUploadId) {
    stagingUploadService.markUploadPublished(stagingData.stagingUploadId, status.activeReleaseVersion);
  }
  if (stagingData.relayUploadId) {
    relayService.markUploadPublished(stagingData.relayUploadId, status.activeReleaseVersion);
  }
  const lifecycle = releaseLifecycleService.reconcileLifecycle({
    reason: "publish-success",
    uploadId: stagingData.stagingUploadId || "",
    sourceTaskId: stagingData.relayTaskId || "",
  });

  if (job) job.progress(90, "verifying static URLs", { releaseVersion: status.activeReleaseVersion });
  releaseService.clearDerivedCache();
  const quickHealth = releaseService.getReleasePackQuickHealth(status.activeReleaseVersion);

  return {
    success: true,
    message: "Staging release published",
    version: status.activeReleaseVersion,
    releaseVersion: status.activeReleaseVersion,
    term: status.semester,
    semester: status.semester,
    counts: syncMeta.counts,
    quickHealth,
    deepStatus: publishResult.deepStatus,
    staticSync: publishResult.staticSync,
    lifecycle,
  };
}

module.exports = {
  STAGING_LATEST_PATH,
  backupActiveReleaseSnapshot,
  buildStagingSafety,
  finalizeReleaseActivation,
  runStagingPublish,
  summarizeStagingData,
  validateStagingData,
};
