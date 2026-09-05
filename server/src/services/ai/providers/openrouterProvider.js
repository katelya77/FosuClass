const axios = require("axios");
const safetyGuard = require("../safetyGuard");
const deepseekProvider = require("./deepseekProvider");
const openaiStructuredProvider = require("./openaiStructuredProvider");

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODELS = Object.freeze([
  "openrouter/free",
  "z-ai/glm-5.2:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-2.6b:free",
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

function isRouterModel(model) {
  return /^openrouter\//i.test(String(model || "").trim());
}

/**
 * OpenRouter accepts either a concrete `models` fallback list or one router in
 * `model`. Mixing `openrouter/free` into `models` makes the whole request fail
 * validation before any concrete model is attempted. Keep the router as a
 * second, explicit request while preserving the configured priority order.
 */
function buildModelAttempts(models) {
  const attempts = [];
  let concrete = [];
  const flushConcrete = () => {
    if (!concrete.length) return;
    attempts.push({ models: concrete });
    concrete = [];
  };
  parseModels(models).forEach((model) => {
    if (isRouterModel(model)) {
      flushConcrete();
      attempts.push({ model });
      return;
    }
    concrete.push(model);
  });
  flushConcrete();
  return attempts;
}

function canTryNextModel(error) {
  const status = Number(error && (error.status || error.response && error.response.status) || 0);
  const code = String(error && error.code || "");
  if (status === 401 || status === 403 || code === "NOT_CONFIGURED") return false;
  if (/abort|cancel/i.test(code) || error && error.name === "AbortError") return false;
  return true;
}

function remainingTimeout(totalMs, startedAt) {
  return Math.max(0, Number(totalMs || 0) - (Date.now() - startedAt));
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
    stream: false,
    max_tokens: config.maxTokens,
    temperature: conversational ? 0.4 : 0,
    messages,
    provider: providerRouting(!conversational),
  };
  if (!conversational) body.response_format = { type: "json_object" };
  const timeoutMs = Math.max(50, Math.min(config.timeoutMs, Number(input.timeoutMs || config.timeoutMs) || config.timeoutMs));
  const modelAttempts = buildModelAttempts(config.models);
  const startedAt = Date.now();
  let response;
  let lastError;
  for (let index = 0; index < modelAttempts.length; index += 1) {
    const remainingMs = remainingTimeout(timeoutMs, startedAt);
    if (remainingMs <= 0) break;
    try {
      response = await axios.post(`${config.baseUrl}/chat/completions`, Object.assign({}, body, modelAttempts[index]), {
        timeout: Math.max(50, remainingMs),
        signal: input.signal || undefined,
        httpAgent: input.httpAgent || undefined,
        httpsAgent: input.httpsAgent || undefined,
        headers: Object.assign({ Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, headers()),
      });
      break;
    } catch (error) {
      const wrapped = new Error("OpenRouter provider request failed.");
      wrapped.code = deepseekProvider.classifyHttpError(error);
      wrapped.status = error && error.response && error.response.status;
      lastError = wrapped;
      if (index === modelAttempts.length - 1 || !canTryNextModel(wrapped)) throw wrapped;
    }
  }
  if (!response) {
    if (lastError) throw lastError;
    const error = new Error("OpenRouter provider request timed out before a model could be selected.");
    error.code = "provider_timeout";
    throw error;
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
  const timeoutMs = Math.max(50, Math.min(config.timeoutMs, Number(input.timeoutMs || config.timeoutMs) || config.timeoutMs));
  const modelAttempts = buildModelAttempts(config.models);
  const startedAt = Date.now();
  let lastError;
  for (let index = 0; index < modelAttempts.length; index += 1) {
    const remainingMs = remainingTimeout(timeoutMs, startedAt);
    if (remainingMs <= 0) break;
    try {
      const result = await openaiStructuredProvider.generateStructured(Object.assign({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        messages: input.messages,
        maxTokens: input.maxTokens || config.maxTokens,
        timeoutMs: remainingMs,
        provider: "openrouter",
        providerRouting: providerRouting(true),
        preferJsonSchema: Boolean(input.responseSchema),
        responseSchema: input.responseSchema,
        responseSchemaName: input.responseSchemaName,
        // Semantic extraction needs classification, not chain-of-thought. Free
        // reasoning models otherwise spend most of the stage lease thinking
        // before emitting a tiny schema-bound result. OpenRouter normalizes
        // `none` for non-mandatory models and the next configured model remains
        // available when an endpoint rejects it.
        reasoning: { effort: "none", exclude: true },
        headers: headers(),
        classifyError: deepseekProvider.classifyHttpError,
        signal: input.signal || null,
        httpAgent: input.httpAgent,
        httpsAgent: input.httpsAgent,
      }, modelAttempts[index]));
      return Object.assign({}, result, { latencyMs: Date.now() - startedAt });
    } catch (error) {
      lastError = error;
      if (index === modelAttempts.length - 1 || !canTryNextModel(error)) throw error;
    }
  }
  if (lastError) throw lastError;
  const error = new Error("OpenRouter provider request timed out before a model could be selected.");
  error.code = "provider_timeout";
  throw error;
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODELS,
  buildModelAttempts,
  firstConfiguredKey,
  generate,
  generateStructured,
  getConfig,
  name: "openrouter",
  parseModels,
};
