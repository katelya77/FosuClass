const rawManifest = require("../../../config/agent-capability-manifest.json");

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

function withIds(source = {}, decorate) {
  return Object.keys(source).reduce((output, id) => {
    const item = Object.assign({ id }, source[id]);
    output[id] = typeof decorate === "function" ? decorate(item) : item;
    return output;
  }, {});
}

const manifest = deepFreeze(Object.assign({}, rawManifest, {
  intents: withIds(rawManifest.intents, (intent) => Object.assign({}, intent, {
    providerPolicyByMode: {
      public: "never",
      trial: intent.externalProviderAllowed === true ? "optional" : "never",
      dev: intent.externalProviderAllowed === true ? "optional" : "never",
    },
  })),
  tools: withIds(rawManifest.tools),
  skills: withIds(rawManifest.skills),
}));

function getManifest() {
  return manifest;
}

function getIntent(id) {
  return manifest.intents[String(id || "")] || null;
}

function getTool(id) {
  return manifest.tools[String(id || "")] || null;
}

// 诊断类工具只说明数据状态，不能作为课表/空教室等事实的证据来源。
const AUXILIARY_DIAGNOSTIC_TOOLS = new Set(["diagnose_data_status"]);

function getEvidenceTools(intentId) {
  const intent = getIntent(intentId && intentId.name || intentId);
  if (!intent || !Array.isArray(intent.allowedTools)) return [];
  const evidence = intent.allowedTools.filter((toolId) => !AUXILIARY_DIAGNOSTIC_TOOLS.has(toolId));
  return evidence.length ? evidence : intent.allowedTools.slice();
}

function isEvidenceToolCall(intentId, call) {
  const intent = getIntent(intentId && intentId.name || intentId);
  if (!intent || !Array.isArray(intent.allowedTools) || intent.allowedTools.length === 0) return true;
  return getEvidenceTools(intent.id).includes(String(call && (call.name || call.toolName) || ""));
}

function normalizeRuntimeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "competition") return "trial";
  if (mode === "trial" || mode === "dev" || mode === "public") return mode;
  return "public";
}

function isToolAllowedForRuntime(toolId, runtimeMode) {
  const tool = getTool(toolId);
  return Boolean(tool && tool.runtimeModes.includes(normalizeRuntimeMode(runtimeMode)));
}

function isIntentAllowedForRuntime(intentId, runtimeMode) {
  const intent = getIntent(intentId);
  return Boolean(intent && intent.runtimeModes.includes(normalizeRuntimeMode(runtimeMode)));
}

function isExternalProviderAllowed(intentId, runtimeMode) {
  const mode = normalizeRuntimeMode(runtimeMode);
  const intent = getIntent(intentId);
  if (!intent || mode === "public" || intent.externalProviderAllowed !== true) return false;
  return intent.runtimeModes.includes(mode);
}

function publicCapabilityView(runtimeMode = "public", enhancedModeEnabled = false) {
  const mode = normalizeRuntimeMode(runtimeMode);
  const capabilities = Object.values(manifest.intents)
    .filter((item) => item.runtimeModes.includes(mode))
    .map((item) => ({
      id: item.id,
      displayName: item.displayName,
      factualTask: item.factualTask === true,
      skill: item.skill,
      requiredSlots: item.requiredSlots,
      optionalSlots: item.optionalSlots,
      cardTypes: item.allowedCardTypes,
      needsPersonalScheduleSummary: item.needsPersonalScheduleSummary === true,
      fallbackPolicy: item.fallbackPolicy,
    }));
  return {
    protocolVersions: manifest.protocolVersions.slice(),
    currentRuntimeMode: mode,
    capabilities,
    cardTypes: manifest.cardTypes.slice(),
    enhancedModeEnabled: mode !== "public" && enhancedModeEnabled === true,
  };
}

function pushMissing(errors, condition, code, detail) {
  if (!condition) errors.push({ code, detail });
}

