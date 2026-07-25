/**
 * Coze Agent Provider Adapter (stream_run / async_run + task poll).
 * Env-only secrets. Never log or return tokens.
 *
 * COZE_AGENT_BASE_URL | COZE_API_BASE_URL | COZE_WORKLOAD_ENDPOINT host
 * COZE_PROJECT_ID
 * COZE_API_TOKEN | COZE_API_KEY
 * COZE_STREAM_PATH (default /stream_run)
 * COZE_ASYNC_PATH (default /async_run)
 * COZE_TASK_PATH (default /task/{task_id})
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const cozeProvider = require("./cozeProvider");

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "").trim();
}

function normalizeToken(raw) {
  let value = stripBom(raw);
  if (!value) return "";
  if (/^Bearer\s+/i.test(value)) value = value.replace(/^Bearer\s+/i, "").trim();
  return value.replace(/\s+/g, "");
}

/**
 * Read token from env or optional local file path (server-side only).
 * File may be plain token or "Bearer …".
 */
function loadTokenFromFile(filePath) {
  if (!filePath) return "";
  try {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) return "";
    return normalizeToken(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    return "";
  }
}

function env(name, fallback = "", overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides || {}, name)) {
    const value = overrides[name];
    return value === undefined || value === null || value === "" ? fallback : String(value);
  }
  return process.env[name] || fallback;
}

function getAgentConfig(overrides = {}) {
  const baseFromWorkload = String(env("COZE_WORKLOAD_ENDPOINT", "", overrides) || "").replace(/\/stream_run\/?$/i, "");
  const baseUrl = String(
    env("COZE_AGENT_BASE_URL", "", overrides)
    || env("COZE_API_BASE_URL", "", overrides)
    || baseFromWorkload
    || ""
  ).replace(/\/+$/, "");
  const token = normalizeToken(
    env("COZE_API_TOKEN", "", overrides)
    || env("COZE_API_KEY", "", overrides)
    || loadTokenFromFile(env("COZE_TOKEN_FILE", "", overrides))
  );
  return {
    baseUrl,
    projectId: String(env("COZE_PROJECT_ID", "", overrides) || "").trim(),
    token,
    streamPath: String(env("COZE_STREAM_PATH", "/stream_run", overrides) || "/stream_run"),
    asyncPath: String(env("COZE_ASYNC_PATH", "/async_run", overrides) || "/async_run"),
    taskPath: String(env("COZE_TASK_PATH", "/task/{task_id}", overrides) || "/task/{task_id}"),
    timeoutMs: Math.max(1000, Math.min(120000, Number(env("COZE_TIMEOUT_MS", "15000", overrides)) || 15000)),
    pollIntervalMs: Math.max(200, Math.min(10000, Number(env("COZE_POLL_INTERVAL_MS", "1000", overrides)) || 1000)),
    pollMaxAttempts: Math.max(1, Math.min(60, Number(env("COZE_POLL_MAX_ATTEMPTS", "20", overrides)) || 20)),
  };
}

function isConfigured(overrides = {}) {
  const cfg = getAgentConfig(overrides);
  return Boolean(cfg.baseUrl && cfg.projectId && cfg.token);
}

function mapConversationToSessionId(conversationId, principal = null) {
  // Reuse cozeProvider session mapping — per-conversation, never shared production session
  return cozeProvider.buildWorkloadSessionId(
    { conversationId: conversationId || "default" },
    principal || null,
    {}
  );
}

function buildQueryBody({ prompt, sessionId, projectId }) {
  return {
    content: {
      query: {
        prompt: [
          {
            type: "text",
            content: { text: String(prompt || "").slice(0, 4000) },
          },
        ],
      },
    },
    type: "query",
    session_id: sessionId,
    project_id: Number(projectId) || projectId,
  };
}

