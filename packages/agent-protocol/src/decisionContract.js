const DECISION_SCHEMA_VERSION = "decision.v2";
const ROOT_KEYS = Object.freeze([
  "schemaVersion",
  "goal",
  "entities",
  "constraints",
  "skillCandidates",
  "plan",
  "responseMode",
]);
const GOAL_KEYS = Object.freeze(["name", "confidence", "requiresClarification"]);
const ENTITY_KEYS = Object.freeze(["type", "value", "source"]);
const CANDIDATE_KEYS = Object.freeze(["skillId", "confidence"]);
const PLAN_KEYS = Object.freeze(["steps"]);
const STEP_KEYS = Object.freeze(["id", "skillId", "purpose"]);
const RESPONSE_MODES = new Set(["deterministic", "natural_language", "none"]);
const ENTITY_SOURCES = new Set(["user", "context", "memory", "clarification"]);
const FORBIDDEN_KEY = /(tool|reasoning|chain.?of.?thought|system.?prompt|api.?key|authorization|password|secret|token|cookie|endpoint|base.?url)/i;

function contractError(code, message, path = "") {
  const error = new Error(message || code);
  error.code = code;
  if (path) error.path = path;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactObject(value, keys, path) {
  if (!isPlainObject(value)) throw contractError("DECISION_FIELD_TYPE_INVALID", `${path} must be an object`, path);
  const actual = Object.keys(value);
  const extra = actual.find((key) => !keys.includes(key));
  if (extra) throw contractError("DECISION_EXTRA_FIELD", `unexpected Decision field: ${path}.${extra}`, `${path}.${extra}`);
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) throw contractError("DECISION_MISSING_FIELD", `missing Decision field: ${path}.${missing}`, `${path}.${missing}`);
}

function safeString(value, path, maxLength, allowEmpty = false) {
  if (typeof value !== "string") throw contractError("DECISION_FIELD_TYPE_INVALID", `${path} must be a string`, path);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) {
    throw contractError("DECISION_STRING_INVALID", `${path} has an invalid length`, path);
  }
  return normalized;
}

function confidence(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw contractError("DECISION_CONFIDENCE_INVALID", `${path} must be between 0 and 1`, path);
  }
  return value;
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => freezeDeep(item, seen));
  return Object.freeze(value);
}

function normalizeConstraintValue(value, path, depth = 0) {
  if (depth > 4) throw contractError("DECISION_CONSTRAINT_INVALID", "Decision constraints are too deeply nested", path);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return safeString(value, path, 240, true);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 16) throw contractError("DECISION_CONSTRAINT_INVALID", "Decision constraint array is too large", path);
    return value.map((item, index) => normalizeConstraintValue(item, `${path}[${index}]`, depth + 1));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > 32) throw contractError("DECISION_CONSTRAINT_INVALID", "Decision constraints have too many fields", path);
    return Object.fromEntries(entries.map(([key, item]) => {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
        throw contractError("DECISION_CONSTRAINT_INVALID", `invalid constraint key: ${key}`, `${path}.${key}`);
      }
      if (FORBIDDEN_KEY.test(key)) {
        throw contractError("DECISION_FORBIDDEN_FIELD", `forbidden Decision field: ${key}`, `${path}.${key}`);
      }
      return [key, normalizeConstraintValue(item, `${path}.${key}`, depth + 1)];
    }));
  }
  throw contractError("DECISION_CONSTRAINT_INVALID", `${path} contains an unsupported value`, path);
}

