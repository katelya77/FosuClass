/**
 * Principal-scoped low-risk preferences.
 *
 * Values are encrypted at rest and are never keyed by a client supplied id.
 * Enabling cloud_sync is functional authorization for low-risk User Memory
 * (name, campus, reminder lead, etc.). session_state does not write user prefs.
 * Sensitive credentials are never accepted.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../../exclusiveFileLockService");
const { principalShard } = require("./conversationPrincipalService");
const { encodeSemanticVector, semanticScores } = require("../../../../../packages/agent-runtime");

const LEGACY_SCHEMA_VERSION = "user-preferences.v1";
const SCHEMA_VERSION = "user-memory.v2";
const ALLOWED_KEYS = Object.freeze([
  "preferredName",
  "campus",
  "defaultReminderLeadMinutes",
  "preferredBuilding",
  "answerDetailLevel",
  "preferredClassName",
  "preferPersonalSchedule",
  "college",
  "major",
  "grade",
]);
const ALLOWED_MEMORY_KINDS = Object.freeze([
  "stable_preference",
  "identity_alias",
  "interaction_preference",
  "task_constraint",
]);
const FORBIDDEN_MEMORY_KINDS = Object.freeze([
  "schedule_snapshot",
  "weather",
  "credential",
  "raw_tool_output",
  "hidden_reasoning",
]);
const ALLOWED_SCOPES = Object.freeze(["user", "term", "release"]);
const DEFAULT_MEMORY_CAPACITY = 50;
const DEFAULT_EPISODE_CAPACITY = 30;
const DEFAULT_MEMORY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_EPISODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SENSITIVE_PATTERN = /(password|passwd|pwd|cookie|authorization|api[-_]?key|secret|token|ticket|credential|学号|密码)/i;

function typedError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || 400;
  return error;
}

function normalizeValue(key, value) {
  if (key === "preferredName") {
    const name = String(value || "").trim().replace(/[，。！？,.!?]+$/g, "").slice(0, 24);
    if (!name || !/^[\u3400-\u9fffA-Za-z0-9·\-\s]{1,24}$/.test(name)) return null;
    return name;
  }
  if (key === "campus") {
    const campus = String(value || "").trim();
    return ["仙溪校区", "江湾校区"].includes(campus) ? campus : null;
  }
  if (key === "defaultReminderLeadMinutes") {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes >= 5 && minutes <= 180
      ? Math.round(minutes)
      : null;
  }
  if (key === "preferredBuilding") {
    const building = String(value || "").trim().slice(0, 24);
    return /^[A-Za-z0-9\u3400-\u9fff\-]{1,24}$/.test(building) ? building : null;
  }
  if (key === "answerDetailLevel") {
    const level = String(value || "").trim().toLowerCase();
    return ["concise", "detailed", "normal"].includes(level) ? level : null;
  }
  if (key === "preferredClassName") {
    const name = String(value || "").trim().slice(0, 40);
    return name && /班/.test(name) ? name : null;
  }
  if (key === "preferPersonalSchedule") {
    if (value === true || value === "true" || value === 1) return true;
    if (value === false || value === "false" || value === 0) return false;
    return null;
  }
  if (key === "college") {
    const college = String(value || "").trim().replace(/[，。！？,.!?]+$/g, "").slice(0, 16);
    if (/^(什么|啥|哪|谁|怎么|如何)/.test(college)) return null;
    return /^[㐀-鿿]{2,16}(学院|学部)$/.test(college) ? college : null;
  }
  if (key === "major") {
    const major = String(value || "").trim().replace(/[，。！？,.!?]+$/g, "").slice(0, 16);
    if (!/^[㐀-鿿A-Za-z]{2,16}$/.test(major)) return null;
    if (/^(什么|啥|哪|谁|怎么|如何)/.test(major)) return null;
    // 拒绝明显非专业的误抓：学院/大学机构名、身份词、场景词
    if (/(学院|大学|学部|学生|校区|老师|同学|专业)$/.test(major)) return null;
    return major;
  }
  if (key === "grade") {
    const grade = String(value || "").trim();
    return /^(大[一二三四五六]|20\d{2}级)$/.test(grade) ? grade : null;
  }
  return null;
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function encryptObject(value, secret, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(String(aad || "")));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptObject(envelope, secret, aad) {
  if (!envelope || envelope.algorithm !== "aes-256-gcm"
    || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
    throw typedError("Memory document is corrupt", "MEMORY_DOCUMENT_CORRUPT", 500);
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(envelope.iv || "", "base64")
  );
  decipher.setAAD(Buffer.from(String(aad || "")));
  decipher.setAuthTag(Buffer.from(envelope.tag || "", "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext || "", "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plain);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw typedError("Memory document is corrupt", "MEMORY_DOCUMENT_CORRUPT", 500);
  }
  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function safeText(value, max = 240) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function defaultPolicy(now) {
  return {
    mode: "cloud_sync",
    autoMemoryEnabled: true,
    paused: false,
    capacity: DEFAULT_MEMORY_CAPACITY,
    episodeCapacity: DEFAULT_EPISODE_CAPACITY,
    configVersion: "memory-default-v1",
    updatedAt: now,
  };
}

function emptyDocument(now) {
  return {
    revision: 0,
    policy: defaultPolicy(now),
    items: [],
    episodes: [],
    audit: [],
  };
}

function normalizeProvenance(value = {}, now) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    type: safeText(source.type || source.source || "user_explicit", 40),
    turnId: safeText(source.turnId || "", 80),
    runId: safeText(source.runId || "", 100),
    sourceId: safeText(source.sourceId || "", 120),
    recordedAt: safeText(source.recordedAt || now, 40),
  };
}

function normalizeStoredItem(item = {}) {
  return {
    memoryId: safeText(item.memoryId, 100),
    kind: safeText(item.kind || "stable_preference", 40),
    key: safeText(item.key, 60),
    content: safeText(item.content, 240),
    normalizedValue: item.normalizedValue,
    provenance: normalizeProvenance(item.provenance, item.createdAt || new Date().toISOString()),
    confidence: Math.max(0, Math.min(1, Number(item.confidence || 0))),
    scope: ALLOWED_SCOPES.includes(item.scope) ? item.scope : "user",
    expiresAt: safeText(item.expiresAt, 40),
    supersedes: safeText(item.supersedes, 100),
    supersededBy: safeText(item.supersededBy, 100),
    status: ["active", "superseded", "expired_context"].includes(item.status) ? item.status : "active",
    termId: safeText(item.termId, 60),
    releaseVersion: safeText(item.releaseVersion, 100),
    revision: Math.max(1, Number(item.revision || 1)),
    createdAt: safeText(item.createdAt, 40),
    updatedAt: safeText(item.updatedAt, 40),
    featureVector: Array.isArray(item.featureVector) ? item.featureVector.slice(0, 64).map(Number) : [],
  };
}

function normalizeStoredEpisode(item = {}) {
  return {
    episodeId: safeText(item.episodeId, 100),
    goal: safeText(item.goal, 100),
    outcomeSummary: safeText(item.outcomeSummary, 240),
    reusableConstraints: item.reusableConstraints && typeof item.reusableConstraints === "object" && !Array.isArray(item.reusableConstraints)
      ? Object.fromEntries(Object.entries(item.reusableConstraints).slice(0, 12).filter(([key, value]) => (
        !SENSITIVE_PATTERN.test(key) && ["string", "number", "boolean"].includes(typeof value)
      )).map(([key, value]) => [safeText(key, 40), typeof value === "string" ? safeText(value, 100) : value]))
      : {},
    provenanceRunId: safeText(item.provenanceRunId, 100),
    expiresAt: safeText(item.expiresAt, 40),
    status: ["active", "success", "expired_context"].includes(item.status) ? item.status : "success",
    termId: safeText(item.termId, 60),
    releaseVersion: safeText(item.releaseVersion, 100),
    revision: Math.max(1, Number(item.revision || 1)),
    createdAt: safeText(item.createdAt, 40),
    updatedAt: safeText(item.updatedAt, 40),
    featureVector: Array.isArray(item.featureVector) ? item.featureVector.slice(0, 64).map(Number) : [],
  };
}

function normalizeDocument(value, now) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const policy = source.policy && typeof source.policy === "object" ? source.policy : {};
  return {
    revision: Math.max(0, Number(source.revision || 0)),
    policy: {
      mode: "cloud_sync",
      autoMemoryEnabled: policy.autoMemoryEnabled !== false,
      paused: policy.paused === true,
      capacity: Math.max(1, Math.min(200, Number(policy.capacity || DEFAULT_MEMORY_CAPACITY))),
      episodeCapacity: Math.max(1, Math.min(100, Number(policy.episodeCapacity || DEFAULT_EPISODE_CAPACITY))),
      configVersion: safeText(policy.configVersion || "memory-default-v1", 100),
      updatedAt: safeText(policy.updatedAt || now, 40),
    },
    items: (Array.isArray(source.items) ? source.items : []).map(normalizeStoredItem)
      .filter((item) => item.memoryId && item.key && ALLOWED_MEMORY_KINDS.includes(item.kind)),
    episodes: (Array.isArray(source.episodes) ? source.episodes : []).map(normalizeStoredEpisode)
      .filter((item) => item.episodeId && item.goal && item.outcomeSummary),
    audit: (Array.isArray(source.audit) ? source.audit : []).slice(-100).map((entry) => ({
      auditId: safeText(entry.auditId, 100),
      action: safeText(entry.action, 40),
      targetId: safeText(entry.targetId, 100),
      revision: Math.max(0, Number(entry.revision || 0)),
      at: safeText(entry.at || now, 40),
    })),
  };
}

function activeValues(document, nowMs = Date.now()) {
  const values = {};
  document.items.filter((item) => {
    if (item.status !== "active") return false;
    return isLiveEntry(item, nowMs, DEFAULT_MEMORY_TTL_MS);
  }).forEach((item) => {
    values[item.key] = item.normalizedValue;
  });
  return values;
}

function publicMemoryItem(item) {
  const { featureVector, ...safe } = item;
  return safe;
}

function publicEpisode(item) {
  const { featureVector, ...safe } = item;
  return safe;
}

function publicAudit(entry) {
  return {
    auditId: entry.auditId,
    action: entry.action,
    targetId: entry.targetId,
    revision: entry.revision,
    at: entry.at,
  };
}

function assertExpectedRevision(document, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) return;
  if (Number(expectedRevision) !== Number(document.revision)) {
    throw typedError("Memory revision conflict", "MEMORY_REVISION_CONFLICT", 409);
  }
}

function audit(document, action, targetId, now) {
  document.audit.push({
    auditId: createId("audit"),
    action,
    targetId: safeText(targetId, 100),
    revision: document.revision,
    at: now,
  });
  document.audit = document.audit.slice(-100);
}

function assertV2DocumentShape(value, outerRevision) {
  const valid = value && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite(Number(value.revision))
    && value.policy && typeof value.policy === "object" && !Array.isArray(value.policy)
    && Array.isArray(value.items)
    && Array.isArray(value.episodes)
    && Array.isArray(value.audit);
  if (!valid || (outerRevision !== undefined && Number(outerRevision) !== Number(value.revision))) {
    throw typedError("Memory document is corrupt", "MEMORY_DOCUMENT_CORRUPT", 500);
  }
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return false;
  }
}

function isExplicitProvenance(value = {}) {
  return /^(user_explicit|user_correction|user_confirmation|user_edit)$/.test(String(value.type || ""));
}

/**
 * 有效过期时间（Low#4）：expiresAt 合法直接用；legacy 缺失/非法日期用
 * updatedAt → createdAt 起算 + 类别默认 TTL；无法确认返回 null（fail closed）。
 * 禁止用"当前时间 + 默认 TTL"复活旧数据。
 */
