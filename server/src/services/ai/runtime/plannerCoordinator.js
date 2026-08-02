const { defaultKernel: agentKernel } = require("../agentKernel");
const plannerModelAdapter = require("../planner/plannerModelAdapter");
const { emitChatEvent } = require("./runEventPublisher");

/**
 * Planner coordination: dedicated planner model adapter (trial/dev only —
 * public never calls models, so modelGenerate stays undefined there), kernel
 * execution, and planner diagnostics reconciliation.
 */
async function executePlanner(input = {}) {
  const executionKernel = input.agentKernel || agentKernel;
  const message = input.message;
  const context = input.context;
  const runtimeMode = input.runtimeMode;
  const runtimeDecision = input.runtimeDecision;
  const intent = input.intent;
  const conversationState = input.conversationState;
  const providerRuntimeConfig = input.providerRuntimeConfig;
  const requestId = input.requestId;
  const conversationId = input.conversationId;
  const runId = input.runId;
  const protocolVersion = input.protocolVersion;
  const onEvent = input.onEvent;
  const eventInput = input.eventInput;
  // Dedicated planner model adapter (trial/dev only). public never calls models.
  const unifiedDecision = input.unifiedDecision === true;
  const plannerGenerate = unifiedDecision ? null : plannerModelAdapter.createModelGenerate({
    runtimeMode: runtimeMode,
    providerRuntimeConfig,
    onEvent: (event) => emitChatEvent(eventInput, Object.assign({
      runtimeMode: runtimeMode,
      intentName: intent.name,
    }, event)),
  });

  const execution = await executionKernel.execute({
    message: message,
    context,
    toolContext: input.toolContext || context,
    contextAlreadySanitized: true,
    runtimeDecision,
    intent,
    conversationState: conversationState || {
      conversationSummary: context.conversationSummary || "",
      summary: context.conversationSummary || "",
      recentMessages: context.recentMessages || [],
      workingMemory: context.workingMemory || null,
      userMemories: context.userMemories || [],
      pendingClarification: context.pendingClarification || null,
      contextSlots: context.conversationSlots || {},
    },
    requestId,
    conversationId,
    runId,
    environment: input.environment || runtimeMode,
    configVersion: input.configVersion || "",
    protocolVersion,
    onEvent,
    signal: input.signal || null,
    deadline: input.deadline,
    budget: input.budget,
    providerAttemptLedger: input.providerAttemptLedger,
    principal: input.principal || null,
    modelGenerate: runtimeMode === "public" || unifiedDecision ? undefined : plannerGenerate,
    unifiedDecision,
    decisionContract: input.decisionContract || null,
    decisionSource: input.decisionSource || "",
    plannerEnv: providerRuntimeConfig,
  });
  const plan = execution.plan;
  const toolCalls = execution.toolCalls;
  const plannerDiag = plannerGenerate && typeof plannerGenerate.getDiagnostics === "function"
    ? plannerGenerate.getDiagnostics()
    : {
      plannerProvider: "none",
      plannerLatency: 0,
      plannerFallback: false,
      plannerStatus: unifiedDecision ? "unified_decision" : "not_called",
      successCount: 0,
      failureCount: 0,
    };
  // Prefer structured plan metadata when available (array plan loses plannerType).
  const planType = (plan && plan.plannerType)
    || (Array.isArray(plan) ? "" : "")
    || "";
  if (planType === "model" || planType === "model_replan" || plannerDiag.plannerStatus === "ok") {
    plannerDiag.plannerFallback = false;
    if (plannerDiag.plannerStatus === "not_called") plannerDiag.plannerStatus = "ok";
    if (plan && plan.plannerProvider) plannerDiag.plannerProvider = plan.plannerProvider;
    if (plan && plan.plannerLatencyMs) {
      plannerDiag.plannerLatency = Math.max(
        Number(plannerDiag.plannerLatency) || 0,
        Number(plan.plannerLatencyMs) || 0
      );
    }
    if (!planType && plannerDiag.successCount) {
      plannerDiag.inferredPlannerType = "model";
    } else if (planType) {
      plannerDiag.inferredPlannerType = planType;
    }
  } else if (planType === "deterministic_fallback" || plannerDiag.plannerStatus === "failed") {
    plannerDiag.plannerFallback = true;
    plannerDiag.inferredPlannerType = planType || "deterministic_fallback";
  } else if (unifiedDecision) {
    plannerDiag.inferredPlannerType = "deterministic_after_decision";
    plannerDiag.plannerProvider = "none";
  } else if (runtimeMode === "public") {
    plannerDiag.inferredPlannerType = "deterministic";
    plannerDiag.plannerProvider = "none";
  } else {
    plannerDiag.inferredPlannerType = planType || "deterministic";
  }
  return { execution, plan, toolCalls, plannerDiag };
}

module.exports = {
  executePlanner,
};
