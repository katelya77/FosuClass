const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("./exclusiveFileLockService");

const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
const AUDIT_LOG_PATH = path.join(DATA_DIR, "admin-audit-log.jsonl");

function typedError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 500;
  return error;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).sort().forEach((key) => {
      if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    });
    return out;
  }
  return value;
}

function canonicalEventSha256(event) {
  const semantic = { ...(event || {}) };
  delete semantic.eventSha256;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(semantic))).digest("hex");
}

function validateOperationId(value) {
  const operationId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(operationId)) {
    throw typedError("admin audit operation id is invalid", "AUDIT_OPERATION_ID_INVALID");
  }
  return operationId;
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

function readAndRepairTail() {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
  let text = fs.readFileSync(AUDIT_LOG_PATH, "utf8");
  if (text && !text.endsWith("\n")) {
    const lastBreak = text.lastIndexOf("\n");
    const tail = text.slice(lastBreak + 1);
    try {
      JSON.parse(tail);
      fs.appendFileSync(AUDIT_LOG_PATH, "\n", "utf8");
      text += "\n";
    } catch (_) {
      const retained = lastBreak >= 0 ? text.slice(0, lastBreak + 1) : "";
      fs.truncateSync(AUDIT_LOG_PATH, Buffer.byteLength(retained, "utf8"));
      text = retained;
    }
  }
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { throw typedError("admin audit log contains malformed committed data", "AUDIT_LOG_MALFORMED"); }
  });
}

function withAuditLock(callback) {
  const release = acquireExclusiveFileLock(AUDIT_LOG_PATH, {
    lockPath: `${AUDIT_LOG_PATH}.lock`,
    codePrefix: "ADMIN_AUDIT",
    waitMs: Number(process.env.FOSU_ADMIN_AUDIT_LOCK_WAIT_MS || 1000),
    staleMs: Number(process.env.FOSU_ADMIN_AUDIT_LOCK_STALE_MS || 30000),
  });
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    return callback();
  } finally {
    release();
  }
}

function appendPayload(payload) {
  const existed = fs.existsSync(AUDIT_LOG_PATH);
  const bytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  const descriptor = fs.openSync(AUDIT_LOG_PATH, "a", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (!written) throw typedError("admin audit append made no progress", "AUDIT_APPEND_FAILED");
      offset += written;
    }
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  if (!existed) fsyncDirectory(path.dirname(AUDIT_LOG_PATH));
}

function appendOperation(event, operationIdInput, expectedEventSha256) {
  const operationId = validateOperationId(operationIdInput || (event && event.operationId));
  const semanticPayload = { ...(event || {}), operationId };
  delete semanticPayload.eventSha256;
  const eventSha256 = canonicalEventSha256(semanticPayload);
  if (expectedEventSha256 && expectedEventSha256 !== eventSha256) {
    throw typedError("admin audit event digest does not match its operation", "AUDIT_EVENT_DIGEST_INVALID");
  }
  return withAuditLock(() => {
    const matches = readAndRepairTail().filter((entry) => entry.operationId === operationId);
    if (matches.length > 1) throw typedError("admin audit operation appears more than once", "AUDIT_OPERATION_COLLISION");
    if (matches.length === 1) {
      const existing = matches[0];
      const existingDigest = canonicalEventSha256(existing);
      if ((existing.eventSha256 && existing.eventSha256 !== existingDigest) || existingDigest !== eventSha256) {
        throw typedError("admin audit operation id refers to a different event", "AUDIT_OPERATION_COLLISION");
      }
      return { duplicate: true, eventSha256 };
    }
    appendPayload({ ...semanticPayload, eventSha256 });
    return { duplicate: false, eventSha256 };
  });
}

function append(event, options = {}) {
  const operationId = String(options.operationId || (event && event.operationId) || "").trim();
  if (operationId) return appendOperation(event, operationId, options.eventSha256);
  return withAuditLock(() => {
    const payload = { ...(event || {}) };
    const bytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
    if (!bytes.length) throw typedError("admin audit event is empty", "AUDIT_EVENT_INVALID");
    readAndRepairTail();
    appendPayload(payload);
    return { duplicate: false };
  });
}

function readAll() {
  return withAuditLock(() => readAndRepairTail());
}

function findOperation(operationIdInput) {
  const operationId = validateOperationId(operationIdInput);
  return withAuditLock(() => {
    const matches = readAndRepairTail().filter((entry) => entry.operationId === operationId);
    if (!matches.length) return null;
    if (matches.length > 1) throw typedError("admin audit operation appears more than once", "AUDIT_OPERATION_COLLISION");
    const event = matches[0];
    const eventSha256 = canonicalEventSha256(event);
    if (event.eventSha256 && event.eventSha256 !== eventSha256) throw typedError("admin audit event digest is invalid", "AUDIT_OPERATION_COLLISION");
    return { event, eventSha256 };
  });
}

function appendCatalogOperation(payload) {
  const identity = payload.identity || {};
  const event = {
    time: payload.time || payload.createdAt || new Date().toISOString(),
    action: "catalog-import-apply",
    module: "catalog",
    target: payload.type,
    operationId: payload.operationId,
    previewIdPrefix: payload.previewIdPrefix,
    sourceFingerprint: payload.sourceFingerprint,
    baseVersion: payload.baseVersion,
    resultVersion: payload.resultVersion,
    generationId: payload.generationId,
    summary: payload.summary,
    backupId: payload.backupId,
    operator: identity.operator || "admin",
    operatorName: identity.operator || "admin",
    tokenName: identity.tokenName || "",
    scopes: Array.isArray(identity.scopes) ? identity.scopes : [],
    sessionIdPrefix: identity.sessionIdPrefix || "",
    authMethod: identity.authMethod || "unknown",
    requestId: identity.requestId || "",
    ip: identity.ip || "",
    legacyToken: false,
  };
  return appendOperation(event, payload.operationId, payload.eventSha256);
}

module.exports = {
  AUDIT_LOG_PATH,
  append,
  appendCatalogOperation,
  appendOperation,
  canonicalEventSha256,
  findOperation,
  readAll,
};
