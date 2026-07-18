const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { requireType, sha256, stableId, stableStringify, typedError } = require("./contracts");
const { acquireExclusiveFileLock, acquireExclusiveFileLocks } = require("../../services/exclusiveFileLockService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../data"));
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const CATALOG_STAGING_DIR = path.join(DATA_DIR, "admin-catalog-staging");
const GENERATIONS_DIR = path.join(CATALOG_STAGING_DIR, "generations");
const CURRENT_GENERATION_PATH = path.join(CATALOG_STAGING_DIR, "current.json");
const BOOTSTRAP_JOURNAL_PATH = path.join(CATALOG_STAGING_DIR, "bootstrap.json");
const LOCKS_DIR = path.join(CATALOG_STAGING_DIR, "locks");
const META_PATH = path.join(STORAGE_DIR, "catalog-meta.json");
const LEGACY_PATHS = Object.freeze({
  catalog: path.join(STORAGE_DIR, "catalog.json"),
  class: path.join(STORAGE_DIR, "class-schedules.json"),
  teacher: path.join(STORAGE_DIR, "teacher-schedules.json"),
  classroom: path.join(STORAGE_DIR, "classroom-schedules.json"),
  course: path.join(STORAGE_DIR, "course-schedules.json"),
  major: path.join(STORAGE_DIR, "majors-index.json"),
});
const FILE_NAMES = Object.freeze({ catalog: "catalog.json", class: "class-schedules.json", teacher: "teacher-schedules.json", classroom: "classroom-schedules.json", course: "course-schedules.json", major: "majors-index.json" });
const RESOURCE_TYPES = Object.freeze(["class", "teacher", "classroom", "course", "major"]);

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function stringValue(value, fallback = "") {
  return String(value === undefined || value === null ? fallback : value).normalize("NFC").trim();
}

function assertChild(root, candidate, code = "CATALOG_TARGET_INVALID") {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw typedError("catalog path escaped its managed root", code, 500);
  return resolved;
}

function assertNoSymlink(root, candidate) {
  let cursor = path.resolve(candidate);
  const base = path.resolve(root);
  while (cursor.startsWith(base)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw typedError("catalog staging symlinks are not allowed", "CATALOG_TARGET_INVALID", 500);
    if (cursor === base) break;
    cursor = path.dirname(cursor);
  }
}

function assertManagedStagingRoots() {
  if (fs.existsSync(CATALOG_STAGING_DIR)) {
    const stat = fs.lstatSync(CATALOG_STAGING_DIR);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog staging root is unsafe", "CATALOG_TARGET_INVALID", 500);
  }
  if (fs.existsSync(GENERATIONS_DIR)) {
    const stat = fs.lstatSync(GENERATIONS_DIR);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog generations root is unsafe", "CATALOG_TARGET_INVALID", 500);
  }
}

function parseRaw(type, bytes, label = "catalog source") {
  let raw;
  try { raw = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (_) { throw typedError(`${label} is malformed`, "CATALOG_SOURCE_MALFORMED", 500); }
  if (type === "catalog") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.colleges || []) || !Array.isArray(raw.grades || [])) throw typedError(`${label} must be a catalog object`, "CATALOG_SOURCE_MALFORMED", 500);
  } else if (type === "major") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.colleges || []) || !stringValue(raw.semester)) throw typedError(`${label} must be a semester-scoped majors object`, "CATALOG_SOURCE_MALFORMED", 500);
  } else if (!Array.isArray(raw)) throw typedError(`${label} must be an array`, "CATALOG_SOURCE_MALFORMED", 500);
  return raw;
}

function versionForRaw(type, raw, rawSha256) {
  const logicalSha256 = sha256(stableStringify({ type, raw }));
  return { logicalSha256, version: `catalog_${logicalSha256.slice(0, 16)}_${rawSha256.slice(0, 12)}` };
}

function generationDir(generationId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(generationId || ""))) throw typedError("catalog generation id is invalid", "CATALOG_GENERATION_INVALID", 500);
  return assertChild(GENERATIONS_DIR, path.join(GENERATIONS_DIR, generationId), "CATALOG_GENERATION_INVALID");
}

function readCurrentPointer() {
  let pointer;
  try {
    assertNoSymlink(CATALOG_STAGING_DIR, CURRENT_GENERATION_PATH);
    pointer = JSON.parse(fs.readFileSync(CURRENT_GENERATION_PATH, "utf8"));
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("CATALOG_")) throw error;
    throw typedError("catalog staging current generation is missing or malformed", "CATALOG_GENERATION_INVALID", 500);
  }
  if (!pointer || pointer.schemaVersion !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(pointer.generationId || "")) || !/^[0-9a-f]{64}$/i.test(String(pointer.manifestSha256 || ""))) throw typedError("catalog staging current generation pointer is invalid", "CATALOG_GENERATION_INVALID", 500);
  return pointer;
}

