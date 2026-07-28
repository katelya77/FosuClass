const safetyGuard = require("../safetyGuard");

/**
 * Tool execution coordination: projections of kernel tool calls for the
 * public/sanitized response view and for provider input. Tool execution itself
 * stays in toolRegistry / agentKernel.
 */
function toPublicToolCalls(toolCalls) {
  return toolCalls.map((item) => ({
    name: safetyGuard.redactSensitiveText(item.name || "").slice(0, 60),
    status: safetyGuard.redactSensitiveText(item.status || "").slice(0, 20),
    summary: safetyGuard.redactSensitiveText(item.summary || "").slice(0, 160),
  }));
}

function buildToolResultsForProvider(toolCalls) {
  return toolCalls.map((item) => ({
    name: item.name,
    status: item.status,
    summary: safetyGuard.redactSensitiveText(item.summary || ""),
    result: safetyGuard.sanitizeToolResult(item.result),
  }));
}

/**
 * M2-T2: pass-through collection of executed tool results for runtime
 * verification. Pure projection of kernel tool calls into { toolId, result }
 * pairs for verificationCoordinator.verifyToolResults — execution itself
 * stays in toolRegistry / agentKernel and is not touched here.
 */
function collectToolResults(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .filter((call) => call && typeof call.name === "string" && call.name)
    .map((call) => ({
      toolId: String(call.name),
      status: String(call.status || ""),
      result: call.result && typeof call.result === "object" ? call.result : {},
    }));
}

module.exports = {
  toPublicToolCalls,
  buildToolResultsForProvider,
  collectToolResults,
};
