const safetyGuard = require("../safetyGuard");
const runtimeModeService = require("../runtimeModeService");
const agentProtocol = require("../agentProtocol");

/**
 * Request context assembly: sanitizes message/context, resolves the runtime
 * mode decision, and derives the protocol/run identifiers chat() orchestrates
 * with. Named requestContextAssembler to avoid confusion with
 * context/contextAssembler (budgeted provider context assembly).
 */
function prepareRequest(input = {}) {
  const startTime = Date.now();
  const rawMessage = String(input.message || "").trim();
  const safeMessage = safetyGuard.redactSensitiveText(rawMessage).slice(0, 2000);
  const context = safetyGuard.sanitizeAgentContext(input.context || {});
  const runtimeDecision = runtimeModeService.resolveRuntimeMode({
    context,
    serverSession: input.serverSession,
    runtimeMode: input.runtimeMode,
  });
  context.runtimeMode = runtimeDecision.runtimeMode;
  context.serverSession = input.serverSession || context.serverSession || null;
  const requestId = input.requestId || agentProtocol.createRequestId();
  const conversationId = input.conversationId || context.conversationId || "";
  const requestedProtocolVersion = input.protocolVersion || context.protocolVersion || agentProtocol.PROTOCOL_VERSION;
  const protocolVersion = agentProtocol.normalizeProtocolVersion(requestedProtocolVersion);
  const runId = input.runId || agentProtocol.createRunId();
  const eventInput = Object.assign({}, input, {
    runtimeMode: runtimeDecision.runtimeMode,
    onEvent: input.onEvent,
  });
  return {
    startTime,
    rawMessage,
    safeMessage,
    context,
    runtimeDecision,
    requestId,
    conversationId,
    protocolVersion,
    runId,
    eventInput,
  };
}

function deriveUsedPersonalContext(context = {}) {
  return Boolean(context.currentScheduleSummary &&
    context.currentScheduleSummary.enabled &&
    context.currentScheduleSummary.courses &&
    context.currentScheduleSummary.courses.length);
}

module.exports = {
  prepareRequest,
  deriveUsedPersonalContext,
};
