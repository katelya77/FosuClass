const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

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
const repositorySource = fs.readFileSync(path.join(__dirname, "../server/src/modules/quality/repository.js"), "utf8");
assert.ok(!repositorySource.includes("fs.openSync"), "lock initialization must not expose an open/write/close descriptor sequence");
assert.ok(!repositorySource.includes("fs.closeSync"), "lock initialization must not expose a closeSync failure path");

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
  { className: "C2", courses: [{ weeks: [], sections: [] }] },
], null, 2));
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "teacher-schedules.json"), "[]");
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "classroom-schedules.json"), JSON.stringify([{
  roomName: "",
  courses: [
    { weeks: [1], sections: [1], teacherName: "A", className: "A" },
    { weeks: [1], sections: [1], teacherName: "B", className: "B" },
  ],
}], null, 2));
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
  }, {
    id: "legacy-missing-teacher",
    fingerprint: "missing-teacher::C2:undefined",
    reason: "legacy undefined target",
    category: "missing-teacher",
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
assert.ok(report.ignored.some((item) => item.fingerprint === "missing-teacher::C2:undefined"), "legacy undefined target must still match its ignore");
assert.strictEqual(report.active.some((item) => item.type === "classroom-conflict"), false, "blank classroom names must remain skipped");
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

const malformedIgnorePath = path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json");
const malformedBytes = '{"rules":';
fs.writeFileSync(malformedIgnorePath, malformedBytes, "utf8");
assert.throws(() => quality.listIgnores(), (error) => error && error.statusCode === 500 && error.code === "QUALITY_IGNORES_MALFORMED");
assert.throws(() => quality.markIgnore({ fingerprint: "empty-schedule::malformed" }), (error) => error && error.code === "QUALITY_IGNORES_MALFORMED");
assert.strictEqual(fs.readFileSync(malformedIgnorePath, "utf8"), malformedBytes, "malformed file must remain byte-identical");

fs.writeFileSync(malformedIgnorePath, JSON.stringify({ version: "qi_replace_seed", updatedAt: null, rules: [] }, null, 2));
const beforeReplaceFailure = fs.readFileSync(malformedIgnorePath, "utf8");
const originalRename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (path.resolve(to) === path.resolve(malformedIgnorePath)) {
    const error = new Error("injected rename failure");
    error.code = "EACCES";
    throw error;
  }
  return originalRename(from, to);
};
try {
  assert.throws(
    () => quality.markIgnore({ fingerprint: "empty-schedule::replace-failure", reason: "must not overwrite" }),
    (error) => error && error.statusCode === 500 && error.code === "QUALITY_IGNORES_REPLACE_FAILED"
  );
} finally {
  fs.renameSync = originalRename;
}
assert.strictEqual(fs.readFileSync(malformedIgnorePath, "utf8"), beforeReplaceFailure, "rename failure must preserve original bytes");

const lockPath = `${malformedIgnorePath}.lock`;
const originalLockWrite = fs.writeFileSync;
let injectedLockWrite = false;
fs.writeFileSync = (target, ...args) => {
  if (!injectedLockWrite && path.resolve(target) === path.resolve(lockPath)) {
    injectedLockWrite = true;
    const error = new Error("injected lock write failure");
    error.code = "EIO";
    throw error;
  }
  return originalLockWrite(target, ...args);
};
try {
  assert.throws(
    () => quality.markIgnore({ fingerprint: "empty-schedule::lock-write", reason: "lock write" }),
    (error) => error && error.code === "QUALITY_IGNORES_LOCK_FAILED"
  );
} finally {
  fs.writeFileSync = originalLockWrite;
}
assert.strictEqual(fs.existsSync(lockPath), false, "failed lock initialization must not strand the canonical lock");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-lock-write", reason: "acquire immediately" }));

const originalLockUnlink = fs.unlinkSync;
let injectedLockUnlink = false;
fs.unlinkSync = (target, ...args) => {
  if (!injectedLockUnlink && path.resolve(target) === path.resolve(lockPath)) {
    injectedLockUnlink = true;
    const error = new Error("injected lock unlink failure");
    error.code = "EBUSY";
    throw error;
  }
  return originalLockUnlink(target, ...args);
};
try {
  assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::lock-unlink", reason: "release retry" }));
} finally {
  fs.unlinkSync = originalLockUnlink;
}
assert.strictEqual(fs.existsSync(lockPath), false, "release retry must remove the canonical lock");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-lock-unlink", reason: "acquire after release" }));