function readGeneration(generationId) {
  const dir = generationDir(generationId);
  assertNoSymlink(GENERATIONS_DIR, dir);
  const manifestPath = path.join(dir, "manifest.json");
  let manifestBytes;
  let manifest;
  try { manifestBytes = fs.readFileSync(manifestPath); manifest = JSON.parse(manifestBytes.toString("utf8")); } catch (_) { throw typedError("catalog generation manifest is missing or malformed", "CATALOG_GENERATION_INVALID", 500); }
  if (!manifest || manifest.schemaVersion !== 1 || manifest.generationId !== generationId || !manifest.files || typeof manifest.files !== "object") throw typedError("catalog generation manifest is invalid", "CATALOG_GENERATION_INVALID", 500);
  const expected = Object.keys(FILE_NAMES).sort(compareText);
  if (stableStringify(Object.keys(manifest.files).sort(compareText)) !== stableStringify(expected)) throw typedError("catalog generation file set is invalid", "CATALOG_GENERATION_INVALID", 500);
  const files = {};
  for (const type of expected) {
    const filePath = assertChild(dir, path.join(dir, FILE_NAMES[type]), "CATALOG_GENERATION_INVALID");
    assertNoSymlink(dir, filePath);
    let bytes;
    try { bytes = fs.readFileSync(filePath); } catch (_) { throw typedError("catalog generation is incomplete", "CATALOG_GENERATION_INVALID", 500); }
    const raw = parseRaw(type, bytes, "catalog generation source");
    const record = manifest.files[type];
    if (!record || record.filename !== FILE_NAMES[type] || record.rawSha256 !== sha256(bytes) || record.size !== bytes.length) throw typedError("catalog generation source hash mismatch", "CATALOG_GENERATION_INVALID", 500);
    files[type] = { type, targetPath: filePath, rawBytes: bytes, raw, rawSha256: record.rawSha256, logicalSha256: record.logicalSha256, version: record.version };
  }
  return { generationId, dir, manifest, manifestPath, manifestSha256: sha256(manifestBytes), files };
}

function readCurrentGeneration() {
  if (!fs.existsSync(CURRENT_GENERATION_PATH) || fs.existsSync(BOOTSTRAP_JOURNAL_PATH)) return publishInitialGeneration();
  const pointer = readCurrentPointer();
  const generation = readGeneration(pointer.generationId);
  if (generation.manifestSha256 !== pointer.manifestSha256) throw typedError("catalog generation pointer hash mismatch", "CATALOG_GENERATION_INVALID", 500);
  return generation;
}

function readStableLegacySeed() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = {};
    for (const type of Object.keys(FILE_NAMES)) {
      const sourcePath = path.resolve(LEGACY_PATHS[type]);
      if (path.dirname(sourcePath) !== STORAGE_DIR || path.basename(sourcePath) !== FILE_NAMES[type]) throw typedError("legacy catalog seed path is not allowlisted", "CATALOG_SEED_PATH_INVALID", 500);
      try {
        if (fs.lstatSync(sourcePath).isSymbolicLink()) throw new Error("symlink");
        if (path.dirname(fs.realpathSync(sourcePath)) !== fs.realpathSync(STORAGE_DIR)) throw new Error("real path escaped storage");
      } catch (_) { throw typedError(`required legacy seed is unsafe: ${FILE_NAMES[type]}`, "CATALOG_SEED_PATH_INVALID", 500); }
      try { first[type] = fs.readFileSync(LEGACY_PATHS[type]); } catch (_) { throw typedError(`required legacy seed is missing: ${FILE_NAMES[type]}`, "CATALOG_SEED_UNREADABLE", 500); }
      parseRaw(type, first[type], "legacy catalog seed");
    }
    if (Object.keys(first).every((type) => {
      try { return sha256(fs.readFileSync(LEGACY_PATHS[type])) === sha256(first[type]); } catch (_) { return false; }
    })) return first;
  }
  throw typedError("legacy catalog sources changed during staging bootstrap", "CATALOG_SEED_CONFLICT", 409);
}

function buildManifest(generationId, fileBytes, provenance, operationId, createdAt = new Date().toISOString()) {
  const files = {};
  for (const type of Object.keys(FILE_NAMES)) {
    const bytes = fileBytes[type];
    const rawSha256 = sha256(bytes);
    const raw = parseRaw(type, bytes, "catalog planned generation");
    const logical = versionForRaw(type, raw, rawSha256);
    files[type] = { filename: FILE_NAMES[type], rawSha256, logicalSha256: logical.logicalSha256, version: logical.version, size: bytes.length, seed: provenance && provenance[type] || undefined };
  }
  return { schemaVersion: 1, generationId, sourceKind: "catalog-staging", published: false, label: "Catalog 工作区（未发布）", operationId: operationId || "seed", createdAt, files };
}

function buildingPathFor(generationId, operationId) {
  const operationSegment = String(operationId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!operationSegment || operationSegment.length > 80) throw typedError("catalog generation operation id is invalid", "CATALOG_GENERATION_INVALID", 500);
  return assertChild(CATALOG_STAGING_DIR, path.join(CATALOG_STAGING_DIR, `.building-${generationId}-${operationSegment}`));
}

function expectedGenerationFiles(fileBytes, manifest) {
  const expected = new Map(Object.keys(FILE_NAMES).map((type) => [FILE_NAMES[type], Buffer.from(fileBytes[type])]));
  expected.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  return expected;
}

