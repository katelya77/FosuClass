/**
 * Observation loop: Plan → Tool → Observation → Verify → Complete | Clarify | Replan
 * Replan reuses run-scoped tool cache for successful read tools; max MAX_REPLAN (2).
 */

const { MAX_REPLAN } = require("./planSchema");
const { getPlannerPolicy } = require("./plannerPolicy");
const deterministicPlanner = require("./deterministicPlanner");
const modelPlanner = require("./modelPlanner");
const { createToolResultCache, isWriteTool } = require("./toolResultCache");
const { deriveRequiredOutcomes, verifyGoalContract } = require("./goalContract");

function shouldReplan(verification, observations, plan, goalCheck) {
  if (!plan || plan.needsClarification) return false;
  if (Number(plan.replanCount || 0) >= MAX_REPLAN) return false;

  const steps = plan.steps || [];
  const isMultiStep = steps.length > 1
    || plan.intent === "campus_multi_step_advice"
    || plan.intent === "course_action_advice"
    || (Array.isArray(plan.requiredOutcomes) && plan.requiredOutcomes.length >= 2);
  const isEmptyRoomPlan = steps.some((s) => /empty_room/.test(String(s.toolName || "")));
  const isRecoverableCampus = steps.some((s) => /weather|route|empty_room|courses/.test(String(s.toolName || "")));

  if (!isMultiStep && !isEmptyRoomPlan && !isRecoverableCampus) return false;
  if (!isMultiStep && !isEmptyRoomPlan && steps.length === 1 && /get_today|get_tomorrow|get_next/.test(String(steps[0].toolName || ""))) {
    return false;
  }

  if (goalCheck && goalCheck.missing && goalCheck.missing.length) {
    // Only replan when missing outcomes look recoverable
    const recoverableMissing = goalCheck.missing.some((id) => /empty_room|weather|free_time|schedule/.test(id));
    if (recoverableMissing) return true;
  }

  const emptyFacts = (observations || []).filter((obs) => {
    const tool = String(obs.tool || "");
    if (!tool) return false;
    if (obs.status === "failed") return true;
    if (/empty_room/.test(tool) && Number(obs.factCount || 0) === 0) return true;
    if (/weather/.test(tool) && (obs.status === "failed" || /UNAVAILABLE|FAILED/.test(String(obs.code || "")))) return true;
    if (isMultiStep && /courses|schedule/.test(tool)
      && (Number(obs.factCount || 0) === 0
        || /NO_PERSONAL|EMPTY_RESULT|未导入|无个人/.test(String(obs.code || obs.summary || "")))) {
      return true;
    }
    return false;
  });

  if (emptyFacts.length && steps.length) return true;
  if (isEmptyRoomPlan && verification && verification.ok === false) {
    const codes = (verification.errors || []).map((e) => e.code || e).join(",");
    if (/FACT_TOOL_EVIDENCE_REQUIRED|EMPTY/.test(codes)) return true;
  }
  return false;
}

function selectPlanner(runtimeMode) {
  const policy = getPlannerPolicy(runtimeMode);
  if (policy.useModelPlanner) return modelPlanner;
  return deterministicPlanner;
}

function filterStepsForReplan(steps, toolCache, context, principal) {
  const list = Array.isArray(steps) ? steps : [];
  const toRun = [];
  const reused = [];
  list.forEach((step) => {
    const toolName = step.toolName || step.name;
    if (!toolName) return;
    if (isWriteTool(toolName)) {
      // Write tools never auto-repeat on replan if already succeeded.
      const cached = toolCache.get(toolName, step.args || {}, context, principal);
      if (cached) {
        reused.push({ step, call: cached.call, fromCache: true });
        toolCache.markReuse();
        return;
      }
      toRun.push(step);
      return;
    }
    const cached = toolCache.get(toolName, step.args || {}, context, principal);
    if (cached && cached.call) {
      reused.push({ step, call: cached.call, fromCache: true });
      toolCache.markReuse();
      return;
    }
    toRun.push(step);
  });
  return { toRun, reused };
}

