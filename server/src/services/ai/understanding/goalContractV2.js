/**
 * GoalContract V2 — unified understanding contract.
 *
 * V2 extends the V1 GoalContract (goalContract.js) with candidate goals,
 * multi-role entities, missing slots, ambiguity and requested effect, while
 * keeping the same strict-schema philosophy: unknown or missing fields are
 * rejected, and any tool/route/url-shaped field anywhere in the payload is
 * refused so the contract can never name an executable capability.
 *
 * In this phase the model still emits V1 JSON; understandingService keeps
 * parsing V1 and the runtime upgrades through fromV1Contract. A later phase
 * will switch the model-facing schema to V2 and parse with
 * parseGoalContractV2Json directly.
 */
const capabilityManifestService = require("../capabilityManifestService");
const safetyGuard = require("../safetyGuard");
const {
  intentToGoalContract,
  normalizeConstraints,
  normalizeGoalContract,
} = require("./goalContract");
const {
  CONTRACT_VERSION,
  ENTITY_ROLES,
  GOAL_CONTRACT_V2_SCHEMA,
  GOAL_EFFECTS,
  GOAL_IDS,
  REQUESTED_EFFECTS,
} = require("./goalContractV2.generated");

const GOAL_CONTRACT_V2_KEYS = Object.freeze([
  "contractVersion",
  "goalId",
  "candidateGoals",
  "entities",
  "constraints",
  "followUpMode",
  "missingSlots",
  "ambiguity",
  "requestedEffect",
  "confidence",
  "provenance",
]);

// Every key except requestedEffect must be present; requestedEffect is derived
// from GOAL_EFFECTS when omitted.
const REQUIRED_KEYS = Object.freeze(GOAL_CONTRACT_V2_KEYS.filter((key) => key !== "requestedEffect"));

// V1 modes plus "correction" for "不是A，是B" style self-corrections.
const FOLLOW_UP_MODES_V2 = Object.freeze([
  "none",
  "new_goal",
  "inherit_active_goal",
  "inherit_last_entity",
  "replace_constraints",
  "fill_pending_clarification",
  "correction",
]);

const PROVENANCE_SOURCES = Object.freeze(["model", "deterministic", "rule", "fallback", "adapter"]);

// Fields that would let a contract point at an executable capability or
// location. Matched case-insensitively at any nesting level.
const FORBIDDEN_FIELDS = Object.freeze(["toolName", "tool", "url", "route", "db", "command", "sql"]);

const GOAL_ID_SET = new Set(GOAL_IDS);
const ENTITY_ROLE_SET = new Set(ENTITY_ROLES);
const REQUESTED_EFFECT_SET = new Set(REQUESTED_EFFECTS);
const FOLLOW_UP_MODE_SET = new Set(FOLLOW_UP_MODES_V2);
const PROVENANCE_SOURCE_SET = new Set(PROVENANCE_SOURCES);
const FORBIDDEN_FIELD_SET = new Set(FORBIDDEN_FIELDS.map((field) => field.toLowerCase()));

const V1_ENTITY_TYPES = new Set(["teacher", "class", "classroom", "course", "campus"]);
const MAX_CANDIDATE_GOALS = 3;
const MAX_ENTITIES = 8;
const MAX_MISSING_SLOTS = 8;
const MAX_AMBIGUITY_CANDIDATES = 5;
const MAX_SCAN_DEPTH = 8;

function contractError(code, message, detail = "") {
  const error = new Error(message || code);
  error.code = code;
  error.detail = String(detail || "").slice(0, 80);
  return error;
}