function joinUrl(base, p) {
  const b = String(base || "").replace(/\/+$/, "");
  const pathPart = String(p || "");
  if (/^https?:\/\//i.test(pathPart)) return pathPart;
  return `${b}${pathPart.startsWith("/") ? pathPart : `/${pathPart}`}`;
}

function taskUrl(cfg, taskId) {
  const template = cfg.taskPath || "/task/{task_id}";
  const filled = template.replace("{task_id}", encodeURIComponent(String(taskId || "")));
  return joinUrl(cfg.baseUrl, filled);
}

function mapError(error) {
  return cozeProvider.classifyConnectionError
    ? Object.assign({ success: false }, cozeProvider.classifyConnectionError(error))
    : { success: false, code: "COZE_CONNECTION_FAILED", message: String(error && error.message || "failed") };
}

function assertNotAborted(signal) {
  if (signal && signal.aborted) {
    const error = new Error("Coze request aborted");
    error.code = "aborted";
    error.status = 499;
    throw error;
  }
}

/**
 * Prefer stream_run for interactive turns.
 * @param {object} input
 * @param {function} [input.fetchImpl] injectable for tests
 * @param {AbortSignal} [input.abortSignal]
 */
async function streamRun(input = {}) {
  const overrides = input.providerRuntimeConfig || input.overrides || {};
  const cfg = getAgentConfig(overrides);
  if (!isConfigured(overrides)) {
    const error = new Error("Coze agent adapter is not configured");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  assertNotAborted(input.abortSignal);
  const sessionId = input.sessionId || mapConversationToSessionId(input.conversationId, input.principal);
  const body = buildQueryBody({
    prompt: input.prompt || input.message || "",
    sessionId,
    projectId: cfg.projectId,
  });
  const url = joinUrl(cfg.baseUrl, cfg.streamPath);
  const fetchImpl = input.fetchImpl || (async (u, opts) => {
    const response = await axios.post(u, opts.body, {
      timeout: cfg.timeoutMs,
      responseType: "text",
      headers: opts.headers,
      validateStatus: () => true,
      signal: input.abortSignal,
    });
    return {
      status: response.status,
      text: async () => (typeof response.data === "string" ? response.data : JSON.stringify(response.data || {})),
      headers: response.headers,
    };
  });

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body,
  });
  assertNotAborted(input.abortSignal);
  if (response.status === 401 || response.status === 429 || response.status >= 500) {
    const error = new Error(`Coze stream_run HTTP ${response.status}`);
    error.status = response.status;
    error.code = response.status === 401 ? "unauthorized" : (response.status === 429 ? "rate_limited" : "provider_failed");
    throw error;
  }
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`Coze stream_run HTTP ${response.status}`);
    error.status = response.status;
    error.code = "provider_failed";
    throw error;
  }
  const raw = await response.text();
  const answer = cozeProvider.parseWorkloadStream(raw);
  return {
    provider: "coze-agent",
    mode: "stream_run",
    sessionId,
    answer,
    cards: [],
    suggestions: [],
  };
}

/**
 * Long tasks: async_run then poll task/{task_id}.
 */
async function asyncRunAndPoll(input = {}) {
  const overrides = input.providerRuntimeConfig || input.overrides || {};
  const cfg = getAgentConfig(overrides);
  if (!isConfigured(overrides)) {
    const error = new Error("Coze agent adapter is not configured");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  assertNotAborted(input.abortSignal);
  const sessionId = input.sessionId || mapConversationToSessionId(input.conversationId, input.principal);
  const body = buildQueryBody({
    prompt: input.prompt || input.message || "",
    sessionId,
    projectId: cfg.projectId,
  });
  const asyncUrl = joinUrl(cfg.baseUrl, cfg.asyncPath);
  const postImpl = input.postImpl || (async (u, payload, headers) => {
    const response = await axios.post(u, payload, {
      timeout: cfg.timeoutMs,
      headers,
      validateStatus: () => true,
      signal: input.abortSignal,
    });
    return { status: response.status, data: response.data };
  });
  const getImpl = input.getImpl || (async (u, headers) => {
    const response = await axios.get(u, {
      timeout: cfg.timeoutMs,
      headers,
      validateStatus: () => true,
      signal: input.abortSignal,
    });
    return { status: response.status, data: response.data };
  });
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
  };

  const created = await postImpl(asyncUrl, body, headers);
  if (created.status === 401 || created.status === 429 || created.status >= 500) {
    const error = new Error(`Coze async_run HTTP ${created.status}`);
    error.status = created.status;
    error.code = created.status === 401 ? "unauthorized" : (created.status === 429 ? "rate_limited" : "provider_failed");
    throw error;
  }
  // Normalize string bodies (some gateways stream-or-json on async_run)
  let createdData = created.data;
  if (typeof createdData === "string") {
    try {
      createdData = JSON.parse(createdData);
    } catch (error) {
      // SSE-like immediate answer
      try {
        const streamed = cozeProvider.parseWorkloadStream(created.data);
        if (streamed) {
          return {
            provider: "coze-agent",
            mode: "async_run",
            sessionId,
            answer: streamed,
            taskId: "",
            cards: [],
            suggestions: [],
          };
        }
      } catch (streamError) {
        // fall through
      }
      createdData = {};
    }
  }
  const taskId = createdData && (createdData.task_id || createdData.taskId || createdData.id)
    || (createdData && createdData.data && (createdData.data.task_id || createdData.data.id || createdData.data.taskId));
  if (!taskId) {
    // Some deployments return final payload on async_run
    const direct = cozeProvider.extractAnswer
      ? cozeProvider.extractAnswer(createdData)
      : "";
    const alt = direct
      || (createdData && (createdData.answer || createdData.output || createdData.content && createdData.content.text))
      || "";
    if (alt) {
      return { provider: "coze-agent", mode: "async_run", sessionId, answer: String(alt), taskId: "", cards: [], suggestions: [] };
    }
    // Fallback: use stream_run when async has no task id (deployment may not expose async)
    if (input.allowStreamFallback !== false) {
      const streamed = await streamRun(Object.assign({}, input, { sessionId }));
      return Object.assign({}, streamed, { mode: "async_run", taskId: "", fallback: "stream_run" });
    }
    const error = new Error("Coze async_run missing task_id");
    error.code = "COZE_RESPONSE_UNSUPPORTED";
    throw error;
  }

  const sleep = input.sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < cfg.pollMaxAttempts; attempt += 1) {
    assertNotAborted(input.abortSignal);
    await sleep(cfg.pollIntervalMs);
    const polled = await getImpl(taskUrl(cfg, taskId), headers);
    if (polled.status === 401 || polled.status === 429 || polled.status >= 500) {
      const error = new Error(`Coze task poll HTTP ${polled.status}`);
      error.status = polled.status;
      error.code = polled.status === 401 ? "unauthorized" : (polled.status === 429 ? "rate_limited" : "provider_failed");
      throw error;
    }
    const data = polled.data && polled.data.data ? polled.data.data : polled.data;
    const status = String(data && (data.status || data.state || data.task_status) || "").toLowerCase();
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      const error = new Error(String(data && data.error || "Coze async task failed").slice(0, 200));
      error.code = "provider_failed";
      throw error;
    }
    const text = extractAsyncTaskAnswer(data) || extractAsyncTaskAnswer(polled.data);
    if (text && (status === "completed" || status === "success" || status === "done")) {
      return {
        provider: "coze-agent",
        mode: "async_run",
        sessionId,
        taskId: String(taskId),
        answer: String(text),
        cards: [],
        suggestions: [],
      };
    }
  }
  const error = new Error("Coze async task polling timed out");
  error.code = "timeout";
  throw error;
}

