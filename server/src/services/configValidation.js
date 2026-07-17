/**
 * Startup configuration validity checks for admin/security-critical env.
 *
 * Migration-safe defaults:
 * - production issues emit high-priority warnings by default
 * - hard fail only when FOSU_CONFIG_HARD_FAIL=true (explicit)
 * - FOSU_CONFIG_HARD_FAIL=false (or unset) never exits for migration debt
 * Never log token values.
 */
const config = require("../config");
const serviceTokenService = require("./serviceTokenService");
const { safeLog } = require("../utils/safeLogger");

function resolveHardFail(options = {}) {
  if (typeof options.hardFail === "boolean") {
    return options.hardFail;
  }
  // Explicit opt-in only — safe rollout default is soft warnings.
  return String(process.env.FOSU_CONFIG_HARD_FAIL || "").toLowerCase() === "true";
}

function validateStartupConfig(options = {}) {
  const hardFail = resolveHardFail(options);
  const errors = [];
  const warnings = [];

  if (config.NODE_ENV === "production") {
    if (!config.ADMIN_TOKEN && !config.ADMIN_PASSWORD) {
      errors.push("production requires ADMIN_TOKEN or ADMIN_PASSWORD for web admin login");
    }
    if (!config.ADMIN_API_TOKEN) {
      warnings.push("ADMIN_API_TOKEN is empty; machine sync clients cannot authenticate");
    }
    if (config.ADMIN_API_LEGACY_DERIVED) {
      // Migration debt: warn by default, only hard-fail when explicitly requested.
      const message =
        "production ADMIN_API_TOKEN is derived from ADMIN_PASSWORD; set an independent ADMIN_API_TOKEN before enabling FOSU_CONFIG_HARD_FAIL=true";
      if (hardFail) {
        errors.push(message);
      } else {
        warnings.push(`[HIGH] ${message}`);
      }
    }
    if (config.ADMIN_API_TOKEN && config.ADMIN_PASSWORD && config.ADMIN_API_TOKEN === config.ADMIN_PASSWORD) {
      const message = "ADMIN_API_TOKEN must not equal ADMIN_PASSWORD";
      if (hardFail) errors.push(message);
      else warnings.push(`[HIGH] ${message}`);
    }
    if (config.ADMIN_API_TOKEN && config.ADMIN_TOKEN && config.ADMIN_API_TOKEN === config.ADMIN_TOKEN) {
      warnings.push("ADMIN_API_TOKEN equals ADMIN_TOKEN; prefer distinct machine and login secrets");
    }
  } else {
    if (!config.ADMIN_TOKEN && !config.ADMIN_PASSWORD && !config.ADMIN_API_TOKEN) {
      warnings.push("no admin credentials configured; admin APIs will reject writes when enforced");
    }
  }

  const rawServiceTokens = process.env.ADMIN_SERVICE_TOKENS || "";
  if (rawServiceTokens) {
    try {
      const parsed = JSON.parse(rawServiceTokens);
      if (!Array.isArray(parsed)) {
        errors.push("ADMIN_SERVICE_TOKENS must be a JSON array");
      } else {
        const tokens = serviceTokenService.parseServiceTokenTable();
        if (!tokens.length) {
          warnings.push("ADMIN_SERVICE_TOKENS parsed but no valid token entries found");
        }
        const seen = new Set();
        tokens.forEach((entry) => {
          if (seen.has(entry.token)) {
            errors.push(`duplicate service token entry for ${entry.name}`);
          }
          seen.add(entry.token);
          entry.scopes.forEach((scope) => {
            if (!serviceTokenService.ALL_SCOPES.includes(scope)) {
              errors.push(`unknown scope ${scope} on token ${entry.name}`);
            }
          });
        });
      }
    } catch (error) {
      errors.push(`ADMIN_SERVICE_TOKENS is not valid JSON: ${error.message}`);
    }
  }

  const apiScopes = serviceTokenService.getLegacyApiTokenScopes();
  if (!apiScopes.length) {
    errors.push("ADMIN_API_TOKEN_SCOPES resolved to empty scope set");
  }

  if (!Number.isFinite(config.PORT) || config.PORT <= 0 || config.PORT > 65535) {
    errors.push(`PORT is invalid: ${config.PORT}`);
  }

  const result = {
    ok: errors.length === 0,
    hardFail,
    errors,
    warnings,
    scopes: serviceTokenService.ALL_SCOPES.slice(),
    adminApiTokenSource: config.ADMIN_API_TOKEN_SOURCE || "",
    adminApiTokenScopes: apiScopes,
    // Never include token material
    hasExplicitAdminApiToken: Boolean(config.ADMIN_API_TOKEN && !config.ADMIN_API_LEGACY_DERIVED),
    derivedAdminApiToken: Boolean(config.ADMIN_API_LEGACY_DERIVED),
  };

  warnings.forEach((message) => safeLog("config-validation-warning", { message }));
  errors.forEach((message) => safeLog("config-validation-error", { message }));

  if (!result.ok && hardFail) {
    const error = new Error(`Invalid startup configuration: ${errors.join("; ")}`);
    error.code = "CONFIG_VALIDATION_FAILED";
    error.details = result;
    throw error;
  }

  return result;
}

module.exports = {
  resolveHardFail,
  validateStartupConfig,
};
