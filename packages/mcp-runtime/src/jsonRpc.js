// P4c：最小 JSON-RPC 2.0 客户端原语（MCP 协议承载层）。
// 只实现 MCP 所需子集：请求构造、响应校验、错误分类。无外部依赖。

let nextRequestId = 1;

function codedError(code, message, data) {
  const error = new Error(message || code);
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

function buildRequest(method, params, id) {
  const requestId = id === undefined ? nextRequestId++ : id;
  return {
    jsonrpc: "2.0",
    id: requestId,
    method: String(method || ""),
    params: params === undefined ? {} : params,
  };
}

function buildNotification(method, params) {
  return {
    jsonrpc: "2.0",
    method: String(method || ""),
    params: params === undefined ? {} : params,
  };
}

// 校验并解包单个 JSON-RPC 响应。error 成员按 JSON-RPC 错误码分类：
// -32601/-32602 等方法/参数错误不可重试；HTTP 层错误由 transport 分类。
function unwrapResponse(payload, expectedId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw codedError("MCP_RPC_INVALID_RESPONSE", "JSON-RPC response must be an object");
  }
  if (payload.jsonrpc !== "2.0") {
    throw codedError("MCP_RPC_INVALID_RESPONSE", "jsonrpc must be \"2.0\"");
  }
  if (expectedId !== undefined && payload.id !== expectedId) {
    throw codedError("MCP_RPC_ID_MISMATCH", `expected id ${expectedId}, got ${String(payload.id)}`);
  }
  if (payload.error) {
    const rpcError = payload.error;
    const code = Number(rpcError.code);
    const message = String(rpcError.message || "JSON-RPC error").slice(0, 240);
    if (code === -32601) throw codedError("MCP_METHOD_NOT_FOUND", message);
    if (code === -32602) throw codedError("MCP_INVALID_PARAMS", message);
    if (code === -32600) throw codedError("MCP_INVALID_REQUEST", message);
    throw codedError("MCP_RPC_ERROR", message, { rpcCode: code });
  }
  if (!("result" in payload)) {
    throw codedError("MCP_RPC_INVALID_RESPONSE", "response carries neither result nor error");
  }
  return payload.result;
}

// SSE 帧解析（Streamable HTTP：响应可为 text/event-stream）。
// 只提取 data: 载荷中的 JSON-RPC 消息；忽略事件名/注释/心跳。
function parseSseMessages(rawText) {
  const messages = [];
  let dataLines = [];
  String(rawText || "").split(/\r?\n/).forEach((line) => {
    if (line === "") {
      if (dataLines.length) {
        const text = dataLines.join("\n");
        dataLines = [];
        try {
          messages.push(JSON.parse(text));
        } catch (_) {
          // 非 JSON data 帧（如心跳）安全忽略。
        }
      }
      return;
    }
    if (line.startsWith(":")) return; // 注释/心跳
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  });
  if (dataLines.length) {
    try {
      messages.push(JSON.parse(dataLines.join("\n")));
    } catch (_) {
      // 同上。
    }
  }
  return messages;
}

module.exports = Object.freeze({
  buildNotification,
  buildRequest,
  codedError,
  parseSseMessages,
  unwrapResponse,
});
