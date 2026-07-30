const { validateAgainstSchema } = require("./schemaValidator");

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function codedError(code, message, details) {
  const error = new Error(message || code);
  error.code = code;
  if (details) error.details = details;
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

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch (error) {
    return fallback;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizeDescriptor(input = {}) {
  const id = safeString(input.id, 128);
  if (!TOOL_ID_PATTERN.test(id)) throw codedError("TOOL_ID_INVALID", id);
  if (typeof input.execute !== "function") throw codedError("TOOL_EXECUTOR_REQUIRED", id);
  const descriptor = {
    id,
    version: safeString(input.version || "1", 64),
    description: safeString(input.description, 500),
    inputSchema: deepFreeze(cloneJson(input.inputSchema, { type: "object" })),
    outputSchema: deepFreeze(cloneJson(input.outputSchema, { type: "object" })),
    runtimeModes: stringList(input.runtimeModes || ["public", "trial", "dev"]),
    environments: stringList(input.environments || ["production", "staging", "development"]),
    safety: deepFreeze(cloneJson(input.safety, { autonomyLevel: 1, requiresConfirmation: false })),
  };
  return { publicDescriptor: deepFreeze(descriptor), execute: input.execute };
}

function createToolRuntime(options = {}) {
  const byId = new Map();
  (Array.isArray(options.tools) ? options.tools : []).forEach((source) => {
    const normalized = normalizeDescriptor(source);
    if (byId.has(normalized.publicDescriptor.id)) {
      throw codedError("TOOL_ID_DUPLICATE", normalized.publicDescriptor.id);
    }
    byId.set(normalized.publicDescriptor.id, normalized);
  });

  function listDescriptors() {
    return Object.freeze(Array.from(byId.values()).map((entry) => entry.publicDescriptor));
  }

  function resolveAllowedToolIds(input = {}) {
    const factorNames = [
      "manifestToolIds",
      "skillToolIds",
      "runtimeToolIds",
      "environmentToolIds",
      "safetyToolIds",
    ];
    const factors = factorNames.map((name) => new Set(Array.isArray(input[name]) ? input[name].map(String) : []));
    const manifestOrder = Array.isArray(input.manifestToolIds) ? input.manifestToolIds.map(String) : [];
    return Object.freeze(Array.from(new Set(manifestOrder)).filter((toolId) => factors.every((factor) => factor.has(toolId))));
  }

  function assertExecutable(toolId, allowedToolIds) {
    const exactId = String(toolId == null ? "" : toolId);
    if (!byId.has(exactId)) throw codedError("TOOL_NOT_REGISTERED", exactId);
    if (!Array.isArray(allowedToolIds) || !allowedToolIds.includes(exactId)) {
      throw codedError("TOOL_NOT_ALLOWED", exactId);
    }
    return byId.get(exactId).publicDescriptor;
  }

  async function execute(toolId, args = {}, context = {}, executionOptions = {}) {
    const exactId = String(toolId == null ? "" : toolId);
    const descriptor = assertExecutable(exactId, executionOptions.allowedToolIds);
    if (executionOptions.signal && executionOptions.signal.aborted) throw codedError("ABORTED", exactId);
    const inputErrors = validateAgainstSchema(args, descriptor.inputSchema);
    if (inputErrors.length) throw codedError("TOOL_INPUT_SCHEMA_INVALID", exactId, inputErrors.slice(0, 20));
    const result = await byId.get(exactId).execute(args, context, {
      signal: executionOptions.signal || null,
      timeoutMs: Number.isFinite(Number(executionOptions.timeoutMs)) && Number(executionOptions.timeoutMs) > 0
        ? Number(executionOptions.timeoutMs)
        : undefined,
      toolId: exactId,
    });
    if (executionOptions.signal && executionOptions.signal.aborted) throw codedError("ABORTED", exactId);
    const outputErrors = validateAgainstSchema(result, descriptor.outputSchema);
    if (outputErrors.length) throw codedError("TOOL_OUTPUT_SCHEMA_INVALID", exactId, outputErrors.slice(0, 20));
    return result;
  }

  return Object.freeze({
    listDescriptors,
    resolveAllowedToolIds,
    assertExecutable,
    execute,
    has(toolId) {
      return byId.has(String(toolId == null ? "" : toolId));
    },
  });
}

module.exports = {
  createToolRuntime,
};
