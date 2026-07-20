/**
 * Temporary Coze Open API V3 provider.
 * Auth: PAT / Service API Token only. Never browser cookies or account passwords.
 */
const crypto = require("crypto");
const axios = require("axios");

function configuredEnv(name, fallback = "", overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides || {}, name)) {
    const value = overrides[name];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[name] || fallback;
}

function numberEnv(name, fallback, min, max, overrides = {}) {
  const value = Number(configuredEnv(name, "", overrides));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function boolEnv(name, fallback, overrides = {}) {
  const raw = configuredEnv(name, "", overrides);
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
}

function notConfigured() {
  const error = new Error("Coze provider is not configured.");
  error.code = "NOT_CONFIGURED";
  return error;
}

function unsupported() {
  const error = new Error("Coze provider response is unsupported.");
  error.code = "COZE_RESPONSE_UNSUPPORTED";
  return error;
}

function expiredError() {
  const error = new Error("Coze temporary provider has expired.");
  error.code = "PROVIDER_EXPIRED";
  error.status = 403;
  return error;
}

function mapHttpError(error) {
  const status = Number(error && error.response && error.response.status || 0) || 0;
  const data = error && error.response && error.response.data || {};
  const code = String(data.code || data.error_code || data.error || error.code || "");
  const message = String(data.msg || data.message || error.message || "Coze request failed").slice(0, 200);
  const mapped = new Error(message);
  mapped.status = status;
  mapped.statusCode = status;
  if (status === 401) mapped.code = "unauthorized";
  else if (status === 403) mapped.code = "forbidden";
  else if (status === 429) mapped.code = "rate_limited";
  else if (/timeout/i.test(String(error.code || "")) || /timeout/i.test(message)) mapped.code = "timeout";
  else if (/not.?publish|unpublished|bot/i.test(message)) mapped.code = "bot_not_published";
  else mapped.code = code || "provider_failed";
  return mapped;
}

function getConfig(overrides = {}) {
  return {
    enabled: boolEnv("COZE_ENABLED", true, overrides),
    expiresAt: String(configuredEnv("COZE_EXPIRES_AT", "", overrides) || "").trim(),
    providerRole: String(configuredEnv("COZE_PROVIDER_ROLE", "temporary", overrides) || "temporary"),
    baseUrl: String(configuredEnv("COZE_API_BASE_URL", "https://api.coze.cn", overrides)).replace(/\/+$/, ""),
    apiKey: configuredEnv("COZE_API_KEY", "", overrides),
    botId: configuredEnv("COZE_BOT_ID", "", overrides) || configuredEnv("COZE_AGENT_ID", "", overrides),
    chatEndpoint: configuredEnv("COZE_CHAT_ENDPOINT", "/v3/chat", overrides),
    pollIntervalMs: numberEnv("COZE_POLL_INTERVAL_MS", 1000, 200, 10000, overrides),
    pollMaxAttempts: numberEnv("COZE_POLL_MAX_ATTEMPTS", 12, 1, 40, overrides),
    timeoutMs: numberEnv("COZE_TIMEOUT_MS", numberEnv("AI_TIMEOUT_MS", 15000, 1000, 60000, overrides), 1000, 60000, overrides),
  };
}

function isExpired(overrides = {}) {
  const config = typeof overrides.apiKey === "string" || overrides.COZE_EXPIRES_AT !== undefined
    ? getConfig(overrides)
    : getConfig(overrides);
  if (!config.expiresAt) return false;
  const ms = Date.parse(config.expiresAt);
  return Number.isFinite(ms) && ms <= Date.now();
}

function isEnabled(overrides = {}) {
  const config = getConfig(overrides);
  if (config.enabled === false) return false;
  if (isExpired(overrides)) return false;
  return Boolean(config.apiKey && config.botId);
}

function buildPseudoUserId(principal = null, overrides = {}) {
  const secret = String(
    process.env.FOSU_AGENT_MEMORY_SECRET
    || process.env.FOSU_SESSION_SECRET_CURRENT
    || process.env.FOSU_SESSION_SECRET
    || "dev-only-coze-user-secret"
  );
  const material = [
    "coze-user",
    principal && principal.principalKey || "",
    principal && principal.runtimeMode || "",
    principal && principal.deployEnv || process.env.FOSU_DEPLOY_ENV || process.env.NODE_ENV || "development",
  ].join("|");
  const digest = crypto.createHmac("sha256", secret).update(material).digest("hex").slice(0, 24);
  return `fosu-${digest}`;
}

function normalizeParsedPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    answer: String(payload.answer || payload.content || ""),
    cards: Array.isArray(payload.cards) ? payload.cards : [],
    suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
  };
}

