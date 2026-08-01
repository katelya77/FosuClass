"use strict";

/**
 * 通用 Runtime Engine — 把任意 agentRuntime 包装为 AgentEngineAdapter 契约
 * 引擎（P7a）。集成方（生产平台装配、standalone 独立平台）各自提供
 * engineId/engineVersion/conformanceSuite，共用同一包装逻辑，不产生
 * 第二套 Engine 实现。
 *
 * 薄委托纪律：execute 原样调用 runtime.executeTurn；capabilities 如实
 * 声明（resume 由 Run 协议层 cursor 重放承担；SSE 流式未实装；cancel 经
 * execute 内 AbortSignal 传播，无独立 runId 级句柄）。
 */

const { createAgentEngine } = require("../../../packages/agent-runtime");

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createRuntimeEngine(options = {}) {
  const runtime = options.runtime;
  if (!runtime || typeof runtime.executeTurn !== "function") {
    throw codedError("AGENT_ENGINE_EXECUTE_REQUIRED", "runtime.executeTurn is required");
  }
  const engineId = String(options.engineId || "").slice(0, 96);
  const engineVersion = String(options.engineVersion || "").slice(0, 64);
  const conformanceSuite = String(options.conformanceSuite || "").slice(0, 64);
  if (!engineId) throw codedError("AGENT_ENGINE_ID_REQUIRED");
  if (!engineVersion) throw codedError("AGENT_ENGINE_VERSION_REQUIRED");
  if (!conformanceSuite) throw codedError("AGENT_ENGINE_CONFORMANCE_REQUIRED", "conformanceSuite is required");
  return createAgentEngine({
    engineId,
    engineVersion,
    conformance: {
      suiteVersion: conformanceSuite,
      // 运行时永远只是 self-declared；"suite-verified" 只出现在 conformance
      // suite 的证据输出中，不由引擎自身声称。
      status: "self-declared",
    },
    capabilities: {
      supportsStreaming: false,
      supportsResume: false,
      supportsCancel: true,
      supportsStructuredDecision: true,
      supportsToolCalling: true,
      supportsMemory: true,
      supportsRag: true,
      supportsActionReceipt: true,
      supportsUiSchema: true,
      supportsParallelTools: false,
      supportsProviderFallback: true,
    },
    execute(input = {}) {
      return runtime.executeTurn(input);
    },
    readiness() {
      return Object.freeze({ ready: true, engineId, engineVersion });
    },
    health() {
      return Object.freeze({
        healthy: true,
        engineId,
        engineVersion,
        runtime: typeof runtime.diagnostics === "function" ? runtime.diagnostics() : {},
      });
    },
  });
}

module.exports = Object.freeze({
  createRuntimeEngine,
});
