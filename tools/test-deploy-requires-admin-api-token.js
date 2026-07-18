const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-vps.yml"), "utf8");
const deployScript = fs.readFileSync(path.join(root, "server", "scripts", "deploy-ghcr-digest.sh"), "utf8");

assert.ok(!workflow.includes("secrets.ADMIN_API_TOKEN"), "long-lived admin tokens must not transit GitHub Actions");
assert.ok(!workflow.includes("ADMIN_API_TOKEN=${{"), "workflow must not rewrite the protected VPS application env");
assert.ok(deployScript.includes('test -s "$ENV_FILE"'), "remote deploy requires an existing protected application env");
assert.ok(deployScript.includes("ADMIN_API_TOKEN is missing"), "postdeploy smoke must fail if the runtime token is absent");
assert.ok(deployScript.includes("admin-api-token-contract=ok"), "remote deploy should verify the admin API token contract");
assert.ok(deployScript.includes("/api/admin/publisher/receipt"), "remote deploy should verify protected publisher receipt API");
assert.ok(deployScript.includes('if [ "$admin_unauth_status" != "401" ]'), "remote deploy should require 401 without token");
assert.ok(!/set\s+-x/.test(workflow + deployScript), "deployment must not enable shell xtrace");
assert.ok(!/echo\s+\$ADMIN_API_TOKEN/.test(deployScript), "deployment must not echo ADMIN_API_TOKEN");

console.log("test-deploy-requires-admin-api-token passed");
