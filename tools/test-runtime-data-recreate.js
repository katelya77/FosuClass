const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  capturePersistenceSnapshot,
  verifyPersistenceSnapshot,
} = require("../server/scripts/verify-runtime-persistence");

function typedError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function validateImageReference(image) {
  const value = String(image || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@:+-]{1,255}$/.test(value) || /[\s'"`$]/.test(value)) throw typedError("runtime recreate image reference is unsafe", "RUNTIME_RECREATE_IMAGE_INVALID");
  return value;
}

function buildComposeDocument(image) {
  const safeImage = validateImageReference(image);
  const holdCommand = "require('./src/services/runtimeDataBootstrapService').bootstrapRuntimeData();setInterval(()=>{},1000)";
  return [
    "services:",
    "  verify:",
    `    image: ${safeImage}`,
    "    pull_policy: never",
    `    command: ${JSON.stringify(["node", "-e", holdCommand])}`,
    "    environment:",
    "      FOSU_DATA_DIR: /app/data",
    "      FOSU_SEED_DATA_DIR: /app/seed-data",
    "      FOSU_STORAGE_DIR: /app/storage",
    "      FOSU_RUNTIME_DATA_REQUIRE_MIGRATION: \"true\"",
    "    volumes:",
    "      - ./data:/app/data",
    "      - ./storage:/app/storage",
    "",
  ].join("\n");
}

function normalizeHostPath(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function validateExpectedMounts(mounts, fixtureRoot) {
  if (!Array.isArray(mounts)) throw typedError("container mount inspection is invalid", "RUNTIME_RECREATE_MOUNT_INVALID");
  const expected = new Map([
    ["/app/data", normalizeHostPath(path.join(fixtureRoot, "data"))],
    ["/app/storage", normalizeHostPath(path.join(fixtureRoot, "storage"))],
  ]);
  for (const [destination, source] of expected) {
    const mount = mounts.find((entry) => entry && entry.Destination === destination);
    if (!mount || mount.Type !== "bind" || mount.RW !== true || normalizeHostPath(mount.Source) !== source) {
      throw typedError(`container mount is not the expected writable bind: ${destination}`, "RUNTIME_RECREATE_MOUNT_INVALID");
    }
  }
  return { ok: true, destinations: Array.from(expected.keys()) };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 10 * 60 * 1000,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || (result.error && result.error.message) || "command failed").trim();
    throw typedError(`${command} ${args.join(" ")} failed: ${detail.slice(0, 1200)}`, options.code || "RUNTIME_RECREATE_COMMAND_FAILED", result.error);
  }
  return String(result.stdout || "").trim();
}

