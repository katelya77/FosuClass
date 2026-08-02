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

function providerBaseUrl(id, provider, runtimeConfig = {}) {
  if (id === "deepseek") return runtimeConfig.AI_BASE_URL || "https://api.deepseek.com";
  if (id === "cloudbase-openai") {
    return runtimeConfig.CLOUDBASE_OPENAI_BASE_URL || "https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase";
  }
  if ((id === "custom-openai" || id === "custom-anthropic") && typeof provider.resolveEntry === "function") {
    const entry = provider.resolveEntry(runtimeConfig);
    return entry && entry.baseUrl || "";
  }
  if (id === "coze" && typeof provider.getConfig === "function") {
    const config = provider.getConfig(runtimeConfig);
    return config && (config.workloadEndpoint || config.baseUrl) || "";
  }
  return "";
}

function transportOptions(id, provider, input = {}) {
  const url = providerBaseUrl(id, provider, input.providerRuntimeConfig || {});
  if (!url) return {};
  const agent = keepAliveRegistry.getAgent(url);
  return String(url).startsWith("https:") ? { httpsAgent: agent } : { httpAgent: agent };
}

function createProviderAdapters(options = {}) {
  const modules = options.providerModules || Object.fromEntries(PROVIDER_IDS.map((id) => [id, providerChainService.getProviderModule(id)]));
  return PROVIDER_IDS.map((id) => {
    const provider = modules[id];
    if (!provider || typeof provider.generateStructured !== "function") return null;
    return Object.freeze({
      id,
      async generate(input = {}) {
        if (typeof provider.generate !== "function") {
          const error = new Error(`${id}.generate is unavailable`);
          error.code = "PROVIDER_METHOD_UNSUPPORTED";
          throw error;
        }
        return provider.generate(Object.assign({}, input, transportOptions(id, provider, input), {
          purpose: "response",
          stage: "response",
        }));
      },
      async generateStructured(input = {}) {
        return provider.generateStructured(Object.assign({}, input, transportOptions(id, provider, input), {
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

function configFlag(runtimeConfig, key, fallback = false) {
  const source = runtimeConfig || {};
  const raw = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : process.env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).trim().toLowerCase() === "true";
}

function supportsStage(name, stage, runtimeConfig = {}) {
  const provider = providerChainService.getProviderModule(name);
  if (!provider) return false;
  if (stage === "response") return typeof provider.generate === "function";
  if (stage !== "decision") return typeof provider.generateStructured === "function";
  if (typeof provider.generateStructured !== "function") return false;
  if (name === "coze" && typeof provider.getConfig === "function") {
    const config = provider.getConfig(runtimeConfig);
    if (config && config.apiMode === "workload") {
      // 普通 Coze 工作流返回面向用户的答案流，不保证 DecisionContract JSON。
      // 只有经过专门结构化设计和真实 Probe 的工作流才可显式加入 Decision。
      return configFlag(runtimeConfig, "COZE_STRUCTURED_DECISION_ENABLED", false);
    }
  }
  return true;
}

function resolveStageProviders(stage, runtimeMode, runtimeConfig = {}) {
  if (String(runtimeMode || "public") === "public") {
    return Object.freeze({ intendedProvider: "", fallbackProvider: "", chain: Object.freeze([]) });
  }
  const chain = providerChainService.resolveStageChain(stage, runtimeConfig, runtimeMode)
    .map((name) => providerChainService.normalizeProviderName(name))
    .filter((name) => name && name !== "mock" && PROVIDER_IDS.includes(name))
    .filter((name) => providerChainService.isProviderConfigured(name, runtimeConfig))
    .filter((name) => supportsStage(name, stage, runtimeConfig));
  const unique = Array.from(new Set(chain)).slice(0, 2);
  return Object.freeze({
    intendedProvider: unique[0] || "",
    fallbackProvider: unique[1] || "",
    chain: Object.freeze(unique),
  });
}

function resolveDecisionProviders(runtimeMode, runtimeConfig = {}) {
  const effectiveConfig = Object.assign({}, runtimeConfig);
  if (!effectiveConfig.AI_DECISION_PROVIDER && effectiveConfig.AI_UNDERSTANDING_PROVIDER) {
    effectiveConfig.AI_DECISION_PROVIDER = effectiveConfig.AI_UNDERSTANDING_PROVIDER;
  }
  if (effectiveConfig.AI_DECISION_PROVIDER && !effectiveConfig.AI_UNDERSTANDING_PROVIDER) {
    effectiveConfig.AI_UNDERSTANDING_PROVIDER = effectiveConfig.AI_DECISION_PROVIDER;
  }
  return resolveStageProviders("decision", runtimeMode, effectiveConfig);
}

function resolveResponseProviders(runtimeMode, runtimeConfig = {}) {
  return resolveStageProviders("response", runtimeMode, runtimeConfig);
}

const metrics = createMetricsStore({ sampleLimit: 2000 });
const keepAliveRegistry = createKeepAliveRegistry({ maxSockets: 32, maxFreeSockets: 8 });
const providerRuntime = createProviderRuntime({
  adapters: createProviderAdapters(),
  metrics,
  onEvent: providerChainService.observeRuntimeEvent,
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
  resolveResponseProviders,
  resolveStageProviders,
  supportsStage,
};
