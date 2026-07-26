const axios = require("axios");
const deepseekProvider = require("./deepseekProvider");
const openaiStructuredProvider = require("./openaiStructuredProvider");

const DEFAULT_BASE_URL = "https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase";
const DEFAULT_MODEL = "hy3-preview";

function configuredEnv(name, fallback = "", overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides || {}, name)) {
    const value = overrides[name];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[name] || fallback;
}

function firstConfiguredKey(overrides = {}) {
  return configuredEnv("CLOUDBASE_OPENAI_API_KEY", "", overrides) || "";
}

function boolEnv(name, fallback, overrides = {}) {
  const raw = configuredEnv(name, "", overrides);
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
}

function numberEnv(name, fallback, min, max, overrides = {}) {
  const value = Number(configuredEnv(name, "", overrides));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function classifyHttpError(error) {
  return deepseekProvider.classifyHttpError(error);
}

async function generate({ message, intent, toolResults, projectKnowledge, providerRuntimeConfig }) {
  const runtimeConfig = providerRuntimeConfig || {};
  if (!boolEnv("CLOUDBASE_OPENAI_ENABLED", false, runtimeConfig)) {
    const error = new Error("CloudBase OpenAI provider is disabled.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const apiKey = firstConfiguredKey(runtimeConfig);
  if (!apiKey) {
    const error = new Error("CloudBase OpenAI provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const baseUrl = String(configuredEnv("CLOUDBASE_OPENAI_BASE_URL", DEFAULT_BASE_URL, runtimeConfig)).replace(/\/+$/, "");
  const model = configuredEnv("CLOUDBASE_OPENAI_TEXT_MODEL", DEFAULT_MODEL, runtimeConfig);
  const timeout = numberEnv("CLOUDBASE_OPENAI_TIMEOUT_MS", 15000, 1000, 60000, runtimeConfig);
  const maxTokens = numberEnv("CLOUDBASE_OPENAI_MAX_TOKENS", 1200, 128, 4096, runtimeConfig);
  const conversational = intent && (intent.name === "project_qa" || intent.name === "conversational_help");
  const useJsonMode = deepseekProvider.shouldUseJsonMode(intent, runtimeConfig);
  const body = {
    model,
    stream: false,
    max_tokens: maxTokens,
    temperature: conversational ? 0.7 : 0.1,
    messages: [
      {
        role: "system",
        content: deepseekProvider.buildSystemPrompt(
          conversational ? projectKnowledge : "",
          { useJsonMode, conversational: Boolean(conversational) }
        ),
      },
      {
        role: "user",
        content: JSON.stringify({
          message,
          intent: intent && intent.name,
          toolResults,
        }),
      },
    ],
  };
  if (useJsonMode) body.response_format = { type: "json_object" };

  let response;
  try {
    response = await axios.post(`${baseUrl}/chat/completions`, body, {
      timeout,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const wrapped = new Error("CloudBase OpenAI provider request failed.");
    wrapped.code = classifyHttpError(error);
    wrapped.status = error && error.response && error.response.status;
    throw wrapped;
  }
  const content = response.data &&
    response.data.choices &&
    response.data.choices[0] &&
    response.data.choices[0].message &&
    response.data.choices[0].message.content;
  if (!useJsonMode) {
    const parsedTextMode = deepseekProvider.parseJsonFromText(content);
    if (parsedTextMode && typeof parsedTextMode === "object") {
      return Object.assign({ provider: "cloudbase-openai" }, parsedTextMode);
    }
    return Object.assign(deepseekProvider.wrapTextResponse(content), { provider: "cloudbase-openai" });
  }
  const parsed = deepseekProvider.parseJsonFromText(content) || deepseekProvider.parseJsonCodeBlock(content);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("CloudBase OpenAI provider returned invalid JSON.");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  return Object.assign({ provider: "cloudbase-openai" }, parsed);
}

async function generateStructured(input = {}) {
  const runtimeConfig = input.providerRuntimeConfig || {};
  if (!boolEnv("CLOUDBASE_OPENAI_ENABLED", false, runtimeConfig)) {
    const error = new Error("CloudBase OpenAI provider is disabled.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const apiKey = firstConfiguredKey(runtimeConfig);
  if (!apiKey) {
    const error = new Error("CloudBase OpenAI provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  return openaiStructuredProvider.generateStructured({
    baseUrl: configuredEnv("CLOUDBASE_OPENAI_BASE_URL", DEFAULT_BASE_URL, runtimeConfig),
    apiKey,
    model: configuredEnv(
      input.purpose === "understanding" ? "AI_UNDERSTANDING_MODEL" : "AI_PLANNER_MODEL",
      configuredEnv("CLOUDBASE_OPENAI_TEXT_MODEL", DEFAULT_MODEL, runtimeConfig),
      runtimeConfig
    ),
    messages: input.messages,
    maxTokens: input.maxTokens || numberEnv("CLOUDBASE_OPENAI_STRUCTURED_MAX_TOKENS", 800, 128, 2000, runtimeConfig),
    timeoutMs: input.timeoutMs || numberEnv("CLOUDBASE_OPENAI_STRUCTURED_TIMEOUT_MS", 8000, 1000, 30000, runtimeConfig),
    provider: "cloudbase-openai",
    classifyError: classifyHttpError,
  });
}

module.exports = {
  classifyHttpError,
  firstConfiguredKey,
  generate,
  generateStructured,
  name: "cloudbase-openai",
};
