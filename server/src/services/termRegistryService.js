const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { safeLog } = require("../utils/safeLogger");
const { compareTerms, releaseIsHealthy, sortVisibleTerms } = require("../../../shared/termVisibility");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const REGISTRY_PATH = path.join(STORAGE_DIR, "term-registry.json");
const BACKUP_DIR = path.join(STORAGE_DIR, "backups", "term-registry");
const MIGRATION_REPORT_PATH = path.join(STORAGE_DIR, "term-registry-migration-report.json");
const TERMS_DIR = path.join(STORAGE_DIR, "terms");

// legacy compatibility fallback: only used to keep the already published 2025-2026-2 data readable
// when older production manifests do not contain a termConfig block.
const LEGACY_CURRENT_TERM_CONFIG = Object.freeze({
  term: "2025-2026-2",
  semesterText: "2025-2026学年第二学期",
  termStartDate: "2026-03-09",
  totalWeeks: 19,
  weekStart: "monday",
  source: "legacy-compatibility-fallback",
});

const TERM_STATUSES = new Set(["planned", "ready", "current", "archived", "disabled"]);
const WEEK_STARTS = new Set(["monday", "sunday"]);
const TERM_ID_RE = /^\d{4}-\d{4}-[12]$/;

let registryCache = null;
let registryCacheMtimeMs = 0;

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed == null ? fallback : parsed;
  } catch (error) {
    safeLog("term-registry-read-json-failed", { filePath, error: error.message });
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (cleanupError) {}
  }
}

function backupRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return "";
  ensureDir(BACKUP_DIR);
  const stamp = nowIso().replace(/[:.]/g, "-");
  const target = path.join(BACKUP_DIR, `term-registry-${stamp}.json`);
  fs.copyFileSync(REGISTRY_PATH, target);
  return target;
}

function validateTermId(term) {
  const value = String(term || "").trim();
  if (!TERM_ID_RE.test(value)) {
    return { valid: false, term: value, error: "TERM_ID_FORMAT" };
  }
  const parts = value.split("-");
  const firstYear = Number(parts[0]);
  const secondYear = Number(parts[1]);
  if (secondYear !== firstYear + 1) {
    return { valid: false, term: value, error: "TERM_YEAR_RANGE" };
  }
  return { valid: true, term: value };
}

function assertTermId(term) {
  const result = validateTermId(term);
  if (!result.valid) {
    const error = new Error(result.error);
    error.code = result.error;
    error.statusCode = 400;
    throw error;
  }
  return result.term;
}

function generateSemesterText(term) {
  const value = assertTermId(term);
  const [startYear, endYear, half] = value.split("-");
  return `${startYear}-${endYear}学年${half === "1" ? "第一" : "第二"}学期`;
}

function hasExplicitValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function normalizeTotalWeeks(value, fallback) {
  const number = Number(hasExplicitValue(value) ? value : fallback);
  return Number.isFinite(number) ? Math.floor(number) : NaN;
}

