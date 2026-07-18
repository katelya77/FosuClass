const assert = require("assert");
const crypto = require("crypto");
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
  write(path.join(dataDir, "catalog-control", "operations", "op-1.json"), '{"state":"audit_committed"}\n');
  write(path.join(dataDir, "admin-c1-control", ".integrity-key"), 'fixture-integrity-key\n');
  write(path.join(dataDir, "admin-c1-control", "operations", "op-1.json"), '{"state":"audit_committed","signature":"fixture"}\n');
  write(path.join(dataDir, "admin-c1-control", "results", "op-1.json"), '{"status":"completed"}\n');
  write(path.join(storageDir, "admin-config.json"), '{"appName":"FosuClass"}\n');
  write(path.join(storageDir, "jobs", "job-1.json"), '{"status":"success"}\n');
  write(path.join(storageDir, "quality-ignores.json"), '[]\n');
  write(path.join(storageDir, "feedback.jsonl"), '{"id":"feedback-1"}\n');
  write(path.join(storageDir, "releases", "v1", "manifest.json"), '{"version":"v1"}\n');
  write(path.join(storageDir, "public", "runtime", "active.json"), '{"releaseVersion":"v1"}\n');
  write(path.join(storageDir, "release-lifecycle-state.json"), JSON.stringify({
    reconciledAt: "2026-07-19T01:00:00.000Z",
    reason: "before-recreate",
    activeReleaseVersion: "v1",
    activeCanonicalHash: "active-hash",
    stagingCanonicalHash: "staging-hash",
    stagingSameAsActive: false,
    uploadReconcile: { updatedAt: "2026-07-19T01:00:00.000Z" },
  }) + "\n");
  write(path.join(storageDir, "relay", "tasks.json"), '[]\n');
  write(path.join(storageDir, "terms", "2026-1", "calendar.json"), '{"weeks":20}\n');

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
  assert.ok(snapshot.domains["c1-control"] >= 3);
  assert.ok(snapshot.domains.quality >= 1);
  assert.ok(snapshot.domains.feedback >= 1);
  assert.ok(snapshot.domains.release >= 1);
  assert.ok(snapshot.domains.runtime >= 1);
  assert.ok(snapshot.domains.relay >= 1);
  assert.ok(snapshot.domains.term >= 1);
  assert.ok(snapshot.files.some((entry) => entry.root === "data" && entry.path === "catalog-control/operations/op-1.json"));
  assert.ok(snapshot.files.some((entry) => entry.root === "data" && entry.path === "admin-c1-control/.integrity-key"));
  assert.ok(snapshot.files.some((entry) => entry.root === "storage" && entry.path === "feedback.jsonl"));
  assert.ok(snapshot.files.some((entry) => entry.root === "storage" && entry.path === "releases/v1/manifest.json"));
  assert.ok(snapshot.files.some((entry) => entry.root === "storage" && entry.path === "public/runtime/active.json"));

  assert.deepStrictEqual(verifyPersistenceSnapshot(snapshot, { dataDir, storageDir }), {
    ok: true,
    mismatches: [],
    verifiedFileCount: snapshot.files.length,
  });

  const truncatedSnapshot = { ...snapshot, files: [] };
  assert.throws(
    () => verifyPersistenceSnapshot(truncatedSnapshot, { dataDir, storageDir }),
    (error) => error && error.code === "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID",
    "a syntactically valid but truncated evidence artifact must not verify green"
  );
  const duplicateSnapshot = { ...snapshot, files: snapshot.files.concat(snapshot.files[0]) };
  assert.throws(
    () => verifyPersistenceSnapshot(duplicateSnapshot, { dataDir, storageDir }),
    (error) => error && error.code === "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID"
  );
  const policyTamperFiles = snapshot.files.map((entry, index) => index === 0 ? { ...entry, mode: entry.mode === "exact" ? "append-only" : "exact" } : entry);
  const policyTamper = {
    ...snapshot,
    files: policyTamperFiles,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(policyTamperFiles)).digest("hex"),
  };
  assert.throws(
    () => verifyPersistenceSnapshot(policyTamper, { dataDir, storageDir }),
    (error) => error && error.code === "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID",
    "snapshot paths must retain their versioned domain/mode policy"
  );

  fs.appendFileSync(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"audit-2"}\n');
  assert.strictEqual(verifyPersistenceSnapshot(snapshot, { dataDir, storageDir }).ok, true, "append-only audit growth is preservation");

  write(path.join(storageDir, "release-lifecycle-state.json"), JSON.stringify({
    reconciledAt: "2026-07-19T02:00:00.000Z",
    reason: "startup",
    activeReleaseVersion: "v1",
    activeCanonicalHash: "active-hash",
    stagingCanonicalHash: "staging-hash",
    stagingSameAsActive: false,
    uploadReconcile: { updatedAt: "2026-07-19T02:00:00.000Z", repaired: true },
  }) + "\n");
  assert.strictEqual(
    verifyPersistenceSnapshot(snapshot, { dataDir, storageDir }).ok,
    true,
    "startup lifecycle reconciliation may change volatile metadata without looking like data loss"
  );

  write(path.join(storageDir, "release-lifecycle-state.json"), JSON.stringify({
    reconciledAt: "2026-07-19T02:00:00.000Z",
    reason: "startup",
    activeReleaseVersion: "lost-release",
    activeCanonicalHash: "different-hash",
    stagingCanonicalHash: "staging-hash",
    stagingSameAsActive: false,
  }) + "\n");
  const lifecycleFailure = verifyPersistenceSnapshot(snapshot, { dataDir, storageDir });
  assert.strictEqual(lifecycleFailure.ok, false);
  assert.ok(lifecycleFailure.mismatches.some((entry) => entry.path === "release-lifecycle-state.json" && entry.reason === "semantic-mismatch"));
  write(path.join(storageDir, "release-lifecycle-state.json"), JSON.stringify({
    activeReleaseVersion: "v1",
    activeCanonicalHash: "active-hash",
    stagingCanonicalHash: "staging-hash",
    stagingSameAsActive: false,
  }) + "\n");

  write(path.join(dataDir, "backups", "config-1.json"), '{"appName":"overwritten"}\n');
  const backupFailure = verifyPersistenceSnapshot(snapshot, { dataDir, storageDir });
  assert.strictEqual(backupFailure.ok, false);
  assert.ok(backupFailure.mismatches.some((entry) => entry.path === "backups/config-1.json" && entry.reason === "hash-mismatch"));

  write(path.join(dataDir, "backups", "config-1.json"), '{"appName":"before"}\n');
  write(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"different-prefix"}\n');
  const auditFailure = verifyPersistenceSnapshot(snapshot, { dataDir, storageDir });
  assert.strictEqual(auditFailure.ok, false);
  assert.ok(auditFailure.mismatches.some((entry) => entry.path === "admin-audit-log.jsonl" && entry.reason === "append-prefix-mismatch"));

  write(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"audit-concurrent"}\n');
  const concurrentSnapshot = capturePersistenceSnapshot({
    dataDir,
    storageDir,
    onFileOpened(entry) {
      if (entry.root === "data" && entry.path === "admin-audit-log.jsonl") {
        fs.appendFileSync(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"appended-during-capture"}\n');
      }
    },
  });
  assert.strictEqual(
    verifyPersistenceSnapshot(concurrentSnapshot, { dataDir, storageDir }).ok,
    true,
    "an append racing capture must hash the captured prefix, not bytes beyond its recorded size"
  );

  for (const relative of ["feedback.jsonl", "releases/v1/manifest.json", "public/runtime/active.json"]) {
    const absolute = path.join(storageDir, ...relative.split("/"));
    const bytes = fs.readFileSync(absolute);
    fs.unlinkSync(absolute);
    const failure = verifyPersistenceSnapshot(snapshot, { dataDir, storageDir });
    assert.strictEqual(failure.ok, false, `deleting ${relative} must fail preservation verification`);
    assert.ok(failure.mismatches.some((entry) => entry.root === "storage" && entry.path === relative && entry.reason === "missing"));
    write(absolute, bytes);
  }

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
