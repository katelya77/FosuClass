const axios = require("axios");
const deepseekProvider = require("./deepseekProvider");
const openaiStructuredProvider = require("./openaiStructuredProvider");
const customProviderStore = require("../customProviderStore");

/**
 * 自定义 OpenAI 协议兼容 Provider（CCSwitch 式第三方端点）。
 * 配置来源：AI_CUSTOM_PROVIDERS 加密列表中协议 = openai 的生效条目。
 */

function resolve(runtimeConfig = {}) {
  return customProviderStore.resolveEntry(runtimeConfig, "openai");
}

function notConfiguredError() {
  const error = new Error("Custom OpenAI-compatible provider is not configured.");
  error.code = "NOT_CONFIGURED";
  return error;
}

function classifyHttpError(error) {
  return deepseekProvider.classifyHttpError(error);
}

async function generate({ message, intent, toolResults, projectKnowledge, providerRuntimeConfig, history }) {
  const runtimeConfig = providerRuntimeConfig || {};
  const entry = resolve(runtimeConfig);
  if (!entry) throw notConfiguredError();
  const timeout = Math.max(1000, Math.min(60000, Number(runtimeConfig.AI_TIMEOUT_MS || 15000) || 15000));
  const maxTokens = Math.max(128, Math.min(4096, Number(runtimeConfig.AI_MAX_TOKENS || 1200) || 1200));
  const conversational = intent && (intent.name === "project_qa" || intent.name === "conversational_help");
  const useJsonMode = entry.strictJsonMode && deepseekProvider.shouldUseJsonMode(intent, runtimeConfig);
  const body = {
    model: entry.model,
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
      ...deepseekProvider.buildHistoryMessages(history, message),
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
    response = await axios.post(`${entry.baseUrl}/chat/completions`, body, {
      timeout,
      headers: {
        Authorization: `Bearer ${entry.apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const wrapped = new Error("Custom OpenAI-compatible provider request failed.");
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
      return Object.assign({ provider: "custom-openai" }, parsedTextMode);
    }
    return Object.assign(deepseekProvider.wrapTextResponse(content), { provider: "custom-openai" });
  }
  const parsed = deepseekProvider.parseJsonFromText(content) || deepseekProvider.parseJsonCodeBlock(content);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("Custom OpenAI-compatible provider returned invalid JSON.");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  return Object.assign({ provider: "custom-openai" }, parsed);
}

async function generateStructured(input = {}) {
  const runtimeConfig = input.providerRuntimeConfig || {};
  const entry = resolve(runtimeConfig);
  if (!entry) throw notConfiguredError();
  if (entry.strictJsonMode === false) {
    // 部分第三方网关不支持 response_format：退化为普通请求 + 由调用方 JSON 修复解析。
    return generateStructuredLoose(input, entry, runtimeConfig);
  }
  return openaiStructuredProvider.generateStructured({
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey,
    model: String(
      input.purpose === "understanding"
        ? runtimeConfig.AI_UNDERSTANDING_MODEL || ""
        : runtimeConfig.AI_PLANNER_MODEL || ""
    ) || entry.model,
    messages: input.messages,
    maxTokens: input.maxTokens || Math.max(128, Math.min(2000, Number(runtimeConfig.AI_STRUCTURED_MAX_TOKENS || 800) || 800)),
    timeoutMs: input.timeoutMs || Math.max(1000, Math.min(30000, Number(runtimeConfig.AI_STRUCTURED_TIMEOUT_MS || 8000) || 8000)),
    provider: "custom-openai",
    classifyError: classifyHttpError,
  });
}

async function generateStructuredLoose(input, entry, runtimeConfig) {
  const safetyGuard = require("../safetyGuard");
  const timeoutMs = input.timeoutMs || Math.max(1000, Math.min(30000, Number(runtimeConfig.AI_STRUCTURED_TIMEOUT_MS || 8000) || 8000));
  const messages = (Array.isArray(input.messages) ? input.messages : []).slice(0, 6).map((item) => ({
    role: item && (item.role === "system" || item.role === "assistant") ? item.role : "user",
    content: safetyGuard.redactSensitiveText(String(item && item.content || "")).slice(0, 5000),
  }));
  const started = Date.now();
  try {
    const response = await axios.post(
      `${entry.baseUrl}/chat/completions`,
      {
        model: entry.model,
        stream: false,
        max_tokens: Math.max(128, Math.min(2000, Number(input.maxTokens || 800) || 800)),
        temperature: 0,
        messages,
      },
      {
        timeout: timeoutMs,
        headers: { Authorization: `Bearer ${entry.apiKey}`, "Content-Type": "application/json" },
      }
    );
    const content = response.data && response.data.choices && response.data.choices[0]
      && response.data.choices[0].message && response.data.choices[0].message.content;
    if (!String(content || "").trim()) {
      const error = new Error("Custom OpenAI-compatible provider returned an empty response");
      error.code = "INVALID_PROVIDER_JSON";
      throw error;
    }
    return { content: String(content), text: String(content), provider: "custom-openai", latencyMs: Date.now() - started, usage: response.data && response.data.usage || null };
  } catch (error) {
    if (error && error.code === "INVALID_PROVIDER_JSON") throw error;
    const wrapped = new Error("Custom OpenAI-compatible structured request failed");
    wrapped.code = classifyHttpError(error);
    wrapped.status = error && error.response && error.response.status;
    throw wrapped;
  }
}

async function testConnection(options = {}) {
  const runtimeConfig = options.providerRuntimeConfig || {};
  const entry = resolve(runtimeConfig);
  if (!entry) {
    return { ok: false, code: "NOT_CONFIGURED" };
  }
  const started = Date.now();
  try {
    await axios.post(
      `${entry.baseUrl}/chat/completions`,
      {
        model: entry.model,
        stream: false,
        max_tokens: 16,
        temperature: 0,
        messages: [{ role: "user", content: "ping" }],
      },
      {
        timeout: Math.max(2000, Math.min(12000, Number(options.timeoutMs || 8000) || 8000)),
        headers: { Authorization: `Bearer ${entry.apiKey}`, "Content-Type": "application/json" },
      }
    );
    return { ok: true, latencyMs: Date.now() - started, model: entry.model };
  } catch (error) {
    return {
      ok: false,
      code: classifyHttpError(error),
      latencyMs: Date.now() - started,
    };
  }
}

module.exports = {
  classifyHttpError,
  generate,
  generateStructured,
  name: "custom-openai",
  resolveEntry: resolve,
  testConnection,
};
