#!/usr/bin/env node
/**
 * P7a Engine 契约层单测：createAgentEngine / createEngineRegistry 的形状校验、
 * 能力门控与选择策略。与 conformance suite（test-agent-engine-conformance.js，
 * 真实执行路径）互补：本文件只测契约与 Registry 行为本身。
 */
"use strict";

const assert = require("node:assert/strict");
const {
  ENGINE_CAPABILITY_KEYS,
  ENGINE_CONTRACT_VERSION,
  assertEngineCapability,
  createAgentEngine,
  createEngineRegistry,
  engineTraceMetadata,
  isAgentEngine,
} = require("../packages/agent-runtime");

let pass = 0;
let fail = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      fail += 1;
      console.error(`FAIL ${name}: ${error && error.message}`);
    });
}
function expectCode(fn, code) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        throw new Error(`expected ${code} but succeeded`);
      },
      (error) => {
        assert.equal(error && error.code, code, `expected ${code}, got ${error && error.code}`);
      },
    );
}

function validDefinition(overrides = {}) {
  return Object.assign({
    engineId: "test-engine",
    engineVersion: "1.0.0",
    conformance: { suiteVersion: "p7a-conformance-1" },
    execute: async () => ({
      runId: "run_1",
      configVersion: "v1",
      deadlineAt: Date.now() + 1000,
      artifacts: { response: { answer: "ok" } },
      ui: { blocks: [] },
      platformTrace: { outcome: "success", stages: [] },
    }),
  }, overrides);
}

