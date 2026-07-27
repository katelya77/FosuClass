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

module.exports = {
  toPublicToolCalls,
  buildToolResultsForProvider,
};
