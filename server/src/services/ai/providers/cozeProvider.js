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

function normalizeApiMode(value, workloadEndpoint = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (["workload", "project", "stream_run", "coze-coding"].includes(mode)) return "workload";
  if (String(workloadEndpoint || "").includes("/stream_run")) return "workload";
  return "bot";
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
  else if (status === 429) mapped.code = "rate_limited";
  else if (/timeout|ECONNABORTED|ETIMEDOUT/i.test(`${String(error.code || "")} ${message}`)) mapped.code = "timeout";
  else if (/not\s+(?:been\s+)?publish|unpublished|未发布|publish.*api/i.test(message)) mapped.code = "bot_not_published";
  else if (/project.*not\s*found|app.*not\s*found/i.test(message)) mapped.code = "project_not_found";
  else if (status === 404 || /bot.*not\s*found|agent.*not\s*found|不存在/i.test(message)) mapped.code = "bot_not_found";
  else if (status === 403) mapped.code = "forbidden";
  else mapped.code = code || "provider_failed";
  return mapped;
}

function classifyConnectionError(error) {
  const status = Number(error && (error.status || error.statusCode || error.response && error.response.status) || 0) || 0;
  const data = error && error.response && error.response.data || {};
  const providerCode = String(data.code || data.error_code || error && error.code || "");
  const rawMessage = String(data.msg || data.message || error && error.message || "");
  const text = `${providerCode} ${rawMessage}`.toLowerCase();
  if (/timeout|econnaborted|etimedout/.test(text) || status === 408) {
    return { code: "COZE_TIMEOUT", reason: "timeout", message: "连接 Coze 超时，请检查网络、区域域名或稍后重试。", retryable: true };
  }
  if (status === 401 || providerCode === "4100" || /unauthori[sz]ed|invalid.*token|token.*invalid|鉴权|令牌无效/.test(text)) {
    return { code: "COZE_TOKEN_INVALID", reason: "token_invalid", message: "Coze Token 无效或已过期。", retryable: false };
  }
  if (status === 429 || providerCode === "4013" || /rate.?limit|too many requests|限流/.test(text)) {
    return { code: "COZE_RATE_LIMITED", reason: "rate_limited", message: "Coze 当前触发限流，请稍后重试。", retryable: true };
  }
  if (/not\s+(?:been\s+)?publish|unpublished|not.?publish|未发布|publish.*api/.test(text)) {
    return { code: "COZE_BOT_NOT_PUBLISHED", reason: "bot_not_published", message: "该 Bot 尚未发布为 API 服务。", retryable: false };
  }
  if (providerCode === "project_not_found" || /project.*not\s*found|app.*not\s*found/.test(text)) {
    return { code: "COZE_PROJECT_NOT_FOUND", reason: "project_not_found", message: "找不到该 Coze 项目，请核对项目 ID 与部署入口。", retryable: false };
  }
  if (status === 404 || providerCode === "4200" || /bot.*not\s*found|agent.*not\s*found|bot.*不存在/.test(text)) {
    return { code: "COZE_BOT_NOT_FOUND", reason: "bot_not_found", message: "找不到该 Coze Bot，请核对 Bot ID 和区域域名。", retryable: false };
  }
  if (status === 403 || providerCode === "4101" || /forbidden|permission|no access|无权限/.test(text)) {
    return { code: "COZE_PERMISSION_DENIED", reason: "permission_denied", message: "当前 Token 无权访问该 Bot 或工作空间。", retryable: false };
  }
  if (providerCode === "PROVIDER_EXPIRED") {
    return { code: "COZE_TOKEN_EXPIRED", reason: "configured_expiry", message: "配置的 Coze 临时凭证已到期。", retryable: false };
  }
  if (providerCode === "COZE_RESPONSE_UNSUPPORTED") {
    return { code: "COZE_RESPONSE_INVALID", reason: "response_invalid", message: "Coze 已响应，但返回结构无法识别。", retryable: false };
  }
  return { code: "COZE_CONNECTION_FAILED", reason: "provider_failed", message: "Coze 连接测试失败，请核对配置。", retryable: status >= 500 || status === 0 };
}

function normalizeApiToken(raw) {
  let value = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (/^Bearer\s+/i.test(value)) value = value.replace(/^Bearer\s+/i, "").trim();
  return value.replace(/\r?\n/g, "").trim();
}

