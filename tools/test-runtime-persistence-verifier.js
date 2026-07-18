const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  capturePersistenceSnapshot,
  verifyPersistenceSnapshot,
} = require("../server/scripts/verify-runtime-persistence");

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-runtime-persistence-"));
try {
  const dataDir = path.join(root, "data");
  const storageDir = path.join(root, "storage");
  write(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"audit-1"}\n');
  write(path.join(dataDir, "backups", "config-1.json"), '{"appName":"before"}\n');
  write(path.join(dataDir, "sync-history.json"), '[{"id":"sync-1"}]\n');
  write(path.join(dataDir, "admin-catalog-staging", "current.json"), '{"generation":"g1"}\n');
  write(path.join(storageDir, "admin-config.json"), '{"appName":"FosuClass"}\n');
  write(path.join(storageDir, "jobs", "job-1.json"), '{"status":"success"}\n');
  write(path.join(storageDir, "quality-ignores.json"), '[]\n');

  const snapshot = capturePersistenceSnapshot({ dataDir, storageDir, now: new Date("2026-07-19T02:03:04.000Z") });
  assert.strictEqual(snapshot.schemaVersion, 1);
  assert.strictEqual(snapshot.capturedAt, "2026-07-19T02:03:04.000Z");
  assert.ok(/^[a-f0-9]{64}$/.test(snapshot.fingerprint));
  assert.ok(snapshot.files.every((entry) => ["data", "storage"].includes(entry.root) && !path.isAbsolute(entry.path)));
  assert.ok(!JSON.stringify(snapshot).includes(root), "snapshot must not expose host paths");
  assert.ok(snapshot.domains.audit >= 1);
  assert.ok(snapshot.domains.backups >= 1);
  assert.ok(snapshot.domains.configuration >= 1);
  assert.ok(snapshot.domains.jobs >= 1);
  assert.ok(snapshot.domains.sync >= 1);
  assert.ok(snapshot.domains.catalog >= 1);
  assert.ok(snapshot.domains.quality >= 1);

  assert.deepStrictEqual(verifyPersistenceSnapshot(snapshot, { dataDir, storageDir }), {
    ok: true,
    mismatches: [],
    verifiedFileCount: snapshot.files.length,
  });

  fs.appendFileSync(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"audit-2"}\n');
  assert.strictEqual(verifyPersistenceSnapshot(snapshot, { dataDir, storageDir }).ok, true, "append-only audit growth is preservation");

  write(path.join(dataDir, "backups", "config-1.json"), '{"appName":"overwritten"}\n');
  const backupFailure = verifyPersistenceSnapshot(snapshot, { dataDir, storageDir });
  assert.strictEqual(backupFailure.ok, false);
  assert.ok(backupFailure.mismatches.some((entry) => entry.path === "backups/config-1.json" && entry.reason === "hash-mismatch"));

  write(path.join(dataDir, "backups", "config-1.json"), '{"appName":"before"}\n');
  write(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"different-prefix"}\n');
  const auditFailure = verifyPersistenceSnapshot(snapshot, { dataDir, storageDir });
  assert.strictEqual(auditFailure.ok, false);
  assert.ok(auditFailure.mismatches.some((entry) => entry.path === "admin-audit-log.jsonl" && entry.reason === "append-prefix-mismatch"));

  let linkCreated = false;
  const unsafeData = path.join(root, "unsafe-data");
  fs.mkdirSync(unsafeData, { recursive: true });
  try {
    fs.symlinkSync(path.join(dataDir, "backups"), path.join(unsafeData, "backups"), process.platform === "win32" ? "junction" : "dir");
    linkCreated = true;
  } catch (_) {}
  if (linkCreated) {
    assert.throws(
      () => capturePersistenceSnapshot({ dataDir: unsafeData, storageDir }),
      (error) => error && error.code === "RUNTIME_PERSISTENCE_PATH_UNSAFE"
    );
  }

  console.log(JSON.stringify({ ok: true, fileCount: snapshot.files.length, domains: snapshot.domains, symlinkCheck: linkCreated ? "verified" : "unsupported" }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
