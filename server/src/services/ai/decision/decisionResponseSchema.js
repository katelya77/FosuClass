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

function nullable(type, extra = {}) {
  return Object.assign({ type: [type, "null"] }, extra);
}

function constraintsSchema() {
  const properties = {};
  STRING_CONSTRAINTS.forEach((key) => {
    properties[key] = nullable("string", { maxLength: key === "q" ? 120 : 80 });
  });
  NUMBER_CONSTRAINTS.forEach((key) => {
    properties[key] = nullable("number");
  });
  properties.sections = {
    anyOf: [
      { type: "array", items: { type: "integer", minimum: 1, maximum: 20 }, maxItems: 20 },
      { type: "string", maxLength: 80 },
      { type: "null" },
    ],
  };
  return {
    type: "object",
    properties,
    // OpenAI-compatible strict schema implementations require every declared
    // property to be required. Null means that the constraint was not present;
    // projectDecisionContract removes nulls before the V1 compatibility gate.
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function buildDecisionResponseSchema(skills = []) {
  const allowedSkills = (Array.isArray(skills) ? skills : [])
    .map((skill) => String(skill && skill.id || "").trim())
    .filter(Boolean);
  const allowedGoals = Array.from(new Set((Array.isArray(skills) ? skills : [])
    .flatMap((skill) => Array.isArray(skill && skill.supportedGoals) ? skill.supportedGoals : [])
    .map((goal) => String(goal || "").trim())
    .filter(Boolean)));
  return {
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: "decision.v2" },
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
      skillCandidates: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            skillId: { type: "string", enum: allowedSkills },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["skillId", "confidence"],
          additionalProperties: false,
        },
      },
      plan: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                id: { type: "string", minLength: 1, maxLength: 80 },
                skillId: { type: "string", enum: allowedSkills },
                purpose: { type: "string", minLength: 1, maxLength: 240 },
              },
              required: ["id", "skillId", "purpose"],
              additionalProperties: false,
            },
          },
        },
        required: ["steps"],
        additionalProperties: false,
      },
      responseMode: { type: "string", enum: ["deterministic", "natural_language", "none"] },
    },
    required: ["schemaVersion", "goal", "entities", "constraints", "skillCandidates", "plan", "responseMode"],
    additionalProperties: false,
  };
}

module.exports = {
  buildDecisionResponseSchema,
};