const originalLockRead = fs.readFileSync;
let lockReadFailures = 0;
fs.readFileSync = (target, ...args) => {
  if (path.resolve(target) === path.resolve(lockPath) && lockReadFailures < 2) {
    lockReadFailures += 1;
    const error = new Error("injected lock read failure");
    error.code = "EIO";
    throw error;
  }
  return originalLockRead(target, ...args);
};
let readRecovery;
try {
  readRecovery = quality.markIgnore({ fingerprint: "empty-schedule::lock-read", reason: "retire after unreadable lock" });
} finally {
  fs.readFileSync = originalLockRead;
}
assert.ok(readRecovery.lockWarning && readRecovery.lockWarning.code === "QUALITY_IGNORES_LOCK_RELEASE_FAILED", "unreadable owned lock must surface a non-secret warning after commit");
assert.strictEqual(fs.existsSync(lockPath), false, "unreadable owned lock must be retired");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-lock-read", reason: "acquire after read recovery" }));

const originalPersistentUnlink = fs.unlinkSync;
const originalPersistentRename = fs.renameSync;
fs.unlinkSync = (target, ...args) => {
  if (path.resolve(target) === path.resolve(lockPath)) {
    const error = new Error("persistent Windows unlink failure");
    error.code = "EBUSY";
    throw error;
  }
  return originalPersistentUnlink(target, ...args);
};
fs.renameSync = (from, to) => {
  if (path.resolve(from) === path.resolve(lockPath)) {
    const error = new Error("persistent Windows rename failure");
    error.code = "EACCES";
    throw error;
  }
  return originalPersistentRename(from, to);
};
let persistentRelease;
try {
  persistentRelease = quality.markIgnore({ fingerprint: "empty-schedule::persistent-release", reason: "committed despite release failure" });
} finally {
  fs.unlinkSync = originalPersistentUnlink;
  fs.renameSync = originalPersistentRename;
}
assert.ok(persistentRelease.lockWarning && persistentRelease.lockWarning.code === "QUALITY_IGNORES_LOCK_RELEASE_FAILED", "persistent release failure must report a committed warning");
const heldLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
fs.writeFileSync(lockPath, JSON.stringify({ ...heldLock, leaseExpiresAt: new Date(Date.now() - 1).toISOString() }), "utf8");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-persistent-release", reason: "lease recovery" }), "expired owned lock must be recoverable after I/O recovers");

function waitFor(condition, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("timed out waiting for cross-process writer"));
      setTimeout(check, 10);
    };
    check();
  });
}

function spawnCasWriter(label, repositoryPath, readyDir, goPath) {
  const program = `
    const fs = require("fs");
    const repository = require(${JSON.stringify(path.resolve(__dirname, "../server/src/modules/quality/repository"))});
    const doc = repository.readIgnoreDocument();
    const prepared = repository.prepareIgnoreMutation({ action: "mark", fingerprint: "empty-schedule::${label}", reason: "cas" }, { expectedVersion: doc.version, requireIfMatch: true });
    fs.writeFileSync(${JSON.stringify(path.join(tmp, "ready-"))} + process.pid, ${JSON.stringify(label)});
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(goPath)})) Atomics.wait(pause, 0, 0, 10);
    try {
      const result = repository.commitPreparedIgnoreMutation(prepared);
      process.stdout.write(JSON.stringify({ ok: true, version: result.version }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code, statusCode: error.statusCode }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], {
      env: { ...process.env, FOSU_STORAGE_DIR: process.env.FOSU_STORAGE_DIR },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`cas writer ${label} exited ${code}: ${errors}`));
      resolve(JSON.parse(output));
    });
  });
}

async function assertCrossProcessCas() {
  fs.writeFileSync(malformedIgnorePath, JSON.stringify({ version: "qi_cas_seed", updatedAt: null, rules: [] }, null, 2));
  const goPath = path.join(tmp, "cas-go");
  const left = spawnCasWriter("left", null, tmp, goPath);
  const right = spawnCasWriter("right", null, tmp, goPath);
  await waitFor(() => fs.readdirSync(tmp).filter((name) => name.startsWith("ready-")).length === 2);
  fs.writeFileSync(goPath, "go");
  const results = await Promise.all([left, right]);
  assert.strictEqual(results.filter((result) => result.ok).length, 1, "exactly one process must commit");
  assert.strictEqual(results.filter((result) => result.code === "CONFLICT" && result.statusCode === 409).length, 1, "the losing process must report 409 conflict");
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(malformedIgnorePath, "utf8")), "CAS output must remain parseable JSON");
}

assertCrossProcessCas().then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Admin C1 modules tests passed.");
}).catch((error) => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.error(error.stack || error);
  process.exitCode = 1;
});
