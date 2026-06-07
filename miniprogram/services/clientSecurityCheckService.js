const buildInfo = require("../config/buildInfo");
const platform = require("../utils/platform");

const STORAGE_KEY = "FOSU_CLIENT_SECURITY_CHECK";
const REPORT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 80;

let protectedRequestState = null;

function now() {
  return Date.now();
}

function sanitizeText(value, maxLength = MAX_TEXT) {
  return String(value == null ? "" : value)
    .replace(/[^a-zA-Z0-9._:@/-]/g, "-")
    .slice(0, maxLength);
}

function readRecord() {
  if (typeof wx === "undefined") return {};
  try {
    return wx.getStorageSync(STORAGE_KEY) || {};
  } catch (error) {
    return {};
  }
}

function writeRecord(value) {
  if (typeof wx === "undefined") return;
  try {
    wx.setStorageSync(STORAGE_KEY, value || {});
  } catch (error) {
    // Best-effort diagnostics only.
  }
}

function markProtectedRequestSucceeded(meta = {}) {
  protectedRequestState = {
    at: now(),
    releaseVersion: sanitizeText(meta.releaseVersion || ""),
    securityMode: sanitizeText(meta.securityMode || "observe"),
    sessionHeaderAttached: meta.sessionHeaderAttached === true,
    staticTicketAttached: meta.staticTicketAttached === true,
  };
}

function getClientPlatformType() {
  const info = platform.getWxSystemInfo();
  return sanitizeText(info.platform || "unknown", 24);
}

function buildClientCheckPayload(meta = {}) {
  const state = protectedRequestState || {};
  return {
    clientBuildId: buildInfo.CLIENT_BUILD_ID,
    gitCommitShortSha: buildInfo.GIT_COMMIT_SHORT_SHA,
    buildTimestamp: buildInfo.BUILD_TIMESTAMP,
    miniprogramVersion: platform.getMiniProgramEnvVersion(),
    releaseVersion: sanitizeText(meta.releaseVersion || state.releaseVersion || ""),
    securityMode: sanitizeText(meta.securityMode || state.securityMode || "observe"),
    sessionHeaderAttached: meta.sessionHeaderAttached === true || state.sessionHeaderAttached === true,
    staticTicketAttached: meta.staticTicketAttached === true || state.staticTicketAttached === true,
    requestPipelineVersion: buildInfo.REQUEST_PIPELINE_VERSION,
    timestamp: new Date().toISOString(),
    platform: getClientPlatformType(),
    errorCode: sanitizeText(meta.errorCode || "", 40),
  };
}

function shouldReportClientCheck(payload = {}) {
  if (!protectedRequestState || protectedRequestState.sessionHeaderAttached !== true) {
    return false;
  }
  const buildId = sanitizeText(payload.clientBuildId || buildInfo.CLIENT_BUILD_ID);
  const record = readRecord();
  if (record.pendingBuildId === buildId) return false;
  if (record.reportedBuildId === buildId && now() - Number(record.reportedAt || 0) < REPORT_TTL_MS) {
    return false;
  }
  writeRecord(Object.assign({}, record, {
    pendingBuildId: buildId,
    pendingAt: now(),
  }));
  return true;
}

function markClientCheckReported(payload = {}, response = {}) {
  const buildId = sanitizeText(payload.clientBuildId || buildInfo.CLIENT_BUILD_ID);
  writeRecord({
    reportedBuildId: buildId,
    reportedAt: now(),
    serverTime: sanitizeText(response.serverTime || ""),
    requestPipelineVersion: buildInfo.REQUEST_PIPELINE_VERSION,
  });
}

function markClientCheckFailed(payload = {}, error = {}) {
  const buildId = sanitizeText(payload.clientBuildId || buildInfo.CLIENT_BUILD_ID);
  const record = readRecord();
  writeRecord(Object.assign({}, record, {
    pendingBuildId: "",
    lastFailedBuildId: buildId,
    lastFailedAt: now(),
    lastErrorCode: sanitizeText(error.code || error.reasonCode || "CLIENT_CHECK_FAILED", 40),
  }));
}

module.exports = {
  STORAGE_KEY,
  buildClientCheckPayload,
  markClientCheckFailed,
  markClientCheckReported,
  markProtectedRequestSucceeded,
  shouldReportClientCheck,
};
