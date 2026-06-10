const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-activation-fault-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const { writeJsonAtomic, readJsonFile } = require("../server/src/utils/jsonFileStore");
const service = require("../server/src/services/semesterActivationTransactionService");
const releaseService = require("../server/src/services/releaseService");
const termRegistryService = require("../server/src/services/termRegistryService");
const termReleaseIndexService = require("../server/src/services/termReleaseIndexService");
const runtimePointerService = require("../server/src/services/runtimePointerService");

try {
  const files = [
    releaseService.ACTIVE_RELEASE_PATH,
    path.join(process.env.FOSU_STORAGE_DIR, "snapshots", "current.json"),
    path.join(process.env.FOSU_STORAGE_DIR, "snapshots", "current.json.gz"),
    termReleaseIndexService.TERM_INDEX_PATH,
    termRegistryService.REGISTRY_PATH,
    path.join(process.env.FOSU_STORAGE_DIR, "admin-config.json"),
    runtimePointerService.ACTIVE_RUNTIME_PATH,
  ];
  files.forEach((filePath, index) => writeJsonAtomic(filePath, { marker: index }));
  const backup = service.backupState();
  files.forEach((filePath) => writeJsonAtomic(filePath, { marker: "mutated" }));
  service.restoreState(backup);
  files.forEach((filePath, index) => {
    assert.deepStrictEqual(readJsonFile(filePath), { marker: index });
  });
  console.log("test-semester-activation-fault-injection passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
