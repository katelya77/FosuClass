const crypto = require("crypto");

const CONTEXT_SCHEMA_VERSION = "agent-context.v2";
const OWNER = "@xiaofu-agent/agent-runtime";
const DEFAULT_CONTEXT_TOKEN_BUDGET = 2400;
const SECTION_ORDER = Object.freeze([
  "safety",
  "currentTurn",
  "pending",
  "workingState",
  "recentMessages",
  "rollingSummary",
  "memories",
  "episodes",
  "rag",
]);

const SENSITIVE_KEY = /(password|passwd|pwd|cookie|authorization|api[-_]?key|secret|token|ticket|credential)/i;
const FORBIDDEN_CONTEXT_KEY = /(rawTool|toolResult|fullSchedule|currentScheduleSummary|hiddenReason|chainOfThought|systemPrompt|courses)/i;

// ADR-0006 Memory-to-Provider boundary (layer 1): only memories/episodes that
// pass every admission gate below may enter the provider-safe projection.
const MEMORY_PROJECTION_POLICY_VERSION = "memory-provider-boundary.v1";
const MEMORY_MIN_CONFIDENCE = 0.5;
const PROVIDER_MEMORY_KINDS = new Set([
  "stable_preference",
  "identity_alias",
  "interaction_preference",
  "task_constraint",
]);
const FORBIDDEN_MEMORY_KINDS = new Set([
  "schedule_snapshot",
  "weather",
  "credential",
  "raw_tool_output",
  "hidden_reasoning",
]);
const PROVIDER_MEMORY_SCOPES = new Set(["user", "term", "release"]);
const PROVIDER_EPISODE_CONSTRAINT_KEYS = Object.freeze([
  "campus", "building", "duration", "weekday", "period", "type", "targetName",
]);
const SHORT_LIVED_EPISODE_GOAL = /(weather|天气)/i;
// Credential-shaped assignments that the generic redactor does not cover
// (e.g. bare `session=...`). Redaction is detection here, never sanitization:
// a memory whose raw text matches is excluded whole, not redacted-and-kept.
const MEMORY_CREDENTIAL_ASSIGNMENT = /(password|passwd|pwd|cookie|session|token|ticket|authorization|api[-_]?key|secret|credential|private[-_]?key|密码|口令|学号|身份证)\s*[:：=是为]\s*\S{2,}|验证码\s*[:：=是为]?\s*\d{4,8}/i;

function estimateContextTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 2 + other / 4);
}

function defaultRedact(value) {
  return String(value == null ? "" : value)
    .replace(/((?:password|passwd|pwd|cookie|authorization|api[-_]?key|secret|token|ticket|credential)\s*[:=]\s*)[^\s,，。;；]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b1\d{10}\b/g, "[redacted-phone]")
    .replace(/\b\d{17}[\dXx]\b/g, "[redacted-id]");
}

function safeText(redact, value, max = 400) {
  return redact(value).trim().slice(0, max);
}

function safeScalar(redact, value, max = 120) {
  if (value == null || value === "") return null;
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? safeText(redact, value, max) : value;
  }
  return null;
}

function safeFlatObject(redact, value, allowedKeys, max = 120) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = {};
  allowedKeys.forEach((key) => {
    if (SENSITIVE_KEY.test(key) || FORBIDDEN_CONTEXT_KEY.test(key)) return;
    const normalized = safeScalar(redact, value[key], max);
    if (normalized !== null) output[key] = normalized;
  });
  return Object.keys(output).length ? output : null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function parseExpiryTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value);
  if (/^\d{10,16}$/.test(text)) return Number(text);
  return Date.parse(text);
}

function memoryTextIsClean(redact, value) {
  if (value === undefined || value === null) return true;
  const text = String(value);
  return redact(text) === text && !MEMORY_CREDENTIAL_ASSIGNMENT.test(text);
}

function runtimeBinding(input = {}) {
  const runtime = input.runtimeContext && typeof input.runtimeContext === "object" ? input.runtimeContext : {};
  const working = input.workingState && typeof input.workingState === "object" ? input.workingState : {};
  return {
    term: String(runtime.term || working.term || ""),
    releaseVersion: String(runtime.releaseVersion || working.releaseVersion || ""),
  };
}

