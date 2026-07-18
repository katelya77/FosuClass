const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { migrateRuntimeData, verifyFileManifest } = require("../server/scripts/migrate-runtime-data");

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function sha(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-runtime-migration-"));
try {
  const source = path.join(root, "container-data");
  const target = path.join(root, "compose", "data");
  const backups = path.join(root, "compose", "migration-backups");
  write(path.join(source, "admin-audit-log.jsonl"), '{"action":"seed"}\n');
  write(path.join(source, "backups", "config.json"), '{"appName":"before"}\n');
  write(path.join(source, "sync-history.json"), '[{"id":"sync-1"}]\n');
  write(path.join(source, "catalog-control", "operations", "pending.json"), '{"state":"audit_committed"}\n');

  let copyCalls = 0;
  const result = migrateRuntimeData({
    sourceContainer: "fosuclass-api",
    targetDir: target,
    backupDir: backups,
    now: new Date("2026-07-19T01:02:03.456Z"),
    dockerCopy(_container, destination) {
      copyCalls += 1;
      fs.cpSync(source, destination, { recursive: true });
    },
  });

  assert.strictEqual(copyCalls, 1);
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.sourceContainer, "fosuclass-api");
  assert.match(path.basename(result.archivePath), /^fosu-runtime-data-20260719T010203Z\.tar\.gz$/);
  assert.ok(fs.existsSync(result.archivePath), "timestamped backup required before migration");
  assert.ok(fs.existsSync(`${result.archivePath}.sha256`), "archive SHA256 sidecar required");
  assert.strictEqual(fs.readFileSync(`${result.archivePath}.sha256`, "utf8").trim().split(/\s+/)[0], sha(result.archivePath));
  assert.ok(result.files.some((entry) => entry.path === "admin-audit-log.jsonl"));
  assert.ok(result.files.some((entry) => entry.path === "backups/config.json"));
  assert.ok(result.files.some((entry) => entry.path === "sync-history.json"));
  assert.ok(result.files.every((entry) => !path.isAbsolute(entry.path) && /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.deepStrictEqual(verifyFileManifest(target, result.files), { ok: true, mismatches: [] });

  const markerPath = path.join(target, ".fosu-runtime-migration.json");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  assert.strictEqual(marker.archiveSha256, sha(result.archivePath));
  assert.strictEqual(marker.dataFingerprint, result.dataFingerprint);
  assert.ok(!JSON.stringify(marker).includes(root), "marker must not expose absolute host paths");

  const unsafeTarget = path.join(root, "unsafe-nonempty");
  write(path.join(unsafeTarget, "keep.txt"), "do-not-overwrite");
  let unsafeCopyCalls = 0;
  assert.throws(
    () => migrateRuntimeData({
      sourceContainer: "fosuclass-api",
      targetDir: unsafeTarget,
      backupDir: path.join(root, "unsafe-backups"),
      dockerCopy() { unsafeCopyCalls += 1; },
    }),
    (error) => error && error.code === "RUNTIME_TARGET_NOT_EMPTY"
  );
  assert.strictEqual(unsafeCopyCalls, 0, "unsafe target must fail before any mutation/export");
  assert.strictEqual(fs.readFileSync(path.join(unsafeTarget, "keep.txt"), "utf8"), "do-not-overwrite");

  assert.throws(
    () => migrateRuntimeData({ sourceContainer: "bad/name", targetDir: path.join(root, "bad") }),
    (error) => error && error.code === "RUNTIME_SOURCE_CONTAINER_INVALID"
  );

  console.log(JSON.stringify({ ok: true, archive: path.basename(result.archivePath), fileCount: result.files.length, dataFingerprint: result.dataFingerprint }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
