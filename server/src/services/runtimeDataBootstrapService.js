const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MARKER_NAME = ".fosu-runtime-bootstrap.json";
const MIGRATION_MARKER_NAME = ".fosu-runtime-migration.json";

function typedError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function compareText(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

function assertRegular(filePath, code = "RUNTIME_SEED_UNSAFE") {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (error) { throw typedError(`runtime data path cannot be inspected: ${path.basename(filePath)}`, code, error); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw typedError(`runtime data path is not a regular file: ${path.basename(filePath)}`, code);
  return stat;
}

function assertDirectory(directory, code, create = false) {
  if (!fs.existsSync(directory)) {
    if (!create) throw typedError(`runtime data directory is missing: ${path.basename(directory)}`, code);
    fs.mkdirSync(directory, { recursive: true });
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError(`runtime data directory is unsafe: ${path.basename(directory)}`, code);
}

function assertNoLinkedComponents(candidate, code) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { throw typedError(`runtime path cannot be inspected: ${path.basename(current)}`, code, error); }
    if (stat.isSymbolicLink()) throw typedError(`runtime path contains a link: ${path.basename(current)}`, code);
  }
  return absolute;
}

function assertInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw typedError("runtime seed path escaped its managed root", "RUNTIME_SEED_UNSAFE");
  return target;
}

function walkSeedFiles(seedDir) {
  const root = path.resolve(seedDir);
  assertDirectory(root, "RUNTIME_SEED_MISSING", false);
  const files = [];
  function visit(directory) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("runtime seed contains a linked directory", "RUNTIME_SEED_UNSAFE");
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = assertInside(root, path.join(directory, entry.name));
      const entryStat = fs.lstatSync(absolute);
      if (entryStat.isSymbolicLink()) throw typedError("runtime seed contains a symbolic link", "RUNTIME_SEED_UNSAFE");
      if (entryStat.isDirectory()) visit(absolute);
      else if (entryStat.isFile()) files.push({ absolute, path: path.relative(root, absolute).replace(/\\/g, "/") });
      else throw typedError("runtime seed contains a non-regular entry", "RUNTIME_SEED_UNSAFE");
    }
  }
  visit(root);
  return files;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES", "EISDIR", "EINVAL"].includes(error && error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeFileDurable(target, bytes) {
  const parent = path.dirname(target);
  const temp = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temp, "wx", 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (!written) throw typedError("runtime seed copy made no progress", "RUNTIME_SEED_COPY_FAILED");
      offset += written;
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temp, target);
    fsyncDirectory(parent);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
    try { fs.unlinkSync(temp); } catch (_) {}
    if (error && error.code && String(error.code).startsWith("RUNTIME_")) throw error;
    throw typedError("runtime seed copy failed", "RUNTIME_SEED_COPY_FAILED", error);
  }
}

function ensureSafeTargetParent(dataDir, relativePath) {
  const root = path.resolve(dataDir);
  const target = assertInside(root, path.join(root, relativePath));
  const relativeParent = path.relative(root, path.dirname(target));
  let current = root;
  assertDirectory(current, "RUNTIME_DATA_UNSAFE", true);
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = assertInside(root, path.join(current, segment));
    assertDirectory(current, "RUNTIME_DATA_UNSAFE", true);
  }
  return target;
}

function assertSafeRelativeMarkerPath(value) {
  const text = String(value || "");
  if (!text || text.includes("\\") || path.posix.isAbsolute(text)) return false;
  const normalized = path.posix.normalize(text);
  return normalized === text && normalized !== "." && normalized !== ".." && !normalized.startsWith("../");
}

