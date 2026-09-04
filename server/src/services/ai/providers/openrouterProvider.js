const axios = require("axios");
const safetyGuard = require("../safetyGuard");
const deepseekProvider = require("./deepseekProvider");
const openaiStructuredProvider = require("./openaiStructuredProvider");

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODELS = Object.freeze([
  "z-ai/glm-5.2:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-2.6b:free",
  "openrouter/free",
]);

function configValue(runtimeConfig, key, fallback = "") {
  const source = runtimeConfig || {};
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    const value = source[key];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[key] || fallback;
}

function parseModels(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  const models = list.map((item) => String(item || "").trim()).filter(Boolean);
  return Array.from(new Set(models)).slice(0, 8);
}

function firstConfiguredKey(runtimeConfig = {}) {
  return String(configValue(runtimeConfig, "OPENROUTER_API_KEY", "")).trim();
}

function getConfig(runtimeConfig = {}) {
  const configuredModels = parseModels(configValue(runtimeConfig, "OPENROUTER_MODELS", ""));
  return {
    enabled: String(configValue(runtimeConfig, "OPENROUTER_ENABLED", "false")).toLowerCase() === "true",
    apiKey: firstConfiguredKey(runtimeConfig),
    baseUrl: String(configValue(runtimeConfig, "OPENROUTER_BASE_URL", DEFAULT_BASE_URL)).replace(/\/+$/, ""),
    models: configuredModels.length ? configuredModels : DEFAULT_MODELS.slice(),
    timeoutMs: Math.max(1000, Math.min(60000, Number(configValue(runtimeConfig, "OPENROUTER_TIMEOUT_MS", "12000")) || 12000)),
    maxTokens: Math.max(128, Math.min(2000, Number(configValue(runtimeConfig, "OPENROUTER_MAX_TOKENS", "800")) || 800)),
  };
}

function providerRouting(requireParameters) {
  return {
    allow_fallbacks: true,
    require_parameters: requireParameters === true,
    data_collection: "deny",
  };
}

function headers() {
  return {
    "HTTP-Referer": "https://fosuclass.cn",
    "X-OpenRouter-Title": "FosuClass Xiaoxu",
  };
}

async function generate(input = {}) {
  const runtimeConfig = input.providerRuntimeConfig || {};
  const config = getConfig(runtimeConfig);
  if (!config.enabled || !config.apiKey) {
    const error = new Error("OpenRouter provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const conversational = deepseekProvider.shouldUseJsonMode(input.intent, runtimeConfig) === false;
  const userProfile = deepseekProvider.buildUserProfileText(input.userMemories);
  const messages = [
    {
      role: "system",
      content: deepseekProvider.buildSystemPrompt(
        conversational ? input.projectKnowledge : "",
        { useJsonMode: !conversational, conversational, userProfile }
      ),
    },
    ...deepseekProvider.buildHistoryMessages(input.history, input.message),
    {
      role: "user",
      content: safetyGuard.redactSensitiveText(JSON.stringify({
        message: input.message,
        intent: input.intent && input.intent.name,
        toolResults: input.toolResults,
        userProfile: userProfile || undefined,
      })).slice(0, 10000),
    },
  ];
  const body = {
    models: config.models,
    stream: false,
    max_tokens: config.maxTokens,
    temperature: conversational ? 0.4 : 0,
    messages,
    provider: providerRouting(!conversational),
  };
  if (!conversational) body.response_format = { type: "json_object" };
  let response;
  try {
    response = await axios.post(`${config.baseUrl}/chat/completions`, body, {
      timeout: Math.min(config.timeoutMs, Number(input.timeoutMs || config.timeoutMs) || config.timeoutMs),
      signal: input.signal || undefined,
      httpAgent: input.httpAgent || undefined,
      httpsAgent: input.httpsAgent || undefined,
      headers: Object.assign({ Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, headers()),
    });
  } catch (error) {
    const wrapped = new Error("OpenRouter provider request failed.");
    wrapped.code = deepseekProvider.classifyHttpError(error);
    wrapped.status = error && error.response && error.response.status;
    throw wrapped;
  }
  const content = response.data && response.data.choices && response.data.choices[0]
    && response.data.choices[0].message && response.data.choices[0].message.content;
  if (conversational) {
    const wrapped = deepseekProvider.wrapTextResponse(content, {
      intentName: input.intent && input.intent.name,
      runtimeMode: input.runtimeMode || "trial",
    });
    return Object.assign({}, wrapped, { provider: "openrouter", resolvedModel: String(response.data && response.data.model || "") });
  }
  const parsed = deepseekProvider.parseJsonFromText(content) || deepseekProvider.parseJsonCodeBlock(content);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("OpenRouter provider returned invalid JSON.");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  return Object.assign({ provider: "openrouter", resolvedModel: String(response.data && response.data.model || "") }, parsed);
}

async function generateStructured(input = {}) {
  const runtimeConfig = input.providerRuntimeConfig || {};
  const config = getConfig(runtimeConfig);
  if (!config.enabled || !config.apiKey) {
    const error = new Error("OpenRouter provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  return openaiStructuredProvider.generateStructured({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    models: config.models,
    messages: input.messages,
    maxTokens: input.maxTokens || config.maxTokens,
    timeoutMs: input.timeoutMs || config.timeoutMs,
    provider: "openrouter",
    providerRouting: providerRouting(true),
    headers: headers(),
    classifyError: deepseekProvider.classifyHttpError,
    signal: input.signal || null,
    httpAgent: input.httpAgent,
    httpsAgent: input.httpsAgent,
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODELS,
  firstConfiguredKey,
  generate,
  generateStructured,
  getConfig,
  name: "openrouter",
  parseModels,
};
