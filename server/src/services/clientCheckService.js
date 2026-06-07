const { recordSecurityEvent } = require("./securityEventService");

const MAX_FIELD_LENGTH = 96;
const DISALLOWED_KEY_PATTERN = /(token|ticket|secret|openid|unionid|cookie|password|appsecret)/i;
const ALLOWED_KEYS = new Set([
  "buildTimestamp",
  "clientBuildId",
  "errorCode",
  "gitCommitShortSha",
  "miniprogramVersion",
  "platform",
  "releaseVersion",
  "requestPipelineVersion",
  "securityMode",
  "sessionHeaderAttached",
  "staticTicketAttached",
  "timestamp",
]);

function sanitizeText(value, maxLength = MAX_FIELD_LENGTH) {
  return String(value == null ? "" : value)
    .replace(/[^a-zA-Z0-9._:@/-]/g, "-")
    .slice(0, maxLength);
}

function findDisallowedClientCheckKeys(input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.keys(body).filter((key) => !ALLOWED_KEYS.has(key) || (!ALLOWED_KEYS.has(key) && DISALLOWED_KEY_PATTERN.test(key)));
}

function normalizeClientCheckPayload(input = {}) {
  const unknown = findDisallowedClientCheckKeys(input);
  if (unknown.length) {
    const error = new Error("CLIENT_CHECK_REJECTED_FIELD");
    error.code = "CLIENT_CHECK_REJECTED_FIELD";
    error.statusCode = 400;
    error.fields = unknown;
    throw error;
  }
  return {
    clientBuildId: sanitizeText(input.clientBuildId),
    gitCommitShortSha: sanitizeText(input.gitCommitShortSha, 24),
    buildTimestamp: sanitizeText(input.buildTimestamp, 40),
    miniprogramVersion: sanitizeText(input.miniprogramVersion, 24),
    releaseVersion: sanitizeText(input.releaseVersion),
    securityMode: sanitizeText(input.securityMode || "observe", 40),
    sessionHeaderAttached: input.sessionHeaderAttached === true,
    staticTicketAttached: input.staticTicketAttached === true,
    requestPipelineVersion: sanitizeText(input.requestPipelineVersion, 48),
    timestamp: sanitizeText(input.timestamp, 40),
    platform: sanitizeText(input.platform || "unknown", 32),
    errorCode: sanitizeText(input.errorCode || "", 48),
  };
}

function recordClientCheckSuccess(req, payload) {
  return recordSecurityEvent("security-client-check-success", {
    route: req.path,
    method: req.method,
    mode: payload.securityMode,
    anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
    openidHashPrefix: req.fosuSession && req.fosuSession.openidHash,
    sessionIdPrefix: req.fosuSession && req.fosuSession.sessionIdHash,
    reasonCode: payload.errorCode || "",
    clientBuildId: payload.clientBuildId,
    gitCommitShortSha: payload.gitCommitShortSha,
    releaseVersion: payload.releaseVersion,
    miniprogramVersion: payload.miniprogramVersion,
    requestPipelineVersion: payload.requestPipelineVersion,
    sessionHeaderAttached: payload.sessionHeaderAttached,
    staticTicketAttached: payload.staticTicketAttached,
    platform: payload.platform,
  });
}

module.exports = {
  ALLOWED_KEYS,
  findDisallowedClientCheckKeys,
  normalizeClientCheckPayload,
  recordClientCheckSuccess,
};