function parseDecisionContractJson(text, options = {}) {
  if (typeof text !== "string" || !text.trim() || /^\s*```/.test(text)) {
    throw contractError("DECISION_JSON_INVALID", "Provider did not return strict Decision JSON");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw contractError("DECISION_JSON_INVALID", "Provider did not return strict Decision JSON");
  }
  return normalizeDecisionContract(parsed, options);
}

function normalizeDecisionContract(value, options = {}) {
  exactObject(value, ROOT_KEYS, "decision");
  if (value.schemaVersion !== DECISION_SCHEMA_VERSION) {
    throw contractError("DECISION_VERSION_INVALID", `schemaVersion must be ${DECISION_SCHEMA_VERSION}`, "decision.schemaVersion");
  }
  exactObject(value.goal, GOAL_KEYS, "decision.goal");
  const goalName = safeString(value.goal.name, "decision.goal.name", 100);
  const allowedGoals = new Set((options.allowedGoalIds || []).map(String));
  if (allowedGoals.size && !allowedGoals.has(goalName)) {
    throw contractError("DECISION_GOAL_NOT_ALLOWED", `goal is not allowed: ${goalName}`, "decision.goal.name");
  }
  if (typeof value.goal.requiresClarification !== "boolean") {
    throw contractError("DECISION_FIELD_TYPE_INVALID", "requiresClarification must be boolean", "decision.goal.requiresClarification");
  }

  if (!Array.isArray(value.entities) || value.entities.length > 16) {
    throw contractError("DECISION_ENTITIES_INVALID", "entities must be an array of at most 16 items", "decision.entities");
  }
  const entities = value.entities.map((entity, index) => {
    const path = `decision.entities[${index}]`;
    exactObject(entity, ENTITY_KEYS, path);
    const source = safeString(entity.source, `${path}.source`, 24);
    if (!ENTITY_SOURCES.has(source)) throw contractError("DECISION_ENTITY_SOURCE_INVALID", `invalid entity source: ${source}`, `${path}.source`);
    return {
      type: safeString(entity.type, `${path}.type`, 48),
      value: safeString(entity.value, `${path}.value`, 240),
      source,
    };
  });
  if (!isPlainObject(value.constraints)) {
    throw contractError("DECISION_FIELD_TYPE_INVALID", "constraints must be an object", "decision.constraints");
  }
  const constraints = normalizeConstraintValue(value.constraints, "decision.constraints");

  if (!Array.isArray(value.skillCandidates) || !value.skillCandidates.length || value.skillCandidates.length > 8) {
    throw contractError("DECISION_SKILL_CANDIDATES_INVALID", "skillCandidates must contain 1 to 8 items", "decision.skillCandidates");
  }
  const allowedSkills = new Set((options.allowedSkillIds || []).map(String));
  const skillGoalMap = options.skillGoalMap || {};
  const seenSkills = new Set();
  const skillCandidates = value.skillCandidates.map((candidate, index) => {
    const path = `decision.skillCandidates[${index}]`;
    exactObject(candidate, CANDIDATE_KEYS, path);
    const skillId = safeString(candidate.skillId, `${path}.skillId`, 120);
    if (!allowedSkills.has(skillId)) {
      throw contractError("DECISION_SKILL_NOT_ALLOWED", `skill is not allowed: ${skillId}`, `${path}.skillId`);
    }
    if (seenSkills.has(skillId)) throw contractError("DECISION_SKILL_DUPLICATE", `duplicate skill: ${skillId}`, `${path}.skillId`);
    seenSkills.add(skillId);
    const compatibleGoals = Array.isArray(skillGoalMap[skillId]) ? skillGoalMap[skillId].map(String) : [];
    if (compatibleGoals.length && !compatibleGoals.includes(goalName)) {
      throw contractError("DECISION_GOAL_SKILL_MISMATCH", `${skillId} does not support ${goalName}`, `${path}.skillId`);
    }
    return { skillId, confidence: confidence(candidate.confidence, `${path}.confidence`) };
  });

  exactObject(value.plan, PLAN_KEYS, "decision.plan");
  if (!Array.isArray(value.plan.steps) || value.plan.steps.length > 8) {
    throw contractError("DECISION_PLAN_INVALID", "plan.steps must contain at most 8 items", "decision.plan.steps");
  }
  const stepIds = new Set();
  const steps = value.plan.steps.map((step, index) => {
    const path = `decision.plan.steps[${index}]`;
    exactObject(step, STEP_KEYS, path);
    const id = safeString(step.id, `${path}.id`, 80);
    const skillId = safeString(step.skillId, `${path}.skillId`, 120);
    if (stepIds.has(id)) throw contractError("DECISION_PLAN_INVALID", `duplicate step id: ${id}`, `${path}.id`);
    if (!seenSkills.has(skillId)) throw contractError("DECISION_PLAN_SKILL_INVALID", `step references a non-candidate Skill: ${skillId}`, `${path}.skillId`);
    stepIds.add(id);
    return { id, skillId, purpose: safeString(step.purpose, `${path}.purpose`, 240) };
  });
  const responseMode = safeString(value.responseMode, "decision.responseMode", 32);
  if (!RESPONSE_MODES.has(responseMode)) {
    throw contractError("DECISION_RESPONSE_MODE_INVALID", `invalid responseMode: ${responseMode}`, "decision.responseMode");
  }

  return freezeDeep({
    schemaVersion: DECISION_SCHEMA_VERSION,
    goal: {
      name: goalName,
      confidence: confidence(value.goal.confidence, "decision.goal.confidence"),
      requiresClarification: value.goal.requiresClarification,
    },
    entities,
    constraints,
    skillCandidates,
    plan: { steps },
    responseMode,
  });
}

module.exports = {
  DECISION_SCHEMA_VERSION,
  normalizeDecisionContract,
  parseDecisionContractJson,
};
