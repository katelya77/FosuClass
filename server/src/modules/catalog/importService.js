const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { normalizeImportDocument, sha256, stableStringify, typedError } = require("./contracts");
const repository = require("./repository");
const adminAuditService = require("../../services/adminAuditService");

const PRIVATE_DIR = path.join(repository.DATA_DIR, "catalog-control");
const CATALOG_PREVIEWS_DIR = path.join(PRIVATE_DIR, "previews");
const CATALOG_OPERATIONS_DIR = path.join(PRIVATE_DIR, "operations");
const INTEGRITY_KEY_PATH = path.join(PRIVATE_DIR, ".integrity-key");
const VALID_STATES = new Set(["prepared", "backup_verified", "pointer_committed", "preview_consumed", "audit_committed", "complete"]);
const STATE_ORDER = Object.freeze(["prepared", "backup_verified", "pointer_committed", "preview_consumed", "audit_committed", "complete"]);

function assertPrivatePath(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw typedError("catalog private path escaped its root", "CATALOG_PRIVATE_PATH_INVALID", 500);
  let cursor = resolved;
  while (cursor.startsWith(base)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw typedError("catalog private symlinks are not allowed", "CATALOG_PRIVATE_PATH_INVALID", 500);
    if (cursor === base) break;
    cursor = path.dirname(cursor);
  }
  return resolved;
}

function strictUuid(value, code) {
  const text = String(value || "");
  if (text.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw typedError("catalog identifier is invalid", code, 409);
  return text;
}

function previewPath(previewId) {
  return assertPrivatePath(CATALOG_PREVIEWS_DIR, path.join(CATALOG_PREVIEWS_DIR, `${strictUuid(previewId, "PREVIEW_NOT_FOUND")}.json`));
}

function operationIdFor(previewId) { return `catop_${strictUuid(previewId, "PREVIEW_NOT_FOUND").replace(/-/g, "")}`; }
function operationPath(previewId) { return assertPrivatePath(CATALOG_OPERATIONS_DIR, path.join(CATALOG_OPERATIONS_DIR, `${operationIdFor(previewId)}.json`)); }

function readIntegrityKey() {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true });
  try { fs.writeFileSync(INTEGRITY_KEY_PATH, crypto.randomBytes(32).toString("hex"), { encoding: "utf8", flag: "wx", mode: 0o600 }); } catch (error) {
    if (!error || error.code !== "EEXIST") throw typedError("catalog integrity key cannot be created", "CATALOG_PRIVATE_STORAGE_FAILED", 500);
  }
  let key;
  try { key = fs.readFileSync(INTEGRITY_KEY_PATH, "utf8").trim(); } catch (_) { throw typedError("catalog integrity key cannot be read", "CATALOG_PRIVATE_STORAGE_FAILED", 500); }
  if (!/^[0-9a-f]{64}$/i.test(key)) throw typedError("catalog integrity key is invalid", "CATALOG_PRIVATE_STORAGE_FAILED", 500);
  return key;
}

function integrityFor(record) {
  const unsigned = { ...record };
  delete unsigned.integrity;
  return crypto.createHmac("sha256", readIntegrityKey()).update(stableStringify(unsigned)).digest("hex");
}