function readRequiredMigrationMarker(dataDir) {
  if (!fs.existsSync(dataDir)) throw typedError("runtime data migration marker is required before first production start", "RUNTIME_MIGRATION_REQUIRED");
  assertDirectory(dataDir, "RUNTIME_DATA_UNSAFE", false);
  const markerPath = path.join(dataDir, MIGRATION_MARKER_NAME);
  if (!fs.existsSync(markerPath)) throw typedError("runtime data migration marker is required before first production start", "RUNTIME_MIGRATION_REQUIRED");
  assertRegular(markerPath, "RUNTIME_MIGRATION_MARKER_INVALID");
  let marker;
  let markerBytes;
  try {
    markerBytes = fs.readFileSync(markerPath);
    marker = JSON.parse(markerBytes.toString("utf8"));
  }
  catch (error) { throw typedError("runtime data migration marker is invalid", "RUNTIME_MIGRATION_MARKER_INVALID", error); }
  const valid = marker
    && marker.schemaVersion === 1
    && Number.isFinite(Date.parse(String(marker.migratedAt || "")))
    && marker.sourcePath === "/app/data"
    && typeof marker.archive === "string"
    && /^fosu-runtime-data-[A-Za-z0-9._-]+\.tar\.gz$/.test(marker.archive)
    && /^[a-f0-9]{64}$/.test(String(marker.archiveSha256 || ""))
    && /^[a-f0-9]{64}$/.test(String(marker.dataFingerprint || ""))
    && Array.isArray(marker.files)
    && marker.files.length > 0
    && marker.files.every((entry) => entry
      && assertSafeRelativeMarkerPath(entry.path)
      && Number.isSafeInteger(entry.size)
      && entry.size >= 0
      && /^[a-f0-9]{64}$/.test(String(entry.sha256 || "")));
  if (!valid) throw typedError("runtime data migration marker is invalid", "RUNTIME_MIGRATION_MARKER_INVALID");
  const files = marker.files.map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 }));
  if (sha256(Buffer.from(JSON.stringify(files))) !== marker.dataFingerprint) {
    throw typedError("runtime data migration fingerprint is invalid", "RUNTIME_MIGRATION_MARKER_INVALID");
  }
  return { marker, files, markerSha256: sha256(markerBytes) };
}

function walkRuntimeFilesForAcceptance(dataDir) {
  const files = [];
  function visit(directory) {
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw typedError("runtime migration content contains a linked directory", "RUNTIME_MIGRATION_CONTENT_INVALID");
    for (const entry of fs.readdirSync(directory).sort(compareText)) {
      const absolute = path.join(directory, entry);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw typedError("runtime migration content contains a link", "RUNTIME_MIGRATION_CONTENT_INVALID");
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) {
        const relative = path.relative(dataDir, absolute).replace(/\\/g, "/");
        if (![MARKER_NAME, MIGRATION_MARKER_NAME].includes(relative)) {
          files.push({ path: relative, size: stat.size, sha256: sha256File(absolute) });
        }
      } else throw typedError("runtime migration content contains a non-regular entry", "RUNTIME_MIGRATION_CONTENT_INVALID");
    }
  }
  visit(dataDir);
  return files.sort((left, right) => compareText(left.path, right.path));
}

function readBootstrapReceipt(dataDir) {
  const receiptPath = path.join(dataDir, MARKER_NAME);
  if (!fs.existsSync(receiptPath)) return null;
  assertRegular(receiptPath, "RUNTIME_BOOTSTRAP_MARKER_INVALID");
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const receiptTime = receipt && (receipt.acceptedAt || receipt.bootstrappedAt);
    if (!receipt || receipt.schemaVersion !== 1 || !Number.isFinite(Date.parse(String(receiptTime || "")))) throw new Error("invalid bootstrap receipt schema");
    return receipt;
  } catch (error) {
    throw typedError("runtime bootstrap marker is invalid", "RUNTIME_BOOTSTRAP_MARKER_INVALID", error);
  }
}

function acceptMigrationEvidence(dataDir, evidence) {
  const receipt = readBootstrapReceipt(dataDir);
  if (receipt) {
    const linked = receipt.state === "migration-accepted"
      && receipt.migrationVerified === true
      && receipt.migrationMarkerSha256 === evidence.markerSha256
      && receipt.migrationDataFingerprint === evidence.marker.dataFingerprint
      && receipt.migrationArchiveSha256 === evidence.marker.archiveSha256;
    if (!linked) throw typedError("runtime bootstrap receipt is not bound to the migration marker", "RUNTIME_BOOTSTRAP_MARKER_INVALID");
    return { receipt, initialAcceptance: false };
  }
  const actual = walkRuntimeFilesForAcceptance(dataDir);
  if (JSON.stringify(actual) !== JSON.stringify(evidence.files)) {
    throw typedError("runtime data does not match the verified migration manifest", "RUNTIME_MIGRATION_CONTENT_INVALID");
  }
  return { receipt: null, initialAcceptance: true };
}