function normalizeTermRecord(record = {}, options = {}) {
  const source = record && typeof record === "object" ? record : {};
  const term = assertTermId(source.term || options.term);
  const now = options.now || nowIso();
  let totalWeeks = normalizeTotalWeeks(source.totalWeeks, options.defaultTotalWeeks);
  if (!Number.isFinite(totalWeeks) && options.allowLegacyCurrentTermFallback && term === LEGACY_CURRENT_TERM_CONFIG.term) {
    totalWeeks = LEGACY_CURRENT_TERM_CONFIG.totalWeeks;
  }
  return {
    term,
    semesterText: String(source.semesterText || generateSemesterText(term)).trim(),
    termStartDate: String(source.termStartDate || "").trim(),
    totalWeeks,
    weekStart: WEEK_STARTS.has(source.weekStart) ? source.weekStart : "monday",
    status: TERM_STATUSES.has(source.status) ? source.status : "planned",
    releaseVersion: String(source.releaseVersion || source.activeReleaseVersion || "").trim(),
    dataAvailable: Boolean(source.dataAvailable),
    publishedAt: String(source.publishedAt || "").trim(),
    updatedAt: String(source.updatedAt || now).trim(),
    source: String(source.source || options.source || "admin").trim(),
  };
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateTermRecord(record, options = {}) {
  const errors = [];
  const warnings = [];
  let normalized = null;
  try {
    normalized = normalizeTermRecord(record, options);
  } catch (error) {
    errors.push(error.code || error.message);
    return { valid: false, errors, warnings, record: null };
  }
  if (!normalized.semesterText) errors.push("SEMESTER_TEXT_EMPTY");
  if (!Number.isInteger(normalized.totalWeeks) || normalized.totalWeeks < 1 || normalized.totalWeeks > 30) {
    errors.push("TOTAL_WEEKS_INVALID");
  }
  if (!WEEK_STARTS.has(normalized.weekStart)) errors.push("WEEK_START_INVALID");
  if (!TERM_STATUSES.has(normalized.status)) errors.push("TERM_STATUS_INVALID");
  if (normalized.status !== "planned" && !isValidDateOnly(normalized.termStartDate)) {
    errors.push("TERM_START_DATE_REQUIRED");
  }
  if (normalized.status === "current" || normalized.status === "ready" || normalized.dataAvailable) {
    if (!isValidDateOnly(normalized.termStartDate)) errors.push("TERM_CONFIG_INCOMPLETE");
    if (!normalized.releaseVersion) errors.push("RELEASE_VERSION_REQUIRED");
  }
  if (normalized.status === "current" && !normalized.dataAvailable) {
    errors.push("CURRENT_TERM_DATA_UNAVAILABLE");
  }
  return { valid: errors.length === 0, errors, warnings, record: normalized };
}

function normalizeRegistry(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const terms = Array.isArray(source.terms) ? source.terms : [];
  const seen = new Set();
  const normalizedTerms = [];
  terms.forEach((item) => {
    try {
      const normalized = normalizeTermRecord(item, {
        now: source.updatedAt || nowIso(),
        allowLegacyCurrentTermFallback: true,
      });
      if (!seen.has(normalized.term)) {
        seen.add(normalized.term);
        normalizedTerms.push(normalized);
      }
    } catch (error) {
      safeLog("term-registry-skip-invalid-record", { term: item && item.term, error: error.message });
    }
  });
  const currentTerms = normalizedTerms.filter((item) => item.status === "current");
  const sourceActiveTerm = source.activeTerm && validateTermId(source.activeTerm).valid
    ? source.activeTerm
    : "";
  const sourceActiveRecord = sourceActiveTerm
    ? normalizedTerms.find((item) => item.term === sourceActiveTerm && item.status === "current")
    : null;
  const activeTerm = sourceActiveRecord
    ? sourceActiveRecord.term
    : (currentTerms[0] && currentTerms[0].term || "");
  return {
    schemaVersion: 1,
    activeTerm,
    updatedAt: String(source.updatedAt || nowIso()),
    terms: normalizedTerms,
  };
}

function validateRegistry(registry) {
  const errors = [];
  const normalized = normalizeRegistry(registry);
  const currentTerms = normalized.terms.filter((item) => item.status === "current");
  if (currentTerms.length > 1) errors.push("MULTIPLE_CURRENT_TERMS");
  if (normalized.activeTerm && !normalized.terms.some((item) => item.term === normalized.activeTerm)) {
    errors.push("ACTIVE_TERM_NOT_REGISTERED");
  }
  if (normalized.activeTerm) {
    const active = normalized.terms.find((item) => item.term === normalized.activeTerm);
    if (active && active.status !== "current") errors.push("ACTIVE_TERM_NOT_CURRENT");
  }
  normalized.terms.forEach((item) => {
    const validation = validateTermRecord(item);
    if (!validation.valid) {
      validation.errors.forEach((error) => errors.push(`${item.term}:${error}`));
    }
  });
  return { valid: errors.length === 0, errors, registry: normalized };
}

function readLatestBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return null;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((name) => /^term-registry-.*\.json$/.test(name))
      .map((name) => path.join(BACKUP_DIR, name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    for (const filePath of files) {
      const candidate = readJsonFile(filePath, null);
      const validation = validateRegistry(candidate);
      if (validation.valid) return validation.registry;
    }
  } catch (error) {
    safeLog("term-registry-backup-read-failed", { error: error.message });
  }
  return null;
}

function writeRegistry(registry, options = {}) {
  const normalized = normalizeRegistry(Object.assign({}, registry, { updatedAt: options.updatedAt || nowIso() }));
  const validation = validateRegistry(normalized);
  if (!validation.valid) {
    const error = new Error(`TERM_REGISTRY_INVALID: ${validation.errors.join("; ")}`);
    error.code = "TERM_REGISTRY_INVALID";
    error.errors = validation.errors;
    throw error;
  }
  if (options.backup !== false) {
    try { backupRegistry(); } catch (error) { safeLog("term-registry-backup-failed", { error: error.message }); }
  }
  writeJsonAtomic(REGISTRY_PATH, validation.registry);
  registryCache = validation.registry;
  registryCacheMtimeMs = fs.existsSync(REGISTRY_PATH) ? fs.statSync(REGISTRY_PATH).mtimeMs : 0;
  return validation.registry;
}

function readRegistryRaw() {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) return null;
    const stat = fs.statSync(REGISTRY_PATH);
    if (registryCache && registryCacheMtimeMs === stat.mtimeMs) return registryCache;
    const raw = readJsonFile(REGISTRY_PATH, null);
    const validation = validateRegistry(raw);
    if (!validation.valid) {
      safeLog("term-registry-invalid", { errors: validation.errors });
      return readLatestBackup();
    }
    registryCache = validation.registry;
    registryCacheMtimeMs = stat.mtimeMs;
    return registryCache;
  } catch (error) {
    safeLog("term-registry-read-failed", { error: error.message });
    return readLatestBackup();
  }
}

