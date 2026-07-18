const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MIGRATION_MARKER_NAME = ".fosu-runtime-migration.json";
const SOURCE_DATA_PATH = "/app/data";

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
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
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

function writeFileDurable(filePath, bytes, mode = 0o600) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  const tempPath = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", mode);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (!written) throw typedError("runtime migration write made no progress", "RUNTIME_MIGRATION_WRITE_FAILED");
      offset += written;
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, filePath);
    fsyncDirectory(parent);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
    try { fs.unlinkSync(tempPath); } catch (_) {}
    if (error && error.code && String(error.code).startsWith("RUNTIME_")) throw error;
    throw typedError(`runtime migration could not write ${path.basename(filePath)}`, "RUNTIME_MIGRATION_WRITE_FAILED", error);
  }
}

function assertNoLinkedComponents(candidate, code) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw typedError(`runtime migration path contains a link: ${path.basename(current)}`, code);
  }
  return absolute;
}

function assertSafeDirectory(directory, code, options = {}) {
  const absolute = assertNoLinkedComponents(directory, code);
  if (!fs.existsSync(absolute)) {
    if (options.create) fs.mkdirSync(absolute, { recursive: true });
    return absolute;
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError(`runtime migration directory is unsafe: ${path.basename(absolute)}`, code);
  return absolute;
}

function walkRegularFiles(rootDir, options = {}) {
  const root = assertSafeDirectory(rootDir, options.code || "RUNTIME_EXPORT_UNSAFE");
  const files = [];
  function visit(directory) {
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw typedError("runtime export contains a linked directory", options.code || "RUNTIME_EXPORT_UNSAFE");
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw typedError("runtime export contains a symbolic link", options.code || "RUNTIME_EXPORT_UNSAFE");
      if (stat.isDirectory()) {
        visit(absolute);
      } else if (stat.isFile()) {
        const relative = path.relative(root, absolute).replace(/\\/g, "/");
        if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) throw typedError("runtime export path escaped its root", options.code || "RUNTIME_EXPORT_UNSAFE");
        if (!options.exclude || !options.exclude.has(relative)) files.push({ absolute, path: relative, size: stat.size, sha256: sha256File(absolute) });
      } else {
        throw typedError("runtime export contains a non-regular entry", options.code || "RUNTIME_EXPORT_UNSAFE");
      }
    }
  }
  visit(root);
  return files.sort((left, right) => compareText(left.path, right.path));
}

function manifestFingerprint(files) {
  return sha256(Buffer.from(JSON.stringify(files.map(({ path: relative, size, sha256: digest }) => ({ path: relative, size, sha256: digest })) )));
}

function verifyFileManifest(rootDir, expectedFiles) {
  const expected = new Map((expectedFiles || []).map((entry) => [entry.path, entry]));
  const actualFiles = walkRegularFiles(rootDir, {
    code: "RUNTIME_TARGET_UNSAFE",
    exclude: new Set([MIGRATION_MARKER_NAME]),
  });
  const actual = new Map(actualFiles.map((entry) => [entry.path, entry]));
  const mismatches = [];
  for (const [relative, expectedEntry] of expected) {
    const actualEntry = actual.get(relative);
    if (!actualEntry) mismatches.push({ path: relative, reason: "missing" });
    else if (actualEntry.size !== expectedEntry.size || actualEntry.sha256 !== expectedEntry.sha256) mismatches.push({ path: relative, reason: "hash-mismatch" });
  }
  for (const relative of actual.keys()) {
    if (!expected.has(relative)) mismatches.push({ path: relative, reason: "unexpected" });
  }
  mismatches.sort((left, right) => compareText(left.path, right.path) || compareText(left.reason, right.reason));
  return { ok: mismatches.length === 0, mismatches };
}

function timestampForFilename(now) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw typedError("runtime migration timestamp is invalid", "RUNTIME_MIGRATION_TIME_INVALID");
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function defaultDockerCopy(sourceContainer, destination, options = {}) {
  const dockerBin = options.dockerBin || "docker";
  const result = spawnSync(dockerBin, ["cp", `${sourceContainer}:${SOURCE_DATA_PATH}/.`, destination], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw typedError("docker could not export the existing runtime data", "RUNTIME_DOCKER_COPY_FAILED", result.error || new Error(String(result.stderr || "docker cp failed").trim()));
  }
}

function createArchive(sourceDir, archivePath, options = {}) {
  if (fs.existsSync(archivePath)) throw typedError("timestamped runtime backup already exists", "RUNTIME_BACKUP_EXISTS");
  const tarBin = options.tarBin || "tar";
  const result = spawnSync(tarBin, ["-czf", archivePath, "-C", sourceDir, "."], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !fs.existsSync(archivePath)) {
    try { fs.unlinkSync(archivePath); } catch (_) {}
    throw typedError("runtime migration could not create its timestamped backup", "RUNTIME_BACKUP_FAILED", result.error || new Error(String(result.stderr || "tar failed").trim()));
  }
  // Windows requires a writable handle for FlushFileBuffers/fsync. The archive
  // itself is already complete because the tar subprocess has exited.
  const descriptor = fs.openSync(archivePath, "r+");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fsyncDirectory(path.dirname(archivePath));
}