function safeText(value, max = 120) {
  return safetyGuard.redactSensitiveText(String(value == null ? "" : value))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function allowedGoalSet(options = {}) {
  if (Array.isArray(options.allowedGoals) && options.allowedGoals.length) {
    // GoalIds always stay manifest-bound; allowedGoals can only narrow the set.
    return new Set(options.allowedGoals.map((item) => String(item || "")).filter((item) => GOAL_ID_SET.has(item)));
  }
  return GOAL_ID_SET;
}

function assertNoForbiddenFields(value, path, depth) {
  if (!value || typeof value !== "object") return;
  if (depth > MAX_SCAN_DEPTH) {
    throw contractError("GOAL_CONTRACT_V2_INVALID", "GoalContract V2 nesting too deep", path);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`, depth + 1));
    return;
  }
  Object.keys(value).forEach((key) => {
    if (FORBIDDEN_FIELD_SET.has(key.toLowerCase())) {
      throw contractError(
        "GOAL_CONTRACT_V2_FORBIDDEN_FIELD",
        `forbidden GoalContract V2 field: ${key}`,
        path ? `${path}.${key}` : key
      );
    }
    assertNoForbiddenFields(value[key], path ? `${path}.${key}` : key, depth + 1);
  });
}

function normalizeConfidence(value, fallback) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw contractError("GOAL_CONTRACT_V2_CONFIDENCE_INVALID", "confidence must be between 0 and 1");
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw contractError("GOAL_CONTRACT_V2_CONFIDENCE_INVALID", "confidence must be between 0 and 1");
  }
  return value;
}

// Item-level provenance is the short source label; the top-level provenance
// object carries provider/model detail.
function normalizeItemProvenance(value, fallbackSource) {
  if (value === undefined || value === null || value === "") return fallbackSource;
  const source = safeText(value, 24).toLowerCase();
  if (!PROVENANCE_SOURCE_SET.has(source)) {
    throw contractError("GOAL_CONTRACT_V2_PROVENANCE_INVALID", `invalid item provenance: ${source}`, source);
  }
  return source;
}

function assertPlainObject(value, code, message, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError(code, message);
  }
  const extras = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (extras.length) {
    throw contractError("GOAL_CONTRACT_V2_EXTRA_FIELD", `unexpected GoalContract V2 field: ${extras[0]}`, extras[0]);
  }
}

function normalizeCandidateGoals(value, fallbackSource, fallbackConfidence) {
  if (!Array.isArray(value)) {
    throw contractError("GOAL_CONTRACT_V2_CANDIDATES_INVALID", "candidateGoals must be an array");
  }
  if (value.length > MAX_CANDIDATE_GOALS) {
    throw contractError("GOAL_CONTRACT_V2_CANDIDATES_INVALID", `candidateGoals is limited to ${MAX_CANDIDATE_GOALS} entries`);
  }
  const items = value.map((item) => {
    assertPlainObject(item, "GOAL_CONTRACT_V2_CANDIDATES_INVALID", "candidate goal must be an object", ["goalId", "confidence", "provenance"]);
    const goalId = safeText(item.goalId, 80);
    if (!GOAL_ID_SET.has(goalId)) {
      throw contractError("GOAL_CONTRACT_V2_GOAL_NOT_ALLOWED", `candidate goal is not in the Capability Manifest: ${goalId}`, goalId);
    }
    return {
      goalId,
      confidence: normalizeConfidence(item.confidence, fallbackConfidence),
      provenance: normalizeItemProvenance(item.provenance, fallbackSource),
    };
  });
  return items.sort((a, b) => b.confidence - a.confidence);
}

function normalizeEntities(value, fallbackSource, fallbackConfidence) {
  if (!Array.isArray(value)) {
    throw contractError("GOAL_CONTRACT_V2_ENTITIES_INVALID", "entities must be an array");
  }
  if (value.length > MAX_ENTITIES) {
    throw contractError("GOAL_CONTRACT_V2_ENTITIES_INVALID", `entities is limited to ${MAX_ENTITIES} entries`);
  }
  return value.map((item) => {
    assertPlainObject(item, "GOAL_CONTRACT_V2_ENTITIES_INVALID", "entity must be an object", ["role", "value", "normalizedValue", "confidence", "provenance"]);
    const role = safeText(item.role, 24).toLowerCase();
    if (!ENTITY_ROLE_SET.has(role)) {
      throw contractError("GOAL_CONTRACT_V2_ENTITY_ROLE_INVALID", `invalid entity role: ${role}`, role);
    }
    if (typeof item.value !== "string") {
      throw contractError("GOAL_CONTRACT_V2_FIELD_TYPE_INVALID", "entity value must be a string", "entities.value");
    }
    const entityValue = safeText(item.value, 120);
    if (!entityValue) {
      throw contractError("GOAL_CONTRACT_V2_ENTITIES_INVALID", "entity value must not be empty", role);
    }
    if (item.normalizedValue !== undefined && typeof item.normalizedValue !== "string") {
      throw contractError("GOAL_CONTRACT_V2_FIELD_TYPE_INVALID", "entity normalizedValue must be a string", "entities.normalizedValue");
    }
    return {
      role,
      value: entityValue,
      normalizedValue: item.normalizedValue === undefined ? entityValue : safeText(item.normalizedValue, 120),
      confidence: normalizeConfidence(item.confidence, fallbackConfidence),
      provenance: normalizeItemProvenance(item.provenance, fallbackSource),
    };
  });
}

// A missing slot is either a slot the goal declares in the Manifest or a
// generic entity role (e.g. "teacher" when the teacher name is missing).
function manifestSlotSet(goalId) {
  const slots = new Set(ENTITY_ROLES);
  const intent = capabilityManifestService.getIntent(goalId);
  if (intent) {
    (intent.requiredSlots || []).concat(intent.optionalSlots || []).forEach((slot) => {
      slots.add(String(slot || ""));
    });
  }
  return slots;
}

function normalizeMissingSlots(value, goalId) {
  if (!Array.isArray(value)) {
    throw contractError("GOAL_CONTRACT_V2_MISSING_SLOTS_INVALID", "missingSlots must be an array");
  }
  if (value.length > MAX_MISSING_SLOTS) {
    throw contractError("GOAL_CONTRACT_V2_MISSING_SLOTS_INVALID", `missingSlots is limited to ${MAX_MISSING_SLOTS} entries`);
  }
  const allowed = manifestSlotSet(goalId);
  const seen = new Set();
  const slots = [];
  value.forEach((item) => {
    const slot = safeText(item, 40);
    if (!slot || !allowed.has(slot)) {
      throw contractError(
        "GOAL_CONTRACT_V2_MISSING_SLOTS_INVALID",
        `missing slot is not declared for goal ${goalId}: ${slot}`,
        slot
      );
    }
    if (!seen.has(slot)) {
      seen.add(slot);
      slots.push(slot);
    }
  });
  return slots;
}

function normalizeAmbiguity(value) {
  assertPlainObject(value, "GOAL_CONTRACT_V2_AMBIGUITY_INVALID", "ambiguity must be an object", ["isAmbiguous", "reason", "candidates"]);
  if (typeof value.isAmbiguous !== "boolean") {
    throw contractError("GOAL_CONTRACT_V2_AMBIGUITY_INVALID", "ambiguity.isAmbiguous must be boolean");
  }
  if (!Array.isArray(value.candidates)) {
    throw contractError("GOAL_CONTRACT_V2_AMBIGUITY_INVALID", "ambiguity.candidates must be an array");
  }
  if (value.candidates.length > MAX_AMBIGUITY_CANDIDATES) {
    throw contractError("GOAL_CONTRACT_V2_AMBIGUITY_INVALID", `ambiguity.candidates is limited to ${MAX_AMBIGUITY_CANDIDATES} entries`);
  }
  const candidates = value.candidates.map((item) => {
    assertPlainObject(item, "GOAL_CONTRACT_V2_AMBIGUITY_INVALID", "ambiguity candidate must be an object", ["goalId", "entityRole", "value", "confidence"]);
    if (typeof item.value !== "string") {
      throw contractError("GOAL_CONTRACT_V2_FIELD_TYPE_INVALID", "ambiguity candidate value must be a string", "ambiguity.candidates.value");
    }
    const candidate = {};
    if (item.goalId !== undefined && item.goalId !== null && item.goalId !== "") {
      const goalId = safeText(item.goalId, 80);
      if (!GOAL_ID_SET.has(goalId)) {
        throw contractError("GOAL_CONTRACT_V2_GOAL_NOT_ALLOWED", `ambiguity candidate goal is not in the Capability Manifest: ${goalId}`, goalId);
      }
      candidate.goalId = goalId;
    }
    if (item.entityRole !== undefined && item.entityRole !== null && item.entityRole !== "") {
      const role = safeText(item.entityRole, 24).toLowerCase();
      if (!ENTITY_ROLE_SET.has(role)) {
        throw contractError("GOAL_CONTRACT_V2_ENTITY_ROLE_INVALID", `invalid ambiguity candidate entity role: ${role}`, role);
      }
      candidate.entityRole = role;
    }
    candidate.value = safeText(item.value, 120);
    candidate.confidence = normalizeConfidence(item.confidence, 0.5);
    return candidate;
  });
  return {
    isAmbiguous: value.isAmbiguous,
    reason: safeText(value.reason, 200),
    candidates,
  };
}

function normalizeRequestedEffect(value, goalId) {
  if (value === undefined || value === null || value === "") {
    const derived = GOAL_EFFECTS[goalId];
    if (!derived) {
      throw contractError("GOAL_CONTRACT_V2_EFFECT_INVALID", `no requested effect available for goal: ${goalId}`, goalId);
    }
    return derived;
  }
  const effect = safeText(value, 24).toLowerCase();
  if (!REQUESTED_EFFECT_SET.has(effect)) {
    throw contractError("GOAL_CONTRACT_V2_EFFECT_INVALID", `invalid requestedEffect: ${effect}`, effect);
  }
  return effect;
}

function normalizeProvenance(value) {
  assertPlainObject(value, "GOAL_CONTRACT_V2_PROVENANCE_INVALID", "provenance must be an object", ["source", "provider", "model", "understandingSource"]);
  const source = safeText(value.source, 24).toLowerCase();
  if (!PROVENANCE_SOURCE_SET.has(source)) {
    throw contractError("GOAL_CONTRACT_V2_PROVENANCE_INVALID", `invalid provenance source: ${source}`, source);
  }
  return {
    source,
    provider: safeText(value.provider, 40),
    model: safeText(value.model, 60),
    understandingSource: safeText(value.understandingSource, 40),
  };
}

function normalizeGoalContractV2(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError("GOAL_CONTRACT_V2_INVALID", "GoalContract V2 must be an object");
  }
  assertNoForbiddenFields(value, "", 0);
  const keys = Object.keys(value);
  const extras = keys.filter((key) => !GOAL_CONTRACT_V2_KEYS.includes(key));
  if (extras.length) {
    throw contractError("GOAL_CONTRACT_V2_EXTRA_FIELD", `unexpected GoalContract V2 field: ${extras[0]}`, extras[0]);
  }
  const missing = REQUIRED_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) {
    throw contractError("GOAL_CONTRACT_V2_MISSING_FIELD", `missing GoalContract V2 field: ${missing[0]}`, missing[0]);
  }

  if (safeText(value.contractVersion, 40) !== CONTRACT_VERSION) {
    throw contractError("GOAL_CONTRACT_V2_VERSION_INVALID", `contractVersion must be ${CONTRACT_VERSION}`, value && value.contractVersion);
  }
  const goalId = safeText(value.goalId, 80);
  if (!allowedGoalSet(options).has(goalId)) {
    throw contractError("GOAL_CONTRACT_V2_GOAL_NOT_ALLOWED", `goalId is not in the Capability Manifest: ${goalId}`, goalId);
  }
  const followUpMode = safeText(value.followUpMode, 40).toLowerCase() || "none";
  if (!FOLLOW_UP_MODE_SET.has(followUpMode)) {
    throw contractError("GOAL_CONTRACT_V2_FOLLOW_UP_MODE_INVALID", `invalid followUpMode: ${followUpMode}`, followUpMode);
  }
  const confidence = normalizeConfidence(value.confidence);
  const provenance = normalizeProvenance(value.provenance);

  return {
    contractVersion: CONTRACT_VERSION,
    goalId,
    candidateGoals: normalizeCandidateGoals(value.candidateGoals, provenance.source, confidence),
    entities: normalizeEntities(value.entities, provenance.source, confidence),
    constraints: normalizeConstraints(value.constraints),
    followUpMode,
    missingSlots: normalizeMissingSlots(value.missingSlots, goalId),
    ambiguity: normalizeAmbiguity(value.ambiguity),
    requestedEffect: normalizeRequestedEffect(value.requestedEffect, goalId),
    confidence,
    provenance,
  };
}

function parseGoalContractV2Json(text, options = {}) {
  const raw = String(text == null ? "" : text).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw contractError("GOAL_CONTRACT_V2_JSON_INVALID", "Understanding provider did not return strict GoalContract V2 JSON");
  }
  return normalizeGoalContractV2(parsed, options);
}

// Lenient provenance input for the adapter APIs: a bare source string or a
// partial object is completed with defaults (adapters always know their source).
function coerceProvenance(input, defaults = {}) {
  const source = typeof input === "string" ? { source: input } : (input && typeof input === "object" ? input : {});
  const rawSource = String(source.source || defaults.source || "adapter").toLowerCase();
  return {
    source: PROVENANCE_SOURCE_SET.has(rawSource) ? rawSource : "adapter",
    provider: safeText(source.provider !== undefined ? source.provider : defaults.provider, 40),
    model: safeText(source.model !== undefined ? source.model : defaults.model, 60),
    understandingSource: safeText(
      source.understandingSource !== undefined ? source.understandingSource : defaults.understandingSource,
      40
    ),
  };
}

// V1 -> V2 adapter. The V1 payload is validated with the strict V1 normalizer
// first, then mapped field by field; a V1 clarification request becomes
// ambiguity plus a role-shaped missing slot.
function fromV1Contract(v1, provenance = {}) {
  const legacy = normalizeGoalContract(v1 || {});
  const prov = coerceProvenance(provenance, { source: "adapter" });
  const entities = legacy.entityType !== "none" && legacy.entity
    ? [{
      role: legacy.entityType,
      value: legacy.entity,
      normalizedValue: legacy.normalizedEntity || legacy.entity,
      confidence: legacy.confidence,
      provenance: prov.source,
    }]
    : [];
  return normalizeGoalContractV2({
    contractVersion: CONTRACT_VERSION,
    goalId: legacy.goal,
    candidateGoals: [{ goalId: legacy.goal, confidence: legacy.confidence, provenance: prov.source }],
    entities,
    constraints: legacy.constraints,
    followUpMode: legacy.followUpMode,
    missingSlots: legacy.needsClarification && legacy.entityType !== "none" ? [legacy.entityType] : [],
    ambiguity: {
      isAmbiguous: legacy.needsClarification === true,
      reason: legacy.needsClarification === true ? "v1_needs_clarification" : "",
      candidates: [],
    },
    requestedEffect: GOAL_EFFECTS[legacy.goal],
    confidence: legacy.confidence,
    provenance: prov,
  });
}

// V2 replacement for intentToGoalContract: reuses the V1 slot mapping, then
// upgrades. Intents come from deterministic rules, hence the default source.
function fromIntent(intent = {}, options = {}) {
  const legacy = intentToGoalContract(intent, options);
  return fromV1Contract(legacy, options.provenance || { source: "deterministic" });
}

// Compatibility projection for consumers that still expect the V1 shape.
// "correction" has no V1 equivalent; a corrected goal restarts as new_goal.
function toLegacyV1(v2, options = {}) {
  const contract = normalizeGoalContractV2(v2, options);
  const primaryEntity = contract.entities.find((entity) => V1_ENTITY_TYPES.has(entity.role)) || null;
  return normalizeGoalContract({
    goal: contract.goalId,
    entityType: primaryEntity ? primaryEntity.role : "none",
    entity: primaryEntity ? primaryEntity.value : "",
    normalizedEntity: primaryEntity ? primaryEntity.normalizedValue : "",
    constraints: contract.constraints,
    followUpMode: contract.followUpMode === "correction" ? "new_goal" : contract.followUpMode,
    confidence: contract.confidence,
    needsClarification: contract.ambiguity.isAmbiguous === true || contract.missingSlots.length > 0,
  }, options);
}

function emptyGoalContractV2(goalId, provenance = {}) {
  const prov = coerceProvenance(provenance, { source: "fallback" });
  return normalizeGoalContractV2({
    contractVersion: CONTRACT_VERSION,
    goalId,
    candidateGoals: [],
    entities: [],
    constraints: {},
    followUpMode: "none",
    missingSlots: [],
    ambiguity: { isAmbiguous: false, reason: "", candidates: [] },
    requestedEffect: GOAL_EFFECTS[safeText(goalId, 80)],
    confidence: 0,
    provenance: prov,
  });
}

module.exports = {
  CONTRACT_VERSION,
  ENTITY_ROLES,
  FOLLOW_UP_MODES_V2,
  FORBIDDEN_FIELDS,
  GOAL_CONTRACT_V2_KEYS,
  GOAL_CONTRACT_V2_SCHEMA,
  GOAL_EFFECTS,
  GOAL_IDS,
  PROVENANCE_SOURCES,
  REQUESTED_EFFECTS,
  emptyGoalContractV2,
  fromIntent,
  fromV1Contract,
  normalizeGoalContractV2,
  parseGoalContractV2Json,
  toLegacyV1,
};