function getConfig(overrides = {}) {
  const agentBase = String(configuredEnv("COZE_AGENT_BASE_URL", "", overrides) || "").replace(/\/+$/, "");
  const streamPath = String(configuredEnv("COZE_STREAM_PATH", "/stream_run", overrides) || "/stream_run");
  let workloadEndpoint = String(configuredEnv("COZE_WORKLOAD_ENDPOINT", "", overrides) || "").trim();
  // Prefer explicit workload endpoint; else compose from COZE_AGENT_BASE_URL + stream path
  if (!workloadEndpoint && agentBase) {
    workloadEndpoint = `${agentBase}${streamPath.startsWith("/") ? streamPath : `/${streamPath}`}`;
  }
  const apiKey = normalizeApiToken(
    configuredEnv("COZE_API_TOKEN", "", overrides)
    || configuredEnv("COZE_API_KEY", "", overrides)
  );
  return {
    enabled: boolEnv("COZE_ENABLED", true, overrides),
    expiresAt: String(configuredEnv("COZE_EXPIRES_AT", "", overrides) || "").trim(),
    providerRole: String(configuredEnv("COZE_PROVIDER_ROLE", "temporary", overrides) || "temporary"),
    baseUrl: String(configuredEnv("COZE_API_BASE_URL", agentBase || "https://api.coze.cn", overrides)).replace(/\/+$/, ""),
    agentBaseUrl: agentBase,
    apiKey,
    botId: configuredEnv("COZE_BOT_ID", "", overrides) || configuredEnv("COZE_AGENT_ID", "", overrides),
    apiMode: normalizeApiMode(configuredEnv("COZE_API_MODE", "", overrides), workloadEndpoint),
    workloadEndpoint,
    projectId: String(configuredEnv("COZE_PROJECT_ID", "", overrides) || "").trim(),
    streamPath,
    asyncPath: String(configuredEnv("COZE_ASYNC_PATH", "/async_run", overrides) || "/async_run"),
    taskPath: String(configuredEnv("COZE_TASK_PATH", "/task/{task_id}", overrides) || "/task/{task_id}"),
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
  if (config.apiMode === "workload") {
    return Boolean(config.apiKey && config.workloadEndpoint && config.projectId);
  }
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
  const answer = String(payload.answer || payload.content || payload.output || payload.text || "");
  if (!answer) return null;
  return {
    answer,
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

function buildWorkloadSessionId(input = {}, principal = null, overrides = {}) {
  const userId = buildPseudoUserId(principal, overrides);
  const conversationId = String(input.conversationId || input.context && input.context.conversationId || "default").slice(0, 120);
  const digest = crypto.createHash("sha256").update(`${userId}|${conversationId}`).digest("hex").slice(0, 20);
  return `fosu-${digest}`;
}

function buildWorkloadRequestBody(input, config, sessionId) {
  return {
    content: {
      query: {
        prompt: [
          {
            type: "text",
            content: { text: buildSafeUserContent(input) },
          },
        ],
      },
    },
    type: "query",
    session_id: sessionId,
    project_id: config.projectId,
  };
}

function extractWorkloadText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.content === "string") return payload.content;
  if (payload.content && typeof payload.content === "object") {
    if (typeof payload.content.text === "string") return payload.content.text;
    if (typeof payload.content.answer === "string") return payload.content.answer;
    if (typeof payload.content.output === "string") return payload.content.output;
  }
  if (typeof payload.answer === "string") return payload.answer;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.text === "string") return payload.text;
  if (payload.message) {
    const messageText = extractWorkloadText(payload.message);
    if (messageText) return messageText;
  }
  if (payload.data) return extractWorkloadText(payload.data);
  return "";
}

function appendStreamText(current, next) {
  const piece = String(next || "");
  if (!piece) return current;
  if (!current) return piece;
  if (piece === current || current.endsWith(piece)) return current;
  if (piece.startsWith(current)) return piece;
  return `${current}${piece}`;
}

function parseWorkloadStream(rawText) {
  const text = String(rawText || "").trim();
  if (!text) throw unsupported();
  if (!/(^|\n)(event|data|id):/i.test(text)) {
    const directPayload = parseJsonMaybe(text);
    const direct = extractWorkloadText(directPayload || text);
    if (direct) return direct;
    throw unsupported();
  }
  let answer = "";
  const blocks = text.split(/\r?\n\r?\n/);
  blocks.forEach((block) => {
    let eventName = "";
    const dataLines = [];
    String(block || "").split(/\r?\n/).forEach((line) => {
      if (/^event\s*:/i.test(line)) eventName = line.replace(/^event\s*:\s*/i, "").trim();
      if (/^data\s*:/i.test(line)) dataLines.push(line.replace(/^data\s*:\s?/i, ""));
    });
    if (!dataLines.length || /^(done|ping)$/i.test(eventName)) return;
    const rawData = dataLines.join("\n").trim();
    if (!rawData || rawData === "[DONE]") return;
    const payload = parseJsonMaybe(rawData) || rawData;
    const errorCode = payload && typeof payload === "object" ? payload.error_code || payload.code : "";
    if (/^error$/i.test(eventName) || (errorCode && String(errorCode) !== "0")) {
      const error = new Error(String(payload.error_message || payload.msg || payload.message || "Coze workload request failed").slice(0, 200));
      error.code = String(errorCode || "provider_failed");
      throw error;
    }
    answer = appendStreamText(answer, extractWorkloadText(payload));
  });
  if (!answer) throw unsupported();
  return answer;
}

