const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminRoutes = fs.readFileSync(path.join(root, "server/src/routes/admin.js"), "utf-8");
const worker = fs.readFileSync(path.join(root, "server/src/workers/releaseWorker.js"), "utf-8");
const manager = fs.readFileSync(path.join(root, "server/src/services/releaseWorkerManager.js"), "utf-8");

assert(adminRoutes.includes('"/release-pack/deep-health/start"'), "deep health start route should exist");
assert(adminRoutes.includes('startReleaseJob("release-pack-deep-health"'), "deep health route should start a worker job");
assert(/res\.status\(202\)/.test(adminRoutes), "deep health route should return 202");
assert(worker.includes('type === "release-pack-deep-health"'), "release worker should handle deep health");
assert(worker.includes("getReleasePackStatus"), "deep health should run the deep status in worker");
assert(manager.includes('"release-pack-deep-health"'), "deep health should share the release-heavy lock");

console.log("test-deep-health-worker passed");
