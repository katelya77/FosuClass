const axios = require("axios");
const deepseekProvider = require("./deepseekProvider");
const customProviderStore = require("../customProviderStore");
const safetyGuard = require("../safetyGuard");

/**
 * 自定义 Anthropic 协议兼容 Provider（CCSwitch 式第三方端点）。
 * 配置来源：AI_CUSTOM_PROVIDERS 加密列表中协议 = anthropic 的生效条目。
 * baseUrl 规范化为以 /v1 结尾；消息接口 POST {baseUrl}/messages。
 */

const ANTHROPIC_VERSION = "2023-06-01";

function resolve(runtimeConfig = {}) {
  return customProviderStore.resolveEntry(runtimeConfig, "anthropic");
}

function notConfiguredError() {
  const error = new Error("Custom Anthropic-compatible provider is not configured.");
  error.code = "NOT_CONFIGURED";
  return error;
}

function classifyHttpError(error) {
  const status = error && error.response && error.response.status;
  if (status) return deepseekProvider.classifyHttpError(error);
  return String(error && error.code || "PROVIDER_REQUEST_FAILED");
}

// Anthropic 要求 messages 角色交替：向会话追加一条消息，若与末条同角色则合并内容。
function appendAlternating(conversation, item) {
  const last = conversation[conversation.length - 1];
  if (last && last.role === item.role) {
    last.content = `${last.content}\n${item.content}`;
    return;
  }
  conversation.push({ role: item.role, content: item.content });
}

function toAnthropicMessages(messages) {
  const system = [];
  const conversation = [];
  (Array.isArray(messages) ? messages : []).slice(0, 8).forEach((item) => {
    const content = safetyGuard.redactSensitiveText(String(item && item.content || "")).slice(0, 5000);
    if (!content) return;
    if (item && item.role === "system") {
      system.push(content);
      return;
    }
    conversation.push({
      role: item && item.role === "assistant" ? "assistant" : "user",
      content,
    });
  });
  // Anthropic 要求首条为 user：空对话补一条占位。
  if (!conversation.length) conversation.push({ role: "user", content: "ping" });
  if (conversation[0].role !== "user") {
    conversation.unshift({ role: "user", content: "（接续对话）" });
  }
  return { system: system.join("\n\n"), messages: conversation };
}

function extractText(data) {
  const blocks = data && Array.isArray(data.content) ? data.content : [];
  return blocks
    .filter((block) => block && block.type === "text")
    .map((block) => String(block.text || ""))
    .join("")
    .trim();
}

async function postMessages(entry, body, timeoutMs) {
  try {
    return await axios.post(`${entry.baseUrl}/messages`, body, {
      timeout: timeoutMs,
      headers: {
        "x-api-key": entry.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const wrapped = new Error("Custom Anthropic-compatible provider request failed.");
    wrapped.code = classifyHttpError(error);
    wrapped.status = error && error.response && error.response.status;
    throw wrapped;
  }
}

async function generate({ message, intent, toolResults, projectKnowledge, providerRuntimeConfig, history }) {
  const runtimeConfig = providerRuntimeConfig || {};
  const entry = resolve(runtimeConfig);
  if (!entry) throw notConfiguredError();
  const timeout = Math.max(1000, Math.min(60000, Number(runtimeConfig.AI_TIMEOUT_MS || 15000) || 15000));
  const maxTokens = Math.max(128, Math.min(4096, Number(runtimeConfig.AI_MAX_TOKENS || 1200) || 1200));
  const conversational = intent && (intent.name === "project_qa" || intent.name === "conversational_help");
  const useJsonMode = deepseekProvider.shouldUseJsonMode(intent, runtimeConfig);
  const systemPrompt = deepseekProvider.buildSystemPrompt(
    conversational ? projectKnowledge : "",
    { useJsonMode, conversational: Boolean(conversational) }
  );
  // Anthropic 要求 messages 首条为 user 且角色交替：历史与当前消息逐条按交替规则追加。
  const conversation = [];
  deepseekProvider.buildHistoryMessages(history, message).forEach((item) => appendAlternating(conversation, item));
  appendAlternating(conversation, {
    role: "user",
    content: JSON.stringify({ message, intent: intent && intent.name, toolResults }),
  });
  if (conversation[0].role !== "user") {
    conversation.unshift({ role: "user", content: "（接续对话）" });
  }
  const started = Date.now();
  const response = await postMessages(entry, {
    model: entry.model,
    max_tokens: maxTokens,
    temperature: conversational ? 0.7 : 0.1,
    system: systemPrompt,
    messages: conversation,
  }, timeout);
  const content = extractText(response.data);
  if (!useJsonMode) {
    const parsedTextMode = deepseekProvider.parseJsonFromText(content);
    if (parsedTextMode && typeof parsedTextMode === "object") {
      return Object.assign({ provider: "custom-anthropic" }, parsedTextMode);
    }
    return Object.assign(deepseekProvider.wrapTextResponse(content), { provider: "custom-anthropic" });
  }
  const parsed = deepseekProvider.parseJsonFromText(content) || deepseekProvider.parseJsonCodeBlock(content);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("Custom Anthropic-compatible provider returned invalid JSON.");
    error.code = "INVALID_PROVIDER_JSON";
    error.latencyMs = Date.now() - started;
    throw error;
  }
  return Object.assign({ provider: "custom-anthropic" }, parsed);
}

async function generateStructured(input = {}) {
  const runtimeConfig = input.providerRuntimeConfig || {};
  const entry = resolve(runtimeConfig);
  if (!entry) throw notConfiguredError();
  const timeoutMs = input.timeoutMs || Math.max(1000, Math.min(30000, Number(runtimeConfig.AI_STRUCTURED_TIMEOUT_MS || 8000) || 8000));
  const model = String(
    input.purpose === "understanding"
      ? runtimeConfig.AI_UNDERSTANDING_MODEL || ""
      : runtimeConfig.AI_PLANNER_MODEL || ""
  ) || entry.model;
  const shaped = toAnthropicMessages(input.messages);
  const started = Date.now();
  const response = await postMessages(entry, {
    model,
    max_tokens: Math.max(128, Math.min(2000, Number(input.maxTokens || 800) || 800)),
    temperature: 0,
    system: shaped.system
      ? `${shaped.system}\n\n只输出一个 JSON 对象，不要输出 Markdown 代码块或任何解释。`
      : "只输出一个 JSON 对象，不要输出 Markdown 代码块或任何解释。",
    messages: shaped.messages,
  }, timeoutMs);
  const content = extractText(response.data);
  if (!content) {
    const error = new Error("Custom Anthropic-compatible provider returned an empty response");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  return {
    content,
    text: content,
    provider: "custom-anthropic",
    latencyMs: Date.now() - started,
    usage: response.data && response.data.usage || null,
  };
}

async function testConnection(options = {}) {
  const runtimeConfig = options.providerRuntimeConfig || {};
  const entry = resolve(runtimeConfig);
  if (!entry) {
    return { ok: false, code: "NOT_CONFIGURED" };
  }
  const started = Date.now();
  try {
    await postMessages(entry, {
      model: entry.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "ping" }],
    }, Math.max(2000, Math.min(12000, Number(options.timeoutMs || 8000) || 8000)));
    return { ok: true, latencyMs: Date.now() - started, model: entry.model };
  } catch (error) {
    return { ok: false, code: String(error.code || "provider_failed"), latencyMs: Date.now() - started };
  }
}

module.exports = {
  classifyHttpError,
  generate,
  generateStructured,
  name: "custom-anthropic",
  resolveEntry: resolve,
  testConnection,
};