/**
 * Execute full observation loop.
 */
async function runObservationLoop(input = {}) {
  const runtimeMode = input.runtimeMode || "public";
  const policy = getPlannerPolicy(runtimeMode);
  const planner = selectPlanner(runtimeMode);
  const planFn = input.planFn || ((args) => planner.plan(args));
  const replanFn = input.replanFn || ((args) => planner.replan(args));
  const toolCache = input.toolCache || createToolResultCache();
  const principal = input.principal || (input.context && input.context.principal) || null;
  const startedAt = Date.now();
  let replanReason = "";
  let partialCompletion = false;

  let plan = await planFn({
    message: input.message,
    runtimeMode,
    intent: input.intent,
    slots: input.slots || (input.intent && input.intent.slots) || {},
    conversationState: input.conversationState,
    availableSkills: input.availableSkills,
    availableTools: input.availableTools,
    previousObservations: input.previousObservations || [],
    skill: input.skill,
    context: input.context,
    modelGenerate: input.modelGenerate,
  });

  // Attach Goal Contract for multi-skill / multi-goal messages
  if (!plan.requiredOutcomes || !plan.requiredOutcomes.length) {
    plan.requiredOutcomes = deriveRequiredOutcomes({
      message: input.message,
      steps: plan.steps,
      requiredOutcomes: plan.requiredOutcomes,
    });
  }

  if (typeof input.emit === "function") {
    input.emit({ type: "plan.created", plannerType: plan.plannerType, stepCount: (plan.steps || []).length });
  }

  async function executeWithCache(steps, meta = {}) {
    const { toRun, reused } = meta.isReplan
      ? filterStepsForReplan(steps, toolCache, input.context || {}, principal)
      : { toRun: steps || [], reused: [] };

    let execution = { toolCalls: [], steps: [] };
    if (toRun.length && typeof input.executePlan === "function") {
      execution = await input.executePlan(toRun, { plan, runtimeMode, isReplan: meta.isReplan === true });
    }
    // Populate cache from new successful reads
    (execution.toolCalls || []).forEach((call, index) => {
      const step = toRun[index] || {};
      toolCache.set(call.name, step.args || call.args || {}, input.context || {}, principal, call);
    });
    // Prepend/append reused calls
    const reusedCalls = reused.map((r) => Object.assign({}, r.call, { reused: true }));
    return {
      toolCalls: reusedCalls.concat(execution.toolCalls || []),
      steps: reused.map((r) => r.step).concat(execution.steps || toRun || []),
      reusedCount: reused.length,
    };
  }

  let execution = { toolCalls: [], steps: [] };
  if (plan.steps && plan.steps.length && typeof input.executePlan === "function") {
    execution = await executeWithCache(plan.steps, { isReplan: false });
  }

  let observations = typeof input.toObservations === "function"
    ? input.toObservations(execution.toolCalls || [])
    : (execution.toolCalls || []).map((call, index) => ({
      id: `observation-${index + 1}`,
      tool: call.name,
      status: call.status,
      code: call.result && call.result.code || "",
      summary: call.summary || "",
      factCount: Number(call.result && (call.result.total || call.result.courseCount) || 0) || 0,
      reused: call.reused === true,
    }));

  let verification = typeof input.verify === "function"
    ? input.verify({
      intent: input.intent,
      toolCalls: execution.toolCalls,
      context: input.context,
      runtimeMode,
      skill: input.skill,
      plan,
    })
    : { ok: true, errors: [], evidenceComplete: true };

  let goalCheck = verifyGoalContract({
    message: input.message,
    requiredOutcomes: plan.requiredOutcomes,
    steps: plan.steps,
    toolCalls: execution.toolCalls,
    observations,
  });
  if (goalCheck.requiredOutcomes && goalCheck.requiredOutcomes.length) {
    plan.requiredOutcomes = goalCheck.requiredOutcomes;
    if (!goalCheck.complete && !goalCheck.partialCompletion) {
      verification = Object.assign({}, verification, {
        goalContract: goalCheck,
        ok: verification.ok !== false ? false : verification.ok,
      });
    } else {
      verification = Object.assign({}, verification, { goalContract: goalCheck });
      partialCompletion = goalCheck.partialCompletion === true;
    }
  }

  let replanUsed = false;
  let replanCount = Number(plan.replanCount || 0) || 0;
  while (
    replanCount < MAX_REPLAN
    && shouldReplan(verification, observations, Object.assign({}, plan, { replanCount }), goalCheck)
    && (Date.now() - startedAt) < policy.totalRunTimeoutMs
  ) {
    replanReason = "empty_or_failed_observation";
    if (goalCheck && goalCheck.missing && goalCheck.missing.length) {
      replanReason = `missing_outcomes:${goalCheck.missing.slice(0, 3).join(",")}`;
    }
    if (typeof input.emit === "function") {
      input.emit({ type: "plan.replan", reason: replanReason, replanCount: replanCount + 1 });
    }
    const nextPlan = await replanFn({
      message: input.message,
      runtimeMode,
      intent: input.intent,
      previousPlan: Object.assign({}, plan, { replanCount, requiredOutcomes: plan.requiredOutcomes }),
      previousObservations: observations,
      skill: input.skill,
      context: input.context,
      conversationState: input.conversationState,
      availableTools: input.availableTools,
      availableSkills: input.availableSkills,
      modelGenerate: input.modelGenerate,
      goalCheck,
    });
    replanUsed = true;
    replanCount += 1;
    plan = Object.assign({}, nextPlan, {
      replanCount: Math.max(replanCount, Number(nextPlan.replanCount || 0) || 0),
      requiredOutcomes: plan.requiredOutcomes || nextPlan.requiredOutcomes,
    });
    if (plan.steps && plan.steps.length && typeof input.executePlan === "function") {
      const reExec = await executeWithCache(plan.steps, { isReplan: true });
      execution = {
        toolCalls: (execution.toolCalls || []).concat(reExec.toolCalls || []),
        steps: (execution.steps || []).concat(reExec.steps || []),
      };
      observations = typeof input.toObservations === "function"
        ? input.toObservations(execution.toolCalls || [])
        : observations.concat((reExec.toolCalls || []).map((call, index) => ({
          id: `observation-replan-${replanCount}-${index + 1}`,
          tool: call.name,
          status: call.status,
          code: call.result && call.result.code || "",
          summary: call.summary || "",
          factCount: Number(call.result && (call.result.total || call.result.courseCount) || 0) || 0,
          reused: call.reused === true,
        })));
      verification = typeof input.verify === "function"
        ? input.verify({
          intent: input.intent,
          toolCalls: execution.toolCalls,
          context: input.context,
          runtimeMode,
          skill: input.skill,
          plan,
        })
        : verification;
      goalCheck = verifyGoalContract({
        message: input.message,
        requiredOutcomes: plan.requiredOutcomes,
        steps: plan.steps,
        toolCalls: execution.toolCalls,
        observations,
      });
      verification = Object.assign({}, verification, { goalContract: goalCheck });
      partialCompletion = goalCheck.partialCompletion === true || partialCompletion;
    } else {
      break;
    }
  }

  const cacheMetrics = toolCache.metrics();
  return {
    plan,
    execution,
    observations,
    verification,
    replanUsed,
    replanCount,
    replanReason: replanUsed ? replanReason : "",
    partialCompletion,
    goalContract: goalCheck,
    reusedToolCount: cacheMetrics.reusedToolCount,
    avoidedDuplicateCalls: cacheMetrics.avoidedDuplicateCalls,
    durationMs: Date.now() - startedAt,
    stopCondition: plan.stopCondition || "all_steps_done",
  };
}

module.exports = {
  runObservationLoop,
  shouldReplan,
  selectPlanner,
  filterStepsForReplan,
};