function scopeBindingReason(item, binding) {
  const scope = String(item.scope || "user").trim() || "user";
  if (!PROVIDER_MEMORY_SCOPES.has(scope)) return "scope";
  if (scope === "user") return null;
  const declaredTerm = String(item.termId || "");
  const declaredRelease = String(item.releaseVersion || "");
  if (!declaredTerm && !declaredRelease) return "scope";
  if (declaredTerm && (!binding.term || binding.term !== declaredTerm)) return "scope";
  if (declaredRelease && (!binding.releaseVersion || binding.releaseVersion !== declaredRelease)) return "scope";
  return null;
}

function sharedAdmissionReason(item, now, idKey) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "schema";
  if (!item[idKey]) return "schema";
  const status = String(item.status || (idKey === "episodeId" ? "success" : "active"));
  if (status === "superseded" || item.supersededBy) return "superseded";
  if (status === "expired" || status === "expired_context") return "expired";
  if (status !== "active" && status !== "success") return "schema";
  if (item.expiresAt === undefined || item.expiresAt === null || item.expiresAt === "") return "expired";
  const expiresAt = parseExpiryTimestamp(item.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return "expired";
  return null;
}

function memoryExclusionReason(redact, item, now, binding) {
  const shared = sharedAdmissionReason(item, now, "memoryId");
  if (shared) return shared;
  const kind = String(item.kind || "stable_preference");
  if (FORBIDDEN_MEMORY_KINDS.has(kind)) return "sensitivity";
  if (!PROVIDER_MEMORY_KINDS.has(kind)) return "schema";
  const scopeReason = scopeBindingReason(item, binding);
  if (scopeReason) return scopeReason;
  const provenance = item.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)
    || !String(provenance.type || "").trim()) return "provenance";
  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < MEMORY_MIN_CONFIDENCE) return "confidence";
  if (item.sensitivity !== undefined && item.sensitivity !== null
    && String(item.sensitivity) !== "low") return "sensitivity";
  if (!memoryTextIsClean(redact, item.key)) return "sensitivity";
  if (!memoryTextIsClean(redact, item.content)) return "sensitivity";
  if (typeof item.normalizedValue === "string" && !memoryTextIsClean(redact, item.normalizedValue)) return "sensitivity";
  return null;
}

function episodeExclusionReason(redact, item, now, binding) {
  const shared = sharedAdmissionReason(item, now, "episodeId");
  if (shared) return shared;
  const goal = String(item.goal || "");
  if (!goal || !String(item.outcomeSummary || "")) return "schema";
  if (SHORT_LIVED_EPISODE_GOAL.test(goal)) return "sensitivity";
  const declaredTerm = String(item.termId || "");
  const declaredRelease = String(item.releaseVersion || "");
  if (declaredTerm && (!binding.term || binding.term !== declaredTerm)) return "scope";
  if (declaredRelease && (!binding.releaseVersion || binding.releaseVersion !== declaredRelease)) return "scope";
  if (!memoryTextIsClean(redact, goal)) return "sensitivity";
  if (!memoryTextIsClean(redact, item.outcomeSummary)) return "sensitivity";
  const constraints = item.reusableConstraints;
  if (constraints !== undefined && constraints !== null) {
    if (typeof constraints !== "object" || Array.isArray(constraints)) return "schema";
    if (Object.keys(constraints).some((key) => SENSITIVE_KEY.test(key) || FORBIDDEN_CONTEXT_KEY.test(key))) {
      return "sensitivity";
    }
    const dirty = Object.entries(constraints).some(([key, value]) => (
      PROVIDER_EPISODE_CONSTRAINT_KEYS.includes(key)
      && typeof value === "string"
      && !memoryTextIsClean(redact, value)
    ));
    if (dirty) return "sensitivity";
  }
  return null;
}

function recordExclusion(audit, reason) {
  audit.excluded[reason] = (audit.excluded[reason] || 0) + 1;
}

