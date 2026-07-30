const agentProtocol = require("./agentProtocol");
const agentTraceRecorder = require("./agentTraceRecorder");
const capabilityManifestService = require("./capabilityManifestService");
const runtimeModeService = require("./runtimeModeService");
const safetyGuard = require("./safetyGuard");
const defaultSkillRegistry = require("./skillRegistry");
const toolRegistry = require("./toolRegistry");
const planner = require("./planner");
const { runObservationLoop } = require("./planner/observationLoop");
const { routeCapabilities, getToolSafetyMeta } = require("./capabilityRouter");
const { updateWorkingMemory } = require("./memory/workingMemory");

function codedError(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function withTimeout(promise, timeoutMs, signal = null) {
  let timer = null;
  let abortHandler = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ success: false, code: "TOOL_TIMEOUT", message: "Tool execution timed out" }), timeoutMs);
    }),
    new Promise((resolve, reject) => {
      if (!signal) return;
      abortHandler = () => reject(codedError("ABORTED", "Tool execution was cancelled"));
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
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
    this.toolRuntime = options.toolRuntime || null;
    this.capabilityManifest = options.capabilityManifestService || capabilityManifestService;
    this.runtimeModeResolver = options.runtimeModeResolver || runtimeModeService.resolveRuntimeMode;
    this.traceRecorder = options.traceRecorder || agentTraceRecorder;
  }

  resolveAllowedToolIds(intent, skill, runtimeMode, candidateTools, context = {}) {
    if (!this.toolRuntime) {
      return Array.from(new Set((skill && skill.allowedTools || []).concat(candidateTools || [])));
    }
    const manifestIntent = this.capabilityManifest.getIntent(intent && intent.name || intent);
    const descriptors = this.toolRuntime.listDescriptors();
    const runtimeToolIds = descriptors
      .filter((descriptor) => !descriptor.runtimeModes.length || descriptor.runtimeModes.includes(runtimeMode))
      .map((descriptor) => descriptor.id);
    const environmentToolIds = Array.isArray(candidateTools) ? candidateTools.slice() : [];
    const principal = context && context.principal;
    const safetyToolIds = descriptors
      .filter((descriptor) => {
        const operation = String(descriptor.safety && descriptor.safety.operation || "read");
        if ((operation === "write" || operation === "delete")
          && descriptor.safety && descriptor.safety.requiresConfirmation !== true
          && (!principal || principal.authenticated !== true)) {
          return false;
        }
        return true;
      })
      .map((descriptor) => descriptor.id);
    return this.toolRuntime.resolveAllowedToolIds({
      manifestToolIds: manifestIntent && manifestIntent.allowedTools || [],
      skillToolIds: skill && skill.allowedTools || [],
      runtimeToolIds,
      environmentToolIds,
      safetyToolIds,
    });
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

  validatePlan(skill, plan, runtimeMode, allowedToolsOverride = null) {
    if (plan.length > this.maxPlanSteps) {
      throw codedError("PLAN_STEP_LIMIT_EXCEEDED", `Plan exceeds ${this.maxPlanSteps} steps`);
    }
    const allow = this.toolRuntime && Array.isArray(allowedToolsOverride)
      ? new Set(allowedToolsOverride)
      : new Set((skill && skill.allowedTools || []).concat(Array.isArray(allowedToolsOverride) ? allowedToolsOverride : []));
    plan.forEach((step) => {
      const toolName = String(step.toolName || step.name || "");
      if (!allow.has(toolName)) {
        throw codedError("TOOL_NOT_ALLOWED_FOR_SKILL", `Tool ${toolName} is not allowed for ${skill && skill.id || "route"}`, { toolName });
      }
      const manifestTool = this.capabilityManifest.getTool(toolName);
      if (manifestTool && !this.capabilityManifest.isToolAllowedForRuntime(toolName, runtimeMode)) {
        throw codedError("TOOL_NOT_ALLOWED_FOR_RUNTIME", `Tool ${toolName} is not available in ${runtimeMode}`, { toolName });
      }
      // Level 3–4 write/delete tools must not auto-execute without confirmation flag in args/context.
      const meta = getToolSafetyMeta(toolName);
      if (meta.requiresDoubleConfirm || meta.autonomyLevel >= 4) {
        const args = step.args || step.input || {};
        if (args.confirmed !== true && args.doubleConfirmed !== true) {
          // Allowed in plan for confirmation UX; execution layer enforces write gate.
        }
      }
    });
  }

  async invokeTool(toolName, args, context, input = {}) {
    if (!this.toolRuntime) return this.toolExecutor(toolName, args, context);
    try {
      return await this.toolRuntime.execute(toolName, args, context, {
        allowedToolIds: input.allowedToolIds || [],
        signal: input.signal || null,
        timeoutMs: input.budget && Number(input.budget.timeoutMs) || this.toolTimeoutMs,
      });
    } catch (error) {
      if (error && ["TOOL_NOT_ALLOWED", "TOOL_NOT_REGISTERED"].includes(error.code)) throw error;
      return {
        success: false,
        code: String(error && error.code || "TOOL_RUNTIME_FAILED").slice(0, 80),
        message: String(error && error.message || "Tool execution failed").slice(0, 160),
      };
    }
  }

  emit(input, event) {
    if (typeof input.onEvent === "function") {
      try {
        input.onEvent(event);
      } catch (error) {
        // run events must never break the kernel
      }
    }
  }

  async executePlan(plan, context, input = {}) {
    const calls = [];
    const steps = [];
    // Skill-declared recovery rules (see skillRegistry); the kernel only executes them generically.
    const recoveryRules = (input.skill && Array.isArray(input.skill.recoveryRules)) ? input.skill.recoveryRules : [];
    const toolTimeoutMs = () => {
      const remaining = input.deadline && typeof input.deadline.remainingMs === "function"
        ? input.deadline.remainingMs()
        : this.toolTimeoutMs;
      const stageBudget = input.budget && Number(input.budget.timeoutMs);
      return Math.max(1, Math.min(
        this.toolTimeoutMs,
        Number.isFinite(stageBudget) ? stageBudget : this.toolTimeoutMs,
        Math.max(1, remaining),
      ));
    };
    const pushCall = (toolName, result, label, durationMs = 0) => {
      const missingContextIsFailure = result && result.needContext === true
        && agentProtocol.normalizeProtocolVersion(input.protocolVersion) === agentProtocol.PROTOCOL_V2;
      const failed = !result || result.success === false || missingContextIsFailure;
      const index = calls.length;
      calls.push({
        name: toolName,
        status: failed ? "failed" : "success",
        summary: buildToolSummary(toolName, result),
        result: safetyGuard.sanitizeToolResult(result || { success: false, code: "TOOL_FAILED" }),
      });
      steps.push({
        id: `step-${index + 1}`,
        label: safetyGuard.redactSensitiveText(String(label || `Execute ${toolName}`)).slice(0, 120),
        tool: toolName,
        status: failed ? "failed" : "success",
        durationMs,
        errorCode: failed ? String(result && result.code || "TOOL_FAILED").slice(0, 80) : "",
        retried: false,
      });
      this.emit(input, {
        type: failed ? "tool.failed" : "tool.completed",
        tool: toolName,
        status: failed ? "failed" : "success",
        reasonCode: failed ? String(result && result.code || "TOOL_FAILED").slice(0, 80) : "",
      });
    };

    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      const toolName = String(item.toolName || item.name || "");
      this.emit(input, {
        type: "tool.started",
        tool: toolName,
        status: "started",
        label: safetyGuard.redactSensitiveText(String(item.reason || item.label || `Execute ${toolName}`)).slice(0, 120),
      });
      const started = Date.now();
      const result = await withTimeout(
        this.invokeTool(toolName, item.args || item.input || {}, context, input),
        toolTimeoutMs(),
        input.signal || null,
      );
      const durationMs = Date.now() - started;
      pushCall(toolName, result, item.reason || item.label || `Execute ${toolName}`, durationMs);

      // Skill-declared recovery: attach side results / run recovery tools on empty-or-failed results.
      for (const rule of recoveryRules) {
        if (!rule || !rule.when || !(rule.when.tools || []).includes(toolName)) continue;
        if (rule.attachResult && result && result[rule.attachResult.resultKey]) {
          pushCall(rule.attachResult.tool, result[rule.attachResult.resultKey], rule.attachResult.label, 0);
        }
        if (rule.callOnEmptyOrFailure && result && (result.success === false
          || !(Array.isArray(result.rooms) ? result.rooms.length : Number(result.total || 0)))) {
          const recoveryTool = rule.callOnEmptyOrFailure.tool;
          if (this.toolRuntime && !(input.allowedToolIds || []).includes(recoveryTool)) continue;
          const recovery = await withTimeout(
            this.invokeTool(recoveryTool, item.args || item.input || {}, context, input),
            toolTimeoutMs(),
            input.signal || null,
          );
          pushCall(rule.callOnEmptyOrFailure.tool, recovery, rule.callOnEmptyOrFailure.label, 0);
        }
      }
    }
    return { toolCalls: calls, steps };
  }

  async execute(input = {}) {
    const startedAt = Date.now();
    const rawMessage = String(input.message || "").trim();
    const message = safetyGuard.redactSensitiveText(rawMessage).slice(0, 2000);
    const context = input.contextAlreadySanitized === true
      ? Object.assign({}, input.context || {})
      : safetyGuard.sanitizeAgentContext(input.context || {});
    // Semantic routing/planning only sees the assembled Context view. A plugin
    // may provide request-scoped authoritative resources exclusively for the
    // concrete Tool invocation (for example a personal schedule fact source).
    const toolContext = input.toolContext && typeof input.toolContext === "object"
      ? Object.assign({}, context, input.toolContext)
      : context;
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
    this.emit(input, {
      type: "intent.resolved",
      intentName: String(intent && intent.name || "").slice(0, 80),
      status: "resolved",
    });
    this.emit(input, {
      type: "skill.selected",
      skillId: String(skill.id || "").slice(0, 80),
      intentName: String(intent && intent.name || "").slice(0, 80),
      status: "selected",
    });

    // Single execution path: constrained planner + observation loop (public stays deterministic),
    // coordinated upstream by runtime/plannerCoordinator.
    // Capability Router: 1–3 skills, ≤8–12 candidate tools for Planner.
    const conversationState = input.conversationState || {
      conversationSummary: context.conversationSummary || "",
      summary: context.conversationSummary || "",
      recentMessages: context.recentMessages || [],
      workingMemory: context.workingMemory || null,
      userMemories: context.userMemories || [],
      pendingClarification: context.pendingClarification || null,
      contextSlots: context.conversationSlots || {},
    };
    if (!conversationState.workingMemory) {
      conversationState.workingMemory = updateWorkingMemory(null, {
        message,
        intentName: intent && intent.name,
        slots,
        contextSlots: context.conversationSlots || {},
        campus: context.campus,
      });
    }
    const capabilityRoute = routeCapabilities({
      message,
      intent,
      skill,
      runtimeMode,
      workingMemory: conversationState.workingMemory,
      context,
    });
    const candidateTools = capabilityRoute.candidateTools && capabilityRoute.candidateTools.length
      ? capabilityRoute.candidateTools
      : skill.allowedTools;
    const availableSkills = capabilityRoute.skillIds && capabilityRoute.skillIds.length
      ? capabilityRoute.skillIds
      : [skill.id];
    const authorizationContext = Object.assign({}, context, { principal: input.principal || context.principal });
    const allowedToolIds = this.resolveAllowedToolIds(intent, skill, runtimeMode, candidateTools, authorizationContext);

    const loop = await runObservationLoop({
      message,
      runtimeMode,
      intent,
      slots,
      skill,
      context,
      conversationState,
      availableTools: allowedToolIds,
      availableSkills,
      modelGenerate: input.modelGenerate,
      plannerEnv: input.plannerEnv,
      emit: (event) => this.emit(input, event),
      planFn: async (args) => {
        let structured;
        try {
          structured = await planner.plan(Object.assign({}, args, {
            skill,
            conversationState,
            availableTools: allowedToolIds,
            availableSkills,
            unifiedDecision: input.unifiedDecision === true,
            decisionContract: input.decisionContract || null,
          }));
        } catch (error) {
          // Hard policy errors must surface; soft planner failures fall back.
          if (error && [
            "TOOL_NOT_ALLOWED_FOR_SKILL",
            "TOOL_NOT_ALLOWED_FOR_RUNTIME",
            "PLAN_STEP_LIMIT_EXCEEDED",
            "PLAN_ARGS_FORBIDDEN",
          ].includes(error.code)) {
            throw error;
          }
          const fallbackPlan = skill.planBuilder({ message, context, intent, runtimeMode });
          this.validatePlan(skill, fallbackPlan, runtimeMode, allowedToolIds);
          structured = {
            goal: intent.name,
            intent: intent.name,
            confidence: Number(intent.confidence) || 0,
            slots,
            needsClarification: false,
            clarification: null,
            steps: fallbackPlan.map((step, index) => ({
              id: `step-${index + 1}`,
              skillId: skill.id,
              toolName: step.toolName || step.name,
              args: step.args || step.input || {},
              reasonCode: "COMPOSE_TEXT_RESPONSE",
              dependsOn: [],
              stopOnFailure: true,
            })),
            stopCondition: "all_steps_done",
            replanCount: 0,
            plannerType: "deterministic_fallback",
          };
        }
        if (structured.steps && structured.steps.length) {
          const legacyPlan = structured.steps.map((step) => ({
            toolName: step.toolName,
            args: step.args,
            reason: step.reasonCode,
          }));
          this.validatePlan(skill, legacyPlan, runtimeMode, allowedToolIds);
        }
        return structured;
      },
      replanFn: async (args) => {
        try {
          const structured = await planner.replan(Object.assign({}, args, {
            skill,
            conversationState,
            availableTools: allowedToolIds,
            availableSkills,
            unifiedDecision: input.unifiedDecision === true,
            decisionContract: input.decisionContract || null,
          }));
          if (structured.steps && structured.steps.length) {
            this.validatePlan(skill, structured.steps, runtimeMode, allowedToolIds);
          }
          return structured;
        } catch (error) {
          if (!error || ![
            "TOOL_NOT_ALLOWED_FOR_SKILL",
            "TOOL_NOT_ALLOWED_FOR_RUNTIME",
            "PLAN_STEP_LIMIT_EXCEEDED",
            "PLAN_ARGS_FORBIDDEN",
          ].includes(error.code)) {
            throw error;
          }
          this.emit(input, {
            type: "planner.failed",
            status: "rejected",
            reasonCode: error.code,
          });
          return Object.assign({}, args.previousPlan || {}, {
            steps: [],
            replanCount: Math.min(2, Number(args.previousPlan && args.previousPlan.replanCount || 0) + 1),
            stopCondition: args.previousPlan && args.previousPlan.needsClarification
              ? "clarification_needed"
              : "tool_failure",
          });
        }
      },
      executePlan: async (steps) => {
        const legacyPlan = (steps || []).map((step) => ({
          toolName: step.toolName,
          args: step.args || {},
          reason: step.reasonCode || step.reason,
        }));
        return this.executePlan(legacyPlan, toolContext, Object.assign({}, input, { skill, allowedToolIds }));
      },
      toObservations: (calls) => (calls || []).map(toObservation),
      verify: ({ toolCalls, plan: verifyPlan }) => {
        const routeAllowed = new Set(allowedToolIds);
        // Recovery tools from replan may sit outside primary skill but inside route.
        const scopedCalls = (Array.isArray(toolCalls) ? toolCalls : []).filter((call) => {
          const name = String(call && call.name || "");
          return routeAllowed.has(name) || (skill.allowedTools || []).includes(name);
        });
        const base = skill.resultVerifier({
          intent,
          toolCalls: scopedCalls.length ? scopedCalls : toolCalls,
          context,
          runtimeMode,
          allowedTools: Array.from(routeAllowed),
        });
        const intentMeta = capabilityManifestService.getIntent(intent && intent.name);
        const missingContextEvidence = agentProtocol.normalizeProtocolVersion(input.protocolVersion) === agentProtocol.PROTOCOL_V2
          && intentMeta && intentMeta.factualTask
          && scopedCalls.some((call) => call && call.result && call.result.needContext === true);
        if (missingContextEvidence) {
          const errors = (base.errors || []).filter((error) => error && error.code !== "FACT_TOOL_EVIDENCE_REQUIRED");
          errors.push({ code: "FACT_TOOL_EVIDENCE_REQUIRED" });
          return {
            ok: false,
            errors,
            evidenceComplete: false,
          };
        }
        if (verifyPlan && Number(verifyPlan.replanCount || 0) > 0 && !base.evidenceComplete) {
          const errors = (base.errors || []).slice();
          if (!errors.some((e) => e.code === "FACT_TOOL_EVIDENCE_REQUIRED")) {
            if (intentMeta && intentMeta.factualTask) {
              errors.push({ code: "FACT_TOOL_EVIDENCE_REQUIRED" });
            }
          }
          return {
            ok: false,
            errors,
            evidenceComplete: false,
          };
        }
        return base;
      },
    });

    this.emit(input, {
      type: "result.verifying",
      intentName: String(intent && intent.name || "").slice(0, 80),
      status: "verifying",
    });

    const plan = loop.plan || { steps: [] };
    const execution = loop.execution || { toolCalls: [], steps: [] };
    const verification = loop.verification || { ok: true, errors: [], evidenceComplete: true };
    const observations = loop.observations || execution.toolCalls.map(toObservation);

    return {
      runId: input.runId || agentProtocol.createRunId(),
      requestId: input.requestId || agentProtocol.createRequestId(),
      conversationId: String(input.conversationId || context.conversationId || "").slice(0, 80),
      runtimeDecision,
      runtimeMode,
      message,
      context,
      intent,
      confidence: Number(intent && intent.confidence || plan.confidence || 0) || 0,
      slots,
      skill,
      initialPlan: loop.initialPlan && loop.initialPlan.steps || [],
      plan: plan.steps || plan,
      structuredPlan: plan,
      steps: execution.steps,
      toolCalls: execution.toolCalls,
      observations,
      verification,
      replanUsed: loop.replanUsed === true,
      replanCount: loop.replanCount || 0,
      replanReason: loop.replanReason || "",
      partialCompletion: loop.partialCompletion === true,
      goalContract: loop.goalContract || null,
      reusedToolCount: loop.reusedToolCount || 0,
      avoidedDuplicateCalls: loop.avoidedDuplicateCalls || 0,
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
