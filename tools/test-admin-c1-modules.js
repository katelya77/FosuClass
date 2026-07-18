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

// Task 3 quality contract: a versioned rule partitions the report, recovery
// returns the anomaly to active, and legacy arrays remain read-only until write.
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "class-schedules.json"), JSON.stringify([
  { className: "C1", courses: [] },
], null, 2));
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "teacher-schedules.json"), "[]");
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "classroom-schedules.json"), "[]");
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), JSON.stringify({
  version: "qi_seed",
  updatedAt: "2026-07-18T00:00:00.000Z",
  rules: [{
    id: "seed-rule",
    fingerprint: "empty-schedule::C1",
    reason: "known empty class",
    category: "empty-schedule",
    severity: "warning",
    createdAt: "2026-07-18T00:00:00.000Z",
    ignored: true,
  }],
}, null, 2));

const report = quality.buildQualityReport();
assert.ok(report.generatedAt);
assert.strictEqual(report.active.some((item) => item.fingerprint === "empty-schedule::C1"), false);
const ignoredAnomaly = report.ignored.find((item) => item.fingerprint === "empty-schedule::C1");
assert.ok(ignoredAnomaly, "versioned ignored anomaly must be reported in ignored");
assert.strictEqual(ignoredAnomaly.reason, "known empty class");
assert.strictEqual(ignoredAnomaly.status, "ignored");
assert.strictEqual(ignoredAnomaly.rule.category, "empty-schedule");
assert.strictEqual(report.summary.activeCount + report.summary.ignoredCount, report.summary.totalCount);
assert.strictEqual(report.stats, report.summary, "legacy stats alias must retain the canonical summary");
assert.strictEqual(report.anomalies, report.active, "legacy anomalies alias must expose active anomalies only");

const seeded = quality.listIgnores();
const recovered = quality.unmarkIgnore("empty-schedule::C1", {
  expectedVersion: seeded.version,
  requireIfMatch: true,
});
assert.ok(recovered.version);
const recoveredReport = quality.buildQualityReport();
assert.ok(recoveredReport.active.some((item) => item.fingerprint === "empty-schedule::C1"));
let staleRecovery = null;
try {
  quality.unmarkIgnore("empty-schedule::C1", { expectedVersion: seeded.version, requireIfMatch: true });
} catch (error) {
  staleRecovery = error;
}
assert.ok(staleRecovery && staleRecovery.statusCode === 409 && staleRecovery.currentVersion);

const legacyRules = [{ type: "empty-schedule", target: "Legacy" }];
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), JSON.stringify(legacyRules, null, 2));
const legacy = quality.listIgnores();
assert.deepStrictEqual(legacy.rules, legacyRules);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), "utf8")).length, 1);
quality.markIgnore({ fingerprint: "empty-schedule::Legacy", reason: "migrate" }, {
  expectedVersion: legacy.version,
  requireIfMatch: true,
});
assert.ok(Array.isArray(JSON.parse(fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), "utf8")).rules));

fs.rmSync(tmp, { recursive: true, force: true });
console.log("Admin C1 modules tests passed.");
