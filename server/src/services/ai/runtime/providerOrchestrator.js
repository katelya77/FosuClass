const providerFactory = require("../providerFactory");
const mockProvider = require("../providers/mockProvider");
const providerRuntimeComposition = require("../providerRuntimeComposition");
const providerConfigService = require("../providerConfigService");
const capabilityManifestService = require("../capabilityManifestService");
const projectKnowledgeService = require("../projectKnowledgeService");
const safetyGuard = require("../safetyGuard");
const { assemble: assembleContext } = require("../context/contextAssembler");
const { stableGeneratedPayload, configValue, getProviderPolicy } = require("./shared");
const { emitChatEvent } = require("./runEventPublisher");
const { deriveExecutionOutcome } = require("./responseComposerBridge");
const { isProjectKnowledgeIntent, isFactToolIntent } = require("./understandingCoordinator");
const { buildToolResultsForProvider } = require("./toolExecutor");

function buildMinimalProviderContext(context = {}) {
  const summary = context.currentScheduleSummary || {};
  return safetyGuard.sanitizeAgentContext({
    term: context.term,
    releaseVersion: context.releaseVersion,
    envVersion: context.envVersion,
    miniprogramVersion: context.miniprogramVersion,
    currentPage: context.currentPage,
    clientTime: context.clientTime,
    clientLocalTime: context.clientLocalTime,
    timezoneOffsetMinutes: context.timezoneOffsetMinutes,
    clientTimestampMs: context.clientTimestampMs,
    timezone: context.timezone,
    currentTeachingWeek: context.currentTeachingWeek,
    todayWeekday: context.todayWeekday,
    todayDate: context.todayDate,
    termStartDate: context.termStartDate,
    totalWeeks: context.totalWeeks,
    userPreferences: context.userPreferences,
    currentScheduleSummary: {
      enabled: false,
      targetType: "personal-redacted",
      targetName: "personal schedule",
      term: summary.term || context.term || "",
      source: summary.source || "",
      courseCount: Number(summary.courseCount || (Array.isArray(summary.courses) ? summary.courses.length : 0)) || 0,
      courses: [],
    },
  });
}

// 回复阶段对话历史：最近 6 轮、脱敏截断，供各 Provider 以各自协议注入提示词。
// context.recentMessages 已在 memoryCoordinator 内经 sanitizeAgentContext 清洗（≤8 条/400 字）。
function sanitizeResponseHistory(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-6)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").replace(/\s+/g, " ").trim().slice(0, 400),
    }))
    .filter((item) => item.content);
}

function evaluateProviderPolicy(intent, toolCalls, policy, providerName, runtimeMode, runtimeConfig) {
  const normalizedPolicy = ["auto", "always", "tool-only"].includes(String(policy || "").toLowerCase())
    ? String(policy).toLowerCase()
    : "auto";
  const provider = String(providerName || providerFactory.getProviderName(runtimeMode, runtimeConfig) || "mock").toLowerCase();
  const intentName = intent && intent.name || "generic";
  const agentEnabled = String(configValue(runtimeConfig, "AI_AGENT_ENABLED", "false")).toLowerCase() !== "false";

  if (capabilityManifestService.normalizeRuntimeMode(runtimeMode) === "public") {
    return { useExternal: false, reason: "public_runtime_forbids_external_provider" };
  }
  if (!capabilityManifestService.isExternalProviderAllowed(intentName, runtimeMode)) {
    return { useExternal: false, reason: "capability_manifest_forbids_external_provider" };
  }
  if (!agentEnabled) return { useExternal: false, reason: "AI_AGENT_ENABLED=false" };
  if (provider === "mock") return { useExternal: false, reason: "AI_PROVIDER=mock" };
  if (normalizedPolicy === "tool-only") return { useExternal: false, reason: "AI_PROVIDER_POLICY=tool-only" };
  if (intentName === "clarify_missing_slot") {
    return { useExternal: false, reason: "缺槽追问使用本地模板" };
  }
  if (intentName === "explain_personal_import") {
    return { useExternal: false, reason: "XLS 导入安全说明使用本地模板" };
  }
  if (normalizedPolicy === "always") {
    return { useExternal: true, reason: "AI_PROVIDER_POLICY=always" };
  }
  if (isProjectKnowledgeIntent(intent)) {
    return { useExternal: true, reason: "项目问答或自然语言帮助调用外部 Provider" };
  }
  if (isFactToolIntent(intent)) {
    return { useExternal: false, reason: "事实类任务使用确定性工具渲染" };
  }
  return { useExternal: true, reason: "未命中本地确定性规则，交给外部 Provider" };
}