function getReleaseManifest(releaseVersion) {
  const version = String(releaseVersion || "").trim();
  if (!version) return null;
  return readJsonFile(path.join(STORAGE_DIR, "releases", version, "manifest.json"), null) ||
    readJsonFile(path.join(STORAGE_DIR, "public", "releases", version, "manifest.json"), null);
}

function getActiveReleasePointer() {
  return readJsonFile(path.join(STORAGE_DIR, "releases", "active.json"), null);
}

function resolveLegacyTermConfig(manifest, active) {
  if (manifest && manifest.termConfig && typeof manifest.termConfig === "object") {
    return Object.assign({}, manifest.termConfig);
  }
  const term = manifest && (manifest.term || manifest.semester) || active && (active.term || active.semester) || "";
  if (term === LEGACY_CURRENT_TERM_CONFIG.term) {
    return Object.assign({}, LEGACY_CURRENT_TERM_CONFIG);
  }
  return null;
}

function migrateLegacyTermState(options = {}) {
  ensureDir(STORAGE_DIR);
  if (fs.existsSync(REGISTRY_PATH) && !options.force) {
    const registry = readRegistryRaw();
    return {
      success: Boolean(registry),
      migrated: false,
      reason: "registry-exists",
      registry,
    };
  }

  const active = getActiveReleasePointer();
  const releaseVersion = active && (active.releaseVersion || active.version) || "";
  const manifest = getReleaseManifest(releaseVersion);
  const term = manifest && (manifest.term || manifest.semester) || active && (active.term || active.semester) || LEGACY_CURRENT_TERM_CONFIG.term;
  const termConfig = resolveLegacyTermConfig(manifest, active);
  const usedLegacyFallback = Boolean(!manifest || !manifest.termConfig);
  const warnings = [];
  if (!termConfig) {
    warnings.push("active release manifest has no termConfig and no safe legacy fallback");
  }
  if (usedLegacyFallback) {
    warnings.push("used legacy compatibility fallback for 2025-2026-2 termConfig");
  }
  if (!releaseVersion) {
    warnings.push("active release pointer missing");
  }

  try {
    const termRecord = normalizeTermRecord({
      term,
      semesterText: termConfig && termConfig.semesterText || generateSemesterText(term),
      termStartDate: termConfig && termConfig.termStartDate || "",
      totalWeeks: termConfig && termConfig.totalWeeks,
      weekStart: termConfig && termConfig.weekStart || "monday",
      status: releaseVersion && termConfig ? "current" : "planned",
      releaseVersion,
      dataAvailable: Boolean(releaseVersion && termConfig),
      publishedAt: active && (active.activatedAt || active.publishedAt || active.updatedAt) || manifest && (manifest.publishedAt || manifest.updatedAt) || "",
      updatedAt: active && (active.activatedAt || active.updatedAt) || manifest && manifest.updatedAt || nowIso(),
      source: "migrated-active-release",
    });
    const registry = writeRegistry({
      schemaVersion: 1,
      activeTerm: termRecord.status === "current" ? termRecord.term : "",
      updatedAt: nowIso(),
      terms: [termRecord],
    }, { backup: false });
    let copiedLegacyData = null;
    try {
      copiedLegacyData = copyLegacyTermData(termRecord.term, { overwrite: false });
    } catch (copyError) {
      warnings.push(`legacy data copy failed: ${copyError.message}`);
    }
    const report = {
      success: true,
      migrated: true,
      source: manifest ? "active-release-manifest" : "active-release-pointer",
      term: termRecord.term,
      releaseVersion,
      usedLegacyFallback,
      warnings,
      copiedLegacyData,
      storageDir: STORAGE_DIR,
      migratedAt: nowIso(),
    };
    writeJsonAtomic(MIGRATION_REPORT_PATH, report);
    return Object.assign({}, report, { registry });
  } catch (error) {
    const report = {
      success: false,
      migrated: false,
      source: manifest ? "active-release-manifest" : "active-release-pointer",
      term,
      releaseVersion,
      usedLegacyFallback,
      warnings: warnings.concat(error.message),
      storageDir: STORAGE_DIR,
      migratedAt: nowIso(),
    };
    writeJsonAtomic(MIGRATION_REPORT_PATH, report);
    safeLog("term-registry-migration-failed", { error: error.message, term, releaseVersion });
    return report;
  }
}

