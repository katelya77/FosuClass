const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-upload-index-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.STAGING_DIR = path.join(process.env.FOSU_STORAGE_DIR, "staging-uploads");

const stagingUploadService = require("../server/src/services/stagingUploadService");

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

try {
  writeJson(path.join(process.env.STAGING_DIR, "uploads.json"), [{
    uploadId: "cli-index-1",
    source: "cli",
    term: "2025-2026-2",
    status: "pending-review",
    canonicalHash: "aaaabbbbcccc",
    createdAt: "2026-06-11T01:00:00.000Z",
  }]);
  writeJson(path.join(process.env.STAGING_DIR, "cli-dir-2", "manifest.json"), {
    uploadId: "cli-dir-2",
    source: "cli",
    term: "2025-2026-2",
    status: "uploaded",
    canonicalHash: "bbbbccccdddd",
    createdAt: "2026-06-11T02:00:00.000Z",
  });
  writeJson(path.join(process.env.FOSU_STORAGE_DIR, "staging-direct-upload", "direct-1.json"), {
    uploadId: "direct-1",
    source: "staging-direct-upload",
    term: "2025-2026-2",
    status: "history",
  });
  writeJson(path.join(process.env.FOSU_STORAGE_DIR, "resource-upload-staging", "resource-1", "manifest.json"), {
    uploadId: "resource-1",
    source: "resource-upload-staging",
    term: "2025-2026-2",
    status: "history",
  });
  writeJson(path.join(process.env.FOSU_DATA_DIR, "sync-history.json"), [{
    uploadId: "sync-history-1",
    source: "sync-history",
    term: "2025-2026-2",
    status: "success",
    updatedAt: "2026-06-11T03:00:00.000Z",
  }]);
  writeJson(path.join(process.env.FOSU_STORAGE_DIR, "relay", "uploads.json"), [{
    uploadId: "relay-1",
    source: "relay",
    term: "2025-2026-2",
    status: "uploaded",
  }]);

  const result = stagingUploadService.rebuildUploadRecordIndex({ reason: "test" });
  const ids = result.records.map((item) => item.uploadId).sort();
  ["cli-index-1", "cli-dir-2", "direct-1", "resource-1", "sync-history-1", "relay-1"].forEach((id) => {
    assert(ids.includes(id), `rebuilt index should include ${id}`);
  });
  const listed = stagingUploadService.listUploadRecords({ limit: 50 });
  assert.strictEqual(listed.success, true);
  assert(listed.records.length >= 6, "list should return rebuilt records");
  const paged = stagingUploadService.listUploadRecords({ term: "2025-2026-2", limit: 2 });
  assert.strictEqual(paged.total, 6, "term filter should count matching records from unified index");
  assert.strictEqual(paged.records.length, 2, "term filter should page records");
  assert.strictEqual(paged.nextCursor, 2, "term filter should expose the next cursor");
  const success = stagingUploadService.listUploadRecords({ status: "success", limit: 50 });
  assert(success.records.some((item) => item.uploadId === "sync-history-1"), "status filter should include sync history success records");
  assert(success.records.every((item) => item.status === "success" || item.stagingState === "success"), "status filter should not leak other statuses");
  const empty = stagingUploadService.listUploadRecords({ term: "2099-2099-1", limit: 50 });
  assert.strictEqual(empty.total, 0, "term filter should return an empty page for unrelated terms");
  assert(fs.existsSync(stagingUploadService.RECORD_INDEX_PATH), "unified record index should be written");
  console.log("test-upload-record-index-migration passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
