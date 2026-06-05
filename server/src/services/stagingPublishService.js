const fs = require("fs");
const path = require("path");

const appConfigService = require("./appConfigService");
const releaseService = require("./releaseService");
const relayService = require("./relayService");
const stagingUploadService = require("./stagingUploadService");
const staticReleaseSyncService = require("./staticReleaseSyncService");
const releaseLifecycleService = require("./releaseLifecycleService");
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
  const scopes = data && data.meta && data.meta.includeScopes;
  return Array.isArray(scopes) ? scopes : [];
}

function getStagingClassSchedules(data) {
  return data && (data.classSchedules || data.resources && data.resources.classSchedules) || [];
}

function summarizeStagingData(data) {
  const classSchedules = getStagingClassSchedules(data);
  const resources = data && data.resources || {};
  const adminClassCount = classSchedules.filter((item) => item.displayType === "class-schedule" && !item.isAggregated).length;
  const counts = {
    classScheduleCount: classSchedules.length,
    adminClassCount,
    majorAggregateCount: classSchedules.length - adminClassCount,
    teacherScheduleCount: resources.teacherSchedules && resources.teacherSchedules.length || data && data.teacherSchedules && data.teacherSchedules.length || 0,
    classroomScheduleCount: resources.classroomSchedules && resources.classroomSchedules.length || data && data.classroomSchedules && data.classroomSchedules.length || 0,
    courseScheduleCount: resources.courseSchedules && resources.courseSchedules.length || data && data.courseSchedules && data.courseSchedules.length || 0,
    classroomCount: resources.classrooms && resources.classrooms.length || data && data.classrooms && data.classrooms.length || 0,
    teacherCount: resources.teachers && resources.teachers.length || data && data.teachers && data.teachers.length || 0,
    courseCount: resources.courses && resources.courses.length || data && data.courses && data.courses.length || 0,
    collegeCount: data && data.catalog && data.catalog.colleges && data.catalog.colleges.length || data && data.colleges && data.colleges.length || 0,
    gradeCount: data && data.catalog && data.catalog.grades && data.catalog.grades.length || data && data.grades && data.grades.length || 0,
  };
  return { classSchedules, counts };
}

function areStagingCountsAllZero(counts) {
  return Object.values(counts || {}).every((value) => Number(value || 0) === 0);
}