function inspectBuildingDirectory(building, generationId, manifest, expected) {
  let stat;
  try { stat = fs.lstatSync(building); } catch (_) { return { exists: false, complete: false, owned: false }; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog generation build target is unsafe", "CATALOG_GENERATION_COLLISION", 500);
  const ownerName = ".owner.json";
  const allowed = new Set([...expected.keys(), ownerName]);
  const names = fs.readdirSync(building).sort(compareText);
  for (const name of names) {
    if (!allowed.has(name)) throw typedError("catalog generation build contains an unexpected artifact", "CATALOG_GENERATION_COLLISION", 500);
    const candidate = path.join(building, name);
    const candidateStat = fs.lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw typedError("catalog generation build contains an unsafe artifact", "CATALOG_GENERATION_COLLISION", 500);
  }
  let owned = false;
  if (names.includes(ownerName)) {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(building, ownerName), "utf8")); } catch (_) { throw typedError("catalog generation build owner is malformed", "CATALOG_GENERATION_COLLISION", 500); }
    owned = owner && owner.schemaVersion === 1 && owner.generationId === generationId && owner.operationId === manifest.operationId;
    if (!owned) throw typedError("catalog generation build owner does not match the operation", "CATALOG_GENERATION_COLLISION", 500);
  }
  for (const [name, bytes] of expected) {
    if (!names.includes(name)) continue;
    if (!fs.readFileSync(path.join(building, name)).equals(bytes)) throw typedError("catalog generation build bytes do not match the signed plan", "CATALOG_GENERATION_COLLISION", 500);
  }
  const complete = Array.from(expected.keys()).every((name) => names.includes(name));
  return { exists: true, complete, owned: owned || names.length === 0, names };
}

function removeRecoverableBuilding(building, inspection) {
  if (!inspection.owned) throw typedError("incomplete catalog generation build has no matching owner", "CATALOG_GENERATION_COLLISION", 500);
  for (const name of inspection.names || []) fs.unlinkSync(path.join(building, name));
  fs.rmdirSync(building);
}

function writeGenerationDirectory(generationId, fileBytes, manifest) {
  fs.mkdirSync(CATALOG_STAGING_DIR, { recursive: true });
  fs.mkdirSync(GENERATIONS_DIR, { recursive: true });
  const building = buildingPathFor(generationId, manifest.operationId);
  const finalDir = generationDir(generationId);
  if (fs.existsSync(finalDir)) throw typedError("catalog generation already exists", "CATALOG_GENERATION_COLLISION", 500);
  const expected = expectedGenerationFiles(fileBytes, manifest);
  const prior = inspectBuildingDirectory(building, generationId, manifest, expected);
  if (prior.exists && prior.complete) {
    if (prior.names.includes(".owner.json")) fs.unlinkSync(path.join(building, ".owner.json"));
    fs.renameSync(building, finalDir);
    return { finalDir, manifestSha256: sha256(expected.get("manifest.json")) };
  }
  if (prior.exists) removeRecoverableBuilding(building, prior);
  try {
    fs.mkdirSync(building, { recursive: false });
    fs.writeFileSync(path.join(building, ".owner.json"), `${JSON.stringify({ schemaVersion: 1, generationId, operationId: manifest.operationId })}\n`, { flag: "wx", mode: 0o600 });
    for (const type of Object.keys(FILE_NAMES)) fs.writeFileSync(path.join(building, FILE_NAMES[type]), fileBytes[type], { flag: "wx", mode: 0o600 });
    const manifestBytes = expected.get("manifest.json");
    fs.writeFileSync(path.join(building, "manifest.json"), manifestBytes, { flag: "wx", mode: 0o600 });
    for (const [type, record] of Object.entries(manifest.files)) if (sha256(fs.readFileSync(path.join(building, record.filename))) !== record.rawSha256) throw typedError("catalog generation verification failed", "CATALOG_GENERATION_VERIFY_FAILED", 500);
    fs.unlinkSync(path.join(building, ".owner.json"));
    fs.renameSync(building, finalDir);
    return { finalDir, manifestSha256: sha256(manifestBytes) };
  } catch (error) {
    try {
      const failed = inspectBuildingDirectory(building, generationId, manifest, expected);
      if (failed.exists && failed.owned) removeRecoverableBuilding(building, failed);
    } catch (_) {}
    throw error;
  }
}

