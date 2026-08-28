const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const releaseService = require("./releaseService");
const termRegistryService = require("./termRegistryService");
const termReleaseIndexService = require("./termReleaseIndexService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const QUARANTINE_ROOT = path.join(STORAGE_DIR, "backups", "term-deletions");
const OPERATIONS_PATH = path.join(STORAGE_DIR, "term-deletion-operations.json");

function typedError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  if (fs.existsSync(filePath) && process.platform === "win32") fs.unlinkSync(filePath);
  fs.renameSync(tempPath, filePath);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function assertManagedPath(targetPath) {
  const resolved = path.resolve(targetPath || "");
  const relative = path.relative(STORAGE_DIR, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw typedError("TERM_DELETE_PATH_UNSAFE", "TERM_DELETE_PATH_UNSAFE", 500);
  }
  return resolved;
}

function readOperations() {
  const value = readJson(OPERATIONS_PATH, { schemaVersion: 1, operations: [] });
  return {
    schemaVersion: 1,
    operations: Array.isArray(value && value.operations) ? value.operations : [],
  };
}

function findOperation(term, idempotencyKey) {
  if (!idempotencyKey) return null;
  const keyHash = hash(idempotencyKey);
  const operation = readOperations().operations.find((item) => item.keyHash === keyHash);
  if (operation && operation.term !== term) {
    throw typedError("IDEMPOTENCY_KEY_CONFLICT", "IDEMPOTENCY_KEY_CONFLICT", 409);
  }
  return operation || null;
}

function rememberOperation(term, idempotencyKey, receipt) {
  const state = readOperations();
  const keyHash = hash(idempotencyKey);
  state.operations = state.operations.filter((item) => item.keyHash !== keyHash);
  state.operations.push({ keyHash, term, completedAt: new Date().toISOString(), receipt });
  state.operations = state.operations.slice(-100);
  writeJsonAtomic(OPERATIONS_PATH, state);
}

function getActiveReleaseVersion() {
  const active = readJson(releaseService.ACTIVE_RELEASE_PATH, null);
  return String(active && (active.version || active.releaseVersion) || "").trim();
}

function releaseVersionsForTerm(term, record, releaseIndex) {
  const entry = releaseIndex && releaseIndex.terms && releaseIndex.terms[term] || {};
  return Array.from(new Set([
    record && record.releaseVersion,
    entry.activeReleaseVersion,
    entry.previousReleaseVersion,
  ].map((item) => String(item || "").trim()).filter(Boolean)));
}

function releasesReferencedElsewhere(term, registry, releaseIndex) {
  const references = new Set([getActiveReleaseVersion()]);
  (registry.terms || []).forEach((item) => {
    if (item.term !== term && item.releaseVersion) references.add(String(item.releaseVersion));
  });
  Object.entries(releaseIndex.terms || {}).forEach(([itemTerm, item]) => {
    if (itemTerm === term) return;
    if (item.activeReleaseVersion) references.add(String(item.activeReleaseVersion));
    if (item.previousReleaseVersion) references.add(String(item.previousReleaseVersion));
  });
  references.delete("");
  return references;
}

function buildDeletionPlan(term) {
  const validation = termRegistryService.validateTermId(term);
  if (!validation.valid) throw typedError(validation.error, validation.error, 400);
  const id = validation.term;
  const registry = termRegistryService.readRegistry();
  const record = registry && (registry.terms || []).find((item) => item.term === id);
  if (!record) throw typedError("TERM_NOT_FOUND", "TERM_NOT_FOUND", 404);
  if (registry.activeTerm === id || record.status === "current") {
    throw typedError("CANNOT_DELETE_ACTIVE_TERM", "CANNOT_DELETE_ACTIVE_TERM", 409);
  }
  const releaseIndex = termReleaseIndexService.readIndex();
  const referencedElsewhere = releasesReferencedElsewhere(id, registry, releaseIndex);
  const releaseVersions = releaseVersionsForTerm(id, record, releaseIndex);
  const exclusiveReleases = releaseVersions.filter((version) => !referencedElsewhere.has(version));
  const livePaths = [termRegistryService.getSafeTermDir(id)];
  exclusiveReleases.forEach((version) => {
    livePaths.push(path.join(releaseService.RELEASES_DIR, version));
    livePaths.push(path.join(releaseService.PUBLIC_RELEASES_DIR, version));
  });
  return {
    term: id,
    record,
    registry,
    releaseIndex,
    releaseVersions,
    exclusiveReleases,
    sharedReleases: releaseVersions.filter((version) => referencedElsewhere.has(version)),
    livePaths: livePaths.map(assertManagedPath),
  };
}

function moveToQuarantine(sourcePath, quarantinePath, label, moved) {
  if (!fs.existsSync(sourcePath)) return;
  const targetPath = path.join(quarantinePath, label);
  ensureDir(path.dirname(targetPath));
  fs.renameSync(sourcePath, targetPath);
  moved.push({ sourcePath, targetPath });
}

function deleteTerm(term, options = {}) {
  const id = String(term || "").trim();
  const dryRun = options.dryRun === true;
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  const confirm = String(options.confirm || "").trim();
  if (!dryRun) {
    if (!idempotencyKey) throw typedError("IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", 400);
    if (confirm !== `DELETE ${id}`) {
      throw typedError("TERM_DELETE_CONFIRM_REQUIRED", "TERM_DELETE_CONFIRM_REQUIRED", 400);
    }
    const previous = findOperation(id, idempotencyKey);
    if (previous) return Object.assign({}, previous.receipt, { duplicate: true });
  }

  const plan = buildDeletionPlan(id);
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      term: plan.term,
      releaseVersions: plan.releaseVersions,
      sharedReleases: plan.sharedReleases,
      livePaths: plan.livePaths,
      existingLivePaths: plan.livePaths.filter((item) => fs.existsSync(item)),
      confirmationText: `DELETE ${plan.term}`,
    };
  }

  ensureDir(QUARANTINE_ROOT);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = path.join(QUARANTINE_ROOT, `${plan.term}-${stamp}-${hash(idempotencyKey).slice(0, 8)}`);
  ensureDir(quarantinePath);
  writeJsonAtomic(path.join(quarantinePath, "registry-before.json"), plan.registry);
  writeJsonAtomic(path.join(quarantinePath, "term-index-before.json"), plan.releaseIndex);
  const moved = [];
  try {
    moveToQuarantine(termRegistryService.getSafeTermDir(plan.term), quarantinePath, "term-data", moved);
    plan.exclusiveReleases.forEach((version) => {
      moveToQuarantine(path.join(releaseService.RELEASES_DIR, version), quarantinePath, `release-${version}`, moved);
      moveToQuarantine(path.join(releaseService.PUBLIC_RELEASES_DIR, version), quarantinePath, `public-release-${version}`, moved);
    });

    termRegistryService.writeRegistry(Object.assign({}, plan.registry, {
      terms: (plan.registry.terms || []).filter((item) => item.term !== plan.term),
    }), { backup: false });
    termReleaseIndexService.removeTerm(plan.term);

    const receipt = {
      success: true,
      dryRun: false,
      deleted: true,
      duplicate: false,
      term: plan.term,
      releaseVersions: plan.releaseVersions,
      sharedReleases: plan.sharedReleases,
      deletedLivePaths: moved.map((item) => item.sourcePath),
      completedAt: new Date().toISOString(),
      rollback: {
        quarantinePath,
        expiresAfterDays: Math.max(1, Number(process.env.FOSU_TERM_DELETION_RETENTION_DAYS || 7) || 7),
      },
    };
    writeJsonAtomic(path.join(quarantinePath, "receipt.json"), receipt);
    rememberOperation(plan.term, idempotencyKey, receipt);
    return receipt;
  } catch (error) {
    moved.slice().reverse().forEach((item) => {
      try {
        if (fs.existsSync(item.targetPath) && !fs.existsSync(item.sourcePath)) {
          ensureDir(path.dirname(item.sourcePath));
          fs.renameSync(item.targetPath, item.sourcePath);
        }
      } catch (_) {}
    });
    try { termRegistryService.writeRegistry(plan.registry, { backup: false }); } catch (_) {}
    try { termReleaseIndexService.writeIndex(plan.releaseIndex); } catch (_) {}
    throw error;
  }
}

module.exports = {
  OPERATIONS_PATH,
  QUARANTINE_ROOT,
  buildDeletionPlan,
  deleteTerm,
};
