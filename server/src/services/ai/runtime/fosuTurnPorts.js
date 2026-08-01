const safetyGuard = require("../safetyGuard");
const agentProtocol = require("../agentProtocol");
const agentRunEventService = require("../agentRunEventService");
const mockProvider = require("../providers/mockProvider");
const responseComposer = require("../responseComposer");
const { isGeneralAssistantEnabled } = require("../planner/plannerPolicy");
const { stableGeneratedPayload } = require("./shared");
const { emitChatEvent, recordEarlyTrace } = require("./runEventPublisher");
const requestContextAssembler = require("./requestContextAssembler");
const understandingCoordinator = require("./understandingCoordinator");
const { enrichIntentFromWorkingMemory } = require("./goalContractResolver");
const providerOrchestrator = require("./providerOrchestrator");
const plannerCoordinator = require("./plannerCoordinator");
const toolExecutor = require("./toolExecutor");
const skillRouter = require("./skillRouter");
const verificationCoordinator = require("./verificationCoordinator");
const memoryCoordinator = require("./memoryCoordinator");
const actionReceiptCoordinator = require("./actionReceiptCoordinator");
const { registerReminderReceiptWaitBestEffort } = require("../durable/waitForEvent");
const responseComposerBridge = require("./responseComposerBridge");

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
  maybeAttachProactive,
} = responseComposerBridge;

function cloneMutable(value, seen = new WeakMap()) {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  Object.entries(value).forEach(([key, item]) => {
    output[key] = cloneMutable(item, seen);
  });
  return output;
}

function countMemories(memoryBundle) {
  const state = memoryBundle && memoryBundle.conversationState || {};
  return (Array.isArray(state.userMemories) ? state.userMemories.length : 0)
    + (Array.isArray(state.episodicMemories) ? state.episodicMemories.length : 0);
}

function requirePrivateState(stageInput = {}) {
  const state = stageInput.privateState;
  if (!state || typeof state !== "object") {
    const error = new Error("The Fosu plugin private Turn state is unavailable");
    error.code = "FOSU_PRIVATE_TURN_STATE_REQUIRED";
    throw error;
  }
  return state;
}

function contextFromView(view = {}) {
  const currentTurn = view.currentTurn && typeof view.currentTurn === "object" ? view.currentTurn : {};
  const working = view.workingState && typeof view.workingState === "object" ? view.workingState : {};
  const pending = view.pending && typeof view.pending === "object" ? view.pending : {};
  return Object.assign({}, cloneMutable(working), {
    contextId: String(view.contextId || ""),
    runtimeMode: String(currentTurn.runtimeMode || "public"),
    currentPage: working.currentPage || "",
    todayDate: working.todayDate || "",
    currentTeachingWeek: working.currentTeachingWeek || working.teachingWeek || null,
    term: working.term || "",
    releaseVersion: working.releaseVersion || "",
    recentMessages: cloneMutable(view.recentMessages || []),
    conversationSummary: String(view.rollingSummary || ""),
    workingMemory: Object.assign({}, cloneMutable(working), {
      currentGoal: working.activeGoal || "",
      pendingClarification: pending.clarification || null,
      pendingAction: pending.action || null,
    }),
    userMemories: cloneMutable(view.memories || []),
    episodicMemories: cloneMutable(view.episodes || []),
    ragCitations: cloneMutable(view.rag || []),
    pendingClarification: cloneMutable(pending.clarification || null),
    pendingAction: cloneMutable(pending.action || null),
    personalScheduleAvailable: working.personalScheduleAvailable === true,
  });
}

function conversationStateFromView(view = {}) {
  const context = contextFromView(view);
  return {
    conversationSummary: context.conversationSummary,
    summary: context.conversationSummary,
    recentMessages: context.recentMessages,
    workingMemory: context.workingMemory,
    userMemories: context.userMemories,
    episodicMemories: context.episodicMemories,
    pendingClarification: context.pendingClarification,
    contextSlots: Object.assign({}, context.workingMemory),
  };
}

function authoritativeToolContext(state, view) {
  const source = state.context && typeof state.context === "object" ? state.context : {};
  const safeView = contextFromView(view);
  // This object is passed only to the concrete Tool executor. It is not used by
  // Decision/Planner/Response and never crosses the generic Runtime artifact or
  // Trace boundary. The personal schedule remains an authoritative Tool input.
  return Object.assign({}, safeView, {
    currentScheduleSummary: cloneMutable(source.currentScheduleSummary || {}),
    scheduleChangeBaseline: cloneMutable(
      source.scheduleChangeBaseline || source.previousScheduleSummary || {}
    ),
    serverSession: source.serverSession || null,
    userPreferences: cloneMutable(source.userPreferences || {}),
    clientLocalTime: source.clientLocalTime || source.clientTime || "",
    clientTime: source.clientTime || "",
    todayTeachingInfo: cloneMutable(source.todayTeachingInfo || null),
    termStartDate: source.termStartDate || "",
    termPhase: source.termPhase || "",
    principal: state.memoryBundle && state.memoryBundle.principal || null,
    // P4b：Tool 发布 overlay（禁用/模式收窄）经工具上下文传入内核五因子
    // 交集的 runtimeToolIds 因子；不经过 Decision/Planner/Response。
    toolOverlay: state.toolOverlay || null,
  });
}

