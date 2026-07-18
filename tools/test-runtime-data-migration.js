const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

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
  write(path.join(source, ".fosu-runtime-bootstrap.json"), '{"schemaVersion":1,"old":true}\n');
  write(path.join(source, ".fosu-runtime-migration.json"), '{"schemaVersion":1,"old":true}\n');

  let copyCalls = 0;
  const sourceEvents = [];
  const result = migrateRuntimeData({
    sourceContainer: "fosuclass-api",
    targetDir: target,
    backupDir: backups,
    now: new Date("2026-07-19T01:02:03.456Z"),
    dockerCopy(_container, destination) {
      sourceEvents.push("copy");
      copyCalls += 1;
      fs.cpSync(source, destination, { recursive: true });
    },
    dockerControl: {
      inspect() {
        sourceEvents.push("inspect");
        return {
          running: true,
          paused: false,
          containerId: "1".repeat(64),
          imageId: `sha256:${"2".repeat(64)}`,
          imageRef: "fosuclass-api:local",
          startedAt: "2026-07-19T00:00:00.000000000Z",
          finishedAt: "0001-01-01T00:00:00Z",
          restartCount: 0,
          mounts: [],
        };
      },
      pause() { sourceEvents.push("pause"); },
      unpause() { sourceEvents.push("unpause"); },
    },
  });

  assert.strictEqual(copyCalls, 1);
  assert.deepStrictEqual(sourceEvents, ["inspect", "pause", "copy"], "successful migration must keep a live source frozen through cutover");
  assert.deepStrictEqual(result.sourceConsistency, {
    sourceState: "running",
    quiesceMethod: "docker-pause",
    quiesced: true,
    sourceIdentity: {
      containerId: "1".repeat(64),
      imageId: `sha256:${"2".repeat(64)}`,
      imageRef: "fosuclass-api:local",
      startedAt: "2026-07-19T00:00:00.000000000Z",
      finishedAt: "0001-01-01T00:00:00Z",
      restartCount: 0,
    },
    resumeRequired: true,
  });
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.archiveVerified, true, "the timestamped backup must be extracted and compared before target promotion");
  assert.strictEqual(result.sourceContainer, "fosuclass-api");
  assert.match(path.basename(result.archivePath), /^fosu-runtime-data-20260719T010203Z\.tar\.gz$/);
  assert.ok(fs.existsSync(result.archivePath), "timestamped backup required before migration");
  assert.ok(fs.existsSync(`${result.archivePath}.sha256`), "archive SHA256 sidecar required");
  assert.ok(fs.existsSync(`${result.archivePath}.manifest.json`), "backup evidence must survive independently of the target marker");
  assert.strictEqual(fs.readFileSync(`${result.archivePath}.sha256`, "utf8").trim().split(/\s+/)[0], sha(result.archivePath));
  assert.ok(result.files.some((entry) => entry.path === "admin-audit-log.jsonl"));
  assert.ok(result.files.some((entry) => entry.path === "backups/config.json"));
  assert.ok(result.files.some((entry) => entry.path === "sync-history.json"));
  assert.strictEqual(result.files.some((entry) => entry.path.startsWith(".fosu-runtime-")), false, "old control receipts must not become business data");
  assert.deepStrictEqual(result.sourceControlFiles.map((entry) => entry.path).sort(), [".fosu-runtime-bootstrap.json", ".fosu-runtime-migration.json"]);
  assert.ok(result.files.every((entry) => !path.isAbsolute(entry.path) && /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.deepStrictEqual(verifyFileManifest(target, result.files), { ok: true, mismatches: [] });

  const markerPath = path.join(target, ".fosu-runtime-migration.json");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  assert.strictEqual(marker.archiveSha256, sha(result.archivePath));
  assert.strictEqual(marker.dataFingerprint, result.dataFingerprint);
  assert.ok(!JSON.stringify(marker).includes(root), "marker must not expose absolute host paths");
  assert.strictEqual(fs.existsSync(path.join(target, ".fosu-runtime-bootstrap.json")), false, "old bootstrap receipts must be stripped before the new acceptance gate");
  const archivedNames = spawnSync("tar", ["-tzf", result.archivePath], { encoding: "utf8" }).stdout;
  assert.match(archivedNames, /\.fosu-runtime-bootstrap\.json/);
  assert.match(archivedNames, /\.fosu-runtime-migration\.json/);

  const replay = migrateRuntimeData({
    sourceContainer: "fosuclass-api",
    targetDir: target,
    backupDir: backups,
    now: new Date("2026-07-20T01:02:03.456Z"),
    dockerCopy() { copyCalls += 1; },
    dockerControl: {
      inspect() {
        sourceEvents.push("reconcile-inspect");
        return {
          running: true,
          paused: true,
          containerId: "1".repeat(64),
          imageId: `sha256:${"2".repeat(64)}`,
          imageRef: "fosuclass-api:local",
          startedAt: "2026-07-19T00:00:00.000000000Z",
          finishedAt: "0001-01-01T00:00:00Z",
          restartCount: 0,
          mounts: [],
        };
      },
    },
  });
  assert.strictEqual(replay.reconciled, true, "a crash after target promotion must reconcile instead of rejecting the nonempty target");
  assert.strictEqual(copyCalls, 1, "reconciliation must not export or overwrite data again");
  assert.strictEqual(replay.archiveSha256, result.archiveSha256);
  assert.strictEqual(replay.archiveVerified, true);
  assert.strictEqual(replay.reconcileAuthority, "same-frozen-container");
  assert.ok(sourceEvents.includes("reconcile-inspect"));

  assert.throws(
    () => migrateRuntimeData({
      sourceContainer: "fosuclass-api",
      targetDir: target,
      backupDir: backups,
      dockerControl: {
        inspect() {
          return {
            running: true,
            paused: false,
            containerId: "1".repeat(64),
            imageId: `sha256:${"2".repeat(64)}`,
            imageRef: "fosuclass-api:local",
            startedAt: "2026-07-20T09:00:00.000000000Z",
            finishedAt: "0001-01-01T00:00:00Z",
            restartCount: 0,
            mounts: [],
          };
        },
      },
    }),
    (error) => error && error.code === "RUNTIME_MIGRATION_SOURCE_STALE",
    "a restored Legacy source can receive new writes, so an old target generation must not reconcile"
  );

  const changedBeforeAcceptance = path.join(root, "changed-before-acceptance");
  fs.cpSync(target, changedBeforeAcceptance, { recursive: true });
  fs.appendFileSync(path.join(changedBeforeAcceptance, "admin-audit-log.jsonl"), "changed");
  assert.throws(
    () => migrateRuntimeData({ sourceContainer: "fosuclass-api", targetDir: changedBeforeAcceptance, backupDir: backups, now: new Date("2026-07-21T01:02:03Z") }),
    (error) => error && error.code === "RUNTIME_TARGET_VERIFY_FAILED"
  );

  const missingBackupTarget = path.join(root, "missing-backup-target");
  const missingBackups = path.join(root, "missing-backups");
  fs.cpSync(target, missingBackupTarget, { recursive: true });
  fs.mkdirSync(missingBackups, { recursive: true });
  fs.copyFileSync(`${result.archivePath}.sha256`, path.join(missingBackups, `${path.basename(result.archivePath)}.sha256`));
  fs.copyFileSync(`${result.archivePath}.manifest.json`, path.join(missingBackups, `${path.basename(result.archivePath)}.manifest.json`));
  assert.throws(
    () => migrateRuntimeData({ sourceContainer: "fosuclass-api", targetDir: missingBackupTarget, backupDir: missingBackups }),
    (error) => error && error.code === "RUNTIME_BACKUP_MISSING"
  );

  const failedTarget = path.join(root, "failed-target");
  const failureEvents = [];
  assert.throws(
    () => migrateRuntimeData({
      sourceContainer: "fosuclass-api",
      targetDir: failedTarget,
      backupDir: path.join(root, "failed-backups"),
      tarBin: "definitely-not-a-real-tar-binary",
      dockerCopy(_container, destination) { failureEvents.push("copy"); fs.cpSync(source, destination, { recursive: true }); },
      dockerControl: {
        inspect() { failureEvents.push("inspect"); return { running: true, paused: false, containerId: "3".repeat(64), imageId: `sha256:${"4".repeat(64)}`, imageRef: "local" }; },
        pause() { failureEvents.push("pause"); },
        unpause() { failureEvents.push("unpause"); },
      },
    }),
    (error) => error && error.code === "RUNTIME_BACKUP_FAILED"
  );
  assert.deepStrictEqual(failureEvents, ["inspect", "pause", "copy", "unpause"], "a failed migration must resume the old source");

  if (process.platform !== "win32") {
    assert.strictEqual(fs.statSync(backups).mode & 0o777, 0o700, "migration backup directory must be owner-only");
    assert.strictEqual(fs.statSync(result.archivePath).mode & 0o777, 0o600, "archive may contain integrity keys and must be owner-only");
    assert.strictEqual(fs.statSync(`${result.archivePath}.sha256`).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(`${result.archivePath}.manifest.json`).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(markerPath).mode & 0o777, 0o600);
  }

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
