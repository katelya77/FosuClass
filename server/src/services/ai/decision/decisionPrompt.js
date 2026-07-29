const safetyGuard = require("../safetyGuard");

function safeText(value, maxLength) {
  return safetyGuard.redactSensitiveText(String(value == null ? "" : value))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeRecentMessages(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-10)
    .map((item) => ({ role: item.role, content: safeText(item.content, 360) }))
    .filter((item) => item.content);
}

function safeWorkingState(conversationState = {}) {
  const state = conversationState.workingMemory || {};
  const pending = conversationState.pendingClarification || state.pendingClarification || null;
  return {
    activeGoal: safeText(state.activeGoal || state.currentGoal, 80),
    lastEntityType: safeText(state.lastEntityType, 32),
    lastEntity: safeText(state.lastEntity, 120),
    lastConstraints: state.lastConstraints && typeof state.lastConstraints === "object"
      ? safetyGuard.sanitizeAgentContext(state.lastConstraints)
      : {},
    pendingClarification: pending ? {
      intentName: safeText(pending.intentName, 80),
      type: safeText(pending.type, 32),
      missing: safeText(pending.missing, 48),
    } : null,
  };
}

function buildDecisionMessages(input = {}) {
  const allowedSkills = (Array.isArray(input.allowedSkills) ? input.allowedSkills : []).map((skill) => ({
    id: String(skill.id || "").slice(0, 120),
    supportedGoals: (Array.isArray(skill.supportedGoals) ? skill.supportedGoals : []).map(String).slice(0, 16),
    description: safeText(skill.description, 240),
  }));
  const system = [
    "You are the semantic Decision layer of a configurable task-agent platform.",
    "Return exactly one strict DecisionContract V2 JSON object and no markdown or explanation.",
    "The exact root fields are schemaVersion, goal, entities, constraints, skillCandidates, plan, responseMode.",
    "schemaVersion must be decision.v2.",
    "Select only exact Skill ids from allowedSkills. Every selected Skill must support the selected goal.",
    "Never invent executable capability names, routes, commands, credentials, hidden reasoning, or internal locations.",
    "entities items contain exactly type, value, source; source is user, context, memory, or clarification.",
    "skillCandidates items contain exactly skillId and confidence.",
    "plan contains only steps; each step contains exactly id, skillId, purpose and references a candidate Skill.",
    "responseMode is deterministic, natural_language, or none.",
    "Use constraints only for explicit entity/date/week/campus/term/query constraints and omit unknown values.",
  ].join(" ");
  const user = JSON.stringify({
    message: safeText(input.message, 1200),
    allowedSkills,
    recentMessages: safeRecentMessages(input.conversationState && input.conversationState.recentMessages),
    conversationSummary: safeText(input.conversationState && input.conversationState.conversationSummary, 600),
    workingState: safeWorkingState(input.conversationState),
    pageContext: {
      currentPage: safeText(input.context && input.context.currentPage, 100),
      date: safeText(input.context && (input.context.todayDate || input.context.clientLocalTime), 40),
      teachingWeek: Number(input.context && input.context.currentTeachingWeek) || null,
      term: safeText(input.context && input.context.term, 80),
    },
  });
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

module.exports = {
  buildDecisionMessages,
};