function shouldUseExternalProvider(intent, toolCalls, policy, runtimeMode) {
  return evaluateProviderPolicy(intent, toolCalls, policy, providerFactory.getProviderName(runtimeMode), runtimeMode || providerFactory.getRuntimeMode()).useExternal;
}

function classifyProviderFailure(error) {
  const code = String(error && error.code || "");
  if (["provider_bad_request", "invalid_model", "invalid_payload", "provider_timeout"].includes(code)) {
    return code;
  }
  if (/timeout|ECONNABORTED|ETIMEDOUT/i.test(code) || /timeout|超时/i.test(String(error && error.message || ""))) {
    return "provider_timeout";
  }
  const status = Number(error && error.response && error.response.status);
  const body = error && error.response && error.response.data;
  const text = JSON.stringify(body || {}).toLowerCase();
  if (status === 400 || code === "ERR_BAD_REQUEST") {
    if (/model/.test(text)) return "invalid_model";
    if (/response_format|payload|json|schema|thinking|reasoning/.test(text)) return "invalid_payload";
    return "provider_bad_request";
  }
  return code || "provider_fallback";
}

function summarizeProviderChainFallback(chain = []) {
  const reasons = Array.from(new Set((Array.isArray(chain) ? chain : [])
    .filter((item) => item && item.provider !== "mock" && item.status !== "success")
    .map((item) => String(item.reason || item.status || "").trim())
    .filter(Boolean)));
  return reasons.length ? `provider_chain_fallback:${reasons.join(",")}` : "provider_chain_fallback";
}

function providerChainAttempts(chain = []) {
  return (Array.isArray(chain) ? chain : []).filter((item) => item
    && String(item.provider || "").toLowerCase() !== "mock"
    && item.attempted !== false
    && ["success", "failed"].includes(String(item.status || "").toLowerCase()));
}

function providerChainFromRuntimePath(path = []) {
  const skippedCodes = new Set([
    "PROVIDER_CIRCUIT_OPEN",
    "PROVIDER_NOT_REGISTERED",
    "PROVIDER_METHOD_UNSUPPORTED",
    "PROVIDER_FALLBACK_BUDGET_EXHAUSTED",
    "DEADLINE_EXCEEDED",
  ]);
  return (Array.isArray(path) ? path : []).map((entry) => {
    const text = String(entry || "");
    const separator = text.indexOf(":");
    const provider = separator >= 0 ? text.slice(0, separator) : text;
    const reason = separator >= 0 ? text.slice(separator + 1) : "provider_failed";
    const success = reason === "success";
    const skipped = !success && skippedCodes.has(reason);
    return {
      provider,
      status: success ? "success" : (skipped ? "skipped" : "failed"),
      reason,
      attempted: !skipped,
    };
  });
}

function safeProviderStage(input = {}) {
  return {
    provider: String(input.provider || "none").slice(0, 40),
    attempted: input.attempted === true,
    completed: input.completed === true,
    fallback: input.fallback === true,
    reasonCode: String(input.reasonCode || "").slice(0, 80),
    latencyMs: Math.max(0, Number(input.latencyMs || 0) || 0),
  };
}

