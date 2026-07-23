/**
 * Thread memory: recent desensitized turns + semantic summary + working state.
 */

const safetyGuard = require("../safetyGuard");
const {
  MAX_RECENT_TURNS,
  normalizeRecentTurn,
  safeText,
  nowIso,
} = require("../conversation/conversationSchema");
const { summarizeWorkingMemory, normalizeWorkingMemory } = require("./workingMemory");
const { buildConversationSummary } = require("../conversation/conversationSummaryService");

const DEFAULT_WINDOW = 10;
const MIN_WINDOW = 8;
const MAX_WINDOW = 12;

function clampWindow(n) {
  const v = Number(n) || DEFAULT_WINDOW;
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, v));
}

function desensitizeTurns(turns = [], limit = DEFAULT_WINDOW) {
  const max = clampWindow(limit);
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => normalizeRecentTurn(turn))
    .filter((turn) => turn.text)
    .slice(-max);
}

/**
 * Semantic summary beyond Intent/Target/Week template.
 */
function buildSemanticSummary(input = {}) {
  const working = normalizeWorkingMemory(input.workingMemory || {});
  const parts = [];

  const goal = safeText(input.intentName || working.currentGoal || "", 80);
  if (goal) parts.push(`用户正在：${goal}`);

  const confirmed = summarizeWorkingMemory(working);
  if (confirmed) parts.push(`已确认：${confirmed}`);

  if (Array.isArray(input.completedTools) && input.completedTools.length) {
    parts.push(`已完成工具：${input.completedTools.slice(-6).join("、")}`);
  } else if (working.executedTools.length) {
    parts.push(`已完成工具：${working.executedTools.slice(-6).join("、")}`);
  }

  if (working.lastRecommendation && working.lastRecommendation.summary) {
    parts.push(`当前结果：${working.lastRecommendation.summary}`);
  } else if (input.resultSummary) {
    parts.push(`当前结果：${safeText(input.resultSummary, 100)}`);
  }

  if (working.pendingClarification) {
    parts.push(`还缺少：${safeText(working.pendingClarification.missing || working.pendingClarification.type, 60)}`);
  } else if (Array.isArray(working.incompleteSteps) && working.incompleteSteps.length) {
    parts.push(`未完成：${working.incompleteSteps.slice(0, 3).join("、")}`);
  }

  if (Array.isArray(input.corrections) && input.corrections.length) {
    parts.push(`用户纠正：${input.corrections.slice(0, 3).map((c) => safeText(c, 40)).join("、")}`);
  }

  if (!parts.length) {
    // Fallback to legacy template for empty turns
    return buildConversationSummary({
      intent: input.intentName,
      targetName: working.className || working.teacherName || working.courseName,
      week: working.teachingWeek,
      weekday: working.weekday,
      toolSource: working.executedTools[working.executedTools.length - 1] || "",
    });
  }
  return safeText(parts.join("。") + "。", 240);
}

function mergeRecentTurns(previousTurns, userMessage, assistantAnswer, intentName) {
  const turns = desensitizeTurns(previousTurns, MAX_RECENT_TURNS);
  if (userMessage) {
    turns.push(normalizeRecentTurn({
      role: "user",
      text: safetyGuard.redactSensitiveText(String(userMessage)).slice(0, 400),
      intent: intentName,
      at: nowIso(),
    }));
  }
  if (assistantAnswer) {
    turns.push(normalizeRecentTurn({
      role: "assistant",
      text: safetyGuard.redactSensitiveText(String(assistantAnswer)).slice(0, 400),
      intent: intentName,
      at: nowIso(),
    }));
  }
  return turns.slice(-MAX_RECENT_TURNS);
}

function turnsToRecentMessages(turns = []) {
  return desensitizeTurns(turns, MAX_WINDOW).map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));
}

module.exports = {
  DEFAULT_WINDOW,
  MIN_WINDOW,
  MAX_WINDOW,
  clampWindow,
  desensitizeTurns,
  buildSemanticSummary,
  mergeRecentTurns,
  turnsToRecentMessages,
};
