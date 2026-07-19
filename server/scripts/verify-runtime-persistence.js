const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_SELECTORS = [
  { path: "admin-audit-log.jsonl", domain: "audit", mode: "append-only" },
  { path: "backups", domain: "backups", mode: "exact" },
  { path: "sync-history.json", domain: "sync", mode: "exact" },
  { path: "admin-catalog-staging", domain: "catalog", mode: "exact" },
  { path: "catalog-control", domain: "catalog", mode: "exact" },
  { path: "ai", domain: "runtime-ai", mode: "exact" },
  { path: ".fosu-runtime-bootstrap.json", domain: "migration", mode: "exact" },
  { path: ".fosu-runtime-migration.json", domain: "migration", mode: "exact" },
  { path: "*", domain: "runtime-data", mode: "exact" },
];

const STORAGE_SELECTORS = [
  { path: "admin-config.json", domain: "configuration", mode: "exact" },
  { path: "notices.json", domain: "configuration", mode: "exact" },
  { path: "news.json", domain: "configuration", mode: "exact" },
  { path: "sync-meta.json", domain: "sync", mode: "exact" },
  { path: "jobs", domain: "jobs", mode: "exact" },
  { path: "quality-ignores.json", domain: "quality", mode: "exact" },
  { path: "catalog-meta.json", domain: "catalog", mode: "exact" },
  { path: "releases", domain: "release", mode: "exact" },
  { path: "snapshots", domain: "release", mode: "exact" },
  { path: "public", domain: "runtime", mode: "exact" },
  { path: "release-lifecycle-state.json", domain: "release", mode: "exact" },
  { path: "static-release-sync-status.json", domain: "release", mode: "exact" },
  { path: "feedback.jsonl", domain: "feedback", mode: "exact" },
  { path: "feedbacks.json", domain: "feedback", mode: "exact" },
  { path: "contributions.json", domain: "feedback", mode: "exact" },
  { path: "relay", domain: "relay", mode: "exact" },
  { path: "publisher-receipts", domain: "relay", mode: "exact" },
  { path: "staging-uploads", domain: "sync", mode: "exact" },
  { path: "staging-direct-upload", domain: "sync", mode: "exact" },
  { path: "resource-upload-staging", domain: "sync", mode: "exact" },
  { path: "staging-latest.json", domain: "sync", mode: "exact" },
  { path: "upload-record-index.json", domain: "sync", mode: "exact" },
  { path: "terms", domain: "term", mode: "exact" },
  { path: "term-registry.json", domain: "term", mode: "exact" },
  { path: "term-registry-migration-report.json", domain: "term", mode: "exact" },
  { path: "campus-map", domain: "runtime-ai", mode: "exact" },
  { path: "assistant-kb.json", domain: "runtime-ai", mode: "exact" },
  { path: "backups", domain: "backups", mode: "exact" },
  { path: "maintenance-status.json", domain: "maintenance", mode: "exact" },
  { path: "*", domain: "runtime-storage", mode: "exact" },
];

const DOMAIN_NAMES = Array.from(new Set(DATA_SELECTORS.concat(STORAGE_SELECTORS).map((entry) => entry.domain))).sort(compareText);

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

