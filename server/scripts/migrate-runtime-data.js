const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MIGRATION_MARKER_NAME = ".fosu-runtime-migration.json";
const BOOTSTRAP_MARKER_NAME = ".fosu-runtime-bootstrap.json";
const CONTROL_MARKER_NAMES = new Set([MIGRATION_MARKER_NAME, BOOTSTRAP_MARKER_NAME]);
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

function hardenMode(target, mode, code) {
  try { fs.chmodSync(target, mode); }
  catch (error) {
    if (process.platform !== "win32") throw typedError(`runtime migration could not secure ${path.basename(target)}`, code, error);
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

function runDockerControl(args, options, code) {
  const dockerBin = options.dockerBin || "docker";
  const result = spawnSync(dockerBin, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw typedError(`docker ${args[0]} failed`, code, result.error || new Error(String(result.stderr || "docker command failed").trim()));
  }
  return String(result.stdout || "").trim();
}

function defaultDockerControl(options = {}) {
  return {
    inspect(sourceContainer) {
      const output = runDockerControl(["inspect", sourceContainer], options, "RUNTIME_SOURCE_INSPECT_FAILED");
      let record;
      try { record = JSON.parse(output)[0]; } catch (error) { throw typedError("docker returned an invalid source state", "RUNTIME_SOURCE_INSPECT_FAILED", error); }
      if (!record || !record.State) throw typedError("docker source inspection is incomplete", "RUNTIME_SOURCE_INSPECT_FAILED");
      return {
        running: record.State.Running === true,
        paused: record.State.Paused === true,
        containerId: String(record.Id || ""),
        imageId: String(record.Image || ""),
        imageRef: String(record.Config && record.Config.Image || "").slice(0, 300),
        startedAt: String(record.State.StartedAt || ""),
        finishedAt: String(record.State.FinishedAt || ""),
        restartCount: Number.isSafeInteger(record.RestartCount) ? record.RestartCount : 0,
        mounts: Array.isArray(record.Mounts) ? record.Mounts.map((mount) => ({
          type: String(mount && mount.Type || ""),
          source: String(mount && mount.Source || ""),
          destination: String(mount && mount.Destination || ""),
          rw: mount && mount.RW === true,
        })) : [],
      };
    },
    pause(sourceContainer) { runDockerControl(["pause", sourceContainer], options, "RUNTIME_SOURCE_PAUSE_FAILED"); },
    unpause(sourceContainer) { runDockerControl(["unpause", sourceContainer], options, "RUNTIME_SOURCE_UNPAUSE_FAILED"); },
  };
}

function copyFromConsistentSource(sourceContainer, destination, options, dockerCopy) {
  const control = options.dockerControl || defaultDockerControl(options);
  const state = control.inspect(sourceContainer);
  if (!state || typeof state.running !== "boolean" || typeof state.paused !== "boolean") {
    throw typedError("runtime source state is invalid", "RUNTIME_SOURCE_INSPECT_FAILED");
  }
  let pausedByMigration = false;
  if (state.running && !state.paused) {
    control.pause(sourceContainer);
    pausedByMigration = true;
  }
  const consistency = state.running
    ? { sourceState: state.paused ? "paused" : "running", quiesceMethod: state.paused ? "already-paused" : "docker-pause", quiesced: true }
    : { sourceState: "stopped", quiesceMethod: "container-stopped", quiesced: true };
  consistency.sourceIdentity = {
    containerId: String(state.containerId || "unknown"),
    imageId: String(state.imageId || "unknown"),
    imageRef: String(state.imageRef || "unknown").slice(0, 300),
    startedAt: String(state.startedAt || "unknown"),
    finishedAt: String(state.finishedAt || "unknown"),
    restartCount: Number.isSafeInteger(state.restartCount) ? state.restartCount : 0,
  };
  try {
    dockerCopy(sourceContainer, destination);
    return {
      consistency,
      resumeRequired: pausedByMigration,
      release() {
        if (!pausedByMigration) return;
        control.unpause(sourceContainer);
        pausedByMigration = false;
      },
    };
  } catch (error) {
    if (pausedByMigration) {
      try { control.unpause(sourceContainer); } catch (resumeError) { error.resumeError = resumeError; }
    }
    throw error;
  }
}

function createArchive(sourceDir, archivePath, options = {}) {
  if (fs.existsSync(archivePath)) throw typedError("timestamped runtime backup already exists", "RUNTIME_BACKUP_EXISTS");
  const reserved = fs.openSync(archivePath, "wx", 0o600);
  fs.closeSync(reserved);
  const tarBin = options.tarBin || "tar";
  const result = spawnSync(tarBin, ["-czf", archivePath, "-C", sourceDir, "."], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !fs.existsSync(archivePath)) {
    try { fs.unlinkSync(archivePath); } catch (_) {}
    throw typedError("runtime migration could not create its timestamped backup", "RUNTIME_BACKUP_FAILED", result.error || new Error(String(result.stderr || "tar failed").trim()));
  }
  hardenMode(archivePath, 0o600, "RUNTIME_BACKUP_PERMISSION_FAILED");
  // Windows requires a writable handle for FlushFileBuffers/fsync. The archive
  // itself is already complete because the tar subprocess has exited.
  const descriptor = fs.openSync(archivePath, "r+");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fsyncDirectory(path.dirname(archivePath));
}

function normalizeArchiveMember(value) {
  let member = String(value || "").trim().replace(/^\.\//, "").replace(/\/$/, "");
  if (!member || member === ".") return null;
  if (member.includes("\\") || path.posix.isAbsolute(member) || path.posix.normalize(member) !== member || member.startsWith("../")) {
    throw typedError("runtime backup contains an unsafe archive member", "RUNTIME_BACKUP_CONTENT_INVALID");
  }
  return member;
}

function verifyArchiveContents(archivePath, expectedFiles, backupDir, options = {}) {
  const tarBin = options.tarBin || "tar";
  const listing = spawnSync(tarBin, ["-tzf", archivePath], { encoding: "utf8", windowsHide: true });
  if (listing.error || listing.status !== 0) {
    throw typedError("runtime backup could not be listed", "RUNTIME_BACKUP_CONTENT_INVALID", listing.error || new Error(String(listing.stderr || "tar list failed").trim()));
  }
  for (const line of String(listing.stdout || "").split(/\r?\n/)) normalizeArchiveMember(line);

  const extractionDir = path.join(backupDir, `.archive-verify.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
  fs.mkdirSync(extractionDir, { recursive: false, mode: 0o700 });
  hardenMode(extractionDir, 0o700, "RUNTIME_BACKUP_PERMISSION_FAILED");
  try {
    const extracted = spawnSync(tarBin, ["-xzf", archivePath, "-C", extractionDir], { encoding: "utf8", windowsHide: true });
    if (extracted.error || extracted.status !== 0) {
      throw typedError("runtime backup could not be extracted", "RUNTIME_BACKUP_CONTENT_INVALID", extracted.error || new Error(String(extracted.stderr || "tar extract failed").trim()));
    }
    const actual = walkRegularFiles(extractionDir, { code: "RUNTIME_BACKUP_CONTENT_INVALID" })
      .map(({ path: relative, size, sha256: digest }) => ({ path: relative, size, sha256: digest }));
    const expected = (expectedFiles || []).map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 }))
      .sort((left, right) => compareText(left.path, right.path));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw typedError("runtime backup extraction does not match its source manifest", "RUNTIME_BACKUP_CONTENT_INVALID");
    }
    return true;
  } finally {
    try { fs.rmSync(extractionDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function ensureDurableDirectory(rootDir, relativeParent) {
  let current = rootDir;
  for (const segment of String(relativeParent || "").split("/").filter(Boolean)) {
    const parent = current;
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { recursive: false, mode: 0o700 });
      hardenMode(current, 0o700, "RUNTIME_TARGET_PERMISSION_FAILED");
      fsyncDirectory(parent);
    } else {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("runtime target parent is unsafe", "RUNTIME_TARGET_UNSAFE");
    }
  }
  return current;
}

function copyFileDurable(source, destination) {
  const sourceDescriptor = fs.openSync(source, "r");
  let targetDescriptor;
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    targetDescriptor = fs.openSync(destination, "wx", 0o600);
    let position = 0;
    for (;;) {
      const read = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, position);
      if (!read) break;
      let written = 0;
      while (written < read) {
        const count = fs.writeSync(targetDescriptor, buffer, written, read - written, position + written);
        if (!count) throw typedError("runtime migration copy made no progress", "RUNTIME_STAGE_COPY_FAILED");
        written += count;
      }
      position += read;
    }
    fs.fsyncSync(targetDescriptor);
  } catch (error) {
    try { fs.unlinkSync(destination); } catch (_) {}
    if (error && error.code && String(error.code).startsWith("RUNTIME_")) throw error;
    throw typedError("runtime migration could not durably stage a file", "RUNTIME_STAGE_COPY_FAILED", error);
  } finally {
    fs.closeSync(sourceDescriptor);
    if (targetDescriptor !== undefined) fs.closeSync(targetDescriptor);
  }
  fsyncDirectory(path.dirname(destination));
}

function validateSourceContainer(sourceContainer) {
  const value = String(sourceContainer || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) throw typedError("an explicit Docker source container name is required", "RUNTIME_SOURCE_CONTAINER_INVALID");
  return value;
}

function inspectMigrationTarget(targetDir) {
  const target = assertNoLinkedComponents(targetDir, "RUNTIME_TARGET_UNSAFE");
  if (!fs.existsSync(target)) return { target, empty: true };
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("runtime migration target is unsafe", "RUNTIME_TARGET_UNSAFE");
  return { target, empty: fs.readdirSync(target).length === 0 };
}

function readJsonRegular(filePath, code) {
  if (!fs.existsSync(filePath)) throw typedError(`required migration artifact is missing: ${path.basename(filePath)}`, code);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw typedError(`migration artifact is unsafe: ${path.basename(filePath)}`, code);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) { throw typedError(`migration artifact is malformed: ${path.basename(filePath)}`, code, error); }
}

function validateMigrationMarker(marker, sourceContainer) {
  const files = Array.isArray(marker && marker.files)
    ? marker.files.map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 }))
    : [];
  const uniquePaths = new Set(files.map((entry) => entry.path));
  const valid = marker
    && marker.schemaVersion === 1
    && marker.sourceContainer === sourceContainer
    && marker.sourcePath === SOURCE_DATA_PATH
    && Number.isFinite(Date.parse(String(marker.migratedAt || "")))
    && typeof marker.archive === "string"
    && path.basename(marker.archive) === marker.archive
    && /^fosu-runtime-data-[A-Za-z0-9._-]+\.tar\.gz$/.test(marker.archive)
    && /^[a-f0-9]{64}$/.test(String(marker.archiveSha256 || ""))
    && /^[a-f0-9]{64}$/.test(String(marker.dataFingerprint || ""))
    && files.length > 0
    && uniquePaths.size === files.length
    && files.every((entry) => typeof entry.path === "string"
      && entry.path
      && !entry.path.includes("\\")
      && !path.posix.isAbsolute(entry.path)
      && path.posix.normalize(entry.path) === entry.path
      && !entry.path.startsWith("../")
      && !CONTROL_MARKER_NAMES.has(entry.path)
      && Number.isSafeInteger(entry.size)
      && entry.size >= 0
      && /^[a-f0-9]{64}$/.test(String(entry.sha256 || "")))
    && manifestFingerprint(files) === marker.dataFingerprint;
  if (!valid) throw typedError("existing runtime migration marker is invalid", "RUNTIME_MIGRATION_MARKER_INVALID");
  return files;
}

function sameResolvedPath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function validateReconcileAuthority(marker, receipt, targetDir, sourceContainer, options = {}) {
  const control = options.dockerControl || defaultDockerControl(options);
  const state = control.inspect(sourceContainer);
  if (!state || typeof state.running !== "boolean" || typeof state.paused !== "boolean") {
    throw typedError("runtime source state is invalid during reconciliation", "RUNTIME_SOURCE_INSPECT_FAILED");
  }
  const dataMount = (Array.isArray(state.mounts) ? state.mounts : []).find((mount) => {
    const destination = String(mount && (mount.destination || mount.Destination) || "");
    const source = String(mount && (mount.source || mount.Source) || "");
    const type = String(mount && (mount.type || mount.Type) || "");
    const writable = mount && (mount.rw === true || mount.RW === true);
    return destination === SOURCE_DATA_PATH && type === "bind" && writable && sameResolvedPath(source, targetDir);
  });
  if (dataMount && receipt) return "same-persistent-bind";

  const identity = marker && marker.sourceConsistency && marker.sourceConsistency.sourceIdentity || {};
  const sameLifecycle = String(state.containerId || "") === String(identity.containerId || "")
    && String(state.imageId || "") === String(identity.imageId || "")
    && String(state.startedAt || "unknown") === String(identity.startedAt || "unknown")
    && Number(state.restartCount || 0) === Number(identity.restartCount || 0)
    && (state.running || String(state.finishedAt || "unknown") === String(identity.finishedAt || "unknown"));
  const stillFrozen = state.paused === true || state.running === false;
  if (sameLifecycle && stillFrozen) return "same-frozen-container";
  throw typedError(
    "the authoritative source may have resumed writes after this target generation was captured",
    "RUNTIME_MIGRATION_SOURCE_STALE"
  );
}

function reconcileExistingMigration(targetDir, backupDirInput, sourceContainer, options = {}) {
  const markerPath = path.join(targetDir, MIGRATION_MARKER_NAME);
  if (!fs.existsSync(markerPath)) throw typedError("runtime migration target is not empty", "RUNTIME_TARGET_NOT_EMPTY");
  const marker = readJsonRegular(markerPath, "RUNTIME_MIGRATION_MARKER_INVALID");
  const files = validateMigrationMarker(marker, sourceContainer);
  const bootstrapPath = path.join(targetDir, BOOTSTRAP_MARKER_NAME);
  if (fs.existsSync(bootstrapPath)) {
    const receipt = readJsonRegular(bootstrapPath, "RUNTIME_MIGRATION_MARKER_INVALID");
    const markerSha256 = sha256File(markerPath);
    if (!receipt || receipt.state !== "migration-accepted" || receipt.migrationVerified !== true
        || receipt.migrationMarkerSha256 !== markerSha256
        || receipt.migrationDataFingerprint !== marker.dataFingerprint
        || receipt.migrationArchiveSha256 !== marker.archiveSha256) {
      throw typedError("runtime bootstrap receipt is not bound to the migration", "RUNTIME_MIGRATION_MARKER_INVALID");
    }
  } else {
    const exact = verifyFileManifest(targetDir, files);
    if (!exact.ok) throw typedError("unaccepted migrated runtime data no longer matches its manifest", "RUNTIME_TARGET_VERIFY_FAILED");
  }
  const backupDir = assertSafeDirectory(backupDirInput, "RUNTIME_BACKUP_UNSAFE");
  const archivePath = path.join(backupDir, marker.archive);
  for (const candidate of [archivePath, `${archivePath}.sha256`, `${archivePath}.manifest.json`]) {
    const stat = fs.existsSync(candidate) ? fs.lstatSync(candidate) : null;
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw typedError("verified runtime migration backup is missing or unsafe", "RUNTIME_BACKUP_MISSING");
  }
  const archiveSha256 = sha256File(archivePath);
  const sidecarSha256 = fs.readFileSync(`${archivePath}.sha256`, "utf8").trim().split(/\s+/)[0];
  if (archiveSha256 !== marker.archiveSha256 || sidecarSha256 !== marker.archiveSha256) {
    throw typedError("verified runtime migration backup hash mismatch", "RUNTIME_BACKUP_HASH_MISMATCH");
  }
  const backupManifest = readJsonRegular(`${archivePath}.manifest.json`, "RUNTIME_BACKUP_MANIFEST_INVALID");
  if (JSON.stringify(backupManifest) !== JSON.stringify(marker)) {
    throw typedError("runtime migration target marker does not match the independent backup manifest", "RUNTIME_BACKUP_MANIFEST_INVALID");
  }
  const archiveVerified = verifyArchiveContents(
    archivePath,
    files.concat(Array.isArray(marker.sourceControlFiles) ? marker.sourceControlFiles : []),
    backupDir,
    options
  );
  const reconcileAuthority = validateReconcileAuthority(marker, fs.existsSync(bootstrapPath), targetDir, sourceContainer, options);
  return { ...marker, files, archivePath, reconciled: true, reconcileAuthority, archiveVerified };
}

function allocateArchivePath(backupDir, timestamp) {
  const stem = `fosu-runtime-data-${timestamp}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const candidate = path.join(backupDir, `${stem}${suffix}.tar.gz`);
    if (!fs.existsSync(candidate) && !fs.existsSync(`${candidate}.sha256`) && !fs.existsSync(`${candidate}.manifest.json`)) return candidate;
  }
  throw typedError("runtime migration could not allocate a unique backup name", "RUNTIME_BACKUP_EXISTS");
}

function migrateRuntimeData(options = {}) {
  const sourceContainer = validateSourceContainer(options.sourceContainer);
  if (!options.targetDir) throw typedError("runtime migration target directory is required", "RUNTIME_TARGET_REQUIRED");
  const targetState = inspectMigrationTarget(options.targetDir);
  const targetDir = targetState.target;
  const backupDirInput = path.resolve(options.backupDir || path.join(path.dirname(targetDir), "migration-backups"));
  if (!targetState.empty) return reconcileExistingMigration(targetDir, backupDirInput, sourceContainer, options);
  const now = options.now || new Date();
  const backupDir = assertSafeDirectory(backupDirInput, "RUNTIME_BACKUP_UNSAFE", { create: true });
  hardenMode(backupDir, 0o700, "RUNTIME_BACKUP_PERMISSION_FAILED");
  const archivePath = allocateArchivePath(backupDir, timestampForFilename(now));

  const exportDir = path.join(backupDir, `.runtime-export.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
  fs.mkdirSync(exportDir, { recursive: false, mode: 0o700 });
  hardenMode(exportDir, 0o700, "RUNTIME_BACKUP_PERMISSION_FAILED");
  let stagingDir;
  let sourceLease;
  let migrationSucceeded = false;
  try {
    const dockerCopy = options.dockerCopy || ((container, destination) => defaultDockerCopy(container, destination, options));
    sourceLease = copyFromConsistentSource(sourceContainer, exportDir, options, dockerCopy);
    const exportedFiles = walkRegularFiles(exportDir, { code: "RUNTIME_EXPORT_UNSAFE" });
    const businessFiles = exportedFiles.filter((entry) => !CONTROL_MARKER_NAMES.has(entry.path));
    const sourceControlFiles = exportedFiles.filter((entry) => CONTROL_MARKER_NAMES.has(entry.path))
      .map(({ path: relative, size, sha256: digest }) => ({ path: relative, size, sha256: digest }));
    if (businessFiles.length === 0) throw typedError("the source container exported no runtime business data", "RUNTIME_EXPORT_EMPTY");
    const files = businessFiles.map(({ path: relative, size, sha256: digest }) => ({ path: relative, size, sha256: digest }));
    const dataFingerprint = manifestFingerprint(files);

    createArchive(exportDir, archivePath, options);
    const archiveSha256 = sha256File(archivePath);
    const archiveVerified = verifyArchiveContents(
      archivePath,
      files.concat(sourceControlFiles),
      backupDir,
      options
    );
    writeFileDurable(`${archivePath}.sha256`, Buffer.from(`${archiveSha256}  ${path.basename(archivePath)}\n`));
    hardenMode(`${archivePath}.sha256`, 0o600, "RUNTIME_BACKUP_PERMISSION_FAILED");

    const targetParent = assertSafeDirectory(path.dirname(targetDir), "RUNTIME_TARGET_UNSAFE", { create: true });
    stagingDir = path.join(targetParent, `.runtime-data-stage.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
    fs.mkdirSync(stagingDir, { recursive: false, mode: 0o700 });
    hardenMode(stagingDir, 0o700, "RUNTIME_TARGET_PERMISSION_FAILED");
    for (const entry of businessFiles) {
      const destination = path.join(stagingDir, entry.path.split("/").join(path.sep));
      const parentRelative = path.posix.dirname(entry.path) === "." ? "" : path.posix.dirname(entry.path);
      ensureDurableDirectory(stagingDir, parentRelative);
      copyFileDurable(entry.absolute, destination);
    }
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
      sourceControlFiles,
      sourceConsistency: {
        ...sourceLease.consistency,
        resumeRequired: sourceLease.resumeRequired,
      },
    };
    writeFileDurable(`${archivePath}.manifest.json`, Buffer.from(`${JSON.stringify(marker, null, 2)}\n`));
    hardenMode(`${archivePath}.manifest.json`, 0o600, "RUNTIME_BACKUP_PERMISSION_FAILED");
    writeFileDurable(path.join(stagingDir, MIGRATION_MARKER_NAME), Buffer.from(`${JSON.stringify(marker, null, 2)}\n`));
    if (fs.existsSync(targetDir)) fs.rmdirSync(targetDir);
    fs.renameSync(stagingDir, targetDir);
    stagingDir = undefined;
    hardenMode(targetDir, 0o700, "RUNTIME_TARGET_PERMISSION_FAILED");
    fsyncDirectory(targetParent);

    const finalCheck = verifyFileManifest(targetDir, files);
    if (!finalCheck.ok) throw typedError("migrated runtime data does not match its verified backup manifest", "RUNTIME_TARGET_VERIFY_FAILED");
    migrationSucceeded = true;
    if (sourceLease.resumeRequired && options.keepSourceQuiesced === false) sourceLease.release();
    return {
      ...marker,
      archivePath,
      archiveVerified,
      sourceDisposition: sourceLease.resumeRequired
        ? (options.keepSourceQuiesced === false ? "resumed-after-export" : "left-quiesced-for-cutover")
        : "already-quiesced",
      ...(sourceLease.resumeRequired && options.keepSourceQuiesced !== false ? {
        operatorActionRequired: "source container remains paused; cut over or unpause it on every failure/termination path",
      } : {}),
    };
  } catch (error) {
    if (sourceLease && sourceLease.resumeRequired) {
      try { sourceLease.release(); } catch (resumeError) { error.resumeError = resumeError; }
    }
    throw error;
  } finally {
    try { if (stagingDir && fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
    try { if (fs.existsSync(exportDir)) fs.rmSync(exportDir, { recursive: true, force: true }); } catch (_) {}
    if (!migrationSucceeded && sourceLease && sourceLease.resumeRequired) {
      try { sourceLease.release(); } catch (_) {}
    }
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
    if (argv[index] === "--release-source-on-success") {
      options.keepSourceQuiesced = false;
      continue;
    }
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
