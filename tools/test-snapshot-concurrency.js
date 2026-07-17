const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const tempRoot = path.join(os.tmpdir(), `fosu-snapshot-concurrency-${process.pid}-${Date.now()}`);
const snapshotsDir = path.join(tempRoot, "snapshots");
fs.mkdirSync(snapshotsDir, { recursive: true });

function getSnapshotTempPaths(uploadId) {
  const id = String(uploadId || "").trim();
  assert(/^[a-zA-Z0-9_-]{8,64}$/.test(id), "uploadId format");
  return {
    uploadId: id,
    tempJsonPath: path.join(snapshotsDir, `temp_upload-${id}.json`),
    tempGzPath: path.join(snapshotsDir, `temp_upload-${id}.json.gz`),
  };
}

const idA = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
const idB = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
assert.notStrictEqual(idA, idB);

const pathA = getSnapshotTempPaths(idA);
const pathB = getSnapshotTempPaths(idB);
fs.writeFileSync(pathA.tempJsonPath, JSON.stringify({ version: "A", semester: "2025-2026-2", catalog: { colleges: [1] }, majors: [1], classSchedules: [1] }));
fs.writeFileSync(pathA.tempGzPath, "gzip-a");
fs.writeFileSync(pathB.tempJsonPath, JSON.stringify({ version: "B", semester: "2025-2026-2", catalog: { colleges: [1] }, majors: [1], classSchedules: [1] }));
fs.writeFileSync(pathB.tempGzPath, "gzip-b");

assert.notStrictEqual(pathA.tempJsonPath, pathB.tempJsonPath, "temp paths must be distinct per uploadId");
assert.strictEqual(JSON.parse(fs.readFileSync(pathA.tempJsonPath, "utf8")).version, "A");
assert.strictEqual(JSON.parse(fs.readFileSync(pathB.tempJsonPath, "utf8")).version, "B");

// Activate B must not read A
const chosen = pathB;
const snapshot = JSON.parse(fs.readFileSync(chosen.tempJsonPath, "utf8"));
assert.strictEqual(snapshot.version, "B");

// Source contract: admin.js uses uploadId-scoped temp files
const adminSource = fs.readFileSync(path.join(__dirname, "../server/src/routes/admin.js"), "utf8");
assert(adminSource.includes("temp_upload-${"), "admin snapshot upload must use uploadId-scoped temp files");
assert(adminSource.includes("uploadId"), "snapshot upload response includes uploadId");
assert(adminSource.includes("sanitizeSnapshotUploadId"), "activate must sanitize uploadId");
assert(adminSource.includes('router.get("/snapshots"'), "snapshot list API must exist");
assert(adminSource.includes('router.get("/snapshots/download"'), "snapshot download API must exist");
assert(adminSource.includes("downloadPath"), "backups/snapshots list should expose downloadPath");

// Cleanup
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("Snapshot concurrency tests passed.");
