/**
 * Unified AgentRunState + bounded loop helpers (Pi-inspired, progressive).
 * Does not replace agentKernel; provides transformContext / beforeToolCall /
 * afterToolCall / entity-type lock helpers used by the observation path.
 */

const safetyGuard = require("./safetyGuard");
const contextCompressor = require("./context/contextCompressor");

const DEFAULT_MAX_TURNS = 5;
const DEFAULT_TOTAL_TIMEOUT_MS = 45000;
const DEFAULT_TOOL_TIMEOUT_MS = 12000;

function createAgentRunState(input = {}) {
  return {
    threadId: String(input.conversationId || input.threadId || "").slice(0, 120),
    runId: String(input.runId || input.requestId || "").slice(0, 120),
    messages: Array.isArray(input.messages) ? input.messages.slice(-12) : [],
    currentGoal: input.currentGoal || null,
    selectedSkill: input.selectedSkill || null,
    plan: input.plan || null,
    pendingToolCalls: [],
    observations: [],
    status: "idle",
    error: null,
    abortSignal: input.abortSignal || null,
    lockedEntityType: String(input.lockedEntityType || "").slice(0, 24),
    turn: 0,
    maxTurns: Math.max(1, Math.min(6, Number(input.maxTurns || DEFAULT_MAX_TURNS) || DEFAULT_MAX_TURNS)),
    startedAt: Date.now(),
    totalTimeoutMs: Number(input.totalTimeoutMs || DEFAULT_TOTAL_TIMEOUT_MS) || DEFAULT_TOTAL_TIMEOUT_MS,
    toolTimeoutMs: Number(input.toolTimeoutMs || DEFAULT_TOOL_TIMEOUT_MS) || DEFAULT_TOOL_TIMEOUT_MS,
  };
}

function isAborted(state) {
  return Boolean(state && state.abortSignal && state.abortSignal.aborted);
}

function isTimedOut(state) {
  if (!state) return false;
  return Date.now() - Number(state.startedAt || 0) > Number(state.totalTimeoutMs || DEFAULT_TOTAL_TIMEOUT_MS);
}

function canContinue(state) {
  if (!state) return false;
  if (state.status === "completed" || state.status === "failed" || state.status === "aborted") return false;
  if (isAborted(state)) return false;
  if (isTimedOut(state)) return false;
  if (Number(state.turn || 0) >= Number(state.maxTurns || DEFAULT_MAX_TURNS)) return false;
  return true;
}

/**
 * Compress old messages; keep summary, recent messages, slots.
 * Filter cards / UI-private / sensitive fields before model context.
 */
function transformContext(context = {}, options = {}) {
  const maxMessages = Number(options.maxMessages || 4) || 4;
  const compressed = contextCompressor.compressMessages(context.messages || context.history || [], maxMessages);
  const slots = contextCompressor.summarizeSlots(context.slots || context.contextSlots || {});
  return {
    messages: compressed.messages,
    conversationSummary: safetyGuard.redactSensitiveText(String(context.conversationSummary || "")).slice(0, 400),
    slotsSummary: slots,
    tokenEstimate: compressed.tokenEstimate,
    compressionUsed: compressed.compressionUsed,
    lockedEntityType: String(context.lockedEntityType || "").slice(0, 24),
    term: String(context.term || "").slice(0, 40),
    releaseVersion: String(context.releaseVersion || "").slice(0, 80),
  };
}

/**
 * Model-safe context: strip cards, UI-private data, sensitive fields.
 */
function convertToModelContext(context = {}, toolResults = []) {
  const base = transformContext(context);
  return {
    ...base,
    toolResults: contextCompressor.compressToolResults(toolResults),
    // Explicitly omit: cards, actionCommands, raw schedules, tokens, cookies
  };
}

const TOOL_WHITELIST_EXTRA = new Set([
  "search_school_index",
  "get_schedule_detail",
  "set_current_schedule",
  "clarify_missing_slot",
  "search_empty_rooms",
  "get_today_courses",
  "get_tomorrow_courses",
  "get_campus_weather",
  "diagnose_data_status",
  "conversational_help",
  "project_qa",
  "rag_search",
]);

/**
 * beforeToolCall: validate args, permissions, whitelist, entity-type lock.
 * @returns {{ ok: boolean, code?: string, args?: object, message?: string }}
 */