function entryExpiryMs(item, fallbackTtlMs) {
  const direct = Date.parse(item && item.expiresAt || "");
  if (Number.isFinite(direct)) return direct;
  const updated = Date.parse(item && item.updatedAt || "");
  const created = Date.parse(item && item.createdAt || "");
  const base = Number.isFinite(updated) ? updated : created;
  if (Number.isFinite(base)) return base + fallbackTtlMs;
  return null;
}

function isLiveEntry(item, nowMs, fallbackTtlMs) {
  const expiry = entryExpiryMs(item, fallbackTtlMs);
  return expiry !== null && expiry > nowMs;
}

function scopeMatches(item, input = {}) {
  const termId = safeText(input.termId, 60);
  const releaseVersion = safeText(input.releaseVersion, 100);
  if (item.scope === "term" || (!item.scope && item.termId && !item.releaseVersion)) {
    return Boolean(item.termId && termId && item.termId === termId);
  }
  if (item.scope === "release" || (!item.scope && item.releaseVersion)) {
    if (!item.releaseVersion || !releaseVersion || item.releaseVersion !== releaseVersion) return false;
    return !item.termId || Boolean(termId && item.termId === termId);
  }
  return true;
}

function goalMatchesMemoryKey(key, goal) {
  const normalizedGoal = String(goal || "").toLowerCase();
  if (!normalizedGoal) return false;
  const patterns = {
    preferredName: /(name|profile|identity|greeting|small.?talk|称呼|名字)/,
    campus: /(campus|empty.?room|schedule|course|weather|校区|空教室|课表|课程|天气)/,
    preferredBuilding: /(building|empty.?room|study|room|楼|自习|教室)/,
    defaultReminderLeadMinutes: /(remind|notification|提醒)/,
    answerDetailLevel: /(answer|response|project.?qa|general|detail|回答|回复|解释)/,
    preferredClassName: /(schedule|course|class|timetable|课表|课程|班级)/,
    preferPersonalSchedule: /(schedule|course|class|timetable|课表|课程)/,
    college: /(profile|identity|college|学院)/,
    major: /(profile|identity|major|专业)/,
    grade: /(profile|identity|grade|年级)/,
  };
  return Boolean(patterns[key] && patterns[key].test(normalizedGoal));
}