function hashDescriptor(descriptor, byteLimit) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let remaining = Math.max(0, Number(byteLimit));
  let position = 0;
  while (remaining > 0) {
    const requested = Math.min(buffer.length, remaining);
    const read = fs.readSync(descriptor, buffer, 0, requested, position);
    if (!read) break;
    hash.update(buffer.subarray(0, read));
    remaining -= read;
    position += read;
  }
  return { sha256: hash.digest("hex"), bytesRead: position };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function openRegularNoFollow(filePath) {
  const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  const stat = fs.fstatSync(descriptor);
  if (!stat.isFile()) {
    fs.closeSync(descriptor);
    throw typedError(`persistence target is not a regular file: ${path.basename(filePath)}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE");
  }
  return { descriptor, stat };
}

function captureFileRecord(filePath, mode, context = {}, options = {}) {
  let observerCalled = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let opened;
    try {
      opened = openRegularNoFollow(filePath);
      const before = opened.stat;
      if (!observerCalled && typeof options.onFileOpened === "function") {
        observerCalled = true;
        options.onFileOpened(context);
      }
      const digest = hashDescriptor(opened.descriptor, before.size);
      const after = fs.fstatSync(opened.descriptor);
      const identityStable = sameFileIdentity(before, after);
      const complete = digest.bytesRead === before.size;
      const contentWindowStable = mode === "append-only"
        ? after.size >= before.size
        : after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs;
      if (identityStable && complete && contentWindowStable) {
        return { size: before.size, sha256: digest.sha256 };
      }
    } catch (error) {
      if (error && ["ELOOP", "EMLINK"].includes(error.code)) {
        throw typedError(`persistence selection contains a link: ${path.basename(filePath)}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE", error);
      }
      if (error && error.code === "RUNTIME_PERSISTENCE_PATH_UNSAFE") throw error;
      if (attempt === 3) throw error;
    } finally {
      if (opened) fs.closeSync(opened.descriptor);
    }
  }
  throw typedError(`persistence file did not remain stable while captured: ${path.basename(filePath)}`, "RUNTIME_PERSISTENCE_FILE_UNSTABLE");
}

