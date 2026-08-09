/**
 * CampusTools MCP 服务端（零依赖 CommonJS）。
 *
 * 同一套确定性工具双协议暴露：
 * - MCP（Streamable HTTP）：POST /mcp  （JSON-RPC：initialize / tools/list / tools/call / ping）
 *   SSE 兼容：GET /sse + POST /messages（旧式 SSE 传输，供只支持 SSE 的平台使用）
 * - REST：POST /api/<toolName>   （如 /api/query_schedule）
 * - GET  /health  健康检查（返回数据版本与工具数）
 *
 * 环境变量：
 *   PORT                监听端口（默认 8787）
 *   CAMPUS_API_TOKEN    可选；设置后除 /health 外所有请求需携带 Authorization: Bearer <token>
 *   CAMPUS_API_SIGNING_SECRET 可选；HMAC 鉴权密钥（签名串：timestamp\\nMETHOD\\n/path）
 *   CAMPUS_API_AUTH_MODE none | token | hmac | either | both
 *   CAMPUS_DATA_PATH    可选；数据文件路径，basename 必须以 competition-demo 开头（data.js 强制守卫）
 *   REQUEST_TIMEOUT_MS  单请求处理超时（默认 10000）
 *   LOG_LEVEL           info | warn | error（默认 info）
 */

const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");
const { TOOL_DEFS, callTool } = require("./tools");
const { loadDataset } = require("./data");
const { fail, ERR } = require("./envelope");
const { takeToken } = require("./ratelimit");

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.CAMPUS_API_TOKEN || "";
const SIGNING_SECRET = process.env.CAMPUS_API_SIGNING_SECRET || "";
const AUTH_MODE = process.env.CAMPUS_API_AUTH_MODE || (TOKEN ? "token" : SIGNING_SECRET ? "hmac" : "none");
const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "campus-tools-mcp", version: "1.0.0" };

const LEVELS = { info: 0, warn: 1, error: 2 };
function log(level, msg, extra) {
  if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;
  const line = `[${new Date().toISOString()}] [${level}] ${msg}` + (extra ? ` ${JSON.stringify(extra)}` : "");
  (level === "error" ? console.error : console.log)(line);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Campus-Timestamp, X-Campus-Signature",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function tokenAuthorized(req) {
  if (!TOKEN) return false;
  const h = req.headers.authorization || "";
  return h === `Bearer ${TOKEN}`;
}

function safeEqualHex(actual, expected) {
  if (!/^[0-9a-f]{64}$/i.test(actual || "") || !/^[0-9a-f]{64}$/i.test(expected || "")) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function hmacAuthorized(req, pathname) {
  if (!SIGNING_SECRET) return false;
  const timestamp = String(req.headers["x-campus-timestamp"] || "");
  const signature = String(req.headers["x-campus-signature"] || "");
  const timestampMs = /^\d{10}$/.test(timestamp) ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  const payload = `${timestamp}\n${req.method}\n${pathname}`;
  const expected = crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest("hex");
  return safeEqualHex(signature, expected);
}

function authorized(req, pathname) {
  if (AUTH_MODE === "none") return true;
  const tokenOk = tokenAuthorized(req);
  const hmacOk = hmacAuthorized(req, pathname);
  if (AUTH_MODE === "token") return tokenOk;
  if (AUTH_MODE === "hmac") return hmacOk;
  if (AUTH_MODE === "both") return tokenOk && hmacOk;
  if (AUTH_MODE === "either") return tokenOk || hmacOk;
  return false;
}

// ---------------------------------------------------------------------------
// MCP：Streamable HTTP（POST /mcp）
// ---------------------------------------------------------------------------
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function handleMcpMessage(msg) {
  const { id, method, params } = msg || {};
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case "notifications/initialized":
      return null; // 通知无需响应
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOL_DEFS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const env = callTool(name, args);
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(env, null, 2) }],
        structuredContent: env,
        isError: !env.success,
      });
    }
    default:
      return rpcError(id, -32601, `未知方法: ${method}`);
  }
}

async function handleMcpPost(req, res) {
  const raw = await readBody(req);
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, rpcError(null, -32700, "JSON 解析失败"));
  }
  if (Array.isArray(msg)) {
    const out = msg.map(handleMcpMessage).filter(Boolean);
    return sendJson(res, 200, out);
  }
  const out = handleMcpMessage(msg);
  if (out === null) {
    res.writeHead(202, { "Content-Type": "application/json" });
    return res.end();
  }
  return sendJson(res, 200, out);
}

