"use strict";

/**
 * EngineRegistry — 服务端受控的 Engine 注册与选择（P7a）。
 *
 * 规则（问题 13 已确认决策）：
 * - Engine 选择由服务端受控配置决定，客户端不得任意指定未授权 Engine。
 * - 未声明 conformance metadata 或标记 experimental 的 Engine 不得设为默认。
 * - experimental Engine 仅在明确 feature flag + 明确 environment scope 下可选。
 * - Engine 不可用时不得静默切换并伪装成原 Engine：resolve 失败即抛 coded error。
 * - Run 创建后绑定 Engine 版本：resolve 在单次执行开始时发生一次，
 *   调用方（platform.executeTurn）在同一次执行内复用同一引擎实例。
 */

const { assertAgentEngine, isAgentEngine } = require("./agentEngine");

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeEnvironment(environment) {
  const value = String(environment || "public").toLowerCase();
  return value === "trial" || value === "dev" ? value : "public";
}

function createEngineRegistry(options = {}) {
  const engines = new Map();
  const experimentalEngines = new Set();
  let defaultEngineId = "";
  // featureFlags: { allowExperimentalEngines?: boolean }
  const featureFlags = Object.freeze({
    allowExperimentalEngines: options.featureFlags && options.featureFlags.allowExperimentalEngines === true,
  });
  // environmentScope: { experimentalEnvironments?: ["dev"] }
  const experimentalEnvironments = new Set(
    (options.environmentScope && Array.isArray(options.environmentScope.experimentalEnvironments)
      ? options.environmentScope.experimentalEnvironments
      : ["dev"]).map(normalizeEnvironment),
  );

  function register(engine, registration = {}) {
    assertAgentEngine(engine);
    if (engines.has(engine.engineId)) {
      throw codedError("AGENT_ENGINE_DUPLICATE", `engine ${engine.engineId} already registered`);
    }
    engines.set(engine.engineId, engine);
    if (registration.experimental === true) {
      experimentalEngines.add(engine.engineId);
    }
    if (registration.makeDefault === true) {
      setDefault(engine.engineId);
    }
    return engine;
  }

  function setDefault(engineId) {
    const engine = engines.get(engineId);
    if (!engine) {
      throw codedError("AGENT_ENGINE_UNKNOWN", `engine ${engineId} is not registered`);
    }
    if (experimentalEngines.has(engineId)) {
      throw codedError("AGENT_ENGINE_EXPERIMENTAL_NOT_DEFAULT", `experimental engine ${engineId} cannot be default`);
    }
    // conformance metadata 在 createAgentEngine 已强制（suiteVersion 必填），
    // 这里双保险：self-declared 也允许成为默认，但真实"通过"只能由
    // conformance suite 在 release-gate 证明（运行时不伪造测试状态）。
    if (!engine.conformance || !engine.conformance.suiteVersion) {
      throw codedError("AGENT_ENGINE_CONFORMANCE_REQUIRED", `engine ${engineId} lacks conformance metadata`);
    }
    defaultEngineId = engineId;
  }

  /**
   * 选择本次执行的引擎。
   * requestEngineId 只允许来自服务端受控配置（调用方责任），客户端传入的
   * 任意引擎名到达这里时按未授权处理：不在 allowed 集合即抛错。
   */
  function resolve(selection = {}) {
    const environment = normalizeEnvironment(selection.environment);
    const requested = selection.engineId ? String(selection.engineId) : "";
    if (requested) {
      const engine = engines.get(requested);
      if (!engine) {
        throw codedError("AGENT_ENGINE_UNKNOWN", `engine ${requested} is not registered`);
      }
      if (experimentalEngines.has(requested)) {
        const allowed = featureFlags.allowExperimentalEngines && experimentalEnvironments.has(environment);
        if (!allowed) {
          throw codedError(
            "AGENT_ENGINE_NOT_ALLOWED",
            `experimental engine ${requested} is not allowed in ${environment}`,
          );
        }
      }
      return engine;
    }
    if (!defaultEngineId) {
      throw codedError("AGENT_ENGINE_DEFAULT_MISSING", "no default engine configured");
    }
    const engine = engines.get(defaultEngineId);
    if (!engine) {
      throw codedError("AGENT_ENGINE_UNKNOWN", `default engine ${defaultEngineId} is not registered`);
    }
    return engine;
  }

  function diagnostics() {
    const list = [];
    engines.forEach((engine, engineId) => {
      let readiness = null;
      try {
        readiness = typeof engine.readiness === "function" ? engine.readiness() : null;
      } catch (error) {
        readiness = { ready: false, errorClass: "readiness_failed" };
      }
      list.push(Object.freeze({
        engineId,
        engineVersion: engine.engineVersion,
        contractVersion: engine.contractVersion,
        experimental: experimentalEngines.has(engineId),
        isDefault: engineId === defaultEngineId,
        capabilities: engine.capabilities,
        conformance: engine.conformance,
        readiness,
      }));
    });
    return Object.freeze({
      defaultEngineId,
      featureFlags,
      engines: Object.freeze(list),
    });
  }

  if (Array.isArray(options.engines)) {
    options.engines.forEach((entry) => {
      register(entry.engine, { experimental: entry.experimental, makeDefault: entry.makeDefault });
    });
  }
  if (options.defaultEngineId) {
    setDefault(options.defaultEngineId);
  }

  return Object.freeze({
    diagnostics,
    isRegistered: (engineId) => engines.has(engineId),
    register,
    resolve,
    setDefault,
  });
}

module.exports = Object.freeze({
  createEngineRegistry,
  isAgentEngine,
});