function dockerAvailability() {
  const result = spawnSync("docker", ["info", "--format", "{{json .ServerVersion}}"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    return { ok: false, reason: String(result.stderr || result.stdout || (result.error && result.error.message) || "Docker daemon unavailable").trim().slice(0, 500) };
  }
  const compose = spawnSync("docker", ["compose", "version", "--short"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (compose.error || compose.status !== 0) return { ok: false, reason: "Docker Compose is unavailable" };
  return { ok: true, serverVersion: String(result.stdout || "").trim().replace(/^"|"$/g, ""), composeVersion: String(compose.stdout || "").trim() };
}

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function migrationFileManifest(dataDir) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name !== ".fosu-runtime-migration.json") {
        const bytes = fs.readFileSync(absolute);
        files.push({
          path: path.relative(dataDir, absolute).replace(/\\/g, "/"),
          size: bytes.length,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  visit(dataDir);
  return files;
}

function executeRecreateTest(options = {}) {
  const availability = dockerAvailability();
  if (!availability.ok) return { ok: false, status: "UNKNOWN", reason: availability.reason };

  const repositoryRoot = path.resolve(__dirname, "..");
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-runtime-recreate-"));
  const project = `fosu-runtime-${process.pid}-${crypto.randomBytes(4).toString("hex")}`.toLowerCase();
  let image = options.image || process.env.FOSU_RECREATE_TEST_IMAGE || "";
  let builtImage = false;
  const composePath = path.join(fixtureRoot, "compose.yml");
  const dataDir = path.join(fixtureRoot, "data");
  const storageDir = path.join(fixtureRoot, "storage");
  let beforeContainer = "";
  let afterContainer = "";
  try {
    if (!image) {
      image = `fosuclass-runtime-recreate:${process.pid}-${crypto.randomBytes(4).toString("hex")}`.toLowerCase();
      const target = String(options.target || process.env.FOSU_RECREATE_TEST_TARGET || "browser");
      if (!["core", "browser"].includes(target)) throw typedError("runtime recreate target is invalid", "RUNTIME_RECREATE_TARGET_INVALID");
      run("docker", ["build", "--target", target, "-f", "server/Dockerfile", "-t", image, "."], {
        cwd: repositoryRoot,
        timeout: 20 * 60 * 1000,
        code: "RUNTIME_RECREATE_BUILD_FAILED",
      });
      builtImage = true;
    }
    image = validateImageReference(image);
    write(composePath, buildComposeDocument(image));
    write(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"audit-before-recreate"}\n');
    write(path.join(dataDir, "backups", "config-before.json"), '{"appName":"before"}\n');
    write(path.join(dataDir, "sync-history.json"), '[{"id":"sync-before"}]\n');
    write(path.join(dataDir, "admin-catalog-staging", "current.json"), '{"generation":"before"}\n');
    write(path.join(storageDir, "admin-config.json"), '{"appName":"before"}\n');
    write(path.join(storageDir, "jobs", "job-before.json"), '{"status":"success"}\n');
    write(path.join(storageDir, "quality-ignores.json"), '[]\n');
    write(path.join(storageDir, "feedback.jsonl"), '{"id":"feedback-before"}\n');
    write(path.join(storageDir, "releases", "fixture-v1", "manifest.json"), '{"version":"fixture-v1"}\n');
    write(path.join(storageDir, "public", "runtime", "active.json"), '{"releaseVersion":"fixture-v1"}\n');
    write(path.join(storageDir, "relay", "tasks.json"), '[]\n');
    write(path.join(storageDir, "terms", "2026-1", "calendar.json"), '{"weeks":20}\n');
    const migratedFiles = migrationFileManifest(dataDir);
    write(path.join(dataDir, ".fosu-runtime-migration.json"), `${JSON.stringify({
      schemaVersion: 1,
      migratedAt: "2026-07-19T01:02:03.456Z",
      sourceContainer: "fixture-old-container",
      sourcePath: "/app/data",
      archive: "fosu-runtime-data-20260719T010203Z.tar.gz",
      archiveSha256: "a".repeat(64),
      dataFingerprint: crypto.createHash("sha256").update(JSON.stringify(migratedFiles)).digest("hex"),
      files: migratedFiles,
    }, null, 2)}\n`);

    const composeArgs = ["compose", "-p", project, "-f", composePath];
    run("docker", composeArgs.concat(["up", "-d", "--no-build"]), { cwd: fixtureRoot, code: "RUNTIME_RECREATE_UP_FAILED" });
    beforeContainer = run("docker", composeArgs.concat(["ps", "-q", "verify"]), { cwd: fixtureRoot });
    if (!beforeContainer) throw typedError("initial persistence container was not created", "RUNTIME_RECREATE_CONTAINER_MISSING");
    assert.ok(fs.existsSync(path.join(dataDir, ".fosu-runtime-bootstrap.json")), "runtime seed marker was not persisted");
    fs.appendFileSync(path.join(dataDir, "admin-audit-log.jsonl"), '{"id":"audit-after-first-start"}\n');
    write(path.join(storageDir, "jobs", "job-after-first-start.json"), '{"status":"success"}\n');
    const baseline = capturePersistenceSnapshot({ dataDir, storageDir });
    for (const domain of ["audit", "backups", "configuration", "jobs", "feedback", "release", "runtime", "relay", "term"]) {
      assert.ok(baseline.domains[domain], `baseline persistence evidence is missing ${domain}`);
    }

    run("docker", composeArgs.concat(["up", "-d", "--force-recreate", "--no-build"]), { cwd: fixtureRoot, code: "RUNTIME_RECREATE_FORCE_FAILED" });
    afterContainer = run("docker", composeArgs.concat(["ps", "-q", "verify"]), { cwd: fixtureRoot });
    if (!afterContainer || afterContainer === beforeContainer) throw typedError("force recreate did not replace the container", "RUNTIME_RECREATE_NOT_REPLACED");
    const mounts = JSON.parse(run("docker", ["inspect", afterContainer, "--format", "{{json .Mounts}}"], { cwd: fixtureRoot }));
    const mountEvidence = validateExpectedMounts(mounts, fixtureRoot);
    const verification = verifyPersistenceSnapshot(baseline, { dataDir, storageDir });
    if (!verification.ok) throw typedError(`runtime persistence mismatch: ${JSON.stringify(verification.mismatches)}`, "RUNTIME_RECREATE_DATA_LOST");

    return {
      ok: true,
      status: "SUCCESS",
      image,
      imageSource: builtImage ? "local-build" : "provided",
      beforeContainer,
      afterContainer,
      baselineFingerprint: baseline.fingerprint,
      verifiedFileCount: verification.verifiedFileCount,
      domains: baseline.domains,
      mounts: mountEvidence.destinations,
      docker: availability,
    };
  } finally {
    try { run("docker", ["compose", "-p", project, "-f", composePath, "down", "--remove-orphans"], { cwd: fixtureRoot, timeout: 120000 }); } catch (_) {}
    if (builtImage && image) {
      try { run("docker", ["image", "rm", image], { cwd: repositoryRoot, timeout: 120000 }); } catch (_) {}
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const result = executeRecreateTest();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 3;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, status: "FAILED", code: error.code || "RUNTIME_RECREATE_FAILED", message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildComposeDocument,
  executeRecreateTest,
  validateExpectedMounts,
};
