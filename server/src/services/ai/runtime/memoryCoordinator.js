const agentProtocol = require("../agentProtocol");
const safetyGuard = require("../safetyGuard");
const { defaultMemoryController } = require("../memory/memoryController");
const { defaultUserPreferenceService } = require("../conversation/userPreferenceService");
const { resolvePersonalMemoryTurn } = require("../conversation/personalMemoryInterpreter");
const { isPublicRuntime } = require("./shared");
const { emitChatEvent, recordEarlyTrace } = require("./runEventPublisher");
const { deriveProviderRunTruth } = require("./providerOrchestrator");
const {
  buildResponse,
  buildMetrics,
  buildContextSlots,
  deriveExecutionOutcome,
  maybeAttachProactive,
} = require("./responseComposerBridge");
const { earlyTraceSkillFor, personalMemorySkill } = require("./skillRouter");

/**
 * Memory load coordination: unified MemoryController load with the
 * local_only fallback bundle and context merge (verbatim from agentService).
 */
function loadConversationMemory(input = {}) {
  const runtimeMode = input.runtimeMode;
  const serverSession = input.serverSession;
  const conversationId = input.conversationId;
  const safeMessage = input.message;
  let context = input.context || {};
  let memoryBundle = {
    principal: { authenticated: false, principalKey: "", runtimeMode: runtimeMode },
    state: null,
    memory: {
      mode: "local_only",
      authenticated: false,
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    },
    context,
  };
  let conversationState = null;
  try {
    // Unified MemoryController: working + thread + user memory (single authoritative path).
    memoryBundle = defaultMemoryController.load({
      serverSession: serverSession,
      runtimeMode: runtimeMode,
      conversationId,
      message: safeMessage,
      context,
      memoryMode: context.memoryMode,
      releaseContext: input.releaseContext || null,
      executionPolicy: input.executionPolicy || "",
      policy: input.policy || null,
    });
    conversationState = memoryBundle.conversationState || null;
    context = safetyGuard.sanitizeAgentContext(memoryBundle.context || context);
    context.runtimeMode = runtimeMode;
    context.serverSession = serverSession || null;
    if (conversationState) {
      context.conversationSummary = conversationState.conversationSummary || context.conversationSummary;
      context.workingMemory = conversationState.workingMemory || context.workingMemory;
      context.userMemories = conversationState.userMemories || context.userMemories || [];
      context.episodicMemories = conversationState.episodicMemories || context.episodicMemories || [];
      context.recentMessages = conversationState.recentMessages || context.recentMessages;
    }
  } catch (error) {
    memoryBundle.memory = {
      mode: "local_only",
      authenticated: Boolean(serverSession && serverSession.openidHash),
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    };
    conversationState = null;
  }
  return { memoryBundle, conversationState, context };
}

/**
 * Personal-memory turn coordination: explicit preference/session memory turns
 * short-circuit the planner with a composed mock response. Returns null when
 * the turn is not handled so chat() continues the normal pipeline.
 */
