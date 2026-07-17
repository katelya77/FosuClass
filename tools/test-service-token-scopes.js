const assert = require("assert");

process.env.NODE_ENV = "development";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ADMIN_API_TOKEN = "legacy-full-token";
process.env.ADMIN_SERVICE_TOKENS = JSON.stringify([
  { name: "stager", token: "scope-staging-only", scopes: ["staging:init", "staging:chunk", "staging:finalize"] },
  { name: "publisher", token: "scope-release-only", scopes: ["release:build", "release:publish"] },
]);

// Fresh require after env
delete require.cache[require.resolve("../server/src/services/serviceTokenService")];
delete require.cache[require.resolve("../server/src/services/adminAuth")];
delete require.cache[require.resolve("../server/src/config")];

const serviceTokenService = require("../server/src/services/serviceTokenService");
const adminAuth = require("../server/src/services/adminAuth");

const full = serviceTokenService.resolveServiceToken("legacy-full-token");
assert(full, "legacy token resolves");
assert(serviceTokenService.hasAllScopes(full, ["admin:full"]) || full.scopes.includes("admin:full"), "legacy is admin:full");
assert(serviceTokenService.hasAnyScope(full, ["staging:init"]), "admin:full covers staging");

const stager = serviceTokenService.resolveServiceToken("scope-staging-only");
assert(stager, "scoped staging token resolves");
assert(serviceTokenService.hasAnyScope(stager, ["staging:chunk"]), "staging scope ok");
assert(!serviceTokenService.hasAnyScope(stager, ["release:publish"]), "staging token cannot publish");

const publisher = serviceTokenService.resolveServiceToken("scope-release-only");
assert(publisher, "publisher token resolves");
assert(serviceTokenService.hasAnyScope(publisher, ["release:publish"]), "publish scope ok");
assert(!serviceTokenService.hasAnyScope(publisher, ["staging:init"]), "publisher cannot stage");

// Middleware: cookie session full access
const sessionToken = adminAuth.createSessionToken();
const csrfToken = adminAuth.createCsrfToken(sessionToken);
let nextCalled = false;
adminAuth.requireScopes(["staging:init"])(
  {
    adminIdentity: {
      authMethod: "admin-cookie",
      kind: "session",
      name: "admin-session",
      scopes: ["admin:full"],
      sessionToken,
    },
    headers: { "x-fosu-csrf": csrfToken, cookie: `${adminAuth.ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}` },
    method: "POST",
    path: "/staging/upload/init",
  },
  {
    status() { return this; },
    json() { return this; },
  },
  () => { nextCalled = true; }
);
assert.strictEqual(nextCalled, true, "session admin:full should pass requireScopes");

// Scoped token denied for wrong scope
nextCalled = false;
let statusCode = 200;
adminAuth.requireScopes(["release:publish"])(
  {
    adminIdentity: stager,
    headers: {},
    method: "POST",
    path: "/sync/staging/publish",
  },
  {
    status(code) { statusCode = code; return this; },
    json() { return this; },
  },
  () => { nextCalled = true; }
);
assert.strictEqual(nextCalled, false, "staging token must not publish");
assert.strictEqual(statusCode, 403, "scope denial is 403");

console.log("Service token scope tests passed.");
