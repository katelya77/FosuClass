/**
 * AI Provider 后台配置页 payload 构建器。
 * 从 routes/admin.js 提取，供 admin.js 与本模块路由共用（遵守 admin.js 行数上限）。
 */
const aiProviderConfigService = require("../../services/ai/providerConfigService");
const providerChainService = require("../../services/ai/providerChainService");
const knowledgeBaseService = require("../../services/ai/knowledgeBaseService");
const agentProtocol = require("../../services/ai/agentProtocol");
const campusMapService = require("../../services/ai/campusMapService");
const imageGenerationGateService = require("../../services/ai/imageGenerationGateService");

function buildAiProviderAdminPayload(environment) {
  const status = aiProviderConfigService.getStatus(environment);
  const enabledTools = Object.keys(agentProtocol.TOOL_DEFINITIONS || {});
  const environments = (status.environments || []).map((item) => {
    const runtimeConfig = aiProviderConfigService.getRuntimeConfigForEnvironment(item.environment);
    const chain = providerChainService.getStatus(item.environment === "public" ? "public" : "competition", runtimeConfig);
    const chainByName = new Map(chain.map((state) => [state.name, state]));
    return Object.assign({}, item, {
      providerChain: chain,
      providers: (item.providers || []).map((provider) => {
        const metrics = chainByName.get(provider.name) || {};
        return Object.assign({}, provider, {
          health: metrics.health || (provider.enabled ? "unknown" : "disabled"),
          lastSuccessAt: metrics.lastSuccessAt || "",
          lastFailureAt: metrics.lastFailureAt || "",
          latencyMs: Number(metrics.latencyMs || 0) || 0,
          p50LatencyMs: Number(metrics.p50LatencyMs || 0) || 0,
          p95LatencyMs: Number(metrics.p95LatencyMs || 0) || 0,
          fallbackCount: Number(metrics.fallbackCount || 0) || 0,
          fallbackReason: metrics.fallbackReason || "",
          circuitBreaker: metrics.circuitBreaker || { state: "closed" },
        });
      }),
    });
  });
  const activeRuntimeConfig = aiProviderConfigService.getRuntimeConfigForEnvironment(status.activeEnvironment);
  const activeRuntimeMode = status.activeEnvironment === "public" ? "public" : "competition";
  return Object.assign({}, status, {
    environments,
    protocolVersion: "agent.v1",
    enabledTools,
    toolCount: enabledTools.length,
    enabledToolCount: enabledTools.length,
    protocolToolCount: enabledTools.length,
    providerChain: providerChainService.getStatus(activeRuntimeMode, activeRuntimeConfig),
    knowledgeIndex: knowledgeBaseService.getIndexStatus(),
    campusMap: campusMapService.getMapStatus(),
    imageGeneration: imageGenerationGateService.getStatus(activeRuntimeMode),
  });
}

module.exports = { buildAiProviderAdminPayload };
