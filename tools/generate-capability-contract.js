#!/usr/bin/env node
/**
 * Capability Contract 统一生成器。
 *
 * 唯一真相源: server/config/agent-capability-manifest.json
 * 产物（全部 Do not edit by hand）:
 *   1. miniprogram/shared/agentCapabilityCompat.generated.js     小程序 Intent 兼容映射（历史产物，保持字节兼容）
 *   2. server/src/services/ai/generated/toolSchemas.generated.js 服务端 LLM Tool Schema（Planner/Coze 共用）
 *   3. miniprogram/shared/agentActionCatalog.generated.js        小程序 Action Command Catalog
 *   4. server/config/coze-tool-gateway.openapi.json              Coze Tool Gateway OpenAPI 3.0 Schema
 *   5. docs/xiaofu-agent/capability-contract.generated.md        能力文档
 *   6. tools/capability-contract/contract-matrix.generated.json  机器可读测试矩阵
 *
 * 用法:
 *   node tools/generate-capability-contract.js           生成全部产物
 *   node tools/generate-capability-contract.js --check   漂移检查，任一产物过期则 exit 1
 *
 * 注意: 产物不得包含时间戳或随机内容，否则 --check 永远失败。
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "server", "config", "agent-capability-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const HEADER = "// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.";
const JSON_HEADER_NOTE = "Generated from server/config/agent-capability-manifest.json. Do not edit by hand.";

const OUTPUTS = [
  path.join(root, "miniprogram", "shared", "agentCapabilityCompat.generated.js"),
  path.join(root, "server", "src", "services", "ai", "generated", "toolSchemas.generated.js"),
  path.join(root, "miniprogram", "shared", "agentActionCatalog.generated.js"),
  path.join(root, "server", "config", "coze-tool-gateway.openapi.json"),
  path.join(root, "docs", "xiaofu-agent", "capability-contract.generated.md"),
  path.join(root, "tools", "capability-contract", "contract-matrix.generated.json"),
];

// ---------- 1. 小程序 Intent 兼容映射（历史产物，必须与旧生成器字节一致） ----------
function renderClientCompat() {
  return [
    HEADER,
    `const MANIFEST_SCHEMA_VERSION = ${JSON.stringify(manifest.schemaVersion)};`,
    `const PROTOCOL_VERSIONS = Object.freeze(${JSON.stringify(manifest.protocolVersions, null, 2)});`,
    `const CANONICAL_INTENTS = Object.freeze(${JSON.stringify(Object.keys(manifest.intents), null, 2)});`,
    `const OFFLINE_INTENT_MAP = Object.freeze(${JSON.stringify(manifest.clientCompatibility, null, 2)});`,
    "",
    "function toCanonicalIntent(intentName) {",
    "  const value = String(intentName || \"\");",
    "  return CANONICAL_INTENTS.indexOf(value) >= 0 ? value : (OFFLINE_INTENT_MAP[value] || \"clarify_missing_slot\");",
    "}",
    "",
    "module.exports = {",
    "  CANONICAL_INTENTS,",
    "  MANIFEST_SCHEMA_VERSION,",
    "  OFFLINE_INTENT_MAP,",
    "  PROTOCOL_VERSIONS,",
    "  toCanonicalIntent,",
    "};",
    "",
  ].join("\n");
}

// ---------- 2. 服务端 LLM Tool Schema（Planner / Coze 共用的 function-calling 形态） ----------
function toLlmToolSchema(toolId, tool) {
  const parameters = tool.inputSchema && typeof tool.inputSchema === "object"
    ? tool.inputSchema
    : { type: "object", additionalProperties: false, properties: {} };
  return {
    name: toolId,
    description: String(tool.description || toolId),
    parameters,
    "x-fosu-safety": {
      operation: tool.operation || "read",
      confirmation: tool.confirmation || "none",
      safetyLevel: tool.safetyLevel || "low",
      runtimeModes: (tool.runtimeModes || []).filter((m) => m !== "competition"),
      idempotent: tool.idempotent === true,
      timeoutMs: tool.timeoutMs || manifest.limits.toolTimeoutMs,
    },
  };
}

function renderToolSchemas() {
  const tools = {};
  Object.keys(manifest.tools).forEach((toolId) => {
    tools[toolId] = toLlmToolSchema(toolId, manifest.tools[toolId]);
  });
  return [
    HEADER,
    "// LLM function-calling schema for Planner and Coze Tool Gateway. x-fosu-safety carries execution policy.",
    `const TOOL_SCHEMAS = Object.freeze(${JSON.stringify(tools, null, 2)});`,
    "",
    "function getToolSchema(name) {",
    "  return TOOL_SCHEMAS[String(name || \"\")] || null;",
    "}",
    "",
    "function listToolSchemasForRuntime(runtimeMode) {",
    "  const mode = String(runtimeMode || \"public\");",
    "  return Object.values(TOOL_SCHEMAS).filter((schema) => schema[\"x-fosu-safety\"].runtimeModes.includes(mode));",
    "}",
    "",
    "module.exports = {",
    "  TOOL_SCHEMAS,",
    "  getToolSchema,",
    "  listToolSchemasForRuntime,",
    "};",
    "",
  ].join("\n");
}

// ---------- 3. 小程序 Action Command Catalog ----------
function renderActionCatalog() {
  const actions = manifest.actions || {};
  const cardActions = manifest.cardActions || {};
  const cardActionToCommand = Object.keys(cardActions).filter((id) => !id.startsWith("_")).reduce((output, id) => {
    output[id] = cardActions[id].command || null;
    return output;
  }, {});
  const confirmationRequired = Object.keys(actions).filter((id) => actions[id].confirmation === "required");
  const doubleConfirmationRequired = Object.keys(actions).filter((id) => actions[id].confirmation === "double");
  return [
    HEADER,
    "// Action Command Catalog: 模型只能引用此处定义的 Action，执行策略由 confirmation 字段决定。",
    `const ACTION_CATALOG = Object.freeze(${JSON.stringify(actions, null, 2)});`,
    "",
    "// 卡片按钮类型 → Action Command 映射（null 表示协议层特殊类型，不进入 Command Bus）",
    `const CARD_ACTION_TO_COMMAND = Object.freeze(${JSON.stringify(cardActionToCommand, null, 2)});`,
    "",
    `const ACTION_CONFIRMATION_REQUIRED = Object.freeze(${JSON.stringify(confirmationRequired, null, 2)});`,
    `const ACTION_DOUBLE_CONFIRMATION_REQUIRED = Object.freeze(${JSON.stringify(doubleConfirmationRequired, null, 2)});`,
    "",
    "function getAction(id) {",
    "  return ACTION_CATALOG[String(id || \"\")] || null;",
    "}",
    "",
    "function isAutoExecutable(id) {",
    "  const action = getAction(id);",
    "  return Boolean(action && action.confirmation === \"none\");",
    "}",
    "",
    "function isActionAllowedForRuntime(id, runtimeMode) {",
    "  const action = getAction(id);",
    "  const mode = String(runtimeMode || \"public\");",
    "  return Boolean(action && Array.isArray(action.runtimeModes) && action.runtimeModes.includes(mode));",
    "}",
    "",
    "module.exports = {",
    "  ACTION_CATALOG,",
    "  CARD_ACTION_TO_COMMAND,",
    "  ACTION_CONFIRMATION_REQUIRED,",
    "  ACTION_DOUBLE_CONFIRMATION_REQUIRED,",
    "  getAction,",
    "  isAutoExecutable,",
    "  isActionAllowedForRuntime,",
    "};",
    "",
  ].join("\n");
}

// ---------- 4. Coze Tool Gateway OpenAPI 3.0 ----------
function renderCozeOpenapi() {
  const paths = {};
  Object.keys(manifest.tools).forEach((toolId) => {
    const tool = manifest.tools[toolId];
    const requestSchema = tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : { type: "object", additionalProperties: false, properties: {} };
    paths[`/tools/${toolId}`] = {
      post: {
        operationId: toolId,
        summary: String(tool.description || toolId),
        description: [
          `operation: ${tool.operation || "read"}`,
          `confirmation: ${tool.confirmation || "none"}`,
          `runtimeModes: ${(tool.runtimeModes || []).join(", ")}`,
          tool.confirmation && tool.confirmation !== "none"
            ? "This tool performs a write and only returns a confirmation request; it never executes the write directly."
            : "This tool is read-only.",
        ].join("\n"),
        requestBody: {
          required: true,
          content: { "application/json": { schema: requestSchema } },
        },
        responses: {
          200: {
            description: "Tool result or confirmation request",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    code: { type: "string" },
                    data: { type: "object" },
                    confirmationRequest: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    };
  });
  const doc = {
    openapi: "3.0.1",
    info: {
      title: "FosuClass Tool Gateway (generated)",
      description: `${JSON_HEADER_NOTE} Coze 只能调用当前 Runtime Mode 允许的工具；写操作只返回确认请求。`,
      version: manifest.schemaVersion,
    },
    servers: [{ url: (manifest.toolGateway && manifest.toolGateway.baseUrl) || "/api/coze" }],
    paths,
    components: {
      securitySchemes: {
        GatewayToken: { type: "http", scheme: "bearer", bearerFormat: "token" },
      },
    },
    security: [{ GatewayToken: [] }],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ---------- 5. 能力文档 ----------
function renderDoc() {
  const lines = [
    "# Capability Contract（生成文件，请勿手改）",
    "",
    `来源: \`server/config/agent-capability-manifest.json\`（schemaVersion: ${manifest.schemaVersion}）`,
    "",
    "本文档由 \`node tools/generate-capability-contract.js\` 生成；修改请改 Manifest 后重新生成。",
    "",
    "## 运行模式",
    "",
    "| 模式 | 说明 | 外部 Provider |",
    "| --- | --- | --- |",
  ];
  Object.keys(manifest.runtimeModes).forEach((mode) => {
    const item = manifest.runtimeModes[mode];
    const provider = item.aliasFor ? `aliasFor: ${item.aliasFor}` : (item.externalProviderAllowed ? "允许" : "禁止");
    lines.push(`| ${mode} | ${item.displayName} | ${provider} |`);
  });
  lines.push("", "## Intents", "", "| Intent | 名称 | 事实任务 | Skill | 工具 | 公开版 | 降级策略 |", "| --- | --- | --- | --- | --- | --- | --- |");
  Object.keys(manifest.intents).forEach((id) => {
    const it = manifest.intents[id];
    lines.push(`| ${id} | ${it.displayName} | ${it.factualTask ? "是" : "否"} | ${it.skill} | ${(it.allowedTools || []).join(", ") || "-"} | ${it.publicAllowed ? "允许" : "禁止"} | ${it.fallbackPolicy} |`);
  });
  lines.push("", "## Tools", "", "| Tool | operation | confirmation | safety | runtimeModes | 有 inputSchema |", "| --- | --- | --- | --- | --- | --- |");
  Object.keys(manifest.tools).forEach((id) => {
    const t = manifest.tools[id];
    lines.push(`| ${id} | ${t.operation || "read"} | ${t.confirmation || "none"} | ${t.safetyLevel || "low"} | ${(t.runtimeModes || []).join("/")} | ${t.inputSchema ? "是" : "否"} |`);
  });
  lines.push("", "## Actions（Action Command）", "", "| Action | 名称 | operation | confirmation | targetPolicy |", "| --- | --- | --- | --- | --- |");
  Object.keys(manifest.actions || {}).forEach((id) => {
    const a = manifest.actions[id];
    lines.push(`| ${id} | ${a.displayName} | ${a.operation} | ${a.confirmation} | ${a.targetPolicy} |`);
  });
  lines.push("", "## Card Actions（卡片按钮 → Action Command 映射）", "", "| 卡片按钮 | 映射 Command | 说明 |", "| --- | --- | --- |");
  Object.keys(manifest.cardActions || {}).filter((id) => !id.startsWith("_")).forEach((id) => {
    const c = manifest.cardActions[id];
    lines.push(`| ${id} | ${c.command || "（协议层特殊类型）"} | ${c.description} |`);
  });
  lines.push("", "## Skills", "", "| Skill | 版本 | 说明 | providerPolicy |", "| --- | --- | --- | --- |");
  Object.keys(manifest.skills).forEach((id) => {
    const s = manifest.skills[id];
    lines.push(`| ${id} | ${s.version} | ${s.description} | ${s.providerPolicy} |`);
  });
  lines.push("");
  return lines.join("\n");
}

// ---------- 6. 机器可读测试矩阵 ----------
function renderMatrix() {
  const matrix = {
    schemaVersion: manifest.schemaVersion,
    note: JSON_HEADER_NOTE,
    counts: {
      intents: Object.keys(manifest.intents).length,
      skills: Object.keys(manifest.skills).length,
      tools: Object.keys(manifest.tools).length,
      actions: Object.keys(manifest.actions || {}).length,
    },
    intents: Object.keys(manifest.intents),
    skills: Object.keys(manifest.skills),
    tools: Object.keys(manifest.tools).map((id) => {
      const t = manifest.tools[id];
      return {
        id,
        operation: t.operation || "read",
        confirmation: t.confirmation || "none",
        safetyLevel: t.safetyLevel || "low",
        runtimeModes: t.runtimeModes || [],
        hasInputSchema: Boolean(t.inputSchema),
      };
    }),
    actions: Object.keys(manifest.actions || {}).map((id) => {
      const a = manifest.actions[id];
      return {
        id,
        operation: a.operation,
        confirmation: a.confirmation,
        safetyLevel: a.safetyLevel,
        targetPolicy: a.targetPolicy,
        runtimeModes: a.runtimeModes || [],
      };
    }),
    cardActions: Object.keys(manifest.cardActions || {}).filter((id) => !id.startsWith("_")).map((id) => ({
      id,
      command: manifest.cardActions[id].command || null,
    })),
  };
  return `${JSON.stringify(matrix, null, 2)}\n`;
}

const RENDERERS = [
  renderClientCompat,
  renderToolSchemas,
  renderActionCatalog,
  renderCozeOpenapi,
  renderDoc,
  renderMatrix,
];

function main() {
  const checkOnly = process.argv.includes("--check");
  const stale = [];
  RENDERERS.forEach((render, index) => {
    const outputPath = OUTPUTS[index];
    const generated = render();
    if (checkOnly) {
      const current = fs.existsSync(outputPath)
        ? fs.readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n")
        : "";
      if (current !== generated) {
        stale.push(path.relative(root, outputPath));
      }
    } else {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, generated, "utf8");
      console.log(`generated ${path.relative(root, outputPath)}`);
    }
  });
  if (checkOnly) {
    if (stale.length) {
      console.error(`capability contract artifacts are out of date:\n  - ${stale.join("\n  - ")}`);
      console.error("run: node tools/generate-capability-contract.js");
      process.exit(1);
    }
    console.log("capability contract artifacts are current");
  }
}

main();
