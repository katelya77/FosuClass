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

// TTL 类别化（Low#4）：空串/非法日期/缺失不等于永久有效。
// - 学期/Release 绑定（scope=term|release）：短 TTL 且由 scope 边界失效逻辑绑定版本；
// - Episode：中 TTL（服务层 DEFAULT_EPISODE_TTL_MS 落盘，检索同样 fail closed）；
// - 稳定偏好：长 TTL，但始终有 TTL，确认/编辑可续期；
// - pending/工作态：短期 TTL。
const TERM_SCOPE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

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
/**
 * P4b：发布策略覆盖（可选）。policy 来自配置内核按快照解析的 Memory 域发布物
 * （packages/agent-runtime memoryPolicyPublicationAdapter，字段已校验有界）。
 * 所有消费点缺省 policy 时严格回落静态常量（= P4b 前行为）；
 * 在途 Run 的策略由其创建时绑定的快照决定，发布/回滚只影响新 Run。
 */
function policyValue(policy, field) {
  if (!policy || typeof policy !== "object") return undefined;
  const value = policy[field];
  return Number.isFinite(value) ? value : undefined;
}

function ttlOverrideFor(policy, key) {
  if (!policy || typeof policy !== "object" || !policy.ttlOverridesMs) return undefined;
  const value = Number(policy.ttlOverridesMs[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function minConfidenceOf(policy) {
  return policyValue(policy, "minConfidence") !== undefined ? policyValue(policy, "minConfidence") : MIN_CONFIDENCE;
}

function pendingTtlOf(policy) {
  return policyValue(policy, "pendingTtlMs") !== undefined ? policyValue(policy, "pendingTtlMs") : PENDING_TTL_MS;
}

function termScopeTtlOf(policy) {
  return policyValue(policy, "termScopeTtlMs") !== undefined ? policyValue(policy, "termScopeTtlMs") : TERM_SCOPE_TTL_MS;
}

function mayAutoPersistUserMemory(memoryMode, candidate = {}, policy = null) {
  const mode = String(memoryMode || "local_only");
  if (mode !== "cloud_sync") return false;
  if (isSensitiveCandidate(candidate)) return false;
  if (isTemporaryCandidate(candidate)) return false;
  if (!isLowRiskKey(candidate.key)) return false;
  // 显式用户指令（"叫我小明"）豁免置信门槛：该门槛面向推断型记忆；
  // 否则发布的 minConfidence > 0.95 会让解析期判定 persist 的显式偏好在
  // 落盘时被静默丢弃（回答声称已记住但实际未写）。
  if (candidate.source !== "explicit_user" && Number(candidate.confidence || 0) < minConfidenceOf(policy)) return false;
  return true;
}

function mayKeepInWorkingMemory(candidate = {}) {
  if (isSensitiveCandidate(candidate)) return false;
  return true;
}

/**
 * 类别化 TTL：scope=term/release 的记忆短 TTL 且绑版本边界；
 * pending/工作态短期；稳定偏好按 key 默认长 TTL。
 */
function resolveTtlMs(candidate = {}, policy = null) {
  const base = ttlOverrideFor(policy, candidate.key) !== undefined
    ? ttlOverrideFor(policy, candidate.key)
    : (DEFAULT_TTL_MS[candidate.key] || DEFAULT_TTL_MS.session_fact);
  if (candidate.scope === "term" || candidate.scope === "release") {
    return Math.min(base, termScopeTtlOf(policy));
  }
  if (candidate.scope === "working" || candidate.scope === "turn"
    || candidate.reasonCode === "pending_action" || candidate.reasonCode === "pending_clarification") {
    return pendingTtlOf(policy);
  }
  return base;
}

function resolveExpiresAt(candidate = {}, now = Date.now(), policy = null) {
  if (candidate.expiresAt) {
    const parsed = Date.parse(candidate.expiresAt);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(now + resolveTtlMs(candidate, policy)).toISOString();
}

/**
 * 有效过期时间（毫秒）：
 * 1. expiresAt 为合法日期 → 直接使用；
 * 2. legacy 缺 expiresAt / 非法日期 → updatedAt → createdAt 起算 + 类别默认 TTL
 *    （禁止用"当前时间 + 默认 TTL"复活旧数据）；
 * 3. 无任何可确认时间 → null（调用方 fail closed，不进检索/Provider）。
 */
function effectiveExpiryMs(entry = {}, policy = null) {
  const direct = Date.parse(entry && entry.expiresAt || "");
  if (Number.isFinite(direct)) return direct;
  const base = Date.parse(entry && entry.updatedAt || "");
  const created = Date.parse(entry && entry.createdAt || "");
  const baseMs = Number.isFinite(base) ? base : created;
  if (Number.isFinite(baseMs)) return baseMs + resolveTtlMs(entry, policy);
  return null;
}

function isExpired(entry, now = Date.now(), policy = null) {
  const expiry = effectiveExpiryMs(entry, policy);
  // 无法确认有效性 → fail closed，按已过期处理（不进入检索/Provider）。
  if (expiry === null) return true;
  return expiry <= now;
}

/**
 * Merge candidates: latest explicit correction wins; drop low confidence / sensitive.
 */
function filterAndMergeCandidates(candidates = [], options = {}) {
  const memoryMode = options.memoryMode || "local_only";
  const autoMemoryEnabled = options.autoMemoryEnabled !== false;
  const policy = options.policy || null;
  const minConfidence = minConfidenceOf(policy);
  const byKey = new Map();

  (Array.isArray(candidates) ? candidates : []).forEach((raw) => {
    if (!raw || !raw.key) return;
    if (isSensitiveCandidate(raw)) return;
    // 显式用户指令（"叫我小明"，解析器置信 0.95）豁免置信门槛——与
    // mayAutoPersistUserMemory 的豁免一致：门槛面向推断型记忆，发布的
    // minConfidence > 0.95 不得把显式偏好在归并期静默丢弃（P4b 审查 Minor #8）。
    if (raw.source !== "explicit_user" && Number(raw.confidence || 0) < minConfidence) return;
    if (!autoMemoryEnabled && raw.source !== "explicit_user") return;

    const candidate = {
      type: String(raw.type || "preference").slice(0, 40),
      key: String(raw.key).slice(0, 40),
      value: raw.value,
      scope: String(raw.scope || "user").slice(0, 24),
      confidence: Math.min(1, Math.max(0, Number(raw.confidence || 0) || 0)),
      sourceTurnIds: Array.isArray(raw.sourceTurnIds) ? raw.sourceTurnIds.slice(0, 8) : [],
      // options.now 仅供测试注入确定性时钟；生产调用方不传时回落 Date.now()。
      expiresAt: resolveExpiresAt(raw, Number.isFinite(options.now) ? options.now : undefined, policy),
      expiresAtSource: raw.expiresAtSource === "explicit" || raw.expiresAtSource === "policy"
        ? raw.expiresAtSource
        : (raw.expiresAt ? "explicit" : "policy"),
      sensitivity: isSensitiveCandidate(raw) ? "high" : String(raw.sensitivity || "low").slice(0, 16),
      reasonCode: String(raw.reasonCode || "auto_extract").slice(0, 40),
      source: String(raw.source || "deterministic").slice(0, 40),
      correction: raw.correction === true,
      // legacy 兼容字段：candidate 级 termId/releaseVersion 无检索/失效消费者。
      // canonical 是服务层条目的 scope+termId+releaseVersion（由权威 Release 边界写入，
      // 经 scopeMatches / invalidateContext 消费）；这里仅保留兼容读取，供写路径在
      // 权威边界缺失时做确定性映射。
      termId: String(raw.termId || "").slice(0, 60),
      releaseVersion: String(raw.releaseVersion || "").slice(0, 100),
      durable: false,
    };

    if (["user", "long_term", "term", "release"].includes(candidate.scope)) {
      candidate.durable = mayAutoPersistUserMemory(memoryMode, candidate, policy);
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

function enforceUserMemoryCap(items = [], max = MAX_USER_MEMORIES, policy = null) {
  const list = (Array.isArray(items) ? items : []).filter((item) => !isExpired(item, Date.now(), policy));
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
  TERM_SCOPE_TTL_MS,
  PENDING_TTL_MS,
  MIN_CONFIDENCE,
  MAX_USER_MEMORIES,
  isLowRiskKey,
  isTemporaryCandidate,
  isSensitiveCandidate,
  mayAutoPersistUserMemory,
  mayKeepInWorkingMemory,
  resolveTtlMs,
  resolveExpiresAt,
  effectiveExpiryMs,
  isExpired,
  filterAndMergeCandidates,
  enforceUserMemoryCap,
};
