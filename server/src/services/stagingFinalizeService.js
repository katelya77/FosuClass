const fs = require("fs");
const path = require("path");

const releaseService = require("./releaseService");
const stagingUploadService = require("./stagingUploadService");
const { calculateFingerprint } = require("../utils/stagingFingerprint");
const { buildResourceCountContract, compareResourceCountContracts, flattenLegacyCounts } = require("../shared/resourceCountContract");
const { ensureDir, writeJsonAtomic } = require("../utils/jsonFileStore");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
const STAGING_LATEST_PATH = path.join(STORAGE_DIR, "staging-latest.json");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "admin-audit-log.jsonl");

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return null;
  }
}

function appendAudit(reqMeta, action, moduleName, target, summary) {
  try {
    ensureDir(DATA_DIR);
    fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify({
      time: new Date().toISOString(),
      ip: reqMeta && reqMeta.ip || "",
      action,
      module: moduleName,
      target,
      summary,
    })}\n`, "utf-8");
  } catch (error) {}
}

function getSnapshotFingerprint(snapshot) {
  if (!snapshot) return null;
  try {
    return calculateFingerprint(snapshot);
  } catch (error) {
    return null;
  }
}

function getActiveCanonicalHash() {
  const active = releaseService.getActiveReleaseInfoFast();
  if (active && active.canonicalHash) return active.canonicalHash;
  const activeSnapshot = releaseService.readActiveReleaseSnapshot();
  const fingerprint = getSnapshotFingerprint(activeSnapshot);
  return fingerprint && fingerprint.canonicalHash || "";
}

function getLatestStagingCanonicalHash() {
  const stagingData = readJsonIfExists(STAGING_LATEST_PATH);
  const fingerprint = getSnapshotFingerprint(stagingData);
  return {
    stagingData,
    canonicalHash: fingerprint && fingerprint.canonicalHash || "",
    fingerprint,
  };
}

function getStagingClassSchedules(data) {
  return data && (data.classSchedules || data.resources && data.resources.classSchedules) || [];
}

function summarizeStagingData(data) {
  const resourceCounts = buildResourceCountContract(data || {});
  return {
    classSchedules: getStagingClassSchedules(data),
    counts: flattenLegacyCounts(resourceCounts),
    resourceCounts,
  };
}

function validateStagingData(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== "object") {
    errors.push("Staging JSON must be an object");
    return { valid: false, errors, warnings };
  }
  ["schemaVersion", "releaseVersion", "term", "termStartDate", "generatedAt"].forEach((field) => {
    if (!data[field]) errors.push(`missing ${field}`);
  });
  const classSchedules = getStagingClassSchedules(data);
  if (!Array.isArray(classSchedules) || classSchedules.length === 0) {
    errors.push("classSchedules must be a non-empty array");
  }
  const counts = summarizeStagingData(data).counts;
  if (Object.values(counts).every((value) => Number(value || 0) === 0)) {
    errors.push("resource counts are all zero");
  }
  ["teacherSchedules", "classroomSchedules", "courseSchedules", "classrooms", "teachers", "courses"].forEach((key) => {
    const value = data[key] || data.resources && data.resources[key];
    if (!Array.isArray(value)) warnings.push(`missing resource array: ${key}`);
  });
  return { valid: errors.length === 0, errors, warnings };
}

function attachStagingFingerprint(stagingData, previousHash = "") {
  const fingerprint = calculateFingerprint(stagingData);
  const summary = summarizeStagingData(stagingData);
  stagingData.meta = Object.assign({}, stagingData.meta || {}, {
    canonicalHash: fingerprint.canonicalHash,
    previousHash: previousHash || stagingData.meta && stagingData.meta.previousHash || "",
    changed: previousHash ? previousHash !== fingerprint.canonicalHash : true,
    counts: Object.assign({}, stagingData.meta && stagingData.meta.counts || {}, summary.counts),
  });
  stagingData.canonicalHash = fingerprint.canonicalHash;
  return fingerprint;
}

function buildStagingSafety(stagingData, activeSnapshot) {
  const stagingSummary = summarizeStagingData(stagingData);
  const validation = validateStagingData(stagingData);
  const activeResourceCounts = activeSnapshot
    ? releaseService.getReleaseResourceCounts(
      activeSnapshot.version || activeSnapshot.releaseVersion || "",
      activeSnapshot
    )
    : null;
  const contractComparison = activeResourceCounts
    ? compareResourceCountContracts(activeResourceCounts, stagingSummary.resourceCounts)
    : { allowPublish: true, blockers: [], warnings: [], comparisons: [] };
  const blockers = validation.errors.concat((contractComparison.blockers || []).map((item) => item.message || item.code || "COUNT_CONTRACT_MISMATCH"));
  const warnings = validation.warnings.concat((contractComparison.warnings || []).map((item) => item.message || item.code || "COUNT_CONTRACT_WARNING"));
  return {
    allowPublish: blockers.length === 0,
    blockers,
    warnings,
    counts: stagingSummary.counts,
    resourceCounts: stagingSummary.resourceCounts,
    activeResourceCounts,
    contractComparison,
  };
}

function buildStagingUploadSummary(stagingData, safety, extra = {}) {
  const resourceCounts = safety && safety.resourceCounts || summarizeStagingData(stagingData).resourceCounts;
  return Object.assign({
    term: stagingData.term || stagingData.semester || "",
    releaseVersion: stagingData.releaseVersion || stagingData.version || "",
    generatedAt: stagingData.generatedAt || stagingData.updatedAt || "",
    counts: safety && safety.counts || summarizeStagingData(stagingData).counts,
    resourceCounts,
    totalScheduleDocuments: (
      Number(resourceCounts && resourceCounts.class && resourceCounts.class.scheduleDocuments || 0) +
      Number(resourceCounts && resourceCounts.teacher && resourceCounts.teacher.scheduleDocuments || 0) +
      Number(resourceCounts && resourceCounts.classroom && resourceCounts.classroom.scheduleDocuments || 0) +
      Number(resourceCounts && resourceCounts.course && resourceCounts.course.scheduleDocuments || 0)
    ),
    stagingState: safety && safety.allowPublish ? "pending-review" : "publish-blocked",
    releaseState: "not-built",
    runtimeState: "inactive",
  }, extra);
}

function progress(job, uploadId, value, phase, patch = {}) {
  if (job && typeof job.progress === "function") {
    job.progress(value, phase, Object.assign({ uploadId, phase }, patch));
  }
  try {
    stagingUploadService.markUploadStage(uploadId, phase, Object.assign({
      progress: value,
      phase,
      workerPid: process.pid,
      jobId: job && job.getJob && job.getJob().id || "",
    }, patch));
  } catch (error) {}
}

async function finalizeChunkedUpload(input, job) {
  const uploadId = input.uploadId || "";
  const actor = input.actor || { type: "admin", id: "admin-worker" };
  progress(job, uploadId, 10, "merging");
  const finalized = await stagingUploadService.finalizeUploadFiles(uploadId, actor, input.expected || input || {});

  progress(job, uploadId, 36, "parsing");
  let stagingData;
  try {
    stagingData = stagingUploadService.normalizeStagingData(JSON.parse(fs.readFileSync(finalized.jsonPath, "utf-8")));
  } catch (error) {
    stagingUploadService.markUploadFailed(uploadId, `JSON parse failed: ${error.message}`);
    error.statusCode = 400;
    throw error;
  }
  stagingData.stagingUploadId = finalized.manifest.uploadId;

  progress(job, uploadId, 52, "summarizing");
  const beforeLatest = getLatestStagingCanonicalHash();
  const fingerprint = attachStagingFingerprint(stagingData, beforeLatest.canonicalHash);
  const activeCanonicalHash = getActiveCanonicalHash();

  if (activeCanonicalHash && activeCanonicalHash === fingerprint.canonicalHash) {
    const localSummary = summarizeStagingData(stagingData);
    const summary = buildStagingUploadSummary(stagingData, {
      counts: localSummary.counts,
      resourceCounts: localSummary.resourceCounts,
      allowPublish: false,
    }, {
      canonicalHash: fingerprint.canonicalHash,
      unchanged: true,
      unchangedReason: "active-release",
      stagingState: "duplicate-active",
      releaseState: "published",
      runtimeState: "active",
      message: "duplicate with current active release",
    });
    const upload = stagingUploadService.markUploadUnchanged(uploadId, summary);
    appendAudit(input.reqMeta, "upload-skip", "staging-upload", uploadId, "Staging duplicate with active release");
    progress(job, uploadId, 96, "pending-review", { stagingState: "duplicate-active", releaseState: "published", runtimeState: "active" });
    return { success: true, skipped: true, unchanged: true, reason: "active-release", upload, canonicalHash: fingerprint.canonicalHash };
  }

  if (beforeLatest.canonicalHash && beforeLatest.canonicalHash === fingerprint.canonicalHash) {
    const localSummary = summarizeStagingData(stagingData);
    const summary = buildStagingUploadSummary(stagingData, {
      counts: localSummary.counts,
      resourceCounts: localSummary.resourceCounts,
      allowPublish: false,
    }, {
      canonicalHash: fingerprint.canonicalHash,
      unchanged: true,
      unchangedReason: "staging",
      stagingState: "duplicate-staging",
      releaseState: "not-built",
      runtimeState: "inactive",
      message: "duplicate with another staging upload",
    });
    const upload = stagingUploadService.markUploadUnchanged(uploadId, summary);
    appendAudit(input.reqMeta, "upload-skip", "staging-upload", uploadId, "Staging duplicate with existing staging");
    progress(job, uploadId, 96, "pending-review", { stagingState: "duplicate-staging", releaseState: "not-built", runtimeState: "inactive" });
    return { success: true, skipped: true, unchanged: true, reason: "staging", upload, canonicalHash: fingerprint.canonicalHash };
  }

  progress(job, uploadId, 68, "validating");
  const validation = validateStagingData(stagingData);
  if (!validation.valid) {
    stagingUploadService.markUploadFailed(uploadId, validation.errors.join("; "));
    const error = new Error(`Staging JSON validation failed: ${validation.errors.join("; ")}`);
    error.statusCode = 400;
    throw error;
  }

  stagingData.meta = Object.assign({}, stagingData.meta || {}, {
    stagingUploadId: finalized.manifest.uploadId,
    stagingUploadStatus: "pending-review",
  });

  progress(job, uploadId, 78, "validating-active");
  const activeSnapshot = releaseService.readActiveReleaseSnapshot();
  const safety = buildStagingSafety(stagingData, activeSnapshot);
  const summary = buildStagingUploadSummary(stagingData, safety, {
    warnings: safety.warnings,
    blockers: safety.blockers,
    contractComparison: safety.contractComparison,
    canonicalHash: fingerprint.canonicalHash,
  });

  progress(job, uploadId, 86, "writing-staging");
  writeJsonAtomic(STAGING_LATEST_PATH, stagingData);
  const upload = stagingUploadService.markUploadPendingReview(uploadId, summary);
  appendAudit(input.reqMeta, "upload", "staging-upload", uploadId, `CLI chunk upload finalized: ${stagingData.term || ""}`);
  progress(job, uploadId, 96, "pending-review", { stagingState: summary.stagingState, releaseState: summary.releaseState, runtimeState: summary.runtimeState });

  return {
    success: true,
    message: "Staging upload finalized and queued for review",
    stagingId: uploadId,
    upload,
    data: {
      term: stagingData.term,
      termStartDate: stagingData.termStartDate,
      releaseVersion: stagingData.releaseVersion,
      generatedAt: stagingData.generatedAt,
      counts: safety.counts,
      resourceCounts: safety.resourceCounts,
      contractComparison: safety.contractComparison,
      safety,
    },
    warnings: validation.warnings.concat(safety.warnings || []),
  };
}

module.exports = {
  STAGING_LATEST_PATH,
  finalizeChunkedUpload,
};
