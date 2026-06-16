const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const token = "redaction-contract-token-1234567890";

const result = spawnSync(process.execPath, ["tools/fosu-publisher/verify-admin-token.js", "--base-url=http://127.0.0.1:1", "--timeout=50"], {
  cwd: root,
  encoding: "utf8",
  env: Object.assign({}, process.env, { ADMIN_API_TOKEN: token }),
  timeout: 5000,
});

const combined = `${result.stdout}\n${result.stderr}`;
assert.notStrictEqual(result.status, 0, "verify should fail against an unreachable endpoint");
assert(!combined.includes(token), "verify output must not print ADMIN_API_TOKEN");
assert(!combined.includes(`Bearer ${token}`), "verify output must not print Authorization header");
assert(!combined.includes(`X-Admin-Token: ${token}`), "verify output must not print X-Admin-Token header");

console.log("test-publisher-token-redaction passed");
