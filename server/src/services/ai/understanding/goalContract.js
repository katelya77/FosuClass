// GoalContract V1 compatibility layer.
// The runtime internally standardizes on GoalContract V2 (goalContractV2.js);
// this module remains the model-facing V1 JSON schema (Understanding still
// emits V1 JSON this phase) and serves legacy consumers. Do not remove while
// V1 JSON is still produced or consumed.
const capabilityManifestService = require("../capabilityManifestService");
const safetyGuard = require("../safetyGuard");

const GOAL_CONTRACT_KEYS = Object.freeze([
  "goal",
  "entityType",
  "entity",
  "normalizedEntity",
  "constraints",
  "followUpMode",
  "confidence",
  "needsClarification",
]);

const ENTITY_TYPES = new Set(["none", "teacher", "class", "classroom", "course", "campus"]);
const FOLLOW_UP_MODES = new Set([
  "none",
  "new_goal",
  "inherit_active_goal",
  "inherit_last_entity",
  "replace_constraints",
  "fill_pending_clarification",
]);
const NUMBER_CONSTRAINTS = Object.freeze({
  dateOffset: [-30, 180],
  teachingWeek: [1, 30],
  week: [1, 30],
  weekday: [1, 7],
  continuousSections: [1, 12],
  minFreeSections: [1, 12],
  sectionStart: [1, 20],
  sectionEnd: [1, 20],
  durationSections: [1, 12],
});
const STRING_CONSTRAINTS = new Set([
  "date",
  "dateHint",
  "periodHint",
  "campus",
  "college",
  "collegeCode",
  "collegeName",
  "building",
  "sections",
  "className",
  "teacherName",
  "courseName",
  "classroom",
  "type",
  "q",
  "term",
  "releaseVersion",
  "detailId",
  "grade",
  "majorCode",
  "majorName",
]);

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
    return new Set(options.allowedGoals.map((item) => String(item || "")).filter(Boolean));
  }
  return new Set(Object.keys(capabilityManifestService.getManifest().intents || {}));
}

function normalizeConstraints(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError("GOAL_CONTRACT_CONSTRAINTS_INVALID", "constraints must be an object");
  }
  const keys = Object.keys(value);
  if (keys.length > 20) {
    throw contractError("GOAL_CONTRACT_CONSTRAINTS_INVALID", "too many constraints");
  }
  const output = {};
  keys.forEach((key) => {
    if (key === "sections" && Array.isArray(value[key])) {
      if (!value[key].every((item) => typeof item === "number" && Number.isInteger(item))) {
        throw contractError("GOAL_CONTRACT_CONSTRAINT_INVALID", "invalid section constraint", key);
      }
      const sections = Array.from(new Set(value[key]))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 20)
        .sort((a, b) => a - b)
        .slice(0, 20);
      if (!sections.length || sections.length !== value[key].length) {
        throw contractError("GOAL_CONTRACT_CONSTRAINT_INVALID", "invalid section constraint", key);
      }
      output[key] = sections;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(NUMBER_CONSTRAINTS, key)) {
      const numberValue = value[key];
      const range = NUMBER_CONSTRAINTS[key];
      if (typeof numberValue !== "number" || !Number.isFinite(numberValue)
        || numberValue < range[0] || numberValue > range[1]) {
        throw contractError("GOAL_CONTRACT_CONSTRAINT_INVALID", `invalid numeric constraint: ${key}`, key);
      }
      output[key] = numberValue;
      return;
    }
    if (STRING_CONSTRAINTS.has(key)) {
      if (typeof value[key] === "string") {
        output[key] = safeText(value[key], key === "q" ? 120 : 80);
        return;
      }
      throw contractError("GOAL_CONTRACT_CONSTRAINT_INVALID", `invalid string constraint: ${key}`, key);
    }
    throw contractError("GOAL_CONTRACT_CONSTRAINT_NOT_ALLOWED", `constraint is not allowed: ${key}`, key);
  });
  return output;
}

