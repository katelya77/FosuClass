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
const MAX_ROLLING_SUMMARY = 1200;
// Spec alias (p3-acceptance M3): the rolling-summary budget is frozen at 1200.
const MAX_ROLLING_SUMMARY_CHARS = MAX_ROLLING_SUMMARY;
const STABLE_FACT_LIMIT = 20;
const TOOL_TRAIL_LIMIT = 6;
const RECENT_CONTEXT_LIMIT = 2;
const MAX_TOOL_ENTRY_CHARS = 100;
const MAX_TOOL_CONCLUSION_CHARS = 60;
const WEATHER_FACT_PATTERN = /(weather|forecast|temperature|precipitation)/i;
const AUTHORITATIVE_FACT_PATTERN = /(course|schedule|classroom|empty_room|teacher|teaching_week|campus_map)/i;
const RAW_TOOL_RESULT_PATTERN = /^\s*[\[{](?=[\s\S]{10,}$)(?=[\s\S]*"(?:success|data|items|toolCalls|observations|result)"\s*:)/i;

// System-generated placeholders stay in natural Chinese; real English course
// names / proper nouns / user originals are never rewritten by these branches.
const RAW_TOOL_RESULT_PLACEHOLDER = "[原始工具结果未保留]";
const SCHEDULE_SNAPSHOT_PLACEHOLDER = "[课表快照未保留，将由权威工具重新查询]";
const WEATHER_RESULT_PLACEHOLDER = "[天气结果具有时效性，未保留]";
const AUTHORITATIVE_FACT_PLACEHOLDER = "[权威校园事实结果未保留，将由工具重新查询]";

const TOOL_STATUS_LABELS = {
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  degraded: "已降级",
  completed: "已完成",
};
const PENDING_ACTION_OPEN_STATUSES = ["awaiting_receipt", "awaiting_confirmation", "pending", "open", "requested"];
const PENDING_ACTION_CLOSED_STATUSES = ["completed", "cancelled", "canceled", "expired", "failed", "resolved", "done"];

function looksLikeScheduleSnapshot(value) {
  const text = String(value || "");
  const lineCount = text.split(/\r?\n/).filter(Boolean).length;
  if (text.length < 120 && lineCount < 4) return false;
  const scheduleSignals = [
    /星期[一-日]/g,
    /周[一二三四五六日]/g,
    /第\s*\d{1,2}\s*(?:-|至|~)?\s*\d{0,2}\s*节/g,
    /(?:课程|教室|上课时间)/g,
  ].reduce((count, pattern) => count + (text.match(pattern) || []).length, 0);
  return scheduleSignals >= 3 || (lineCount >= 4 && scheduleSignals >= 2);
}

function durableFactClass(input = {}) {
  const tools = (Array.isArray(input.toolNames) ? input.toolNames : [])
    .map(String).join(" ");
  const intent = String(input.intentName || "");
  const identity = `${tools} ${intent}`;
  if (WEATHER_FACT_PATTERN.test(identity)) return "weather";
  if (AUTHORITATIVE_FACT_PATTERN.test(identity)) return "authoritative_fact";
  return "general";
}

function sanitizeDurableTurnText(value, input = {}) {
  const rawText = String(value == null ? "" : value).trim();
  const role = input.role === "assistant" ? "assistant" : "user";
  if (role === "assistant" && RAW_TOOL_RESULT_PATTERN.test(rawText)) {
    return RAW_TOOL_RESULT_PLACEHOLDER;
  }
  const text = safetyGuard.redactSensitiveText(rawText).trim();
  if (!text) return "";
  const factClass = durableFactClass(input);
  if (looksLikeScheduleSnapshot(text)) {
    return SCHEDULE_SNAPSHOT_PLACEHOLDER;
  }
  if (role === "assistant" && factClass === "weather") {
    return WEATHER_RESULT_PLACEHOLDER;
  }
  if (role === "assistant" && factClass === "authoritative_fact") {
    return AUTHORITATIVE_FACT_PLACEHOLDER;
  }
  return text.slice(0, 400);
}

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

function factKey(value) {
  const match = String(value || "").match(/^\s*([A-Za-z][A-Za-z0-9_.-]{0,39})\s*=/);
  return match ? match[1] : "";
}

function isExpiredAt(expiresAt, now) {
  const ts = Number(expiresAt);
  return Number.isFinite(ts) && ts > 0 && ts <= now;
}

/**
 * Minimal tool-trajectory hygiene: conclusions/refs are short verbatim-safe
 * fragments only — never raw responses, schedule snapshots, hidden reasoning,
 * prompts, credentials, or intermediate args.
 */
function sanitizeToolConclusion(value) {
  const text = safetyGuard.redactSensitiveText(String(value == null ? "" : value)).trim();
  if (!text) return "";
  if (RAW_TOOL_RESULT_PATTERN.test(text)) return "";
  if (looksLikeScheduleSnapshot(text)) return "";
  return text.slice(0, MAX_TOOL_CONCLUSION_CHARS);
}

function normalizeToolStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return "completed";
  if (/cancel/.test(status)) return "cancelled";
  if (/fail|error/.test(status)) return "failed";
  if (/degrad|partial|fallback/.test(status)) return "degraded";
  if (/skip/.test(status)) return "skipped";
  if (/success|succeed|^ok$|done|complete/.test(status)) return "succeeded";
  return "completed";
}

/**
 * completed !== verified: an entry only earns the verified conclusion when the
 * turn's verification summary itself is ok === true. A failed verification
 * downgrades claimed execution success to plain completed.
 */
function normalizeCompletedToolEntry(entry, verificationOk) {
  const source = typeof entry === "string"
    ? { name: entry }
    : (entry && typeof entry === "object" ? entry : {});
  const name = safeText(source.name || source.tool || "", 60).trim();
  if (!name) return null;
  let status = normalizeToolStatus(source.status);
  // A skipped tool never ran — it leaves no trajectory entry at all.
  if (status === "skipped") return null;
  const verified = verificationOk === true && source.verified === true;
  if (verificationOk === false && status === "succeeded") status = "completed";
  const conclusion = verified ? sanitizeToolConclusion(source.conclusion || source.summary || "") : "";
  const refs = (Array.isArray(source.entityRefs) ? source.entityRefs : [])
    .map((item) => safeText(item, 40)).filter(Boolean).slice(0, 3);
  let text = `${name}${TOOL_STATUS_LABELS[status] || TOOL_STATUS_LABELS.completed}`;
  if (refs.length) text += `［${refs.join("、")}］`;
  if (conclusion) text += `（已核验：${conclusion}）`;
  return { name, status, verified, text: safeText(text, MAX_TOOL_ENTRY_CHARS) };
}

function toolEntryName(entryText) {
  const match = String(entryText || "").match(/^(.*?)(?:成功|失败|已取消|已降级|已完成)/);
  return (match ? match[1] : String(entryText || "")).trim();
}

function normalizeVerificationSummary(raw) {
  if (raw == null || typeof raw !== "object") return null;
  return {
    ok: raw.ok === true ? true : (raw.ok === false ? false : null),
    status: safeText(raw.status || "", 24),
    brief: sanitizeToolConclusion(raw.brief || ""),
  };
}

function normalizePendingClarificationLabel(raw, now) {
  if (raw == null) return "";
  const source = typeof raw === "string" ? { missing: raw } : raw;
  if (typeof source !== "object" || Array.isArray(source)) return "";
  if (isExpiredAt(source.expiresAt, now)) return "";
  return safeText(source.missing || source.type || "", 60).trim();
}

function normalizePendingActionLabel(raw, now) {
  if (raw == null) return "";
  const source = typeof raw === "string" ? { command: raw, status: "awaiting_receipt" } : raw;
  if (typeof source !== "object" || Array.isArray(source)) return "";
  const status = String(source.status || "").trim().toLowerCase();
  // Structured lifecycle only: cancelled/completed/expired/failed receipts are
  // never pending; unknown statuses fail closed (not pending) instead of guessing.
  if (!status || PENDING_ACTION_CLOSED_STATUSES.includes(status)) return "";
  if (!PENDING_ACTION_OPEN_STATUSES.includes(status)) return "";
  if (isExpiredAt(source.expiresAt, now)) return "";
  const command = safeText(source.command || "", 40).trim();
  if (!command) return "";
  const target = source.target && typeof source.target === "object" ? source.target : {};
  const targetName = safeText(source.targetName || target.name || "", 40).trim();
  return targetName ? `${command}（${targetName}）` : command;
}

function hasOwnKey(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Parse a previously rendered rolling summary back into structured buckets.
 * Legacy labels (还缺少/用户正在/当前结果/已完成工具/用户纠正/未完成) written by
 * older revisions are folded into the same buckets — one merge pipeline only.
 */
function parseRollingSummaryBuckets(previousSummary) {
  const buckets = {
    pendingClarification: "",
    pendingAction: "",
    stableFacts: [],
    goal: "",
    outcome: "",
    toolTrail: [],
    recent: [],
  };
  safetyGuard.redactSensitiveText(String(previousSummary || ""))
    .split(/[。\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      if (/^待补充：/.test(part)) buckets.pendingClarification = part.slice(4).trim();
      else if (/^还缺少：/.test(part)) buckets.pendingClarification = part.slice(4).trim();
      else if (/^待处理：/.test(part)) buckets.pendingAction = part.slice(4).trim();
      else if (/^已确认：/.test(part)) {
        part.slice(4).split(/[、；;]/).map((item) => item.trim()).filter(Boolean)
          .forEach((item) => buckets.stableFacts.push(item));
      } else if (/^用户纠正：/.test(part)) {
        part.slice(5).split(/[、；;]/).map((item) => item.trim()).filter(Boolean)
          .forEach((item) => buckets.stableFacts.push(item));
      } else if (/^当前目标：/.test(part)) buckets.goal = part.slice(5).trim();
      else if (/^用户正在：/.test(part)) buckets.goal = part.slice(5).trim();
      else if (/^最近结果：/.test(part)) buckets.outcome = part.slice(5).trim();
      else if (/^当前结果：/.test(part)) buckets.outcome = part.slice(5).trim();
      else if (/^工具轨迹：/.test(part)) {
        part.slice(5).split(/[；;]/).map((item) => item.trim()).filter(Boolean)
          .forEach((item) => buckets.toolTrail.push(item));
      } else if (/^已完成工具：/.test(part)) {
        part.slice(6).split(/[、；;]/).map((item) => item.trim()).filter(Boolean)
          .forEach((item) => buckets.toolTrail.push(item));
      } else {
        buckets.recent.push(part);
      }
    });
  return buckets;
}

function normalizeStableFact(value) {
  return safeText(value, 100).trim();
}

function supersedeKeyOf(value) {
  if (value && typeof value === "object") return safeText(value.key || "", 40).trim();
  return factKey(value) || String(value || "").trim();
}

/**
 * Bounded rolling summary that preserves confirmed facts across long threads.
 *
 * Merge pipeline (single implementation, deterministic):
 *   previousSummary + currentTurnFragments
 *   → dedupe & supersede resolution (keyed replace, explicit supersededFacts)
 *   → pending lifecycle from structured state/ActionReceipt (never NL guessing)
 *   → priority-ordered segments within MAX_ROLLING_SUMMARY_CHARS:
 *       unresolved clarification/action > corrected stable facts > working
 *       state/goal > verified tool conclusions > recent context > droppable
 *       historical duplicates.
 *
 * Legacy callers ({ confirmedFacts, corrections, goal, outcomeSummary }) are
 * normalized into the same fragment shape; no second summary builder exists.
 */
function mergeRollingSummary(previousSummary = "", input = {}) {
  const now = Date.now();
  const fragments = input.currentTurnFragments && typeof input.currentTurnFragments === "object"
    ? input.currentTurnFragments
    : {
      // Legacy compatibility: map the old free-form fields onto fragments.
      stableFacts: (Array.isArray(input.confirmedFacts) ? input.confirmedFacts : [])
        .concat(Array.isArray(input.corrections) ? input.corrections : []),
      workingStateDelta: { goal: input.goal, outcomeSummary: input.outcomeSummary },
    };
  const verificationSummary = normalizeVerificationSummary(fragments.verificationSummary);
  const verificationOk = verificationSummary ? verificationSummary.ok : null;
  const buckets = parseRollingSummaryBuckets(previousSummary);

  // --- Pending lifecycle (structured state wins; absent key keeps previous) ---
  let pendingClarification = buckets.pendingClarification;
  if (hasOwnKey(fragments, "pendingClarification")) {
    pendingClarification = normalizePendingClarificationLabel(fragments.pendingClarification, now);
  }
  let pendingAction = buckets.pendingAction;
  if (hasOwnKey(fragments, "pendingAction")) {
    pendingAction = normalizePendingActionLabel(fragments.pendingAction, now);
  }

  // --- Stable facts: supersede first, then keyed replace / unkeyed dedupe ---
  const supersededKeys = (Array.isArray(fragments.supersededFacts) ? fragments.supersededFacts : [])
    .map(supersedeKeyOf).filter(Boolean);
  const incomingFacts = (Array.isArray(fragments.stableFacts) ? fragments.stableFacts : [])
    .map(normalizeStableFact).filter(Boolean);
  const factByKey = new Map();
  const unkeyedFacts = [];
  buckets.stableFacts.map(normalizeStableFact).filter(Boolean).forEach((fact) => {
    const key = factKey(fact);
    if (supersededKeys.includes(key || fact)) return; // 被取代的旧事实不得保留
    if (key) factByKey.set(key, fact);
    else if (!unkeyedFacts.includes(fact)) unkeyedFacts.push(fact);
  });
  incomingFacts.forEach((fact) => {
    const key = factKey(fact);
    // 本轮新事实不受 supersede 列表影响：同 key 覆盖即纠正生效（只留 B）。
    if (key) factByKey.set(key, fact);
    else if (!unkeyedFacts.includes(fact)) unkeyedFacts.push(fact);
  });
  let stableFacts = Array.from(factByKey.values()).concat(unkeyedFacts).slice(-STABLE_FACT_LIMIT);

  // --- Tool trajectory: dedupe by tool name, newest status wins ---
  const trailByName = new Map();
  buckets.toolTrail.forEach((text) => {
    const name = toolEntryName(text);
    if (name) trailByName.set(name, safeText(text, MAX_TOOL_ENTRY_CHARS));
  });
  (Array.isArray(fragments.completedTools) ? fragments.completedTools : [])
    .map((entry) => normalizeCompletedToolEntry(entry, verificationOk))
    .filter(Boolean)
    .forEach((entry) => {
      trailByName.set(entry.name, entry.text);
    });
  let toolTrail = Array.from(trailByName.values()).slice(-TOOL_TRAIL_LIMIT);

  // --- Working state delta ---
  const delta = fragments.workingStateDelta && typeof fragments.workingStateDelta === "object"
    ? fragments.workingStateDelta
    : {};
  let goal = buckets.goal;
  if (delta.goal) goal = safeText(delta.goal, 80);
  let outcome = buckets.outcome;
  if (delta.outcomeSummary) outcome = safeText(delta.outcomeSummary, 120);
  let recent = buckets.recent.slice(-RECENT_CONTEXT_LIMIT);
  if (Array.isArray(delta.recentContext) && delta.recentContext.length) {
    recent = recent.concat(
      delta.recentContext.map((item) => safeText(item, 120)).filter(Boolean)
    ).slice(-RECENT_CONTEXT_LIMIT);
  }

  // --- Priority-ordered render within budget ---
  const render = () => {
    const segments = [];
    if (pendingClarification) segments.push(`待补充：${pendingClarification}`);
    if (pendingAction) segments.push(`待处理：${pendingAction}`);
    if (stableFacts.length) segments.push(`已确认：${stableFacts.join("、")}`);
    if (goal) segments.push(`当前目标：${goal}`);
    if (toolTrail.length) segments.push(`工具轨迹：${toolTrail.join("；")}`);
    if (outcome) segments.push(`最近结果：${outcome}`);
    segments.push(...recent);
    return segments.length ? `${segments.join("。")}。` : "";
  };
  // Trim lowest priority first; unresolved pendings are never dropped.
  while (render().length > MAX_ROLLING_SUMMARY) {
    if (recent.length) { recent = recent.slice(1); continue; }
    if (outcome) { outcome = ""; continue; }
    if (toolTrail.length) { toolTrail = toolTrail.slice(1); continue; }
    if (goal) { goal = ""; continue; }
    if (stableFacts.length > 1) { stableFacts = stableFacts.slice(1); continue; }
    break;
  }
  return safeText(render(), MAX_ROLLING_SUMMARY);
}

function deriveVerificationFragment(input = {}) {
  const raw = input.verificationSummary !== undefined ? input.verificationSummary : input.verification;
  if (raw == null || typeof raw !== "object") return null;
  return {
    ok: raw.ok === true ? true : (raw.ok === false ? false : null),
    status: raw.status,
    brief: raw.brief || raw.summary || "",
    perTool: raw.perTool && typeof raw.perTool === "object" ? raw.perTool : null,
  };
}

function deriveCompletedToolFragments(input, working, verification) {
  const rawTools = (Array.isArray(input.completedTools) && input.completedTools.length
    ? input.completedTools
    : working.executedTools.slice(-TOOL_TRAIL_LIMIT));
  const observationsByTool = new Map(
    (Array.isArray(working.lastObservations) ? working.lastObservations : [])
      .map((obs) => [String(obs && (obs.tool || obs.name) || ""), obs])
  );
  const perTool = verification && verification.perTool;
  return rawTools.map((entry) => {
    const source = typeof entry === "object" && entry ? entry : { name: entry };
    const name = String(source.name || source.tool || "").trim();
    const obs = observationsByTool.get(name) || null;
    return {
      name,
      status: source.status || (obs && obs.status)
        || (working.lastSuccessfulTools.includes(name) ? "succeeded" : "completed"),
      verified: source.verified === true
        || Boolean(perTool && name && perTool[name] && perTool[name].ok === true),
      conclusion: source.conclusion || (obs && obs.summary) || "",
      entityRefs: Array.isArray(source.entityRefs) ? source.entityRefs : [],
    };
  }).filter((entry) => entry.name);
}

function deriveStableFactFragments(input, working) {
  const facts = [];
  const confirmed = summarizeWorkingMemory(working);
  if (confirmed) {
    confirmed.split(/[；;]/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
      // Goal and tool usage live in their own segments, not in stable facts.
      if (/^目标\s/.test(part) || /^已用工具\s/.test(part)) return;
      facts.push(part);
    });
  }
  (Array.isArray(input.stableFacts) ? input.stableFacts : [])
    .concat(Array.isArray(input.corrections) ? input.corrections : [])
    .map((item) => safeText(item, 100)).filter(Boolean)
    .forEach((item) => facts.push(item));
  return facts;
}

/**
 * Semantic summary beyond Intent/Target/Week template. Builds the structured
 * currentTurnFragments for this turn from working memory + explicit inputs and
 * delegates the merge to mergeRollingSummary (single summary pipeline).
 */
function buildSemanticSummary(input = {}) {
  const working = normalizeWorkingMemory(input.workingMemory || {});
  const goal = safeText(input.intentName || working.currentGoal || "", 80);
  const verification = deriveVerificationFragment(input);
  const fragments = {
    completedTools: deriveCompletedToolFragments(input, working, verification),
    verificationSummary: verification,
    // Working memory is the authoritative post-turn pending state; the keys are
    // always present so resolved/cleared pendings are removed from the summary.
    pendingClarification: working.pendingClarification || null,
    pendingAction: working.pendingAction || null,
    stableFacts: deriveStableFactFragments(input, working),
    supersededFacts: Array.isArray(input.supersededFacts) ? input.supersededFacts : [],
    workingStateDelta: {
      goal,
      outcomeSummary: (working.lastRecommendation && working.lastRecommendation.summary)
        || safeText(input.resultSummary, 120),
      recentContext: !working.pendingClarification && working.incompleteSteps.length
        ? [`未完成：${working.incompleteSteps.slice(0, 3).join("、")}`]
        : [],
    },
  };
  const hasContent = Boolean(
    fragments.pendingClarification || fragments.pendingAction
    || fragments.stableFacts.length || fragments.completedTools.length
    || fragments.workingStateDelta.goal || fragments.workingStateDelta.outcomeSummary
  );
  if (!input.previousSummary && !hasContent) {
    // Fallback to legacy template for empty turns
    return buildConversationSummary({
      intent: input.intentName,
      targetName: working.className || working.teacherName || working.courseName,
      week: working.teachingWeek,
      weekday: working.weekday,
      toolSource: working.executedTools[working.executedTools.length - 1] || "",
    });
  }
  return mergeRollingSummary(input.previousSummary || "", { currentTurnFragments: fragments });
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
  MAX_ROLLING_SUMMARY,
  MAX_ROLLING_SUMMARY_CHARS,
  clampWindow,
  desensitizeTurns,
  buildSemanticSummary,
  mergeRollingSummary,
  mergeRecentTurns,
  turnsToRecentMessages,
  makeTurnId,
  durableFactClass,
  looksLikeScheduleSnapshot,
  sanitizeDurableTurnText,
};
