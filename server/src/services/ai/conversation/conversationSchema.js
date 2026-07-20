/**
 * Conversation state schema conversation-state.v2
 * Structured, redacted server-side memory only.
 */
const crypto = require("crypto");
const safetyGuard = require("../safetyGuard");

const SCHEMA_VERSION = "conversation-state.v2";
const MEMORY_MODES = Object.freeze(["local_only", "session_state", "cloud_sync"]);
const MAX_RECENT_TURNS = 12;
const MAX_TURN_TEXT = 400;
const MAX_SUMMARY = 240;
const MAX_TITLE = 80;
const MAX_EVIDENCE_REFS = 8;
const CANONICAL_SLOTS = Object.freeze([
  "lastIntent",
  "lastTargetType",
  "lastTargetName",
  "lastWeek",
  "lastWeekday",
  "lastQueryResult",
  "lastSource",
  "term",
  "releaseVersion",
  "campus",
  "classroom",
  "courseName",
  "teacherName",
  "className",
  "type",
  "q",
  "week",
  "weekday",
  "sectionStart",
  "sectionEnd",
]);

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CLOUD_SYNC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_CLARIFICATION_TTL_MS = 5 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function hashConversationId(conversationId) {
  return crypto.createHash("sha256").update(String(conversationId || "")).digest("hex").slice(0, 32);
}

function safeText(value, max = 120) {
  return safetyGuard.redactSensitiveText(String(value == null ? "" : value)).slice(0, max);
}

function normalizeMemoryMode(value, fallback = "local_only") {
  const mode = String(value || "").trim().toLowerCase();
  return MEMORY_MODES.includes(mode) ? mode : fallback;
}

function emptyContextSlots() {
  return {
    lastIntent: "",
    lastTargetType: "",
    lastTargetName: "",
    lastWeek: null,
    lastWeekday: null,
    lastQueryResult: null,
    lastSource: "",
    term: "",
    releaseVersion: "",
    campus: "",
    classroom: "",
    courseName: "",
    teacherName: "",
    className: "",
    type: "",
    q: "",
    week: null,
    weekday: null,
    sectionStart: null,
    sectionEnd: null,
  };
}

function normalizeContextSlots(slots = {}) {
  const source = slots && typeof slots === "object" && !Array.isArray(slots) ? slots : {};
  const output = emptyContextSlots();
  CANONICAL_SLOTS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    const value = source[key];
    if (value === null || value === undefined || value === "") {
      output[key] = ["lastWeek", "lastWeekday", "week", "weekday", "sectionStart", "sectionEnd"].includes(key)
        ? null
        : (key === "lastQueryResult" ? null : "");
      return;
    }
    if (["lastWeek", "lastWeekday", "week", "weekday", "sectionStart", "sectionEnd"].includes(key)) {
      const number = Number(value);
      output[key] = Number.isFinite(number) ? number : null;
      return;
    }
    if (key === "lastQueryResult") {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        output[key] = {
          summary: safeText(value.summary || value.title || "", 120),
          count: Math.max(0, Number(value.count || value.total || 0) || 0),
        };
      } else {
        output[key] = null;
      }
      return;
    }
    output[key] = safeText(value, key === "lastTargetName" || key === "q" ? 120 : 80);
  });
  return output;
}

function normalizePendingClarification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const createdAt = Number(value.createdAt || Date.now()) || Date.now();
  const expiresAt = Number(value.expiresAt || createdAt + PENDING_CLARIFICATION_TTL_MS)
    || (createdAt + PENDING_CLARIFICATION_TTL_MS);
  if (expiresAt <= Date.now()) return null;
  return {
    intentName: safeText(value.intentName || "search_school_index", 80),
    type: safeText(value.type, 40),
    missing: safeText(value.missing, 80),
    createdAt,
    expiresAt,
  };
}

function normalizeRecentTurn(turn = {}) {
  return {
    role: turn.role === "user" ? "user" : "assistant",
    text: safeText(turn.text || turn.content || "", MAX_TURN_TEXT),
    intent: safeText(turn.intent || "", 80),
    at: safeText(turn.at || turn.createdAt || nowIso(), 40),
  };
}

function normalizeEvidenceRef(item = {}) {
  return {
    sourceId: safeText(item.sourceId || item.source || "", 120),
    releaseVersion: safeText(item.releaseVersion || "", 80),
    term: safeText(item.term || "", 40),
    checkedAt: safeText(item.checkedAt || item.updatedAt || "", 40),
    checksum: safeText(item.checksum || "", 80),
    factCount: Math.max(0, Number(item.factCount || item.total || 0) || 0),
  };
}

function normalizeLastRun(run = {}) {
  if (!run || typeof run !== "object") return null;
  return {
    runId: safeText(run.runId || "", 100),
    intent: safeText(run.intent || "", 80),
    status: safeText(run.status || "", 24),
    stepCount: Math.max(0, Number(run.stepCount || 0) || 0),
    at: safeText(run.at || nowIso(), 40),
  };
}