function hasSemanticRelevance(item, input, scores, query) {
  const normalizedValue = item.normalizedValue === undefined || item.normalizedValue === null
    ? "" : String(item.normalizedValue);
  const exact = Boolean(query && (
    query.includes(item.key)
    || (normalizedValue && query.includes(normalizedValue))
  ));
  const relevant = exact
    || goalMatchesMemoryKey(item.key, input.goal)
    || scores.lexical > 0
    || scores.vector >= 0.28;
  return { relevant, exact };
}

function enforceCapacity(document, now) {
  let changed = false;
  const nowMs = Date.parse(now);
  document.items.forEach((item) => {
    const expiry = entryExpiryMs(item, DEFAULT_MEMORY_TTL_MS);
    if (item.status === "active" && (expiry === null || expiry <= nowMs)) {
      item.status = "expired_context";
      item.updatedAt = now;
      item.revision = document.revision;
      changed = true;
    }
  });
  document.episodes.forEach((episode) => {
    const expiry = entryExpiryMs(episode, DEFAULT_EPISODE_TTL_MS);
    if (["active", "success"].includes(episode.status)
      && (expiry === null || expiry <= nowMs)) {
      episode.status = "expired_context";
      episode.updatedAt = now;
      episode.revision = document.revision;
      changed = true;
    }
  });
  const activeItems = document.items.filter((item) => item.status === "active")
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0)
      || String(right.updatedAt).localeCompare(String(left.updatedAt)));
  activeItems.slice(document.policy.capacity).forEach((item) => {
    item.status = "expired_context";
    item.updatedAt = now;
    item.revision = document.revision;
    changed = true;
  });

  const itemLimit = Math.min(200, Math.max(document.policy.capacity * 3, document.policy.capacity + 10));
  if (document.items.length > itemLimit) {
    const active = document.items.filter((item) => item.status === "active");
    const inactive = document.items.filter((item) => item.status !== "active")
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, Math.max(0, itemLimit - active.length));
    document.items = active.concat(inactive);
    changed = true;
  }

  const activeEpisodes = document.episodes.filter((episode) => ["active", "success"].includes(episode.status))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  activeEpisodes.slice(document.policy.episodeCapacity).forEach((episode) => {
    episode.status = "expired_context";
    episode.updatedAt = now;
    episode.revision = document.revision;
    changed = true;
  });
  const episodeLimit = Math.min(100, Math.max(document.policy.episodeCapacity * 3, document.policy.episodeCapacity + 5));
  if (document.episodes.length > episodeLimit) {
    document.episodes = document.episodes.slice()
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, episodeLimit);
    changed = true;
  }
  return changed;
}

