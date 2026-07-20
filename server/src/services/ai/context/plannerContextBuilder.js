/**
 * Minimal context for model planner — no full schedule, no long chat history.
 */

const safetyGuard = require("../safetyGuard");
const { getBudget, estimateTokens, truncateToBudget } = require("./contextBudget");
const { summarizeSlots, compressObservations } = require("./contextCompressor");
const { buildToolPromptLines } = require("./toolContextBuilder");

const STABLE_PLANNER_RULES = [
  "You plan campus tasks only. Return JSON plan fields: goal, intent, confidence, slots, needsClarification, clarification, steps, stopCondition.",
  "steps[].toolName must be from availableTools. Max 5 steps. Prefer fewest tools that satisfy the goal.",
  "Never invent course/classroom/weather facts. Never output user-facing answers or chain-of-thought.",
  "If personal schedule is missing and needed, prefer clarify or import-help tools instead of fabricating free time.",
  "Do not include secrets, full schedule, openid, or internal URLs.",
].join(" ");

function buildPlannerContext(input = {}) {
  const budget = getBudget("planner");
  const sections = {};
  const truncatedSections = [];

  sections.stable = STABLE_PLANNER_RULES;

  const runtimeParts = [
    `runtimeMode=${input.runtimeMode || "public"}`,
    input.term ? `term=${input.term}` : "",
    input.currentTeachingWeek != null ? `teachingWeek=${input.currentTeachingWeek}` : "",
    input.clientLocalTime || input.todayDate ? `time=${input.clientLocalTime || input.todayDate}` : "",
    input.currentPage ? `page=${String(input.currentPage).slice(0, 40)}` : "",
  ].filter(Boolean).join("; ");
  const runtimeCut = truncateToBudget(runtimeParts, budget.runtime);
  sections.runtime = runtimeCut.text;
  if (runtimeCut.truncated) truncatedSections.push("runtime");

  const hasPersonal = Boolean(
    input.context
    && input.context.currentScheduleSummary
    && input.context.currentScheduleSummary.enabled
    && input.context.currentScheduleSummary.courses
    && input.context.currentScheduleSummary.courses.length
  );
  sections.task = [
    `intent=${(input.intent && input.intent.name) || ""}`,
    `slots={${summarizeSlots(input.slots || (input.intent && input.intent.slots) || {})}}`,
    `personalSchedule=${hasPersonal ? "present_redacted" : "absent"}`,
    `goal=${safetyGuard.redactSensitiveText(String(input.message || "")).slice(0, 300)}`,
  ].join("\n");

  const tools = buildToolPromptLines(input.availableTools || []).join("\n");
  const toolsCut = truncateToBudget(tools, budget.tools);
  sections.tools = toolsCut.text;
  if (toolsCut.truncated) truncatedSections.push("tools");

  const obs = compressObservations(input.previousObservations || []);
  sections.observations = obs.length ? JSON.stringify(obs) : "[]";

  const conversation = input.conversationSummary
    ? truncateToBudget(String(input.conversationSummary), budget.conversation)
    : { text: "", truncated: false };
  sections.conversation = conversation.text;
  if (conversation.truncated) truncatedSections.push("conversation");

  const userMessage = safetyGuard.redactSensitiveText(String(input.message || "")).slice(0, 500);
  const assembled = [
    sections.stable,
    `## Runtime\n${sections.runtime}`,
    `## Task\n${sections.task}`,
    `## Tools\n${sections.tools}`,
    `## PreviousObservations\n${sections.observations}`,
    sections.conversation ? `## ConversationSummary\n${sections.conversation}` : "",
    `## UserMessage\n${userMessage}`,
  ].filter(Boolean).join("\n\n");

  const totalCut = truncateToBudget(assembled, budget.total);
  if (totalCut.truncated) truncatedSections.push("total");

  return {
    system: STABLE_PLANNER_RULES,
    userContent: totalCut.text,
    sections: Object.keys(sections),
    truncatedSections,
    contextTokenEstimate: estimateTokens(totalCut.text),
    compressionUsed: truncatedSections.length > 0,
    hasPersonalSchedule: hasPersonal,
  };
}

module.exports = {
  buildPlannerContext,
  STABLE_PLANNER_RULES,
};