function readRegistry() {
  const registry = readRegistryRaw();
  if (registry) return registry;
  const migration = migrateLegacyTermState();
  if (migration && migration.registry) return migration.registry;
  return null;
}

function listTerms(options = {}) {
  const registry = readRegistry();
  const terms = registry && Array.isArray(registry.terms) ? registry.terms.slice() : [];
  const visible = options.includeDisabled ? terms : terms.filter((item) => item.status !== "disabled");
  const activeTerm = registry && registry.activeTerm || "";
  return visible.sort((left, right) => {
    if (left.term === activeTerm && right.term !== activeTerm) return -1;
    if (right.term === activeTerm && left.term !== activeTerm) return 1;
    return compareTerms(left, right);
  });
}

function getTerm(term) {
  const id = assertTermId(term);
  const registry = readRegistry();
  return registry && registry.terms.find((item) => item.term === id) || null;
}

function getActiveTerm() {
  const registry = readRegistry();
  if (!registry) return null;
  return registry.terms.find((item) => item.term === registry.activeTerm && item.status === "current") ||
    registry.terms.find((item) => item.status === "current") ||
    null;
}

function mutateRegistry(mutator) {
  const registry = readRegistry() || { schemaVersion: 1, activeTerm: "", updatedAt: nowIso(), terms: [] };
  const next = normalizeRegistry(registry);
  const result = mutator(next);
  return { registry: writeRegistry(next), result };
}

function createPlannedTerm(input = {}) {
  const record = normalizeTermRecord(Object.assign({}, input, {
    status: "planned",
    dataAvailable: false,
    releaseVersion: "",
    publishedAt: "",
    source: input.source || "admin",
    updatedAt: nowIso(),
  }));
  const validation = validateTermRecord(record);
  if (!validation.valid) {
    const error = new Error(validation.errors.join("; "));
    error.code = "TERM_RECORD_INVALID";
    error.errors = validation.errors;
    throw error;
  }
  return mutateRegistry((registry) => {
    if (registry.terms.some((item) => item.term === record.term)) {
      const error = new Error("TERM_ALREADY_EXISTS");
      error.code = "TERM_ALREADY_EXISTS";
      error.statusCode = 409;
      throw error;
    }
    registry.terms.push(record);
    return record;
  }).result;
}

