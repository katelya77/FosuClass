const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const openresty = fs.readFileSync(path.join(root, "deploy/openresty/fosu-static-security.conf"), "utf-8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-vps.yml"), "utf-8");
const deployScript = fs.readFileSync(path.join(root, "server/scripts/deploy-ghcr-digest.sh"), "utf-8");
const runtimePointer = fs.readFileSync(path.join(root, "server/src/services/runtimePointerService.js"), "utf-8");
const staticSync = fs.readFileSync(path.join(root, "server/src/services/staticReleaseSyncService.js"), "utf-8");

assert(openresty.includes("location ^~ /static/runtime/"), "OpenResty include should serve runtime path");
assert(openresty.includes("alias /openresty-static/runtime/"), "runtime path should alias local static dir");
assert(!/location \^~ \/static\/runtime\/[\s\S]*proxy_pass/.test(openresty), "runtime static path must not proxy to Node");
assert(workflow.includes("deploy-ghcr-digest.sh"), "workflow should delegate smokes to the reviewed digest deploy script");
assert(deployScript.includes("/static/runtime/active.json"), "deploy should read-only verify the public runtime active pointer");
assert(deployScript.includes("test -f /app/storage/public/runtime/active.json"), "deploy should verify the existing container runtime pointer file");
assert(!deployScript.includes("reconcile-static-release"), "image deployment must not mutate the Active Pointer");
assert(runtimePointer.includes("OPENRESTY_STATIC_RUNTIME_DIR"), "runtime pointer writes should mirror to OpenResty runtime dir");
assert(staticSync.includes("syncRuntimePointerFile"), "static reconcile should sync runtime pointer");

console.log("test-static-runtime-direct-serving passed");
