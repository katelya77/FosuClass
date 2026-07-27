const agentTraceRecorder = require("../agentTraceRecorder");
const { loadingTextForEvent } = require("../runEventCatalog");
const { nowIso } = require("./shared");

function emitChatEvent(input, event = {}) {
  if (typeof input.onEvent !== "function") return;
  try {
    input.onEvent(Object.assign({
      at: nowIso(),
      label: event.label || loadingTextForEvent(event, event.runtimeMode || input.runtimeMode || "public"),
    }, event));
  } catch (error) {
    // events are best-effort
  }
}

function recordEarlyTrace(payload = {}) {
  return agentTraceRecorder.record({
    runId: payload.runId,
    requestId: payload.requestId,
    conversationId: payload.conversationId,
    runtimeMode: payload.runtimeMode || "public",
    intent: payload.intent || "conversational_help",
    selectedSkill: payload.selectedSkill || "",
    stepCount: 0,
    toolCalls: payload.toolCalls || [],
    steps: [],
    totalDurationMs: Math.max(0, Date.now() - (payload.startTime || Date.now())),
    providerUsed: false,
    fallbackLayer: payload.fallbackLayer || "server",
    fallbackReason: payload.fallbackReason || "",
    evidenceComplete: payload.evidenceComplete === true,
    errorCode: payload.errorCode || "",
  });
}

module.exports = {
  emitChatEvent,
  recordEarlyTrace,
};
