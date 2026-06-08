const axios = require("axios");

function numberEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
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

function getConfig() {
  return {
    baseUrl: String(process.env.COZE_API_BASE_URL || "https://api.coze.cn").replace(/\/+$/, ""),
    apiKey: process.env.COZE_API_KEY || "",
    botId: process.env.COZE_BOT_ID || "",
    userId: process.env.COZE_USER_ID || "fosuclass-user",
    chatEndpoint: process.env.COZE_CHAT_ENDPOINT || "/v3/chat",
    pollEnabled: boolEnv("COZE_POLL_ENABLED", true),
    pollIntervalMs: numberEnv("COZE_POLL_INTERVAL_MS", 1000, 200, 10000),
    pollMaxAttempts: numberEnv("COZE_POLL_MAX_ATTEMPTS", 8, 1, 30),
    timeoutMs: numberEnv("AI_TIMEOUT_MS", 15000, 1000, 60000),
  };
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
    if (source.type && !/answer|text|assistant/i.test(String(source.type))) continue;
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
  };
}

function buildRequestBody({ message, intent, toolResults }, config) {
  const safeInput = JSON.stringify({
    message,
    intent: intent && intent.name,
    toolResults,
  });
  return {
    bot_id: config.botId,
    user_id: config.userId,
    stream: false,
    additional_messages: [
      {
        role: "user",
        content: safeInput,
        content_type: "text",
      },
    ],
    input: safeInput,
  };
}

async function pollChatResult(config, pollInfo) {
  if (!config.pollEnabled || !pollInfo.chatId) return "";
  const endpoint = `/v3/chat/retrieve?chat_id=${encodeURIComponent(pollInfo.chatId)}${pollInfo.conversationId ? `&conversation_id=${encodeURIComponent(pollInfo.conversationId)}` : ""}`;
  for (let attempt = 0; attempt < config.pollMaxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    const response = await axios.get(`${config.baseUrl}${endpoint}`, {
      timeout: config.timeoutMs,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    const answer = extractAnswer(response.data);
    if (answer) return answer;
  }
  return "";
}

async function generate(input = {}) {
  const config = getConfig();
  if (!config.apiKey || !config.botId) {
    throw notConfigured();
  }

  const response = await axios.post(`${config.baseUrl}${config.chatEndpoint}`, buildRequestBody(input, config), {
    timeout: config.timeoutMs,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  let answer = extractAnswer(response.data);
  if (!answer) {
    answer = await pollChatResult(config, extractPollInfo(response.data));
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
  extractAnswer,
  generate,
  getConfig,
  name: "coze",
};
