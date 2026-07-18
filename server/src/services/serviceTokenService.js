/**
 * Scoped service tokens for admin machine clients.
 * Legacy ADMIN_API_TOKEN maps to admin:full for backward compatibility.
 */
const crypto = require("crypto");
const config = require("../config");

const SCOPES = Object.freeze({
  STAGING_INIT: "staging:init",
  STAGING_CHUNK: "staging:chunk",
  STAGING_FINALIZE: "staging:finalize",
  RELEASE_BUILD: "release:build",
  RELEASE_PUBLISH: "release:publish",
  STATIC_SYNC: "static:sync",
  STATIC_VERIFY: "static:verify",
  RELAY_MANAGE: "relay:manage",
  CATALOG_WRITE: "catalog:write",
  QUALITY_WRITE: "quality:write",
  SETTINGS_WRITE: "settings:write",
  ADMIN_FULL: "admin:full",
});

const ALL_SCOPES = Object.freeze(Object.values(SCOPES));
const SCOPE_SET = new Set(ALL_SCOPES);

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeScopes(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || "")
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  const scopes = [];
  list.forEach((scope) => {
    if (SCOPE_SET.has(scope) && !scopes.includes(scope)) {
      scopes.push(scope);
    }
  });
  return scopes;
}

function parseServiceTokenTable() {
  const raw = process.env.ADMIN_SERVICE_TOKENS || "";
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry, index) => {
        const token = toText(entry && (entry.token || entry.value));
        if (!token) return null;
        const scopes = normalizeScopes(entry.scopes || entry.scope || SCOPES.ADMIN_FULL);
        if (!scopes.length) return null;
        return {
          token,
          scopes,
          name: toText(entry.name || entry.id || `service-token-${index + 1}`),
          kind: "scoped-service-token",
        };
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function getLegacyApiTokenScopes() {
  const configured = normalizeScopes(process.env.ADMIN_API_TOKEN_SCOPES || "");
  if (configured.length) return configured;
  return [SCOPES.ADMIN_FULL];
}

function listKnownTokenIdentities() {
  const identities = [];
  const serviceTokens = parseServiceTokenTable();
  serviceTokens.forEach((entry) => identities.push(entry));

  if (config.ADMIN_API_TOKEN) {
    identities.push({
      token: config.ADMIN_API_TOKEN,
      scopes: getLegacyApiTokenScopes(),
      name: "admin-api-token",
      kind: "legacy-admin-api-token",
      legacy: true,
      source: config.ADMIN_API_TOKEN_SOURCE || "explicit",
    });
  }

  if (config.ADMIN_TOKEN) {
    identities.push({
      token: config.ADMIN_TOKEN,
      scopes: [SCOPES.ADMIN_FULL],
      name: "admin-token",
      kind: "static-admin-token",
    });
  }

  return identities;
}

function resolveServiceToken(token) {
  const value = toText(token);
  if (!value) return null;
  const identities = listKnownTokenIdentities();
  for (let i = 0; i < identities.length; i += 1) {
    const identity = identities[i];
    if (timingSafeEqualText(value, identity.token)) {
      return {
        name: identity.name,
        kind: identity.kind,
        scopes: identity.scopes.slice(),
        legacy: Boolean(identity.legacy),
        source: identity.source || "",
        authMethod: "service-token",
      };
    }
  }
  return null;
}

function hasAllScopes(identity, requiredScopes) {
  if (!identity || !Array.isArray(identity.scopes)) return false;
  if (identity.scopes.includes(SCOPES.ADMIN_FULL)) return true;
  const required = normalizeScopes(requiredScopes);
  if (!required.length) return true;
  return required.every((scope) => identity.scopes.includes(scope));
}

function hasAnyScope(identity, acceptedScopes) {
  if (!identity || !Array.isArray(identity.scopes)) return false;
  if (identity.scopes.includes(SCOPES.ADMIN_FULL)) return true;
  const accepted = normalizeScopes(acceptedScopes);
  if (!accepted.length) return true;
  return accepted.some((scope) => identity.scopes.includes(scope));
}

function describeIdentity(identity) {
  if (!identity) {
    return {
      operator: "anonymous",
      authMethod: "none",
      scopes: [],
      tokenName: "",
    };
  }
  if (identity.authMethod === "admin-cookie" || identity.kind === "session") {
    return {
      operator: identity.name || "admin-session",
      authMethod: "admin-cookie",
      scopes: identity.scopes || [SCOPES.ADMIN_FULL],
      tokenName: "session",
      sessionIdPrefix: identity.sessionIdPrefix || "",
    };
  }
  return {
    operator: identity.name || "service-token",
    authMethod: identity.authMethod || "service-token",
    scopes: identity.scopes || [],
    tokenName: identity.name || "",
    legacy: Boolean(identity.legacy),
  };
}

module.exports = {
  ALL_SCOPES,
  SCOPES,
  describeIdentity,
  getLegacyApiTokenScopes,
  hasAllScopes,
  hasAnyScope,
  listKnownTokenIdentities,
  normalizeScopes,
  parseServiceTokenTable,
  resolveServiceToken,
};