function normalizeMemories(redact, items, now, binding, audit) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const reason = memoryExclusionReason(redact, item, now, binding);
      if (reason) {
        recordExclusion(audit, reason);
        return null;
      }
      return item;
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 5)
    .map((item) => ({
      memoryId: safeText(redact, item.memoryId, 100),
      kind: safeText(redact, item.kind || "stable_preference", 40),
      key: safeText(redact, item.key || "", 60),
      content: safeText(redact, item.content || `${item.key || "memory"}=${String(item.normalizedValue || "")}`, 240),
      normalizedValue: safeScalar(redact, item.normalizedValue, 120),
      confidence: Math.max(0, Math.min(1, Number(item.confidence || 0))),
      scope: safeText(redact, item.scope || "user", 30),
      score: Math.max(0, Number(item.score || 0)),
    }));
}

function normalizeEpisodes(redact, items, now, binding, audit) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const reason = episodeExclusionReason(redact, item, now, binding);
      if (reason) {
        recordExclusion(audit, reason);
        return null;
      }
      return item;
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 3)
    .map((item) => ({
      episodeId: safeText(redact, item.episodeId, 100),
      goal: safeText(redact, item.goal || "", 100),
      outcomeSummary: safeText(redact, item.outcomeSummary || "", 240),
      reusableConstraints: safeFlatObject(redact, item.reusableConstraints, PROVIDER_EPISODE_CONSTRAINT_KEYS, 100),
      score: Math.max(0, Number(item.score || 0)),
    }));
}

function normalizeRecentMessages(redact, messages, maxMessages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-Math.max(8, Math.min(12, maxMessages)))
    .map((message) => ({
      id: safeText(redact, message && (message.id || message.turnId) || "", 64),
      role: message && message.role === "assistant" ? "assistant" : "user",
      content: safeText(redact, message && (message.content || message.text) || "", 400),
    }))
    .filter((message) => message.content);
}

function isPendingItemFresh(item, now) {
  if (!item || typeof item !== "object") return false;
  if (!item.expiresAt) return true;
  const rawExpiry = item.expiresAt;
  const expiresAt = typeof rawExpiry === "number" && Number.isFinite(rawExpiry)
    ? rawExpiry
    : (/^\d{10,16}$/.test(String(rawExpiry || ""))
      ? Number(rawExpiry)
      : Date.parse(rawExpiry));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function normalizePending(redact, input = {}, now) {
  const hadClarification = Boolean(input.pendingClarification && typeof input.pendingClarification === "object");
  const hadAction = Boolean(input.pendingAction && typeof input.pendingAction === "object");
  const clarificationFresh = isPendingItemFresh(input.pendingClarification, now);
  const actionFresh = isPendingItemFresh(input.pendingAction, now);
  const clarificationInput = clarificationFresh
    ? input.pendingClarification
    : null;
  const actionInput = actionFresh
    ? input.pendingAction
    : null;
  const clarification = safeFlatObject(redact, clarificationInput, [
    "intentName", "type", "missing", "createdAt", "expiresAt",
  ], 100);
  const action = actionInput
    ? {
      ...(safeFlatObject(redact, actionInput, ["command", "status", "runId", "createdAt", "expiresAt"], 128) || {}),
      target: safeFlatObject(redact, actionInput.target, ["type", "detailId", "name", "term"], 128),
    }
    : null;
  return {
    clarification,
    action: action && Object.values(action).some(Boolean) ? action : null,
    clarificationExpired: hadClarification && !clarificationFresh,
    actionExpired: hadAction && !actionFresh,
  };
}

function normalizeWorkingState(redact, input = {}) {
  const working = input.workingState && typeof input.workingState === "object" ? input.workingState : {};
  const runtime = input.runtimeContext && typeof input.runtimeContext === "object" ? input.runtimeContext : {};
  const target = working.currentScheduleTarget || working.scheduleTarget;
  const output = {
    activeGoal: safeText(redact, working.activeGoal || working.currentGoal || "", 100),
    campus: safeText(redact, working.campus || runtime.campus || "", 40),
    className: safeText(redact, working.className || "", 100),
    teacherName: safeText(redact, working.teacherName || "", 80),
    courseName: safeText(redact, working.courseName || "", 100),
    classroom: safeText(redact, working.classroom || "", 80),
    teachingWeek: Number(working.teachingWeek || runtime.currentTeachingWeek) || null,
    weekday: Number(working.weekday || runtime.todayWeekday) || null,
    periodHint: safeText(redact, working.periodHint || "", 40),
    currentPage: safeText(redact, runtime.currentPage || "", 160),
    todayDate: safeText(redact, runtime.todayDate || "", 20),
    currentTeachingWeek: Number(runtime.currentTeachingWeek) || null,
    term: safeText(redact, runtime.term || "", 40),
    releaseVersion: safeText(redact, runtime.releaseVersion || "", 100),
    scheduleTarget: safeFlatObject(redact, target, ["type", "detailId", "name", "term"], 128),
    personalScheduleAvailable: working.personalScheduleAvailable === true
      || runtime.personalScheduleAvailable === true,
  };
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== "" && value !== null));
}

