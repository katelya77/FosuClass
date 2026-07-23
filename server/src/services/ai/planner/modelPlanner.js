/**
 * Constrained model planner for trial/dev only.
 * Falls back to deterministicPlanner on any validation or provider failure.
 * Does not expose hidden reasoning; only structured JSON plan.
 */

const capabilityManifestService = require("../capabilityManifestService");
const safetyGuard = require("../safetyGuard");
const deterministicPlanner = require("./deterministicPlanner");
const { normalizePlan } = require("./planSchema");
const { validatePlan } = require("./planValidator");
const { getPlannerPolicy, reasonCodeForTool } = require("./plannerPolicy");
const { buildPlannerContext } = require("../context/plannerContextBuilder");

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    // try fenced block
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (_) {
      // continue
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }
  return null;
}

function buildPlannerPrompt(input = {}) {
  // Prefer budgeted ContextAssembler; keep legacy flat string as fallback.
  try {
    const ctx = buildPlannerContext({
      message: input.message,
      runtimeMode: input.runtimeMode,
      intent: input.intent,
      slots: input.slots || (input.intent && input.intent.slots) || {},
      availableTools: input.availableTools,
      previousObservations: input.previousObservations,
      context: input.context,
      term: input.context && input.context.term,
      currentTeachingWeek: input.context && input.context.currentTeachingWeek,
      clientLocalTime: input.context && (input.context.clientLocalTime || input.context.todayDate),
      currentPage: input.context && input.context.currentPage,
      conversationSummary: (input.conversationState && (
        input.conversationState.conversationSummary || input.conversationState.summary
      )) || input.conversationSummary || (input.context && input.context.conversationSummary) || "",
      workingMemory: (input.conversationState && input.conversationState.workingMemory)
        || input.workingMemory
        || (input.context && input.context.workingMemory),
      userMemories: (input.conversationState && input.conversationState.userMemories)
        || input.userMemories
        || (input.context && input.context.userMemories)
        || [],
      recentMessages: (input.conversationState && input.conversationState.recentMessages)
        || input.recentMessages
        || (input.context && input.context.recentMessages)
        || [],
    });
    return {
      text: ctx.userContent,
      system: ctx.system,
      contextMeta: {
        contextTokenEstimate: ctx.contextTokenEstimate,
        contextSections: ctx.sections,
        truncatedSections: ctx.truncatedSections,
        compressionUsed: ctx.compressionUsed,
      },
    };
  } catch (_) {
    const tools = (input.availableTools || []).slice(0, 40).join(", ");
    const skills = (input.availableSkills || []).slice(0, 40).join(", ");
    const observations = Array.isArray(input.previousObservations)
      ? input.previousObservations.slice(0, 8).map((o) => ({
        tool: o.tool,
        status: o.status,
        factCount: o.factCount,
        code: o.code,
        summary: String(o.summary || "").slice(0, 80),
      }))
      : [];
    const text = [
      "You are a constrained campus task planner for FosuClass.",
      "Return ONLY a JSON object with fields: goal, intent, confidence, slots, needsClarification, clarification, steps, stopCondition.",
      "steps[].toolName must be from the whitelist. Max 5 steps. reasonCode must be an enum.",
      "Never invent campus facts. Never call admin or database tools. Never include chain-of-thought.",
      `runtimeMode: ${input.runtimeMode}`,
      `intent: ${input.intent && input.intent.name || ""}`,
      `slots: ${JSON.stringify(input.slots || input.intent && input.intent.slots || {})}`,
      `availableTools: ${tools}`,
      `availableSkills: ${skills}`,
      `previousObservations: ${JSON.stringify(observations)}`,
      `userMessage: ${safetyGuard.redactSensitiveText(String(input.message || "")).slice(0, 500)}`,
    ].join("\n");
    return { text, system: "Return only valid JSON plan. No markdown commentary.", contextMeta: null };
  }
}

/**
 * Optional provider adapter: options.modelGenerate({ messages }) -> { content }
 * If absent or fails, deterministic fallback is used.
 */
async function plan(input = {}) {
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
  const policy = getPlannerPolicy(runtimeMode);
  if (runtimeMode === "public" || !policy.useModelPlanner) {
    return deterministicPlanner.plan(input);
  }

  const fallback = () => {
    const planResult = deterministicPlanner.plan(input);
    planResult.plannerType = "deterministic_fallback";
    return planResult;
  };

  if (typeof input.modelGenerate !== "function") {
    return fallback();
  }

  try {
    const skill = input.skill;
    const allowedTools = Array.from(new Set(
      (input.availableTools || skill && skill.allowedTools || [])
        .concat(["rag_search", "clarify_missing_slot", "get_today_courses", "get_tomorrow_courses",
          "search_empty_rooms", "search_continuous_empty_rooms", "get_campus_weather", "search_campus_place"])
    ));
    const prompt = buildPlannerPrompt({
      ...input,
      availableTools: allowedTools,
      availableSkills: input.availableSkills || (skill ? [skill.id] : []),
    });
    const promptText = typeof prompt === "string" ? prompt : prompt.text;
    const systemText = typeof prompt === "string"
      ? "Return only valid JSON plan. No markdown commentary."
      : (prompt.system || "Return only valid JSON plan. No markdown commentary.");
    const result = await input.modelGenerate({
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: promptText },
      ],
      maxTokens: 800,
    });
    const parsed = extractJsonObject(result && (result.content || result.text || result.answer));
    if (!parsed) return fallback();

    const steps = Array.isArray(parsed.steps) ? parsed.steps.map((step, index) => ({
      id: step.id || `step-${index + 1}`,
      skillId: step.skillId || (skill && skill.id) || "",
      toolName: step.toolName || step.name,
      args: step.args || {},
      reasonCode: step.reasonCode || reasonCodeForTool(step.toolName || step.name),
      dependsOn: step.dependsOn || [],
      stopOnFailure: step.stopOnFailure !== false,
    })) : [];

    const plan = validatePlan(normalizePlan({
      ...parsed,
      steps,
      plannerType: "model",
      intent: parsed.intent || (input.intent && input.intent.name) || "",
    }), {
      runtimeMode,
      skill,
      allowedTools,
    });
    if (prompt && prompt.contextMeta) {
      plan.contextMeta = prompt.contextMeta;
    }
    if (result && result.provider) {
      plan.plannerProvider = result.provider;
      plan.plannerLatencyMs = result.latencyMs || 0;
    }
    return plan;
  } catch (error) {
    return fallback();
  }
}

async function replan(input = {}) {
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
  if (runtimeMode === "public") {
    return deterministicPlanner.replan(input);
  }
  try {
    const next = await plan({
      ...input,
      previousObservations: input.previousObservations,
      message: input.message,
      intent: input.intent,
    });
    next.replanCount = Math.max(1, Number(input.previousPlan && input.previousPlan.replanCount || 0) + 1);
    next.plannerType = next.plannerType === "model" ? "model_replan" : next.plannerType;
    return next;
  } catch (error) {
    return deterministicPlanner.replan(input);
  }
}

module.exports = {
  plan,
  replan,
  extractJsonObject,
  buildPlannerPrompt,
};
