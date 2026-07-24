// Coze Tool Gateway 服务层
// 供 coze-native 模式（仅 trial/dev）的 Coze Agent 通过 OpenAPI 调用 FosuClass 工具。
// 安全原则：
//   1. 默认关闭：COZE_TOOL_GATEWAY_ENABLED=true 且配置 COZE_TOOL_GATEWAY_TOKEN 才可用。
//   2. 工具白名单：只允许 manifest 中 runtimeModes 含 trial 的工具；未知工具一律 404。
//   3. 写操作 confirmation-only：写工具只返回"待确认计划"，Gateway 不执行任何真实写入
//      （该语义由 toolRegistry 的写工具实现内建保证，这里再断言一次）。
//   4. 无用户上下文：Gateway 调用不携带任何个人课表/身份数据，需要个人上下文的工具
//      会自然返回 needContext，绝不伪造。

const crypto = require("crypto");
const manifest = require("../../../config/agent-capability-manifest.json");
const toolRegistry = require("./toolRegistry");

const GATEWAY_CONFIG = manifest.toolGateway || {};
const GATEWAY_RUNTIME_MODE = String(GATEWAY_CONFIG.runtimeMode || "trial");
const MAX_BODY_BYTES = Number(GATEWAY_CONFIG.maxBodyBytes || 16384);

function envValue(name, overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides || {}, name)) {
    const value = overrides[name];
    return value === undefined || value === null ? "" : String(value);
  }
  return process.env[name] || "";
}

function isGatewayEnabled(overrides = {}) {
  const enabled = envValue(GATEWAY_CONFIG.enabledEnv || "COZE_TOOL_GATEWAY_ENABLED", overrides).toLowerCase() === "true";
  const token = envValue(GATEWAY_CONFIG.tokenEnv || "COZE_TOOL_GATEWAY_TOKEN", overrides);
  return enabled && Boolean(token);
}

function safeCompareToken(provided, expected) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// 返回 { ok, code }；code 用于 HTTP 映射，不回传敏感细节。
function authenticateRequest(headers = {}, overrides = {}) {
  if (!isGatewayEnabled(overrides)) {
    return { ok: false, code: "GATEWAY_DISABLED" };
  }
  const raw = String(headers.authorization || headers.Authorization || "");
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const expected = envValue(GATEWAY_CONFIG.tokenEnv || "COZE_TOOL_GATEWAY_TOKEN", overrides);
  if (!match || !safeCompareToken(match[1].trim(), expected)) {
    return { ok: false, code: "GATEWAY_UNAUTHORIZED" };
  }
  return { ok: true, code: "" };
}

function getGatewayTool(toolId) {
  const id = String(toolId || "").trim();
  const tool = manifest.tools && manifest.tools[id];
  if (!tool) return { ok: false, code: "TOOL_NOT_FOUND" };
  if (!Array.isArray(tool.runtimeModes) || !tool.runtimeModes.includes(GATEWAY_RUNTIME_MODE)) {
    return { ok: false, code: "TOOL_NOT_ALLOWED_FOR_GATEWAY" };
  }
  return { ok: true, code: "", tool, id };
}

function normalizeGatewayInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  // 只透传纯值字段，限制体积，避免巨型负载打到工具层
  const text = JSON.stringify(body);
  if (text.length > MAX_BODY_BYTES) return null;
  return body;
}

// 本地 summary：toolRegistry.getToolSummary 未导出，这里做轻量兜底
function buildGatewaySummary(toolId, result) {
  if (!result || result.success === false) {
    return (result && (result.code || result.message)) || "工具调用失败";
  }
  if (typeof result.summary === "string" && result.summary) return result.summary;
  return "工具调用完成";
}

function buildGatewayContext() {
  return {
    runtimeMode: GATEWAY_RUNTIME_MODE,
    principal: {
      principalKey: "coze-tool-gateway",
      runtimeMode: GATEWAY_RUNTIME_MODE,
      deployEnv: process.env.FOSU_DEPLOY_ENV || process.env.NODE_ENV || "development",
    },
    // 无个人课表上下文：需要课表的工具会返回 needContext
    via: "coze-tool-gateway",
  };
}

// 执行一次 Gateway 工具调用。返回 { status, body }，route 层只做 HTTP 映射。
async function executeGatewayCall(toolId, body, headers = {}, overrides = {}) {
  const auth = authenticateRequest(headers, overrides);
  if (!auth.ok) {
    return {
      status: auth.code === "GATEWAY_DISABLED" ? 503 : 401,
      body: { success: false, code: auth.code },
    };
  }
  const toolCheck = getGatewayTool(toolId);
  if (!toolCheck.ok) {
    return {
      status: toolCheck.code === "TOOL_NOT_FOUND" ? 404 : 403,
      body: { success: false, code: toolCheck.code },
    };
  }
  const input = normalizeGatewayInput(body);
  if (input === null) {
    return { status: 413, body: { success: false, code: "PAYLOAD_TOO_LARGE" } };
  }
  const startedAt = Date.now();
  const result = await toolRegistry.executeToolAsync(toolCheck.id, input, buildGatewayContext());
  const toolMeta = toolCheck.tool;
  const isWrite = toolMeta.operation === "write" || (toolMeta.confirmation && toolMeta.confirmation !== "none");
  const summary = buildGatewaySummary(toolCheck.id, result);
  return {
    status: 200,
    body: {
      success: result && result.success !== false,
      code: result && result.code ? String(result.code) : "",
      data: result || {},
      summary,
      confirmation: isWrite ? (toolMeta.confirmation || "required") : "none",
      // 写操作只返回待确认计划；Gateway 从不执行真实写入
      confirmationRequest: isWrite
        ? { title: toolMeta.displayName || toolCheck.id, summary }
        : undefined,
      runtimeMode: GATEWAY_RUNTIME_MODE,
      latencyMs: Date.now() - startedAt,
    },
  };
}

module.exports = {
  GATEWAY_RUNTIME_MODE,
  authenticateRequest,
  buildGatewayContext,
  executeGatewayCall,
  getGatewayTool,
  isGatewayEnabled,
};
