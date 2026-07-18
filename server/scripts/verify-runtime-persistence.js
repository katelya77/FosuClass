const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_SELECTORS = [
  { path: "admin-audit-log.jsonl", domain: "audit", mode: "append-only" },
  { path: "backups", domain: "backups", mode: "exact" },
  { path: "sync-history.json", domain: "sync", mode: "exact" },
  { path: "admin-catalog-staging", domain: "catalog", mode: "exact" },
  { path: "ai", domain: "runtime-ai", mode: "exact" },
  { path: ".fosu-runtime-bootstrap.json", domain: "migration", mode: "exact" },
  { path: ".fosu-runtime-migration.json", domain: "migration", mode: "exact" },
];

const STORAGE_SELECTORS = [
  { path: "admin-config.json", domain: "configuration", mode: "exact" },
  { path: "notices.json", domain: "configuration", mode: "exact" },
  { path: "news.json", domain: "configuration", mode: "exact" },
  { path: "sync-meta.json", domain: "sync", mode: "exact" },
  { path: "jobs", domain: "jobs", mode: "exact" },
  { path: "quality-ignores.json", domain: "quality", mode: "exact" },
  { path: "catalog-meta.json", domain: "catalog", mode: "exact" },
  { path: "campus-map", domain: "runtime-ai", mode: "exact" },
  { path: "assistant-kb.json", domain: "runtime-ai", mode: "exact" },
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

function sha256File(filePath, byteLimit = null) {
  const descriptor = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let remaining = byteLimit === null ? null : Math.max(0, Number(byteLimit));
  try {
    while (remaining === null || remaining > 0) {
      const requested = remaining === null ? buffer.length : Math.min(buffer.length, remaining);
      if (requested === 0) break;
      const read = fs.readSync(descriptor, buffer, 0, requested, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      if (remaining !== null) remaining -= read;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
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

function collectSelector(rootDir, rootName, selector) {
  const selectorPath = path.join(rootDir, selector.path.split("/").join(path.sep));
  const firstStat = lstatIfPresent(selectorPath);
  if (!firstStat) return [];
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
    files.push({
      root: rootName,
      path: relative,
      domain: selector.domain,
      mode: selector.mode,
      size: stat.size,
      sha256: sha256File(absolute),
    });
  }
  visit(selectorPath);
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
  for (const selector of DATA_SELECTORS) files.push(...collectSelector(dataDir, "data", selector));
  for (const selector of STORAGE_SELECTORS) files.push(...collectSelector(storageDir, "storage", selector));
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
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.files)) throw typedError("persistence snapshot schema is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
  return snapshot.files.map((entry) => {
    if (!entry || !["data", "storage"].includes(entry.root)) throw typedError("persistence snapshot root is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    const relative = normalizeRelativePath(entry.path);
    if (!DOMAIN_NAMES.includes(entry.domain) || !["exact", "append-only"].includes(entry.mode)) throw typedError("persistence snapshot policy is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) throw typedError("persistence snapshot hash metadata is invalid", "RUNTIME_PERSISTENCE_SNAPSHOT_INVALID");
    return { ...entry, path: relative };
  });
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
      if (target.stat.size < entry.size) {
        mismatches.push({ root: entry.root, path: entry.path, reason: "append-truncated" });
      } else if (sha256File(target.path, entry.size) !== entry.sha256) {
        mismatches.push({ root: entry.root, path: entry.path, reason: "append-prefix-mismatch" });
      }
    } else if (target.stat.size !== entry.size || sha256File(target.path) !== entry.sha256) {
      mismatches.push({ root: entry.root, path: entry.path, reason: "hash-mismatch" });
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