function validateStagingData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    errors.push("Staging data must be a JSON object");
    return { valid: false, errors, warnings };
  }

  ["schemaVersion", "releaseVersion", "term", "termStartDate", "generatedAt"].forEach((field) => {
    if (!data[field]) errors.push(`Missing required field: ${field}`);
  });

  const includeScopes = getStagingIncludeScopes(data);
  const hasClassSchedules = includeScopes.length === 0 || includeScopes.includes("classSchedules");
  const { classSchedules, counts } = summarizeStagingData(data);

  if (hasClassSchedules) {
    if (!Array.isArray(classSchedules) || classSchedules.length === 0) {
      errors.push("Missing classSchedules");
    } else {
      classSchedules.slice(0, 5).forEach((item, index) => {
        if (!item.className) warnings.push(`classSchedules[${index}] missing className`);
      });
    }
  }

  if (areStagingCountsAllZero(counts)) {
    errors.push("Staging counts are all zero");
  }

  ["teacherSchedules", "classroomSchedules", "courseSchedules", "classrooms", "teachers", "courses"].forEach((key) => {
    const list = data[key] || data.resources && data.resources[key];
    if (!Array.isArray(list)) warnings.push(`Missing resource scope: ${key}`);
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function buildStagingSafety(data, activeSnapshot) {
  const includeScopes = getStagingIncludeScopes(data);
  const hasClassSchedules = includeScopes.length === 0 || includeScopes.includes("classSchedules");
  const { counts } = summarizeStagingData(data);
  const validation = validateStagingData(data);
  const blockers = validation.errors.slice();
  const warnings = validation.warnings.slice();
  const activeCounts = activeSnapshot ? releaseService.countRelease(activeSnapshot) : {};
  const activeClassCount = activeCounts.classScheduleCount || (activeSnapshot && activeSnapshot.classSchedules || []).length;
  const currentTerm = appConfigService.getAdminConfig().currentSemester || "";
  const stagingTerm = data.term || data.semester || "";
  const releaseVersion = data.releaseVersion || data.version || "";
  const releaseVersionExists = Boolean(
    releaseVersion &&
    releaseService.listReleases(200).some((item) => item.version === releaseVersion)
  );
  const riskDrops = [];
  let maxDropRate = 0;
  let severeDrop = false;

  [
    { key: "classScheduleCount", label: "class schedules" },
    { key: "teacherScheduleCount", label: "teacher schedules" },
    { key: "classroomScheduleCount", label: "classroom schedules" },
    { key: "courseScheduleCount", label: "course schedules" },
  ].forEach((item) => {
    const activeCount = Number(activeCounts[item.key] || 0);
    const stagingCount = Number(counts[item.key] || 0);
    if (!activeSnapshot || activeCount <= 0 || stagingCount >= activeCount) return;
    const dropRate = (activeCount - stagingCount) / activeCount;
    if (dropRate <= 0.3) return;
    const dropPercent = parseFloat((dropRate * 100).toFixed(2));
    maxDropRate = Math.max(maxDropRate, dropRate);
    if (dropRate > 0.5) severeDrop = true;
    riskDrops.push({
      key: item.key,
      label: item.label,
      activeCount,
      stagingCount,
      dropPercent,
      severity: dropRate > 0.5 ? "danger" : "warning",
    });
    warnings.push(`${item.label}: active ${activeCount} -> staging ${stagingCount}, drop ${dropPercent}%`);
  });

  if (hasClassSchedules && counts.classScheduleCount === 0 && !blockers.includes("Missing classSchedules")) {
    blockers.push("includeScopes contains classSchedules but classSchedules=0");
  }
  if (!data.term) blockers.push("term is empty");
  if (!data.releaseVersion) blockers.push("releaseVersion is empty");
  if (areStagingCountsAllZero(counts)) blockers.push("counts are all zero");
  if (currentTerm && stagingTerm && currentTerm !== stagingTerm) {
    warnings.push(`Staging term ${stagingTerm} differs from configured term ${currentTerm}`);
  }
  if (releaseVersionExists) {
    warnings.push(`releaseVersion ${releaseVersion} already exists`);
  }

  return {
    allowPublish: blockers.length === 0,
    requiresForceConfirm: severeDrop || releaseVersionExists,
    blockers,
    warnings,
    counts,
    activeCounts,
    riskDrops,
    activeClassScheduleCount: activeClassCount,
    classScheduleDropRate: parseFloat(Math.max(0, maxDropRate * 100).toFixed(2)),
    currentTerm,
    stagingTerm,
    releaseVersionExists,
  };
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
  const staticSync = await staticReleaseSyncService.syncIfEnabled(releaseVersion);

  if (job) job.progress(82, "activating release", {
    releaseVersion,
    staticSyncStatus: staticSync.status,
  });
  const activated = releaseService.activateReleaseVersion(releaseVersion);
  return Object.assign({}, written, activated, { staticSync, deepStatus });
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
    throwPublishError("STAGING_SAFETY_BLOCKED", "Staging data failed publish safety checks.", {
      blockers: safety.blockers,
      warnings: safety.warnings,
    });
  }

  if (safety.requiresForceConfirm && !forcePublish) {
    throwPublishError("CLASS_COUNT_DROP_BLOCKED", "Class/resource counts dropped too much. Force confirmation is required.", {
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
      throwPublishError("BIG_CHANGE_BLOCKED", `Staging class change rate is ${(changeRate * 100).toFixed(2)}%. Force confirmation is required.`);
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

  const publishResult = await writeReleasePackAndActivate(stagingData, job);
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