class UserPreferenceService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.dataDir
      || process.env.FOSU_USER_PREFERENCE_DATA_DIR
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"), "ai", "user-preferences")
    );
    this.secret = String(options.secret || process.env.FOSU_AGENT_MEMORY_SECRET || "");
    this.clock = options.clock && typeof options.clock.now === "function" ? options.clock : { now: Date.now };
  }

  assertPrincipal(principal) {
    if (!principal || principal.authenticated !== true || !principal.principalKey) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    return String(principal.principalKey);
  }

  assertWritable() {
    if (this.secret.length < 16) {
      throw typedError("Memory encryption is not configured", "MEMORY_SECRET_UNAVAILABLE", 503);
    }
  }

  filePath(principalKey) {
    const stableKey = String(principalKey || "");
    // Production principals are already 64-char HMACs, so preserve the deployed path.
    // Test/custom principals may share the same 16-char display shard; isolate those
    // with a non-reversible digest rather than allowing one principal to decrypt or
    // overwrite another principal's document.
    if (/^[a-f0-9]{64}$/i.test(stableKey)) {
      return path.join(this.rootDir, principalShard(stableKey), "preferences.json");
    }
    const isolated = crypto.createHash("sha256").update(stableKey).digest("hex").slice(0, 24);
    return path.join(this.rootDir, principalShard(stableKey), isolated, "preferences.json");
  }

  withLock(principalKey, callback) {
    const filePath = this.filePath(principalKey);
    ensureDir(path.dirname(filePath));
    const release = acquireExclusiveFileLock(filePath, {
      lockPath: `${filePath}.lock`,
      codePrefix: "USER_PREFERENCE",
      waitMs: 1200,
      staleMs: 30000,
    });
    try {
      return callback(filePath);
    } finally {
      release();
    }
  }

  nowIso() {
    return new Date(this.clock.now()).toISOString();
  }

  readDocumentUnlocked(filePath, principalKey) {
    const now = this.nowIso();
    if (!fs.existsSync(filePath)) return emptyDocument(now);
    if (!this.secret) {
      throw typedError("Memory encryption is not configured", "MEMORY_SECRET_UNAVAILABLE", 503);
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (_) {
      throw typedError("Memory document is corrupt", "MEMORY_DOCUMENT_CORRUPT", 500);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw typedError("Memory document is corrupt", "MEMORY_DOCUMENT_CORRUPT", 500);
    }
    if (raw.schemaVersion === SCHEMA_VERSION) {
      try {
        const decrypted = decryptObject(raw.encrypted, this.secret, principalKey);
        assertV2DocumentShape(decrypted, raw.revision);
        return normalizeDocument(decrypted, now);
      } catch (error) {
        if (error && error.code === "MEMORY_DOCUMENT_CORRUPT") throw error;
        throw typedError("Memory document is corrupt", "MEMORY_DOCUMENT_CORRUPT", 500);
      }
    }
    if (raw.schemaVersion === LEGACY_SCHEMA_VERSION) {
      let values;
      try {
        values = decryptObject(raw.encrypted, this.secret, principalKey);
      } catch (_) {
        throw typedError("Memory document is corrupt", "MEMORY_DOCUMENT_CORRUPT", 500);
      }
      const document = emptyDocument(now);
      document.revision = Object.keys(values).length ? 1 : 0;
      const updatedAtMs = Date.parse(raw.updatedAt || "");
      const legacyBaseMs = Number.isFinite(updatedAtMs) ? updatedAtMs : fs.statSync(filePath).mtimeMs;
      const legacyRecordedAt = new Date(legacyBaseMs).toISOString();
      Object.entries(values).forEach(([key, rawValue]) => {
        const value = normalizeValue(key, rawValue);
        if (!ALLOWED_KEYS.includes(key) || value === null) return;
        const content = `${key}=${String(value)}`;
        document.items.push(normalizeStoredItem({
          memoryId: `mem_legacy_${crypto.createHash("sha256").update(`${principalKey}|${key}`).digest("hex").slice(0, 16)}`,
          kind: key === "preferredName" ? "identity_alias" : "stable_preference",
          key,
          content,
          normalizedValue: value,
          provenance: { type: "legacy_migration", recordedAt: legacyRecordedAt },
          confidence: 0.9,
          scope: "user",
          expiresAt: new Date(legacyBaseMs + DEFAULT_MEMORY_TTL_MS).toISOString(),
          status: "active",
          revision: 1,
          createdAt: legacyRecordedAt,
          updatedAt: legacyRecordedAt,
          featureVector: encodeSemanticVector(content),
        }));
      });
      return document;
    }
    throw typedError("Memory schema is unsupported", "MEMORY_SCHEMA_UNSUPPORTED", 409);
  }

  writeDocumentUnlocked(filePath, principalKey, document) {
    this.assertWritable();
    const now = this.nowIso();
    const clean = normalizeDocument(document, now);
    writeJsonAtomic(filePath, {
      schemaVersion: SCHEMA_VERSION,
      principalShard: principalShard(principalKey),
      revision: clean.revision,
      updatedAt: now,
      encrypted: encryptObject(clean, this.secret, principalKey),
    });
  }

  readUnlocked(filePath, principalKey) {
    return activeValues(this.readDocumentUnlocked(filePath, principalKey), this.clock.now());
  }

  mutate(principalKey, input, callback) {
    this.assertWritable();
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      assertExpectedRevision(document, input && input.expectedRevision);
      const previousRevision = document.revision;
      document.revision += 1;
      const now = this.nowIso();
      const result = callback(document, now) || {};
      if (result.changed === false) {
        document.revision = previousRevision;
        return { document, result, changed: false };
      }
      this.writeDocumentUnlocked(filePath, principalKey, document);
      return { document, result, changed: true };
    });
  }

  buildMemoryItem(entry, document, now) {
    const kind = safeText(entry && entry.kind || "stable_preference", 40);
    if (FORBIDDEN_MEMORY_KINDS.includes(kind) || !ALLOWED_MEMORY_KINDS.includes(kind)) {
      throw typedError("Memory kind is forbidden", "MEMORY_KIND_FORBIDDEN", 400);
    }
    const key = safeText(entry && entry.key, 60);
    if (!ALLOWED_KEYS.includes(key)) throw typedError("Memory key is invalid", "MEMORY_KEY_INVALID", 400);
    const normalizedValue = normalizeValue(key, entry.normalizedValue !== undefined ? entry.normalizedValue : entry.value);
    if (normalizedValue === null) throw typedError("Memory value is invalid", "MEMORY_VALUE_INVALID", 400);
    const content = safeText(entry.content || `${key}=${String(normalizedValue)}`, 240);
    if (!content || SENSITIVE_PATTERN.test(`${key} ${content} ${JSON.stringify(normalizedValue)}`)) {
      throw typedError("Memory contains sensitive data", "MEMORY_SENSITIVE_REJECTED", 400);
    }
    const scope = ALLOWED_SCOPES.includes(entry.scope) ? entry.scope : "user";
    const requestedTtl = Number(entry.ttlMs || 0);
    const ttlMs = Number.isFinite(requestedTtl) && requestedTtl > 0
      ? Math.max(5 * 60 * 1000, Math.min(365 * 24 * 60 * 60 * 1000, requestedTtl))
      : (scope === "user" ? DEFAULT_MEMORY_TTL_MS : DEFAULT_EPISODE_TTL_MS);
    const explicitExpiry = Date.parse(entry.expiresAt || "");
    return normalizeStoredItem({
      memoryId: createId("mem"),
      kind,
      key,
      content,
      normalizedValue,
      provenance: normalizeProvenance(entry.provenance, now),
      confidence: Math.max(0, Math.min(1, Number(entry.confidence === undefined ? 0.9 : entry.confidence))),
      scope,
      expiresAt: Number.isFinite(explicitExpiry) ? new Date(explicitExpiry).toISOString() : new Date(this.clock.now() + ttlMs).toISOString(),
      supersedes: "",
      status: "active",
      termId: safeText(entry.termId, 60),
      releaseVersion: safeText(entry.releaseVersion, 100),
      revision: document.revision,
      createdAt: now,
      updatedAt: now,
      featureVector: encodeSemanticVector(`${key} ${content} ${String(normalizedValue)}`),
    });
  }

  upsertIntoDocument(document, entry, now, options = {}) {
    const memory = this.buildMemoryItem(entry, document, now);
    const nowMs = this.clock.now();
    const activeForKey = document.items.filter((item) => {
      if (item.key !== memory.key || item.status !== "active") return false;
      return isLiveEntry(item, nowMs, DEFAULT_MEMORY_TTL_MS);
    });
    const previous = activeForKey.at(-1);
    if (previous && valuesEqual(previous.normalizedValue, memory.normalizedValue)) {
      const confirmation = entry.confirmation === true || memory.provenance.type === "user_confirmation";
      if (!confirmation) {
        return {
          changed: false,
          persisted: false,
          reason: "MEMORY_DEDUPLICATED",
          memory: previous,
        };
      }
      previous.content = memory.content;
      previous.provenance = memory.provenance;
      previous.confidence = Math.max(previous.confidence, memory.confidence);
      previous.expiresAt = memory.expiresAt;
      previous.updatedAt = now;
      previous.revision = document.revision;
      previous.featureVector = memory.featureVector;
      audit(document, "confirm", previous.memoryId, now);
      return {
        changed: true,
        persisted: true,
        reason: "MEMORY_CONFIRMED",
        memory: previous,
      };
    }

    if (previous && entry.correction !== true) {
      const newExplicit = options.explicit === true || isExplicitProvenance(memory.provenance);
      const previousExplicit = isExplicitProvenance(previous.provenance);
      // Low#5 优先级：当前明确纠正 > 明确确认/手动编辑 > 已有 explicit >
      // 高置信 implicit > 低置信 implicit。implicit 永不覆盖有效 explicit，
      // 与置信度无关；冲突以结构化 reason 记录（不泄原文）。
      if (!newExplicit && previousExplicit) {
        return {
          changed: false,
          persisted: false,
          reason: "MEMORY_CONFLICT_LOWER_CONFIDENCE",
          memory: previous,
        };
      }
      if (!newExplicit && memory.confidence < previous.confidence) {
        return {
          changed: false,
          persisted: false,
          reason: "MEMORY_CONFLICT_LOWER_CONFIDENCE",
          memory: previous,
        };
      }
    }

    memory.supersedes = previous && previous.memoryId || "";
    activeForKey.forEach((item) => {
      item.status = "superseded";
      item.supersededBy = memory.memoryId;
      item.updatedAt = now;
      item.revision = document.revision;
    });
    document.items.push(memory);
    enforceCapacity(document, now);
    audit(document, "upsert", memory.memoryId, now);
    return { changed: true, persisted: true, reason: "", memory };
  }

  selectRelevantMemories(document, input = {}) {
    const query = safeText(`${input.query || ""} ${input.goal || ""}`, 600);
    const nowMs = this.clock.now();
    const limit = Math.max(1, Math.min(10, Number(input.limit || input.memoryLimit || 5)));
    return document.items.filter((item) => {
      return item.status === "active"
        && isLiveEntry(item, nowMs, DEFAULT_MEMORY_TTL_MS)
        && scopeMatches(item, input);
    }).map((item) => {
      const normalizedValue = item.normalizedValue === undefined || item.normalizedValue === null
        ? "" : String(item.normalizedValue);
      const documentText = `${item.key} ${item.content} ${normalizedValue} ${item.kind}`;
      const semantic = semanticScores(query, documentText, item.featureVector);
      const relevance = hasSemanticRelevance(item, input, semantic, query);
      if (!relevance.relevant) return null;
      const ageDays = Math.max(0, (nowMs - Date.parse(item.updatedAt || item.createdAt || 0)) / 86400000);
      const recency = Math.max(0, 1 - ageDays / 365);
      const scope = item.scope === "user" ? 1 : 0.8;
      const exact = relevance.exact ? 0.2 : 0;
      const score = semantic.lexical * 0.4 + semantic.vector * 0.35
        + item.confidence * 0.15 + recency * 0.05 + scope * 0.05 + exact;
      return {
        ...publicMemoryItem(item),
        score: Number(score.toFixed(6)),
        scoreBreakdown: { ...semantic, recency: Number(recency.toFixed(6)), confidence: item.confidence, scope, exact },
      };
    }).filter(Boolean)
      .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);
  }

  selectRelevantEpisodes(document, input = {}) {
    const query = safeText(`${input.query || ""} ${input.goal || ""}`, 600);
    const nowMs = this.clock.now();
    const limit = Math.max(1, Math.min(5, Number(input.limit || input.episodeLimit || 3)));
    return document.episodes.filter((episode) => {
      return ["active", "success"].includes(episode.status)
        && isLiveEntry(episode, nowMs, DEFAULT_EPISODE_TTL_MS)
        && scopeMatches(episode, input);
    }).map((episode) => {
      const scores = semanticScores(query, `${episode.goal} ${episode.outcomeSummary} ${JSON.stringify(episode.reusableConstraints)}`, episode.featureVector);
      const exactGoal = input.goal && String(input.goal) === episode.goal ? 0.3 : 0;
      if (!exactGoal && scores.lexical <= 0 && scores.vector < 0.28) return null;
      return {
        ...publicEpisode(episode),
        score: Number((scores.lexical * 0.45 + scores.vector * 0.45 + exactGoal + 0.1).toFixed(6)),
        scoreBreakdown: { ...scores, exactGoal },
      };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  prepareTurnSnapshot(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      const nowMs = this.clock.now();
      const allItems = document.items.filter((item) => {
        return item.status === "active"
          && isLiveEntry(item, nowMs, DEFAULT_MEMORY_TTL_MS)
          && scopeMatches(item, input);
      }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      return {
        success: true,
        schemaVersion: SCHEMA_VERSION,
        revision: document.revision,
        policy: { ...document.policy },
        values: Object.fromEntries(allItems.map((item) => [item.key, item.normalizedValue])),
        allItems: allItems.map(publicMemoryItem),
        items: this.selectRelevantMemories(document, {
          ...input,
          limit: input.memoryLimit || input.limit,
        }),
        episodes: this.selectRelevantEpisodes(document, {
          ...input,
          limit: input.episodeLimit,
        }),
      };
    });
  }

  getObject(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => activeValues(
      this.readDocumentUnlocked(filePath, principalKey),
      this.clock.now()
    ));
  }

  listMemoryItems(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      const nowMs = this.clock.now();
      const page = Math.max(1, Number(input.page || 1));
      const pageSize = Math.max(1, Math.min(100, Number(input.pageSize || 50)));
      const all = document.items.filter((item) => {
        if (input.includeInactive === true) return true;
        return item.status === "active" && isLiveEntry(item, nowMs, DEFAULT_MEMORY_TTL_MS);
      }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const start = (page - 1) * pageSize;
      return {
        success: true,
        schemaVersion: SCHEMA_VERSION,
        revision: document.revision,
        policy: { ...document.policy },
        page,
        pageSize,
        total: all.length,
        items: all.slice(start, start + pageSize).map(publicMemoryItem),
      };
    });
  }

  list(input = {}) {
    const listed = this.listMemoryItems(input);
    return {
      success: true,
      revision: listed.revision,
      policy: listed.policy,
      items: listed.items.map((item) => ({
        ...item,
        value: item.normalizedValue,
        scope: "cloud_sync",
        category: item.key === "preferredName" ? "称呼"
          : item.key === "campus" ? "校区"
            : item.key === "preferredBuilding" ? "常用楼栋"
              : item.key === "defaultReminderLeadMinutes" ? "默认提醒"
                : item.key === "answerDetailLevel" ? "回答偏好"
                  : item.key === "college" ? "学院"
                    : item.key === "major" ? "专业"
                      : item.key === "grade" ? "年级" : "偏好",
        editable: true,
      })),
    };
  }

  listEpisodes(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      const nowMs = this.clock.now();
      const page = Math.max(1, Number(input.page || 1));
      const pageSize = Math.max(1, Math.min(100, Number(input.pageSize || 50)));
      const all = document.episodes.filter((episode) => {
        if (input.includeInactive === true) return true;
        return ["active", "success"].includes(episode.status)
          && isLiveEntry(episode, nowMs, DEFAULT_EPISODE_TTL_MS);
      }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      const start = (page - 1) * pageSize;
      return {
        success: true,
        schemaVersion: SCHEMA_VERSION,
        revision: document.revision,
        page,
        pageSize,
        total: all.length,
        items: all.slice(start, start + pageSize).map(publicEpisode),
      };
    });
  }

  getManagementSnapshot(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      const nowMs = this.clock.now();
      const includeInactive = input.includeInactive === true;
      const itemVisible = (item) => {
        if (includeInactive) return true;
        return item.status === "active" && isLiveEntry(item, nowMs, DEFAULT_MEMORY_TTL_MS);
      };
      const episodeVisible = (episode) => {
        if (includeInactive) return true;
        return ["active", "success"].includes(episode.status)
          && isLiveEntry(episode, nowMs, DEFAULT_EPISODE_TTL_MS);
      };
      return {
        success: true,
        schemaVersion: SCHEMA_VERSION,
        revision: document.revision,
        policy: { ...document.policy },
        items: document.items.filter(itemVisible).map(publicMemoryItem),
        episodes: document.episodes.filter(episodeVisible).map(publicEpisode),
        audit: document.audit.map(publicAudit),
      };
    });
  }

  upsertMemory(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mode = String(input.memoryMode || "local_only");
    if (mode !== "cloud_sync") {
      return { success: true, persisted: false, reason: mode === "session_state" ? "session_state_no_user_memory" : "local_only" };
    }
    const mutation = this.mutate(principalKey, input, (document, now) => {
      if (input.explicit !== true && (document.policy.paused || !document.policy.autoMemoryEnabled)) {
        return { changed: false, persisted: false, reason: "MEMORY_PAUSED" };
      }
      return this.upsertIntoDocument(document, input.entry || {}, now, { explicit: input.explicit === true });
    });
    return {
      success: true,
      persisted: mutation.result.persisted === true,
      reason: mutation.result.reason || "",
      memory: mutation.result.memory ? publicMemoryItem(mutation.result.memory) : undefined,
      revision: mutation.document.revision,
    };
  }

  upsertMemoryBatch(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mode = String(input.memoryMode || "local_only");
    if (mode !== "cloud_sync") {
      return {
        success: true,
        persisted: false,
        reason: mode === "session_state" ? "session_state_no_user_memory" : "local_only",
        items: [],
      };
    }
    const entries = Array.isArray(input.entries) ? input.entries.slice(0, 20) : [];
    if (!entries.length) return { success: true, persisted: false, reason: "MEMORY_BATCH_EMPTY", items: [] };
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const results = entries.map((entry) => {
        const explicit = entry && entry.explicit === true
          || input.explicit === true
          || isExplicitProvenance(entry && entry.provenance || {});
        if (!explicit && (document.policy.paused || !document.policy.autoMemoryEnabled)) {
          return { changed: false, persisted: false, reason: "MEMORY_PAUSED" };
        }
        return this.upsertIntoDocument(document, entry || {}, now, { explicit });
      });
      return {
        changed: results.some((result) => result.changed !== false),
        results,
      };
    });
    const persisted = mutation.result.results.filter((result) => result.persisted && result.memory);
    return {
      success: true,
      persisted: persisted.length > 0,
      reason: persisted.length ? "" : (mutation.result.results[0] && mutation.result.results[0].reason || ""),
      items: persisted.map((result) => publicMemoryItem(result.memory)),
      results: mutation.result.results.map((result) => ({
        persisted: result.persisted === true,
        reason: result.reason || "",
        memory: result.memory ? publicMemoryItem(result.memory) : undefined,
      })),
      revision: mutation.document.revision,
    };
  }

  upsert(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mode = String(input.memoryMode || "local_only");
    if (input.explicit !== true || mode !== "cloud_sync") {
      return { success: true, persisted: false, reason: mode === "local_only" ? "local_only" : (mode === "session_state" ? "session_state_no_user_memory" : "not_authorized") };
    }
    const source = input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values : { [input.key]: input.value };
    const entries = Object.entries(source).map(([key, value]) => ({
      key,
      value: normalizeValue(key, value),
    })).filter((item) => ALLOWED_KEYS.includes(item.key) && item.value !== null);
    if (!entries.length) throw typedError("Preference is invalid", "PREFERENCE_INVALID", 400);
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const results = entries.map(({ key, value }) => this.upsertIntoDocument(document, {
        kind: key === "preferredName" ? "identity_alias" : (key === "answerDetailLevel" ? "interaction_preference" : "stable_preference"),
        key,
        normalizedValue: value,
        content: `${key}=${String(value)}`,
        provenance: { type: input.autoMemory ? "auto_extract" : "user_explicit", recordedAt: now },
        confidence: input.autoMemory ? 0.9 : 1,
        scope: "user",
      }, now, { explicit: input.autoMemory !== true }));
      return {
        changed: results.some((result) => result.changed !== false),
        items: results.filter((result) => result.persisted).map((result) => result.memory),
      };
    });
    return {
      success: true,
      persisted: mutation.changed === true,
      keys: mutation.changed ? entries.map((item) => item.key) : [],
      revision: mutation.document.revision,
    };
  }

  retrieveMemories(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      return { success: true, revision: document.revision, items: this.selectRelevantMemories(document, input) };
    });
  }

  /**
   * Episode 准入校验（verified/可复用/禁敏），供 appendEpisode 与
   * applyMutationPlan 共用，保证单 Turn 原子提交与独立提交同一套规则。
   */
  checkEpisodeInput(episodeInput = {}, verified) {
    const isVerified = verified === true || episodeInput.verified === true
      || Boolean(episodeInput.verification && episodeInput.verification.ok === true);
    if (episodeInput.status !== "success" || !isVerified) {
      return { ok: false, reason: "EPISODE_NOT_VERIFIED" };
    }
    if (!episodeInput.goal || !episodeInput.outcomeSummary || /weather|天气/i.test(episodeInput.goal)) {
      return { ok: false, reason: "EPISODE_NOT_REUSABLE" };
    }
    const serialized = `${episodeInput.goal} ${episodeInput.outcomeSummary} ${JSON.stringify(episodeInput.reusableConstraints || {})}`;
    if (SENSITIVE_PATTERN.test(serialized) || /raw[_ ]?tool|完整课表|hidden reasoning/i.test(serialized)) {
      return { ok: false, reason: "EPISODE_FORBIDDEN" };
    }
    return { ok: true, reason: "", serialized };
  }

  /**
   * 在已持有锁的 document 上去重并追加 Episode（provenanceRunId 幂等）。
   * 重试场景在最新 document 上重跑，天然防重复。
   */
  appendEpisodeIntoDocument(document, episodeInput, now, serialized) {
    const duplicate = episodeInput.provenanceRunId && document.episodes.find((episode) => (
      episode.provenanceRunId === safeText(episodeInput.provenanceRunId, 100)
      && ["active", "success"].includes(episode.status)
    ));
    if (duplicate) {
      return { changed: false, persisted: false, reason: "EPISODE_DEDUPLICATED", episode: duplicate };
    }
    const episode = normalizeStoredEpisode({
      episodeId: createId("episode"),
      goal: episodeInput.goal,
      outcomeSummary: episodeInput.outcomeSummary,
      reusableConstraints: episodeInput.reusableConstraints,
      provenanceRunId: episodeInput.provenanceRunId,
      expiresAt: episodeInput.expiresAt || new Date(this.clock.now() + DEFAULT_EPISODE_TTL_MS).toISOString(),
      status: "success",
      termId: episodeInput.termId,
      releaseVersion: episodeInput.releaseVersion,
      revision: document.revision,
      createdAt: now,
      updatedAt: now,
      featureVector: encodeSemanticVector(serialized),
    });
    document.episodes.push(episode);
    enforceCapacity(document, now);
    audit(document, "append_episode", episode.episodeId, now);
    return { changed: true, persisted: true, reason: "", episode };
  }

  appendEpisode(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    if (String(input.memoryMode || "local_only") !== "cloud_sync") {
      return { success: true, persisted: false, reason: "not_cloud_sync" };
    }
    const episodeInput = input.episode || {};
    const check = this.checkEpisodeInput(episodeInput, input.verified === true);
    if (!check.ok) {
      return { success: true, persisted: false, reason: check.reason };
    }
    const mutation = this.mutate(principalKey, input, (document, now) => {
      if (document.policy.paused || !document.policy.autoMemoryEnabled) {
        return { changed: false, persisted: false, reason: "MEMORY_PAUSED" };
      }
      return this.appendEpisodeIntoDocument(document, episodeInput, now, check.serialized);
    });
    return {
      success: true,
      persisted: mutation.result.persisted === true,
      reason: mutation.result.reason || "",
      episode: mutation.result.episode ? publicEpisode(mutation.result.episode) : undefined,
      revision: mutation.document.revision,
    };
  }

  /**
   * 单 Turn Mutation Plan 的权威落点（M1）：偏好/约束/Episode 三类变更在
   * 同一把锁、同一个 revision 内一次原子写入（all-or-nothing）。
   * expectedRevision 乐观并发由 mutate 统一校验；冲突重试时的回调会在
   * 最新 document 上重跑 supersede/去重/TTL/scope/confidence/容量/Episode 合并。
   */
  applyMutationPlan(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mode = String(input.memoryMode || "local_only");
    if (mode !== "cloud_sync") {
      return {
        success: true,
        persisted: false,
        reason: mode === "session_state" ? "session_state_no_user_memory" : "local_only",
        items: [],
        results: [],
        episode: { persisted: false, reason: "not_cloud_sync" },
      };
    }
    const entries = Array.isArray(input.entries) ? input.entries.slice(0, 20) : [];
    const episodeInput = input.episode && typeof input.episode === "object" ? input.episode : null;
    const episodeCheck = episodeInput
      ? this.checkEpisodeInput(episodeInput, input.verified === true)
      : null;
    if (!entries.length && !(episodeCheck && episodeCheck.ok)) {
      return {
        success: true,
        persisted: false,
        reason: episodeCheck && !episodeCheck.ok ? episodeCheck.reason : "MEMORY_BATCH_EMPTY",
        items: [],
        results: [],
        episode: episodeInput ? { persisted: false, reason: episodeCheck.reason } : { persisted: false, reason: "not_successful_task" },
      };
    }
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const results = entries.map((entry) => {
        const explicit = entry && entry.explicit === true
          || input.explicit === true
          || isExplicitProvenance(entry && entry.provenance || {});
        // pause/autoMemoryEnabled=false 只挡 implicit 写入；explicit 豁免（Low#5）。
        if (!explicit && (document.policy.paused || !document.policy.autoMemoryEnabled)) {
          return { changed: false, persisted: false, reason: "MEMORY_PAUSED" };
        }
        return this.upsertIntoDocument(document, entry || {}, now, { explicit });
      });
      let episodeResult = null;
      if (episodeInput) {
        if (!episodeCheck.ok) {
          episodeResult = { changed: false, persisted: false, reason: episodeCheck.reason };
        } else if (document.policy.paused || !document.policy.autoMemoryEnabled) {
          // Episode 属于自动写入，pause 时停止（Low#5）。
          episodeResult = { changed: false, persisted: false, reason: "MEMORY_PAUSED" };
        } else {
          episodeResult = this.appendEpisodeIntoDocument(document, episodeInput, now, episodeCheck.serialized);
        }
      }
      const changed = results.some((result) => result.changed !== false)
        || Boolean(episodeResult && episodeResult.changed !== false);
      return { changed, results, episodeResult };
    });
    const persisted = mutation.result.results.filter((result) => result.persisted && result.memory);
    const episodeResult = mutation.result.episodeResult || null;
    return {
      success: true,
      persisted: persisted.length > 0 || Boolean(episodeResult && episodeResult.persisted),
      reason: persisted.length ? "" : (mutation.result.results[0] && mutation.result.results[0].reason || ""),
      items: persisted.map((result) => publicMemoryItem(result.memory)),
      results: mutation.result.results.map((result) => ({
        persisted: result.persisted === true,
        reason: result.reason || "",
        memory: result.memory ? publicMemoryItem(result.memory) : undefined,
      })),
      episode: episodeInput
        ? {
          persisted: episodeResult && episodeResult.persisted === true,
          reason: episodeResult && episodeResult.reason || "",
          episode: episodeResult && episodeResult.episode ? publicEpisode(episodeResult.episode) : undefined,
        }
        : { persisted: false, reason: "not_successful_task" },
      revision: mutation.document.revision,
    };
  }

  /**
   * 轻量读取当前 revision 与 policyVersion（revision 冲突后的重读基线）。
   * 只返回非敏感标识，不投影记忆正文。
   */
  readRevision(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      return {
        success: true,
        revision: document.revision,
        policyVersion: safeText(document.policy && document.policy.configVersion || "", 100),
      };
    });
  }

  retrieveEpisodes(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      return { success: true, revision: document.revision, items: this.selectRelevantEpisodes(document, input) };
    });
  }

  invalidateContext(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const invalidatedIds = [];
      document.items.forEach((item) => {
        const termChanged = item.scope === "term" && item.termId && input.termId && item.termId !== input.termId;
        const releaseChanged = item.scope === "release" && (
          item.termId && input.termId && item.termId !== input.termId
          || item.releaseVersion && input.releaseVersion && item.releaseVersion !== input.releaseVersion
        );
        if (item.status === "active" && (termChanged || releaseChanged)) {
          item.status = "expired_context";
          item.updatedAt = now;
          item.revision = document.revision;
          invalidatedIds.push(item.memoryId);
        }
      });
      document.episodes.forEach((episode) => {
        const changed = episode.status !== "expired_context" && (
          episode.termId && input.termId && episode.termId !== input.termId
          || episode.releaseVersion && input.releaseVersion && episode.releaseVersion !== input.releaseVersion
        );
        if (changed) {
          episode.status = "expired_context";
          episode.updatedAt = now;
          episode.revision = document.revision;
          invalidatedIds.push(episode.episodeId);
        }
      });
      if (!invalidatedIds.length) return { changed: false, invalidatedIds };
      audit(document, "invalidate_context", invalidatedIds.join(","), now);
      return { changed: true, invalidatedIds };
    });
    return { success: true, revision: mutation.document.revision, invalidatedIds: mutation.result.invalidatedIds };
  }

  setMemoryPolicy(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const patch = input.patch && typeof input.patch === "object" ? input.patch : {};
    const mutation = this.mutate(principalKey, input, (document, now) => {
      let changed = false;
      const apply = (key, value) => {
        if (document.policy[key] === value) return;
        document.policy[key] = value;
        changed = true;
      };
      if (patch.autoMemoryEnabled !== undefined) apply("autoMemoryEnabled", patch.autoMemoryEnabled === true);
      if (patch.paused !== undefined) apply("paused", patch.paused === true);
      if (patch.capacity !== undefined) {
        const parsed = Number(patch.capacity);
        apply("capacity", Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.round(parsed))) : DEFAULT_MEMORY_CAPACITY);
      }
      if (patch.episodeCapacity !== undefined) {
        const parsed = Number(patch.episodeCapacity);
        apply("episodeCapacity", Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.round(parsed))) : DEFAULT_EPISODE_CAPACITY);
      }
      if (patch.configVersion !== undefined) apply("configVersion", safeText(patch.configVersion, 100) || document.policy.configVersion);
      changed = enforceCapacity(document, now) || changed;
      if (!changed) return { changed: false, policy: { ...document.policy } };
      document.policy.updatedAt = now;
      audit(document, document.policy.paused ? "pause" : "update_policy", "policy", now);
      return { changed: true, policy: { ...document.policy } };
    });
    return { success: true, revision: mutation.document.revision, policy: mutation.result.policy };
  }

  patchMemory(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const item = document.items.find((candidate) => candidate.memoryId === input.memoryId);
      if (!item) throw typedError("Memory not found", "MEMORY_NOT_FOUND", 404);
      const patch = input.patch && typeof input.patch === "object" ? input.patch : {};
      const normalizedValue = normalizeValue(item.key, patch.normalizedValue !== undefined ? patch.normalizedValue : item.normalizedValue);
      if (normalizedValue === null) throw typedError("Memory value is invalid", "MEMORY_VALUE_INVALID", 400);
      const content = safeText(patch.content !== undefined ? patch.content : item.content, 240);
      if (!content || SENSITIVE_PATTERN.test(`${content} ${JSON.stringify(normalizedValue)}`)) throw typedError("Memory contains sensitive data", "MEMORY_SENSITIVE_REJECTED", 400);
      item.content = content;
      item.normalizedValue = normalizedValue;
      item.confidence = 1;
      item.provenance = normalizeProvenance({ type: "user_edit", sourceId: input.memoryId }, now);
      item.expiresAt = new Date(this.clock.now() + (item.scope === "user" ? DEFAULT_MEMORY_TTL_MS : DEFAULT_EPISODE_TTL_MS)).toISOString();
      item.updatedAt = now;
      item.revision = document.revision;
      item.featureVector = encodeSemanticVector(`${item.key} ${content} ${String(normalizedValue)}`);
      audit(document, "patch", item.memoryId, now);
      return { memory: item };
    });
    return { success: true, revision: mutation.document.revision, memory: publicMemoryItem(mutation.result.memory) };
  }

  deleteMemory(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const before = document.items.length;
      document.items = document.items.filter((item) => item.memoryId !== input.memoryId);
      const deleted = document.items.length !== before;
      if (!deleted) throw typedError("Memory not found", "MEMORY_NOT_FOUND", 404);
      audit(document, "delete", input.memoryId, now);
      return { deleted };
    });
    return { success: true, revision: mutation.document.revision, deleted: mutation.result.deleted };
  }

  deleteEpisode(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const episodeId = safeText(input.episodeId, 100);
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const before = document.episodes.length;
      document.episodes = document.episodes.filter((episode) => episode.episodeId !== episodeId);
      const deleted = document.episodes.length !== before;
      // Low#2：与 deleteMemory 统一语义，未找到即 404。
      if (!deleted) throw typedError("Episode not found", "EPISODE_NOT_FOUND", 404);
      audit(document, "delete_episode", episodeId, now);
      return { changed: true, deleted: true };
    });
    return {
      success: true,
      revision: mutation.document.revision,
      deleted: mutation.result.deleted === true,
    };
  }

  exportMemories(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      return {
        schemaVersion: "user-memory.export.v1",
        exportedAt: this.nowIso(),
        revision: document.revision,
        policy: { ...document.policy },
        items: document.items.map(publicMemoryItem),
        episodes: document.episodes.map(publicEpisode),
        audit: document.audit.map(publicAudit),
      };
    });
  }

  remove(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const key = String(input.key || "");
    if (!ALLOWED_KEYS.includes(key)) throw typedError("Preference key is invalid", "PREFERENCE_KEY_INVALID", 400);
    const mutation = this.mutate(principalKey, input, (document, now) => {
      const before = document.items.length;
      document.items = document.items.filter((item) => item.key !== key);
      const deleted = document.items.length !== before;
      if (!deleted) return { changed: false, deleted: false };
      audit(document, "delete_key", key, now);
      return { changed: true, deleted };
    });
    return { success: true, deleted: mutation.result.deleted, revision: mutation.document.revision };
  }

  clear(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    this.assertWritable();
    return this.withLock(principalKey, (filePath) => {
      const document = this.readDocumentUnlocked(filePath, principalKey);
      assertExpectedRevision(document, input.expectedRevision);
      const deleted = document.items.length + document.episodes.length;
      if (!deleted) return { success: true, deleted: 0, revision: document.revision };
      document.revision += 1;
      document.items = [];
      document.episodes = [];
      const now = this.nowIso();
      audit(document, "clear", "all", now);
      this.writeDocumentUnlocked(filePath, principalKey, document);
      return { success: true, deleted, revision: document.revision };
    });
  }
}

const defaultUserPreferenceService = new UserPreferenceService();

module.exports = {
  ALLOWED_KEYS,
  UserPreferenceService,
  defaultUserPreferenceService,
  normalizeValue,
};
