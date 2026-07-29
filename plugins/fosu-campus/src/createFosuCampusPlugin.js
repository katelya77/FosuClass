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
  const required = stringList(source.required);
  const properties = Object.entries(source.fields || {}).reduce((output, [name, type]) => {
    const normalizedType = schemaType(type);
    output[name] = normalizedType ? { type: required.includes(name) ? normalizedType : [normalizedType, "null"] } : {};
    return output;
  }, {});
  return {
    type: "object",
    required,
    properties,
  };
}

function toolInputSchema(toolSchemaRegistry, toolId, manifest) {
  const generated = toolSchemaRegistry && typeof toolSchemaRegistry.getToolSchema === "function"
    ? toolSchemaRegistry.getToolSchema(toolId)
    : null;
  const source = cloneJson(generated && generated.parameters, {
    type: "object",
    additionalProperties: false,
    properties: {},
  });
  const properties = Object.assign({
    message: { type: "string", maxLength: 2000 },
    term: { type: "string", maxLength: 100 },
    releaseVersion: { type: "string", maxLength: 160 },
    confirmed: { type: "boolean" },
    doubleConfirmed: { type: "boolean" },
    explicitCommand: { type: "boolean" },
    wantsWeather: { type: "boolean" },
    q: { type: "string", maxLength: 240 },
    type: { type: "string", maxLength: 40 },
    lockedEntityType: { type: "string", maxLength: 40 },
    periodHint: { type: "string", maxLength: 32 },
    durationSections: { type: "integer", minimum: 1, maximum: 12 },
    continuousSections: { type: "integer", minimum: 1, maximum: 12 },
    minFreeSections: { type: "integer", minimum: 1, maximum: 12 },
    sectionStart: { type: "integer", minimum: 1, maximum: 20 },
    sectionEnd: { type: "integer", minimum: 1, maximum: 20 },
    teachingWeek: { type: "integer", minimum: 1, maximum: 30 },
    dateOffset: { type: "integer", minimum: -30, maximum: 180 },
    dayOffset: { type: "integer", minimum: -30, maximum: 180 },
    defaultReminderLeadMinutes: { type: "integer", minimum: 5, maximum: 180 },
    lastTargetId: { type: "string", maxLength: 160 },
    lastTargetName: { type: "string", maxLength: 160 },
    lastTargetType: { type: "string", maxLength: 40 },
    operation: { type: "string", maxLength: 40 },
  }, source.properties || {});
  Object.values(manifest && manifest.intents || {}).forEach((intent) => {
    // Decision produces normalized entity/constraint slots before a Tool is
    // selected. Every accepted key must therefore come from the Manifest slot
    // vocabulary (plus the fixed internal envelope above), never arbitrary input.
    stringList([].concat(intent.requiredSlots || [], intent.optionalSlots || [])).forEach((slot) => {
      if (!Object.prototype.hasOwnProperty.call(properties, slot)) properties[slot] = {};
    });
  });
  return {
    type: "object",
    additionalProperties: false,
    required: stringList(source.required),
    properties,
  };
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

function toToolDescriptor(toolId, metadata, dependencies, manifest) {
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
    inputSchema: toolInputSchema(dependencies.toolSchemaRegistry, toolId, manifest),
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
    return toToolDescriptor(toolId, metadata, dependencies, manifest);
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