function parseJsonMaybe(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

function pickMessageText(messages) {
  if (!Array.isArray(messages)) return "";
  const candidates = messages.slice().reverse();
  for (const item of candidates) {
    const source = item || {};
    const role = String(source.role || "").toLowerCase();
    const type = String(source.type || source.msg_type || "").toLowerCase();
    if (role === "user") continue;
    if (type && !/answer|text|assistant|verbose/i.test(type)) continue;
    if (type === "verbose") continue;
    const text = source.content || source.answer || source.text;
    if (text) return String(text);
  }
  return "";
}

function extractAnswer(responseData) {
  const source = responseData || {};
  if (source.answer || source.content) return String(source.answer || source.content);
  if (source.data && (source.data.answer || source.data.content || source.data.output)) {
    return String(source.data.answer || source.data.content || source.data.output);
  }
  const directMessage = pickMessageText(source.messages);
  if (directMessage) return directMessage;
  const dataMessage = pickMessageText(source.data && source.data.messages);
  if (dataMessage) return dataMessage;
  return "";
}

function extractPollInfo(responseData) {
  const data = responseData && responseData.data || responseData || {};
  return {
    chatId: data.chat_id || data.chatId || data.id || "",
    conversationId: data.conversation_id || data.conversationId || "",
    status: String(data.status || data.chat_status || "").toLowerCase(),
  };
}

function buildSafeUserContent(input = {}) {
  const toolResults = Array.isArray(input.toolResults)
    ? input.toolResults.map((item) => ({
      name: String(item.name || "").slice(0, 60),
      status: String(item.status || "").slice(0, 20),
      summary: String(item.summary || "").slice(0, 200),
    })).slice(0, 8)
    : [];
  return JSON.stringify({
    message: String(input.message || "").slice(0, 1200),
    intent: input.intent && input.intent.name ? String(input.intent.name).slice(0, 80) : "",
    toolResults,
    projectKnowledge: String(input.projectKnowledge || "").slice(0, 1500),
    conversationSummary: String(input.context && input.context.conversationSummary || "").slice(0, 400),
  });
}

function buildRequestBody(input, config, userId) {
  return {
    bot_id: config.botId,
    user_id: userId,
    stream: false,
    auto_save_history: false,
    additional_messages: [
      {
        role: "user",
        content: buildSafeUserContent(input),
        content_type: "text",
      },
    ],
  };
}

async function retrieveChat(config, pollInfo) {
  const endpoint = `/v3/chat/retrieve?chat_id=${encodeURIComponent(pollInfo.chatId)}${pollInfo.conversationId ? `&conversation_id=${encodeURIComponent(pollInfo.conversationId)}` : ""}`;
  const response = await axios.get(`${config.baseUrl}${endpoint}`, {
    timeout: config.timeoutMs,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  return response.data;
}

async function listMessages(config, pollInfo) {
  const endpoint = `/v3/chat/message/list?chat_id=${encodeURIComponent(pollInfo.chatId)}${pollInfo.conversationId ? `&conversation_id=${encodeURIComponent(pollInfo.conversationId)}` : ""}`;
  const response = await axios.get(`${config.baseUrl}${endpoint}`, {
    timeout: config.timeoutMs,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  return response.data;
}

async function pollChatResult(config, pollInfo) {
  if (!pollInfo.chatId) return "";
  for (let attempt = 0; attempt < config.pollMaxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    let retrieveData;
    try {
      retrieveData = await retrieveChat(config, pollInfo);
    } catch (error) {
      throw mapHttpError(error);
    }
    const info = extractPollInfo(retrieveData);
    const status = info.status || extractPollInfo(retrieveData).status;
    if (status === "failed" || status === "canceled" || status === "cancelled") {
      const error = new Error("Coze chat failed");
      error.code = "provider_failed";
      throw error;
    }
    if (status === "completed" || status === "requires_action") {
      try {
        const messageData = await listMessages(config, pollInfo);
        const fromList = extractAnswer(messageData) || pickMessageText(messageData && messageData.data);
        if (fromList) return fromList;
      } catch (error) {
        // fall through to extract from retrieve payload
      }
      const fromRetrieve = extractAnswer(retrieveData);
      if (fromRetrieve) return fromRetrieve;
      if (status === "completed") return "";
    }
    const early = extractAnswer(retrieveData);
    if (early) return early;
  }
  const error = new Error("Coze chat polling timed out");
  error.code = "timeout";
  throw error;
}

async function generate(input = {}) {
  const runtimeConfig = input.providerRuntimeConfig || {};
  const config = getConfig(runtimeConfig);
  if (!config.enabled) throw notConfigured();
  if (isExpired(runtimeConfig)) throw expiredError();
  if (!config.apiKey || !config.botId) throw notConfigured();

  const userId = buildPseudoUserId(input.principal || null, runtimeConfig);
  let createResponse;
  try {
    createResponse = await axios.post(
      `${config.baseUrl}${config.chatEndpoint}`,
      buildRequestBody(input, config, userId),
      {
        timeout: config.timeoutMs,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    throw mapHttpError(error);
  }

  let answer = extractAnswer(createResponse.data);
  const pollInfo = extractPollInfo(createResponse.data);
  const createStatus = String(pollInfo.status || "").toLowerCase();
  if (!answer && (createStatus === "in_progress" || createStatus === "created" || createStatus === "pending" || pollInfo.chatId)) {
    answer = await pollChatResult(config, pollInfo);
  }
  if (!answer) throw unsupported();

  const parsed = normalizeParsedPayload(parseJsonMaybe(answer)) || {
    answer,
    cards: [],
    suggestions: [],
  };
  return Object.assign({ provider: "coze" }, parsed);
}

module.exports = {
  buildPseudoUserId,
  buildSafeUserContent,
  extractAnswer,
  extractPollInfo,
  generate,
  getConfig,
  isEnabled,
  isExpired,
  listMessages,
  name: "coze",
  retrieveChat,
};