function deriveReminderPendingAction(toolCalls, principal, metadata = {}) {
  if (!principal || principal.authenticated !== true) return undefined;
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const createCall = calls.find((item) => item && item.name === "create_course_reminder");
  const deleteCall = calls.find((item) => item && item.name === "delete_course_reminder");
  let command = "";
  let operation = "";
  let payload = null;
  let reminderId = "";
  if (createCall && createCall.result && createCall.result.success === true
    && createCall.result.requiresConfirmation === true) {
    command = "createCourseReminder";
    operation = "create";
    payload = createCall.result;
  } else if (deleteCall && deleteCall.result && deleteCall.result.requiresConfirmation === true
    && Array.isArray(deleteCall.result.matches) && deleteCall.result.matches.length === 1) {
    command = "deleteReminder";
    operation = "delete";
    payload = {};
    reminderId = String(deleteCall.result.matches[0].id || "");
  }
  if (!command || (operation === "delete" && !reminderId)) return undefined;
  const detailId = operation === "create"
    ? actionReceiptCoordinator.reminderIdempotencyKey(principal, operation, payload, "")
    : reminderId;
  if (!detailId) return undefined;
  const createdAt = Date.now();
  return {
    command,
    status: "awaiting_receipt",
    runId: String(metadata.runId || "").slice(0, 100),
    createdAt,
    expiresAt: createdAt + Math.max(60000, Math.min(3600000, Number(metadata.ttlMs || 15 * 60 * 1000) || 15 * 60 * 1000)),
    target: {
      type: "reminder",
      detailId: String(detailId).slice(0, 128),
      name: "课程提醒",
      term: "",
    },
  };
}

// P4b：Provider overlay 合并后的硬护栏（最后应用）。public 环境永远
// mock/tool-only；任何发布物都无法让 public 离开确定性路径。纯函数导出
// 供发布适配器专项测试直接锁定该不变量。
function applyProviderHardGuards(runtimeConfig, assistantEnvironment) {
  if (String(assistantEnvironment || "") !== "public") return runtimeConfig;
  return Object.assign({}, runtimeConfig, {
    AI_AGENT_ENABLED: "false",
    AI_PROVIDER: "mock",
    AI_PROVIDER_POLICY: "tool-only",
    AI_RUNTIME_MODE: "public",
  });
}

function cancelledResponse(state, extra = {}) {
  const providerTruth = extra.providerTruth || { externalProviderUsed: false, stages: {} };
  return buildResponse({
    protocolVersion: state.protocolVersion,
    runId: state.runId,
    requestId: state.requestId,
    conversationId: state.conversationId,
    runtimeMode: state.runtimeDecision.runtimeMode,
    requestedRuntimeMode: state.runtimeDecision.requestedMode,
    competitionAuthorized: state.runtimeDecision.authorized,
    answer: "",
    cards: [],
    suggestions: [],
    toolCalls: extra.publicToolCalls || [],
    provider: "mock",
    providerPolicy: "tool-only",
    externalProviderUsed: providerTruth.externalProviderUsed === true,
    providerStages: providerTruth.stages || {},
    fallback: false,
    fallbackLayer: "none",
    success: true,
    status: "cancelled",
    intent: extra.intent || { name: "conversational_help", slots: {} },
    plan: extra.plan || [],
    steps: extra.execution && extra.execution.steps || [],
    understanding: extra.understanding,
    goalContract: extra.understanding && extra.understanding.contract,
    metrics: buildMetrics({
      startTime: state.startTime,
      intent: extra.intent,
      intentName: extra.intent ? undefined : "cancelled",
      toolCalls: extra.toolCalls || [],
      externalProviderUsed: providerTruth.externalProviderUsed === true,
      fallback: providerTruth.fallback === true,
    }),
  });
}

