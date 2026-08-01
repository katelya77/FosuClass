"use strict";

/**
 * AgentEngineAdapter — 平台内唯一的 Engine 权威契约（P7a）。
 *
 * 设计边界（问题 13 已确认决策）：
 * - 本模块是 AgentEngineAdapter 的单一权威定义；不得在其他 package 内出现
 *   多个相似接口。
 * - Engine 不创建第二套 Tool 协议 / Memory 存储 / RunEvent / UI Schema /
 *   Provider 配置 / Guardrail / Run 状态机：execute 的输入输出形状与
 *   生产执行链（runtime.executeTurn）保持一致，Adapter 只附加引擎元数据、
 *   能力声明与生命周期，不改变执行语义。
 * - 能力未声明时必须明确拒绝（AGENT_ENGINE_CAPABILITY_UNSUPPORTED），
 *   不得静默忽略。
 */

const ENGINE_CONTRACT_VERSION = "agent-engine.v1";

const ENGINE_CAPABILITY_KEYS = Object.freeze([
  "supportsStreaming",
  "supportsResume",
  "supportsCancel",
  "supportsStructuredDecision",
  "supportsToolCalling",
  "supportsMemory",
  "supportsRag",
  "supportsActionReceipt",
  "supportsUiSchema",
  "supportsParallelTools",
  "supportsProviderFallback",
]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeCapabilities(input = {}) {
  const capabilities = {};
  ENGINE_CAPABILITY_KEYS.forEach((key) => {
    capabilities[key] = input[key] === true;
  });
  return Object.freeze(capabilities);
}

function normalizeConformance(input = {}) {
  const suiteVersion = String(input.suiteVersion || "").slice(0, 64);
  if (!suiteVersion) {
    throw codedError("AGENT_ENGINE_CONFORMANCE_REQUIRED", "engine conformance.suiteVersion is required");
  }
  return Object.freeze({
    suiteVersion,
    // verifiedAt 仅由 conformance suite 运行侧写入证据；运行时引擎自带声明
    // 永远只是 self-declared，不得由引擎自身声称已通过测试。
    status: input.status === "suite-verified" ? "suite-verified" : "self-declared",
  });
}

const ENGINE_BRAND = Symbol("agent-engine");

/**
 * 创建符合 AgentEngineAdapter 契约的引擎实例。
 * definition:
 *  - engineId / engineVersion: 必填，稳定标识（Run 创建后绑定该版本）。
 *  - capabilities: 按 ENGINE_CAPABILITY_KEYS 声明，未声明一律 false。
 *  - conformance: { suiteVersion, status }，status 缺省 self-declared。
 *  - execute(input): 必填；输入/输出与生产执行链形状一致
 *    （request/configSnapshot/stages/signal/emit →
 *      { runId, configVersion, deadlineAt, artifacts, ui, platformTrace }）。
 *  - resume(input): 可选；缺省等价 supportsResume=false。
 *  - cancel(runIdOrHandle): 可选。
 *  - readiness() / health() / shutdown(): 可选，提供安全默认。
 */
function createAgentEngine(definition = {}) {
  const engineId = String(definition.engineId || "").slice(0, 96);
  const engineVersion = String(definition.engineVersion || "").slice(0, 64);
  if (!engineId) throw codedError("AGENT_ENGINE_ID_REQUIRED");
  if (!engineVersion) throw codedError("AGENT_ENGINE_VERSION_REQUIRED");
  if (typeof definition.execute !== "function") {
    throw codedError("AGENT_ENGINE_EXECUTE_REQUIRED", `${engineId}.execute is required`);
  }
  const capabilities = normalizeCapabilities(definition.capabilities);
  const conformance = normalizeConformance(definition.conformance);
  if (definition.resume != null && typeof definition.resume !== "function") {
    throw codedError("AGENT_ENGINE_RESUME_INVALID");
  }
  if (definition.resume && !capabilities.supportsResume) {
    throw codedError("AGENT_ENGINE_CAPABILITY_INCONSISTENT", `${engineId} provides resume() but does not declare supportsResume`);
  }
  if (capabilities.supportsResume && !definition.resume) {
    throw codedError("AGENT_ENGINE_CAPABILITY_INCONSISTENT", `${engineId} declares supportsResume but has no resume()`);
  }

  async function execute(input = {}) {
    const result = await definition.execute(input);
    return normalizeEngineResult(result, engineId);
  }

  async function resume() {
    throw codedError("AGENT_ENGINE_CAPABILITY_UNSUPPORTED", `${engineId} does not support resume`);
  }

  async function cancel() {
    throw codedError("AGENT_ENGINE_CAPABILITY_UNSUPPORTED", `${engineId} does not support cancel`);
  }

  const engine = {
    [ENGINE_BRAND]: true,
    contractVersion: ENGINE_CONTRACT_VERSION,
    engineId,
    engineVersion,
    capabilities,
    conformance,
    execute,
    resume: definition.resume ? async (input = {}) => definition.resume(input) : resume,
    cancel: definition.cancel ? async (handle) => definition.cancel(handle) : cancel,
    readiness: typeof definition.readiness === "function"
      ? definition.readiness
      : () => Object.freeze({ ready: true, engineId, engineVersion }),
    health: typeof definition.health === "function"
      ? definition.health
      : () => Object.freeze({ healthy: true, engineId, engineVersion }),
    shutdown: typeof definition.shutdown === "function"
      ? definition.shutdown
      : async () => {},
  };
  return Object.freeze(engine);
}

function isAgentEngine(value) {
  return Boolean(value) && value[ENGINE_BRAND] === true;
}

function assertAgentEngine(value) {
  if (!isAgentEngine(value)) {
    throw codedError("AGENT_ENGINE_INVALID", "engine must be created by createAgentEngine");
  }
}

function assertEngineCapability(engine, capabilityKey) {
  assertAgentEngine(engine);
  if (!ENGINE_CAPABILITY_KEYS.includes(capabilityKey)) {
    throw codedError("AGENT_ENGINE_CAPABILITY_UNKNOWN", String(capabilityKey));
  }
  if (engine.capabilities[capabilityKey] !== true) {
    throw codedError(
      "AGENT_ENGINE_CAPABILITY_UNSUPPORTED",
      `${engine.engineId} does not declare ${capabilityKey}`,
    );
  }
}

/**
 * 归一化执行结果：只校验生产链真实消费的最小字段集合，不重塑形状、
 * 不复制数据（薄 Adapter 纪律）。
 */
function normalizeEngineResult(result, engineId) {
  if (!result || typeof result !== "object") {
    throw codedError("AGENT_ENGINE_RESULT_INVALID", `${engineId || "engine"} returned a non-object result`);
  }
  if (!result.runId) {
    throw codedError("AGENT_ENGINE_RESULT_INVALID", `${engineId || "engine"} result misses runId`);
  }
  if (!result.artifacts || typeof result.artifacts !== "object") {
    throw codedError("AGENT_ENGINE_RESULT_INVALID", `${engineId || "engine"} result misses artifacts`);
  }
  if (!result.platformTrace || typeof result.platformTrace !== "object") {
    throw codedError("AGENT_ENGINE_RESULT_INVALID", `${engineId || "engine"} result misses platformTrace`);
  }
  return result;
}

/**
 * 引擎 Trace 元数据（挂到 platformTrace.engine；public 裁剪层可保留，
 * 不含 Provider 名、密钥、隐藏推理）。
 */
function engineTraceMetadata(engine, extra = {}) {
  assertAgentEngine(engine);
  return Object.freeze({
    intendedEngine: engine.engineId,
    actualEngine: engine.engineId,
    engineVersion: engine.engineVersion,
    contractVersion: ENGINE_CONTRACT_VERSION,
    conformanceVersion: engine.conformance.suiteVersion,
    fallbackPath: extra.fallbackPath || null,
    outcome: extra.outcome || null,
  });
}

module.exports = Object.freeze({
  ENGINE_CAPABILITY_KEYS,
  ENGINE_CONTRACT_VERSION,
  assertAgentEngine,
  assertEngineCapability,
  createAgentEngine,
  engineTraceMetadata,
  isAgentEngine,
  normalizeEngineResult,
});
