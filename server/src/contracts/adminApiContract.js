/**
 * Shared admin API contracts (plain JS runtime).
 * Shared by the Legacy admin and service-token clients.
 * Validates shapes without changing legacy response envelopes.
 */

const serviceTokenService = require("../services/serviceTokenService");

const ADMIN_SCOPES = serviceTokenService.ALL_SCOPES.slice();

const ROUTE_SCOPE_MAP = Object.freeze({
  "POST /staging/upload/init": [serviceTokenService.SCOPES.STAGING_INIT, serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /staging/upload/chunk": [serviceTokenService.SCOPES.STAGING_CHUNK, serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /staging/upload/finalize": [serviceTokenService.SCOPES.STAGING_FINALIZE, serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /staging/upload/unchanged": [serviceTokenService.SCOPES.STAGING_INIT, serviceTokenService.SCOPES.ADMIN_FULL],
  "DELETE /staging/:uploadId": [serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /storage/maintenance/run": [serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /sync/staging/publish": [serviceTokenService.SCOPES.RELEASE_PUBLISH, serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /sync/staging/publish/start": [serviceTokenService.SCOPES.RELEASE_PUBLISH, serviceTokenService.SCOPES.ADMIN_FULL],
  "DELETE /sync/releases/:version": [serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /release/rebuild": [serviceTokenService.SCOPES.RELEASE_BUILD, serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /static-release/sync": [serviceTokenService.SCOPES.STATIC_SYNC, serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /static-release/verify": [serviceTokenService.SCOPES.STATIC_VERIFY, serviceTokenService.SCOPES.ADMIN_FULL],
  "POST /relay/tasks": [serviceTokenService.SCOPES.RELAY_MANAGE, serviceTokenService.SCOPES.ADMIN_FULL],
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSyncStatusPayload(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be object"] };
  }
  // Legacy envelope: success + data or flat fields
  const data = isObject(payload.data) ? payload.data : payload;
  const requiredHints = [
    "activeReleaseVersion",
    "releaseVersion",
    "semester",
  ];
  requiredHints.forEach((key) => {
    if (!(key in data) && !(key in payload)) {
      errors.push(`missing field: ${key}`);
    }
  });
  return { ok: errors.length === 0, errors, data };
}

function assertStagingInitBody(body) {
  const errors = [];
  if (!isObject(body)) return { ok: false, errors: ["body must be object"] };
  if (!String(body.term || body.semester || "").trim()) {
    errors.push("term is required");
  }
  return { ok: errors.length === 0, errors };
}

function assertLoginResponse(payload) {
  const errors = [];
  if (!isObject(payload)) return { ok: false, errors: ["payload must be object"] };
  if (payload.success !== true) errors.push("success must be true");
  if (!payload.csrfToken && !(payload.data && payload.data.csrfToken)) {
    errors.push("csrfToken required on login success");
  }
  return { ok: errors.length === 0, errors };
}

function getRequiredScopesForRoute(method, routePath) {
  const key = `${String(method || "GET").toUpperCase()} ${String(routePath || "")}`;
  return ROUTE_SCOPE_MAP[key] || [serviceTokenService.SCOPES.ADMIN_FULL];
}

module.exports = {
  ADMIN_SCOPES,
  ROUTE_SCOPE_MAP,
  assertLoginResponse,
  assertStagingInitBody,
  assertSyncStatusPayload,
  getRequiredScopesForRoute,
};
