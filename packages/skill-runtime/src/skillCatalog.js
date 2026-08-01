const SKILL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function stringList(value, maxItems = 128) {
  return Object.freeze(Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => safeString(item, 160))
    .filter(Boolean))).slice(0, maxItems));
}

function normalizeSkill(input = {}) {
  const id = safeString(input.id, 128);
  if (!SKILL_ID_PATTERN.test(id)) throw codedError("SKILL_ID_INVALID", id);
  const supportedGoals = stringList(input.supportedGoals || input.supportedIntents);
  const skill = {
    id,
    version: safeString(input.version || "1", 64),
    description: safeString(input.description, 500),
    supportedGoals,
    supportedIntents: supportedGoals,
    requiredSlots: stringList(input.requiredSlots, 64),
    optionalSlots: stringList(input.optionalSlots, 64),
    allowedTools: stringList(input.allowedTools),
    runtimeModes: stringList(input.runtimeModes || ["public"]),
    outputBlockTypes: stringList(input.outputBlockTypes || input.outputCardTypes, 32),
    providerPolicy: safeString(input.providerPolicy, 64),
    fallbackPolicy: safeString(input.fallbackPolicy, 64),
    recoveryRules: Object.freeze(Array.isArray(input.recoveryRules) ? input.recoveryRules.slice(0, 32) : []),
  };
  if (typeof input.planBuilder === "function") skill.planBuilder = input.planBuilder;
  if (typeof input.resultVerifier === "function") skill.resultVerifier = input.resultVerifier;
  return Object.freeze(skill);
}

function createSkillCatalog(options = {}) {
  const byId = new Map();
  (Array.isArray(options.skills) ? options.skills : []).forEach((source) => {
    const skill = normalizeSkill(source);
    if (byId.has(skill.id)) throw codedError("SKILL_ID_DUPLICATE", skill.id);
    byId.set(skill.id, skill);
  });

  function get(id) {
    return byId.get(String(id == null ? "" : id)) || null;
  }

  function list() {
    return Object.freeze(Array.from(byId.values()));
  }

  function findForGoal(goalId) {
    const target = String(goalId == null ? "" : goalId);
    return Object.freeze(Array.from(byId.values()).filter((skill) => skill.supportedGoals.includes(target)));
  }

  return Object.freeze({
    get,
    getSkill: get,
    list,
    listSkills: list,
    findForGoal,
    getSkillForIntent(intent) {
      const id = intent && typeof intent === "object" ? intent.name : intent;
      return findForGoal(id)[0] || null;
    },
  });
}

module.exports = {
  createSkillCatalog,
};