function normalizeRag(redact, items) {
  return (Array.isArray(items) ? items : []).slice(0, 4).map((item) => ({
    citationId: safeText(redact, item && (item.citationId || item.id) || "", 100),
    title: safeText(redact, item && item.title || "", 120),
    snippet: safeText(redact, item && (item.snippet || item.content) || "", 240),
  })).filter((item) => item.citationId && item.snippet);
}

function normalizeManifest(redact, value) {
  const manifest = value && typeof value === "object" ? value : {};
  const normalizeIds = (items) => Array.from(new Set((Array.isArray(items) ? items : [])
    .slice(0, 128)
    .map((item) => safeText(redact, item, 120))
    .filter(Boolean)));
  return {
    version: safeText(redact, manifest.version || "", 100),
    allowedSkillIds: normalizeIds(manifest.allowedSkillIds || manifest.skillIds),
    allowedToolIds: normalizeIds(manifest.allowedToolIds || manifest.toolIds),
  };
}

function buildBudgetPayload(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    owner: snapshot.owner,
    sectionOrder: snapshot.sectionOrder,
    assembledAt: snapshot.assembledAt,
    config: snapshot.config,
    safety: snapshot.safety,
    manifest: snapshot.manifest,
    currentTurn: snapshot.currentTurn,
    pending: snapshot.pending,
    workingState: snapshot.workingState,
    recentMessages: snapshot.recentMessages,
    rollingSummary: snapshot.rollingSummary,
    memories: snapshot.memories,
    episodes: snapshot.episodes,
    rag: snapshot.rag,
    selectedMemoryIds: snapshot.memories.map((item) => item.memoryId),
    selectedEpisodeIds: snapshot.episodes.map((item) => item.episodeId),
  };
}

