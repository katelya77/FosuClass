const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-content-"));
const storageDir = path.join(tmpRoot, "storage");
fs.mkdirSync(storageDir, { recursive: true });
process.env.FOSU_STORAGE_DIR = storageDir;

// Clear modules that cache paths at load time
for (const key of Object.keys(require.cache)) {
  if (key.includes(`${path.sep}appConfigService.js`) || key.includes(`${path.sep}content${path.sep}service.js`)) {
    delete require.cache[key];
  }
}

const appConfigService = require("../server/src/services/appConfigService");
const contentService = require("../server/src/modules/content/service");

const created = contentService.createNotice({ title: "Hello", content: "body", enabled: true });
assert.ok(created.id);
assert.ok(created.version);

const v1 = created.version;
const updated = contentService.updateNotice(created.id, { title: "Hello2", content: "body2" }, { expectedVersion: v1 });
assert.notStrictEqual(updated.version, v1);

let conflicted = false;
try {
  contentService.updateNotice(created.id, { title: "stale" }, { expectedVersion: v1 });
} catch (error) {
  conflicted = true;
  assert.strictEqual(error.statusCode, 409);
  assert.strictEqual(error.code, "CONFLICT");
}
assert.ok(conflicted, "stale version must 409");

// Domain service must be the same implementation (no duplication)
assert.strictEqual(contentService.listNotices().length, appConfigService.listNotices().length);

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Admin content concurrency tests passed.");
