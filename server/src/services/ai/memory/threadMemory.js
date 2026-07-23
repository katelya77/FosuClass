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

function makeTurnId(role, text, at, intentName) {
  const crypto = require("crypto");
  const base = `${role}|${String(text || "").slice(0, 200)}|${at || ""}|${intentName || ""}`;
  return `t_${crypto.createHash("sha256").update(base).digest("hex").slice(0, 16)}`;
}

/**
 * Merge turns with stable turnId dedupe (not only adjacent text equality).
 */
function mergeRecentTurns(previousTurns, userMessage, assistantAnswer, intentName, options = {}) {
  const turns = desensitizeTurns(previousTurns, MAX_RECENT_TURNS);
  const seen = new Set(turns.map((t) => t.turnId).filter(Boolean));
  const runId = options.runId || "";

  function pushTurn(role, text) {
    if (!text) return;
    const at = nowIso();
    const redacted = safetyGuard.redactSensitiveText(String(text)).slice(0, 400);
    const turnId = options.turnIds && options.turnIds[role]
      || makeTurnId(role, redacted, runId || at, intentName);
    if (seen.has(turnId)) return;
    // Also skip exact same role+text already present (compat for pre-turnId files)
    const duplicate = turns.some((t) => t.role === role && t.text === redacted);
    if (duplicate) return;
    seen.add(turnId);
    turns.push(normalizeRecentTurn({
      role,
      text: redacted,
      intent: intentName,
      at,
      turnId,
    }));
  }

  pushTurn("user", userMessage);
  pushTurn("assistant", assistantAnswer);
  return turns.slice(-MAX_RECENT_TURNS);
}

function turnsToRecentMessages(turns = []) {
  return desensitizeTurns(turns, MAX_WINDOW).map((turn) => ({
    role: turn.role,
    content: turn.text,
    turnId: turn.turnId || "",
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
  makeTurnId,
};
