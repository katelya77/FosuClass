#!/usr/bin/env node
/**
 * npm run config:preflight
 * Prints migration-safe config validation without leaking secrets.
 */
const path = require("path");

// Ensure server config path resolution works from repo root
process.chdir(path.join(__dirname, ".."));

const { validateStartupConfig } = require("../server/src/services/configValidation");
const config = require("../server/src/config");

const result = validateStartupConfig({ hardFail: false });

const report = {
  ok: result.ok,
  hardFailEnv: process.env.FOSU_CONFIG_HARD_FAIL || "",
  nodeEnv: config.NODE_ENV,
  adminApiTokenSource: result.adminApiTokenSource || "(empty)",
  derivedAdminApiToken: result.derivedAdminApiToken,
  hasExplicitAdminApiToken: result.hasExplicitAdminApiToken,
  adminApiTokenScopes: result.adminApiTokenScopes,
  warnings: result.warnings,
  errors: result.errors,
  guidance: [
    "Production should set an independent ADMIN_API_TOKEN (not derived from ADMIN_PASSWORD).",
    "Set FOSU_CONFIG_HARD_FAIL=true only after secrets migration is complete.",
    "Token values are never printed by this tool.",
  ],
};

console.log(JSON.stringify(report, null, 2));
if (!result.ok && String(process.env.FOSU_CONFIG_HARD_FAIL || "").toLowerCase() === "true") {
  process.exit(1);
}
