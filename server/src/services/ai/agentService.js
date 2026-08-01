// Compatibility facade: every online Turn now enters the shared Agent Platform.
// Fosu-specific phase logic lives in runtime/fosuTurnPorts and is injected by
// platformComposition; this file no longer owns a private orchestration path.
const safetyGuard = require("./safetyGuard");
const agentProtocol = require("./agentProtocol");
const runtimeModeService = require("./runtimeModeService");
const { defaultMemoryController } = require("./memory/memoryController");
const { evaluateProactive, factsFromContext } = require("./proactiveEngine");
const { nowIso, stableAction, stableCard, stableGeneratedPayload } = require("./runtime/shared");
const { recordEarlyTrace } = require("./runtime/runEventPublisher");
const providerOrchestrator = require("./runtime/providerOrchestrator");
const actionReceiptCoordinator = require("./runtime/actionReceiptCoordinator");
const responseComposerBridge = require("./runtime/responseComposerBridge");
const { deriveReminderPendingAction } = require("./runtime/fosuTurnPorts");
const platformComposition = require("./platformComposition");

const {
  buildResponse,
  buildMetrics,
  deriveFinalResponseOutcome,
  normalizeProactiveSuggestion,
} = responseComposerBridge;
const {
  deriveActionCommands,
  derivePendingAction,
} = actionReceiptCoordinator;

// maybe-async 透传（P5a WS6）：file 后端同步返回原值；postgres 后端返回 Promise。
function isThenable(value) {
  return Boolean(value) && typeof value.then === "function";
}

function chain(value, onFulfilled, onRejected) {
  if (!isThenable(value)) return onFulfilled(value);
  return value.then(onFulfilled, onRejected);
}

async function chat(input = {}) {
  return platformComposition.getPlatform().executeTurn(input);
}

function evaluateProactiveForRequest(input = {}) {
  const context = safetyGuard.sanitizeAgentContext(input.context || {});
  const event = String(input.event || context.proactiveEvent || "").slice(0, 64);
  return chain(defaultMemoryController.load({
    message: "",
    context,
    conversationId: input.conversationId,
    serverSession: input.serverSession,
    runtimeMode: input.runtimeMode,
    memoryMode: context.memoryMode || input.memoryMode,
    cloudSyncEnabled: context.cloudSyncEnabled === true,
  }), (memoryBundle) => {
    const facts = Object.assign({}, factsFromContext(context), input.facts && typeof input.facts === "object" ? input.facts : {});
    const result = evaluateProactive({
      event,
      principal: memoryBundle.principal,
      principalKey: memoryBundle.principal && memoryBundle.principal.principalKey || "",
      context: {
        disabledProactiveTypes: context.disabledProactiveTypes || context.proactiveOptOut,
        proactiveOptOut: context.proactiveOptOut,
      },
      facts,
    });
    return {
      success: true,
      event: result.event || event,
      reason: result.reason || "",
      proactiveSuggestion: result.suggestion ? normalizeProactiveSuggestion(result.suggestion) : null,
      serverTime: nowIso(),
    };
  });
}

function buildServiceFailureResponse(input = {}, error = {}) {
  const protocolVersion = agentProtocol.isSupportedProtocolVersion(input.protocolVersion)
    ? agentProtocol.normalizeProtocolVersion(input.protocolVersion)
    : agentProtocol.PROTOCOL_VERSION;
  const requestId = input.requestId || agentProtocol.createRequestId();
  const conversationId = String(input.conversationId || "").slice(0, 80);
  const runId = input.runId || agentProtocol.createRunId();
  const runtimeMode = runtimeModeService.resolveRuntimeMode({
    context: safetyGuard.sanitizeAgentContext(input.context || {}),
    serverSession: input.serverSession,
  }).runtimeMode;
  const errorCode = String(error.code || "AGENT_SERVICE_UNAVAILABLE").slice(0, 80);
  recordEarlyTrace({
    runId,
    requestId,
    conversationId,
    runtimeMode,
    startTime: input.startTime || Date.now(),
    intent: "conversational_help",
    selectedSkill: "service_failure",
    fallbackReason: errorCode,
    errorCode,
  });
  return buildResponse({
    protocolVersion,
    requestId,
    conversationId,
    runId,
    runtimeMode,
    success: false,
    status: "failed",
    answer: "服务端 Agent 暂时不可用，客户端可以切换到离线降级能力。",
    cards: [{
      type: "generic",
      title: "服务暂不可用",
      subtitle: "可继续使用已缓存课表和本地校园入口。",
      badges: ["可降级"],
      items: [],
      actions: [],
    }],
    suggestions: ["查看今天课表", "打开全校课表", "打开空教室"],
    toolCalls: [],
    intent: { name: "conversational_help", confidence: 0, slots: {} },
    skill: { id: "service_failure", allowedTools: [], runtimeModes: ["public", "trial", "dev"] },
    plan: [],
    steps: [],
    observations: [],
    evidence: {
      checkedAt: nowIso(),
      term: "",
      releaseVersion: "",
      currentWeek: "",
      sources: [],
      toolCount: 0,
      complete: false,
    },
    provider: "mock",
    providerPolicy: "tool-only",
    externalProviderUsed: false,
    fallback: true,
    fallbackLayer: "server",
    fallbackReason: errorCode,
    fallbackAllowed: true,
    errors: [{ code: errorCode }],
    memory: {
      mode: "local_only",
      authenticated: Boolean(input.serverSession && input.serverSession.openidHash),
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    },
    metrics: buildMetrics({
      startTime: input.startTime || Date.now(),
      intentName: "agent_service_failure",
      toolCalls: [],
      fallback: true,
    }),
  });
}

function __getPlatformForTests() {
  // P5a：platformComposition.getDiagnostics 已 async 化，直接透传 Promise。
  return platformComposition.getDiagnostics();
}

module.exports = {
  buildEvidence: responseComposerBridge.buildEvidence,
  buildServiceFailureResponse,
  chat,
  evaluateProviderPolicy: providerOrchestrator.evaluateProviderPolicy,
  evaluateProactiveForRequest,
  shouldUseExternalProvider: providerOrchestrator.shouldUseExternalProvider,
  stableAction,
  stableCard,
  stableGeneratedPayload,
  classifyProviderFailure: providerOrchestrator.classifyProviderFailure,
  deriveExecutionOutcome: responseComposerBridge.deriveExecutionOutcome,
  deriveFinalResponseOutcome,
  deriveProviderRunTruth: providerOrchestrator.deriveProviderRunTruth,
  deriveValidatedResponseStatus: responseComposerBridge.deriveValidatedResponseStatus,
  normalizeProactiveSuggestion,
  deriveActionCommands,
  derivePendingAction,
  deriveReminderPendingAction,
  buildScheduleNavigateAction: actionReceiptCoordinator.buildScheduleNavigateAction,
  scheduleOpenLabel: actionReceiptCoordinator.scheduleOpenLabel,
  __getPlatformForTests,
};