function handlePersonalMemoryTurn(input = {}) {
  const safeMessage = input.message;
  const context = input.context;
  const memoryBundle = input.memoryBundle;
  const runtimeMode = input.runtimeMode;
  const runtimeDecision = input.runtimeDecision;
  const protocolVersion = input.protocolVersion;
  const runId = input.runId;
  const requestId = input.requestId;
  const conversationId = input.conversationId;
  const eventInput = input.eventInput;
  const startTime = input.startTime;
  const understanding = input.understanding;
  const goalContractV2 = input.goalContractV2;
  const personalMemoryTurn = resolvePersonalMemoryTurn({
    message: safeMessage,
    context,
    principal: memoryBundle.principal,
    memoryMode: memoryBundle.memory && memoryBundle.memory.mode || context.memoryMode,
    preferenceService: defaultUserPreferenceService,
    policy: input.policy || null,
  });
  if (personalMemoryTurn.handled) {
    const personalProviderTruth = deriveProviderRunTruth({
      runtimeMode: runtimeMode,
      understanding,
      planner: {},
      response: { provider: "mock", externalProviderUsed: false, providerChain: [], fallbackReason: "" },
    });
    const personalOutcome = deriveExecutionOutcome({
      execution: { verification: { ok: true, errors: [] }, partialCompletion: false },
      providerTruth: personalProviderTruth,
    });
    emitChatEvent(eventInput, {
      type: "response.composing",
      runtimeMode: runtimeMode,
      intentName: personalMemoryTurn.intentName,
      providerUsed: personalProviderTruth.externalProviderUsed,
    });
    const memoryIntent = {
      name: personalMemoryTurn.intentName,
      confidence: 1,
      slots: personalMemoryTurn.preferencePatch || {},
    };
    const preferenceActions = Array.isArray(personalMemoryTurn.actions) ? personalMemoryTurn.actions : [];
    const preferenceCards = preferenceActions.length
      ? [{
        type: "reminder",
        title: personalMemoryTurn.preferencePatch && personalMemoryTurn.preferencePatch.defaultReminderLeadMinutes
          ? "默认提醒已更新"
          : "提醒偏好",
        subtitle: personalMemoryTurn.preferencePatch && personalMemoryTurn.preferencePatch.defaultReminderLeadMinutes
          ? `上课前 ${personalMemoryTurn.preferencePatch.defaultReminderLeadMinutes} 分钟 · 可一键创建`
          : "可直接点选，或打开智能课程提醒面板",
        badges: ["智能配置", "本机偏好"],
        actions: preferenceActions.slice(0, 3),
      }]
      : [];
    const response = attachMemory(buildResponse({
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      answer: personalMemoryTurn.answer,
      cards: preferenceCards,
      suggestions: personalMemoryTurn.intentName === "update_user_preference"
        ? ["打开智能课程提醒", "默认提前20分钟提醒我", "默认提前30分钟提醒我"]
        : [],
      toolCalls: [],
      intent: memoryIntent,
      plan: [],
      steps: [],
      observations: [],
      skill: personalMemorySkill(),
      provider: "mock",
      desiredProvider: "mock",
      resolvedProvider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: personalProviderTruth.externalProviderUsed,
      providerStages: personalProviderTruth.stages,
      understanding,
      goalContract: understanding.contract,
      fallback: personalProviderTruth.fallback,
      fallbackReason: personalProviderTruth.fallbackReason,
      fallbackLayer: personalProviderTruth.fallback ? "server" : "none",
      status: personalOutcome.status,
      success: personalOutcome.success,
      memory: memoryBundle.memory,
      memoryPreferencePatch: personalMemoryTurn.preferencePatch || {},
      context,
      metrics: buildMetrics({
        startTime,
        intentName: personalMemoryTurn.intentName,
        toolCalls: [],
        externalProviderUsed: personalProviderTruth.externalProviderUsed,
        fallback: personalProviderTruth.fallback,
        usedPersonalContext: Boolean(personalMemoryTurn.source && personalMemoryTurn.source !== "none"),
      }),
    }), memoryBundle, {
      message: safeMessage,
      answer: personalMemoryTurn.answer,
      intentName: personalMemoryTurn.intentName,
      context,
      runId,
      status: personalOutcome.status,
      stepCount: 0,
      contextSlots: buildContextSlots(memoryIntent, Object.assign(
        {},
        personalMemoryTurn.sessionFacts || {},
        personalMemoryTurn.preferencePatch || {}
      )),
      clearPendingClarification: false,
      cloudSyncEnabled: context.cloudSyncEnabled === true || (memoryBundle.memory && memoryBundle.memory.mode === "cloud_sync"),
      preferencePatch: personalMemoryTurn.preferencePatch || {},
      memoryCandidates: personalMemoryTurn.memoryCandidates || [],
      preferredName: (personalMemoryTurn.preferencePatch && personalMemoryTurn.preferencePatch.preferredName)
        || (personalMemoryTurn.sessionFacts && personalMemoryTurn.sessionFacts.preferredName)
        || "",
      autoMemoryEnabled: context.autoMemoryEnabled !== false,
      providerUsed: understanding.providerUsed || "",
      understandingSource: understanding.source,
      goalContract: goalContractV2 || undefined,
      policy: input.policy || null,
    });
    if (personalMemoryTurn.autoMemoryHint && !response.autoMemoryHint) {
      response.autoMemoryHint = personalMemoryTurn.autoMemoryHint;
    }
    maybeAttachProactive(response, { context, proactiveEvent: context.proactiveEvent }, memoryBundle, []);
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeMode,
      startTime,
      intent: personalMemoryTurn.intentName,
      selectedSkill: earlyTraceSkillFor("PERSONAL_MEMORY"),
    });
    emitChatEvent(eventInput, {
      type: personalOutcome.eventType,
      runtimeMode: runtimeMode,
      intentName: personalMemoryTurn.intentName,
      providerUsed: personalProviderTruth.externalProviderUsed,
      status: personalOutcome.status,
      success: personalOutcome.success,
      fallback: personalProviderTruth.fallback,
      verificationOk: personalOutcome.verificationOk,
      errorCount: personalOutcome.errors.length,
    });
    return response;
  }
  return null;
}

