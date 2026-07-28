// 小佛助手服务端编排入口（薄编排层）。
// 协调逻辑已拆分到 ./runtime/* 模块：请求上下文、理解、目标契约、Provider 编排、
// Planner 协调、工具投影、验证、响应组装、记忆、Action Receipt、事件发布。
// 本文件只保留对外 API（module.exports 签名不变）与 chat() 的阶段组合。
const safetyGuard = require("./safetyGuard");
const agentProtocol = require("./agentProtocol");
const runtimeModeService = require("./runtimeModeService");
const agentRunEventService = require("./agentRunEventService");
const mockProvider = require("./providers/mockProvider");
const responseComposer = require("./responseComposer");
const { defaultKernel: agentKernel } = require("./agentKernel");
const { defaultMemoryController } = require("./memory/memoryController");
const { evaluateProactive, factsFromContext } = require("./proactiveEngine");
const { isGeneralAssistantEnabled } = require("./planner/plannerPolicy");
const { nowIso, stableAction, stableCard, stableGeneratedPayload } = require("./runtime/shared");
const { emitChatEvent, recordEarlyTrace } = require("./runtime/runEventPublisher");
const requestContextAssembler = require("./runtime/requestContextAssembler");
const understandingCoordinator = require("./runtime/understandingCoordinator");
const { toRuntimeGoalContractV2, enrichIntentFromWorkingMemory } = require("./runtime/goalContractResolver");
const providerOrchestrator = require("./runtime/providerOrchestrator");
const plannerCoordinator = require("./runtime/plannerCoordinator");
const toolExecutor = require("./runtime/toolExecutor");
const skillRouter = require("./runtime/skillRouter");
const verificationCoordinator = require("./runtime/verificationCoordinator");
const memoryCoordinator = require("./runtime/memoryCoordinator");
const actionReceiptCoordinator = require("./runtime/actionReceiptCoordinator");
const responseComposerBridge = require("./runtime/responseComposerBridge");
const { isFactToolIntent, isProjectKnowledgeIntent, resolveRuleBackedIntent } = understandingCoordinator;
const { deriveProviderRunTruth, getProviderPolicy } = providerOrchestrator;
const { attachMemory } = memoryCoordinator;
const {
  deriveActionCommands,
  deriveLastResolvedEntity,
  derivePendingAction,
  attachReminderConfirmation,
} = actionReceiptCoordinator;
const {
  buildResponse,
  buildMetrics,
  buildContextSlots,
  sensitiveCredentialResponse,
  mergeGeneratedPayloads,
  deriveFinalResponseOutcome,
  applyFinalResponseOutcome,
  normalizeProactiveSuggestion,
  maybeAttachProactive,
} = responseComposerBridge;

/**
 * Public evaluate entry used by POST /api/ai/agent/proactive/evaluate
 */
function evaluateProactiveForRequest(input = {}) {
  const context = safetyGuard.sanitizeAgentContext(input.context || {});
  const event = String(input.event || context.proactiveEvent || "").slice(0, 64);
  const memoryBundle = defaultMemoryController.load({
    message: "",
    context,
    conversationId: input.conversationId,
    serverSession: input.serverSession,
    runtimeMode: input.runtimeMode,
    memoryMode: context.memoryMode || input.memoryMode,
    cloudSyncEnabled: context.cloudSyncEnabled === true,
  });
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
}

