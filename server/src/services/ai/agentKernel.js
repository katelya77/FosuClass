const agentProtocol = require("./agentProtocol");
const agentTraceRecorder = require("./agentTraceRecorder");
const capabilityManifestService = require("./capabilityManifestService");
const runtimeModeService = require("./runtimeModeService");
const safetyGuard = require("./safetyGuard");
const defaultSkillRegistry = require("./skillRegistry");
const toolRegistry = require("./toolRegistry");

function codedError(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ success: false, code: "TOOL_TIMEOUT", message: "Tool execution timed out" }), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function buildToolSummary(toolName, result) {
  if (!result || result.success === false) return String(result && (result.code || result.message) || "TOOL_FAILED").slice(0, 160);
  if (result.summary) return safetyGuard.redactSensitiveText(String(result.summary)).slice(0, 160);
  const count = Number(result.total || result.courseCount || (Array.isArray(result.items) ? result.items.length : 0) || 0) || 0;
  return count ? `${toolName}:${count}` : `${toolName}:success`;
}

function toObservation(call, index) {
  const result = call && call.result || {};
  const metadata = result.meta || result.metadata || {};
  return {
    id: `observation-${index + 1}`,
    tool: String(call && call.name || "").slice(0, 80),
    status: String(call && call.status || (result.success === false ? "failed" : "success")).slice(0, 24),
    code: String(result.code || "").slice(0, 80),
    summary: safetyGuard.redactSensitiveText(String(call && call.summary || buildToolSummary(call && call.name, result))).slice(0, capabilityManifestService.getManifest().limits.maxObservationChars),
    sourceId: safetyGuard.redactSensitiveText(String(result.sourceId || result.source || metadata.sourceId || "")).slice(0, 120),
    factCount: Math.max(0, Number(result.total || result.courseCount || (Array.isArray(result.items) ? result.items.length : 0) || 0) || 0),
  };
}

class AgentKernel {
  constructor(options = {}) {
    const limits = capabilityManifestService.getManifest().limits;
    this.maxPlanSteps = Math.max(1, Number(options.maxPlanSteps || limits.maxPlanSteps) || limits.maxPlanSteps);
    this.toolTimeoutMs = Math.max(10, Number(options.toolTimeoutMs || limits.toolTimeoutMs) || limits.toolTimeoutMs);
    this.skillRegistry = options.skillRegistry || defaultSkillRegistry;
    this.intentResolver = options.intentResolver || toolRegistry.resolveIntent;
    this.toolExecutor = options.toolExecutor || toolRegistry.executeToolAsync;
    this.toolChainExecutor = options.toolChainExecutor || toolRegistry.runToolChainForIntentAsync;
    this.runtimeModeResolver = options.runtimeModeResolver || runtimeModeService.resolveRuntimeMode;
    this.traceRecorder = options.traceRecorder || agentTraceRecorder;
    this.useToolChain = options.useToolChain === true || (!options.toolExecutor && !options.skillRegistry && !options.intentResolver);
  }

  resolveRuntime(input, context) {
    if (input.runtimeDecision && input.runtimeDecision.runtimeMode) return input.runtimeDecision;
    if (input.runtimeMode) {
      return {
        runtimeMode: capabilityManifestService.normalizeRuntimeMode(input.runtimeMode),
        requestedMode: capabilityManifestService.normalizeRuntimeMode(input.runtimeMode),
        authorized: capabilityManifestService.normalizeRuntimeMode(input.runtimeMode) !== "public",
        reason: "kernel_explicit_runtime",
      };
    }
    return this.runtimeModeResolver({
      context,
      serverSession: input.serverSession,
      runtimeMode: input.runtimeMode,
    });
  }

  validatePlan(skill, plan, runtimeMode) {
    if (plan.length > this.maxPlanSteps) {
      throw codedError("PLAN_STEP_LIMIT_EXCEEDED", `Plan exceeds ${this.maxPlanSteps} steps`);
    }
    plan.forEach((step) => {
      const toolName = String(step.toolName || step.name || "");
      if (!skill.allowedTools.includes(toolName)) {
        throw codedError("TOOL_NOT_ALLOWED_FOR_SKILL", `Tool ${toolName} is not allowed for ${skill.id}`, { toolName });
      }
      if (this.skillRegistry === defaultSkillRegistry && !capabilityManifestService.isToolAllowedForRuntime(toolName, runtimeMode)) {
        throw codedError("TOOL_NOT_ALLOWED_FOR_RUNTIME", `Tool ${toolName} is not available in ${runtimeMode}`, { toolName });
      }
    });
  }

