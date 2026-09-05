const STRING_CONSTRAINTS = Object.freeze([
  "date",
  "dateHint",
  "periodHint",
  "campus",
  "college",
  "collegeCode",
  "collegeName",
  "building",
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

const NUMBER_CONSTRAINTS = Object.freeze([
  "dateOffset",
  "teachingWeek",
  "week",
  "weekday",
  "continuousSections",
  "minFreeSections",
  "sectionStart",
  "sectionEnd",
  "durationSections",
]);

const COMPACT_DECISION_VERSION = "decision.intent.v1";
const FULL_DECISION_VERSION = "decision.v2";
const CONSTRAINT_KEYS = Object.freeze(STRING_CONSTRAINTS.concat(NUMBER_CONSTRAINTS, ["sections"]));

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("DECISION_INTENT_INVALID", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw codedError("DECISION_INTENT_INVALID", `${label} contains missing or unknown fields`);
  }
}

function normalizeConstraintPairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length > 16) {
    throw codedError("DECISION_INTENT_INVALID", "constraints must be an array with at most 16 items");
  }
  const constraints = {};
  pairs.forEach((pair) => {
    exactObject(pair, ["key", "value"], "constraint");
    const key = String(pair.key || "");
    if (!CONSTRAINT_KEYS.includes(key) || Object.prototype.hasOwnProperty.call(constraints, key)) {
      throw codedError("DECISION_INTENT_INVALID", "constraint key is unknown or duplicated");
    }
    const value = pair.value;
    if (STRING_CONSTRAINTS.includes(key) && typeof value !== "string") {
      throw codedError("DECISION_INTENT_INVALID", "string constraint has an invalid value");
    }
    if (NUMBER_CONSTRAINTS.includes(key) && (typeof value !== "number" || !Number.isFinite(value))) {
      throw codedError("DECISION_INTENT_INVALID", "numeric constraint has an invalid value");
    }
    if (key === "sections") {
      const validArray = Array.isArray(value)
        && value.length <= 20
        && value.every((item) => Number.isInteger(item) && item >= 1 && item <= 20);
      if (!(typeof value === "string" || validArray)) {
        throw codedError("DECISION_INTENT_INVALID", "sections constraint has an invalid value");
      }
    }
    constraints[key] = value;
  });
  return constraints;
}

function buildDecisionResponseSchema(skills = []) {
  const allowedGoals = Array.from(new Set((Array.isArray(skills) ? skills : [])
    .flatMap((skill) => Array.isArray(skill && skill.supportedGoals) ? skill.supportedGoals : [])
    .map((goal) => String(goal || "").trim())
    .filter(Boolean)));
  return {
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: COMPACT_DECISION_VERSION },
      goal: {
        type: "object",
        properties: {
          name: { type: "string", enum: allowedGoals },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          requiresClarification: { type: "boolean" },
        },
        required: ["name", "confidence", "requiresClarification"],
        additionalProperties: false,
      },
      entities: {
        type: "array",
        maxItems: 16,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["teacher", "class", "classroom", "course", "campus"] },
            value: { type: "string", minLength: 1, maxLength: 240 },
            source: { type: "string", enum: ["user", "context", "memory", "clarification"] },
          },
          required: ["type", "value", "source"],
          additionalProperties: false,
        },
      },
      constraints: constraintsSchema(),
      responseMode: { type: "string", enum: ["deterministic", "natural_language", "none"] },
    },
    required: ["schemaVersion", "goal", "entities", "constraints", "responseMode"],
    additionalProperties: false,
  };
}

function constraintsSchema() {
  return {
    type: "array",
    maxItems: 16,
    items: {
      type: "object",
      properties: {
        key: { type: "string", enum: CONSTRAINT_KEYS.slice() },
        value: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 120 },
            { type: "number" },
            { type: "array", items: { type: "integer", minimum: 1, maximum: 20 }, maxItems: 20 },
          ],
        },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
  };
}

function expandDecisionResponse(value, skillCatalog) {
  if (!value || value.schemaVersion !== COMPACT_DECISION_VERSION) return value;
  exactObject(value, ["schemaVersion", "goal", "entities", "constraints", "responseMode"], "decision intent");
  exactObject(value.goal, ["name", "confidence", "requiresClarification"], "goal");
  if (!Array.isArray(value.entities) || value.entities.length > 16) {
    throw codedError("DECISION_INTENT_INVALID", "entities must be an array with at most 16 items");
  }
  value.entities.forEach((entity) => exactObject(entity, ["type", "value", "source"], "entity"));
  if (!skillCatalog || typeof skillCatalog.getSkillForIntent !== "function") {
    throw codedError("DECISION_SKILL_CATALOG_REQUIRED", "A published Skill catalog is required");
  }
  const skill = skillCatalog.getSkillForIntent(value.goal.name);
  if (!skill || !skill.id) {
    throw codedError("DECISION_SKILL_NOT_FOUND", "No published Skill supports the model-selected Goal");
  }
  const confidence = Number(value.goal.confidence);
  return {
    schemaVersion: FULL_DECISION_VERSION,
    goal: value.goal,
    entities: value.entities,
    constraints: normalizeConstraintPairs(value.constraints),
    skillCandidates: [{ skillId: skill.id, confidence }],
    plan: {
      steps: [{ id: "resolve-goal", skillId: skill.id, purpose: "Resolve the model-selected goal" }],
    },
    responseMode: value.responseMode,
  };
}

module.exports = {
  COMPACT_DECISION_VERSION,
  buildDecisionResponseSchema,
  expandDecisionResponse,
};
