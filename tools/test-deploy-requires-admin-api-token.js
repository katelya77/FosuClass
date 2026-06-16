const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-vps.yml"), "utf8");

assert(workflow.includes('["ADMIN_API_TOKEN"]="${{ secrets.ADMIN_API_TOKEN }}"'), "deploy must require ADMIN_API_TOKEN secret");
assert(!workflow.includes("ADMIN_API_TOKEN is not configured. The server will derive one from ADMIN_PASSWORD."), "deploy must not allow derived production ADMIN_API_TOKEN");
assert(workflow.includes("ADMIN_API_TOKEN=${{ secrets.ADMIN_API_TOKEN }}"), "deploy must write explicit ADMIN_API_TOKEN into server .env");
assert(/required_env_keys=\([\s\S]*ADMIN_API_TOKEN/.test(workflow), "remote deploy must require ADMIN_API_TOKEN in .env validation");
assert(workflow.includes("admin-api-token-contract=ok"), "remote deploy should verify the admin API token contract");
assert(workflow.includes("/api/admin/publisher/receipt"), "remote deploy should verify protected publisher receipt API");
assert(workflow.includes('if [ "$admin_unauth_status" != "401" ]'), "remote deploy should require 401 without token");
assert(!/set\s+-x/.test(workflow), "workflow must not enable shell xtrace");
assert(!/echo\s+\$ADMIN_API_TOKEN/.test(workflow), "workflow must not echo ADMIN_API_TOKEN");

console.log("test-deploy-requires-admin-api-token passed");
