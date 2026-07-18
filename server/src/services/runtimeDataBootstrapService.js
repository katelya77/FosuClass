const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MARKER_NAME = ".fosu-runtime-bootstrap.json";

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

function bootstrapRuntimeData(options = {}) {
  const seedDir = path.resolve(options.seedDir || process.env.FOSU_SEED_DATA_DIR || path.join(__dirname, "../../data"));
  const dataDir = path.resolve(options.dataDir || process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
  if (seedDir === dataDir) {
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
    };
  }
  const seedFiles = walkSeedFiles(seedDir).filter((entry) => entry.path !== MARKER_NAME);
  assertDirectory(dataDir, "RUNTIME_DATA_UNSAFE", true);
  const copied = [];
  const skipped = [];
  const files = [];
  for (const seed of seedFiles) {
    const bytes = fs.readFileSync(seed.absolute);
    const target = ensureSafeTargetParent(dataDir, seed.path.split("/").join(path.sep));
    files.push({ path: seed.path, size: bytes.length, sha256: sha256(bytes) });
    if (fs.existsSync(target)) {
      assertRegular(target, "RUNTIME_DATA_UNSAFE");
      skipped.push(seed.path);
      continue;
    }
    writeFileDurable(target, bytes);
    copied.push(seed.path);
  }
  files.sort((left, right) => compareText(left.path, right.path));
  copied.sort(compareText);
  skipped.sort(compareText);
  const manifest = {
    schemaVersion: 1,
    seedFingerprint: sha256(Buffer.from(JSON.stringify(files))),
    files,
    copied,
    skipped,
  };
  const markerPath = assertInside(dataDir, path.join(dataDir, MARKER_NAME));
  if (fs.existsSync(markerPath)) {
    assertRegular(markerPath, "RUNTIME_DATA_UNSAFE");
    try {
      const existing = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      if (!existing || existing.schemaVersion !== 1) throw new Error("invalid marker schema");
    } catch (error) {
      throw typedError("runtime bootstrap marker is invalid", "RUNTIME_BOOTSTRAP_MARKER_INVALID", error);
    }
  } else {
    writeFileDurable(markerPath, Buffer.from(`${JSON.stringify({ ...manifest, bootstrappedAt: new Date().toISOString() }, null, 2)}\n`));
  }
  return manifest;
}

module.exports = {
  MARKER_NAME,
  bootstrapRuntimeData,
  walkSeedFiles,
};
