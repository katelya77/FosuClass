const fs = require("fs");
const path = require("path");

const releaseService = require("./releaseService");
const relayService = require("./relayService");
const stagingUploadService = require("./stagingUploadService");
const staticReleaseSyncService = require("./staticReleaseSyncService");
const stagingFingerprint = require("../utils/stagingFingerprint");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const STAGING_LATEST_PATH = path.join(STORAGE_DIR, "staging-latest.json");
const LIFECYCLE_STATE_PATH = path.join(STORAGE_DIR, "release-lifecycle-state.json");

const UPLOAD_STATES = Object.freeze([
  "uploading",
  "uploaded",
  "validating",
  "pending-review",
  "publishing",
  "published",
  "unchanged",
  "duplicate",
  "superseded",
  "failed",
  "archived",
  "deleted",
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  uploading: ["uploaded", "failed", "deleted"],
  uploaded: ["validating", "failed", "archived", "deleted"],
  validating: ["pending-review", "unchanged", "failed", "archived"],
  "pending-review": ["publishing", "published", "unchanged", "duplicate", "superseded", "failed", "archived", "deleted"],
  publishing: ["published", "failed"],
  published: ["superseded", "archived"],
  unchanged: ["archived", "deleted"],
  duplicate: ["archived", "deleted"],
  superseded: ["archived", "deleted"],
  failed: ["validating", "pending-review", "archived", "deleted"],
  archived: ["deleted"],
  deleted: [],
});

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
    safeLog("release-lifecycle-read-json-failed", { filePath, error: error.message });
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