function deriveProviderRunTruth(input = {}) {
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
  const understanding = input.understanding || {};
  const planner = input.planner || {};
  const response = input.response || {};
  const understandingAttempts = providerChainAttempts(understanding.providerChain);
  const responseAttempts = providerChainAttempts(response.providerChain);
  const understandingAttempted = understanding.externalProviderUsed === true || understandingAttempts.length > 0;
  const plannerNamed = String(planner.plannerProvider || "none").toLowerCase();
  const plannerAttempted = Number(planner.successCount || 0) > 0
    || Number(planner.failureCount || 0) > 0
    || (planner.plannerStatus === "ok" && plannerNamed !== "none" && plannerNamed !== "mock");
  const responseAttempted = response.externalProviderUsed === true || responseAttempts.length > 0;
  const understandingProvider = understanding.providerUsed
    || (understandingAttempts[understandingAttempts.length - 1] && understandingAttempts[understandingAttempts.length - 1].provider)
    || "none";
  const responseProvider = response.provider
    || (responseAttempts[responseAttempts.length - 1] && responseAttempts[responseAttempts.length - 1].provider)
    || "none";
  const stages = {
    understanding: safeProviderStage({
      provider: understandingProvider,
      attempted: understandingAttempted,
      completed: understanding.source === "model" && understanding.externalProviderUsed === true,
      fallback: runtimeMode !== "public" && understanding.fallback === true,
      reasonCode: understanding.reasonCode,
      latencyMs: understanding.latencyMs,
    }),
    planner: safeProviderStage({
      provider: planner.plannerProvider || "none",
      attempted: plannerAttempted,
      completed: Number(planner.successCount || 0) > 0 || planner.plannerStatus === "ok",
      fallback: runtimeMode !== "public" && (planner.plannerFallback === true || Number(planner.failureCount || 0) > 0),
      reasonCode: planner.lastFailureReason || (planner.plannerFallback ? planner.plannerStatus : ""),
      latencyMs: planner.plannerLatency,
    }),
    response: safeProviderStage({
      provider: responseProvider,
      attempted: responseAttempted,
      completed: response.externalProviderUsed === true,
      fallback: runtimeMode !== "public" && Boolean(response.fallbackReason),
      reasonCode: response.fallbackReason,
      latencyMs: response.latencyMs,
    }),
  };
  const fallbackParts = Object.keys(stages).filter((name) => stages[name].fallback).map((name) => {
    const reason = stages[name].reasonCode || "provider_fallback";
    return `${name}:${reason}`;
  });
  return {
    externalProviderUsed: Object.keys(stages).some((name) => stages[name].attempted),
    fallback: fallbackParts.length > 0,
    fallbackReason: fallbackParts.join(";").slice(0, 240),
    stages,
  };
}

/**
 * Runtime provider config glue: resolves env-aware provider settings and the
 * assistant environment for the request context (providerConfigService stays
 * authoritative).
 */
function resolveRuntimeProviderConfig(input = {}) {
  const providerRuntimeConfig = providerConfigService.resolveRuntimeProviderConfig({
    context: input.context,
    runtimeMode: input.runtimeMode,
  });
  const assistantEnvironment = providerConfigService.getEnvironmentForContext(input.context, input.runtimeMode);
  return { providerRuntimeConfig, assistantEnvironment };
}

/**
 * Response-provider coordination: policy decision, deterministic baseline,
 * external chain with events, fallback classification, and run-truth derivation.
 */