function normalizeGoalContract(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError("GOAL_CONTRACT_INVALID", "GoalContract must be an object");
  }
  const keys = Object.keys(value);
  const extras = keys.filter((key) => !GOAL_CONTRACT_KEYS.includes(key));
  if (extras.length) {
    throw contractError("GOAL_CONTRACT_EXTRA_FIELD", `unexpected GoalContract field: ${extras[0]}`, extras[0]);
  }
  const missing = GOAL_CONTRACT_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) {
    throw contractError("GOAL_CONTRACT_MISSING_FIELD", `missing GoalContract field: ${missing[0]}`, missing[0]);
  }

  ["goal", "entityType", "entity", "normalizedEntity", "followUpMode"].forEach((key) => {
    if (typeof value[key] !== "string") {
      throw contractError("GOAL_CONTRACT_FIELD_TYPE_INVALID", `${key} must be a string`, key);
    }
  });

  const goal = safeText(value.goal, 80);
  if (!allowedGoalSet(options).has(goal)) {
    throw contractError("GOAL_CONTRACT_GOAL_NOT_ALLOWED", `goal is not in the Capability Manifest: ${goal}`, goal);
  }
  const entityType = safeText(value.entityType, 24).toLowerCase() || "none";
  if (!ENTITY_TYPES.has(entityType)) {
    throw contractError("GOAL_CONTRACT_ENTITY_TYPE_INVALID", `invalid entityType: ${entityType}`, entityType);
  }
  const followUpMode = safeText(value.followUpMode, 40).toLowerCase() || "none";
  if (!FOLLOW_UP_MODES.has(followUpMode)) {
    throw contractError("GOAL_CONTRACT_FOLLOW_UP_MODE_INVALID", `invalid followUpMode: ${followUpMode}`, followUpMode);
  }
  const confidence = value.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw contractError("GOAL_CONTRACT_CONFIDENCE_INVALID", "confidence must be between 0 and 1");
  }
  if (typeof value.needsClarification !== "boolean") {
    throw contractError("GOAL_CONTRACT_CLARIFICATION_INVALID", "needsClarification must be boolean");
  }

  return {
    goal,
    entityType,
    entity: safeText(value.entity, 120),
    normalizedEntity: safeText(value.normalizedEntity, 120),
    constraints: normalizeConstraints(value.constraints),
    followUpMode,
    confidence,
    needsClarification: value.needsClarification,
  };
}

function parseGoalContractJson(text, options = {}) {
  const raw = String(text == null ? "" : text).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw contractError("GOAL_CONTRACT_JSON_INVALID", "Understanding provider did not return strict JSON");
  }
  return normalizeGoalContract(parsed, options);
}

function entityFromIntent(intent = {}) {
  const slots = intent.slots && typeof intent.slots === "object" ? intent.slots : {};
  const type = String(slots.type || slots.lockedEntityType || "").toLowerCase();
  if (["teacher", "class", "classroom", "course"].includes(type)) {
    return { type, value: slots.q || slots.name || slots.className || slots.teacherName || slots.classroom || slots.courseName || "" };
  }
  if (intent.name === "get_campus_weather" || slots.campus) {
    return { type: "campus", value: slots.campus || "" };
  }
  if (intent.name === "set_current_schedule") {
    return { type: "class", value: slots.name || slots.className || slots.q || "" };
  }
  return { type: "none", value: "" };
}

function constraintsFromSlots(slots = {}) {
  const candidate = {};
  Object.keys(slots || {}).forEach((key) => {
    const value = slots[key];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return;
    if (key === "minFreeSections") {
      const numeric = Number(slots[key]);
      if (Number.isFinite(numeric)) candidate.continuousSections = numeric;
    } else if (key === "name") candidate.className = String(slots[key]);
    else if (key === "sections" && Array.isArray(value)) {
      candidate[key] = value.map(Number);
    } else if (Object.prototype.hasOwnProperty.call(NUMBER_CONSTRAINTS, key)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) candidate[key] = numeric;
    } else if (STRING_CONSTRAINTS.has(key)) {
      candidate[key] = String(value);
    }
  });
  return normalizeConstraints(candidate);
}

function intentToGoalContract(intent = {}, options = {}) {
  const manifest = capabilityManifestService.getManifest();
  const requestedGoal = String(intent.name || "");
  const goal = manifest.intents[requestedGoal] ? requestedGoal : "conversational_help";
  const slots = intent.slots && typeof intent.slots === "object" ? intent.slots : {};
  const entity = entityFromIntent(Object.assign({}, intent, { name: goal, slots }));
  const confidenceValue = Number(intent.confidence);
  const confidence = Number.isFinite(confidenceValue) && confidenceValue >= 0 && confidenceValue <= 1
    ? confidenceValue
    : Number(options.defaultConfidence || 0.85);
  return normalizeGoalContract({
    goal,
    entityType: entity.type,
    entity: String(entity.value == null ? "" : entity.value),
    normalizedEntity: String(entity.value == null ? "" : entity.value),
    constraints: constraintsFromSlots(slots),
    followUpMode: intent.followUp === true ? "inherit_active_goal" : "new_goal",
    confidence,
    needsClarification: goal === "clarify_missing_slot" || Boolean(slots.slot && slots.slot.missing),
  });
}

module.exports = {
  ENTITY_TYPES,
  FOLLOW_UP_MODES,
  GOAL_CONTRACT_KEYS,
  intentToGoalContract,
  normalizeConstraints,
  normalizeGoalContract,
  parseGoalContractJson,
};