function updateTerm(term, patch = {}) {
  const id = assertTermId(term);
  return mutateRegistry((registry) => {
    const index = registry.terms.findIndex((item) => item.term === id);
    if (index < 0) {
      const error = new Error("TERM_NOT_FOUND");
      error.code = "TERM_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    const current = registry.terms[index];
    if (current.status === "current" && patch.status && patch.status !== "current") {
      const error = new Error("CURRENT_TERM_STATUS_CHANGE_REQUIRES_ARCHIVE_OR_ACTIVATE");
      error.code = "CURRENT_TERM_STATUS_CHANGE_REQUIRES_ARCHIVE_OR_ACTIVATE";
      error.statusCode = 400;
      throw error;
    }
    const next = normalizeTermRecord(Object.assign({}, current, patch, {
      term: id,
      updatedAt: nowIso(),
    }));
    if (next.status === "current") {
      next.dataAvailable = true;
    }
    const validation = validateTermRecord(next);
    if (!validation.valid) {
      const error = new Error(validation.errors.join("; "));
      error.code = "TERM_RECORD_INVALID";
      error.errors = validation.errors;
      throw error;
    }
    registry.terms[index] = next;
    return next;
  }).result;
}

function getTermConfigFromManifest(manifest) {
  const source = manifest && typeof manifest === "object" ? manifest : {};
  const config = source.termConfig && typeof source.termConfig === "object" ? source.termConfig : source;
  return normalizeTermRecord({
    term: config.term || source.term || source.semester,
    semesterText: config.semesterText || source.semesterText || "",
    termStartDate: config.termStartDate || source.termStartDate || "",
    totalWeeks: config.totalWeeks || source.totalWeeks,
    weekStart: config.weekStart || source.weekStart || "monday",
    status: "ready",
    releaseVersion: config.releaseVersion || source.releaseVersion || source.version || "",
    dataAvailable: true,
    publishedAt: source.publishedAt || source.updatedAt || "",
    updatedAt: source.updatedAt || nowIso(),
    source: config.source || source.source || "release-manifest",
  }, { allowLegacyCurrentTermFallback: true });
}

function validateManifestForTerm(term, releaseVersion) {
  const id = assertTermId(term);
  const manifest = getReleaseManifest(releaseVersion);
  const errors = [];
  if (!manifest) errors.push("RELEASE_MANIFEST_MISSING");
  const config = manifest ? getTermConfigFromManifest(manifest) : null;
  if (config && config.term !== id) errors.push(`MANIFEST_TERM_MISMATCH:${config.term}:${id}`);
  if (config && config.releaseVersion && String(config.releaseVersion) !== String(releaseVersion)) {
    errors.push(`MANIFEST_RELEASE_MISMATCH:${config.releaseVersion}:${releaseVersion}`);
  }
  if (config) {
    const validation = validateTermRecord(config);
    if (!validation.valid) errors.push.apply(errors, validation.errors);
  }
  return {
    valid: errors.length === 0,
    errors,
    manifest,
    termConfig: config,
  };
}

function bindReleaseToTerm(term, releaseVersion, options = {}) {
  const id = assertTermId(term);
  const version = String(releaseVersion || "").trim();
  if (!version) {
    const error = new Error("RELEASE_VERSION_REQUIRED");
    error.code = "RELEASE_VERSION_REQUIRED";
    throw error;
  }
  const manifestCheck = options.skipManifestCheck ? { valid: true, termConfig: null, errors: [] } : validateManifestForTerm(id, version);
  if (!manifestCheck.valid) {
    const error = new Error(`TERM_RELEASE_MISMATCH: ${manifestCheck.errors.join("; ")}`);
    error.code = "TERM_RELEASE_MISMATCH";
    error.errors = manifestCheck.errors;
    throw error;
  }
  return mutateRegistry((registry) => {
    const index = registry.terms.findIndex((item) => item.term === id);
    if (index < 0) {
      const error = new Error("TERM_NOT_FOUND");
      error.code = "TERM_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    const current = registry.terms[index];
    const termConfig = manifestCheck.termConfig || current;
    const next = normalizeTermRecord(Object.assign({}, current, {
      semesterText: termConfig.semesterText || current.semesterText,
      termStartDate: termConfig.termStartDate || current.termStartDate,
      totalWeeks: termConfig.totalWeeks || current.totalWeeks,
      weekStart: termConfig.weekStart || current.weekStart,
      releaseVersion: version,
      status: options.status || (current.status === "current" ? "current" : "ready"),
      dataAvailable: true,
      publishedAt: options.publishedAt || termConfig.publishedAt || nowIso(),
      updatedAt: nowIso(),
      source: options.source || "release-bind",
    }));
    const validation = validateTermRecord(next);
    if (!validation.valid) {
      const error = new Error(validation.errors.join("; "));
      error.code = "TERM_RECORD_INVALID";
      error.errors = validation.errors;
      throw error;
    }
    registry.terms[index] = next;
    return next;
  }).result;
}

function activateTerm(term, options = {}) {
  const id = assertTermId(term);
  return mutateRegistry((registry) => {
    const target = registry.terms.find((item) => item.term === id);
    if (!target) {
      const error = new Error("TERM_NOT_FOUND");
      error.code = "TERM_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    if (target.status === "disabled") {
      const error = new Error("TERM_DISABLED");
      error.code = "TERM_DISABLED";
      error.statusCode = 400;
      throw error;
    }
    if (!target.dataAvailable || !target.releaseVersion) {
      const error = new Error("TERM_NOT_PUBLISHED");
      error.code = "TERM_NOT_PUBLISHED";
      error.statusCode = 400;
      throw error;
    }
    const validation = validateTermRecord(Object.assign({}, target, { status: "current", dataAvailable: true }));
    if (!validation.valid) {
      const error = new Error(validation.errors.join("; "));
      error.code = validation.errors.includes("TERM_CONFIG_INCOMPLETE") ? "TERM_CONFIG_INCOMPLETE" : "TERM_RECORD_INVALID";
      error.errors = validation.errors;
      throw error;
    }
    registry.terms = registry.terms.map((item) => {
      if (item.term === id) {
        return normalizeTermRecord(Object.assign({}, item, {
          status: "current",
          dataAvailable: true,
          updatedAt: nowIso(),
          source: options.source || item.source || "admin-activate",
        }));
      }
      if (item.status === "current") {
        return normalizeTermRecord(Object.assign({}, item, {
          status: options.archivePrevious === false ? "ready" : "archived",
          updatedAt: nowIso(),
        }));
      }
      return item;
    });
    registry.activeTerm = id;
    return registry.terms.find((item) => item.term === id);
  }).result;
}

function archiveTerm(term) {
  const id = assertTermId(term);
  return mutateRegistry((registry) => {
    const index = registry.terms.findIndex((item) => item.term === id);
    if (index < 0) {
      const error = new Error("TERM_NOT_FOUND");
      error.code = "TERM_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    if (registry.terms[index].status === "current") {
      const error = new Error("CANNOT_ARCHIVE_ACTIVE_TERM");
      error.code = "CANNOT_ARCHIVE_ACTIVE_TERM";
      error.statusCode = 400;
      throw error;
    }
    registry.terms[index] = normalizeTermRecord(Object.assign({}, registry.terms[index], {
      status: "archived",
      updatedAt: nowIso(),
    }));
    return registry.terms[index];
  }).result;
}

function disableTerm(term) {
  const id = assertTermId(term);
  return mutateRegistry((registry) => {
    const index = registry.terms.findIndex((item) => item.term === id);
    if (index < 0) {
      const error = new Error("TERM_NOT_FOUND");
      error.code = "TERM_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    if (registry.terms[index].status === "current") {
      const error = new Error("CANNOT_DISABLE_ACTIVE_TERM");
      error.code = "CANNOT_DISABLE_ACTIVE_TERM";
      error.statusCode = 400;
      throw error;
    }
    registry.terms[index] = normalizeTermRecord(Object.assign({}, registry.terms[index], {
      status: "disabled",
      dataAvailable: false,
      updatedAt: nowIso(),
    }));
    return registry.terms[index];
  }).result;
}

function getSafeTermDir(term) {
  const id = assertTermId(term);
  const dir = path.join(TERMS_DIR, id);
  const relative = path.relative(TERMS_DIR, dir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("TERM_PATH_TRAVERSAL");
    error.code = "TERM_PATH_TRAVERSAL";
    throw error;
  }
  return dir;
}

function termDataPath(term, fileName) {
  const allowed = new Set(["catalog.json", "majors-index.json", "sync-meta.json", "snapshot-meta.json"]);
  if (!allowed.has(fileName)) {
    const error = new Error("TERM_DATA_FILE_NOT_ALLOWED");
    error.code = "TERM_DATA_FILE_NOT_ALLOWED";
    throw error;
  }
  return path.join(getSafeTermDir(term), fileName);
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function copyLegacyTermData(term, options = {}) {
  const activeTerm = assertTermId(term);
  const termDir = getSafeTermDir(activeTerm);
  ensureDir(termDir);
  const copies = [];
  const mappings = [
    ["catalog.json", "catalog.json"],
    ["majors-index.json", "majors-index.json"],
    ["sync-meta.json", "sync-meta.json"],
  ];
  mappings.forEach(([legacyName, termName]) => {
    const source = path.join(STORAGE_DIR, legacyName);
    const target = path.join(termDir, termName);
    if (!fs.existsSync(source) || (fs.existsSync(target) && !options.overwrite)) return;
    fs.copyFileSync(source, target);
    const parsed = readJsonFile(target, null);
    const count = Array.isArray(parsed) ? parsed.length : (
      parsed && Array.isArray(parsed.colleges) ? parsed.colleges.length :
      parsed && Array.isArray(parsed.majors) ? parsed.majors.length : 0
    );
    copies.push({
      file: termName,
      source,
      target,
      hash: hashFile(target),
      count,
    });
  });
  if (copies.length) {
    writeJsonAtomic(path.join(termDir, "snapshot-meta.json"), {
      term: activeTerm,
      copiedFromLegacy: true,
      copiedAt: nowIso(),
      copies,
    });
  }
  return { term: activeTerm, termDir, copies };
}

function getPublicTerms() {
  const registry = readRegistry();
  const activeTerm = registry && registry.activeTerm || "";
  const visible = listTerms()
    .filter((item) => ["current", "ready", "archived"].includes(item.status))
    .filter((item) => item.dataAvailable && item.releaseVersion)
    .filter((item) => releaseIsHealthy(getReleaseManifest(item.releaseVersion), item.term));
  return sortVisibleTerms(visible, activeTerm)
    .map((item) => ({
      term: item.term,
      semesterText: item.semesterText,
      status: item.status,
      dataAvailable: item.dataAvailable,
      releaseVersion: item.releaseVersion,
      termStartDate: item.termStartDate,
      totalWeeks: item.totalWeeks,
      updatedAt: item.updatedAt,
    }));
}

function getRegistryEtag(registry) {
  const data = registry || readRegistry() || {};
  const hash = crypto.createHash("sha1").update(JSON.stringify({
    activeTerm: data.activeTerm || "",
    updatedAt: data.updatedAt || "",
    terms: (data.terms || []).map((item) => [item.term, item.status, item.releaseVersion, item.updatedAt]),
  })).digest("hex");
  return `"term-registry-${hash}"`;
}

function clearCache() {
  registryCache = null;
  registryCacheMtimeMs = 0;
}

module.exports = {
  BACKUP_DIR,
  LEGACY_CURRENT_TERM_CONFIG,
  MIGRATION_REPORT_PATH,
  REGISTRY_PATH,
  STORAGE_DIR,
  TERMS_DIR,
  TERM_STATUSES,
  activateTerm,
  archiveTerm,
  bindReleaseToTerm,
  clearCache,
  copyLegacyTermData,
  createPlannedTerm,
  disableTerm,
  generateSemesterText,
  getActiveTerm,
  getPublicTerms,
  getRegistryEtag,
  getSafeTermDir,
  getTerm,
  getTermConfigFromManifest,
  listTerms,
  migrateLegacyTermState,
  normalizeTermRecord,
  readRegistry,
  termDataPath,
  updateTerm,
  validateManifestForTerm,
  validateTermId,
  validateTermRecord,
  writeRegistry,
};
