const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-c1-"));
process.env.FOSU_STORAGE_DIR = path.join(tmp, "storage");
fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });

for (const key of Object.keys(require.cache)) {
  if (key.includes("modules") || key.includes("appConfigService") || key.includes("settings")) {
    delete require.cache[key];
  }
}

const settings = require("../server/src/modules/settings/service");
const catalog = require("../server/src/modules/catalog/service");
const quality = require("../server/src/modules/quality/service");
const appConfig = require("../server/src/services/appConfigService");

// seed config
appConfig.saveAdminConfig({ appName: "C1 Test App" });

const typed = settings.getTypedSettings();
assert.ok(typed.version);
assert.ok(typed.fields.length >= 5);

const saved = settings.saveTypedSettings(
  { appName: "C1 Renamed", expectedVersion: typed.version },
  { expectedVersion: typed.version, requireIfMatch: true }
);
assert.ok(saved.version !== typed.version);

let conflict = false;
try {
  settings.saveTypedSettings({ appName: "x" }, { expectedVersion: typed.version, requireIfMatch: true });
} catch (e) {
  conflict = e.statusCode === 409;
}
assert.ok(conflict);

const meta1 = catalog.getCatalogMetaDocument();
const entry = catalog.saveCatalogMetaEntry(
  "class::TEST",
  { displayName: "测试班", note: "n", hidden: false },
  { expectedVersion: meta1.version, requireIfMatch: true }
);
assert.ok(entry.version);

const q1 = quality.listIgnores();
const marked = quality.markIgnore(
  { fingerprint: "missingTeacher::x", category: "missingTeacher", reason: "known" },
  { expectedVersion: q1.version, requireIfMatch: true }
);
assert.ok(marked.version);
const unmarked = quality.unmarkIgnore("missingTeacher::x", {
  expectedVersion: marked.version,
  requireIfMatch: true,
});
assert.ok(unmarked.version);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("Admin C1 modules tests passed.");