  async executePlan(plan, context) {
    const calls = [];
    const steps = [];
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      const toolName = String(item.toolName || item.name || "");
      const started = Date.now();
      const result = await withTimeout(this.toolExecutor(toolName, item.args || item.input || {}, context), this.toolTimeoutMs);
      const durationMs = Date.now() - started;
      const failed = !result || result.success === false;
      calls.push({
        name: toolName,
        status: failed ? "failed" : "success",
        summary: buildToolSummary(toolName, result),
        result: safetyGuard.sanitizeToolResult(result || { success: false, code: "TOOL_FAILED" }),
      });
      steps.push({
        id: `step-${index + 1}`,
        label: safetyGuard.redactSensitiveText(String(item.reason || item.label || `Execute ${toolName}`)).slice(0, 120),
        tool: toolName,
        status: failed ? "failed" : "success",
        durationMs,
        errorCode: failed ? String(result && result.code || "TOOL_FAILED").slice(0, 80) : "",
        retried: false,
      });
    }
    return { toolCalls: calls, steps };
  }

  async executeToolChain(intent, message, context, skill) {
    const started = Date.now();
    const toolCalls = await withTimeout(
      this.toolChainExecutor(intent, message, context),
      this.toolTimeoutMs * this.maxPlanSteps
    );
    const calls = Array.isArray(toolCalls) ? toolCalls : [];
    if (calls.length > this.maxPlanSteps) {
      throw codedError("PLAN_STEP_LIMIT_EXCEEDED", `Tool chain exceeds ${this.maxPlanSteps} steps`);
    }
    calls.forEach((call) => {
      const toolName = String(call && call.name || "");
      if (!skill.allowedTools.includes(toolName)) {
        throw codedError("TOOL_NOT_ALLOWED_FOR_SKILL", `Tool ${toolName} is not allowed for ${skill.id}`, { toolName });
      }
    });
    const duration = Date.now() - started;
    const perStep = calls.length ? Math.max(0, Math.round(duration / calls.length)) : 0;
    const steps = calls.map((call, index) => {
      const result = call && call.result || {};
      const failed = call.status === "failed" || result.success === false;
      return {
        id: `step-${index + 1}`,
        label: String(call.summary || call.name || "").slice(0, 120),
        tool: String(call.name || "").slice(0, 80),
        status: failed ? "failed" : (call.status || "success"),
        durationMs: Number(call.durationMs || perStep) || 0,
        errorCode: failed ? String(result.code || "TOOL_FAILED").slice(0, 80) : "",
        retried: call.retried === true,
      };
    });
    return { toolCalls: calls, steps };
  }

  async execute(input = {}) {
    const startedAt = Date.now();
    const rawMessage = String(input.message || "").trim();
    const message = safetyGuard.redactSensitiveText(rawMessage).slice(0, 2000);
    const context = input.contextAlreadySanitized === true
      ? Object.assign({}, input.context || {})
      : safetyGuard.sanitizeAgentContext(input.context || {});
    const runtimeDecision = this.resolveRuntime(input, context);
    const runtimeMode = capabilityManifestService.normalizeRuntimeMode(runtimeDecision.runtimeMode);
    const intent = input.intent || this.intentResolver(message, context);
    const skill = this.skillRegistry.getSkillForIntent(intent && intent.name);
    if (!skill) throw codedError("SKILL_NOT_FOUND", `No skill for intent ${intent && intent.name || "unknown"}`);
    if (!skill.runtimeModes.includes(runtimeMode)) {
      throw codedError("SKILL_NOT_ALLOWED_FOR_RUNTIME", `Skill ${skill.id} is not available in ${runtimeMode}`);
    }
    const slots = Object.assign({}, intent && intent.slots || {});
    const missingSlots = skill.requiredSlots.filter((name) => slots[name] === undefined || slots[name] === null || slots[name] === "");
    if (missingSlots.length) {
      throw codedError("MISSING_REQUIRED_SLOTS", `Missing required slots: ${missingSlots.join(",")}`, { missingSlots });
    }
    const plan = skill.planBuilder({ message, context, intent, runtimeMode });
    this.validatePlan(skill, plan, runtimeMode);
    const execution = this.useToolChain
      ? await this.executeToolChain(intent, message, context, skill)
      : await this.executePlan(plan, context);
    const verification = skill.resultVerifier({ intent, toolCalls: execution.toolCalls, context, runtimeMode });
    const observations = execution.toolCalls.map(toObservation);
    return {
      runId: input.runId || agentProtocol.createRunId(),
      requestId: input.requestId || agentProtocol.createRequestId(),
      conversationId: String(input.conversationId || context.conversationId || "").slice(0, 80),
      runtimeDecision,
      runtimeMode,
      message,
      context,
      intent,
      confidence: Number(intent && intent.confidence || 0) || 0,
      slots,
      skill,
      plan,
      steps: execution.steps,
      toolCalls: execution.toolCalls,
      observations,
      verification,
      evidenceComplete: verification.evidenceComplete === true,
      usedPersonalContext: Boolean(context.currentScheduleSummary && context.currentScheduleSummary.enabled && context.currentScheduleSummary.courses && context.currentScheduleSummary.courses.length),
      startedAt,
      deterministicDurationMs: Date.now() - startedAt,
    };
  }

  finalize(execution, result = {}) {
    return this.traceRecorder.record({
      runId: execution.runId,
      requestId: execution.requestId,
      conversationId: execution.conversationId,
      runtimeMode: execution.runtimeMode,
      intent: execution.intent,
      selectedSkill: execution.skill,
      stepCount: execution.steps.length,
      toolCalls: execution.toolCalls,
      steps: execution.steps,
      totalDurationMs: Math.max(0, Number(result.totalDurationMs || Date.now() - execution.startedAt) || 0),
      providerUsed: result.providerUsed === true,
      fallbackLayer: result.fallbackLayer || "none",
      fallbackReason: result.fallbackReason || "",
      evidenceComplete: result.evidenceComplete === true || execution.evidenceComplete === true,
      errorCode: result.errorCode || "",
    });
  }
}

const defaultKernel = new AgentKernel();

module.exports = {
  AgentKernel,
  codedError,
  defaultKernel,
  withTimeout,
};
