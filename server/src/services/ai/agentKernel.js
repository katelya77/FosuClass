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
    // Default: use constrained planner + observation loop.
    // Explicit useToolChain=true keeps legacy tool-chain path for specialized callers.
    this.useToolChain = options.useToolChain === true;
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
    // Union of primary skill tools and Capability Router candidates.
    const allow = new Set((skill && skill.allowedTools) || []);
    if (Array.isArray(allowedToolsOverride)) {
      allowedToolsOverride.forEach((tool) => allow.add(tool));
    }
    plan.forEach((step) => {
      const toolName = String(step.toolName || step.name || "");
      if (!allow.has(toolName)) {
        throw codedError("TOOL_NOT_ALLOWED_FOR_SKILL", `Tool ${toolName} is not allowed for ${skill && skill.id || "route"}`, { toolName });
      }
      if (this.skillRegistry === defaultSkillRegistry && !capabilityManifestService.isToolAllowedForRuntime(toolName, runtimeMode)) {
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
    const pushCall = (toolName, result, label, durationMs = 0) => {
      const failed = !result || result.success === false;
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
      const result = await withTimeout(this.toolExecutor(toolName, item.args || item.input || {}, context), this.toolTimeoutMs);
      const durationMs = Date.now() - started;
      pushCall(toolName, result, item.reason || item.label || `Execute ${toolName}`, durationMs);

      // Preserve tool-chain side observations for recommend / empty-room recovery.
      if (toolName === "recommend_meeting_time" && result && result.emptyRoomResult) {
        pushCall("search_empty_rooms", result.emptyRoomResult, "附带空教室候选", 0);
      }
      if ((toolName === "search_empty_rooms" || toolName === "search_continuous_empty_rooms")
        && result && (result.success === false
          || !(Array.isArray(result.rooms) ? result.rooms.length : Number(result.total || 0)))) {
        const diagnosis = await withTimeout(
          this.toolExecutor("diagnose_data_status", item.args || item.input || {}, context),
          this.toolTimeoutMs
        );
        pushCall("diagnose_data_status", diagnosis, "诊断课表数据状态", 0);
      }
    }
    return { toolCalls: calls, steps };
  }

  async executeToolChain(intent, message, context, skill, input = {}) {
    const planPreview = skill.planBuilder
      ? skill.planBuilder({ message, context, intent, runtimeMode: context.runtimeMode || "public" })
      : [];
    (Array.isArray(planPreview) ? planPreview : []).forEach((item) => {
      const toolName = String(item.toolName || item.name || "");
      if (toolName) {
        this.emit(input, {
          type: "tool.started",
          tool: toolName,
          status: "started",
        });
      }
    });
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
      this.emit(input, {
        type: failed ? "tool.failed" : "tool.completed",
        tool: String(call.name || ""),
        status: failed ? "failed" : "success",
        reasonCode: failed ? String(result.code || "TOOL_FAILED").slice(0, 80) : "",
      });
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

    // Final convergence: constrained planner + observation loop (public stays deterministic).
    // useToolChain remains for backward-compatible tests that inject custom chain executors.
    if (this.useToolChain && !input.forcePlanner) {
      const plan = skill.planBuilder({ message, context, intent, runtimeMode });
      this.validatePlan(skill, plan, runtimeMode);
      const execution = await this.executeToolChain(intent, message, context, skill, input);
      this.emit(input, {
        type: "result.verifying",
        intentName: String(intent && intent.name || "").slice(0, 80),
        status: "verifying",
      });
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
        replanUsed: false,
        evidenceComplete: verification.evidenceComplete === true,
        usedPersonalContext: Boolean(context.currentScheduleSummary && context.currentScheduleSummary.enabled && context.currentScheduleSummary.courses && context.currentScheduleSummary.courses.length),
        startedAt,
        deterministicDurationMs: Date.now() - startedAt,
      };
    }

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

    const loop = await runObservationLoop({
      message,
      runtimeMode,
      intent,
      slots,
      skill,
      context,
      conversationState,
      availableTools: candidateTools,
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
            availableTools: candidateTools,
            availableSkills,
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
          this.validatePlan(skill, fallbackPlan, runtimeMode, candidateTools);
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
          if (structured.intent === "campus_multi_step_advice"
            || structured.plannerType === "deterministic" && structured.steps.length > 1
              && structured.steps.some((s) => !(skill.allowedTools || []).includes(s.toolName))) {
            structured.steps.forEach((step) => {
              if (!capabilityManifestService.isToolAllowedForRuntime(step.toolName, runtimeMode)) {
                throw codedError("TOOL_NOT_ALLOWED_FOR_RUNTIME", `Tool ${step.toolName} not in ${runtimeMode}`);
              }
              // Cross-skill tools must still be inside capability route whitelist.
              if (!candidateTools.includes(step.toolName)
                && !(skill.allowedTools || []).includes(step.toolName)) {
                throw codedError("TOOL_NOT_ALLOWED_FOR_SKILL", `Tool ${step.toolName} not in capability route`);
              }
            });
            if (legacyPlan.length > this.maxPlanSteps) {
              throw codedError("PLAN_STEP_LIMIT_EXCEEDED", `Plan exceeds ${this.maxPlanSteps} steps`);
            }
          } else {
            this.validatePlan(skill, legacyPlan, runtimeMode, candidateTools);
          }
        }
        return structured;
      },
      executePlan: async (steps) => {
        const legacyPlan = (steps || []).map((step) => ({
          toolName: step.toolName,
          args: step.args || {},
          reason: step.reasonCode || step.reason,
        }));
        return this.executePlan(legacyPlan, context, input);
      },
      toObservations: (calls) => (calls || []).map(toObservation),
      verify: ({ toolCalls, plan: verifyPlan }) => {
        const routeAllowed = new Set(candidateTools.concat(skill.allowedTools || []));
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
        if (verifyPlan && Number(verifyPlan.replanCount || 0) > 0 && !base.evidenceComplete) {
          const errors = (base.errors || []).slice();
          if (!errors.some((e) => e.code === "FACT_TOOL_EVIDENCE_REQUIRED")) {
            const intentMeta = capabilityManifestService.getIntent(intent && intent.name);
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