function bootstrapRuntimeData(options = {}) {
  const seedDir = assertNoLinkedComponents(
    options.seedDir || process.env.FOSU_SEED_DATA_DIR || path.join(__dirname, "../../data"),
    "RUNTIME_SEED_UNSAFE"
  );
  const dataDir = assertNoLinkedComponents(
    options.dataDir || process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"),
    "RUNTIME_DATA_UNSAFE"
  );
  const requireMigration = options.requireMigration === true
    || (options.requireMigration === undefined && process.env.FOSU_RUNTIME_DATA_REQUIRE_MIGRATION === "true");
  const migrationEvidence = requireMigration ? readRequiredMigrationMarker(dataDir) : null;
  const migrationAcceptance = migrationEvidence ? acceptMigrationEvidence(dataDir, migrationEvidence) : null;
  if (seedDir === dataDir) {
    if (requireMigration) throw typedError("production seed and runtime data directories must be separate", "RUNTIME_SEED_LAYOUT_INVALID");
    // Source checkouts historically use server/data for both reads and writes.
    // Treat that compatibility layout as a strict no-op: a bootstrap command
    // must not add a marker to, or recursively scan, the developer's source.
    assertDirectory(dataDir, "RUNTIME_DATA_UNSAFE", false);
    return {
      schemaVersion: 1,
      seedFingerprint: sha256(Buffer.from("same-root-noop-v1")),
      files: [],
      copied: [],
      skipped: [],
      sameRoot: true,
      migrationVerified: Boolean(migrationEvidence),
    };
  }
  const seedFiles = walkSeedFiles(seedDir).filter((entry) => entry.path !== MARKER_NAME);
  assertDirectory(dataDir, "RUNTIME_DATA_UNSAFE", true);
  const seedEntries = seedFiles.map((seed) => {
    const bytes = fs.readFileSync(seed.absolute);
    return { seed, bytes, manifest: { path: seed.path, size: bytes.length, sha256: sha256(bytes) } };
  });
  const files = seedEntries.map((entry) => entry.manifest).sort((left, right) => compareText(left.path, right.path));
  const seedFingerprint = sha256(Buffer.from(JSON.stringify(files)));
  const markerPath = assertInside(dataDir, path.join(dataDir, MARKER_NAME));
  let bootstrapReceipt = migrationAcceptance && migrationAcceptance.receipt;
  if (migrationEvidence && !bootstrapReceipt) {
    const acceptedAt = new Date().toISOString();
    bootstrapReceipt = {
      schemaVersion: 1,
      state: "migration-accepted",
      acceptedAt,
      migrationVerified: true,
      migrationMarkerSha256: migrationEvidence.markerSha256,
      migrationDataFingerprint: migrationEvidence.marker.dataFingerprint,
      migrationArchiveSha256: migrationEvidence.marker.archiveSha256,
      seedFingerprint,
      files,
      copied: [],
      skipped: [],
    };
    writeFileDurable(markerPath, Buffer.from(`${JSON.stringify(bootstrapReceipt, null, 2)}\n`));
    if (typeof options.afterMigrationAcceptance === "function") options.afterMigrationAcceptance(bootstrapReceipt);
  } else if (!migrationEvidence && fs.existsSync(markerPath)) {
    bootstrapReceipt = readBootstrapReceipt(dataDir);
  }
  const copied = [];
  const skipped = [];
  for (const entry of seedEntries) {
    const { seed, bytes } = entry;
    const target = ensureSafeTargetParent(dataDir, seed.path.split("/").join(path.sep));
    if (fs.existsSync(target)) {
      assertRegular(target, "RUNTIME_DATA_UNSAFE");
      skipped.push(seed.path);
      continue;
    }
    writeFileDurable(target, bytes);
    copied.push(seed.path);
  }
  copied.sort(compareText);
  skipped.sort(compareText);
  const manifest = {
    schemaVersion: 1,
    migrationVerified: Boolean(migrationEvidence),
    ...(migrationEvidence ? {
      migrationMarkerSha256: migrationEvidence.markerSha256,
      migrationDataFingerprint: migrationEvidence.marker.dataFingerprint,
      migrationArchiveSha256: migrationEvidence.marker.archiveSha256,
    } : {}),
    seedFingerprint,
    files,
    copied,
    skipped,
  };
  if (fs.existsSync(markerPath)) {
    const existing = bootstrapReceipt || readBootstrapReceipt(dataDir);
    if (!existing) throw typedError("runtime bootstrap marker is invalid", "RUNTIME_BOOTSTRAP_MARKER_INVALID");
  } else {
    writeFileDurable(markerPath, Buffer.from(`${JSON.stringify({ ...manifest, bootstrappedAt: new Date().toISOString() }, null, 2)}\n`));
  }
  return manifest;
}

module.exports = {
  MARKER_NAME,
  MIGRATION_MARKER_NAME,
  bootstrapRuntimeData,
  readRequiredMigrationMarker,
  walkSeedFiles,
};