async function main() {
  await check("createAgentEngine 缺 engineId 抛 AGENT_ENGINE_ID_REQUIRED", () =>
    expectCode(() => createAgentEngine(validDefinition({ engineId: "" })), "AGENT_ENGINE_ID_REQUIRED"));

  await check("createAgentEngine 缺 engineVersion 抛 AGENT_ENGINE_VERSION_REQUIRED", () =>
    expectCode(() => createAgentEngine(validDefinition({ engineVersion: "" })), "AGENT_ENGINE_VERSION_REQUIRED"));

  await check("createAgentEngine 缺 execute 抛 AGENT_ENGINE_EXECUTE_REQUIRED", () =>
    expectCode(() => createAgentEngine(validDefinition({ execute: null })), "AGENT_ENGINE_EXECUTE_REQUIRED"));

  await check("createAgentEngine 缺 conformance.suiteVersion 抛 AGENT_ENGINE_CONFORMANCE_REQUIRED", () =>
    expectCode(() => createAgentEngine(validDefinition({ conformance: {} })), "AGENT_ENGINE_CONFORMANCE_REQUIRED"));

  await check("capabilities 未声明键一律 false 且键集合完整", () => {
    const engine = createAgentEngine(validDefinition({ capabilities: { supportsCancel: true, unknownKey: true } }));
    assert.equal(engine.capabilities.supportsCancel, true);
    ENGINE_CAPABILITY_KEYS.forEach((key) => {
      if (key !== "supportsCancel") assert.equal(engine.capabilities[key], false, key);
    });
    assert.deepEqual(Object.keys(engine.capabilities).sort(), ENGINE_CAPABILITY_KEYS.slice().sort());
  });

  await check("声明 supportsResume 但无 resume() 抛 AGENT_ENGINE_CAPABILITY_INCONSISTENT", () =>
    expectCode(
      () => createAgentEngine(validDefinition({ capabilities: { supportsResume: true } })),
      "AGENT_ENGINE_CAPABILITY_INCONSISTENT"));

  await check("提供 resume() 但未声明 supportsResume 抛 AGENT_ENGINE_CAPABILITY_INCONSISTENT", () =>
    expectCode(
      () => createAgentEngine(validDefinition({ resume: async () => ({}) })),
      "AGENT_ENGINE_CAPABILITY_INCONSISTENT"));

  await check("缺省 resume() 抛 AGENT_ENGINE_CAPABILITY_UNSUPPORTED", () => {
    const engine = createAgentEngine(validDefinition());
    return expectCode(() => engine.resume({}), "AGENT_ENGINE_CAPABILITY_UNSUPPORTED");
  });

  await check("缺省 cancel() 抛 AGENT_ENGINE_CAPABILITY_UNSUPPORTED", () => {
    const engine = createAgentEngine(validDefinition());
    return expectCode(() => engine.cancel("run_x"), "AGENT_ENGINE_CAPABILITY_UNSUPPORTED");
  });

  await check("execute 结果缺 runId 抛 AGENT_ENGINE_RESULT_INVALID", () => {
    const engine = createAgentEngine(validDefinition({
      execute: async () => ({ artifacts: {}, platformTrace: {} }),
    }));
    return expectCode(() => engine.execute({}), "AGENT_ENGINE_RESULT_INVALID");
  });

  await check("execute 结果缺 artifacts 抛 AGENT_ENGINE_RESULT_INVALID", () => {
    const engine = createAgentEngine(validDefinition({
      execute: async () => ({ runId: "run_1", platformTrace: {} }),
    }));
    return expectCode(() => engine.execute({}), "AGENT_ENGINE_RESULT_INVALID");
  });

  await check("execute 结果缺 platformTrace 抛 AGENT_ENGINE_RESULT_INVALID", () => {
    const engine = createAgentEngine(validDefinition({
      execute: async () => ({ runId: "run_1", artifacts: {} }),
    }));
    return expectCode(() => engine.execute({}), "AGENT_ENGINE_RESULT_INVALID");
  });

  await check("assertEngineCapability 未声明抛 UNSUPPORTED / 未知键抛 UNKNOWN", async () => {
    const engine = createAgentEngine(validDefinition());
    await expectCode(() => assertEngineCapability(engine, "supportsStreaming"), "AGENT_ENGINE_CAPABILITY_UNSUPPORTED");
    await expectCode(() => assertEngineCapability(engine, "supportsNonsense"), "AGENT_ENGINE_CAPABILITY_UNKNOWN");
    assertEngineCapability(createAgentEngine(validDefinition({ capabilities: { supportsCancel: true } })), "supportsCancel");
  });

  await check("engineTraceMetadata 形状（intendedEngine/actualEngine/version/conformance/outcome）", () => {
    const engine = createAgentEngine(validDefinition());
    const meta = engineTraceMetadata(engine, { outcome: "success" });
    assert.equal(meta.intendedEngine, "test-engine");
    assert.equal(meta.actualEngine, "test-engine");
    assert.equal(meta.engineVersion, "1.0.0");
    assert.equal(meta.contractVersion, ENGINE_CONTRACT_VERSION);
    assert.equal(meta.conformanceVersion, "p7a-conformance-1");
    assert.equal(meta.outcome, "success");
    assert.equal(meta.fallbackPath, null);
  });

  await check("isAgentEngine brand 识别", () => {
    assert.equal(isAgentEngine(createAgentEngine(validDefinition())), true);
    assert.equal(isAgentEngine({ engineId: "fake", execute: async () => ({}) }), false);
    assert.equal(isAgentEngine(null), false);
  });

  await check("engine 对象冻结且仅暴露契约方法（无旁路通道）", () => {
    const engine = createAgentEngine(validDefinition());
    assert.equal(Object.isFrozen(engine), true);
    const fnKeys = Object.keys(engine).filter((key) => typeof engine[key] === "function");
    assert.deepEqual(fnKeys.sort(), ["cancel", "execute", "health", "readiness", "resume", "shutdown"]);
  });

  await check("registry 重复注册抛 AGENT_ENGINE_DUPLICATE", () => {
    const registry = createEngineRegistry();
    registry.register(createAgentEngine(validDefinition()));
    return expectCode(
      () => registry.register(createAgentEngine(validDefinition())),
      "AGENT_ENGINE_DUPLICATE");
  });

  await check("registry setDefault 未注册抛 AGENT_ENGINE_UNKNOWN", () => {
    const registry = createEngineRegistry();
    return expectCode(() => registry.setDefault("ghost"), "AGENT_ENGINE_UNKNOWN");
  });

  await check("registry experimental 不得设为默认", () => {
    const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: true } });
    registry.register(createAgentEngine(validDefinition({ engineId: "exp" })), { experimental: true });
    return expectCode(() => registry.setDefault("exp"), "AGENT_ENGINE_EXPERIMENTAL_NOT_DEFAULT");
  });

  await check("registry 无默认时 resolve 抛 AGENT_ENGINE_DEFAULT_MISSING", () => {
    const registry = createEngineRegistry();
    registry.register(createAgentEngine(validDefinition()));
    return expectCode(() => registry.resolve({ environment: "public" }), "AGENT_ENGINE_DEFAULT_MISSING");
  });

  await check("registry resolve 指定未注册引擎抛 AGENT_ENGINE_UNKNOWN", () => {
    const registry = createEngineRegistry();
    registry.register(createAgentEngine(validDefinition()), { makeDefault: true });
    return expectCode(() => registry.resolve({ environment: "public", engineId: "ghost" }), "AGENT_ENGINE_UNKNOWN");
  });

  await check("experimental 引擎在非允许环境抛 AGENT_ENGINE_NOT_ALLOWED", () => {
    const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: true } });
    registry.register(createAgentEngine(validDefinition()), { makeDefault: true });
    registry.register(createAgentEngine(validDefinition({ engineId: "exp" })), { experimental: true });
    return expectCode(() => registry.resolve({ environment: "trial", engineId: "exp" }), "AGENT_ENGINE_NOT_ALLOWED");
  });

  await check("experimental 引擎在 flag+dev 下可选", () => {
    const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: true } });
    registry.register(createAgentEngine(validDefinition()), { makeDefault: true });
    registry.register(createAgentEngine(validDefinition({ engineId: "exp" })), { experimental: true });
    const engine = registry.resolve({ environment: "dev", engineId: "exp" });
    assert.equal(engine.engineId, "exp");
  });

  await check("flag 关闭时 experimental 引擎即使 dev 也拒绝", () => {
    const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: false } });
    registry.register(createAgentEngine(validDefinition()), { makeDefault: true });
    registry.register(createAgentEngine(validDefinition({ engineId: "exp" })), { experimental: true });
    return expectCode(() => registry.resolve({ environment: "dev", engineId: "exp" }), "AGENT_ENGINE_NOT_ALLOWED");
  });

  await check("environment 归一化（未知值按 public 处理）", () => {
    const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: true } });
    registry.register(createAgentEngine(validDefinition()), { makeDefault: true });
    registry.register(createAgentEngine(validDefinition({ engineId: "exp" })), { experimental: true });
    return expectCode(
      () => registry.resolve({ environment: "production", engineId: "exp" }),
      "AGENT_ENGINE_NOT_ALLOWED");
  });

  await check("register makeDefault 与 diagnostics（默认标记/experimental 标记/conformance）", () => {
    const registry = createEngineRegistry();
    registry.register(createAgentEngine(validDefinition()), { makeDefault: true });
    registry.register(createAgentEngine(validDefinition({ engineId: "exp" })), { experimental: true });
    const diagnostics = registry.diagnostics();
    assert.equal(diagnostics.defaultEngineId, "test-engine");
    const def = diagnostics.engines.find((entry) => entry.engineId === "test-engine");
    const exp = diagnostics.engines.find((entry) => entry.engineId === "exp");
    assert.equal(def.isDefault, true);
    assert.equal(def.experimental, false);
    assert.equal(exp.experimental, true);
    assert.equal(def.conformance.suiteVersion, "p7a-conformance-1");
    assert.equal(def.readiness.ready, true);
  });

  await check("resolve 默认返回默认引擎且不指定时环境无关", () => {
    const registry = createEngineRegistry();
    registry.register(createAgentEngine(validDefinition()), { makeDefault: true });
    assert.equal(registry.resolve({}).engineId, "test-engine");
    assert.equal(registry.resolve({ environment: "public" }).engineId, "test-engine");
    assert.equal(registry.resolve({ environment: "dev" }).engineId, "test-engine");
  });

  console.log(`agent-engine-contract: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`agent-engine-contract: ERROR ${error && error.stack || error}`);
  process.exit(1);
});