function truncateText(text, maxLength) {
  const value = String(text || "");
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function shrinkToBudget(snapshot, budget) {
  const truncated = new Set();
  const size = () => estimateContextTokens(buildBudgetPayload(snapshot));
  const mark = (section) => truncated.add(section);

  while (size() > budget && snapshot.rag.length) {
    snapshot.rag.pop();
    mark("rag");
  }
  while (size() > budget && snapshot.episodes.length) {
    snapshot.episodes.pop();
    mark("episodes");
  }
  while (size() > budget && snapshot.memories.length) {
    snapshot.memories.pop();
    mark("memories");
  }
  while (size() > budget && snapshot.recentMessages.length > 8) {
    snapshot.recentMessages.shift();
    mark("recentMessages");
  }

  [600, 300, 160, 80, 0].forEach((maxLength) => {
    if (size() <= budget || snapshot.rollingSummary.length <= maxLength) return;
    snapshot.rollingSummary = truncateText(snapshot.rollingSummary, maxLength);
    mark("rollingSummary");
  });

  [240, 160, 80, 40].forEach((maxLength) => {
    if (size() <= budget) return;
    let changed = false;
    snapshot.recentMessages = snapshot.recentMessages.map((message) => {
      if (message.content.length <= maxLength) return message;
      changed = true;
      return { ...message, content: truncateText(message.content, maxLength) };
    });
    if (changed) mark("recentMessages");
  });
  while (size() > budget && snapshot.recentMessages.length) {
    snapshot.recentMessages.shift();
    mark("recentMessages");
  }

  [800, 400, 200, 100, 40, 0].forEach((maxLength) => {
    if (size() <= budget || snapshot.currentTurn.message.length <= maxLength) return;
    snapshot.currentTurn.message = truncateText(snapshot.currentTurn.message, maxLength);
    mark("currentTurn");
  });

  const optionalWorkingKeys = [
    "periodHint", "classroom", "courseName", "teacherName", "className", "campus",
    "currentPage", "todayDate", "weekday", "teachingWeek", "currentTeachingWeek",
    "releaseVersion", "term", "scheduleTarget", "activeGoal",
  ];
  optionalWorkingKeys.forEach((key) => {
    if (size() <= budget || !Object.prototype.hasOwnProperty.call(snapshot.workingState, key)) return;
    delete snapshot.workingState[key];
    mark("workingState");
  });

  while (size() > budget && snapshot.manifest.allowedToolIds.length) {
    snapshot.manifest.allowedToolIds.pop();
    mark("manifest");
  }
  while (size() > budget && snapshot.manifest.allowedSkillIds.length) {
    snapshot.manifest.allowedSkillIds.pop();
    mark("manifest");
  }
  if (size() > budget && snapshot.pending.action) {
    snapshot.pending.action = null;
    mark("pending");
  }
  if (size() > budget && snapshot.pending.clarification) {
    snapshot.pending.clarification = null;
    mark("pending");
  }

  const contextTokenEstimate = size();
  if (contextTokenEstimate > budget) {
    const error = new Error(`Context budget ${budget} is too small for mandatory safety metadata (${contextTokenEstimate})`);
    error.code = "CONTEXT_BUDGET_UNSATISFIABLE";
    throw error;
  }
  return {
    contextTokenEstimate,
    truncatedSections: SECTION_ORDER.concat("manifest").filter((section) => truncated.has(section)),
  };
}

function fingerprint(value, length = 16) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function createTraceMetadata(snapshot, sectionFingerprints) {
  return {
    contextId: snapshot.contextId,
    schemaVersion: snapshot.schemaVersion,
    owner: snapshot.owner,
    assembledAt: snapshot.assembledAt,
    manifestVersion: snapshot.manifest.version,
    configFingerprint: fingerprint(snapshot.config),
    sectionFingerprints,
    selectionFingerprint: snapshot.selectionFingerprint,
    counts: {
      recentMessages: snapshot.recentMessages.length,
      memories: snapshot.memories.length,
      episodes: snapshot.episodes.length,
      rag: snapshot.rag.length,
    },
    contextTokenEstimate: snapshot.contextTokenEstimate,
    contextTokenBudget: snapshot.contextTokenBudget,
    truncatedSections: snapshot.truncatedSections.slice(),
    compressionUsed: snapshot.compressionUsed,
    memoryProjection: {
      policyVersion: snapshot.memoryProjection.policyVersion,
      selectedMemories: snapshot.memories.length,
      selectedEpisodes: snapshot.episodes.length,
      excluded: { ...snapshot.memoryProjection.excluded },
    },
  };
}

function createContextAssembler(options = {}) {
  const clock = options.clock && typeof options.clock.now === "function" ? options.clock : { now: Date.now };
  const redact = typeof options.redact === "function" ? options.redact : defaultRedact;
  const contextTokenBudget = Math.max(800, Math.min(8000, Number(options.contextTokenBudget || DEFAULT_CONTEXT_TOKEN_BUDGET)));
  const maxMessages = Math.max(8, Math.min(12, Number(options.maxMessages || 12)));

  async function assemble(input = {}) {
    const now = clock.now();
    const memoryAudit = { excluded: {} };
    const binding = runtimeBinding(input);
    const snapshot = {
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      owner: OWNER,
      sectionOrder: SECTION_ORDER.slice(),
      assembledAt: new Date(now).toISOString(),
      config: {
        configVersion: safeText(redact, input.configVersion || "unversioned", 128),
        contextTokenBudget,
        maxMessages,
      },
      safety: {
        factsRequireAuthoritativeTools: true,
        noHiddenReasoning: true,
        noRawToolResults: true,
      },
      manifest: normalizeManifest(redact, input.manifestSummary),
      currentTurn: {
        message: safeText(redact, input.currentMessage || input.message || "", 1200),
        runtimeMode: safeText(redact, input.runtimeMode || "public", 20),
      },
      pending: normalizePending(redact, input, now),
      workingState: normalizeWorkingState(redact, input),
      recentMessages: normalizeRecentMessages(redact, input.recentMessages, maxMessages),
      rollingSummary: safeText(redact, input.rollingSummary || input.conversationSummary || "", 1200),
      memories: normalizeMemories(redact, input.memoryItems || input.memories, now, binding, memoryAudit),
      episodes: normalizeEpisodes(redact, input.episodicMemories || input.episodes, now, binding, memoryAudit),
      rag: normalizeRag(redact, input.ragCitations),
      contextTokenBudget,
    };
    const budgetResult = shrinkToBudget(snapshot, contextTokenBudget);
    snapshot.contextTokenEstimate = budgetResult.contextTokenEstimate;
    snapshot.truncatedSections = budgetResult.truncatedSections;
    snapshot.compressionUsed = snapshot.truncatedSections.length > 0;
    snapshot.selectedMemoryIds = snapshot.memories.map((item) => item.memoryId);
    snapshot.selectedEpisodeIds = snapshot.episodes.map((item) => item.episodeId);
    // ADR-0006 audit metadata: counts and reason categories only — never
    // memory content, prompts, or filtered sensitive originals.
    snapshot.memoryProjection = {
      policyVersion: MEMORY_PROJECTION_POLICY_VERSION,
      excluded: memoryAudit.excluded,
    };
    snapshot.selectionFingerprint = fingerprint({
      memories: snapshot.selectedMemoryIds,
      episodes: snapshot.selectedEpisodeIds,
      rag: snapshot.rag.map((item) => item.citationId),
    }, 24);

    const identityPayload = {
      ...buildBudgetPayload(snapshot),
      contextTokenEstimate: snapshot.contextTokenEstimate,
      truncatedSections: snapshot.truncatedSections,
      compressionUsed: snapshot.compressionUsed,
    };
    snapshot.contextId = `ctx_${fingerprint(identityPayload, 24)}`;
    const sectionFingerprints = Object.fromEntries([
      ...SECTION_ORDER.map((section) => [section, fingerprint(snapshot[section])]),
      ["manifest", fingerprint(snapshot.manifest)],
    ]);
    snapshot.trace = createTraceMetadata(snapshot, sectionFingerprints);

    const sharedView = {
      contextId: snapshot.contextId,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      safety: snapshot.safety,
      manifest: snapshot.manifest,
    };
    snapshot.views = {
      decision: {
        ...sharedView,
        purpose: "decision",
        memoryPolicyVersion: MEMORY_PROJECTION_POLICY_VERSION,
        currentTurn: snapshot.currentTurn,
        pending: snapshot.pending,
        workingState: snapshot.workingState,
        recentMessages: snapshot.recentMessages,
        rollingSummary: snapshot.rollingSummary,
        memories: snapshot.memories,
        episodes: snapshot.episodes,
        rag: snapshot.rag,
        selectedMemoryIds: snapshot.selectedMemoryIds,
        selectedEpisodeIds: snapshot.selectedEpisodeIds,
      },
      tool: {
        ...sharedView,
        purpose: "tool",
        currentTurn: { runtimeMode: snapshot.currentTurn.runtimeMode },
        workingState: snapshot.workingState,
      },
      verification: {
        ...sharedView,
        purpose: "verification",
        currentTurn: { runtimeMode: snapshot.currentTurn.runtimeMode },
        workingState: snapshot.workingState,
      },
      response: {
        ...sharedView,
        purpose: "response",
        currentTurn: snapshot.currentTurn,
        workingState: snapshot.workingState,
        rag: snapshot.rag,
      },
    };
    return deepFreeze(snapshot);
  }

  return Object.freeze({ assemble });
}

module.exports = {
  CONTEXT_SCHEMA_VERSION,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  MEMORY_PROJECTION_POLICY_VERSION,
  SECTION_ORDER,
  createContextAssembler,
  estimateContextTokens,
};