function assertConsistency(dependencies = {}) {
  const errors = [];
  const protocol = dependencies.agentProtocol || {};
  const skills = dependencies.skillRegistry || {};
  const tools = dependencies.toolRegistry || {};
  const clientCompat = dependencies.clientCompat || {};
  const protocolIntentNames = Object.keys(protocol.INTENT_DEFINITIONS || {});
  const protocolToolNames = Object.keys(protocol.TOOL_DEFINITIONS || {});
  const registryToolNames = typeof tools.listToolNames === "function" ? tools.listToolNames() : protocolToolNames;
  const registrySkills = typeof skills.listSkills === "function" ? skills.listSkills() : [];

  protocolIntentNames.forEach((id) => pushMissing(errors, Boolean(getIntent(id)), "PROTOCOL_INTENT_MISSING", id));
  Object.keys(manifest.intents).forEach((id) => pushMissing(errors, protocolIntentNames.includes(id), "MANIFEST_INTENT_NOT_IN_PROTOCOL", id));
  protocolToolNames.forEach((id) => pushMissing(errors, Boolean(getTool(id)), "PROTOCOL_TOOL_MISSING", id));
  registryToolNames.forEach((id) => pushMissing(errors, Boolean(getTool(id)), "TOOL_REGISTRY_TOOL_MISSING", id));
  Object.keys(manifest.tools).forEach((id) => pushMissing(errors, registryToolNames.includes(id), "MANIFEST_TOOL_NOT_EXECUTABLE", id));

  Object.values(manifest.skills).forEach((skill) => {
    pushMissing(errors, registrySkills.some((item) => item.id === skill.id), "SKILL_NOT_REGISTERED", skill.id);
    skill.supportedIntents.forEach((id) => pushMissing(errors, Boolean(getIntent(id)), "SKILL_INTENT_MISSING", `${skill.id}:${id}`));
    skill.allowedTools.forEach((toolId) => {
      const tool = getTool(toolId);
      pushMissing(errors, Boolean(tool), "SKILL_TOOL_MISSING", `${skill.id}:${toolId}`);
      if (tool) {
        skill.runtimeModes.forEach((mode) => {
          pushMissing(errors, tool.runtimeModes.includes(mode), "SKILL_TOOL_MODE_MISMATCH", `${skill.id}:${toolId}:${mode}`);
        });
      }
    });
  });

  Object.values(manifest.intents).forEach((intent) => {
    pushMissing(errors, Boolean(manifest.skills[intent.skill]), "INTENT_SKILL_MISSING", `${intent.id}:${intent.skill}`);
    intent.allowedTools.forEach((toolId) => pushMissing(errors, Boolean(getTool(toolId)), "INTENT_TOOL_MISSING", `${intent.id}:${toolId}`));
    intent.allowedCardTypes.forEach((cardType) => pushMissing(errors, manifest.cardTypes.includes(cardType), "INTENT_CARD_MISSING", `${intent.id}:${cardType}`));
    if (intent.publicAllowed) {
      pushMissing(errors, intent.runtimeModes.includes("public"), "PUBLIC_INTENT_MODE_MISSING", intent.id);
    }
  });

  const compatMap = clientCompat.OFFLINE_INTENT_MAP || {};
  Object.keys(manifest.clientCompatibility).forEach((key) => {
    pushMissing(errors, compatMap[key] === manifest.clientCompatibility[key], "CLIENT_COMPAT_MISMATCH", key);
  });
  Object.keys(compatMap).forEach((key) => {
    pushMissing(errors, Boolean(getIntent(compatMap[key])), "CLIENT_COMPAT_INTENT_MISSING", `${key}:${compatMap[key]}`);
  });

  return {
    ok: errors.length === 0,
    errors,
    intentCount: Object.keys(manifest.intents).length,
    toolCount: Object.keys(manifest.tools).length,
    skillCount: Object.keys(manifest.skills).length,
  };
}

module.exports = {
  assertConsistency,
  getEvidenceTools,
  getIntent,
  getManifest,
  getTool,
  isEvidenceToolCall,
  isExternalProviderAllowed,
  isIntentAllowedForRuntime,
  isToolAllowedForRuntime,
  normalizeRuntimeMode,
  publicCapabilityView,
};
