/**
 * Skill routing coordination: the only skill choices made at agentService level
 * (early-trace skill ids for guard branches and fixed skill descriptors).
 * Capability scoring and skill verification remain authoritative in
 * capabilityRouter / skillRegistry, orchestrated by agentKernel.
 */
const EARLY_TRACE_SKILLS = Object.freeze({
  EMPTY_MESSAGE: "knowledge_search",
  SENSITIVE_CREDENTIAL_BLOCKED: "personal_schedule_import_help",
  PERSONAL_MEMORY: "personal_memory",
  SERVICE_FAILURE: "knowledge_search",
});

function earlyTraceSkillFor(scenario) {
  return EARLY_TRACE_SKILLS[scenario] || "knowledge_search";
}

function personalMemorySkill() {
  return {
    id: "personal_memory",
    version: "1.0.0",
    description: "显式偏好与会话上下文",
  };
}

function serviceFailureSkill() {
  return {
    id: "knowledge_search",
    version: "1.0.0",
    description: "服务异常降级",
  };
}

function executionSkill(execution) {
  return (execution && execution.skill) || null;
}

module.exports = {
  earlyTraceSkillFor,
  personalMemorySkill,
  serviceFailureSkill,
  executionSkill,
};
