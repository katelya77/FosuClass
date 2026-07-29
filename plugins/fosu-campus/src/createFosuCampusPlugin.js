const pluginPackage = require("../package.json");

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requireMethod(owner, method, dependencyName) {
  if (!owner || typeof owner[method] !== "function") {
    throw codedError("FOSU_PLUGIN_DEPENDENCY_INVALID", `${dependencyName}.${method} is required`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function cloneJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch (error) {
    return JSON.parse(JSON.stringify(fallback));
  }
}

function stringList(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean)));
}

function schemaType(type) {
  const normalized = String(type || "").toLowerCase();
  if (["string", "number", "integer", "boolean", "array", "object"].includes(normalized)) return normalized;
  return undefined;
}

function outputSchemaFromManifest(metadata = {}) {
  const source = metadata.outputSchema;
  if (!source || typeof source !== "object") return { type: "object" };
  if (source.type) return cloneJson(source, { type: "object" });
  const properties = Object.entries(source.fields || {}).reduce((output, [name, type]) => {
    const normalizedType = schemaType(type);
    output[name] = normalizedType ? { type: normalizedType } : {};
    return output;
  }, {});
  return {
    type: "object",
    required: stringList(source.required),
    properties,
  };
}

function toolInputSchema(toolSchemaRegistry, toolId) {
  if (!toolSchemaRegistry || typeof toolSchemaRegistry.getToolSchema !== "function") {
    return { type: "object" };
  }
  const schema = toolSchemaRegistry.getToolSchema(toolId);
  return cloneJson(schema && schema.parameters, { type: "object" });
}

function toSkillDescriptor(skill) {
  return deepFreeze({
    id: String(skill.id),
    version: String(skill.version || "1"),
    description: String(skill.description || ""),
    supportedGoals: stringList(skill.supportedIntents),
    supportedIntents: stringList(skill.supportedIntents),
    requiredSlots: stringList(skill.requiredSlots),
    optionalSlots: stringList(skill.optionalSlots),
    allowedTools: stringList(skill.allowedTools),
    runtimeModes: stringList(skill.runtimeModes),
    outputCardTypes: stringList(skill.outputCardTypes),
    providerPolicy: String(skill.providerPolicy || "never"),
    fallbackPolicy: String(skill.fallbackPolicy || ""),
    recoveryRules: Array.isArray(skill.recoveryRules) ? skill.recoveryRules.slice() : [],
    planBuilder: skill.planBuilder,
    resultVerifier: skill.resultVerifier,
  });
}

function toToolDescriptor(toolId, metadata, dependencies) {
  const runtimeModes = stringList(metadata.runtimeModes);
  const generated = dependencies.toolSchemaRegistry
    && typeof dependencies.toolSchemaRegistry.getToolSchema === "function"
    ? dependencies.toolSchemaRegistry.getToolSchema(toolId)
    : null;
  const generatedSafety = generated && generated["x-fosu-safety"] || {};
  return deepFreeze({
    id: toolId,
    version: String(metadata.version || "1"),
    description: String(metadata.description || metadata.displayName || toolId),
    inputSchema: toolInputSchema(dependencies.toolSchemaRegistry, toolId),
    outputSchema: outputSchemaFromManifest(metadata),
    runtimeModes,
    environments: ["integrated", "standalone"],
    safety: {
      level: String(metadata.safetyLevel || generatedSafety.safetyLevel || "medium"),
      operation: String(generatedSafety.operation || "read"),
      requiresConfirmation: Boolean(generatedSafety.confirmation && generatedSafety.confirmation !== "none"),
    },
    execute: (args, context) => dependencies.toolRegistry.executeToolAsync(toolId, args, context),
  });
}

function safeReleaseContext(releaseService) {
  let active = null;
  let status = null;
  try {
    if (releaseService && typeof releaseService.getActiveReleaseInfoFast === "function") {
      active = releaseService.getActiveReleaseInfoFast();
    } else if (releaseService && typeof releaseService.getActiveReleaseInfo === "function") {
      active = releaseService.getActiveReleaseInfo();
    }
    if (!active && releaseService && typeof releaseService.getReleaseStatusFast === "function") {
      status = releaseService.getReleaseStatusFast();
    }
  } catch (error) {
    active = null;
    status = null;
  }
  const releaseVersion = String(active && (active.releaseVersion || active.version)
    || status && status.activeReleaseVersion
    || "");
  return deepFreeze({
    active: Boolean(releaseVersion),
    releaseVersion,
    term: String(active && (active.term || active.semester)
      || status && (status.term || status.semester)
      || ""),
    updatedAt: String(active && (active.updatedAt || active.activatedAt)
      || status && (status.activeReleaseUpdatedAt || status.activeReleaseActivatedAt)
      || ""),
  });
}

function createFosuCampusPlugin(dependencies = {}) {
  requireMethod(dependencies.capabilityManifestService, "getManifest", "capabilityManifestService");
  requireMethod(dependencies.skillRegistry, "listSkills", "skillRegistry");
  requireMethod(dependencies.toolRegistry, "listToolNames", "toolRegistry");
  requireMethod(dependencies.toolRegistry, "executeToolAsync", "toolRegistry");
  requireMethod(dependencies.responseComposer, "compose", "responseComposer");
  if (typeof dependencies.mapResultToBlocks !== "function") {
    throw codedError("FOSU_PLUGIN_DEPENDENCY_INVALID", "mapResultToBlocks is required");
  }

  // One immutable composition snapshot; the JSON file itself remains owned by the server service.
  const manifest = dependencies.capabilityManifestService.getManifest();
  const skills = deepFreeze(dependencies.skillRegistry.listSkills().map(toSkillDescriptor));
  const tools = deepFreeze(dependencies.toolRegistry.listToolNames().map((toolId) => {
    const metadata = manifest.tools && manifest.tools[toolId];
    if (!metadata) throw codedError("FOSU_PLUGIN_TOOL_NOT_IN_MANIFEST", toolId);
    return toToolDescriptor(toolId, metadata, dependencies);
  }));

  return deepFreeze({
    id: "fosu-campus",
    version: pluginPackage.version,
    manifestVersion: String(manifest.schemaVersion || manifest.version || "unknown"),
    skills,
    tools,
    getReleaseContext: () => safeReleaseContext(dependencies.releaseService),
    mapResultToBlocks: (result) => dependencies.mapResultToBlocks(result),
    composeResponse: (input) => dependencies.responseComposer.compose(input),
  });
}

module.exports = {
  createFosuCampusPlugin,
};