function validateSourceContainer(sourceContainer) {
  const value = String(sourceContainer || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) throw typedError("an explicit Docker source container name is required", "RUNTIME_SOURCE_CONTAINER_INVALID");
  return value;
}

function assertEmptyMigrationTarget(targetDir) {
  const target = assertNoLinkedComponents(targetDir, "RUNTIME_TARGET_UNSAFE");
  if (!fs.existsSync(target)) return target;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("runtime migration target is unsafe", "RUNTIME_TARGET_UNSAFE");
  if (fs.readdirSync(target).length > 0) throw typedError("runtime migration target is not empty", "RUNTIME_TARGET_NOT_EMPTY");
  return target;
}

function migrateRuntimeData(options = {}) {
  const sourceContainer = validateSourceContainer(options.sourceContainer);
  if (!options.targetDir) throw typedError("runtime migration target directory is required", "RUNTIME_TARGET_REQUIRED");
  const targetDir = assertEmptyMigrationTarget(options.targetDir);
  const now = options.now || new Date();
  const backupDir = assertSafeDirectory(options.backupDir || path.join(path.dirname(targetDir), "migration-backups"), "RUNTIME_BACKUP_UNSAFE", { create: true });
  const archivePath = path.join(backupDir, `fosu-runtime-data-${timestampForFilename(now)}.tar.gz`);
  if (fs.existsSync(archivePath) || fs.existsSync(`${archivePath}.sha256`)) throw typedError("timestamped runtime backup already exists", "RUNTIME_BACKUP_EXISTS");

  const exportDir = path.join(backupDir, `.runtime-export.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
  fs.mkdirSync(exportDir, { recursive: false });
  let stagingDir;
  try {
    const dockerCopy = options.dockerCopy || ((container, destination) => defaultDockerCopy(container, destination, options));
    dockerCopy(sourceContainer, exportDir);
    const exportedFiles = walkRegularFiles(exportDir, { code: "RUNTIME_EXPORT_UNSAFE" });
    if (exportedFiles.length === 0) throw typedError("the source container exported no runtime data", "RUNTIME_EXPORT_EMPTY");
    const files = exportedFiles.map(({ path: relative, size, sha256: digest }) => ({ path: relative, size, sha256: digest }));
    const dataFingerprint = manifestFingerprint(files);

    createArchive(exportDir, archivePath, options);
    const archiveSha256 = sha256File(archivePath);
    writeFileDurable(`${archivePath}.sha256`, Buffer.from(`${archiveSha256}  ${path.basename(archivePath)}\n`));

    const targetParent = assertSafeDirectory(path.dirname(targetDir), "RUNTIME_TARGET_UNSAFE", { create: true });
    stagingDir = path.join(targetParent, `.runtime-data-stage.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
    fs.cpSync(exportDir, stagingDir, { recursive: true, errorOnExist: true, force: false });
    const stagingCheck = verifyFileManifest(stagingDir, files);
    if (!stagingCheck.ok) throw typedError("staged runtime data does not match the exported manifest", "RUNTIME_STAGE_VERIFY_FAILED");

    const marker = {
      schemaVersion: 1,
      migratedAt: now.toISOString(),
      sourceContainer,
      sourcePath: SOURCE_DATA_PATH,
      archive: path.basename(archivePath),
      archiveSha256,
      dataFingerprint,
      files,
    };
    writeFileDurable(path.join(stagingDir, MIGRATION_MARKER_NAME), Buffer.from(`${JSON.stringify(marker, null, 2)}\n`));
    if (fs.existsSync(targetDir)) fs.rmdirSync(targetDir);
    fs.renameSync(stagingDir, targetDir);
    stagingDir = undefined;
    fsyncDirectory(targetParent);

    const finalCheck = verifyFileManifest(targetDir, files);
    if (!finalCheck.ok) throw typedError("migrated runtime data does not match its verified backup manifest", "RUNTIME_TARGET_VERIFY_FAILED");
    return {
      ...marker,
      archivePath,
    };
  } finally {
    if (stagingDir && fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    if (fs.existsSync(exportDir)) fs.rmSync(exportDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {};
  const names = new Map([
    ["--source-container", "sourceContainer"],
    ["--target-dir", "targetDir"],
    ["--backup-dir", "backupDir"],
    ["--docker-bin", "dockerBin"],
    ["--tar-bin", "tarBin"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = names.get(argv[index]);
    if (!key || index + 1 >= argv.length) throw typedError(`unknown or incomplete argument: ${argv[index]}`, "RUNTIME_MIGRATION_ARGUMENT_INVALID");
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

if (require.main === module) {
  try {
    const result = migrateRuntimeData(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "RUNTIME_MIGRATION_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MIGRATION_MARKER_NAME,
  migrateRuntimeData,
  verifyFileManifest,
};