function attachMemory(response, memoryBundle, options = {}) {
  const status = options.status || response.status;
  if (status === "cancelled" || response.status === "cancelled") {
    response.memory = memoryBundle && memoryBundle.memory || {
      mode: "local_only",
      authenticated: false,
      persisted: false,
      synced: false,
      revision: 0,
    };
    return response;
  }
  // Unified commit path: working + thread + user memory candidates.
  const commitResult = defaultMemoryController.commit({
    principal: memoryBundle && memoryBundle.principal,
    state: memoryBundle && memoryBundle.state,
    memoryBundle,
    conversationId: response.conversationId,
    memoryMode: memoryBundle && memoryBundle.memory && memoryBundle.memory.mode,
    cloudSyncEnabled: options.cloudSyncEnabled === true,
    message: options.message,
    answer: options.answer || response.answer,
    intentName: options.intentName || (response.intent && response.intent.name) || response.intent,
    context: options.context,
    runId: options.runId || response.runId,
    status,
    stepCount: options.stepCount || (Array.isArray(response.steps) ? response.steps.length : 0),
    contextSlots: options.contextSlots || response.contextSlots || response.slots,
    slots: options.slots || response.slots,
    pendingClarification: options.pendingClarification,
    clearPendingClarification: options.clearPendingClarification,
    evidence: options.evidence || response.evidence,
    failed: response.success === false,
    cancelled: status === "cancelled",
    securityBlocked: false,
    toolCalls: options.toolCalls || response.toolCalls,
    observations: options.observations || response.observations,
    preferencePatch: options.preferencePatch || response.memoryPreferencePatch,
    preferredName: options.preferredName,
    memoryCandidates: options.memoryCandidates,
    providerPayload: options.providerPayload || null,
    pendingAction: options.pendingAction,
    lastResolvedEntity: options.lastResolvedEntity,
    providerUsed: options.providerUsed,
    understandingSource: options.understandingSource,
    goalContract: options.goalContract,
    autoMemoryEnabled: options.autoMemoryEnabled !== false,
    allowPartialCommit: options.allowPartialCommit === true,
    verification: options.verification || response.verification || null,
    verified: options.verified === true
      || Boolean(response.verification && response.verification.ok === true),
    policy: options.policy || null,
  });
  const memory = commitResult.memory;
  response.memory = memory;
  if (commitResult.autoMemoryHints && commitResult.autoMemoryHints.length) {
    response.autoMemoryHint = commitResult.autoMemoryHints[0];
  }
  if (commitResult.workingMemory) {
    const tw = commitResult.workingMemory.teachingWeek;
    const wd = commitResult.workingMemory.weekday;
    const workingMemoryView = {
      className: commitResult.workingMemory.className || "",
      campus: commitResult.workingMemory.campus || "",
      teachingWeek: tw != null && Number(tw) >= 1 ? Number(tw) : null,
      weekday: wd != null && Number(wd) >= 1 ? Number(wd) : null,
      periodHint: commitResult.workingMemory.periodHint || "",
      preferredName: commitResult.workingMemory.preferredName || "",
      currentGoal: commitResult.workingMemory.currentGoal || "",
    };
    if (response.protocolVersion === agentProtocol.PROTOCOL_V2) {
      Object.assign(workingMemoryView, {
        activeGoal: commitResult.workingMemory.activeGoal || commitResult.workingMemory.currentGoal || "",
        pendingClarification: commitResult.workingMemory.pendingClarification || null,
        lastResolvedEntity: commitResult.workingMemory.lastResolvedEntity || null,
        constraints: commitResult.workingMemory.lastConstraints || {},
        pendingAction: commitResult.workingMemory.pendingAction || null,
      });
      if (!isPublicRuntime(response.runtimeMode)) {
        workingMemoryView.providerUsed = commitResult.workingMemory.providerUsed || "";
        workingMemoryView.understandingSource = commitResult.workingMemory.understandingSource || "";
      }
    }
    response.workingMemory = workingMemoryView;
  }
  if (response.safety && typeof response.safety === "object") {
    response.safety.memoryMode = memory.mode;
  }
  return response;
}

module.exports = {
  loadConversationMemory,
  handlePersonalMemoryTurn,
  attachMemory,
};
