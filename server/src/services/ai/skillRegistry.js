const capabilityManifestService = require("./capabilityManifestService");
const toolRegistry = require("./toolRegistry");

// Skill-level business recovery declarations. agentKernel.executePlan runs them
// through a generic mechanism; business recovery rules live here, not in the kernel.
const EMPTY_ROOM_DIAGNOSE_RULE = Object.freeze({
  id: "empty_room_diagnose",
  when: Object.freeze({ tools: Object.freeze(["search_empty_rooms", "search_continuous_empty_rooms"]) }),
  callOnEmptyOrFailure: Object.freeze({ tool: "diagnose_data_status", label: "诊断课表数据状态" }),
});
const MEETING_EMPTY_ROOM_SIDECAR_RULE = Object.freeze({
  id: "recommend_meeting_time_empty_rooms",
  when: Object.freeze({ tools: Object.freeze(["recommend_meeting_time"]) }),
  attachResult: Object.freeze({ resultKey: "emptyRoomResult", tool: "search_empty_rooms", label: "附带空教室候选" }),
});
const SKILL_RECOVERY_RULES = Object.freeze({
  find_empty_room: Object.freeze([EMPTY_ROOM_DIAGNOSE_RULE]),
  find_continuous_empty_room: Object.freeze([EMPTY_ROOM_DIAGNOSE_RULE]),
  recommend_meeting_time: Object.freeze([MEETING_EMPTY_ROOM_SIDECAR_RULE, EMPTY_ROOM_DIAGNOSE_RULE]),
  campus_multi_step_advice: Object.freeze([EMPTY_ROOM_DIAGNOSE_RULE]),
});

function cloneList(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function normalizeToolCallName(call = {}) {
  return String(call.name || call.toolName || "");
}

function defaultPlanBuilder(skill, input = {}) {
  const intent = input.intent || { name: "conversational_help", slots: {} };
  const plan = toolRegistry.buildPlanForIntent(intent, input.message || "", input.context || {});
  return plan.filter((step) => skill.allowedTools.includes(String(step.toolName || step.name || "")));
}

function defaultResultVerifier(skill, input = {}) {
  const calls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const successfulCalls = calls.filter((call) => {
    const result = call && call.result;
    return call && call.status !== "failed" && call.status !== "skipped" && (!result || result.success !== false);
  });
  const errors = [];
  // Capability Router may expand tools beyond primary skill; honor input.allowedTools when provided.
  const allowedList = Array.isArray(input.allowedTools) && input.allowedTools.length
    ? input.allowedTools
    : skill.allowedTools;
  calls.forEach((call) => {
    const name = normalizeToolCallName(call);
    if (!allowedList.includes(name)) {
      errors.push({ code: "TOOL_NOT_ALLOWED_FOR_SKILL", toolName: name });
    }
  });
  const intent = capabilityManifestService.getIntent(input.intent && input.intent.name || input.intentId);
  // 事实型任务的证据只能来自该 intent 的事实工具，诊断类辅助工具成功不算事实证据。
  const successfulEvidenceCalls = intent && intent.factualTask
    ? successfulCalls.filter((call) => capabilityManifestService.isEvidenceToolCall(intent.id, call))
    : successfulCalls;
  if (intent && intent.factualTask && successfulEvidenceCalls.length === 0) {
    errors.push({ code: "FACT_TOOL_EVIDENCE_REQUIRED" });
  }
  return {
    ok: errors.length === 0,
    errors,
    evidenceComplete: !(intent && intent.factualTask) || successfulEvidenceCalls.length > 0,
  };
}

function createSkill(definition) {
  const skill = {
    id: definition.id,
    version: definition.version,
    description: definition.description,
    supportedIntents: cloneList(definition.supportedIntents),
    requiredSlots: cloneList(definition.requiredSlots),
    optionalSlots: cloneList(definition.optionalSlots),
    allowedTools: cloneList(definition.allowedTools),
    runtimeModes: cloneList(definition.runtimeModes),
    providerPolicy: definition.providerPolicy,
    fallbackPolicy: definition.fallbackPolicy,
    outputCardTypes: cloneList(definition.outputCardTypes),
    recoveryRules: cloneList(SKILL_RECOVERY_RULES[definition.id]),
  };
  skill.planBuilder = (input) => defaultPlanBuilder(skill, input);
  skill.resultVerifier = (input) => defaultResultVerifier(skill, input);
  return Object.freeze(skill);
}

const skills = Object.freeze(Object.values(capabilityManifestService.getManifest().skills).reduce((output, item) => {
  output[item.id] = createSkill(item);
  return output;
}, {}));

function getSkill(id) {
  return skills[String(id || "")] || null;
}

function getSkillForIntent(intentId) {
  const intent = capabilityManifestService.getIntent(intentId && intentId.name || intentId);
  return intent ? getSkill(intent.skill) : null;
}

function listSkills() {
  return Object.values(skills);
}

function assertPlanAllowed(skillOrId, plan = [], runtimeMode = "public") {
  const skill = typeof skillOrId === "string" ? getSkill(skillOrId) : skillOrId;
  if (!skill) {
    const error = new Error("Skill is not registered");
    error.code = "SKILL_NOT_FOUND";
    throw error;
  }
  const mode = capabilityManifestService.normalizeRuntimeMode(runtimeMode);
  if (!skill.runtimeModes.includes(mode)) {
    const error = new Error(`Skill ${skill.id} is not available in ${mode}`);
    error.code = "SKILL_NOT_ALLOWED_FOR_RUNTIME";
    throw error;
  }
  (Array.isArray(plan) ? plan : []).forEach((step) => {
    const toolName = String(step.toolName || step.name || "");
    if (!skill.allowedTools.includes(toolName)) {
      const error = new Error(`Tool ${toolName} is not allowed for skill ${skill.id}`);
      error.code = "TOOL_NOT_ALLOWED_FOR_SKILL";
      error.toolName = toolName;
      throw error;
    }
    if (!capabilityManifestService.isToolAllowedForRuntime(toolName, mode)) {
      const error = new Error(`Tool ${toolName} is not available in ${mode}`);
      error.code = "TOOL_NOT_ALLOWED_FOR_RUNTIME";
      error.toolName = toolName;
      throw error;
    }
  });
  return true;
}

module.exports = {
  assertPlanAllowed,
  getSkill,
  getSkillForIntent,
  listSkills,
};
