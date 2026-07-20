const crypto = require("crypto");
const capabilityManifestService = require("./capabilityManifestService");

const defaults = capabilityManifestService.getManifest().limits;
let config = {
  maxEntries: defaults.maxTraceEntries,
  retentionMs: defaults.traceRetentionMs,
};
let traces = [];

function hashConversationId(value) {
  return crypto.createHash("sha256").update(String(value || "anonymous")).digest("hex").slice(0, 16);
}

const SECRET_TEXT_PATTERN = /(password|passwd|pwd|secret|token|authorization|cookie|set-cookie|api[-_]?key|access[-_]?key|session[-_]?id|credential|ticket)\s*[:=]\s*[^\s,;]+/gi;

function redactSecrets(text) {
  return String(text || "").replace(SECRET_TEXT_PATTERN, "[redacted]");
}

function safeText(value, limit) {
  return redactSecrets(String(value || "").replace(/[\r\n\t]/g, " ")).slice(0, limit);
}

function prune(now = Date.now()) {
  const cutoff = now - config.retentionMs;
  traces = traces.filter((item) => {
    const at = Date.parse(item.recordedAt || "");
    return Number.isFinite(at) && at >= cutoff;
  }).slice(-config.maxEntries);
}

function sanitizeToolCalls(value) {
  return (Array.isArray(value) ? value : []).slice(0, defaults.maxPlanSteps).map((call) => ({
    name: safeText(call && (call.name || call.toolName), 80),
    status: safeText(call && call.status, 24),
  }));
}

function sanitizeSteps(value) {
  return (Array.isArray(value) ? value : []).slice(0, defaults.maxPlanSteps).map((step, index) => ({
    id: safeText(step && (step.id || step.key) || `step-${index + 1}`, 80),
    tool: safeText(step && (step.tool || step.toolName), 80),
    status: safeText(step && step.status, 24),
    durationMs: Math.max(0, Number(step && step.durationMs || 0) || 0),
    errorCode: safeText(step && step.errorCode, 80),
    retried: Boolean(step && step.retried),
  }));
}

function sanitizeTrace(input = {}) {
  const now = new Date().toISOString();
  return {
    runId: safeText(input.runId, 100),
    requestId: safeText(input.requestId, 100),
    conversationIdHash: hashConversationId(input.conversationId),
    runtimeMode: safeText(input.runtimeMode || "public", 16),
    intent: safeText(input.intent && input.intent.name || input.intent, 80),
    selectedSkill: safeText(input.selectedSkill && input.selectedSkill.id || input.selectedSkill, 80),
    stepCount: Math.max(0, Number(input.stepCount || (Array.isArray(input.steps) ? input.steps.length : 0)) || 0),
    toolCalls: sanitizeToolCalls(input.toolCalls),
    steps: sanitizeSteps(input.steps),
    totalDurationMs: Math.max(0, Number(input.totalDurationMs || 0) || 0),
    providerUsed: input.providerUsed === true,
    fallbackLayer: safeText(input.fallbackLayer || "none", 24),
    fallbackReason: safeText(input.fallbackReason, 120),
    evidenceComplete: input.evidenceComplete === true,
    errorCode: safeText(input.errorCode, 80),
    recordedAt: now,
  };
}

function record(input = {}) {
  const trace = sanitizeTrace(input);
  traces.push(trace);
  prune();
  return trace;
}

function listForTest() {
  prune();
  return traces.map((item) => Object.assign({}, item, {
    toolCalls: item.toolCalls.map((call) => Object.assign({}, call)),
    steps: item.steps.map((step) => Object.assign({}, step)),
  }));
}

function clearForTest() {
  traces = [];
  config = {
    maxEntries: defaults.maxTraceEntries,
    retentionMs: defaults.traceRetentionMs,
  };
}

function configureForTest(options = {}) {
  config = {
    maxEntries: Math.max(1, Number(options.maxEntries || config.maxEntries) || config.maxEntries),
    retentionMs: Math.max(1000, Number(options.retentionMs || config.retentionMs) || config.retentionMs),
  };
  prune();
}

module.exports = {
  clearForTest,
  configureForTest,
  hashConversationId,
  listForTest,
  record,
  sanitizeTrace,
};