async function generateAssistantResponse(input = {}) {
  const intent = input.intent;
  const toolCalls = input.toolCalls;
  const runtimeMode = input.runtimeMode;
  const providerRuntimeConfig = input.providerRuntimeConfig;
  const principal = input.principal;
  const context = input.context;
  const safeMessage = input.message;
  const localRuleMatch = input.localRuleMatch;
  const eventInput = input.eventInput;
  const publicToolCalls = input.publicToolCalls;
  const understanding = input.understanding;
  const plannerDiag = input.plannerDiag;
  const execution = input.execution;
  const providerPolicy = getProviderPolicy(providerRuntimeConfig);
  const desiredProviderName = providerFactory.getProviderName(runtimeMode, providerRuntimeConfig);
  const policyDecision = evaluateProviderPolicy(intent, toolCalls, providerPolicy, desiredProviderName, runtimeMode, providerRuntimeConfig);
  const provider = policyDecision.useExternal ? providerFactory.createProvider(runtimeMode, providerRuntimeConfig) : mockProvider;
  let providerName = policyDecision.useExternal
    ? (provider.name || desiredProviderName)
    : (intent.name === "clarify_missing_slot" ? "mock/template" : "mock");
  // 体验/开发对话类意图始终注入公开产品知识，帮助模型做人设化表达；不含私密部署信息。
  const shouldInjectProjectKnowledge = isProjectKnowledgeIntent(intent)
    || runtimeMode !== "public";
  const toolResultsForProvider = buildToolResultsForProvider(toolCalls);
  const projectKnowledgeText = shouldInjectProjectKnowledge
    ? projectKnowledgeService.getProjectKnowledgePrompt(context.assistantEnvironment || runtimeMode, safeMessage)
    : "";
  // Budgeted response context — never dump unbounded history or full schedule into provider.
  const responseContext = assembleContext("response", {
    message: safeMessage,
    runtimeMode: runtimeMode,
    currentTeachingWeek: context.currentTeachingWeek,
    toolResults: toolResultsForProvider,
    toolCalls: toolResultsForProvider,
    projectKnowledge: projectKnowledgeText,
    history: Array.isArray(context.recentMessages) ? context.recentMessages : [],
    messages: Array.isArray(context.recentMessages) ? context.recentMessages : [],
    historyLimit: 10,
    conversationSummary: context.conversationSummary || "",
    userMemories: context.userMemories || [],
  });
  const providerInput = {
    message: safeMessage,
    context: buildMinimalProviderContext(context),
    intent,
    localRule: localRuleMatch && localRuleMatch.rule || null,
    projectKnowledge: projectKnowledgeText,
    providerRuntimeConfig,
    toolResults: toolResultsForProvider,
    history: sanitizeResponseHistory(context.recentMessages),
    userMemories: (Array.isArray(context.userMemories) ? context.userMemories : []).slice(0, 5),
    principal,
    contextMeta: {
      contextTokenEstimate: responseContext.contextTokenEstimate,
      contextSections: responseContext.sections,
      truncatedSections: responseContext.truncatedSections,
      compressionUsed: responseContext.compressionUsed === true,
    },
  };
  const deterministicGenerated = mockProvider.generate(providerInput);
  const deterministicPayload = stableGeneratedPayload(deterministicGenerated, {
    fallbackAnswer: "我已根据项目工具整理出结果。",
  });
  let providerPayload = null;
  let externalProviderUsed = false;
  let fallbackReason = "";
  let responseLatencyMs = 0;
  let responseProviderChain = [];
  const providerDecisionReason = policyDecision.reason || (policyDecision.useExternal ? "external provider selected" : "local provider selected");
  const responseStartedAt = Date.now();
  try {
    let generated = deterministicGenerated;
    if (policyDecision.useExternal) {
      const selection = providerRuntimeComposition.resolveResponseProviders(runtimeMode, providerRuntimeConfig);
      const runtimeResult = await providerRuntimeComposition.getProviderRuntime().generate({
        runtimeMode,
        executionPolicy: input.executionPolicy || "strict_model_first",
        intendedProvider: selection.intendedProvider,
        fallbackProvider: selection.fallbackProvider,
        request: providerInput,
        deadline: input.deadline,
        signal: input.signal || null,
        stage: "response",
        stageCapMs: Math.max(1, Number(input.responseBudgetMs || 1500) || 1500),
        finishReserveMs: 0,
        providerAttemptLedger: input.providerAttemptLedger,
        onEvent: (event) => emitChatEvent(eventInput, Object.assign({
          runtimeMode: runtimeMode,
          intentName: intent.name,
        }, event)),
      });
      generated = Object.assign({}, runtimeResult.payload || {}, {
        provider: runtimeResult.provider,
        providerChain: providerChainFromRuntimePath(runtimeResult.fallbackPath),
      });
    }
    responseLatencyMs = Date.now() - responseStartedAt;
    if (!policyDecision.useExternal) {
      emitChatEvent(eventInput, {
        type: "response.composing",
        runtimeMode: runtimeMode,
        intentName: intent.name,
        providerUsed: false,
      });
    }
    providerName = generated.provider || providerName;
    responseProviderChain = Array.isArray(generated.providerChain) ? generated.providerChain : [];
    providerPayload = stableGeneratedPayload(generated);
    externalProviderUsed = policyDecision.useExternal && providerName !== "mock";
    if (externalProviderUsed) fallbackReason = "";
    if (generated.providerChain) {
      publicToolCalls.push({
        name: "provider_chain",
        status: externalProviderUsed ? "success" : "skipped",
        summary: externalProviderUsed ? "external_provider_used" : "deterministic_fallback",
      });
      if (!externalProviderUsed) {
        fallbackReason = summarizeProviderChainFallback(generated.providerChain);
      }
    }
  } catch (error) {
    if ((input.signal && input.signal.aborted) || String(error && error.code || "") === "ABORTED") throw error;
    providerName = "mock";
    externalProviderUsed = false;
    responseLatencyMs = Date.now() - responseStartedAt;
    responseProviderChain = providerChainFromRuntimePath(error && error.fallbackPath);
    fallbackReason = classifyProviderFailure(error && error.cause && (error.cause.cause || error.cause) || error);
    emitChatEvent(eventInput, {
      type: "provider.failed",
      runtimeMode: runtimeMode,
      intentName: intent.name,
      reasonCode: String(fallbackReason || "provider_failed").slice(0, 80),
      providerUsed: false,
    });
    providerPayload = isProjectKnowledgeIntent(intent)
      ? stableGeneratedPayload(projectKnowledgeService.generateFallbackResponse(intent.name))
      : null;
    publicToolCalls.push({
      name: provider.name || providerFactory.getProviderName(runtimeMode, providerRuntimeConfig),
      status: "skipped",
      summary: fallbackReason,
    });
  }

  const responseExternalProviderUsed = externalProviderUsed;
  const providerTruth = deriveProviderRunTruth({
    runtimeMode: runtimeMode,
    understanding,
    planner: plannerDiag,
    response: {
      provider: providerName,
      externalProviderUsed: responseExternalProviderUsed,
      providerChain: responseProviderChain,
      fallbackReason,
      latencyMs: responseLatencyMs,
    },
  });
  const runOutcome = deriveExecutionOutcome({ execution, providerTruth });

  emitChatEvent(eventInput, {
    type: "response.composing",
    runtimeMode: runtimeMode,
    intentName: intent.name,
    providerUsed: providerTruth.externalProviderUsed,
  });
  return {
    providerPolicy,
    desiredProviderName,
    providerName,
    providerDecisionReason,
    deterministicPayload,
    providerPayload,
    externalProviderUsed: responseExternalProviderUsed,
    fallbackReason,
    responseLatencyMs,
    responseProviderChain,
    providerTruth,
    runOutcome,
    contextMeta: providerInput.contextMeta,
  };
}

module.exports = {
  buildMinimalProviderContext,
  sanitizeResponseHistory,
  configValue,
  getProviderPolicy,
  evaluateProviderPolicy,
  shouldUseExternalProvider,
  classifyProviderFailure,
  summarizeProviderChainFallback,
  providerChainAttempts,
  providerChainFromRuntimePath,
  safeProviderStage,
  deriveProviderRunTruth,
  resolveRuntimeProviderConfig,
  generateAssistantResponse,
};