/**
 * Coze async task payload:
 * { status:"completed", result:{ messages:[{type:"ai", content:"OK"}] } }
 */
function extractAsyncTaskAnswer(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.answer === "string" && payload.answer) return payload.answer;
  if (typeof payload.output === "string" && payload.output) return payload.output;
  const result = payload.result || payload.data || payload;
  if (typeof result === "string" && result) return result;
  if (result && typeof result.answer === "string" && result.answer) return result.answer;
  if (result && typeof result.output === "string" && result.output) return result.output;
  if (result && typeof result.content === "string" && result.content) return result.content;
  const messages = Array.isArray(result && result.messages)
    ? result.messages
    : (Array.isArray(payload.messages) ? payload.messages : []);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] || {};
    const type = String(msg.type || msg.role || "").toLowerCase();
    if (type === "human" || type === "user") continue;
    if (typeof msg.content === "string" && msg.content.trim()) return msg.content.trim();
    if (Array.isArray(msg.content)) {
      const parts = msg.content
        .map((part) => (part && typeof part.text === "string" ? part.text : (typeof part === "string" ? part : "")))
        .filter(Boolean);
      if (parts.length) return parts.join("");
    }
  }
  if (cozeProvider.extractAnswer) {
    const via = cozeProvider.extractAnswer(payload) || cozeProvider.extractAnswer(result);
    if (via) return via;
  }
  return "";
}

/**
 * Interactive default: stream_run; set mode="async" for long tasks.
 */
async function generate(input = {}) {
  const mode = String(input.mode || input.runMode || "stream").toLowerCase();
  try {
    if (mode === "async" || mode === "async_run") {
      return await asyncRunAndPoll(input);
    }
    return await streamRun(input);
  } catch (error) {
    if (error && error.code === "NOT_CONFIGURED") throw error;
    if (error && (error.code === "aborted" || error.code === "timeout" || error.code === "unauthorized" || error.code === "rate_limited")) {
      throw error;
    }
    // rethrow mapped shape for chain
    const mapped = mapError(error);
    const err = new Error(mapped.message || error.message);
    Object.assign(err, mapped);
    if (error.status) err.status = error.status;
    if (error.code) err.code = error.code;
    throw err;
  }
}

module.exports = {
  name: "coze-agent",
  normalizeToken,
  loadTokenFromFile,
  getAgentConfig,
  isConfigured,
  mapConversationToSessionId,
  buildQueryBody,
  streamRun,
  asyncRunAndPoll,
  extractAsyncTaskAnswer,
  generate,
  mapError,
};
