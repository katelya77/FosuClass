const crypto = require("crypto");

const RUN_EVENT_TYPES = Object.freeze([
  "run.accepted",
  "request.sanitized",
  "memory.loaded",
  "runtime.entered",
  "context.started",
  "context.completed",
  "understanding.started",
  "understanding.completed",
  "understanding.fallback",
  "decision.started",
  "decision.completed",
  "provider.selected",
  "provider.started",
  "provider.completed",
  "provider.failed",
  "provider.shadow.started",
  "provider.shadow.completed",
  "provider.shadow.failed",
  "intent.resolved",
  "skill.selected",
  "plan.started",
  "plan.completed",
  "plan.created",
  "plan.replan",
  "planner.started",
  "planner.completed",
  "planner.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "result.verifying",
  "verification.started",
  "verification.completed",
  "response.composing",
  "response.completed",
  "ui.completed",
  "stage.started",
  "stage.completed",
  "stage.failed",
  "runtime.completed",
  "run.completed",
  "run.degraded",
  "run.failed",
  "run.cancelled"
]);

const RUN_EVENT_TYPE_SET = new Set(RUN_EVENT_TYPES);
const SENSITIVE_KEY = /(api.?key|authorization|cookie|credential|password|secret|system.?prompt|hidden.?reasoning|token)/i;

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, maxLength);
}

function sanitizePublicValue(value, depth = 0) {
  if (depth > 6 || value == null) return value == null ? null : undefined;
  if (typeof value === "string") return safeString(value, 2000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizePublicValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const output = {};
  Object.entries(value).slice(0, 100).forEach(([rawKey, rawValue]) => {
    const key = safeString(rawKey, 80);
    if (!key || SENSITIVE_KEY.test(key)) return;
    const safeValue = sanitizePublicValue(rawValue, depth + 1);
    if (safeValue !== undefined) output[key] = safeValue;
  });
  return output;
}

function normalizeTimestamp(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) throw codedError("RUN_EVENT_TIMESTAMP_INVALID");
  return parsed.toISOString();
}

function createRunEvent(input = {}) {
  const runId = safeString(input.runId, 128);
  if (!runId) throw codedError("RUN_EVENT_RUN_ID_REQUIRED");
  const sequence = Number(input.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) throw codedError("RUN_EVENT_SEQUENCE_INVALID");
  const type = safeString(input.type, 80);
  if (!RUN_EVENT_TYPE_SET.has(type)) throw codedError("RUN_EVENT_TYPE_UNSUPPORTED", type);
  const eventId = safeString(input.eventId || `evt_${crypto.randomUUID().replace(/-/g, "")}`, 128);
  return Object.freeze({
    eventId,
    runId,
    sequence,
    type,
    protocolVersion: safeString(input.protocolVersion || "run.v1", 32),
    configVersion: safeString(input.configVersion || "unversioned", 128),
    createdAt: normalizeTimestamp(input.createdAt),
    publicPayload: Object.freeze(sanitizePublicValue(input.publicPayload || {})),
  });
}

module.exports = {
  RUN_EVENT_TYPES,
  createRunEvent,
  sanitizePublicValue,
};
