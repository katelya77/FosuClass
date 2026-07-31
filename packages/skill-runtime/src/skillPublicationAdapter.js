// P4a：Skill 域参考发布适配器（证明 Config Kernel 通用协议，不代表其他域完成）。
//
// 发布物是纯声明式描述符（禁止上传可执行 JS）；planBuilder/resultVerifier 等
// 可执行行为永远来自插件静态代码，按 id 合并。校验规则：
// - id 必须存在于插件静态技能集（= Manifest 权威集合）；禁止凭空新增技能；
// - supportedGoals / allowedTools 不得超出静态技能的对应集合（不得扩大授权）；
// - runtimeModes 仅允许 public/trial/dev；enabled 允许禁用而不删除；
// - payload 必须 JSON 可序列化（内核层已保证），字段白名单外一律拒绝。

const { createSkillCatalog } = require("./skillCatalog");

const SKILL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const RUNTIME_MODES = Object.freeze(["public", "trial", "dev"]);
const DECLARATIVE_FIELDS = Object.freeze([
  "id",
  "version",
  "description",
  "supportedGoals",
  "requiredSlots",
  "optionalSlots",
  "allowedTools",
  "runtimeModes",
  "outputBlockTypes",
  "providerPolicy",
  "fallbackPolicy",
  "recoveryRules",
  "enabled",
]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function projectionOf(skill) {
  return {
    id: skill.id,
    version: safeString(skill.version || "1", 64),
    description: safeString(skill.description, 500),
    supportedGoals: (Array.isArray(skill.supportedGoals) ? skill.supportedGoals : []).slice(),
    requiredSlots: (Array.isArray(skill.requiredSlots) ? skill.requiredSlots : []).slice(),
    optionalSlots: (Array.isArray(skill.optionalSlots) ? skill.optionalSlots : []).slice(),
    allowedTools: (Array.isArray(skill.allowedTools) ? skill.allowedTools : []).slice(),
    runtimeModes: (Array.isArray(skill.runtimeModes) && skill.runtimeModes.length ? skill.runtimeModes : ["public"]).slice(),
    outputBlockTypes: (Array.isArray(skill.outputBlockTypes) ? skill.outputBlockTypes : []).slice(),
    providerPolicy: safeString(skill.providerPolicy, 64),
    fallbackPolicy: safeString(skill.fallbackPolicy, 64),
    recoveryRules: (Array.isArray(skill.recoveryRules) ? skill.recoveryRules : []).slice(),
  };
}

function createSkillPublicationAdapter(options = {}) {
  const staticSkills = Array.isArray(options.staticSkills) ? options.staticSkills : [];
  if (!staticSkills.length) throw codedError("SKILL_PUBLICATION_STATIC_REQUIRED", "static plugin skills are required");
  const staticById = new Map(staticSkills.map((skill) => [skill.id, skill]));

  function validateStringList(value, field, errors, { maxItems = 128, subsetOf = null } = {}) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      errors.push(`${field} must be an array`);
      return [];
    }
    if (value.length > maxItems) errors.push(`${field} exceeds ${maxItems} items`);
    const out = [];
    value.forEach((item) => {
      const text = safeString(item, 160);
      if (!text) {
        errors.push(`${field} contains an empty entry`);
        return;
      }
      if (subsetOf && !subsetOf.has(text)) {
        errors.push(`${field} entry is outside the plugin static set: ${text}`);
        return;
      }
      out.push(text);
    });
    return Array.from(new Set(out));
  }

  function validate(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errors: ["payload must be a plain object"] };
    }
    const skills = payload.skills;
    if (!Array.isArray(skills) || !skills.length) {
      errors.push("payload.skills must be a non-empty array (an empty publication would break the deterministic path)");
    }
    if (Array.isArray(skills) && skills.length > 64) errors.push("payload.skills exceeds 64 items");
    const seen = new Set();
    const normalizedSkills = [];
    (Array.isArray(skills) ? skills : []).forEach((item, index) => {
      const where = `skills[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${where} must be a plain object`);
        return;
      }
      Object.keys(item).forEach((field) => {
        if (!DECLARATIVE_FIELDS.includes(field)) errors.push(`${where}.${field} is not a declarative field`);
      });
      const id = safeString(item.id, 128);
      if (!SKILL_ID_PATTERN.test(id)) {
        errors.push(`${where}.id is invalid`);
        return;
      }
      if (seen.has(id)) {
        errors.push(`${where}.id is duplicated: ${id}`);
        return;
      }
      seen.add(id);
      const staticSkill = staticById.get(id);
      if (!staticSkill) {
        errors.push(`${where}.id is not present in the plugin static skill set: ${id}`);
        return;
      }
      const staticGoals = new Set(staticSkill.supportedGoals || []);
      const staticTools = new Set(staticSkill.allowedTools || []);
      const goals = validateStringList(item.supportedGoals, `${where}.supportedGoals`, errors, { subsetOf: staticGoals });
      const tools = validateStringList(item.allowedTools, `${where}.allowedTools`, errors, { subsetOf: staticTools });
      const modes = validateStringList(item.runtimeModes, `${where}.runtimeModes`, errors, { subsetOf: new Set(RUNTIME_MODES) });
      if (modes.length && !modes.includes("public") && (staticSkill.runtimeModes || []).includes("public")) {
        errors.push(`${where}.runtimeModes cannot remove public from a public skill`);
      }
      if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
        errors.push(`${where}.enabled must be a boolean`);
      }
      if (item.recoveryRules !== undefined && !Array.isArray(item.recoveryRules)) {
        errors.push(`${where}.recoveryRules must be an array`);
      }
      normalizedSkills.push({
        id,
        version: safeString(item.version || (staticSkill.version || "1"), 64),
        description: safeString(item.description === undefined ? staticSkill.description : item.description, 500),
        supportedGoals: goals.length ? goals : (staticSkill.supportedGoals || []).slice(),
        requiredSlots: validateStringList(item.requiredSlots, `${where}.requiredSlots`, errors, { maxItems: 64 }),
        optionalSlots: validateStringList(item.optionalSlots, `${where}.optionalSlots`, errors, { maxItems: 64 }),
        allowedTools: tools.length ? tools : (staticSkill.allowedTools || []).slice(),
        runtimeModes: modes.length ? modes : (staticSkill.runtimeModes || ["public"]).slice(),
        outputBlockTypes: validateStringList(item.outputBlockTypes, `${where}.outputBlockTypes`, errors, { maxItems: 32 }),
        providerPolicy: safeString(item.providerPolicy === undefined ? staticSkill.providerPolicy : item.providerPolicy, 64),
        fallbackPolicy: safeString(item.fallbackPolicy === undefined ? staticSkill.fallbackPolicy : item.fallbackPolicy, 64),
        recoveryRules: Array.isArray(item.recoveryRules) ? item.recoveryRules.slice(0, 32) : (staticSkill.recoveryRules || []).slice(),
        enabled: item.enabled !== false,
      });
    });
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized: { skills: normalizedSkills } };
  }

  function mergeWithStatic(descriptor) {
    const staticSkill = staticById.get(descriptor.id) || {};
    const merged = Object.assign({}, descriptor);
    delete merged.enabled;
    if (typeof staticSkill.planBuilder === "function") merged.planBuilder = staticSkill.planBuilder;
    if (typeof staticSkill.resultVerifier === "function") merged.resultVerifier = staticSkill.resultVerifier;
    return merged;
  }

  function executableSkills(payload) {
    return (payload.skills || [])
      .filter((skill) => skill.enabled !== false)
      .map(mergeWithStatic);
  }

  return Object.freeze({
    domain: "skill",

    validate,

    test(normalized) {
      const skills = executableSkills(normalized || {});
      if (!skills.length) {
        return { ok: false, results: { reason: "no enabled skill remains" } };
      }
      let catalog;
      try {
        catalog = createSkillCatalog({ skills });
      } catch (error) {
        return { ok: false, results: { reason: safeString(error && error.message, 160) } };
      }
      let goalCount = 0;
      for (const skill of skills) {
        if (!catalog.get(skill.id)) return { ok: false, results: { reason: `catalog rejected ${skill.id}` } };
        for (const goal of skill.supportedGoals) {
          goalCount += 1;
          if (!catalog.findForGoal(goal).some((item) => item.id === skill.id)) {
            return { ok: false, results: { reason: `goal ${goal} is not resolvable for ${skill.id}` } };
          }
        }
      }
      return {
        ok: true,
        results: {
          skillCount: skills.length,
          goalCount,
          withPlanBuilder: skills.filter((skill) => typeof skill.planBuilder === "function").length,
        },
      };
    },

    composeSnapshotEntry(versionDoc) {
      const skills = versionDoc && versionDoc.payload && Array.isArray(versionDoc.payload.skills)
        ? versionDoc.payload.skills
        : [];
      return { skillCount: skills.filter((skill) => skill && skill.enabled !== false).length };
    },

    resolveRuntime(versionDoc) {
      if (!versionDoc || !versionDoc.payload) throw codedError("SKILL_PUBLICATION_VERSION_REQUIRED");
      return executableSkills(versionDoc.payload);
    },

    seedPayload() {
      return { skills: staticSkills.map(projectionOf) };
    },
  });
}

module.exports = Object.freeze({
  createSkillPublicationAdapter,
});
