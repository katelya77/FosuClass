// P4c：MCP 桥接工具描述符工厂。
//
// 桥接工具是把「MCP 发现的 Tool」接入平台既有校验链的唯一入口：
//   Manifest（manifestToolIds 因子）→ 五因子交集 → toolRuntime.execute
//   → 本描述符 execute → mcpRuntime.callTool 治理链（注册表 → 启用 →
//   runtimeMode → 工具白名单 → 参数 Schema → 写确认 → 真实调用）。
//
// 生产激活（加入 platformToolRuntime + Manifest intent）属于 P4e 后台
// 控制面按环境启用的动作；本模块在 P4c 以真实 AgentKernel/toolRuntime/
// capabilityManifestService 的五因子一致性测试证明链入口（见
// tools/test-agent-mcp-runtime.js）。

const BRIDGE_TOOL_ID = "mcp_call";

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

// 治理链 coded 错误 → 工具结果（不泄露内部 URL/鉴权信息；消息固定截断）。
function failureResult(error) {
  return {
    success: false,
    code: safeString(error && error.code || "MCP_CALL_FAILED", 80),
    message: safeString(error && error.message || "MCP call failed", 160),
  };
}

function createMcpBridgeTool(options = {}) {
  const resolveRegistry = options.resolveRegistry;
  const mcpRuntime = options.mcpRuntime;
  if (typeof resolveRegistry !== "function") throw new Error("resolveRegistry is required");
  if (!mcpRuntime || typeof mcpRuntime.callTool !== "function") throw new Error("mcpRuntime is required");

  return Object.freeze({
    id: BRIDGE_TOOL_ID,
    version: "1",
    description: "Call a governed MCP server tool (registry/scoped/confirmed writes only).",
    inputSchema: Object.freeze({
      type: "object",
      required: ["serverId", "toolName"],
      properties: {
        serverId: { type: "string", maxLength: 64 },
        toolName: { type: "string", maxLength: 128 },
        args: { type: "object" },
        confirmation: {
          type: "object",
          properties: {
            receiptId: { type: "string", maxLength: 128 },
          },
        },
      },
    }),
    outputSchema: Object.freeze({ type: "object" }),
    runtimeModes: Object.freeze([]),
    environments: Object.freeze(["production", "staging", "development"]),
    // 静态 safety 取保守姿态：桥接可分发写操作 → 按写工具对待并要求确认；
    // 五因子 safety 因子因此对未认证主体也不额外放宽，真正的读/写分流在
    // 运行时 scope 检查（writeTools 必须携带确认回执）完成。
    safety: Object.freeze({
      autonomyLevel: 2,
      operation: "write",
      requiresConfirmation: true,
    }),

    async execute(args = {}, context = {}, execOptions = {}) {
      try {
        const registry = resolveRegistry(context.configSnapshot || null);
        const result = await mcpRuntime.callTool({
          registry,
          serverId: args.serverId,
          toolName: args.toolName,
          args: args.args && typeof args.args === "object" ? args.args : {},
          runtimeMode: safeString(context.runtimeMode, 24) || undefined,
          signal: execOptions.signal || null,
          confirmation: args.confirmation && typeof args.confirmation === "object"
            ? { receiptId: safeString(args.confirmation.receiptId, 128) }
            : null,
        });
        return {
          success: result.isError !== true,
          code: result.isError === true ? "MCP_TOOL_REPORTED_ERROR" : "OK",
          data: result,
        };
      } catch (error) {
        return failureResult(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BRIDGE_TOOL_ID,
  createMcpBridgeTool,
});