function normalizeHash(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function canTransition(from, to) {
  const source = String(from || "").trim();
  const target = String(to || "").trim();
  if (!UPLOAD_STATES.includes(target)) return false;
  if (!source || source === target) return true;
  return (ALLOWED_TRANSITIONS[source] || []).includes(target);
}

function getSnapshotFingerprint(snapshot) {
  if (!snapshot) return null;
  try {
    return stagingFingerprint.calculateFingerprint(snapshot);
  } catch (error) {
    safeLog("release-lifecycle-fingerprint-failed", { error: error.message });
    return null;
  }
}

function getActiveInfo() {
  const active = releaseService.getActiveReleaseInfoFast() || null;
  if (!active) {
    return {
      active: null,
      activeReleaseVersion: "",
      activeCanonicalHash: "",
    };
  }
  let activeCanonicalHash = normalizeHash(active.canonicalHash);
  return {
    active,
    activeReleaseVersion: active.version || active.releaseVersion || "",
    activeCanonicalHash,
  };
}

function getLatestStaging() {
  const latestState = readJsonFile(STAGING_LATEST_PATH, null);
  const latestStateMeta = latestState && latestState.meta || {};
  const preferredUploadId = String(
    latestState && (latestState.stagingUploadId || latestState.uploadId) ||
    latestStateMeta.stagingUploadId ||
    ""
  ).trim();
  const stateCanonicalHash = normalizeHash(
    latestState && (latestState.canonicalHash || latestStateMeta.canonicalHash)
  );
  const stateTerm = String(latestState && (latestState.term || latestState.semester) || "").trim();
  const uploadRecords = stagingUploadService.listUploadRecords({
    limit: preferredUploadId || stateCanonicalHash ? 200 : 1,
  }).records || [];
  const matchingUpload = uploadRecords.find((item) => {
    if (preferredUploadId && item.uploadId === preferredUploadId) return true;
    const summary = item && item.summary || {};
    const itemHash = normalizeHash(item && (item.canonicalHash || summary.canonicalHash));
    const itemTerm = String(item && (item.term || summary.term) || "").trim();
    return Boolean(stateCanonicalHash && itemHash === stateCanonicalHash && (!stateTerm || itemTerm === stateTerm));
  }) || null;
  const latestUpload = matchingUpload || (!latestState ? uploadRecords[0] || null : null);
  const summary = latestUpload && latestUpload.summary || {};
  const canonicalHash = normalizeHash(
    latestState && (latestState.canonicalHash || latestStateMeta.canonicalHash) ||
    latestUpload && (latestUpload.canonicalHash || summary.canonicalHash)
  );
  const term = latestState && (latestState.term || latestState.semester) || latestUpload && (latestUpload.term || summary.term) || "";
  const releaseVersion = latestState && (latestState.releaseVersion || latestState.version) || latestUpload && (latestUpload.releaseVersion || summary.releaseVersion) || "";
  const generatedAt = latestState && (latestState.generatedAt || latestState.updatedAt) || latestUpload && (summary.generatedAt || latestUpload.updatedAt || latestUpload.createdAt) || "";
  const uploadId = preferredUploadId || latestUpload && latestUpload.uploadId || "";
  return {
    stagingData: latestState || latestUpload ? {
      stagingUploadId: uploadId,
      uploadId,
      term,
      semester: term,
      releaseVersion,
      version: releaseVersion,
      generatedAt,
      canonicalHash,
      meta: {
        stagingUploadId: uploadId,
        canonicalHash,
        stagingUploadStatus: latestUpload && (latestUpload.status || latestUpload.stagingState) || "",
      },
    } : null,
    stagingCanonicalHash: canonicalHash,
    fingerprint: null,
    upload: latestUpload,
    uploadId,
    relayUploadId: latestUpload && latestUpload.relayUploadId || "",
    relayTaskId: latestUpload && (latestUpload.sourceTaskId || latestUpload.relayTaskId) || "",
    term,
    releaseVersion,
    generatedAt,
  };
}

function patchLatestStagingMeta(patch) {
  const stagingData = readJsonFile(STAGING_LATEST_PATH, null);
  if (!stagingData || typeof stagingData !== "object") return null;
  const next = Object.assign({}, stagingData, {
    meta: Object.assign({}, stagingData.meta || {}, patch || {}),
  });
  if (patch && patch.canonicalHash) {
    next.canonicalHash = patch.canonicalHash;
  }
  writeJsonAtomic(STAGING_LATEST_PATH, next);
  return next;
}

function inferUploadLifecycle(upload, activeInfo, stagingInfo) {
  const uploadHash = normalizeHash(upload && (upload.canonicalHash || upload.summary && upload.summary.canonicalHash));
  const uploadVersion = String(upload && (upload.publishedReleaseVersion || upload.publishedVersion || upload.releaseVersion || upload.summary && upload.summary.releaseVersion) || "");
  const activeHash = activeInfo.activeCanonicalHash;
  const activeVersion = activeInfo.activeReleaseVersion;
  const isActive = Boolean(
    (activeHash && uploadHash && activeHash === uploadHash) ||
    (activeVersion && uploadVersion && activeVersion === uploadVersion && upload.status === "published") ||
    (upload && upload.active === true)
  );
  const sameAsStaging = Boolean(stagingInfo.stagingCanonicalHash && uploadHash && stagingInfo.stagingCanonicalHash === uploadHash);
  return {
    uploadId: upload && upload.uploadId || "",
    relayTaskId: upload && upload.sourceTaskId || "",
    sourceType: upload && (upload.source || upload.actorType || "cli") || "cli",
    term: upload && (upload.term || upload.summary && upload.summary.term) || "",
    canonicalHash: uploadHash,
    snapshotHash: upload && (upload.summary && upload.summary.snapshotHash || "") || "",
    uploadStatus: upload && upload.status || "uploaded",
    validationStatus: upload && upload.status === "failed" ? "failed" : (upload && upload.status === "pending-review" ? "pending-review" : "validated"),
    releaseStatus: isActive ? "active" : (upload && upload.status || "unknown"),
    staticSyncStatus: "",
    releaseVersion: uploadVersion,
    publishedReleaseVersion: upload && (upload.publishedReleaseVersion || upload.publishedVersion) || "",
    activeReleaseVersion: activeVersion,
    uploadedAt: upload && (upload.createdAt || upload.uploadedAt) || "",
    validatedAt: upload && (upload.pendingReviewAt || upload.finalizedAt) || "",
    publishedAt: upload && upload.publishedAt || "",
    activatedAt: isActive && activeInfo.active ? activeInfo.active.activatedAt || activeInfo.active.publishedAt || "" : "",
    staticSyncedAt: "",
    archivedAt: upload && upload.archivedAt || "",
    lastError: upload && (upload.failureReason || upload.lastError || "") || "",
    jobId: upload && upload.jobId || "",
    active: isActive,
    sameAsStaging,
  };
}

function reconcileLifecycle(options = {}) {
  const activeInfo = getActiveInfo();
  const stagingInfo = getLatestStaging();
  const now = new Date().toISOString();
  let stagingPatch = null;
  let relayUpload = null;

  const sameStagingAsActive = Boolean(
    activeInfo.activeCanonicalHash &&
    stagingInfo.stagingCanonicalHash &&
    activeInfo.activeCanonicalHash === stagingInfo.stagingCanonicalHash
  );

  const uploadReconcile = stagingUploadService.reconcileWithReleaseState({
    activeRelease: activeInfo.active || {},
    activeCanonicalHash: activeInfo.activeCanonicalHash,
    uploadId: options.uploadId || stagingInfo.uploadId,
    sourceTaskId: options.sourceTaskId || stagingInfo.relayTaskId,
  });

  if (sameStagingAsActive) {
    stagingPatch = patchLatestStagingMeta({
      canonicalHash: stagingInfo.stagingCanonicalHash,
      stagingUploadStatus: "published",
      releaseStatus: "published",
      publishedReleaseVersion: activeInfo.activeReleaseVersion,
      publishedAt: activeInfo.active && (activeInfo.active.publishedAt || activeInfo.active.activatedAt) || now,
      active: true,
      reconciledAt: now,
    });
    if (stagingInfo.relayUploadId) {
      relayUpload = relayService.markUploadPublished(stagingInfo.relayUploadId, activeInfo.activeReleaseVersion);
    }
  }

  const state = {
    reconciledAt: now,
    reason: options.reason || "manual",
    activeReleaseVersion: activeInfo.activeReleaseVersion,
    activeCanonicalHash: activeInfo.activeCanonicalHash,
    stagingCanonicalHash: stagingInfo.stagingCanonicalHash,
    stagingSameAsActive: sameStagingAsActive,
    uploadReconcile,
    relayUploadId: stagingInfo.relayUploadId,
    relayPublished: Boolean(relayUpload),
  };
  writeJsonAtomic(LIFECYCLE_STATE_PATH, state);
  return state;
}

function buildLifecycleStatus(options = {}) {
  if (options.reconcile !== false) {
    try {
      reconcileLifecycle({ reason: options.reason || "status" });
    } catch (error) {
      safeLog("release-lifecycle-status-reconcile-failed", { error: error.message });
    }
  }

  const activeInfo = getActiveInfo();
  const stagingInfo = getLatestStaging();
  const latestUploads = stagingUploadService.listUploadRecords({ limit: options.uploadLimit || 50 }).records || [];
  const latestUpload = latestUploads[0] || null;
  const latestLifecycle = latestUpload ? inferUploadLifecycle(latestUpload, activeInfo, stagingInfo) : null;
  const staticSync = staticReleaseSyncService.getSyncStatus({
    version: activeInfo.activeReleaseVersion || stagingInfo.releaseVersion || "",
  });
  const stagingSameAsActive = Boolean(
    activeInfo.activeCanonicalHash &&
    stagingInfo.stagingCanonicalHash &&
    activeInfo.activeCanonicalHash === stagingInfo.stagingCanonicalHash
  );
  const stagingNeedsPublish = Boolean(stagingInfo.stagingCanonicalHash && !stagingSameAsActive);
  const releasePackStatus = activeInfo.activeReleaseVersion
    ? releaseService.getReleasePackQuickHealth(activeInfo.activeReleaseVersion)
    : null;
  const lifecycleState = readJsonFile(LIFECYCLE_STATE_PATH, {});

  const staticSynced = Boolean(!staticSync.enabled || (staticSync.versionMatched && staticSync.success !== false && staticSync.status !== "failed"));
  let nextAction = {
    type: "collect",
    label: "复制采集命令",
    message: "等待新的 Staging 数据",
  };
  if (stagingNeedsPublish) {
    nextAction = {
      type: "publish",
      label: "开始发布",
      message: "发现新数据，等待校验或发布",
    };
  } else if (stagingSameAsActive && !staticSynced) {
    nextAction = {
      type: "static-sync",
      label: "同步当前 Release",
      message: "Release 已生效，等待同步静态目录",
    };
  } else if (stagingSameAsActive && staticSynced) {
    nextAction = {
      type: "verify",
      label: "验证静态 URL",
      message: "全链路正常，小程序正在使用当前 Release",
    };
  } else if (activeInfo.activeReleaseVersion) {
    nextAction = {
      type: "collect",
      label: "复制采集命令",
      message: "数据已发布并生效，无需重复操作",
    };
  }

  return {
    uploadStates: UPLOAD_STATES,
    allowedTransitions: ALLOWED_TRANSITIONS,
    activeRelease: activeInfo.active,
    activeReleaseVersion: activeInfo.activeReleaseVersion,
    activeCanonicalHash: activeInfo.activeCanonicalHash,
    latestStaging: stagingInfo.stagingData ? {
      term: stagingInfo.term,
      releaseVersion: stagingInfo.releaseVersion,
      generatedAt: stagingInfo.generatedAt,
      uploadId: stagingInfo.uploadId,
      relayUploadId: stagingInfo.relayUploadId,
      relayTaskId: stagingInfo.relayTaskId,
      canonicalHash: stagingInfo.stagingCanonicalHash,
    } : null,
    stagingCanonicalHash: stagingInfo.stagingCanonicalHash,
    stagingSameAsActive,
    stagingNeedsPublish,
    latestStagingUpload: latestUpload,
    stagingUploads: latestUploads,
    latestUploadLifecycle: latestLifecycle,
    releasePackStatus,
    releasePackHealthy: Boolean(releasePackStatus && releasePackStatus.healthy),
    staticSync,
    staticManifestUrl: staticSync.manifestUrl || staticSync.staticManifestUrl || "",
    staticClassIndexUrl: staticSync.classIndexUrl || staticSync.staticClassIndexUrl || "",
    staticEmptyRoomIndexUrl: staticSync.emptyRoomUrl || staticSync.staticEmptyRoomIndexUrl || "",
    openRestyStaticSyncStatus: staticSync.status,
    lastStaticSyncTime: staticSync.lastSuccessAt || staticSync.lastSyncTime || staticSync.syncedAt || staticSync.updatedAt || null,
    staticRetainedReleases: staticSync.retainedReleases || staticSync.keptReleases || [],
    lifecycleState,
    nextAction,
    stages: [
      {
        key: "collect",
        label: "数据采集",
        status: stagingInfo.stagingData ? "success" : "pending",
        version: stagingInfo.releaseVersion || activeInfo.activeReleaseVersion || "",
        lastSuccessAt: stagingInfo.generatedAt || "",
        next: stagingInfo.stagingData ? "核对 canonical hash" : "运行本地或 Relay 采集",
      },
      {
        key: "upload",
        label: "上传与校验",
        status: latestUpload ? latestUpload.status : (stagingInfo.stagingData ? "pending-review" : "pending"),
        version: stagingInfo.releaseVersion || "",
        lastSuccessAt: latestUpload && (latestUpload.pendingReviewAt || latestUpload.updatedAt) || "",
        next: stagingNeedsPublish ? "发布 Staging" : "等待新数据",
      },
      {
        key: "release",
        label: "Release 发布",
        status: stagingNeedsPublish ? "pending-review" : (activeInfo.activeReleaseVersion ? "published" : "pending"),
        version: activeInfo.activeReleaseVersion,
        lastSuccessAt: activeInfo.active && (activeInfo.active.activatedAt || activeInfo.active.publishedAt) || "",
        next: stagingNeedsPublish ? "开始发布" : "无需重复发布",
      },
      {
        key: "openresty",
        label: "OpenResty 同步",
        status: staticSync.status,
        version: staticSync.syncedReleaseVersion || staticSync.releaseVersion || "",
        lastSuccessAt: staticSync.lastSuccessAt || staticSync.lastSyncTime || "",
        next: staticSync.needsSync ? "同步当前 Release" : "验证 URL",
      },
      {
        key: "miniprogram",
        label: "小程序生效",
        status: releasePackStatus && releasePackStatus.healthy ? "success" : "pending",
        version: activeInfo.activeReleaseVersion,
        lastSuccessAt: activeInfo.active && (activeInfo.active.activatedAt || activeInfo.active.publishedAt) || "",
        next: releasePackStatus && releasePackStatus.healthy ? "观察线上访问" : "检查 Release Pack",
      },
    ],
  };
}

module.exports = {
  ALLOWED_TRANSITIONS,
  LIFECYCLE_STATE_PATH,
  UPLOAD_STATES,
  buildLifecycleStatus,
  canTransition,
  getActiveInfo,
  getLatestStaging,
  reconcileLifecycle,
};