// ---------------------------------------------------------------------------
// MCP：SSE 兼容传输（GET /sse 下发 endpoint；POST /messages 回包）
// ---------------------------------------------------------------------------
const sseSessions = new Map(); // sessionId -> res

function handleSseGet(req, res) {
  const sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
  });
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
  sseSessions.set(sessionId, res);
  req.on("close", () => sseSessions.delete(sessionId));
  log("info", "SSE 会话建立", { sessionId });
}

async function handleSseMessage(req, res, sessionId) {
  const sseRes = sseSessions.get(sessionId);
  if (!sseRes) return sendJson(res, 404, { error: "SSE 会话不存在或已关闭" });
  const raw = await readBody(req);
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, rpcError(null, -32700, "JSON 解析失败"));
  }
  const out = handleMcpMessage(msg);
  if (out) sseRes.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end();
}

// ---------------------------------------------------------------------------
// REST：POST /api/<toolName>
// ---------------------------------------------------------------------------
async function handleRestTool(req, res, toolName) {
  const raw = await readBody(req);
  let params = {};
  if (raw && raw.trim()) {
    try {
      params = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, {
        success: false,
        error: { code: "INVALID_PARAM", message: "请求体需为 JSON 对象", details: null },
      });
    }
  }
  const env = callTool(toolName, params);
  return sendJson(res, env.success ? 200 : 200, env); // 统一 200，由 success/error 字段表达业务结果
}

// ---------------------------------------------------------------------------
// 主路由
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    if (!res.headersSent) sendJson(res, 504, fail(ERR.TIMEOUT, "请求处理超时，请稍后重试", null));
  }, TIMEOUT_MS);

  const done = () => clearTimeout(timer);
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const clientIp = req.socket.remoteAddress || "unknown";

    if (req.method === "OPTIONS") {
      done();
      return sendJson(res, 204, {});
    }

    if (u.pathname === "/health" && req.method === "GET") {
      const { dataVersion, dataHash } = loadDataset();
      done();
      return sendJson(res, 200, {
        status: "ok",
        service: SERVER_INFO.name,
        version: SERVER_INFO.version,
        dataVersion,
        dataHash,
        tools: TOOL_DEFS.length,
        uptimeSec: Math.floor(process.uptime()),
      });
    }

    if (!authorized(req, u.pathname)) {
      done();
      log("warn", "未授权访问", { ip: clientIp, path: u.pathname });
      return sendJson(res, 401, fail(ERR.UNAUTHORIZED, "请求鉴权失败", null));
    }

    if (!takeToken(clientIp)) {
      done();
      log("warn", "限流触发", { ip: clientIp });
      return sendJson(res, 429, fail(ERR.RATE_LIMITED, "请求过于频繁，请稍后重试", null));
    }

    if (u.pathname === "/mcp" && req.method === "POST") {
      await handleMcpPost(req, res);
    } else if (u.pathname === "/sse" && req.method === "GET") {
      handleSseGet(req, res);
    } else if (u.pathname === "/messages" && req.method === "POST") {
      await handleSseMessage(req, res, u.searchParams.get("sessionId"));
    } else if (u.pathname.startsWith("/api/") && req.method === "POST") {
      const toolName = u.pathname.slice("/api/".length);
      await handleRestTool(req, res, toolName);
    } else {
      done();
      return sendJson(res, 404, fail(ERR.NOT_FOUND, "请求路径不存在", null));
    }

    done();
    log("info", "request", { method: req.method, path: u.pathname, ms: Date.now() - startedAt });
  } catch (err) {
    done();
    log("error", "未捕获异常", { message: err.message });
    if (!res.headersSent) sendJson(res, 500, fail(ERR.INTERNAL, "服务暂时不可用，请稍后重试", null));
  }
});

if (require.main === module) {
  // 启动前预热数据，触发 DATA_GUARD 校验，数据非法时直接拒绝启动
  const { dataVersion, dataHash } = loadDataset();
  server.listen(PORT, () => {
    log("info", `campus-tools-mcp 已启动`, { port: PORT, dataVersion, dataHash, tools: TOOL_DEFS.length, auth: AUTH_MODE });
  });
}

module.exports = { server };
