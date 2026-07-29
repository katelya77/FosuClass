const { sanitizePublicValue } = require("./runEvent");

const STAGE_NAMES = new Set([
  "createRun",
  "context",
  "decision",
  "skill_tool",
  "tool",
  "verification",
  "response",
  "ui",
  "total",
]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength) {
  return String(value == null ? "" : value).slice(0, maxLength);
}

function normalizeStage(input = {}) {
  const stage = safeString(input.stage, 40);
  if (!STAGE_NAMES.has(stage)) throw codedError("PLATFORM_TRACE_STAGE_UNSUPPORTED", stage);
  return Object.freeze({
    stage,
    owner: safeString(input.owner || "@xiaofu-agent/agent-runtime", 120),
    outcome: safeString(input.outcome || "success", 32),
    durationMs: Math.max(0, Number(input.durationMs) || 0),
    details: Object.freeze(sanitizePublicValue(input.details || {})),
  });
}

function createPlatformTrace(input = {}) {
  const runId = safeString(input.runId, 128);
  if (!runId) throw codedError("PLATFORM_TRACE_RUN_ID_REQUIRED");
  const pluginIds = Array.from(new Set((Array.isArray(input.pluginIds) ? input.pluginIds : [])
    .map((item) => safeString(item, 100))
    .filter(Boolean)));
  return Object.freeze({
    runId,
    runtimePackage: safeString(input.runtimePackage || "@xiaofu-agent/agent-runtime", 120),
    configVersion: safeString(input.configVersion || "unversioned", 128),
    pluginIds: Object.freeze(pluginIds),
    stages: Object.freeze((Array.isArray(input.stages) ? input.stages : []).map(normalizeStage)),
  });
}

module.exports = {
  createPlatformTrace,
};