function readPrefixRecord(filePath, byteLimit) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let opened;
    try {
      opened = openRegularNoFollow(filePath);
      const before = opened.stat;
      if (before.size < byteLimit) return { truncated: true, size: before.size };
      const digest = hashDescriptor(opened.descriptor, byteLimit);
      const after = fs.fstatSync(opened.descriptor);
      if (sameFileIdentity(before, after) && after.size >= byteLimit && digest.bytesRead === byteLimit) {
        return { truncated: false, size: after.size, sha256: digest.sha256 };
      }
    } catch (error) {
      if (error && ["ELOOP", "EMLINK"].includes(error.code)) {
        throw typedError(`persistence target contains a link: ${path.basename(filePath)}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE", error);
      }
      if (error && error.code === "RUNTIME_PERSISTENCE_PATH_UNSAFE") throw error;
      if (attempt === 3) throw error;
    } finally {
      if (opened) fs.closeSync(opened.descriptor);
    }
  }
  throw typedError(`persistence file did not remain stable while verified: ${path.basename(filePath)}`, "RUNTIME_PERSISTENCE_FILE_UNSTABLE");
}

function lstatIfPresent(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertSafeRoot(rootDir) {
  const absolute = path.resolve(rootDir);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) throw typedError(`persistence root is missing: ${path.basename(absolute)}`, "RUNTIME_PERSISTENCE_ROOT_MISSING");
    if (stat.isSymbolicLink()) throw typedError(`persistence root contains a link: ${path.basename(current)}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE");
  }
  const rootStat = lstatIfPresent(absolute);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) throw typedError(`persistence root is unsafe: ${path.basename(absolute)}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE");
  return absolute;
}

function normalizeRelativePath(value) {
  const input = String(value || "");
  if (!input || input.includes("\\") || input.includes("\0") || path.posix.isAbsolute(input)) throw typedError("persistence snapshot contains an unsafe path", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
  const normalized = path.posix.normalize(input);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized !== input) throw typedError("persistence snapshot contains an unsafe path", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
  return normalized;
}

function policyForPath(relative, selectors) {
  return selectors.find((selector) => selector.path !== "*"
    && (relative === selector.path || relative.startsWith(`${selector.path}/`)))
    || selectors.find((selector) => selector.path === "*");
}

function collectRoot(rootDir, rootName, selectors, options = {}) {
  const files = [];
  function visit(absolute) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw typedError(`persistence selection contains a link: ${path.basename(absolute)}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE");
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(absolute).sort(compareText);
      for (const entry of entries) visit(path.join(absolute, entry));
      return;
    }
    if (!stat.isFile()) throw typedError(`persistence selection contains a non-regular entry: ${path.basename(absolute)}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE");
    const relative = path.relative(rootDir, absolute).replace(/\\/g, "/");
    normalizeRelativePath(relative);
    const selector = policyForPath(relative, selectors);
    if (!selector) throw typedError(`persistence path has no policy: ${relative}`, "RUNTIME_PERSISTENCE_POLICY_MISSING");
    const record = captureFileRecord(absolute, selector.mode, { root: rootName, path: relative, domain: selector.domain, mode: selector.mode }, options);
    files.push({
      root: rootName,
      path: relative,
      domain: selector.domain,
      mode: selector.mode,
      size: record.size,
      sha256: record.sha256,
    });
  }
  visit(rootDir);
  return files;
}

function stableFileEntries(files) {
  return files.map((entry) => ({
    root: entry.root,
    path: entry.path,
    domain: entry.domain,
    mode: entry.mode,
    size: entry.size,
    sha256: entry.sha256,
  }));
}

function capturePersistenceSnapshot(options = {}) {
  const dataDir = assertSafeRoot(options.dataDir || process.env.FOSU_DATA_DIR || path.join(__dirname, "../data"));
  const storageDir = assertSafeRoot(options.storageDir || process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../storage"));
  const now = options.now || new Date();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw typedError("persistence snapshot time is invalid", "RUNTIME_PERSISTENCE_TIME_INVALID");
  const files = [];
  files.push(...collectRoot(dataDir, "data", DATA_SELECTORS, options));
  files.push(...collectRoot(storageDir, "storage", STORAGE_SELECTORS, options));
  files.sort((left, right) => compareText(left.root, right.root) || compareText(left.path, right.path) || compareText(left.domain, right.domain));
  const domains = Object.fromEntries(DOMAIN_NAMES.map((name) => [name, 0]));
  for (const entry of files) domains[entry.domain] += 1;
  const stableFiles = stableFileEntries(files);
  return {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    fingerprint: sha256(Buffer.from(JSON.stringify(stableFiles))),
    domains,
    files: stableFiles,
  };
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.files) || snapshot.files.length === 0
      || !Number.isFinite(Date.parse(String(snapshot.capturedAt || "")))) {
    throw typedError("persistence snapshot schema is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
  }
  const seen = new Set();
  const files = snapshot.files.map((entry) => {
    if (!entry || !["data", "storage"].includes(entry.root)) throw typedError("persistence snapshot root is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    const relative = normalizeRelativePath(entry.path);
    if (!DOMAIN_NAMES.includes(entry.domain) || !["exact", "append-only"].includes(entry.mode)) throw typedError("persistence snapshot policy is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    const expectedPolicy = policyForPath(relative, entry.root === "data" ? DATA_SELECTORS : STORAGE_SELECTORS);
    if (!expectedPolicy || entry.domain !== expectedPolicy.domain || entry.mode !== expectedPolicy.mode) {
      throw typedError("persistence snapshot path policy is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) throw typedError("persistence snapshot hash metadata is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    const identity = `${entry.root}\0${relative}`;
    if (seen.has(identity)) throw typedError("persistence snapshot contains duplicate paths", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    seen.add(identity);
    return { ...entry, path: relative };
  });
  files.sort((left, right) => compareText(left.root, right.root) || compareText(left.path, right.path) || compareText(left.domain, right.domain));
  if (!files.some((entry) => entry.root === "data") || !files.some((entry) => entry.root === "storage")) {
    throw typedError("persistence snapshot is missing a managed root", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
  }
  const stableFiles = stableFileEntries(files);
  if (snapshot.fingerprint !== sha256(Buffer.from(JSON.stringify(stableFiles)))) {
    throw typedError("persistence snapshot fingerprint is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
  }
  const domains = Object.fromEntries(DOMAIN_NAMES.map((name) => [name, 0]));
  for (const entry of files) domains[entry.domain] += 1;
  if (!snapshot.domains || JSON.stringify(snapshot.domains) !== JSON.stringify(domains)) {
    throw typedError("persistence snapshot domain evidence is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
  }
  return files;
}

function assertSafeSnapshotTarget(rootDir, relative) {
  let current = rootDir;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) return { path: current, stat: null };
    if (stat.isSymbolicLink()) throw typedError(`persistence target contains a link: ${part}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE");
  }
  return { path: current, stat: lstatIfPresent(current) };
}