async function chat(input = {}) {
  const prepared = requestContextAssembler.prepareRequest(input);
  const startTime = prepared.startTime;
  const rawMessage = prepared.rawMessage;
  const safeMessage = prepared.safeMessage;
  let context = prepared.context;
  const runtimeDecision = prepared.runtimeDecision;
  const requestId = prepared.requestId;
  const conversationId = prepared.conversationId;
  const protocolVersion = prepared.protocolVersion;
  const runId = prepared.runId;
  const eventInput = prepared.eventInput;
  emitChatEvent(eventInput, {
    type: "request.sanitized",
    runtimeMode: runtimeDecision.runtimeMode,
    status: "sanitized",
  });
  if (input.runId && agentRunEventService.isCancelled(runId)) {
    emitChatEvent(eventInput, { type: "run.cancelled", runtimeMode: runtimeDecision.runtimeMode });
    return buildResponse({
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      answer: "",
      cards: [],
      suggestions: [],
      toolCalls: [],
      provider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      fallback: false,
      fallbackLayer: "none",
      success: true,
      status: "cancelled",
      intent: { name: "conversational_help", slots: {} },
      plan: [],
      steps: [],
      metrics: buildMetrics({ startTime, intentName: "cancelled", toolCalls: [] }),
    });
  }

  const loadedMemory = memoryCoordinator.loadConversationMemory({
    serverSession: input.serverSession,
    runtimeMode: runtimeDecision.runtimeMode,
    conversationId,
    message: safeMessage,
    context,
  });
  const memoryBundle = loadedMemory.memoryBundle;
  const conversationState = loadedMemory.conversationState;
  context = loadedMemory.context;

  const providerConfigResolution = providerOrchestrator.resolveRuntimeProviderConfig({
    context,
    runtimeMode: runtimeDecision.runtimeMode,
  });
  const providerRuntimeConfig = providerConfigResolution.providerRuntimeConfig;
  context.assistantEnvironment = providerConfigResolution.assistantEnvironment;
  if (!agentProtocol.isSupportedProtocolVersion(input.protocolVersion || context.protocolVersion || agentProtocol.PROTOCOL_VERSION)) {
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: "public",
      startTime,
      intent: "clarify_missing_slot",
      fallbackReason: "PROTOCOL_VERSION_UNSUPPORTED",
      errorCode: "PROTOCOL_VERSION_UNSUPPORTED",
    });
    return buildResponse({
      protocolVersion: agentProtocol.PROTOCOL_VERSION,
      runId,
      requestId,
      conversationId,
      runtimeMode: "public",
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: false,
      answer: "当前小佛协议版本不兼容，请刷新小程序后再试。",
      cards: [],
      suggestions: ["刷新后重试", "查看使用说明"],
      toolCalls: [],
      provider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      fallbackReason: "PROTOCOL_VERSION_UNSUPPORTED",
      fallback: true,
      fallbackLayer: "server",
      fallbackAllowed: true,
      success: false,
      errors: [{ code: "PROTOCOL_VERSION_UNSUPPORTED" }],
      intent: { name: "clarify_missing_slot", slots: {} },
      plan: [],
      memory: memoryBundle.memory,
      metrics: buildMetrics({ startTime, intentName: "protocol_version_unsupported", toolCalls: [] }),
    });
  }
  const usedPersonalContext = requestContextAssembler.deriveUsedPersonalContext(context);

  if (!rawMessage) {
    const generic = mockProvider.generate({ intent: { name: "generic" }, toolResults: [] });
    const stable = stableGeneratedPayload(generic);
    const response = buildResponse(Object.assign({}, stable, {
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      toolCalls: [],
      intent: { name: "conversational_help", slots: {} },
      plan: [],
      provider: "mock",
      usedPersonalContext,
      providerPolicy: getProviderPolicy(providerRuntimeConfig),
      externalProviderUsed: false,
      fallback: true,
      fallbackLayer: "server",
      fallbackReason: "空消息",
      memory: memoryBundle.memory,
      metrics: buildMetrics({
        startTime,
        intentName: "generic",
        toolCalls: [],
        externalProviderUsed: false,
        fallback: true,
        usedPersonalContext,
      }),
    }));
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      startTime,
      intent: "conversational_help",
      selectedSkill: skillRouter.earlyTraceSkillFor("EMPTY_MESSAGE"),
      fallbackReason: "EMPTY_MESSAGE",
      errorCode: "EMPTY_MESSAGE",
    });
    return response;
  }

  if (safetyGuard.hasSensitiveCredential(rawMessage)) {
    const response = sensitiveCredentialResponse(safeMessage, context, startTime, providerRuntimeConfig, {
      protocolVersion,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      runId,
      memory: memoryBundle.memory,
    });
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      startTime,
      intent: "explain_personal_import",
      selectedSkill: skillRouter.earlyTraceSkillFor("SENSITIVE_CREDENTIAL_BLOCKED"),
      fallbackReason: "SENSITIVE_CREDENTIAL_BLOCKED",
      errorCode: "SENSITIVE_CREDENTIAL_BLOCKED",
    });
    return response;
  }

  // The model-first boundary starts only after protocol, empty-input, cancellation,
  // and credential guards. public uses the same GoalContract boundary without any
  // external Provider call; trial/dev use the unified structured Provider chain.
  const understanding = await understandingCoordinator.runUnderstanding({
    message: safeMessage,
    context,
    conversationState,
    runtimeMode: runtimeDecision.runtimeMode,
    providerRuntimeConfig,
    principal: memoryBundle.principal,
    conversationId,
    eventInput,
  });

  // Unified internal goal representation; working memory stores this V2 shape
  // while protocol responses keep the V1 contract unchanged.
  const goalContractV2 = toRuntimeGoalContractV2(understanding);

  const personalMemoryResponse = memoryCoordinator.handlePersonalMemoryTurn({
    message: safeMessage,
    context,
    memoryBundle,
    runtimeMode: runtimeDecision.runtimeMode,
    runtimeDecision,
    protocolVersion,
    runId,
    requestId,
    conversationId,
    eventInput,
    startTime,
    understanding,
    goalContractV2,
  });
  if (personalMemoryResponse) return personalMemoryResponse;

  // GoalContract resolves to a Manifest intent before Planner/Router can select a
  // whitelisted capability. Local rules are consulted only after Understanding,
  // and only as grounded response context; they no longer choose the online goal.
  const intent = enrichIntentFromWorkingMemory(understanding.intent, context, conversationState);
  const localRuleMatch = resolveRuleBackedIntent(safeMessage, context).ruleMatch;

  const planned = await plannerCoordinator.executePlanner({
    message: safeMessage,
    context,
    runtimeMode: runtimeDecision.runtimeMode,
    runtimeDecision,
    intent,
    conversationState,
    providerRuntimeConfig,
    requestId,
    conversationId,
    runId,
    onEvent: input.onEvent,
    eventInput,
  });
  const execution = planned.execution;
  const plan = planned.plan;
  const toolCalls = planned.toolCalls;
  const plannerDiag = planned.plannerDiag;
  const publicToolCalls = toolExecutor.toPublicToolCalls(toolCalls);

  if (input.runId && agentRunEventService.isCancelled(runId)) {
    const cancelledProviderTruth = deriveProviderRunTruth({
      runtimeMode: runtimeDecision.runtimeMode,
      understanding,
      planner: plannerDiag,
      response: { provider: "mock", externalProviderUsed: false, providerChain: [], fallbackReason: "" },
    });
    emitChatEvent(eventInput, { type: "run.cancelled", runtimeMode: runtimeDecision.runtimeMode });
    return buildResponse({
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      answer: "",
      cards: [],
      suggestions: [],
      toolCalls: publicToolCalls,
      provider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: cancelledProviderTruth.externalProviderUsed,
      providerStages: cancelledProviderTruth.stages,
      understanding,
      goalContract: understanding.contract,
      success: true,
      status: "cancelled",
      intent,
      plan,
      steps: execution.steps,
      metrics: buildMetrics({
        startTime,
        intent,
        toolCalls,
        externalProviderUsed: cancelledProviderTruth.externalProviderUsed,
        fallback: cancelledProviderTruth.fallback,
      }),
    });
  }

  // M2-T2: consume the manifest per-tool verification policies over the
  // executed tool results (additive). Emits verification.started/completed
  // RunEvents and folds the verdict into execution.verification /
  // execution.partialCompletion, so deriveExecutionOutcome's existing
  // verification/partial outputs and the terminal run event reflect the real
  // policy checks. Never throws; tools without a declared policy keep their
  // existing kernel-verification behavior.
  const toolVerificationContract = verificationCoordinator.resolveVerificationGoalContract(execution)
    || goalContractV2
    || null;
  verificationCoordinator.verifyToolResults(execution, intent, toolVerificationContract, {
    eventInput,
    runtimeMode: runtimeDecision.runtimeMode,
  });

  if (runtimeDecision.runtimeMode === "public" &&
    !isFactToolIntent(intent) &&
    !isProjectKnowledgeIntent(intent) &&
    intent.name !== "explain_personal_import" &&
    intent.name !== "clarify_missing_slot") {
    emitChatEvent(eventInput, {
      type: "response.composing",
      runtimeMode: runtimeDecision.runtimeMode,
      intentName: intent.name,
      providerUsed: false,
    });
    const publicPlain = responseComposer.compose({
      answer: intent.name === "conversational_help"
        ? "你好，我是小佛。正式版里我可以帮你查课表、空教室、教学周和产品使用说明。"
        : "小佛目前只提供佛课小表、课表、课程查询和使用帮助。",
      cards: [],
      suggestions: [],
      intentName: intent.name,
      intent,
      runtimeMode: "public",
      toolCalls: publicToolCalls,
      steps: [],
      generalAssistant: false,
    });
    const response = attachMemory(buildResponse({
      protocolVersion,
      runId,
      answer: publicPlain.answer,
      cards: publicPlain.cards,
      suggestions: publicPlain.suggestions,
      presentationMode: publicPlain.presentationMode,
      presentation: publicPlain,
      runSummary: null,
      taskTrajectory: null,
      toolCalls: publicToolCalls,
      provider: "mock",
      desiredProvider: "mock",
      resolvedProvider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      fallbackReason: "AI_RUNTIME_MODE=public",
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      intent,
      plan,
      skill: skillRouter.executionSkill(execution),
      steps: execution.steps,
      observations: execution.observations,
      context,
      rawToolCalls: toolCalls,
      fallback: true,
      fallbackLayer: "server",
      metrics: buildMetrics({
        startTime,
        intentName: intent.name,
        toolCalls,
        externalProviderUsed: false,
        fallback: true,
        usedPersonalContext,
        plannerType: plan && plan.plannerType || "deterministic",
        plannerProvider: "none",
        responseProvider: "mock",
      }),
      errors: execution.verification && execution.verification.errors || [],
      verification: execution.verification || null,
    }), memoryBundle, {
      message: safeMessage,
      intentName: intent.name,
      context,
      runId,
      status: "completed",
      stepCount: (execution.steps || []).length,
      contextSlots: buildContextSlots(intent, intent.slots || {}),
      pendingClarification: null,
      clearPendingClarification: true,
      evidence: null,
      providerUsed: understanding.providerUsed || "",
      understandingSource: understanding.source,
      goalContract: goalContractV2 || undefined,
    });
    agentKernel.finalize(execution, {
      totalDurationMs: Date.now() - startTime,
      providerUsed: false,
      fallbackLayer: "server",
      fallbackReason: "AI_RUNTIME_MODE=public",
      evidenceComplete: response.evidence && response.evidence.complete === true,
    });
    return response;
  }

  const generatedResponse = await providerOrchestrator.generateAssistantResponse({
    intent,
    toolCalls,
    runtimeMode: runtimeDecision.runtimeMode,
    providerRuntimeConfig,
    principal: memoryBundle.principal,
    context,
    message: safeMessage,
    localRuleMatch,
    eventInput,
    publicToolCalls,
    understanding,
    plannerDiag,
    execution,
  });
  const providerPolicy = generatedResponse.providerPolicy;
  const desiredProviderName = generatedResponse.desiredProviderName;
  const providerName = generatedResponse.providerName;
  const providerDecisionReason = generatedResponse.providerDecisionReason;
  const deterministicPayload = generatedResponse.deterministicPayload;
  const providerPayload = generatedResponse.providerPayload;
  const responseExternalProviderUsed = generatedResponse.externalProviderUsed;
  const responseLatencyMs = generatedResponse.responseLatencyMs;
  const providerTruth = generatedResponse.providerTruth;
  const runOutcome = generatedResponse.runOutcome;

  const stable = mergeGeneratedPayloads({
    intent,
    providerPolicy,
    deterministicPayload,
    providerPayload,
    externalProviderUsed: responseExternalProviderUsed,
  });
  const pendingPatch = verificationCoordinator.resolvePendingClarificationPatch({ intent, context });
  const composed = responseComposer.compose({
    answer: stable.answer,
    cards: stable.cards,
    suggestions: stable.suggestions,
    intentName: intent.name,
    intent,
    runtimeMode: runtimeDecision.runtimeMode,
    toolCalls: publicToolCalls,
    steps: execution.steps,
    plan: execution.plan || plan,
    needsClarification: intent.name === "clarify_missing_slot" || (execution.plan && execution.plan.needsClarification),
    clarification: execution.plan && execution.plan.clarification,
    generalAssistant: isGeneralAssistantEnabled(runtimeDecision.runtimeMode),
    context,
    message: safeMessage,
    userMessage: safeMessage,
    durationMs: Date.now() - startTime,
    replanUsed: execution.replanUsed === true,
    success: runOutcome.success,
    status: runOutcome.status,
    errors: runOutcome.errors,
  });
  const actionCommands = deriveActionCommands(toolCalls);
  const lastResolvedEntity = deriveLastResolvedEntity(toolCalls);
  const pendingAction = derivePendingAction(actionCommands, { runId });
  const responsePlan = protocolVersion === agentProtocol.PROTOCOL_VERSION
    ? (execution.initialPlan && execution.initialPlan.length ? execution.initialPlan : plan)
    : (execution.plan || plan);
  const builtResponse = buildResponse(Object.assign({}, stable, {
    answer: composed.answer,
    cards: composed.cards,
    suggestions: composed.suggestions,
    presentationMode: composed.presentationMode,
    presentation: composed,
    evidenceDisplay: composed.evidence,
    runSummary: composed.runSummary,
    feedback: composed.feedback,
    protocolVersion,
    runId,
    requestId,
    conversationId,
    runtimeMode: runtimeDecision.runtimeMode,
    requestedRuntimeMode: runtimeDecision.requestedMode,
    competitionAuthorized: runtimeDecision.authorized,
    toolCalls: publicToolCalls,
    rawToolCalls: toolCalls,
    intent,
    plan: responsePlan,
    skill: skillRouter.executionSkill(execution),
    steps: execution.steps,
    observations: execution.observations,
    actions: actionCommands,
    context,
    provider: providerName,
    desiredProvider: desiredProviderName,
    resolvedProvider: providerName,
    usedPersonalContext,
    providerPolicy,
    externalProviderUsed: providerTruth.externalProviderUsed,
    providerStages: providerTruth.stages,
    providerDecisionReason,
    fallbackReason: providerTruth.fallbackReason,
    fallback: providerTruth.fallback,
    fallbackLayer: providerTruth.fallback ? "server" : "none",
    success: runOutcome.success,
    status: runOutcome.status,
    pendingClarification: pendingPatch.pendingClarification,
    clearPendingClarification: pendingPatch.clearPendingClarification,
    errors: runOutcome.errors,
    verification: execution.verification || null,
    reusedToolCount: execution.reusedToolCount || 0,
    avoidedDuplicateCalls: execution.avoidedDuplicateCalls || 0,
    replanReason: execution.replanReason || "",
    partialCompletion: execution.partialCompletion === true,
    goalContract: understanding.contract,
    verificationGoalContract: verificationCoordinator.resolveVerificationGoalContract(execution),
    understanding,
    metrics: buildMetrics({
      startTime,
      intent,
      toolCalls,
      externalProviderUsed: providerTruth.externalProviderUsed,
      fallback: providerTruth.fallback,
      usedPersonalContext,
      plannerProvider: plannerDiag.plannerProvider || (plan && plan.plannerProvider) || "none",
      responseProvider: providerName,
      plannerLatency: plannerDiag.plannerLatency || (plan && plan.plannerLatencyMs) || 0,
      responseLatency: responseLatencyMs,
      plannerFallback: providerTruth.stages.planner.fallback,
      responseFallback: providerTruth.stages.response.fallback,
      plannerType: plannerDiag.inferredPlannerType || (plan && plan.plannerType) || "",
    }),
    taskTrajectory: composed.taskTrajectory || null,
    contextMeta: generatedResponse.contextMeta || null,
  }));
  const finalOutcome = deriveFinalResponseOutcome(builtResponse, providerTruth);
  applyFinalResponseOutcome(builtResponse, finalOutcome);
  const response = attachMemory(builtResponse, memoryBundle, {
    message: safeMessage,
    intentName: intent.name,
    context,
    runId,
    status: finalOutcome.status,
    stepCount: (execution.steps || []).length,
    contextSlots: buildContextSlots(intent, intent.slots || {}),
    pendingClarification: pendingPatch.pendingClarification,
    clearPendingClarification: pendingPatch.clearPendingClarification,
    answer: composed.answer,
    evidence: null,
    cloudSyncEnabled: context.cloudSyncEnabled === true || (memoryBundle.memory && memoryBundle.memory.mode === "cloud_sync"),
    allowPartialCommit: finalOutcome.status === "partial",
    autoMemoryEnabled: context.autoMemoryEnabled !== false,
    providerUsed: understanding.providerUsed || "",
    understandingSource: understanding.source,
    goalContract: goalContractV2 || undefined,
    pendingAction,
    lastResolvedEntity,
  });
  maybeAttachProactive(response, { context, proactiveEvent: context.proactiveEvent }, memoryBundle, toolCalls);
  attachReminderConfirmation(response, execution, memoryBundle.principal);
  agentKernel.finalize(execution, {
    totalDurationMs: Date.now() - startTime,
    providerUsed: providerTruth.externalProviderUsed,
    fallbackLayer: providerTruth.fallback ? "server" : "none",
    fallbackReason: providerTruth.fallbackReason,
    evidenceComplete: response.evidence && response.evidence.complete === true,
    plannerType: plan && plan.plannerType,
    plannerProvider: plannerDiag.plannerProvider,
  });
  emitChatEvent(eventInput, {
    type: finalOutcome.eventType,
    runtimeMode: runtimeDecision.runtimeMode,
    intentName: intent.name,
    providerUsed: providerTruth.externalProviderUsed,
    reasonCode: providerTruth.fallbackReason ? String(providerTruth.fallbackReason).slice(0, 80) : "",
    status: finalOutcome.status,
    success: finalOutcome.success,
    fallback: providerTruth.fallback,
    partialCompletion: finalOutcome.partialCompletion,
    verificationOk: finalOutcome.verificationOk,
    errorCount: finalOutcome.errors.length,
    plannerType: plan && plan.plannerType || "",
  });
  return response;
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
    selectedSkill: skillRouter.earlyTraceSkillFor("SERVICE_FAILURE"),
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
    skill: skillRouter.serviceFailureSkill(),
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
  deriveProviderRunTruth,
  deriveValidatedResponseStatus: responseComposerBridge.deriveValidatedResponseStatus,
  normalizeProactiveSuggestion,
  deriveActionCommands,
  derivePendingAction,
  buildScheduleNavigateAction: actionReceiptCoordinator.buildScheduleNavigateAction,
  scheduleOpenLabel: actionReceiptCoordinator.scheduleOpenLabel,
};
