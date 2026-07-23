/**
 * Observation loop: Plan → Tool → Observation → Verify → Complete | Clarify | Replan
 */

const { MAX_REPLAN } = require("./planSchema");
const { getPlannerPolicy } = require("./plannerPolicy");
const deterministicPlanner = require("./deterministicPlanner");
const modelPlanner = require("./modelPlanner");

function shouldReplan(verification, observations, plan) {
  if (!plan || plan.needsClarification) return false;
  if (Number(plan.replanCount || 0) >= MAX_REPLAN) return false;

  const steps = plan.steps || [];
  // Replan for multi-step campus tasks, empty-room recovery, weather/route soft failures.
  // Still skip pure single-tool "no personal schedule" UX paths.
  const isMultiStep = steps.length > 1
    || plan.intent === "campus_multi_step_advice"
    || plan.intent === "course_action_advice";
  const isEmptyRoomPlan = steps.some((s) => /empty_room/.test(String(s.toolName || "")));
  const isRecoverableCampus = steps.some((s) => /weather|route|empty_room|courses/.test(String(s.toolName || "")));

  if (!isMultiStep && !isEmptyRoomPlan && !isRecoverableCampus) return false;
  if (!isMultiStep && !isEmptyRoomPlan && steps.length === 1 && /get_today|get_tomorrow|get_next/.test(String(steps[0].toolName || ""))) {
    return false;
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

/**
 * Execute full observation loop.
 * options:
 *  - planFn / replanFn overrides
 *  - executePlan(steps) -> { toolCalls, steps }
 *  - verify({ intent, toolCalls, context, runtimeMode, skill })
 *  - emit(event)
 */
async function runObservationLoop(input = {}) {
  const runtimeMode = input.runtimeMode || "public";
  const policy = getPlannerPolicy(runtimeMode);
  const planner = selectPlanner(runtimeMode);
  const planFn = input.planFn || ((args) => planner.plan(args));
  const replanFn = input.replanFn || ((args) => planner.replan(args));
  const startedAt = Date.now();

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

  if (typeof input.emit === "function") {
    input.emit({ type: "plan.created", plannerType: plan.plannerType, stepCount: (plan.steps || []).length });
  }

  if (plan.needsClarification && (!plan.steps || !plan.steps.length || plan.steps[0].toolName === "clarify_missing_slot")) {
    // still execute clarify tool if present
  }

  let execution = { toolCalls: [], steps: [] };
  if (plan.steps && plan.steps.length && typeof input.executePlan === "function") {
    execution = await input.executePlan(plan.steps, { plan, runtimeMode });
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

  let replanUsed = false;
  let replanCount = Number(plan.replanCount || 0) || 0;
  // Up to MAX_REPLAN (2) recovery attempts — never infinite.
  while (
    replanCount < MAX_REPLAN
    && shouldReplan(verification, observations, Object.assign({}, plan, { replanCount }))
    && (Date.now() - startedAt) < policy.totalRunTimeoutMs
  ) {
    if (typeof input.emit === "function") {
      input.emit({ type: "plan.replan", reason: "empty_or_failed_observation", replanCount: replanCount + 1 });
    }
    const nextPlan = await replanFn({
      message: input.message,
      runtimeMode,
      intent: input.intent,
      previousPlan: Object.assign({}, plan, { replanCount }),
      previousObservations: observations,
      skill: input.skill,
      context: input.context,
      conversationState: input.conversationState,
      availableTools: input.availableTools,
      availableSkills: input.availableSkills,
      modelGenerate: input.modelGenerate,
    });
    replanUsed = true;
    replanCount += 1;
    plan = Object.assign({}, nextPlan, {
      replanCount: Math.max(replanCount, Number(nextPlan.replanCount || 0) || 0),
    });
    if (plan.steps && plan.steps.length && typeof input.executePlan === "function") {
      const reExec = await input.executePlan(plan.steps, { plan, runtimeMode, isReplan: true });
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
    } else {
      break;
    }
  }

  return {
    plan,
    execution,
    observations,
    verification,
    replanUsed,
    replanCount,
    durationMs: Date.now() - startedAt,
    stopCondition: plan.stopCondition || "all_steps_done",
  };
}

module.exports = {
  runObservationLoop,
  shouldReplan,
  selectPlanner,
};
