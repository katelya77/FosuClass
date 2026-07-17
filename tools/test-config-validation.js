const assert = require("assert");

process.env.NODE_ENV = "development";
process.env.PORT = "3000";
delete process.env.ADMIN_SERVICE_TOKENS;

delete require.cache[require.resolve("../server/src/config")];
delete require.cache[require.resolve("../server/src/services/configValidation")];
delete require.cache[require.resolve("../server/src/services/serviceTokenService")];

const { validateStartupConfig } = require("../server/src/services/configValidation");
const result = validateStartupConfig({ hardFail: false });
assert.strictEqual(result.ok, true, result.errors.join("; "));
assert(Array.isArray(result.scopes));
assert(result.scopes.includes("admin:full"));

process.env.ADMIN_SERVICE_TOKENS = "{not-json";
delete require.cache[require.resolve("../server/src/services/configValidation")];
const { validateStartupConfig: validate2 } = require("../server/src/services/configValidation");
const bad = validate2({ hardFail: false });
assert.strictEqual(bad.ok, false);
assert(bad.errors.some((e) => /ADMIN_SERVICE_TOKENS/.test(e)));

console.log("Config validation tests passed.");