function verifyPersistenceSnapshot(snapshot, options = {}) {
  const files = validateSnapshot(snapshot);
  const roots = {
    data: assertSafeRoot(options.dataDir || process.env.FOSU_DATA_DIR || path.join(__dirname, "../data")),
    storage: assertSafeRoot(options.storageDir || process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../storage")),
  };
  const mismatches = [];
  for (const entry of files) {
    const target = assertSafeSnapshotTarget(roots[entry.root], entry.path);
    if (!target.stat) {
      mismatches.push({ root: entry.root, path: entry.path, reason: "missing" });
      continue;
    }
    if (!target.stat.isFile() || target.stat.isSymbolicLink()) throw typedError(`persistence target is not a regular file: ${entry.path}`, "RUNTIME_PERSISTENCE_PATH_UNSAFE");
    if (entry.mode === "append-only") {
      const current = readPrefixRecord(target.path, entry.size);
      if (current.truncated) {
        mismatches.push({ root: entry.root, path: entry.path, reason: "append-truncated" });
      } else if (current.sha256 !== entry.sha256) {
        mismatches.push({ root: entry.root, path: entry.path, reason: "append-prefix-mismatch" });
      }
    } else {
      const current = captureFileRecord(target.path, "exact", { root: entry.root, path: entry.path, domain: entry.domain, mode: entry.mode });
      if (current.size !== entry.size || current.sha256 !== entry.sha256) {
        mismatches.push({ root: entry.root, path: entry.path, reason: "hash-mismatch" });
      }
    }
  }
  mismatches.sort((left, right) => compareText(left.root, right.root) || compareText(left.path, right.path) || compareText(left.reason, right.reason));
  return { ok: mismatches.length === 0, mismatches, verifiedFileCount: files.length };
}

function writeJsonAtomic(filePath, value) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temp = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temp, absolute);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || !["capture", "verify"].includes(command)) throw typedError("expected capture or verify", "RUNTIME_PERSISTENCE_ARGUMENT_INVALID");
  const options = { command };
  const keys = new Map([
    ["--data-dir", "dataDir"],
    ["--storage-dir", "storageDir"],
    ["--output", "output"],
    ["--snapshot", "snapshot"],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const key = keys.get(argv[index]);
    if (!key || index + 1 >= argv.length) throw typedError(`unknown or incomplete argument: ${argv[index]}`, "RUNTIME_PERSISTENCE_ARGUMENT_INVALID");
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function runCli(argv) {
  const options = parseArgs(argv);
  let result;
  if (options.command === "capture") {
    result = capturePersistenceSnapshot(options);
  } else {
    if (!options.snapshot) throw typedError("verify requires --snapshot", "RUNTIME_PERSISTENCE_ARGUMENT_INVALID");
    const snapshotPath = path.resolve(options.snapshot);
    const stat = fs.lstatSync(snapshotPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw typedError("snapshot file is unsafe", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    result = verifyPersistenceSnapshot(JSON.parse(fs.readFileSync(snapshotPath, "utf8")), options);
    if (!result.ok) process.exitCode = 2;
  }
  if (options.output) writeJsonAtomic(options.output, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "RUNTIME_PERSISTENCE_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DATA_SELECTORS,
  STORAGE_SELECTORS,
  capturePersistenceSnapshot,
  verifyPersistenceSnapshot,
};