function writePointerAtomic(pointer, operationId) {
  fs.mkdirSync(CATALOG_STAGING_DIR, { recursive: true });
  const temp = assertChild(CATALOG_STAGING_DIR, path.join(CATALOG_STAGING_DIR, `.current-${operationId}-${crypto.randomBytes(4).toString("hex")}.tmp`));
  try {
    fs.writeFileSync(temp, `${JSON.stringify(pointer, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    JSON.parse(fs.readFileSync(temp, "utf8"));
    fs.renameSync(temp, CURRENT_GENERATION_PATH);
  } catch (_) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw typedError("catalog generation pointer replacement failed", "CATALOG_POINTER_REPLACE_FAILED", 500);
  }
}

function writeBootstrapJournal(journal) {
  assertManagedStagingRoots();
  fs.mkdirSync(CATALOG_STAGING_DIR, { recursive: true });
  try {
    fs.writeFileSync(BOOTSTRAP_JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error && error.code === "EEXIST") throw typedError("catalog bootstrap journal already exists", "CATALOG_BOOTSTRAP_INVALID", 500);
    throw error;
  }
}

function readBootstrapJournal() {
  let journal;
  try {
    assertManagedStagingRoots();
    assertNoSymlink(CATALOG_STAGING_DIR, BOOTSTRAP_JOURNAL_PATH);
    const stat = fs.lstatSync(BOOTSTRAP_JOURNAL_PATH);
    if (!stat.isFile() || stat.isSymbolicLink()) throw typedError("catalog bootstrap journal is unsafe", "CATALOG_TARGET_INVALID", 500);
    journal = JSON.parse(fs.readFileSync(BOOTSTRAP_JOURNAL_PATH, "utf8"));
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("CATALOG_")) throw error;
    throw typedError("catalog bootstrap journal is missing or malformed", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  const valid = journal
    && journal.schemaVersion === 1
    && /^seed_[0-9a-f]{32}$/i.test(String(journal.operationId || ""))
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(journal.generationId || ""))
    && journal.manifest
    && journal.manifest.generationId === journal.generationId
    && journal.manifest.operationId === journal.operationId
    && journal.manifest.schemaVersion === 1
    && journal.manifest.files
    && typeof journal.manifest.files === "object"
    && journal.sourceHashes
    && Object.keys(FILE_NAMES).every((type) => journal.sourceHashes[type] === journal.manifest.files[type].rawSha256);
  if (!valid) throw typedError("catalog bootstrap journal is invalid", "CATALOG_BOOTSTRAP_INVALID", 500);
  return journal;
}

function inspectBootstrapBuilding(journal) {
  const building = buildingPathFor(journal.generationId, journal.operationId);
  if (!fs.existsSync(building)) return { building, exists: false, complete: false, owned: false, names: [] };
  const stat = fs.lstatSync(building);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog bootstrap build target is unsafe", "CATALOG_BOOTSTRAP_INVALID", 500);
  const expectedNames = new Set([...Object.values(FILE_NAMES), "manifest.json", ".owner.json"]);
  const names = fs.readdirSync(building).sort(compareText);
  for (const name of names) {
    if (!expectedNames.has(name)) throw typedError("catalog bootstrap build contains an unexpected artifact", "CATALOG_BOOTSTRAP_INVALID", 500);
    const candidate = path.join(building, name);
    const candidateStat = fs.lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw typedError("catalog bootstrap build contains an unsafe artifact", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  let owned = names.length === 0;
  if (names.includes(".owner.json")) {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(building, ".owner.json"), "utf8")); } catch (_) { throw typedError("catalog bootstrap build owner is malformed", "CATALOG_BOOTSTRAP_INVALID", 500); }
    owned = owner && owner.schemaVersion === 1 && owner.generationId === journal.generationId && owner.operationId === journal.operationId;
    if (!owned) throw typedError("catalog bootstrap build owner mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  for (const [type, filename] of Object.entries(FILE_NAMES)) {
    if (!names.includes(filename)) continue;
    const bytes = fs.readFileSync(path.join(building, filename));
    const record = journal.manifest.files[type];
    if (bytes.length !== record.size || sha256(bytes) !== record.rawSha256) throw typedError("catalog bootstrap build source mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  if (names.includes("manifest.json")) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(building, "manifest.json"), "utf8")); } catch (_) { throw typedError("catalog bootstrap build manifest is malformed", "CATALOG_BOOTSTRAP_INVALID", 500); }
    if (stableStringify(manifest) !== stableStringify(journal.manifest)) throw typedError("catalog bootstrap build manifest mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  const complete = [...Object.values(FILE_NAMES), "manifest.json"].every((name) => names.includes(name));
  if (!complete && !owned) throw typedError("incomplete catalog bootstrap build has no owner", "CATALOG_BOOTSTRAP_INVALID", 500);
  return { building, exists: true, complete, owned, names };
}

function removeBootstrapBuilding(inspection) {
  if (!inspection.exists || !inspection.owned) throw typedError("catalog bootstrap build cannot be safely restarted", "CATALOG_BOOTSTRAP_INVALID", 500);
  for (const name of inspection.names) fs.unlinkSync(path.join(inspection.building, name));
  fs.rmdirSync(inspection.building);
}

function finishBootstrapPointer(journal, manifestSha256) {
  const expectedPointer = { schemaVersion: 1, generationId: journal.generationId, manifestSha256 };
  const prefix = `.current-${journal.operationId}-`;
  const pointerTemps = fs.readdirSync(CATALOG_STAGING_DIR).filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"));
  if (pointerTemps.length > 1) throw typedError("catalog bootstrap has multiple pointer candidates", "CATALOG_BOOTSTRAP_INVALID", 500);
  if (pointerTemps.length === 1) {
    const candidate = path.join(CATALOG_STAGING_DIR, pointerTemps[0]);
    const stat = fs.lstatSync(candidate);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(candidate, "utf8")); } catch (_) { throw typedError("catalog bootstrap pointer candidate is malformed", "CATALOG_BOOTSTRAP_INVALID", 500); }
    if (!stat.isFile() || stat.isSymbolicLink() || stableStringify(parsed) !== stableStringify(expectedPointer)) throw typedError("catalog bootstrap pointer candidate is invalid", "CATALOG_BOOTSTRAP_INVALID", 500);
    fs.renameSync(candidate, CURRENT_GENERATION_PATH);
  } else {
    writePointerAtomic(expectedPointer, journal.operationId);
  }
}

function startBootstrap(seed) {
  const generationId = crypto.randomUUID();
  const operationId = `seed_${crypto.randomUUID().replace(/-/g, "")}`;
  const provenance = Object.fromEntries(Object.keys(seed).map((type) => [type, { sourceFile: FILE_NAMES[type], seedRawSha256: sha256(seed[type]), size: seed[type].length }]));
  const manifest = buildManifest(generationId, seed, provenance, operationId);
  const journal = { schemaVersion: 1, operationId, generationId, sourceHashes: Object.fromEntries(Object.keys(seed).map((type) => [type, sha256(seed[type])])), manifest, createdAt: new Date().toISOString() };
  writeBootstrapJournal(journal);
  return { journal, seed };
}

function publishInitialGeneration() {
  const bootstrapLock = path.join(DATA_DIR, ".admin-catalog-staging-bootstrap");
  const release = acquireExclusiveFileLocks([bootstrapLock], { codePrefix: "CATALOG", waitMs: Number(process.env.FOSU_CATALOG_LOCK_WAIT_MS || 1000), staleMs: Number(process.env.FOSU_CATALOG_LOCK_STALE_MS || 30000) });
  try {
    assertManagedStagingRoots();
    if (fs.existsSync(CURRENT_GENERATION_PATH)) {
      const pointer = readCurrentPointer();
      const generation = readGeneration(pointer.generationId);
      if (generation.manifestSha256 !== pointer.manifestSha256) throw typedError("catalog bootstrap pointer is invalid", "CATALOG_GENERATION_INVALID", 500);
      if (fs.existsSync(BOOTSTRAP_JOURNAL_PATH)) {
        const journal = readBootstrapJournal();
        if (journal.generationId !== generation.generationId || stableStringify(journal.manifest) !== stableStringify(generation.manifest)) throw typedError("catalog bootstrap journal does not match the published generation", "CATALOG_BOOTSTRAP_INVALID", 500);
        fs.unlinkSync(BOOTSTRAP_JOURNAL_PATH);
      }
      return generation;
    }
    let state;
    if (fs.existsSync(BOOTSTRAP_JOURNAL_PATH)) {
      const journal = readBootstrapJournal();
      state = { journal, seed: null };
    } else {
      if (fs.existsSync(CATALOG_STAGING_DIR)) {
        const names = fs.readdirSync(CATALOG_STAGING_DIR);
        const emptyGenerations = names.length === 1 && names[0] === "generations" && fs.existsSync(GENERATIONS_DIR) && fs.readdirSync(GENERATIONS_DIR).length === 0;
        if (names.length && !emptyGenerations) throw typedError("catalog staging exists without a bootstrap journal", "CATALOG_BOOTSTRAP_INVALID", 500);
      }
      state = startBootstrap(readStableLegacySeed());
    }
    const { journal } = state;
    const finalDir = generationDir(journal.generationId);
    let written;
    if (fs.existsSync(finalDir)) {
      const generation = readGeneration(journal.generationId);
      if (stableStringify(generation.manifest) !== stableStringify(journal.manifest)) throw typedError("catalog bootstrap final generation does not match its journal", "CATALOG_BOOTSTRAP_INVALID", 500);
      written = { manifestSha256: generation.manifestSha256 };
    } else {
      const partial = inspectBootstrapBuilding(journal);
      if (partial.complete) {
        if (partial.names.includes(".owner.json")) fs.unlinkSync(path.join(partial.building, ".owner.json"));
        fs.mkdirSync(GENERATIONS_DIR, { recursive: true });
        fs.renameSync(partial.building, finalDir);
        written = { manifestSha256: sha256(Buffer.from(`${JSON.stringify(journal.manifest, null, 2)}\n`, "utf8")) };
      } else {
        const seed = state.seed || readStableLegacySeed();
        const unchanged = Object.keys(FILE_NAMES).every((type) => sha256(seed[type]) === journal.sourceHashes[type]);
        if (!unchanged) {
          if (partial.exists) removeBootstrapBuilding(partial);
          fs.unlinkSync(BOOTSTRAP_JOURNAL_PATH);
          state = startBootstrap(seed);
          written = writeGenerationDirectory(state.journal.generationId, state.seed, state.journal.manifest);
          finishBootstrapPointer(state.journal, written.manifestSha256);
          fs.unlinkSync(BOOTSTRAP_JOURNAL_PATH);
          return readGeneration(state.journal.generationId);
        }
        written = writeGenerationDirectory(journal.generationId, seed, journal.manifest);
      }
    }
    finishBootstrapPointer(journal, written.manifestSha256);
    fs.unlinkSync(BOOTSTRAP_JOURNAL_PATH);
    return readGeneration(journal.generationId);
  } finally { release(); }
}

function sourceIdentity(type, generation, raw) {
  const semesters = new Set();
  if (type === "major") semesters.add(stringValue(raw.semester));
  else for (const item of raw) if (item && item.semester) semesters.add(stringValue(item.semester));
  return { kind: "catalog-staging", published: false, label: "Catalog 工作区（未发布）", type, generationId: generation.generationId, semesters: Array.from(semesters).filter(Boolean).sort(compareText) };
}

function readSnapshot(type, generation = readCurrentGeneration()) {
  const normalizedType = requireType(type);
  const file = generation.files[normalizedType];
  return { ...file, generationId: generation.generationId, source: sourceIdentity(normalizedType, generation, file.raw) };
}

function readRelationshipSnapshot(generation = readCurrentGeneration()) {
  const file = generation.files.catalog;
  return { ...file, generationId: generation.generationId };
}

function readMeta() {
  try { const raw = JSON.parse(fs.readFileSync(META_PATH, "utf8")); return raw && raw.entries && typeof raw.entries === "object" ? raw.entries : raw || {}; } catch (_) { return {}; }
}

function metadataFor(meta, type, id, legacyName) { return meta[`${type}::${id}`] || meta[`${type}::${legacyName}`] || {}; }
function uniqueCount(courses, field) { return new Set((courses || []).map((course) => stringValue(course && course[field])).filter(Boolean)).size; }

function normalizeScheduleRow(type, item, meta) {
  const semester = stringValue(item.semester);
  if (!semester) throw typedError("every staged catalog row requires an explicit semester", "CATALOG_SOURCE_SEMESTER_REQUIRED", 500);
  const courses = Array.isArray(item.courses) ? item.courses : [];
  const base = { semester };
  let name;
  if (type === "class") {
    name = stringValue(item.className);
    Object.assign(base, { className: name, collegeCode: stringValue(item.collegeCode), collegeName: stringValue(item.collegeName, "其他"), grade: stringValue(item.grade), majorCode: stringValue(item.majorCode), majorName: stringValue(item.majorName, "通用"), coursesCount: courses.length });
  } else if (type === "teacher") {
    name = stringValue(item.teacherName);
    Object.assign(base, { teacherName: name, collegeName: stringValue(item.collegeName, "教务系统"), coursesCount: courses.length, classesCount: uniqueCount(courses, "className") });
  } else if (type === "classroom") {
    name = stringValue(item.roomName);
    const occupied = new Set();
    for (const course of courses) for (const week of Array.isArray(course.weeks) ? course.weeks : []) for (const section of Array.isArray(course.sections) ? course.sections : []) occupied.add(`${week}:${course.dayOfWeek || course.weekday || ""}:${section}`);
    const match = name.match(/^([^\d]+)/);
    Object.assign(base, { roomName: name, buildingName: stringValue(item.buildingName, match ? match[1] : "其他"), coursesCount: courses.length, occupationRate: Math.min(100, Math.round((occupied.size / 98) * 100)) });
  } else {
    name = stringValue(item.courseName);
    Object.assign(base, { courseName: name, collegeName: stringValue(item.collegeName, "教务公开课"), teachersCount: uniqueCount(courses, "teacherName"), classesCount: uniqueCount(courses, "className"), classroomsCount: uniqueCount(courses, "classroom") });
  }
  base.id = stableId(type, { ...item, ...base });
  const info = metadataFor(meta, type, base.id, name);
  return { id: base.id, ...base, displayName: stringValue(info.displayName), note: stringValue(info.note), hidden: info.hidden === true, tags: Array.isArray(info.tags) ? info.tags.map(String) : [] };
}

function flattenMajorEntries(raw) {
  const entries = [];
  const semester = stringValue(raw.semester);
  for (const college of raw.colleges || []) for (const grade of college.grades || []) for (const major of grade.majors || []) {
    const item = { semester, collegeCode: stringValue(college.collegeCode || college.code), collegeName: stringValue(college.collegeName || college.name), grade: stringValue(grade.grade), majorCode: stringValue(major.majorCode || major.code), majorName: stringValue(major.majorName || major.name) };
    entries.push({ id: stableId("major", item), item });
  }
  return entries;
}

function rowsFromRaw(type, raw) {
  const normalizedType = requireType(type);
  const meta = readMeta();
  const rows = normalizedType === "major" ? flattenMajorEntries(raw).map(({ id, item }) => {
    const info = metadataFor(meta, "major", id, item.majorCode);
    return { id, ...item, displayName: stringValue(info.displayName), note: stringValue(info.note), hidden: info.hidden === true, tags: Array.isArray(info.tags) ? info.tags.map(String) : [] };
  }) : raw.map((item) => normalizeScheduleRow(normalizedType, item || {}, meta));
  const seen = new Set();
  for (const row of rows) { if (seen.has(row.id)) throw typedError("catalog source contains duplicate stable ids", "CATALOG_SOURCE_DUPLICATE_ID", 500); seen.add(row.id); }
  return rows.sort((a, b) => compareText(a.id, b.id));
}

function rowsForType(type) {
  const generation = readCurrentGeneration();
  const snapshot = readSnapshot(type, generation);
  return { rows: rowsFromRaw(snapshot.type, snapshot.raw), snapshot, generation };
}

function entriesFromRaw(type, raw) {
  const normalizedType = requireType(type);
  return normalizedType === "major" ? flattenMajorEntries(raw).map(({ id, item }) => ({ id, item })) : raw.map((item) => ({ id: stableId(normalizedType, item), item }));
}

function getRelationships(generation = readCurrentGeneration()) {
  const dependency = readRelationshipSnapshot(generation);
  const major = readSnapshot("major", generation);
  const names = new Map((dependency.raw.colleges || []).map((college) => [stringValue(college.code || college.collegeCode), stringValue(college.name || college.collegeName)]));
  const colleges = (major.raw.colleges || []).map((college) => {
    const id = stringValue(college.collegeCode || college.code);
    return { id, name: names.get(id) || stringValue(college.collegeName || college.name), grades: (college.grades || []).map((grade) => ({ grade: stringValue(grade.grade), majors: (grade.majors || []).map((item) => ({ id: stringValue(item.majorCode || item.code), name: stringValue(item.majorName || item.name) })).sort((a, b) => compareText(a.id, b.id)) })).sort((a, b) => compareText(b.grade, a.grade)) };
  }).sort((a, b) => compareText(a.id, b.id));
  return { colleges, source: major.source, relationshipVersion: dependency.version, generationId: generation.generationId };
}

function validateMajorRelationships(document, dependency) {
  if (document.type !== "major") return dependency;
  const snapshot = dependency || readRelationshipSnapshot();
  const colleges = new Set((snapshot.raw.colleges || []).map((item) => stringValue(item.code || item.collegeCode)));
  const grades = new Set((snapshot.raw.grades || []).map(stringValue));
  const failures = [];
  document.items.forEach((item, index) => { if (!colleges.has(item.collegeCode) || !grades.has(item.grade)) failures.push(index); });
  if (failures.length) throw typedError("major import contains orphan relationships", "ORPHAN_RELATIONSHIP", 400, { itemIndexes: failures });
  return snapshot;
}

function mergeSchedules(snapshot, document) {
  const byId = new Map(entriesFromRaw(document.type, snapshot.raw).map(({ id, item }) => [id, item]));
  for (const item of document.items) {
    const id = stableId(document.type, item);
    const previous = byId.get(id) || {};
    byId.set(id, { ...previous, ...item, courses: item.courses === undefined ? (previous.courses || []) : item.courses });
  }
  return Array.from(byId.entries()).sort(([a], [b]) => compareText(a, b)).map(([, item]) => item);
}

function mergeMajors(snapshot, document) {
  if (stringValue(snapshot.raw.semester) !== document.semester) throw typedError("major staging semester does not match import semester", "SEMESTER_MISMATCH", 400);
  const out = JSON.parse(JSON.stringify(snapshot.raw));
  for (const item of document.items) {
    let college = out.colleges.find((entry) => stringValue(entry.collegeCode || entry.code) === item.collegeCode);
    if (!college) { college = { collegeCode: item.collegeCode, collegeName: item.collegeName, grades: [] }; out.colleges.push(college); }
    let grade = (college.grades || []).find((entry) => stringValue(entry.grade) === item.grade);
    if (!grade) { grade = { grade: item.grade, majors: [] }; college.grades = (college.grades || []).concat(grade); }
    let major = (grade.majors || []).find((entry) => stringValue(entry.majorCode || entry.code) === item.majorCode);
    if (!major) grade.majors.push({ majorCode: item.majorCode, majorName: item.majorName });
    else { if ("majorCode" in major) major.majorCode = item.majorCode; else major.code = item.majorCode; if ("majorName" in major) major.majorName = item.majorName; else major.name = item.majorName; }
    grade.majors.sort((a, b) => compareText(a.majorCode || a.code, b.majorCode || b.code));
    college.grades.sort((a, b) => compareText(b.grade, a.grade));
  }
  out.colleges.sort((a, b) => compareText(a.collegeCode || a.code, b.collegeCode || b.code));
  out.grades = Array.from(new Set(out.colleges.flatMap((college) => (college.grades || []).map((grade) => stringValue(grade.grade))))).sort((a, b) => compareText(b, a));
  out.version = `majors_${sha256(stableStringify(out.colleges)).slice(0, 20)}`;
  return out;
}

function mergeImport(snapshot, document) {
  if (!snapshot || snapshot.type !== document.type) throw typedError("catalog snapshot target mismatch", "CATALOG_TARGET_INVALID", 500);
  return document.type === "major" ? mergeMajors(snapshot, document) : mergeSchedules(snapshot, document);
}

function acquireMutationLocks(type, previewPath) {
  readCurrentGeneration();
  const lockOptions = { codePrefix: "CATALOG", waitMs: Number(process.env.FOSU_CATALOG_LOCK_WAIT_MS || 1000), staleMs: Number(process.env.FOSU_CATALOG_LOCK_STALE_MS || 30000) };
  const releaseGeneration = acquireExclusiveFileLock(CURRENT_GENERATION_PATH, lockOptions);
  const paths = [path.join(LOCKS_DIR, `${requireType(type)}.target`)];
  if (previewPath) paths.push(previewPath);
  if (type === "major") paths.push(path.join(LOCKS_DIR, "catalog.relationship"));
  let releaseRest;
  try { releaseRest = acquireExclusiveFileLocks(paths, lockOptions); } catch (error) { try { releaseGeneration(); } catch (_) {} throw error; }
  return () => {
    let firstError = null;
    let warnings = [];
    try { const result = releaseRest(); if (result && result.warnings) warnings = warnings.concat(result.warnings); } catch (error) { firstError = error; }
    try { const result = releaseGeneration(); if (result && result.warning) warnings.push(result.warning); } catch (error) { if (!firstError) firstError = error; }
    if (firstError) throw firstError;
    return warnings.length ? { warnings } : undefined;
  };
}

function createBackup(snapshot, operationId, metadata = {}) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const id = `catalog-import-${snapshot.type}-${operationId}`;
  const backupPath = path.join(BACKUPS_DIR, `${id}.json`);
  const manifestPath = path.join(BACKUPS_DIR, `${id}.manifest`);
  const manifest = {
    schemaVersion: 1,
    id,
    operationId,
    type: snapshot.type,
    target: FILE_NAMES[snapshot.type],
    sourceKind: "catalog-staging",
    generationId: snapshot.generationId,
    existed: true,
    preWriteSha256: snapshot.rawSha256,
    backupSha256: snapshot.rawSha256,
    size: snapshot.rawBytes.length,
    baseVersion: snapshot.version,
    resultSha256: metadata.resultSha256,
    resultVersion: metadata.resultVersion,
    createdAt: metadata.createdAt,
  };
  if (!Number.isFinite(Date.parse(String(manifest.createdAt || "")))) throw typedError("catalog backup timestamp is invalid", "CATALOG_BACKUP_FAILED", 500);
  const assertRegular = (filePath) => {
    if (!fs.existsSync(filePath)) return false;
    let stat;
    try { stat = fs.lstatSync(filePath); } catch (_) { throw typedError("catalog backup artifact cannot be inspected", "CATALOG_BACKUP_FAILED", 500); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw typedError("catalog backup artifact is unsafe", "CATALOG_BACKUP_FAILED", 500);
    return true;
  };
  try {
    if (assertRegular(backupPath)) {
      const existing = fs.readFileSync(backupPath);
      if (existing.length !== snapshot.rawBytes.length || sha256(existing) !== snapshot.rawSha256) throw typedError("catalog backup bytes do not match the immutable base", "CATALOG_BACKUP_VERIFY_FAILED", 500);
    } else {
      fs.writeFileSync(backupPath, snapshot.rawBytes, { flag: "wx", mode: 0o600 });
    }
    if (assertRegular(manifestPath)) {
      let existingManifest;
      try { existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (_) { throw typedError("catalog backup manifest is malformed", "CATALOG_BACKUP_VERIFY_FAILED", 500); }
      if (stableStringify(existingManifest) !== stableStringify(manifest)) throw typedError("catalog backup manifest does not match the immutable operation", "CATALOG_BACKUP_VERIFY_FAILED", 500);
    } else {
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("CATALOG_")) throw error;
    throw typedError("catalog backup could not be created", "CATALOG_BACKUP_FAILED", 500);
  }
  if (sha256(fs.readFileSync(backupPath)) !== snapshot.rawSha256
      || stableStringify(JSON.parse(fs.readFileSync(manifestPath, "utf8"))) !== stableStringify(manifest)) {
    throw typedError("catalog backup verification failed", "CATALOG_BACKUP_VERIFY_FAILED", 500);
  }
  return { id, path: backupPath, manifestPath, manifest };
}

function planGeneration(generation, type, raw, operationId, options = {}) {
  const normalizedType = requireType(type);
  const generationId = options.generationId || crypto.randomUUID();
  const createdAt = options.createdAt || new Date().toISOString();
  const bytes = Object.fromEntries(Object.keys(FILE_NAMES).map((key) => [key, generation.files[key].rawBytes]));
  bytes[normalizedType] = Buffer.from(`${JSON.stringify(raw, null, 2)}\n`, "utf8");
  parseRaw(normalizedType, bytes[normalizedType], "catalog planned replacement");
  const provenance = Object.fromEntries(Object.entries(generation.manifest.files).map(([key, value]) => [key, value.seed]));
  const manifest = buildManifest(generationId, bytes, provenance, operationId, createdAt);
  const resultRecord = manifest.files[normalizedType];
  return { generationId, createdAt, baseGenerationId: generation.generationId, type: normalizedType, bytes, manifest, result: { rawSha256: resultRecord.rawSha256, logicalSha256: resultRecord.logicalSha256, version: resultRecord.version } };
}

function commitPlannedGeneration(plan, operationId) {
  let written;
  const finalDir = generationDir(plan.generationId);
  if (fs.existsSync(finalDir)) {
    const existing = readGeneration(plan.generationId);
    if (stableStringify(existing.manifest) !== stableStringify(plan.manifest)) throw typedError("existing planned generation does not match operation journal", "CATALOG_GENERATION_COLLISION", 500);
    written = { finalDir, manifestSha256: existing.manifestSha256 };
  } else {
    written = writeGenerationDirectory(plan.generationId, plan.bytes, plan.manifest);
  }
  writePointerAtomic({ schemaVersion: 1, generationId: plan.generationId, manifestSha256: written.manifestSha256 }, operationId);
  return readGeneration(plan.generationId);
}

function currentGenerationId() {
  return readCurrentGeneration().generationId;
}

function targetPathForType(type) {
  const generation = readCurrentGeneration();
  return readSnapshot(type, generation).targetPath;
}

module.exports = {
  BACKUPS_DIR,
  BOOTSTRAP_JOURNAL_PATH,
  CATALOG_STAGING_DIR,
  CURRENT_GENERATION_PATH,
  DATA_DIR,
  FILE_NAMES,
  GENERATIONS_DIR,
  LEGACY_PATHS,
  META_PATH,
  RESOURCE_TYPES,
  STORAGE_DIR,
  acquireMutationLocks,
  commitPlannedGeneration,
  createBackup,
  currentGenerationId,
  entriesFromRaw,
  getRelationships,
  mergeImport,
  planGeneration,
  readCurrentGeneration,
  readGeneration,
  readRelationshipSnapshot,
  readSnapshot,
  rowsForType,
  rowsFromRaw,
  targetPathForType,
  validateMajorRelationships,
};