function createFosuTurnPorts(options = {}) {
  const agentKernel = options.agentKernel;
  const skillCatalog = options.skillCatalog;
  const decisionService = options.decisionService;
  const contextAssembler = options.contextAssembler;
  if (!agentKernel || typeof agentKernel.execute !== "function") throw new Error("agentKernel is required");
  if (!skillCatalog || typeof skillCatalog.getSkillForIntent !== "function") throw new Error("skillCatalog is required");
  if (!decisionService || typeof decisionService.decide !== "function") throw new Error("decisionService is required");
  if (!contextAssembler || typeof contextAssembler.assemble !== "function") throw new Error("contextAssembler is required");
  // P4a：按 Run 绑定的快照解析已发布技能目录（发布/回滚只影响新 Run）；
  // 默认回落静态目录（未接入内核的测试/旧组合保持原行为）。
  const resolveSkillCatalog = typeof options.resolveSkillCatalog === "function"
    ? options.resolveSkillCatalog
    : () => skillCatalog;
  // P4b：按快照解析 Provider/Tool/Memory 发布物；默认空 overlay（未接入
  // 内核的组合 ≡ P4b 前行为）。public 硬护栏在 overlay 合并后最后重应用。
  const resolveProviderOverlay = typeof options.resolveProviderOverlay === "function"
    ? options.resolveProviderOverlay
    : () => ({});
  const resolveToolOverlay = typeof options.resolveToolOverlay === "function"
    ? options.resolveToolOverlay
    : () => ({ disabled: [], modeOverrides: {} });
  const resolveMemoryPolicy = typeof options.resolveMemoryPolicy === "function"
    ? options.resolveMemoryPolicy
    : () => ({});
  const overlayToRuntimeConfig = typeof options.overlayToRuntimeConfig === "function"
    ? options.overlayToRuntimeConfig
    : () => ({});

  async function context(stageInput = {}) {
    const request = stageInput.request || {};
    const prepared = requestContextAssembler.prepareRequest(request);
    const state = {
      startTime: prepared.startTime,
      rawMessage: prepared.rawMessage,
      safeMessage: prepared.safeMessage,
      context: prepared.context,
      runtimeDecision: prepared.runtimeDecision,
      requestId: prepared.requestId,
      conversationId: prepared.conversationId,
      protocolVersion: prepared.protocolVersion,
      runId: prepared.runId,
      eventInput: Object.assign({}, prepared.eventInput, {
        onEvent: (event) => stageInput.emit(event),
      }),
      releaseContext: stageInput.releaseContext || {},
    };
    if (state.releaseContext && state.releaseContext.active) {
      state.context.term = state.releaseContext.term || state.context.term || "";
      state.context.releaseVersion = state.releaseContext.releaseVersion || state.context.releaseVersion || "";
    }
    emitChatEvent(state.eventInput, {
      type: "request.sanitized",
      runtimeMode: state.runtimeDecision.runtimeMode,
      status: "sanitized",
    });

    if (request.runId && agentRunEventService.isCancelled(state.runId)) {
      emitChatEvent(state.eventInput, { type: "run.cancelled", runtimeMode: state.runtimeDecision.runtimeMode });
      state.earlyResponse = cancelledResponse(state);
      state.guardReason = "RUN_CANCELLED";
      const snapshot = await contextAssembler.assemble({
        currentMessage: state.safeMessage,
        runtimeMode: state.runtimeDecision.runtimeMode,
        runtimeContext: state.context,
        configVersion: stageInput.configSnapshot && stageInput.configSnapshot.configVersion,
        manifestSummary: {
          version: stageInput.plugin && stageInput.plugin.manifestVersion || "",
          skillIds: stageInput.plugin && stageInput.plugin.skills && stageInput.plugin.skills.map((skill) => skill.id) || [],
        },
      });
      return { snapshot: Object.assign({}, snapshot, { messageCount: 0, memoryCount: 0 }), privateState: state };
    }

    const providerConfigResolution = providerOrchestrator.resolveRuntimeProviderConfig({
      context: state.context,
      runtimeMode: state.runtimeDecision.runtimeMode,
    });
    state.providerRuntimeConfig = providerConfigResolution.providerRuntimeConfig;
    // P4b：发布内核 Provider overlay 合并到运行时配置。声明式 overlay 只能
    // 调整链/阶段模型/预算等白名单字段（密钥永远不可经发布物注入）；硬护栏
    // 在最后重应用，任何 overlay 都无法让 public 离开 mock/tool-only。
    const providerOverlayConfig = overlayToRuntimeConfig(
      await resolveProviderOverlay(stageInput.configSnapshot || null)
    );
    if (Object.keys(providerOverlayConfig).length) {
      state.providerRuntimeConfig = Object.assign({}, state.providerRuntimeConfig, providerOverlayConfig);
    }
    state.providerRuntimeConfig = applyProviderHardGuards(
      state.providerRuntimeConfig,
      providerConfigResolution.assistantEnvironment
    );
    // P4b：Memory 策略经快照绑定注入当次 Turn（发布/回滚不影响在途 Run）。
    state.memoryPolicy = await resolveMemoryPolicy(stageInput.configSnapshot || null);
    state.toolOverlay = await resolveToolOverlay(stageInput.configSnapshot || null);
    state.executionPolicy = decisionService.resolvePolicy({
      runtimeMode: state.runtimeDecision.runtimeMode,
      providerRuntimeConfig: state.providerRuntimeConfig,
    });

    const loadedMemory = await memoryCoordinator.loadConversationMemory({
      serverSession: request.serverSession,
      runtimeMode: state.runtimeDecision.runtimeMode,
      conversationId: state.conversationId,
      message: state.safeMessage,
      context: state.context,
      releaseContext: state.releaseContext,
      executionPolicy: state.executionPolicy,
      policy: state.memoryPolicy,
    });
    state.memoryBundle = loadedMemory.memoryBundle;
    state.conversationState = loadedMemory.conversationState;
    state.context = loadedMemory.context;

    state.context.assistantEnvironment = providerConfigResolution.assistantEnvironment;
    state.usedPersonalContext = requestContextAssembler.deriveUsedPersonalContext(state.context);

    if (!agentProtocol.isSupportedProtocolVersion(request.protocolVersion || state.context.protocolVersion || agentProtocol.PROTOCOL_VERSION)) {
      recordEarlyTrace({
        runId: state.runId,
        requestId: state.requestId,
        conversationId: state.conversationId,
        runtimeMode: "public",
        startTime: state.startTime,
        intent: "clarify_missing_slot",
        fallbackReason: "PROTOCOL_VERSION_UNSUPPORTED",
        errorCode: "PROTOCOL_VERSION_UNSUPPORTED",
      });
      state.earlyResponse = buildResponse({
        protocolVersion: agentProtocol.PROTOCOL_VERSION,
        runId: state.runId,
        requestId: state.requestId,
        conversationId: state.conversationId,
        runtimeMode: "public",
        requestedRuntimeMode: state.runtimeDecision.requestedMode,
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
        memory: state.memoryBundle.memory,
        metrics: buildMetrics({ startTime: state.startTime, intentName: "protocol_version_unsupported", toolCalls: [] }),
      });
      state.guardReason = "PROTOCOL_VERSION_UNSUPPORTED";
    } else if (!state.rawMessage) {
      const stable = stableGeneratedPayload(mockProvider.generate({ intent: { name: "generic" }, toolResults: [] }));
      state.earlyResponse = buildResponse(Object.assign({}, stable, {
        protocolVersion: state.protocolVersion,
        runId: state.runId,
        requestId: state.requestId,
        conversationId: state.conversationId,
        runtimeMode: state.runtimeDecision.runtimeMode,
        requestedRuntimeMode: state.runtimeDecision.requestedMode,
        competitionAuthorized: state.runtimeDecision.authorized,
        toolCalls: [],
        intent: { name: "conversational_help", slots: {} },
        plan: [],
        provider: "mock",
        usedPersonalContext: state.usedPersonalContext,
        providerPolicy: getProviderPolicy(state.providerRuntimeConfig),
        externalProviderUsed: false,
        fallback: true,
        fallbackLayer: "server",
        fallbackReason: "EMPTY_MESSAGE",
        memory: state.memoryBundle.memory,
        metrics: buildMetrics({
          startTime: state.startTime,
          intentName: "generic",
          toolCalls: [],
          externalProviderUsed: false,
          fallback: true,
          usedPersonalContext: state.usedPersonalContext,
        }),
      }));
      recordEarlyTrace({
        runId: state.runId,
        requestId: state.requestId,
        conversationId: state.conversationId,
        runtimeMode: state.runtimeDecision.runtimeMode,
        startTime: state.startTime,
        intent: "conversational_help",
        selectedSkill: skillRouter.earlyTraceSkillFor("EMPTY_MESSAGE"),
        fallbackReason: "EMPTY_MESSAGE",
        errorCode: "EMPTY_MESSAGE",
      });
      state.guardReason = "EMPTY_MESSAGE";
    } else if (safetyGuard.hasSensitiveCredential(state.rawMessage)) {
      state.earlyResponse = sensitiveCredentialResponse(
        state.safeMessage,
        state.context,
        state.startTime,
        state.providerRuntimeConfig,
        {
          protocolVersion: state.protocolVersion,
          requestId: state.requestId,
          conversationId: state.conversationId,
          runtimeMode: state.runtimeDecision.runtimeMode,
          requestedRuntimeMode: state.runtimeDecision.requestedMode,
          runId: state.runId,
          memory: state.memoryBundle.memory,
        },
      );
      recordEarlyTrace({
        runId: state.runId,
        requestId: state.requestId,
        conversationId: state.conversationId,
        runtimeMode: state.runtimeDecision.runtimeMode,
        startTime: state.startTime,
        intent: "explain_personal_import",
        selectedSkill: skillRouter.earlyTraceSkillFor("SENSITIVE_CREDENTIAL_BLOCKED"),
        fallbackReason: "SENSITIVE_CREDENTIAL_BLOCKED",
        errorCode: "SENSITIVE_CREDENTIAL_BLOCKED",
      });
      state.guardReason = "SENSITIVE_CREDENTIAL_BLOCKED";
    }

    const conversationState = state.conversationState || {};
    const workingMemory = conversationState.workingMemory || state.context.workingMemory || {};
    const snapshot = await contextAssembler.assemble({
      currentMessage: state.safeMessage,
      runtimeMode: state.runtimeDecision.runtimeMode,
      recentMessages: conversationState.recentMessages || state.context.recentMessages || [],
      rollingSummary: conversationState.conversationSummary || state.context.conversationSummary || "",
      workingState: workingMemory,
      pendingClarification: conversationState.pendingClarification || state.context.pendingClarification || null,
      pendingAction: workingMemory.pendingAction || state.context.pendingAction || null,
      memoryItems: conversationState.userMemories || [],
      episodicMemories: conversationState.episodicMemories || [],
      ragCitations: state.context.ragCitations || state.context.rag || [],
      runtimeContext: Object.assign({}, state.context, {
        personalScheduleAvailable: state.usedPersonalContext === true,
      }),
      configVersion: stageInput.configSnapshot && stageInput.configSnapshot.configVersion,
      manifestSummary: {
        version: stageInput.plugin && stageInput.plugin.manifestVersion || "",
        skillIds: stageInput.plugin && stageInput.plugin.skills && stageInput.plugin.skills.map((skill) => skill.id) || [],
      },
    });
    state.assembledPending = cloneMutable(snapshot.pending || {});
    return {
      snapshot: Object.assign({}, snapshot, {
        messageCount: snapshot.recentMessages.length + (state.safeMessage ? 1 : 0),
        memoryCount: countMemories(state.memoryBundle),
        episodeCount: snapshot.episodes.length,
        ragCount: snapshot.rag.length,
        selectionFingerprint: snapshot.selectionFingerprint,
      }),
      privateState: state,
    };
  }

  async function decision(stageInput = {}) {
    const state = requirePrivateState(stageInput);
    const contextView = stageInput.contextView || {};
    const executionPolicy = state.executionPolicy || decisionService.resolvePolicy({
      runtimeMode: state.runtimeDecision && state.runtimeDecision.runtimeMode,
      providerRuntimeConfig: state.providerRuntimeConfig || {},
    });
    if (state.earlyResponse) {
      return {
        skipped: true,
        earlyResponse: state.earlyResponse,
        executionPolicy,
        intendedProvider: "",
        actualFirstProvider: "",
        fallbackPath: [],
        decisionSource: "guard_rejected",
        goal: { name: state.guardReason || "guard_rejected" },
        selectedSkillId: "",
        contextId: String(contextView.contextId || ""),
      };
    }
    const mutableContext = contextFromView(contextView);
    const mutableConversationState = conversationStateFromView(contextView);
    const resolvedDecision = await decisionService.decide({
      message: state.safeMessage,
      context: mutableContext,
      conversationState: mutableConversationState,
      contextView,
      runtimeMode: state.runtimeDecision.runtimeMode,
      executionPolicy,
      providerRuntimeConfig: state.providerRuntimeConfig,
      principal: state.memoryBundle.principal,
      conversationId: state.conversationId,
      signal: stageInput.signal || null,
      deadline: stageInput.deadline,
      decisionBudgetMs: stageInput.budget && stageInput.budget.timeoutMs,
      providerAttemptLedger: stageInput.providerAttemptLedger,
      skillCatalog: await resolveSkillCatalog(stageInput.configSnapshot || null),
      deterministicResolve: (message, safeContext) => understandingCoordinator.resolveRuleBackedIntent(message, safeContext).intent,
      onEvent: (event) => emitChatEvent(state.eventInput, Object.assign({
        runtimeMode: state.runtimeDecision.runtimeMode,
      }, event)),
    });
    const understanding = resolvedDecision.understanding;
    const goalContractV2 = resolvedDecision.goalContractV2;
    const intent = Object.assign({}, enrichIntentFromWorkingMemory(
      resolvedDecision.intent,
      mutableContext,
      mutableConversationState,
    ));
    if (understanding && understanding.source && !intent.understandingSource) {
      intent.understandingSource = String(understanding.source).slice(0, 40);
    }
    const personalMemoryEarly = await memoryCoordinator.handlePersonalMemoryTurn({
      message: state.safeMessage,
      context: mutableContext,
      memoryBundle: state.memoryBundle,
      runtimeMode: state.runtimeDecision.runtimeMode,
      runtimeDecision: state.runtimeDecision,
      protocolVersion: state.protocolVersion,
      runId: state.runId,
      requestId: state.requestId,
      conversationId: state.conversationId,
      eventInput: state.eventInput,
      startTime: state.startTime,
      understanding,
      goalContractV2,
      policy: state.memoryPolicy || null,
    });
    if (personalMemoryEarly) {
      return Object.assign({}, resolvedDecision, {
        skipped: true,
        earlyResponse: personalMemoryEarly,
        intent,
        contextId: String(contextView.contextId || ""),
      });
    }
    return Object.assign({}, resolvedDecision, {
      skipped: false,
      understanding,
      goalContractV2,
      intent,
      localRuleMatch: resolveRuleBackedIntent(state.safeMessage, mutableContext).ruleMatch,
      contextId: String(contextView.contextId || ""),
    });
  }

  async function skillTool(stageInput = {}) {
    const state = requirePrivateState(stageInput);
    const contextView = stageInput.contextView || {};
    const decisionResult = stageInput.decision || {};
    if (decisionResult.earlyResponse) {
      return {
        skipped: true,
        earlyResponse: decisionResult.earlyResponse,
        toolCalls: [],
        steps: [],
        contextId: String(contextView.contextId || ""),
      };
    }
    const mutableContext = contextFromView(contextView);
    const planned = await plannerCoordinator.executePlanner({
      message: state.safeMessage,
      context: mutableContext,
      runtimeMode: state.runtimeDecision.runtimeMode,
      runtimeDecision: state.runtimeDecision,
      intent: cloneMutable(decisionResult.intent),
      conversationState: conversationStateFromView(contextView),
      toolContext: authoritativeToolContext(state, contextView),
      providerRuntimeConfig: state.providerRuntimeConfig,
      requestId: state.requestId,
      conversationId: state.conversationId,
      runId: state.runId,
      environment: stageInput.configSnapshot && stageInput.configSnapshot.environment || state.runtimeDecision.runtimeMode,
      configVersion: stageInput.configSnapshot && stageInput.configSnapshot.configVersion || "",
      protocolVersion: state.protocolVersion,
      onEvent: state.eventInput.onEvent,
      eventInput: state.eventInput,
      agentKernel,
      unifiedDecision: Boolean(decisionResult.decisionContract),
      decisionContract: decisionResult.decisionContract || null,
      decisionSource: String(decisionResult.decisionSource || ""),
      signal: stageInput.signal,
      deadline: stageInput.deadline,
      budget: stageInput.budget,
      providerAttemptLedger: stageInput.providerAttemptLedger,
      principal: state.memoryBundle.principal,
    });
    const publicToolCalls = toolExecutor.toPublicToolCalls(planned.toolCalls);
    if (agentRunEventService.isCancelled(state.runId)) {
      const cancelledProviderTruth = deriveProviderRunTruth({
        runtimeMode: state.runtimeDecision.runtimeMode,
        understanding: decisionResult.understanding,
        planner: planned.plannerDiag,
        response: { provider: "mock", externalProviderUsed: false, providerChain: [], fallbackReason: "" },
      });
      emitChatEvent(state.eventInput, { type: "run.cancelled", runtimeMode: state.runtimeDecision.runtimeMode });
      return {
        skipped: true,
        earlyResponse: cancelledResponse(state, {
          providerTruth: cancelledProviderTruth,
          publicToolCalls,
          understanding: decisionResult.understanding,
          intent: decisionResult.intent,
          plan: planned.plan,
          execution: planned.execution,
          toolCalls: planned.toolCalls,
        }),
        toolCalls: planned.toolCalls,
        publicToolCalls,
        plan: planned.plan,
        execution: planned.execution,
        plannerDiag: planned.plannerDiag,
        contextId: String(contextView.contextId || ""),
      };
    }
    return {
      skipped: false,
      execution: planned.execution,
      plan: planned.plan,
      toolCalls: planned.toolCalls,
      publicToolCalls,
      plannerDiag: planned.plannerDiag,
      contextId: String(contextView.contextId || ""),
    };
  }

  async function verification(stageInput = {}) {
    const state = requirePrivateState(stageInput);
    const contextView = stageInput.contextView || {};
    const decisionResult = stageInput.decision || {};
    const skillResult = stageInput.skillTool || {};
    if (skillResult.earlyResponse) {
      return {
        ok: skillResult.earlyResponse.success !== false,
        skipped: true,
        earlyResponse: skillResult.earlyResponse,
        contextId: String(contextView.contextId || ""),
      };
    }
    const sourceExecution = skillResult.execution || {};
    const execution = Object.assign({}, sourceExecution, {
      verification: Object.assign({}, sourceExecution.verification || { ok: true }, {
        errors: Array.isArray(sourceExecution.verification && sourceExecution.verification.errors)
          ? sourceExecution.verification.errors.slice()
          : [],
      }),
    });
    const toolVerificationContract = verificationCoordinator.resolveVerificationGoalContract(execution)
      || decisionResult.goalContractV2
      || null;
    const summary = verificationCoordinator.verifyToolResults(
      execution,
      decisionResult.intent,
      toolVerificationContract,
      { eventInput: state.eventInput, runtimeMode: state.runtimeDecision.runtimeMode },
    );
    return {
      ok: execution.verification && execution.verification.ok !== false,
      errors: execution.verification && execution.verification.errors || [],
      execution,
      toolResultVerification: summary,
      contextId: String(contextView.contextId || ""),
    };
  }

  async function response(stageInput = {}) {
    const state = requirePrivateState(stageInput);
    const contextView = stageInput.contextView || {};
    const responseContext = contextFromView(contextView);
    const decisionResult = stageInput.decision || {};
    const skillResult = stageInput.skillTool || {};
    const verificationResult = stageInput.verification || {};
    if (verificationResult.earlyResponse) {
      return Object.assign({}, verificationResult.earlyResponse, {
        contextId: String(contextView.contextId || ""),
      });
    }

    const execution = verificationResult.execution || skillResult.execution;
    const plan = skillResult.plan;
    const toolCalls = skillResult.toolCalls || [];
    // Runtime stage outputs are immutable handoffs; response orchestration appends
    // provider diagnostics to its own copy instead of mutating the prior stage.
    const publicToolCalls = (skillResult.publicToolCalls || []).map((call) => Object.assign({}, call));
    const plannerDiag = skillResult.plannerDiag || {};
    const intent = decisionResult.intent;
    const understanding = decisionResult.understanding;

    if (state.runtimeDecision.runtimeMode === "public"
      && !isFactToolIntent(intent)
      && !isProjectKnowledgeIntent(intent)
      && intent.name !== "explain_personal_import"
      && intent.name !== "clarify_missing_slot") {
      emitChatEvent(state.eventInput, {
        type: "response.composing",
        runtimeMode: state.runtimeDecision.runtimeMode,
        intentName: intent.name,
        providerUsed: false,
      });
      const publicPlain = responseComposer.compose({
        answer: intent.name === "conversational_help"
          ? "你好，我是小佛。正式版里我可以帮你查课表、空教室、教学周和产品使用说明。"
          : "小佛目前提供课表、课程查询和使用帮助。",
        cards: [],
        suggestions: [],
        intentName: intent.name,
        intent,
        runtimeMode: "public",
        toolCalls: publicToolCalls,
        steps: [],
        generalAssistant: false,
      });
      const publicResponse = await attachMemory(buildResponse({
        protocolVersion: state.protocolVersion,
        runId: state.runId,
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
        fallbackReason: "",
        requestId: state.requestId,
        conversationId: state.conversationId,
        runtimeMode: state.runtimeDecision.runtimeMode,
        requestedRuntimeMode: state.runtimeDecision.requestedMode,
        competitionAuthorized: state.runtimeDecision.authorized,
        intent,
        plan,
        skill: skillRouter.executionSkill(execution),
        steps: execution.steps,
        observations: execution.observations,
        context: responseContext,
        rawToolCalls: toolCalls,
        fallback: false,
        fallbackLayer: "none",
        metrics: buildMetrics({
          startTime: state.startTime,
          intentName: intent.name,
          toolCalls,
          externalProviderUsed: false,
          fallback: false,
          usedPersonalContext: state.usedPersonalContext,
          plannerType: plan && plan.plannerType || "deterministic",
          plannerProvider: "none",
          responseProvider: "mock",
        }),
        errors: execution.verification && execution.verification.errors || [],
        verification: execution.verification || null,
      }), state.memoryBundle, {
        message: state.safeMessage,
        intentName: intent.name,
        context: responseContext,
        runId: state.runId,
        status: "completed",
        stepCount: (execution.steps || []).length,
        policy: state.memoryPolicy || null,
        contextSlots: buildContextSlots(intent, intent.slots || {}),
        pendingClarification: null,
        clearPendingClarification: true,
        evidence: null,
        providerUsed: understanding.providerUsed || "",
        understandingSource: understanding.source,
        goalContract: decisionResult.goalContractV2 || undefined,
      });
      agentKernel.finalize(execution, {
        totalDurationMs: Date.now() - state.startTime,
        providerUsed: false,
        provider: "mock",
        fallbackLayer: "server",
        fallbackReason: "AI_RUNTIME_MODE=public",
        evidenceComplete: publicResponse.evidence && publicResponse.evidence.complete === true,
        status: "completed",
      });
      return Object.assign(publicResponse, { contextId: String(contextView.contextId || "") });
    }

    const generatedResponse = await providerOrchestrator.generateAssistantResponse({
      intent,
      toolCalls,
      runtimeMode: state.runtimeDecision.runtimeMode,
      providerRuntimeConfig: state.providerRuntimeConfig,
      principal: state.memoryBundle.principal,
      context: responseContext,
      message: state.safeMessage,
      localRuleMatch: decisionResult.localRuleMatch,
      eventInput: state.eventInput,
      publicToolCalls,
      understanding,
      plannerDiag,
      execution,
      executionPolicy: decisionResult.executionPolicy,
      signal: stageInput.signal || null,
      deadline: stageInput.deadline,
      responseBudgetMs: stageInput.budget && stageInput.budget.timeoutMs,
      providerAttemptLedger: stageInput.providerAttemptLedger,
      contextId: String(contextView.contextId || ""),
      contextTrace: stageInput.context && stageInput.context.trace || null,
      assistantEnvironment: state.context.assistantEnvironment || state.runtimeDecision.runtimeMode,
    });
    const stable = mergeGeneratedPayloads({
      intent,
      providerPolicy: generatedResponse.providerPolicy,
      deterministicPayload: generatedResponse.deterministicPayload,
      providerPayload: generatedResponse.providerPayload,
      externalProviderUsed: generatedResponse.externalProviderUsed,
    });
    const pendingPatch = verificationCoordinator.resolvePendingClarificationPatch({
      intent,
      context: Object.assign({}, responseContext, {
        pendingClarification: state.assembledPending && state.assembledPending.clarification || null,
        pendingClarificationExpired: Boolean(
          state.assembledPending && state.assembledPending.clarificationExpired
        ),
      }),
    });
    const composed = responseComposer.compose({
      answer: stable.answer,
      cards: stable.cards,
      suggestions: stable.suggestions,
      intentName: intent.name,
      intent,
      runtimeMode: state.runtimeDecision.runtimeMode,
      toolCalls: publicToolCalls,
      steps: execution.steps,
      plan: execution.plan || plan,
      needsClarification: intent.name === "clarify_missing_slot" || (execution.plan && execution.plan.needsClarification),
      clarification: execution.plan && execution.plan.clarification,
      generalAssistant: isGeneralAssistantEnabled(state.runtimeDecision.runtimeMode),
      context: responseContext,
      message: state.safeMessage,
      userMessage: state.safeMessage,
      durationMs: Date.now() - state.startTime,
      replanUsed: execution.replanUsed === true,
      success: generatedResponse.runOutcome.success,
      status: generatedResponse.runOutcome.status,
      errors: generatedResponse.runOutcome.errors,
    });
    const actionCommands = deriveActionCommands(toolCalls);
    const lastResolvedEntity = deriveLastResolvedEntity(toolCalls);
    const pendingAction = derivePendingAction(actionCommands, { runId: state.runId })
      || deriveReminderPendingAction(toolCalls, state.memoryBundle && state.memoryBundle.principal, { runId: state.runId });
    await registerReminderReceiptWaitBestEffort(pendingAction, state.memoryBundle && state.memoryBundle.principal);
    const responsePlan = state.protocolVersion === agentProtocol.PROTOCOL_VERSION
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
      protocolVersion: state.protocolVersion,
      runId: state.runId,
      requestId: state.requestId,
      conversationId: state.conversationId,
      runtimeMode: state.runtimeDecision.runtimeMode,
      requestedRuntimeMode: state.runtimeDecision.requestedMode,
      competitionAuthorized: state.runtimeDecision.authorized,
      toolCalls: publicToolCalls,
      rawToolCalls: toolCalls,
      intent,
      plan: responsePlan,
      skill: skillRouter.executionSkill(execution),
      steps: execution.steps,
      observations: execution.observations,
      actions: actionCommands,
      context: responseContext,
      provider: generatedResponse.providerName,
      desiredProvider: generatedResponse.desiredProviderName,
      resolvedProvider: generatedResponse.providerName,
      usedPersonalContext: state.usedPersonalContext,
      providerPolicy: generatedResponse.providerPolicy,
      externalProviderUsed: generatedResponse.providerTruth.externalProviderUsed,
      providerStages: generatedResponse.providerTruth.stages,
      providerDecisionReason: generatedResponse.providerDecisionReason,
      fallbackReason: generatedResponse.providerTruth.fallbackReason,
      fallback: generatedResponse.providerTruth.fallback,
      fallbackLayer: generatedResponse.providerTruth.fallback ? "server" : "none",
      success: generatedResponse.runOutcome.success,
      status: generatedResponse.runOutcome.status,
      pendingClarification: pendingPatch.pendingClarification,
      clearPendingClarification: pendingPatch.clearPendingClarification,
      errors: generatedResponse.runOutcome.errors,
      verification: execution.verification || null,
      reusedToolCount: execution.reusedToolCount || 0,
      avoidedDuplicateCalls: execution.avoidedDuplicateCalls || 0,
      replanReason: execution.replanReason || "",
      partialCompletion: execution.partialCompletion === true,
      goalContract: understanding.contract,
      verificationGoalContract: verificationCoordinator.resolveVerificationGoalContract(execution),
      understanding,
      metrics: buildMetrics({
        startTime: state.startTime,
        intent,
        toolCalls,
        externalProviderUsed: generatedResponse.providerTruth.externalProviderUsed,
        fallback: generatedResponse.providerTruth.fallback,
        usedPersonalContext: state.usedPersonalContext,
        plannerProvider: plannerDiag.plannerProvider || (plan && plan.plannerProvider) || "none",
        responseProvider: generatedResponse.providerName,
        plannerLatency: plannerDiag.plannerLatency || (plan && plan.plannerLatencyMs) || 0,
        responseLatency: generatedResponse.responseLatencyMs,
        plannerFallback: generatedResponse.providerTruth.stages.planner.fallback,
        responseFallback: generatedResponse.providerTruth.stages.response.fallback,
        plannerType: plannerDiag.inferredPlannerType || (plan && plan.plannerType) || "",
      }),
      taskTrajectory: composed.taskTrajectory || null,
      contextMeta: generatedResponse.contextMeta || null,
    }));
    const finalOutcome = deriveFinalResponseOutcome(builtResponse, generatedResponse.providerTruth);
    applyFinalResponseOutcome(builtResponse, finalOutcome);
    const finalResponse = await attachMemory(builtResponse, state.memoryBundle, {
      message: state.safeMessage,
      intentName: intent.name,
      context: responseContext,
      runId: state.runId,
      status: finalOutcome.status,
      stepCount: (execution.steps || []).length,
      policy: state.memoryPolicy || null,
      contextSlots: buildContextSlots(intent, intent.slots || {}),
      pendingClarification: pendingPatch.pendingClarification,
      clearPendingClarification: pendingPatch.clearPendingClarification,
      answer: composed.answer,
      evidence: null,
      cloudSyncEnabled: state.memoryBundle.memory && state.memoryBundle.memory.mode === "cloud_sync",
      allowPartialCommit: finalOutcome.status === "partial",
      autoMemoryEnabled: !(state.memoryBundle.memoryPolicy
        && (state.memoryBundle.memoryPolicy.paused === true
          || state.memoryBundle.memoryPolicy.autoMemoryEnabled === false)),
      providerUsed: understanding.providerUsed || "",
      understandingSource: understanding.source,
      goalContract: decisionResult.goalContractV2 || undefined,
      pendingAction,
      lastResolvedEntity,
    });
    maybeAttachProactive(finalResponse, { context: responseContext, proactiveEvent: state.context.proactiveEvent }, state.memoryBundle, toolCalls);
    attachReminderConfirmation(finalResponse, execution, state.memoryBundle.principal);
    agentKernel.finalize(execution, {
      totalDurationMs: Date.now() - state.startTime,
      providerUsed: generatedResponse.providerTruth.externalProviderUsed,
      provider: generatedResponse.providerName || "mock",
      fallbackLayer: generatedResponse.providerTruth.fallback ? "server" : "none",
      fallbackReason: generatedResponse.providerTruth.fallbackReason,
      evidenceComplete: finalResponse.evidence && finalResponse.evidence.complete === true,
      plannerType: plan && plan.plannerType,
      plannerProvider: plannerDiag.plannerProvider,
      status: finalOutcome.status,
    });
    emitChatEvent(state.eventInput, {
      type: finalOutcome.eventType,
      runtimeMode: state.runtimeDecision.runtimeMode,
      intentName: intent.name,
      providerUsed: generatedResponse.providerTruth.externalProviderUsed,
      reasonCode: generatedResponse.providerTruth.fallbackReason
        ? String(generatedResponse.providerTruth.fallbackReason).slice(0, 80)
        : "",
      status: finalOutcome.status,
      success: finalOutcome.success,
      fallback: generatedResponse.providerTruth.fallback,
      partialCompletion: finalOutcome.partialCompletion,
      verificationOk: finalOutcome.verificationOk,
      errorCount: finalOutcome.errors.length,
      plannerType: plan && plan.plannerType || "",
    });
    return Object.assign(finalResponse, { contextId: String(contextView.contextId || "") });
  }

  return Object.freeze({
    context,
    decision,
    skillTool,
    verification,
    response,
  });
}

module.exports = {
  createFosuTurnPorts,
  deriveReminderPendingAction,
  applyProviderHardGuards,
};
