/**
 * P5a WS4a：知识审计条目整形与幂等指纹的共享实现。
 *
 * 从 knowledgeControlPlane 原样抽取（行为零变化），供文件实现
 * （KnowledgeAuditService / IdempotencyStore）与 PG 实现
 * （persistence/pgKnowledgeAuditService / pgIdempotencyStore）共用——
 * 审计字段口径、脱敏规则、指纹算法只此一份，不复制领域规则。
 */
const crypto = require("crypto");

function safeText(value, limit = 100) {
  return String(value || "").replace(/[\r\n\t]/g, " ").slice(0, limit);
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function typedError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/**
 * 审计条目整形 + 落盘前脱敏（与 P5a 之前 KnowledgeAuditService.record 的
 * 字段口径逐字一致）：任何 Bearer/password/api_key 痕迹出现时
 * tokenName 一律改写为占位，绝不持久化真实凭据。
 */
function buildAuditEntry(event = {}) {
  const item = {
    auditId: safeText(event.auditId || createId("kba"), 60),
    requestId: safeText(event.requestId, 80),
    action: safeText(event.action, 60),
    targetType: safeText(event.targetType, 24),
    targetId: safeText(event.targetId, 100),
    beforeVersion: safeText(event.beforeVersion || event.versionId, 100),
    afterVersion: safeText(event.afterVersion, 100),
    operatorType: safeText(event.operatorType || "system", 40),
    operatorName: safeText(event.operatorName, 80),
    tokenName: safeText(event.tokenName, 80),
    scopes: Array.isArray(event.scopes)
      ? event.scopes.map((scope) => safeText(scope, 60)).slice(0, 20)
      : [],
    authMethod: safeText(event.authMethod, 40),
    clientName: safeText(event.clientName, 80),
    idempotencyKey: safeText(event.idempotencyKey, 120),
    success: event.success !== false,
    errorCode: safeText(event.errorCode, 80),
    createdAt: event.createdAt || nowIso(),
  };
  // Never persist tokens/passwords/raw headers
  const serialized = JSON.stringify(item);
  if (/Bearer\s+[A-Za-z0-9._~+/=-]{8,}|password|api[_-]?key/i.test(serialized)) {
    item.tokenName = item.tokenName ? "[redacted-name]" : "";
  }
  return item;
}

/** 幂等指纹：请求体规范化 JSON 的 SHA-256（双后端同口径）。 */
function fingerprintBody(body) {
  return crypto.createHash("sha256").update(JSON.stringify(body || {})).digest("hex");
}

module.exports = {
  buildAuditEntry,
  createId,
  fingerprintBody,
  nowIso,
  safeText,
  typedError,
};
