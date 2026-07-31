// P4c：受治理 MCP Runtime（packages 通用内核，无任何校园业务耦合）。
//
// 治理模型（不变量）：
// - 注册表只能来自 Config Kernel 发布物（声明式、可回滚）；Runtime 按调用方
//   传入的快照注册表解析服务器 → Server 更新只影响新 Run，在途 Run 不受
//   影响；服务器未注册/被禁用/模式不允许 → coded 错误，准确降级。
// - 发现的 Tool 必须过完整校验链：服务器启用 → runtimeMode 允许 → 工具在
//   注册白名单（allowedTools）→ 参数过发现的 inputSchema 校验 → 写工具
//   （writeTools）必须携带确认回执 → 才发起真实调用。
// - 鉴权材料只按引用使用：authEnvVar 是环境变量名（引用），值在调用时读取、
//   只进 Authorization 头，绝不进 descriptor/缓存/日志/错误消息。
// - 超时/取消贯穿：每次调用独立 AbortSignal 链；超时与主动取消分类不同。
// - 输出裁剪：工具结果序列化后截断到 maxResultChars；错误消息不含上游原文
//   中可能的敏感片段（固定截断 + 不透传响应头）。

const { validateAgainstSchema } = require("../../tool-runtime");
const { buildRequest, buildNotification, codedError } = require("./jsonRpc");
const transports = require("./transports");

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = Object.freeze({ name: "agent-platform-mcp-runtime", version: "1.0.0" });
const DEFAULTS = Object.freeze({
  timeoutMs: 15000,
  schemaCacheTtlMs: 300000,
  sessionTtlMs: 600000,
  maxResultChars: 4000,
  maxToolsPerServer: 128,
});

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function clipText(value, maxLength) {
  const text = String(value == null ? "" : value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(truncated)` : text;
}

function createMcpRuntime(options = {}) {
  const env = options.env || process.env;
  const allowInsecureHttp = options.allowInsecureHttp === true;
  const httpCall = options.httpCall || transports.postJsonRpc;
  const stdioCall = options.stdioCall || transports.stdioJsonRpc;
  const log = typeof options.logger === "function" ? options.logger : () => {};
  const schemaCacheTtlMs = Math.max(1000, Number(options.schemaCacheTtlMs || DEFAULTS.schemaCacheTtlMs));
  const sessionTtlMs = Math.max(1000, Number(options.sessionTtlMs || DEFAULTS.sessionTtlMs));
  const maxResultChars = Math.max(200, Number(options.maxResultChars || DEFAULTS.maxResultChars));

  // 发现缓存与 HTTP 会话缓存：仅缓存公开 Schema 与不透明的会话 id
  // （服务器下发的随机串，不是凭据）；永不缓存 bearer token。
  const toolCache = new Map(); // serverId → { expiresAt, tools: Map<name, descriptor> }
  const sessionCache = new Map(); // serverId → { expiresAt, sessionId }

  function resolveServer(registry, serverId, runtimeMode) {
    const id = safeString(serverId, 64);
    if (!id) throw codedError("MCP_SERVER_REQUIRED", "serverId is required");
    const servers = registry && Array.isArray(registry.servers) ? registry.servers : [];
    const server = servers.find((entry) => entry.id === id);
    if (!server) throw codedError("MCP_SERVER_NOT_REGISTERED", id);
    if (server.enabled === false) {
      log({ event: "mcp-server-disabled", serverId: id });
      throw codedError("MCP_SERVER_DISABLED", id);
    }
    const modes = Array.isArray(server.runtimeModes) ? server.runtimeModes : [];
    if (modes.length && runtimeMode && !modes.includes(runtimeMode)) {
      log({ event: "mcp-server-mode-denied", serverId: id, runtimeMode: safeString(runtimeMode, 24) });
      throw codedError("MCP_SERVER_MODE_DENIED", `${id} not allowed in ${safeString(runtimeMode, 24)}`);
    }
    return server;
  }

  function resolveBearer(server) {
    const envVar = safeString(server.authEnvVar, 128);
    if (!envVar) return "";
    // 按引用读取：值只存在于调用栈与请求头，不落任何持久结构。
    return safeString(env[envVar], 512);
  }

  function prepareStdioServer(server) {
    // 受控 stdio：命令必须在受信命令表（发布适配器已按注入白名单校验
    // 命令名；此处解析为绝对路径，防 PATH 劫持）；环境仅显式白名单变量。
    const trusted = options.trustedCommands || {};
    const resolved = trusted[server.command];
    if (!resolved) throw codedError("MCP_COMMAND_NOT_TRUSTED", safeString(server.command, 64));
    const childEnv = {};
    (Array.isArray(server.envAllowlist) ? server.envAllowlist : []).forEach((name) => {
      const key = safeString(name, 128);
      if (key && env[key] !== undefined) childEnv[key] = String(env[key]);
    });
    return {
      resolvedCommand: resolved,
      args: (Array.isArray(server.args) ? server.args : []).map((arg) => String(arg).slice(0, 500)),
      childEnv,
    };
  }

  async function rpc(server, method, params, rpcOptions = {}) {
    const message = buildRequest(method, params);
    const timeoutMs = Math.max(1000, Number(server.timeoutMs || DEFAULTS.timeoutMs));
    if (server.transport === "stdio") {
      const prepared = prepareStdioServer(server);
      const response = await stdioCall(prepared, message, {
        timeoutMs,
        signal: rpcOptions.signal,
      });
      return response.result;
    }
    const url = transports.validateServerUrl(server.url, { allowInsecureHttp });
    const session = sessionCache.get(server.id);
    const response = await httpCall(url, message, {
      timeoutMs,
      signal: rpcOptions.signal,
      sessionId: session && session.expiresAt > Date.now() ? session.sessionId : undefined,
      bearerToken: resolveBearer(server),
      protocolVersion: PROTOCOL_VERSION,
    });
    if (response.sessionId) {
      sessionCache.set(server.id, { sessionId: response.sessionId, expiresAt: Date.now() + sessionTtlMs });
    }
    return response.result;
  }

  async function initialize(server, rpcOptions = {}) {
    const result = await rpc(server, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: CLIENT_INFO,
    }, rpcOptions);
    // 初始化通知（部分服务器要求；失败不致命——服务器可能无此要求）。
    try {
      if (server.transport !== "stdio") {
        const url = transports.validateServerUrl(server.url, { allowInsecureHttp });
        const session = sessionCache.get(server.id);
        await httpCall(url, buildNotification("notifications/initialized"), {
          timeoutMs: Math.max(1000, Number(server.timeoutMs || DEFAULTS.timeoutMs)),
          signal: rpcOptions.signal,
          sessionId: session && session.expiresAt > Date.now() ? session.sessionId : undefined,
          bearerToken: resolveBearer(server),
          protocolVersion: PROTOCOL_VERSION,
        });
      }
    } catch (_) {
      // 通知不可达不阻断（initialize 已成功）。
    }
    return result;
  }

  async function discoverTools(server, rpcOptions = {}) {
    const cached = toolCache.get(server.id);
    if (cached && cached.expiresAt > Date.now() && rpcOptions.forceRefresh !== true) {
      return cached.tools;
    }
    // 首次发现前确保握手（无会话的纯无状态服务器也容忍冗余 initialize）。
    if (rpcOptions.skipInitialize !== true) {
      await initialize(server, rpcOptions);
    }
    const result = await rpc(server, "tools/list", {}, rpcOptions);
    const tools = new Map();
    const list = result && Array.isArray(result.tools) ? result.tools : [];
    list.slice(0, DEFAULTS.maxToolsPerServer).forEach((tool) => {
      const name = safeString(tool && tool.name, 128);
      if (!name) return;
      tools.set(name, Object.freeze({
        name,
        description: safeString(tool.description, 500),
        inputSchema: tool.inputSchema && typeof tool.inputSchema === "object"
          ? JSON.parse(JSON.stringify(tool.inputSchema))
          : { type: "object" },
      }));
    });
    toolCache.set(server.id, { tools, expiresAt: Date.now() + schemaCacheTtlMs });
    if (toolCache.size > 64) {
      const oldest = toolCache.keys().next().value;
      toolCache.delete(oldest);
    }
    log({ event: "mcp-tools-discovered", serverId: server.id, toolCount: tools.size });
    return tools;
  }

  async function callTool(input = {}) {
    const server = resolveServer(input.registry, input.serverId, input.runtimeMode);
    const toolName = safeString(input.toolName, 128);
    if (!toolName) throw codedError("MCP_TOOL_REQUIRED", "toolName is required");

    // 注册白名单（声明式 scope）：未列名的发现工具一律拒绝。
    const allowedTools = Array.isArray(server.allowedTools) ? server.allowedTools : [];
    if (!allowedTools.includes(toolName)) {
      log({ event: "mcp-tool-scope-denied", serverId: server.id, toolName });
      throw codedError("MCP_TOOL_NOT_ALLOWED", `${server.id}/${toolName}`);
    }

    const discovered = await discoverTools(server, { signal: input.signal });
    const tool = discovered.get(toolName);
    if (!tool) {
      // 发现集变化（服务器下线该工具）：准确降级，不伪造成功。
      throw codedError("MCP_TOOL_UNAVAILABLE", `${server.id}/${toolName}`);
    }

    // 参数过发现的 inputSchema 校验（复用 tool-runtime Schema 校验器）。
    const args = input.args && typeof input.args === "object" && !Array.isArray(input.args) ? input.args : {};
    const schemaErrors = validateAgainstSchema(args, tool.inputSchema || { type: "object" });
    if (schemaErrors.length) {
      throw codedError("MCP_ARGS_INVALID", schemaErrors.join("; ").slice(0, 240));
    }

    // 写操作闭环：writeTools 列名的工具必须携带确认回执（幂等键），
    // 与平台 confirmation/ActionReceipt 语义对齐；无回执一律拒绝。
    const writeTools = Array.isArray(server.writeTools) ? server.writeTools : [];
    if (writeTools.includes(toolName)) {
      const receipt = input.confirmation && safeString(input.confirmation.receiptId, 128);
      if (!receipt) {
        log({ event: "mcp-write-unconfirmed", serverId: server.id, toolName });
        throw codedError("MCP_WRITE_CONFIRMATION_REQUIRED", `${server.id}/${toolName}`);
      }
    }

    const result = await rpc(server, "tools/call", { name: toolName, arguments: args }, { signal: input.signal });
    // 输出裁剪：只保留 content/isError 两个规范字段；序列化长度封顶。
    const clipped = {
      isError: result && result.isError === true,
      content: Array.isArray(result && result.content)
        ? result.content.slice(0, 8).map((part) => {
          if (!part || typeof part !== "object") return { type: "text", text: "" };
          if (part.type === "text") return { type: "text", text: clipText(part.text, maxResultChars) };
          return { type: safeString(part.type, 40) || "unknown" };
        })
        : [],
    };
    log({ event: "mcp-tool-called", serverId: server.id, toolName, isError: clipped.isError });
    return Object.freeze(clipped);
  }

  function invalidate(serverId) {
    const id = safeString(serverId, 64);
    toolCache.delete(id);
    sessionCache.delete(id);
  }

  return Object.freeze({
    PROTOCOL_VERSION,
    callTool,
    discoverTools: (registry, serverId, rpcOptions = {}) => discoverTools(resolveServer(registry, serverId, rpcOptions.runtimeMode), rpcOptions),
    invalidate,
    resolveServer,
  });
}

module.exports = Object.freeze({
  createMcpRuntime,
});
