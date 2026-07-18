/**
 * Admin API scope policy: default-deny for state-changing routes.
 * Undeclared mutating routes require admin:full.
 * Explicit maps allow least-privilege service tokens.
 */
const { SCOPES } = require("../services/serviceTokenService");

const FULL = [SCOPES.ADMIN_FULL];

/**
 * Exact or pattern keys: `${METHOD} ${routePath}`
 * routePath uses Express-style params (:id).
 */
const ROUTE_SCOPE_MAP = {
  // C1 domain writes
  "POST /catalog/meta": [SCOPES.CATALOG_WRITE, SCOPES.ADMIN_FULL],
  "POST /quality/mark": [SCOPES.QUALITY_WRITE, SCOPES.ADMIN_FULL],
  "POST /quality/recheck/start": [SCOPES.QUALITY_WRITE, SCOPES.ADMIN_FULL],
  "POST /settings": [SCOPES.SETTINGS_WRITE, SCOPES.ADMIN_FULL],

  // Staging pipeline
  "POST /staging/upload/init": [SCOPES.STAGING_INIT, SCOPES.ADMIN_FULL],
  "POST /staging/upload/chunk": [SCOPES.STAGING_CHUNK, SCOPES.ADMIN_FULL],
  "POST /staging/upload/finalize": [SCOPES.STAGING_FINALIZE, SCOPES.ADMIN_FULL],
  "POST /staging/upload/unchanged": [SCOPES.STAGING_INIT, SCOPES.ADMIN_FULL],
  "POST /staging/upload/rebuild-index": FULL,
  "DELETE /staging/:uploadId": FULL,

  // Publish / release
  "POST /sync/staging/publish": [SCOPES.RELEASE_PUBLISH, SCOPES.ADMIN_FULL],
  "POST /sync/staging/publish/start": [SCOPES.RELEASE_PUBLISH, SCOPES.ADMIN_FULL],
  "POST /release-pack/rebuild/start": [SCOPES.RELEASE_BUILD, SCOPES.ADMIN_FULL],
  "POST /sync/releases/rebuild-index": [SCOPES.RELEASE_BUILD, SCOPES.ADMIN_FULL],
  "POST /release-pack/deep-health/start": [SCOPES.STATIC_VERIFY, SCOPES.ADMIN_FULL],
  "POST /release-pack/verify/start": [SCOPES.STATIC_VERIFY, SCOPES.ADMIN_FULL],

  // Static sync
  "POST /static-release-sync/start": [SCOPES.STATIC_SYNC, SCOPES.ADMIN_FULL],

  // Relay
  "POST /relay/tasks": [SCOPES.RELAY_MANAGE, SCOPES.ADMIN_FULL],
  "POST /relay/tasks/:id/revoke": [SCOPES.RELAY_MANAGE, SCOPES.ADMIN_FULL],
  "POST /relay/tasks/:id/cancel": [SCOPES.RELAY_MANAGE, SCOPES.ADMIN_FULL],
  "DELETE /relay/tasks/:id": [SCOPES.RELAY_MANAGE, SCOPES.ADMIN_FULL],
  "POST /relay/uploads/:id/promote-to-staging": [SCOPES.RELAY_MANAGE, SCOPES.STAGING_FINALIZE, SCOPES.ADMIN_FULL],

  // Aliases mentioned in requirements (map to existing handlers when present)
  "POST /release/rebuild": [SCOPES.RELEASE_BUILD, SCOPES.ADMIN_FULL],
  "POST /static-release/sync": [SCOPES.STATIC_SYNC, SCOPES.ADMIN_FULL],
  "POST /static-release/verify": [SCOPES.STATIC_VERIFY, SCOPES.ADMIN_FULL],
};

const PUBLIC_MUTATIONS = new Set([
  "POST /login",
  "POST /logout",
]);

function normalizeRoutePath(routePath) {
  return String(routePath || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
}

function patternToRegExp(pattern) {
  const escaped = normalizeRoutePath(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z0-9_]+)/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function getRequiredScopesForRoute(method, routePath) {
  const m = String(method || "GET").toUpperCase();
  const p = normalizeRoutePath(routePath);
  const key = `${m} ${p}`;

  if (PUBLIC_MUTATIONS.has(key)) {
    return null; // no scope gate
  }

  if (ROUTE_SCOPE_MAP[key]) {
    return ROUTE_SCOPE_MAP[key].slice();
  }

  for (const [patternKey, scopes] of Object.entries(ROUTE_SCOPE_MAP)) {
    const [pm, pp] = patternKey.split(" ");
    if (pm !== m) continue;
    if (patternToRegExp(pp).test(p)) {
      return scopes.slice();
    }
  }

  // Safe methods: any authenticated admin identity
  if (["GET", "HEAD", "OPTIONS"].includes(m)) {
    return null;
  }

  // Default deny for undeclared mutations
  return FULL.slice();
}

function resolveRequestRoutePath(req) {
  if (req.route && req.route.path) {
    // Express route path relative to router mount
    const base = String(req.baseUrl || "").replace(/\/api\/admin$/, "") || "";
    // When mounted at /api/admin, req.route.path is like /relay/tasks
    return normalizeRoutePath(req.route.path);
  }
  // Fallback: strip /api/admin prefix from originalUrl
  const raw = String(req.originalUrl || req.url || "").split("?")[0];
  return normalizeRoutePath(raw.replace(/^\/api\/admin/, "") || "/");
}

module.exports = {
  FULL,
  PUBLIC_MUTATIONS,
  ROUTE_SCOPE_MAP,
  getRequiredScopesForRoute,
  resolveRequestRoutePath,
  normalizeRoutePath,
};
