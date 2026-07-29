const {
  createKeepAliveRegistry,
  createMetricsStore,
  createProviderRuntime,
} = require("../../../../packages/provider-runtime");
const providerChainService = require("./providerChainService");

const PROVIDER_IDS = Object.freeze([
  "deepseek",
  "cloudbase-openai",
  "coze",
  "custom-openai",
  "custom-anthropic",
]);

function createProviderAdapters(options = {}) {
  const modules = options.providerModules || Object.fromEntries(PROVIDER_IDS.map((id) => [id, providerChainService.getProviderModule(id)]));
  return PROVIDER_IDS.map((id) => {
    const provider = modules[id];
    if (!provider || typeof provider.generateStructured !== "function") return null;
    return Object.freeze({
      id,
      async generateStructured(input = {}) {
        return provider.generateStructured(Object.assign({}, input, {
          purpose: "decision",
          stage: "decision",
        }));
      },
      async probe(input = {}) {
        if (typeof provider.testConnection === "function") {
          const result = await provider.testConnection(input);
          return result && result.ok === false ? result : { ok: true };
        }
        await provider.generateStructured(Object.assign({}, input, {
          purpose: "health",
          stage: "decision",
          messages: [
            { role: "system", content: "Return one JSON object." },
            { role: "user", content: "health" },
          ],
          maxTokens: 32,
        }));
        return { ok: true };
      },
    });
  }).filter(Boolean);
}

function resolveDecisionProviders(runtimeMode, runtimeConfig = {}) {
  if (String(runtimeMode || "public") === "public") {
    return Object.freeze({ intendedProvider: "", fallbackProvider: "", chain: Object.freeze([]) });
  }
  const effectiveConfig = Object.assign({}, runtimeConfig);
  if (!effectiveConfig.AI_DECISION_PROVIDER && effectiveConfig.AI_UNDERSTANDING_PROVIDER) {
    effectiveConfig.AI_DECISION_PROVIDER = effectiveConfig.AI_UNDERSTANDING_PROVIDER;
  }
  if (effectiveConfig.AI_DECISION_PROVIDER && !effectiveConfig.AI_UNDERSTANDING_PROVIDER) {
    effectiveConfig.AI_UNDERSTANDING_PROVIDER = effectiveConfig.AI_DECISION_PROVIDER;
  }
  const chain = providerChainService.resolveStageChain("decision", effectiveConfig, runtimeMode)
    .map((name) => providerChainService.normalizeProviderName(name))
    .filter((name) => name && name !== "mock" && PROVIDER_IDS.includes(name));
  const unique = Array.from(new Set(chain)).slice(0, 2);
  return Object.freeze({
    intendedProvider: unique[0] || "",
    fallbackProvider: unique[1] || "",
    chain: Object.freeze(unique),
  });
}

const metrics = createMetricsStore({ sampleLimit: 2000 });
const keepAliveRegistry = createKeepAliveRegistry({ maxSockets: 32, maxFreeSockets: 8 });
const providerRuntime = createProviderRuntime({
  adapters: createProviderAdapters(),
  metrics,
});

function getProviderRuntime() {
  return providerRuntime;
}

function getProviderRuntimeDiagnostics() {
  return Object.assign({}, providerRuntime.diagnostics(), {
    connectionReuse: keepAliveRegistry.diagnostics(),
  });
}

module.exports = {
  PROVIDER_IDS,
  createProviderAdapters,
  getProviderRuntime,
  getProviderRuntimeDiagnostics,
  keepAliveRegistry,
  resolveDecisionProviders,
};
