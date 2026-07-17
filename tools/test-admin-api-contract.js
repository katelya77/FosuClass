const assert = require("assert");
const contract = require("../server/src/contracts/adminApiContract");
const serviceTokenService = require("../server/src/services/serviceTokenService");

assert(Array.isArray(contract.ADMIN_SCOPES));
assert(contract.ADMIN_SCOPES.includes("admin:full"));
assert(contract.ADMIN_SCOPES.includes("staging:chunk"));

const syncOk = contract.assertSyncStatusPayload({
  success: true,
  activeReleaseVersion: "v1",
  releaseVersion: "v1",
  semester: "2025-2026-2",
});
assert.strictEqual(syncOk.ok, true, syncOk.errors.join("; "));

const syncBad = contract.assertSyncStatusPayload({ success: true });
assert.strictEqual(syncBad.ok, false);

const loginOk = contract.assertLoginResponse({ success: true, csrfToken: "a.b" });
assert.strictEqual(loginOk.ok, true);

const scopes = contract.getRequiredScopesForRoute("POST", "/staging/upload/chunk");
assert(scopes.includes(serviceTokenService.SCOPES.STAGING_CHUNK) || scopes.includes("staging:chunk"));

console.log("Admin API contract tests passed.");