function beforeToolCall(toolName, args = {}, state = {}, allowedTools = null) {
  if (isAborted(state)) {
    return { ok: false, code: "ABORTED", message: "用户已停止，取消后续工具调用" };
  }
  if (isTimedOut(state)) {
    return { ok: false, code: "RUN_TIMEOUT", message: "任务超时，停止后续工具" };
  }
  const name = String(toolName || "").slice(0, 80);
  if (!name) return { ok: false, code: "TOOL_NAME_REQUIRED" };
  if (Array.isArray(allowedTools) && allowedTools.length && !allowedTools.includes(name)) {
    return { ok: false, code: "TOOL_NOT_WHITELISTED", message: `工具 ${name} 不在白名单` };
  }
  if (allowedTools == null && !TOOL_WHITELIST_EXTRA.has(name) && name.indexOf("_") < 0) {
    return { ok: false, code: "TOOL_NOT_WHITELISTED" };
  }

  const nextArgs = Object.assign({}, args || {});
  const locked = String(state.lockedEntityType || nextArgs.lockedEntityType || "").slice(0, 24);
  if (locked && (name === "search_school_index" || name === "get_schedule_detail")) {
    // Entity type lock: never rewrite class→teacher
    if (nextArgs.type && nextArgs.type !== locked) {
      nextArgs.type = locked;
    }
    if (!nextArgs.type) nextArgs.type = locked;
    nextArgs.lockedEntityType = locked;
  }
  return { ok: true, args: nextArgs, lockedEntityType: locked };
}

/**
 * afterToolCall: desensitize, evidence extract, terminate decision.
 */
function afterToolCall(toolName, result = {}, state = {}) {
  const sanitized = safetyGuard.sanitizeToolResult
    ? safetyGuard.sanitizeToolResult(result)
    : result;
  const success = sanitized && sanitized.success !== false;
  const observation = {
    tool: String(toolName || "").slice(0, 80),
    status: success ? "success" : "failed",
    code: String(sanitized && sanitized.code || "").slice(0, 80),
    summary: safetyGuard.redactSensitiveText(String(sanitized && (sanitized.summary || sanitized.message) || "")).slice(0, 160),
    factCount: Math.max(0, Number(sanitized && (sanitized.total || sanitized.courseCount || (Array.isArray(sanitized.items) ? sanitized.items.length : 0)) || 0) || 0),
    lockedEntityType: String(state.lockedEntityType || sanitized && sanitized.lockedEntityType || "").slice(0, 24),
  };
  // terminate when clarify needed or open_schedule unique detail ready
  let terminate = false;
  if (toolName === "clarify_missing_slot") terminate = true;
  if (toolName === "get_schedule_detail" && success && state.currentGoal && state.currentGoal.goal === "open_schedule") {
    terminate = true;
  }
  if (toolName === "set_current_schedule" && success) terminate = true;
  return { observation, result: sanitized, terminate, retryable: !success && /TIMEOUT|UNAVAILABLE|5\d\d|rate/i.test(observation.code) };
}

/**
 * Independent tools may run in parallel; dependent tools stay serial.
 * Example: weather + empty_room parallel; search → detail serial.
 */
function partitionToolSteps(steps = []) {
  const list = Array.isArray(steps) ? steps : [];
  const serialChains = [];
  const parallelPool = [];
  const detailDependsOnSearch = new Set(["get_schedule_detail"]);
  list.forEach((step) => {
    const name = step.toolName || step.name;
    if (detailDependsOnSearch.has(name)) {
      serialChains.push(step);
    } else if (/weather|empty_room|search_campus|get_teaching_week/i.test(name)) {
      parallelPool.push(step);
    } else {
      serialChains.push(step);
    }
  });
  return { serial: serialChains, parallel: parallelPool };
}

function lockEntityType(state, entityType) {
  if (!state || !entityType) return state;
  const next = String(entityType).slice(0, 24);
  // Never overwrite confirmed lock with a different type
  if (state.lockedEntityType && state.lockedEntityType !== next) {
    return state;
  }
  state.lockedEntityType = next;
  return state;
}

module.exports = {
  DEFAULT_MAX_TURNS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  DEFAULT_TOOL_TIMEOUT_MS,
  createAgentRunState,
  isAborted,
  isTimedOut,
  canContinue,
  transformContext,
  convertToModelContext,
  beforeToolCall,
  afterToolCall,
  partitionToolSteps,
  lockEntityType,
};
