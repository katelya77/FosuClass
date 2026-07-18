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

function append(event, options = {}) {
  return withAuditLock(() => {
    const entries = readAndRepairTail();
    const operationId = String(options.operationId || event.operationId || "").trim();
    if (operationId && entries.some((entry) => entry.operationId === operationId)) return { duplicate: true };
    const payload = { ...event, ...(operationId ? { operationId } : {}) };
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
    return { duplicate: false };
  });
}

function readAll() {
  return withAuditLock(() => readAndRepairTail());
}

function appendCatalogOperation(payload) {
  const identity = payload.identity || {};
  return append({
    time: new Date().toISOString(),
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
  }, { operationId: payload.operationId });
}

module.exports = { AUDIT_LOG_PATH, append, appendCatalogOperation, readAll };
