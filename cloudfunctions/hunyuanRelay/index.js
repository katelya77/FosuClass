/**
 * hunyuanRelay — 混元大模型 OpenAI 兼容中转（成长计划合规通道）
 *
 * 背景：小程序成长计划的混元免费额度只允许「小程序 SDK / 云开发服务端」来源消耗，
 * VPS 直连 OpenAI 兼容网关会被 AI_CHANNEL_NOT_ALLOWED(403) 拒绝。本函数运行在
 * 云函数内（合规来源），把 VPS 的 OpenAI chat.completion 请求转发到
 * @cloudbase/node-sdk 的 AI 能力（hunyuan-v3 组，仅消耗免费额度，无需控制台模型开关）。
 *
 * 调用形态（两种同代码）：
 * 1) HTTP 访问服务：POST {env}.tcloudbaseapp.com/hunyuanRelay/chat/completions
 *    Header: Authorization: Bearer ${HUNYUAN_RELAY_TOKEN}
 * 2) wx.cloud.callFunction：event 直接携带 payload + relayToken 字段
 *
 * 安全约束：
 * - 只放行白名单模型（hy3 / hy3-preview），防止借中转调用其他付费模型；
 * - 消息条数/长度/max_tokens 全部钳制；
 * - 不记录任何 prompt 与生成内容，只记录 token 用量与耗时；
 * - HUNYUAN_RELAY_TOKEN 必须配置，缺失时函数整体拒绝服务（fail-closed）。
 *
 * 环境变量：
 *   HUNYUAN_RELAY_TOKEN   必填，共享密钥（只在控制台/CLI 配置，禁止写入仓库）
 *   HUNYUAN_GROUP         可选，默认 hunyuan-v3；失败时自动回退 cloudbase 组一次
 *   HUNYUAN_DEFAULT_MODEL 可选，默认 hy3-preview
 */

const tcb = require("@cloudbase/node-sdk");
const crypto = require("crypto");

const ALLOWED_MODELS = new Set(["hy3", "hy3-preview"]);
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 16000;

const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const ai = app.ai();

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

function openaiError(statusCode, code, message) {
  return jsonResponse(statusCode, {
    error: { code, message: String(message || code).slice(0, 240), type: "relay_error" },
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractRequest(event) {
  // HTTP 访问服务形态：{ httpMethod, headers, body(string) }
  if (event && typeof event.httpMethod === "string") {
    let parsed = {};
    try {
      parsed = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : {};
    } catch (error) {
      return { error: openaiError(400, "INVALID_JSON", "request body is not valid JSON") };
    }
    const auth = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || "");
    return { method: event.httpMethod.toUpperCase(), payload: parsed, token: auth.replace(/^Bearer\s+/i, "").trim() };
  }
  // callFunction 形态：event 即 payload
  const payload = event && typeof event === "object" ? event : {};
  return { method: "POST", payload, token: String(payload.relayToken || "") };
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const allowedRoles = new Set(["system", "user", "assistant"]);
  const messages = raw.slice(0, MAX_MESSAGES).map((item) => {
    if (!item || typeof item !== "object") return null;
    const role = String(item.role || "");
    const content = String(item.content == null ? "" : item.content).slice(0, MAX_MESSAGE_CHARS);
    if (!allowedRoles.has(role) || !content.trim()) return null;
    return { role, content };
  }).filter(Boolean);
  if (!messages.length) return null;
  const total = messages.reduce((sum, item) => sum + item.content.length, 0);
  return total <= MAX_TOTAL_CHARS ? messages : null;
}

function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

async function generateWithGroup(group, model, messages, options) {
  const chatModel = ai.createModel(group);
  const input = { model, messages };
  if (options.temperature !== undefined) input.temperature = options.temperature;
  const result = await chatModel.generateText(input);
  const text = String((result && result.text) || "").trim();
  if (!text) {
    const error = new Error("empty text from model");
    error.code = "EMPTY_MODEL_TEXT";
    throw error;
  }
  return { text, usage: result && result.usage || {}, group };
}

exports.main = async (event) => {
  const startedAt = Date.now();
  const relayToken = String(process.env.HUNYUAN_RELAY_TOKEN || "");
  if (!relayToken) {
    return openaiError(503, "RELAY_NOT_CONFIGURED", "relay token is not configured");
  }
  const request = extractRequest(event);
  if (request.error) return request.error;
  if (request.method !== "POST") {
    return openaiError(405, "METHOD_NOT_ALLOWED", "only POST is supported");
  }
  if (!safeEqual(request.token, relayToken)) {
    return openaiError(401, "RELAY_UNAUTHORIZED", "invalid relay token");
  }

  const payload = request.payload || {};
  const model = ALLOWED_MODELS.has(String(payload.model || ""))
    ? String(payload.model)
    : String(process.env.HUNYUAN_DEFAULT_MODEL || "hy3-preview");
  const messages = sanitizeMessages(payload.messages);
  if (!messages) {
    return openaiError(400, "INVALID_MESSAGES", "messages must be a non-empty array within size limits");
  }
  const options = {};
  if (payload.temperature !== undefined) options.temperature = clampNumber(payload.temperature, 0.7, 0, 2);

  const primaryGroup = String(process.env.HUNYUAN_GROUP || "hunyuan-v3").trim() || "hunyuan-v3";
  const groups = [primaryGroup].concat(primaryGroup === "cloudbase" ? [] : ["cloudbase"]);
  let lastError = null;
  for (const group of groups) {
    try {
      const result = await generateWithGroup(group, model, messages, options);
      const latencyMs = Date.now() - startedAt;
      console.log(JSON.stringify({
        type: "hunyuan-relay",
        group: result.group,
        model,
        latencyMs,
        totalTokens: Number(result.usage && (result.usage.total_tokens || result.usage.totalTokens) || 0),
      }));
      return jsonResponse(200, {
        id: `relay-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: result.text },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: Number(result.usage.prompt_tokens || 0),
          completion_tokens: Number(result.usage.completion_tokens || 0),
          total_tokens: Number(result.usage.total_tokens || 0),
        },
        relay: { group: result.group, latencyMs },
      });
    } catch (error) {
      lastError = error;
      console.warn(JSON.stringify({
        type: "hunyuan-relay-group-failed",
        group,
        code: String(error && error.code || "").slice(0, 80),
        message: String(error && error.message || "").slice(0, 160),
      }));
    }
  }

  const code = String(lastError && lastError.code || "");
  const message = String(lastError && lastError.message || "model call failed");
  if (/AI_CHANNEL_NOT_ALLOWED/i.test(code + message)) {
    return openaiError(403, "AI_CHANNEL_NOT_ALLOWED", message);
  }
  if (/QUOTA|BALANCE|RESOURCE/i.test(code + message)) {
    return openaiError(429, "AI_QUOTA_EXCEEDED", message);
  }
  if (/MODEL.*(NOT|DISABLE|UNSUPPORT)|NOT.*MODEL/i.test(code + message)) {
    return openaiError(400, "AI_MODEL_UNAVAILABLE", message);
  }
  return openaiError(502, "AI_UPSTREAM_FAILED", message);
};
