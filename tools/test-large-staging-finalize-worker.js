const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminRoutes = fs.readFileSync(path.join(root, "server/src/routes/admin.js"), "utf-8");
const worker = fs.readFileSync(path.join(root, "server/src/workers/releaseWorker.js"), "utf-8");
const manager = fs.readFileSync(path.join(root, "server/src/services/releaseWorkerManager.js"), "utf-8");
const finalizeService = fs.readFileSync(path.join(root, "server/src/services/stagingFinalizeService.js"), "utf-8");

const routeIndex = adminRoutes.indexOf('"/staging/upload/finalize"');
assert(routeIndex >= 0, "staging finalize route should exist");
const routeBody = adminRoutes.slice(routeIndex, routeIndex + 1800);
assert(routeBody.includes('startReleaseJob("staging-upload-finalize"'), "staging finalize should start worker job");
assert(/res\.status\(202\)/.test(routeBody), "staging finalize should return 202");
assert(!routeBody.includes("finalizeUpload("), "HTTP finalize route must not call synchronous finalizeUpload");
assert(worker.includes('type === "staging-upload-finalize"'), "worker should handle staging upload finalize");
assert(manager.includes("FOSU_RELEASE_WORKER_MAX_OLD_SPACE_MB"), "release worker should support explicit heap sizing");
assert(manager.includes("|| 3072"), "release worker default heap should handle full-school release packs");
assert(manager.includes("getReleaseWorkerExecArgv()"), "release worker fork should receive memory execArgv");
assert(finalizeService.includes("JSON.parse(fs.readFileSync"), "large JSON parse may exist only inside worker service");
assert(finalizeService.includes('progress(job, uploadId, 52, "hashing")'), "worker finalize should hash/fingerprint after JSON parse");
assert(!/finalizeUpload\(uploadId[\s\S]{0,400}JSON\.parse\(fs\.readFileSync/.test(routeBody), "HTTP finalize route must not parse JSON payload");

console.log("test-large-staging-finalize-worker passed");