function createEmptyConversationState(input = {}) {
  const now = nowIso();
  const conversationId = safeText(input.conversationId || "", 80);
  const memoryMode = normalizeMemoryMode(input.memoryMode || input.memoryPolicy && input.memoryPolicy.mode, "session_state");
  const ttlMs = memoryMode === "cloud_sync" ? DEFAULT_CLOUD_SYNC_TTL_MS : DEFAULT_SESSION_TTL_MS;
  return {
    schemaVersion: SCHEMA_VERSION,
    conversationIdHash: hashConversationId(conversationId),
    clientConversationId: conversationId,
    principalKey: safeText(input.principalKey || "", 128),
    runtimeMode: safeText(input.runtimeMode || "public", 16),
    revision: 0,
    title: safeText(input.title || "新对话", MAX_TITLE) || "新对话",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    lastAccessedAt: now,
    contextSlots: emptyContextSlots(),
    pendingClarification: null,
    conversationSummary: "",
    recentTurns: [],
    memoryPolicy: {
      mode: memoryMode,
      cloudSyncEnabled: memoryMode === "cloud_sync",
      updatedAt: now,
    },
    evidenceRefs: [],
    lastRun: null,
  };
}

function migrateConversationState(raw = {}, options = {}) {
  if (!raw || typeof raw !== "object") {
    return createEmptyConversationState(options);
  }
  const base = createEmptyConversationState({
    conversationId: options.conversationId || raw.clientConversationId || "",
    principalKey: options.principalKey || raw.principalKey || "",
    runtimeMode: options.runtimeMode || raw.runtimeMode || "public",
    memoryMode: raw.memoryPolicy && raw.memoryPolicy.mode || raw.memoryMode,
  });
  const memoryMode = normalizeMemoryMode(raw.memoryPolicy && raw.memoryPolicy.mode || raw.memoryMode, base.memoryPolicy.mode);
  return {
    schemaVersion: SCHEMA_VERSION,
    conversationIdHash: safeText(raw.conversationIdHash || base.conversationIdHash, 64),
    clientConversationId: safeText(raw.clientConversationId || options.conversationId || "", 80),
    principalKey: safeText(raw.principalKey || options.principalKey || "", 128),
    runtimeMode: safeText(raw.runtimeMode || options.runtimeMode || "public", 16),
    revision: Math.max(0, Number(raw.revision || 0) || 0),
    title: safeText(raw.title || base.title, MAX_TITLE) || "新对话",
    createdAt: safeText(raw.createdAt || base.createdAt, 40),
    updatedAt: safeText(raw.updatedAt || base.updatedAt, 40),
    expiresAt: safeText(raw.expiresAt || base.expiresAt, 40),
    lastAccessedAt: safeText(raw.lastAccessedAt || base.lastAccessedAt, 40),
    contextSlots: normalizeContextSlots(raw.contextSlots || {}),
    pendingClarification: normalizePendingClarification(raw.pendingClarification),
    conversationSummary: safeText(raw.conversationSummary || "", MAX_SUMMARY),
    recentTurns: memoryMode === "cloud_sync"
      ? (Array.isArray(raw.recentTurns) ? raw.recentTurns : []).map(normalizeRecentTurn).filter((item) => item.text).slice(-MAX_RECENT_TURNS)
      : [],
    memoryPolicy: {
      mode: memoryMode,
      cloudSyncEnabled: memoryMode === "cloud_sync",
      updatedAt: safeText(raw.memoryPolicy && raw.memoryPolicy.updatedAt || raw.updatedAt || nowIso(), 40),
    },
    evidenceRefs: (Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs : [])
      .map(normalizeEvidenceRef)
      .filter((item) => item.sourceId)
      .slice(0, MAX_EVIDENCE_REFS),
    lastRun: normalizeLastRun(raw.lastRun),
  };
}

function isExpired(state, now = Date.now()) {
  const expires = Date.parse(state && state.expiresAt || "");
  return Number.isFinite(expires) && expires <= now;
}

function publicConversationView(state) {
  if (!state) return null;
  return {
    conversationId: state.clientConversationId,
    title: state.title,
    revision: state.revision,
    runtimeMode: state.runtimeMode,
    memoryMode: state.memoryPolicy && state.memoryPolicy.mode || "session_state",
    summaryAvailable: Boolean(state.conversationSummary),
    conversationSummary: state.conversationSummary || "",
    updatedAt: state.updatedAt,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    lastIntent: state.contextSlots && state.contextSlots.lastIntent || "",
    lastRun: state.lastRun,
  };
}

function publicMemoryStatus(state, options = {}) {
  const authenticated = options.authenticated === true;
  const mode = !authenticated
    ? "local_only"
    : normalizeMemoryMode(state && state.memoryPolicy && state.memoryPolicy.mode || options.mode, "session_state");
  const persisted = authenticated && mode !== "local_only" && Boolean(state);
  return {
    mode,
    authenticated,
    persisted,
    synced: mode === "cloud_sync" && persisted,
    revision: state ? Number(state.revision || 0) || 0 : 0,
    expiresAt: state && state.expiresAt || "",
    summaryAvailable: Boolean(state && state.conversationSummary),
    canClear: authenticated && persisted,
  };
}

module.exports = {
  SCHEMA_VERSION,
  MEMORY_MODES,
  MAX_RECENT_TURNS,
  MAX_TURN_TEXT,
  MAX_SUMMARY,
  MAX_TITLE,
  MAX_EVIDENCE_REFS,
  CANONICAL_SLOTS,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_CLOUD_SYNC_TTL_MS,
  PENDING_CLARIFICATION_TTL_MS,
  createEmptyConversationState,
  emptyContextSlots,
  hashConversationId,
  isExpired,
  migrateConversationState,
  normalizeContextSlots,
  normalizeEvidenceRef,
  normalizeMemoryMode,
  normalizePendingClarification,
  normalizeRecentTurn,
  publicConversationView,
  publicMemoryStatus,
  safeText,
  nowIso,
};