function writePrivateRecord(filePath, record) {
  const root = filePath.startsWith(path.resolve(CATALOG_PREVIEWS_DIR)) ? CATALOG_PREVIEWS_DIR : CATALOG_OPERATIONS_DIR;
  assertPrivatePath(root, filePath);
  fs.mkdirSync(root, { recursive: true });
  const temp = assertPrivatePath(root, `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`);
  const signed = { ...record, integrity: integrityFor(record) };
  try {
    fs.writeFileSync(temp, `${JSON.stringify(signed, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    JSON.parse(fs.readFileSync(temp, "utf8"));
    fs.renameSync(temp, filePath);
  } catch (_) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw typedError("catalog private record could not be persisted", "CATALOG_PRIVATE_STORAGE_FAILED", 500);
  }
  return signed;
}

function readSignedRecord(filePath, missingCode, tamperedCode) {
  let record;
  try { record = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (error) {
    if (error && error.code === "ENOENT") throw typedError("catalog private record does not exist", missingCode, 409);
    throw typedError("catalog private record is malformed", tamperedCode, 409);
  }
  const expected = Buffer.from(integrityFor(record));
  const actual = Buffer.from(String(record.integrity || ""));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw typedError("catalog private record was tampered with", tamperedCode, 409);
  return record;
}

function readPreviewRecord(previewId) {
  const record = readSignedRecord(previewPath(previewId), "PREVIEW_NOT_FOUND", "PREVIEW_TAMPERED");
  if (record.previewId !== previewId || !record.document || sha256(stableStringify(normalizeImportDocument(record.document))) !== record.sourceFingerprint) throw typedError("catalog preview fingerprint mismatch", "PREVIEW_TAMPERED", 409);
  const createdAt = Date.parse(record.createdAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt || expiresAt - createdAt > 30 * 60 * 1000) throw typedError("catalog preview expiry is invalid", "PREVIEW_TAMPERED", 409);
  return record;
}

function readOperation(previewId) {
  try {
    const record = readSignedRecord(operationPath(previewId), "CATALOG_OPERATION_NOT_FOUND", "CATALOG_OPERATION_TAMPERED");
    if (!VALID_STATES.has(record.state) || record.previewId !== previewId || record.operationId !== operationIdFor(previewId)) throw typedError("catalog operation journal is invalid", "CATALOG_OPERATION_TAMPERED", 500);
    return record;
  } catch (error) {
    if (error.code === "CATALOG_OPERATION_NOT_FOUND") return null;
    throw error;
  }
}

function writeOperation(operation, state, patch = {}) {
  if (!VALID_STATES.has(state)) throw typedError("catalog operation transition is invalid", "CATALOG_OPERATION_STATE_INVALID", 500);
  if (operation.state && STATE_ORDER.indexOf(state) < STATE_ORDER.indexOf(operation.state)) throw typedError("catalog operation cannot move backwards", "CATALOG_OPERATION_STATE_INVALID", 500);
  return writePrivateRecord(operationPath(operation.previewId), { ...operation, ...patch, state, updatedAt: new Date().toISOString() });
}

function listOperations() {
  if (!fs.existsSync(CATALOG_OPERATIONS_DIR)) return [];
  return fs.readdirSync(CATALOG_OPERATIONS_DIR)
    .filter((name) => /^catop_[0-9a-f]{32}\.json$/i.test(name))
    .sort()
    .map((name) => {
      const compact = name.slice("catop_".length, -".json".length);
      const previewId = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
      return readOperation(previewId);
    })
    .filter(Boolean);
}

function rowMap(rows) { return new Map(rows.map((row) => [row.id, row])); }
function buildDiff(document, snapshot, mergedRaw) {
  const beforeRows = rowMap(repository.rowsFromRaw(document.type, snapshot.raw));
  const afterRows = rowMap(repository.rowsFromRaw(document.type, mergedRaw));
  const beforeEntries = new Map(repository.entriesFromRaw(document.type, snapshot.raw).map((entry) => [entry.id, entry.item]));
  const afterEntries = new Map(repository.entriesFromRaw(document.type, mergedRaw).map((entry) => [entry.id, entry.item]));
  const changes = { added: [], updated: [], unchanged: [], deleted: [] };
  for (const id of document.ids.slice().sort()) {
    if (!beforeEntries.has(id)) changes.added.push(afterRows.get(id));
    else if (stableStringify(beforeEntries.get(id)) === stableStringify(afterEntries.get(id))) changes.unchanged.push(afterRows.get(id));
    else changes.updated.push({ before: beforeRows.get(id), after: afterRows.get(id) });
  }
  return changes;
}

function summaryFor(changes) { return { added: changes.added.length, updated: changes.updated.length, unchanged: changes.unchanged.length, deleted: 0 }; }

function publicSource(source) {
  return { kind: source.kind, published: false, label: source.label, type: source.type, generationId: source.generationId, semesters: source.semesters };
}

function previewImport(input) {
  const document = normalizeImportDocument(input);
  const generation = repository.readCurrentGeneration();
  const snapshot = repository.readSnapshot(document.type, generation);
  const dependency = repository.readRelationshipSnapshot(generation);
  repository.validateMajorRelationships(document, dependency);
  const mergedRaw = repository.mergeImport(snapshot, document);
  const changes = buildDiff(document, snapshot, mergedRaw);
  const now = Date.now();
  const ttl = Math.max(10, Math.min(30 * 60 * 1000, Number(process.env.FOSU_CATALOG_PREVIEW_TTL_MS || 10 * 60 * 1000)));
  const previewId = crypto.randomUUID();
  const sourceFingerprint = sha256(stableStringify(document));
  const storedDocument = { type: document.type, semester: document.semester, items: document.items };
  const record = {
    schemaVersion: 1,
    previewId,
    operationId: operationIdFor(previewId),
    document: storedDocument,
    type: document.type,
    sourceFingerprint,
    baseVersion: snapshot.version,
    baseRawSha256: snapshot.rawSha256,
    baseLogicalSha256: snapshot.logicalSha256,
    generationId: generation.generationId,
    relationshipVersion: dependency.version,
    relationshipRawSha256: dependency.rawSha256,
    summary: summaryFor(changes),
    changes,
    warnings: [],
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    used: false,
  };
  writePrivateRecord(previewPath(previewId), record);
  return { previewId, operationId: record.operationId, baseVersion: record.baseVersion, sourceFingerprint, generationId: record.generationId, relationshipVersion: record.relationshipVersion, summary: record.summary, changes, warnings: [], expiresAt: record.expiresAt, source: publicSource(snapshot.source) };
}

function conflict(message, currentVersion, code = "CONFLICT") {
  const error = typedError(message, code, 409);
  if (currentVersion) error.currentVersion = currentVersion;
  return error;
}

function validateCurrent(preview, generation, snapshot, dependency) {
  if (generation.generationId !== preview.generationId) throw conflict("catalog staging generation changed", snapshot.version);
  if (snapshot.version !== preview.baseVersion || snapshot.rawSha256 !== preview.baseRawSha256 || snapshot.logicalSha256 !== preview.baseLogicalSha256) throw conflict("catalog staging target changed", snapshot.version);
  if (dependency.version !== preview.relationshipVersion || dependency.rawSha256 !== preview.relationshipRawSha256) throw conflict("catalog relationship dimensions changed", snapshot.version);
}

function safeAuditContext(input = {}) {
  return {
    operator: String(input.operator || "admin").slice(0, 128),
    tokenName: String(input.tokenName || "").slice(0, 128),
    scopes: Array.isArray(input.scopes) ? input.scopes.map((scope) => String(scope).slice(0, 128)).slice(0, 32) : [],
    sessionIdPrefix: String(input.sessionIdPrefix || "").slice(0, 24),
    authMethod: String(input.authMethod || "unknown").slice(0, 64),
    requestId: String(input.requestId || "").slice(0, 128),
    ip: String(input.ip || "").slice(0, 128),
  };
}

function publicResult(operation, options = {}) {
  return {
    committed: true,
    reconciled: options.reconciled === true,
    auditPending: options.auditPending === true,
    operationId: operation.operationId,
    previewId: operation.previewId,
    type: operation.type,
    version: operation.result.version,
    etag: operation.result.version,
    generationId: operation.result.generationId,
    sourceFingerprint: operation.sourceFingerprint,
    summary: operation.summary,
    changes: operation.changes,
    backup: operation.backup && { id: operation.backup.id, sha256: operation.backup.sha256, size: operation.backup.size, existed: operation.backup.existed },
    source: { kind: "catalog-staging", published: false, label: "Catalog 工作区（未发布）", type: operation.type, generationId: operation.result.generationId },
    warnings: options.warnings || [],
  };
}

function ensurePreviewConsumed(preview, operation) {
  if (preview.used === true && preview.result && preview.result.generationId === operation.result.generationId) return preview;
  return writePrivateRecord(previewPath(preview.previewId), { ...preview, used: true, usedAt: new Date().toISOString(), result: operation.result });
}

function stateAtLeast(operation, state) {
  return STATE_ORDER.indexOf(operation.state) >= STATE_ORDER.indexOf(state);
}

function assertOperationMatchesPreview(operation, preview) {
  const valid = operation
    && operation.schemaVersion === 1
    && operation.operationId === operationIdFor(preview.previewId)
    && operation.previewId === preview.previewId
    && operation.type === preview.type
    && operation.sourceFingerprint === preview.sourceFingerprint
    && operation.baseGenerationId === preview.generationId
    && operation.baseVersion === preview.baseVersion
    && operation.baseRawSha256 === preview.baseRawSha256
    && operation.relationshipRawSha256 === preview.relationshipRawSha256
    && Number.isFinite(Date.parse(String(operation.backupCreatedAt || "")))
    && operation.result
    && operation.result.generationId === operation.plannedGenerationId
    && /^[0-9a-f]{64}$/i.test(String(operation.result.rawSha256 || ""))
    && /^[0-9a-f]{64}$/i.test(String(operation.result.logicalSha256 || ""))
    && operation.audit
    && operation.audit.operationId === operation.operationId
    && operation.audit.type === operation.type
    && operation.audit.generationId === operation.result.generationId
    && operation.audit.sourceFingerprint === operation.sourceFingerprint
    && operation.audit.baseVersion === operation.baseVersion
    && operation.audit.resultVersion === operation.result.version;
  if (!valid) throw typedError("catalog operation does not match its signed preview", "CATALOG_OPERATION_TAMPERED", 500);
}

function ensureOperationBackup(operation, snapshot) {
  const backup = repository.createBackup(snapshot, operation.operationId, {
    resultSha256: operation.result.rawSha256,
    resultVersion: operation.result.version,
    createdAt: operation.backupCreatedAt,
  });
  const record = { id: backup.id, sha256: backup.manifest.backupSha256, size: backup.manifest.size, existed: backup.manifest.existed };
  if (stateAtLeast(operation, "backup_verified") && stableStringify(operation.backup) !== stableStringify(record)) {
    throw typedError("catalog operation backup record does not match its artifacts", "CATALOG_OPERATION_TAMPERED", 500);
  }
  return { backup, record };
}

function rebuildOperationPlan(operation, preview, generation) {
  assertOperationMatchesPreview(operation, preview);
  if (generation.generationId !== operation.baseGenerationId) throw conflict("catalog operation base generation changed", repository.readSnapshot(preview.type, generation).version);
  const snapshot = repository.readSnapshot(preview.type, generation);
  const dependency = repository.readRelationshipSnapshot(generation);
  validateCurrent(preview, generation, snapshot, dependency);
  const document = normalizeImportDocument(preview.document);
  if (sha256(stableStringify(document)) !== preview.sourceFingerprint) throw typedError("catalog operation preview fingerprint mismatch", "CATALOG_OPERATION_TAMPERED", 500);
  repository.validateMajorRelationships(document, dependency);
  const merged = repository.mergeImport(snapshot, document);
  const changes = buildDiff(document, snapshot, merged);
  const summary = summaryFor(changes);
  if (stableStringify(changes) !== stableStringify(operation.changes)
      || stableStringify(summary) !== stableStringify(operation.summary)
      || stableStringify(changes) !== stableStringify(preview.changes)
      || stableStringify(summary) !== stableStringify(preview.summary)) {
    throw typedError("catalog operation diff no longer matches its signed intent", "CATALOG_OPERATION_TAMPERED", 500);
  }
  const plan = repository.planGeneration(generation, preview.type, merged, operation.operationId, {
    generationId: operation.plannedGenerationId,
    createdAt: operation.plannedCreatedAt,
  });
  if (plan.result.rawSha256 !== operation.result.rawSha256
      || plan.result.logicalSha256 !== operation.result.logicalSha256
      || plan.result.version !== operation.result.version) {
    throw typedError("catalog operation plan no longer matches its journal", "CATALOG_OPERATION_TAMPERED", 500);
  }
  return { plan, snapshot };
}

function finishCommittedOperation(operation, preview) {
  const warnings = [];
  let previewPending = false;
  if (!stateAtLeast(operation, "preview_consumed")) {
    try {
      ensurePreviewConsumed(preview, operation);
      operation = writeOperation(operation, "preview_consumed");
    } catch (_) {
      previewPending = true;
      warnings.push({ code: "PREVIEW_CONSUME_PENDING" });
    }
  }
  let auditPending = false;
  if (!stateAtLeast(operation, "audit_committed")) {
    try {
      // The audit event is replayable after a crash, so its semantic time must
      // come from the durable operation rather than from the recovery attempt.
      adminAuditService.appendCatalogOperation({
        ...operation.audit,
        time: operation.audit.time || operation.createdAt,
      });
      if (previewPending) {
        auditPending = true;
        warnings.push({ code: "CATALOG_JOURNAL_AUDIT_PENDING" });
      } else {
        operation = writeOperation(operation, "audit_committed");
      }
    } catch (_) {
      auditPending = true;
      warnings.push({ code: "CATALOG_AUDIT_PENDING" });
    }
  }
  if (!previewPending && !auditPending && operation.state !== "complete") {
    try { operation = writeOperation(operation, "complete", { completedAt: new Date().toISOString() }); }
    catch (_) { warnings.push({ code: "CATALOG_JOURNAL_COMPLETION_PENDING" }); }
  }
  return { operation, previewPending, auditPending, warnings };
}

function resumeOperation(operation, preview) {
  assertOperationMatchesPreview(operation, preview);
  let generation = repository.readCurrentGeneration();
  let committed = generation.generationId === operation.result.generationId;
  const warnings = [];
  if (committed) {
    const committedGeneration = repository.readGeneration(operation.result.generationId);
    if (committedGeneration.manifest.operationId !== operation.operationId) throw typedError("pending catalog operation generation does not match its journal", "CATALOG_OPERATION_TAMPERED", 500);
    const committedFile = committedGeneration.files[operation.type];
    if (!committedFile
        || committedFile.rawSha256 !== operation.result.rawSha256
        || committedFile.logicalSha256 !== operation.result.logicalSha256
        || committedFile.version !== operation.result.version) {
      throw typedError("committed catalog generation result does not match its journal", "CATALOG_OPERATION_TAMPERED", 500);
    }
    const baseGeneration = repository.readGeneration(operation.baseGenerationId);
    ensureOperationBackup(operation, repository.readSnapshot(operation.type, baseGeneration));
  } else {
    if (generation.generationId !== operation.baseGenerationId || stateAtLeast(operation, "pointer_committed")) {
      throw typedError("catalog operation generation diverged from its journal", "CATALOG_OPERATION_RECOVERY_REQUIRED", 503);
    }
    const { plan, snapshot } = rebuildOperationPlan(operation, preview, generation);
    const { record } = ensureOperationBackup(operation, snapshot);
    operation = writeOperation(operation, "backup_verified", { backup: record });
    const committedGeneration = repository.commitPlannedGeneration(plan, operation.operationId);
    committed = true;
    if (committedGeneration.generationId !== operation.result.generationId || committedGeneration.manifest.operationId !== operation.operationId) throw typedError("catalog committed generation mismatch", "CATALOG_COMMIT_VERIFY_FAILED", 500);
    operation = { ...operation, state: "pointer_committed", pointerCommittedAt: new Date().toISOString() };
    try { operation = writeOperation(operation, "pointer_committed"); }
    catch (_) { warnings.push({ code: "CATALOG_JOURNAL_POINTER_PENDING" }); }
  }
  const finished = finishCommittedOperation(operation, preview);
  return { committed, operation: finished.operation, previewPending: finished.previewPending, auditPending: finished.auditPending, warnings: warnings.concat(finished.warnings) };
}

function recoverOtherPendingOperations(currentPreviewId) {
  for (const operation of listOperations()) {
    if (operation.previewId === currentPreviewId || operation.state === "complete") continue;
    let recovered;
    try { recovered = resumeOperation(operation, readPreviewRecord(operation.previewId)); }
    catch (error) {
      if (error && (error.code === "CATALOG_OPERATION_TAMPERED" || error.code === "CATALOG_PRIVATE_STORAGE_FAILED")) throw error;
      throw typedError("a prior catalog operation requires recovery before another mutation", "CATALOG_OPERATION_RECOVERY_REQUIRED", 503);
    }
    if (recovered.previewPending || recovered.auditPending || recovered.operation.state !== "complete") {
      throw typedError("a committed catalog operation still requires recovery", "CATALOG_AUDIT_PENDING", 503);
    }
  }
}

function createPreparedOperation(preview, generation, options) {
  const snapshot = repository.readSnapshot(preview.type, generation);
  const dependency = repository.readRelationshipSnapshot(generation);
  validateCurrent(preview, generation, snapshot, dependency);
  const document = normalizeImportDocument(preview.document);
  if (sha256(stableStringify(document)) !== preview.sourceFingerprint) throw conflict("catalog preview fingerprint mismatch", snapshot.version, "PREVIEW_TAMPERED");
  repository.validateMajorRelationships(document, dependency);
  const merged = repository.mergeImport(snapshot, document);
  const changes = buildDiff(document, snapshot, merged);
  const summary = summaryFor(changes);
  if (stableStringify(changes) !== stableStringify(preview.changes) || stableStringify(summary) !== stableStringify(preview.summary)) throw conflict("catalog preview diff changed", snapshot.version, "PREVIEW_TAMPERED");
  const operationId = operationIdFor(preview.previewId);
  const plan = repository.planGeneration(generation, preview.type, merged, operationId);
  const operationCreatedAt = new Date().toISOString();
  return writeOperation({
    schemaVersion: 1,
    operationId,
    previewId: preview.previewId,
    type: preview.type,
    sourceFingerprint: preview.sourceFingerprint,
    baseGenerationId: generation.generationId,
    baseVersion: snapshot.version,
    baseRawSha256: snapshot.rawSha256,
    relationshipRawSha256: dependency.rawSha256,
    plannedGenerationId: plan.generationId,
    plannedCreatedAt: plan.createdAt,
    backupCreatedAt: operationCreatedAt,
    summary,
    changes,
    backup: null,
    result: { generationId: plan.generationId, version: plan.result.version, rawSha256: plan.result.rawSha256, logicalSha256: plan.result.logicalSha256 },
    audit: {
      operationId,
      time: operationCreatedAt,
      type: preview.type,
      previewIdPrefix: preview.previewId.slice(0, 12),
      sourceFingerprint: preview.sourceFingerprint,
      baseVersion: snapshot.version,
      resultVersion: plan.result.version,
      generationId: plan.generationId,
      summary,
      backupId: `catalog-import-${preview.type}-${operationId}`,
      identity: safeAuditContext(options.auditContext),
    },
    createdAt: operationCreatedAt,
  }, "prepared");
}

function applyImport(previewId, options = {}) {
  if (options.confirm !== true) throw typedError("literal confirm=true is required", "CONFIRM_REQUIRED", 400);
  const ifMatch = String(options.ifMatch || options.expectedVersion || "").trim();
  if (!ifMatch) throw typedError("If-Match required for catalog import", "PRECONDITION_REQUIRED", 428);
  let preview = readPreviewRecord(previewId);
  if (ifMatch !== preview.baseVersion) throw conflict("catalog import version conflict", preview.baseVersion);
  const release = repository.acquireMutationLocks(preview.type, previewPath(previewId));
  let committed = false;
  let result = null;
  try {
    preview = readPreviewRecord(previewId);
    recoverOtherPendingOperations(previewId);
    let operation = readOperation(previewId);
    if (operation && operation.state === "complete") throw conflict("catalog preview was already applied", operation.result.version, "PREVIEW_REPLAYED");
    if (!operation) {
      if (preview.used) throw conflict("catalog preview was already applied", preview.result && preview.result.version, "PREVIEW_REPLAYED");
      if (Date.parse(preview.expiresAt) <= Date.now()) throw conflict("catalog preview expired", preview.baseVersion, "PREVIEW_EXPIRED");
      operation = createPreparedOperation(preview, repository.readCurrentGeneration(), options);
    }
    const resumed = resumeOperation(operation, preview);
    committed = resumed.committed;
    result = publicResult(resumed.operation, {
      reconciled: operation.state !== "prepared",
      auditPending: resumed.auditPending || resumed.previewPending,
      warnings: resumed.warnings,
    });
    return result;
  } finally {
    try { release(); } catch (_) {
      if (!committed) throw typedError("catalog lock could not be released", "CATALOG_LOCK_RELEASE_FAILED", 500);
      if (result) result.warnings = (result.warnings || []).concat({ code: "CATALOG_LOCK_RELEASE_FAILED" });
    }
  }
}

module.exports = {
  CATALOG_OPERATIONS_DIR,
  CATALOG_PREVIEWS_DIR,
  PRIVATE_DIR,
  applyImport,
  operationIdFor,
  previewImport,
  readOperation,
  readPreviewRecord,
};