async function readResponseText(data, maxBytes = 512 * 1024) {
  if (typeof data === "string") return data.slice(0, maxBytes);
  if (Buffer.isBuffer(data)) return data.subarray(0, maxBytes).toString("utf8");
  if (!data || typeof data.on !== "function") return JSON.stringify(data || {});
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    data.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > maxBytes) {
        const error = new Error("Coze workload response exceeded limit");
        error.code = "response_too_large";
        fail(error);
        if (typeof data.destroy === "function") data.destroy();
        return;
      }
      chunks.push(buffer);
    });
    data.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    data.on("error", fail);
  });
}

async function generateWorkload(input, config, runtimeConfig) {
  const sessionId = buildWorkloadSessionId(input, input.principal || null, runtimeConfig);
  try {
    const response = await axios.post(
      config.workloadEndpoint,
      buildWorkloadRequestBody(input, config, sessionId),
      {
        timeout: config.timeoutMs,
        responseType: "stream",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
        },
      }
    );
    const rawText = await readResponseText(response.data);
    return parseWorkloadStream(rawText);
  } catch (error) {
    if (error && ["COZE_RESPONSE_UNSUPPORTED", "response_too_large"].includes(error.code)) throw error;
    throw mapHttpError(error);
  }
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
  if (!isEnabled(runtimeConfig)) throw notConfigured();

  if (config.apiMode === "workload") {
    const answer = await generateWorkload(input, config, runtimeConfig);
    const parsed = normalizeParsedPayload(parseJsonMaybe(answer)) || {
      answer,
      cards: [],
      suggestions: [],
    };
    return Object.assign({ provider: "coze" }, parsed);
  }

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

async function testConnection(input = {}) {
  const overrides = Object.assign({}, input.providerRuntimeConfig || input.overrides || {}, {
    COZE_ENABLED: "true",
  });
  const config = getConfig(overrides);
  const common = {
    checkedAt: new Date().toISOString(),
    apiMode: config.apiMode,
    botIdMasked: config.botId ? `****${String(config.botId).slice(-4)}` : "",
    projectIdMasked: config.projectId ? `****${String(config.projectId).slice(-4)}` : "",
    botSelectorAvailable: false,
    botSelectorReason: config.apiMode === "workload"
      ? "扣子编程项目 API 使用已部署入口和项目 ID，不需要 Bot 选择器。"
      : "Coze 的 Bot 列表接口还需要 Workspace/Space ID；本项目不伪造只凭 PAT 的选择器。",
  };
  if (!config.apiKey) {
    return Object.assign({}, common, { success: false, code: "COZE_TOKEN_REQUIRED", reason: "token_missing", message: "请填写 Coze PAT/API Token。", retryable: false });
  }
  if (config.apiMode === "workload" && (!config.workloadEndpoint || !config.projectId)) {
    return Object.assign({}, common, { success: false, code: "COZE_PROJECT_CONFIG_REQUIRED", reason: "project_config_missing", message: "请填写已部署的 Coze 项目 API 地址与项目 ID。", retryable: false });
  }
  if (config.apiMode !== "workload" && !config.botId) {
    return Object.assign({}, common, { success: false, code: "COZE_BOT_ID_REQUIRED", reason: "bot_id_missing", message: "请填写已发布的 Coze Bot ID。", retryable: false });
  }
  if (isExpired(overrides)) {
    return Object.assign({}, common, classifyConnectionError(expiredError()), { success: false });
  }
  const startedAt = Date.now();
  try {
    await generate({
      message: "连接测试：仅回复 OK。",
      intent: { name: "conversational_help" },
      toolResults: [],
      projectKnowledge: "",
      context: { conversationSummary: "" },
      principal: input.principal || { principalKey: "admin-coze-diagnostic", runtimeMode: "trial", deployEnv: "admin" },
      providerRuntimeConfig: overrides,
    });
    return Object.assign({}, common, {
      success: true,
      code: "COZE_CONNECTION_OK",
      reason: "connected",
      message: config.apiMode === "workload"
        ? "Token、项目 ID 与已部署 stream_run 链路验证通过。"
        : "Token、Bot ID 和已发布 API 链路验证通过。",
      botPublished: true,
      projectDeployed: config.apiMode === "workload",
      latencyMs: Date.now() - startedAt,
      retryable: false,
    });
  } catch (error) {
    return Object.assign({}, common, classifyConnectionError(error), {
      success: false,
      botPublished: false,
      latencyMs: Date.now() - startedAt,
    });
  }
}

module.exports = {
  buildPseudoUserId,
  buildSafeUserContent,
  buildWorkloadRequestBody,
  buildWorkloadSessionId,
  classifyConnectionError,
  extractAnswer,
  extractPollInfo,
  generate,
  getConfig,
  isEnabled,
  isExpired,
  listMessages,
  name: "coze",
  parseWorkloadStream,
  retrieveChat,
  testConnection,
};
