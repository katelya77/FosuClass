/**
 * xiaofuAgentGateway — CloudBase HTTP 兼容网关
 * 将请求转发到既有 VPS Agent API，并可将 Run Events 映射为 AG-UI 事件序。
 * 主链仍是 VPS；本函数为兼容层与未来扩展，不替换自定义小程序 UI。
 *
 * 环境变量：
 *   FOSU_AGENT_API_BASE  例如 https://api.example.com
 *   FOSU_AGENT_TIMEOUT_MS  默认 25000
 *
 * 鉴权/环境裁决：与主入口 server/src/routes/ai.js 同一语义——仅透传客户端上报的
 * envVersion 与 session，不做任何默认注入或提权；客户端未上报时省略对应头，
 * 由上游 runtimeModeService.resolveRuntimeMode 按空 envVersion fail-closed 裁决为
 * public（无 session 绝不提升 trial）。
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

function safeText(value, max = 400) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function mapRunToAgui(payload, conversationId, runId) {
  const threadId = String(conversationId || payload.conversationId || "unknown").slice(0, 120);
  const rid = String(runId || payload.runId || payload.requestId || "unknown").slice(0, 120);
  const events = [
    { type: "RUN_STARTED", threadId, runId: rid, timestamp: new Date().toISOString() },
  ];
  const toolCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
  toolCalls.forEach((call, i) => {
    const toolCallId = `${rid}-tool-${i}`;
    events.push({
      type: "TOOL_CALL_START",
      threadId,
      runId: rid,
      toolCallId,
      toolCallName: safeText(call.name, 80),
    });
    events.push({
      type: "TOOL_CALL_END",
      threadId,
      runId: rid,
      toolCallId,
      toolCallName: safeText(call.name, 80),
      status: call.status || "success",
    });
  });
  events.push({
    type: "STATE_SNAPSHOT",
    threadId,
    runId: rid,
    snapshot: {
      answer: safeText(payload.answer, 4000),
      cards: Array.isArray(payload.cards) ? payload.cards.slice(0, 8) : [],
      actionCommands: Array.isArray(payload.actionCommands) ? payload.actionCommands.slice(0, 8) : [],
      protocolVersion: payload.protocolVersion || "agent.v2",
    },
  });
  if (payload.answer) {
    const messageId = `${rid}-final`;
    events.push({ type: "TEXT_MESSAGE_START", threadId, runId: rid, messageId, role: "assistant" });
    events.push({ type: "TEXT_MESSAGE_CONTENT", threadId, runId: rid, messageId, delta: safeText(payload.answer, 4000) });
    events.push({ type: "TEXT_MESSAGE_END", threadId, runId: rid, messageId });
  }
  events.push({
    type: payload.success === false ? "RUN_ERROR" : "RUN_FINISHED",
    threadId,
    runId: rid,
    status: payload.success === false ? "error" : "completed",
    timestamp: new Date().toISOString(),
  });
  return events;
}

function requestJson(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === "https:" ? https : http;
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method || "GET",
        headers: Object.assign(
          {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "xiaofuAgentGateway/1.0",
          },
          options.headers || {},
          body ? { "Content-Length": Buffer.byteLength(body) } : {}
        ),
        timeout: options.timeoutMs || 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (error) {
            data = { raw: raw.slice(0, 500) };
          }
          resolve({ status: res.statusCode || 0, data, raw });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      const err = new Error("upstream timeout");
      err.code = "UPSTREAM_TIMEOUT";
      reject(err);
    });
    if (body) req.write(body);
    req.end();
  });
}

function parseHttpBody(event) {
  if (!event) return {};
  if (typeof event.body === "string") {
    try {
      return JSON.parse(event.body);
    } catch (error) {
      return {};
    }
  }
  if (event.body && typeof event.body === "object") return event.body;
  // CloudBase function event may already be the body
  if (event.message || event.query) return event;
  return {};
}

exports.main = async (event, context) => {
  const base = String(process.env.FOSU_AGENT_API_BASE || "").replace(/\/+$/, "");
  const timeoutMs = Math.max(3000, Math.min(55000, Number(process.env.FOSU_AGENT_TIMEOUT_MS || 25000) || 25000));
  const body = parseHttpBody(event);
  const message = String(body.message || body.query || "").trim();
  const conversationId = String(body.conversationId || body.threadId || "").slice(0, 120);
  const wantAgui = body.protocol === "ag-ui" || body.agui === true || /agui/i.test(String(event.path || event.pathInfo || ""));

  if (!message) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        code: "MESSAGE_REQUIRED",
        message: "请输入要咨询的问题。",
      }),
    };
  }

  if (!base) {
    // Offline structural response: gateway alive, upstream not configured
    const events = mapRunToAgui(
      {
        answer: "Agent 上游未配置（FOSU_AGENT_API_BASE）。当前仅为 CloudBase 兼容网关健康响应。",
        toolCalls: [],
        cards: [],
        actionCommands: [],
        success: true,
      },
      conversationId || "local",
      `gw-${Date.now()}`
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        protocol: wantAgui ? "ag-ui" : "agent.v2",
        threadId: conversationId || "local",
        runId: events[0] && events[0].runId,
        events: wantAgui ? events : undefined,
        gateway: "xiaofuAgentGateway",
        upstreamConfigured: false,
      }),
    };
  }

  try {
    const path = wantAgui ? "/api/ai/agent/agui" : "/api/ai/agent/chat";
    // 与主入口 resolveRequestRuntimeDecision 同一来源与语义：envVersion 只透传客户端
    // 显式上报值（body.envVersion 或入站 X-Fosu-Env-Version 头），缺省不注入——上游
    // 对空 envVersion fail-closed 为 public；session 只透传客户端持有票据，缺省省略头，
    // 由上游 optionalSessionGuard/runtimeModeService 裁决，无 session 不提升 trial。
    const clientEnvVersion = String(body.envVersion
      || (event.headers && (event.headers["x-fosu-env-version"] || event.headers["X-Fosu-Env-Version"]))
      || "").trim();
    const clientSessionToken = String(body.sessionToken
      || (event.headers && (event.headers["x-fosu-session"] || event.headers["X-Fosu-Session"]))
      || "").trim();
    const upstreamHeaders = {};
    if (clientEnvVersion) upstreamHeaders["X-Fosu-Env-Version"] = clientEnvVersion;
    if (clientSessionToken) upstreamHeaders["X-Fosu-Session"] = clientSessionToken;
    const upstream = await requestJson(`${base}${path}`, {
      method: "POST",
      timeoutMs,
      headers: upstreamHeaders,
      body: {
        message,
        context: body.context || {},
        protocolVersion: body.protocolVersion || "agent.v2",
        requestId: body.requestId || `cb-${Date.now()}`,
        conversationId,
        memoryMode: body.memoryMode || "local_only",
        cloudSyncEnabled: body.cloudSyncEnabled === true,
      },
    });

    if (wantAgui && upstream.data && Array.isArray(upstream.data.events)) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upstream.data),
      };
    }

    if (wantAgui) {
      const events = mapRunToAgui(upstream.data || {}, conversationId, (upstream.data && (upstream.data.runId || upstream.data.requestId)) || "");
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          protocol: "ag-ui",
          threadId: conversationId,
          events,
          response: upstream.data,
          gateway: "xiaofuAgentGateway",
        }),
      };
    }

    return {
      statusCode: upstream.status || 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstream.data || { success: false }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        code: error.code || "GATEWAY_UPSTREAM_FAILED",
        message: "Agent 上游暂时不可用。",
        gateway: "xiaofuAgentGateway",
      }),
    };
  }
};

// export helpers for unit tests without cloud runtime
exports.mapRunToAgui = mapRunToAgui;
exports.parseHttpBody = parseHttpBody;
