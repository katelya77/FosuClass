"use strict";

/**
 * Fosu Engine — 现有生产 Runtime 经 AgentEngineAdapter 契约的默认实现（P7a）。
 *
 * 薄 Adapter（问题 13 已确认决策）：真实被生产入口调用
 * （platformComposition → createAgentPlatform → engineRegistry.resolve
 * → engine.execute → runtime.executeTurn），不复制业务状态、不改变既有
 * Runtime 行为、不绕回隐藏入口；不创建第二套 Tool/Memory/RunEvent/
 * UI Schema/Provider/Guardrail/Run 状态机。包装逻辑由通用
 * createRuntimeEngine 提供（standalone 平台共用同一实现，各自参数化
 * engineId），本模块只携带 Fosu 侧标识。
 */

const { createRuntimeEngine } = require("../../../../../apps/agent-server");

const FOSU_ENGINE_ID = "fosu-runtime";
const FOSU_ENGINE_VERSION = "0.1.0";
const FOSU_CONFORMANCE_SUITE = "p7a-conformance-1";

function createFosuEngine(options = {}) {
  return createRuntimeEngine({
    runtime: options.runtime,
    engineId: FOSU_ENGINE_ID,
    engineVersion: FOSU_ENGINE_VERSION,
    conformanceSuite: FOSU_CONFORMANCE_SUITE,
  });
}

module.exports = Object.freeze({
  FOSU_CONFORMANCE_SUITE,
  FOSU_ENGINE_ID,
  FOSU_ENGINE_VERSION,
  createFosuEngine,
});
