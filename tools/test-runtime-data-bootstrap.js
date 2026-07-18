const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { bootstrapRuntimeData } = require("../server/src/services/runtimeDataBootstrapService");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-runtime-bootstrap-"));
try {
  const seedDir = path.join(root, "seed-data");
  const dataDir = path.join(root, "runtime-data");
  writeJson(path.join(seedDir, "ai", "knowledge-docs.json"), { version: "seed-v1", docs: [{ id: "guide" }] });
  writeJson(path.join(seedDir, "ai", "campus-places.json"), { version: "map-v1", places: [{ id: "north" }] });

  const first = bootstrapRuntimeData({ seedDir, dataDir });
  assert.strictEqual(first.schemaVersion, 1);
  assert.strictEqual(first.copied.length, 2);
  assert.deepStrictEqual(first.skipped, []);
  assert.ok(first.files.every((entry) => !path.isAbsolute(entry.path)), "manifest paths must stay relative");
  assert.ok(first.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)), "seed hashes required");
  assert.ok(fs.existsSync(path.join(dataDir, ".fosu-runtime-bootstrap.json")), "bootstrap marker required");
  assert.strictEqual(hash(path.join(dataDir, "ai", "knowledge-docs.json")), hash(path.join(seedDir, "ai", "knowledge-docs.json")));

  const runtimeKnowledge = { version: "runtime-edited", docs: [{ id: "operator-change" }] };
  writeJson(path.join(dataDir, "ai", "knowledge-docs.json"), runtimeKnowledge);
  writeJson(path.join(seedDir, "ai", "knowledge-docs.json"), { version: "seed-v2", docs: [] });
  const beforeRuntimeHash = hash(path.join(dataDir, "ai", "knowledge-docs.json"));
  const second = bootstrapRuntimeData({ seedDir, dataDir });
  assert.strictEqual(second.copied.length, 0, "existing runtime files must never be overwritten");
  assert.deepStrictEqual(second.skipped.sort(), ["ai/campus-places.json", "ai/knowledge-docs.json"]);
  assert.strictEqual(hash(path.join(dataDir, "ai", "knowledge-docs.json")), beforeRuntimeHash);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "ai", "knowledge-docs.json"), "utf8")), runtimeKnowledge);

  const unsafeSeed = path.join(root, "unsafe-seed");
  fs.mkdirSync(unsafeSeed, { recursive: true });
  let linkCreated = false;
  try {
    fs.symlinkSync(path.join(seedDir, "ai"), path.join(unsafeSeed, "ai"), process.platform === "win32" ? "junction" : "dir");
    linkCreated = true;
  } catch (_) {}
  if (linkCreated) {
    assert.throws(
      () => bootstrapRuntimeData({ seedDir: unsafeSeed, dataDir: path.join(root, "unsafe-target") }),
      (error) => error && error.code === "RUNTIME_SEED_UNSAFE"
    );

    const linkedParentTarget = path.join(root, "linked-parent-target");
    const linkedParent = path.join(root, "linked-parent");
    fs.mkdirSync(linkedParentTarget, { recursive: true });
    fs.symlinkSync(linkedParentTarget, linkedParent, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => bootstrapRuntimeData({ seedDir, dataDir: path.join(linkedParent, "runtime-data") }),
      (error) => error && error.code === "RUNTIME_DATA_UNSAFE",
      "runtime bootstrap must not traverse an ancestor link or junction"
    );
    assert.strictEqual(fs.existsSync(path.join(linkedParentTarget, "runtime-data")), false);
  }

  const gatedData = path.join(root, "gated-runtime-data");
  assert.throws(
    () => bootstrapRuntimeData({ seedDir, dataDir: gatedData, requireMigration: true }),
    (error) => error && error.code === "RUNTIME_MIGRATION_REQUIRED"
  );
  assert.strictEqual(fs.existsSync(gatedData), false, "migration gate must fail before creating or seeding an empty mount");
  fs.mkdirSync(gatedData, { recursive: true });
  fs.writeFileSync(path.join(gatedData, "admin-audit-log.jsonl"), "x");
  const migratedFiles = [{ path: "admin-audit-log.jsonl", size: 1, sha256: hash(path.join(gatedData, "admin-audit-log.jsonl")) }];
  writeJson(path.join(gatedData, ".fosu-runtime-migration.json"), {
    schemaVersion: 1,
    migratedAt: "2026-07-19T01:02:03.456Z",
    sourceContainer: "fosuclass-api",
    sourcePath: "/app/data",
    archive: "fosu-runtime-data-20260719T010203Z.tar.gz",
    archiveSha256: "a".repeat(64),
    dataFingerprint: crypto.createHash("sha256").update(JSON.stringify(migratedFiles)).digest("hex"),
    files: migratedFiles,
  });
  const gated = bootstrapRuntimeData({ seedDir, dataDir: gatedData, requireMigration: true });
  assert.strictEqual(gated.migrationVerified, true);
  assert.ok(fs.existsSync(path.join(gatedData, "ai", "knowledge-docs.json")));
  fs.appendFileSync(path.join(gatedData, "admin-audit-log.jsonl"), "runtime-change");
  assert.strictEqual(bootstrapRuntimeData({ seedDir, dataDir: gatedData, requireMigration: true }).migrationVerified, true, "a linked bootstrap marker must allow later legitimate runtime mutations");

  const wrongReceiptState = path.join(root, "wrong-receipt-state");
  fs.cpSync(gatedData, wrongReceiptState, { recursive: true });
  const wrongReceiptPath = path.join(wrongReceiptState, ".fosu-runtime-bootstrap.json");
  const wrongReceipt = JSON.parse(fs.readFileSync(wrongReceiptPath, "utf8"));
  writeJson(wrongReceiptPath, { ...wrongReceipt, state: "seed-only" });
  assert.throws(
    () => bootstrapRuntimeData({ seedDir, dataDir: wrongReceiptState, requireMigration: true }),
    (error) => error && error.code === "RUNTIME_BOOTSTRAP_MARKER_INVALID"
  );

  const missingMigratedFile = path.join(root, "missing-migrated-file");
  writeJson(path.join(missingMigratedFile, ".fosu-runtime-migration.json"), {
    schemaVersion: 1,
    migratedAt: "2026-07-19T01:02:03.456Z",
    sourceContainer: "fosuclass-api",
    sourcePath: "/app/data",
    archive: "fosu-runtime-data-20260719T010203Z.tar.gz",
    archiveSha256: "a".repeat(64),
    dataFingerprint: crypto.createHash("sha256").update(JSON.stringify(migratedFiles)).digest("hex"),
    files: migratedFiles,
  });
  assert.throws(
    () => bootstrapRuntimeData({ seedDir, dataDir: missingMigratedFile, requireMigration: true }),
    (error) => error && error.code === "RUNTIME_MIGRATION_CONTENT_INVALID"
  );

  const acceptedCrashData = path.join(root, "accepted-crash-data");
  fs.mkdirSync(acceptedCrashData, { recursive: true });
  fs.writeFileSync(path.join(acceptedCrashData, "admin-audit-log.jsonl"), "x");
  writeJson(path.join(acceptedCrashData, ".fosu-runtime-migration.json"), {
    schemaVersion: 1,
    migratedAt: "2026-07-19T01:02:03.456Z",
    sourceContainer: "fosuclass-api",
    sourcePath: "/app/data",
    archive: "fosu-runtime-data-20260719T010203Z.tar.gz",
    archiveSha256: "a".repeat(64),
    dataFingerprint: crypto.createHash("sha256").update(JSON.stringify(migratedFiles)).digest("hex"),
    files: migratedFiles,
  });
  assert.throws(
    () => bootstrapRuntimeData({
      seedDir,
      dataDir: acceptedCrashData,
      requireMigration: true,
      afterMigrationAcceptance() { throw new Error("INJECTED_AFTER_MIGRATION_ACCEPTANCE"); },
    }),
    /INJECTED_AFTER_MIGRATION_ACCEPTANCE/
  );
  assert.ok(fs.existsSync(path.join(acceptedCrashData, ".fosu-runtime-bootstrap.json")), "acceptance receipt must be durable before seed writes");
  assert.strictEqual(fs.existsSync(path.join(acceptedCrashData, "ai")), false, "failpoint must run before the first seed mutation");
  assert.strictEqual(bootstrapRuntimeData({ seedDir, dataDir: acceptedCrashData, requireMigration: true }).migrationVerified, true);
  assert.ok(fs.existsSync(path.join(acceptedCrashData, "ai", "knowledge-docs.json")), "restart must replay missing seed after an accepted crash");

  const invalidGate = path.join(root, "invalid-gated-data");
  writeJson(path.join(invalidGate, ".fosu-runtime-migration.json"), { schemaVersion: 1, archiveSha256: "not-a-hash" });
  assert.throws(
    () => bootstrapRuntimeData({ seedDir, dataDir: invalidGate, requireMigration: true }),
    (error) => error && error.code === "RUNTIME_MIGRATION_MARKER_INVALID"
  );
  assert.strictEqual(fs.existsSync(path.join(invalidGate, "ai")), false);

  const sameRoot = bootstrapRuntimeData({ seedDir: dataDir, dataDir });
  assert.strictEqual(sameRoot.copied.length, 0, "local same-root mode must be a no-op");

  console.log(JSON.stringify({ ok: true, copied: first.copied, skipped: second.skipped, symlinkCheck: linkCreated ? "verified" : "unsupported" }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
