/**
 * Memory write policy: sensitivity, confidence, TTL, conflict, scope gates.
 */

const safetyGuard = require("../safetyGuard");

const LOW_RISK_KEYS = Object.freeze([
  "preferredName",
  "campus",
  "preferredBuilding",
  "defaultReminderLeadMinutes",
  "answerDetailLevel",
  "preferredClassName",
  "preferPersonalSchedule",
  "college",
  "major",
  "grade",
]);

const TEMPORARY_REASON_CODES = Object.freeze([
  "one_off_study_spot",
  "temporary_time",
  "query_result",
  "weather_snapshot",
  "room_occupancy",
  "speculation",
]);

const SENSITIVE_REASON_CODES = Object.freeze([
  "credential",
  "student_id",
  "token",
  "full_schedule",
  "precise_location_trail",
  "model_reasoning",
]);

const DEFAULT_TTL_MS = Object.freeze({
  preferredName: 90 * 24 * 60 * 60 * 1000,
  campus: 90 * 24 * 60 * 60 * 1000,
  preferredBuilding: 60 * 24 * 60 * 60 * 1000,
  defaultReminderLeadMinutes: 90 * 24 * 60 * 60 * 1000,
  answerDetailLevel: 60 * 24 * 60 * 60 * 1000,
  preferredClassName: 30 * 24 * 60 * 60 * 1000,
  preferPersonalSchedule: 60 * 24 * 60 * 60 * 1000,
  college: 180 * 24 * 60 * 60 * 1000,
  major: 180 * 24 * 60 * 60 * 1000,
  grade: 180 * 24 * 60 * 60 * 1000,
  working_entity: 7 * 24 * 60 * 60 * 1000,
  session_fact: 24 * 60 * 60 * 1000,
});

const MIN_CONFIDENCE = 0.72;
const MAX_USER_MEMORIES = 50;

function isLowRiskKey(key) {
  return LOW_RISK_KEYS.includes(String(key || ""));
}

function isTemporaryCandidate(candidate = {}) {
  if (TEMPORARY_REASON_CODES.includes(candidate.reasonCode)) return true;
  if (candidate.scope === "turn" || candidate.scope === "working") return true;
  const text = String(candidate.rawText || candidate.reasonCode || "");
  if (/今天|今天下午|今晚|这次|临时/.test(text) && /C\d|自习|教室/.test(text)) return true;
  return false;
}

function isSensitiveCandidate(candidate = {}) {
  if (SENSITIVE_REASON_CODES.includes(candidate.reasonCode)) return true;
  if (candidate.sensitivity === "high" || candidate.sensitivity === "critical") return true;
  const blob = `${candidate.key || ""} ${candidate.value || ""} ${candidate.rawText || ""}`;
  if (safetyGuard.hasSensitiveCredential(blob)) return true;
  if (/(学号|密码|cookie|token|authorization|api[_-]?key)/i.test(blob)) return true;
  return false;
}

/**
 * Functional authorization for cross-conversation User Memory:
 * only cloud_sync may auto-persist durable user preferences.
 * session_state keeps Working/Thread for the current conversation only.
 * local_only never writes durable user memory.
 */
function mayAutoPersistUserMemory(memoryMode, candidate = {}) {
  const mode = String(memoryMode || "local_only");
  if (mode !== "cloud_sync") return false;
  if (isSensitiveCandidate(candidate)) return false;
  if (isTemporaryCandidate(candidate)) return false;
  if (!isLowRiskKey(candidate.key)) return false;
  if (Number(candidate.confidence || 0) < MIN_CONFIDENCE) return false;
  return true;
}

function mayKeepInWorkingMemory(candidate = {}) {
  if (isSensitiveCandidate(candidate)) return false;
  return true;
}

function resolveExpiresAt(candidate = {}, now = Date.now()) {
  if (candidate.expiresAt) {
    const parsed = Date.parse(candidate.expiresAt);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const ttl = DEFAULT_TTL_MS[candidate.key] || DEFAULT_TTL_MS.session_fact;
  return new Date(now + ttl).toISOString();
}

function isExpired(entry, now = Date.now()) {
  if (!entry || !entry.expiresAt) return false;
  const parsed = Date.parse(entry.expiresAt);
  return Number.isFinite(parsed) && parsed <= now;
}

/**
 * Merge candidates: latest explicit correction wins; drop low confidence / sensitive.
 */
function filterAndMergeCandidates(candidates = [], options = {}) {
  const memoryMode = options.memoryMode || "local_only";
  const autoMemoryEnabled = options.autoMemoryEnabled !== false;
  const byKey = new Map();

  (Array.isArray(candidates) ? candidates : []).forEach((raw) => {
    if (!raw || !raw.key) return;
    if (isSensitiveCandidate(raw)) return;
    if (Number(raw.confidence || 0) < MIN_CONFIDENCE) return;
    if (!autoMemoryEnabled && raw.source !== "explicit_user") return;

    const candidate = {
      type: String(raw.type || "preference").slice(0, 40),
      key: String(raw.key).slice(0, 40),
      value: raw.value,
      scope: String(raw.scope || "user").slice(0, 24),
      confidence: Math.min(1, Math.max(0, Number(raw.confidence || 0) || 0)),
      sourceTurnIds: Array.isArray(raw.sourceTurnIds) ? raw.sourceTurnIds.slice(0, 8) : [],
      expiresAt: resolveExpiresAt(raw),
      sensitivity: isSensitiveCandidate(raw) ? "high" : String(raw.sensitivity || "low").slice(0, 16),
      reasonCode: String(raw.reasonCode || "auto_extract").slice(0, 40),
      correction: raw.correction === true,
      durable: false,
    };

    if (candidate.scope === "user" || candidate.scope === "long_term") {
      candidate.durable = mayAutoPersistUserMemory(memoryMode, candidate);
      if (!candidate.durable && memoryMode === "local_only") {
        candidate.scope = "working";
      }
    }

    if (isTemporaryCandidate(candidate)) {
      candidate.scope = "working";
      candidate.durable = false;
    }

    const prev = byKey.get(candidate.key);
    if (!prev) {
      byKey.set(candidate.key, candidate);
      return;
    }
    // Latest explicit correction wins.
    if (candidate.correction || candidate.confidence >= prev.confidence) {
      byKey.set(candidate.key, candidate);
    }
  });

  return Array.from(byKey.values());
}

function enforceUserMemoryCap(items = [], max = MAX_USER_MEMORIES) {
  const list = (Array.isArray(items) ? items : []).filter((item) => !isExpired(item));
  if (list.length <= max) return list;
  return list
    .slice()
    .sort((a, b) => {
      const conf = Number(b.confidence || 0) - Number(a.confidence || 0);
      if (conf !== 0) return conf;
      return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
    })
    .slice(0, max);
}

module.exports = {
  LOW_RISK_KEYS,
  TEMPORARY_REASON_CODES,
  SENSITIVE_REASON_CODES,
  DEFAULT_TTL_MS,
  MIN_CONFIDENCE,
  MAX_USER_MEMORIES,
  isLowRiskKey,
  isTemporaryCandidate,
  isSensitiveCandidate,
  mayAutoPersistUserMemory,
  mayKeepInWorkingMemory,
  resolveExpiresAt,
  isExpired,
  filterAndMergeCandidates,
  enforceUserMemoryCap,
};
