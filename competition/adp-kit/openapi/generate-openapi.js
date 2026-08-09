"use strict";

const fs = require("fs");
const path = require("path");
const { TOOL_DEFS } = require("../mcp/campus-tools-mcp/src/tools");

const outputPath = path.join(__dirname, "campus-tools.openapi.json");

const envelopeSchema = {
  type: "object",
  required: ["success", "queryId", "dataVersion", "resolvedEntity", "items", "actions", "evidence", "error"],
  properties: {
    success: { type: "boolean" },
    queryId: { type: "string", pattern: "^q-" },
    dataVersion: { type: "string", enum: ["competition-demo-v1"] },
    resolvedEntity: { nullable: true, oneOf: [{ $ref: "#/components/schemas/ResolvedEntity" }] },
    items: { type: "array", items: { type: "object", additionalProperties: true } },
    actions: { type: "array", items: { type: "object", additionalProperties: true } },
    evidence: { $ref: "#/components/schemas/Evidence" },
    error: { nullable: true, oneOf: [{ $ref: "#/components/schemas/Error" }] },
  },
  additionalProperties: true,
};

const spec = {
  openapi: "3.0.3",
  info: {
    title: "CampusTools 校园确定性工具 API",
    description: "校园智序 · 小序赛事工具层。所有动态校园事实由 competition-demo-v1 匿名数据确定性计算，不调用生成式模型，也绝不回退到 production 数据。",
    version: "1.1.0",
  },
  servers: [
    { url: "http://127.0.0.1:8787", description: "本地测试" },
    {
      url: "https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools",
      description: "校园智序独立比赛测试环境（CloudBase HTTP Function）",
    },
    { url: "https://{host}", description: "比赛测试环境；导入ADP后填写实际匿名测试域名", variables: { host: { default: "example.invalid" } } },
  ],
  tags: [{ name: "CampusTools", description: "只读匿名校园工具" }],
  paths: {
    "/health": {
      get: {
        operationId: "campusToolsHealth",
        summary: "健康检查",
        responses: {
          200: { description: "服务可用", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque" },
      hmacSignature: { type: "apiKey", in: "header", name: "X-Campus-Signature", description: "HMAC-SHA256(timestamp\\nMETHOD\\n/path)" },
      hmacTimestamp: { type: "apiKey", in: "header", name: "X-Campus-Timestamp", description: "Unix秒；允许误差5分钟" },
    },
    schemas: {
      ResolvedEntity: {
        type: "object",
        required: ["type", "id", "name"],
        properties: { type: { type: "string" }, id: { type: "string" }, name: { type: "string" } },
      },
      Evidence: {
        type: "object",
        required: ["dataVersion", "dataHash", "source", "computedAt", "verified"],
        properties: {
          dataVersion: { type: "string", enum: ["competition-demo-v1"] },
          dataHash: { type: "string", pattern: "^sha1:" },
          source: { type: "string", enum: ["campus-tools-mcp"] },
          computedAt: { type: "string", format: "date-time" },
          verified: { type: "boolean" },
          note: { type: "string" },
        },
      },
      Error: {
        type: "object",
        required: ["code", "message", "details"],
        properties: {
          code: { type: "string", enum: ["MISSING_PARAM", "INVALID_PARAM", "ENTITY_NOT_FOUND", "AMBIGUOUS_ENTITY", "OUT_OF_RANGE", "EMPTY_RESULT", "DATA_GUARD", "UNAUTHORIZED", "RATE_LIMITED", "TIMEOUT", "NOT_FOUND", "INTERNAL"] },
          message: { type: "string" },
          details: { nullable: true },
        },
      },
      Envelope: envelopeSchema,
    },
  },
};

for (const tool of TOOL_DEFS) {
  spec.paths[`/api/${tool.name}`] = {
    post: {
      tags: ["CampusTools"],
      operationId: tool.name,
      summary: tool.description,
      security: [{ bearerAuth: [] }, { hmacSignature: [], hmacTimestamp: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: tool.inputSchema } },
      },
      responses: {
        200: { description: "业务成功或可分支业务错误；读取 success/error", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
        401: { description: "鉴权失败", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
        429: { description: "请求限流", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
        500: { description: "内部错误", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
      },
    },
  };
}

const generated = `${JSON.stringify(spec, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== generated) {
    console.error("[fail] campus-tools.openapi.json 与 TOOL_DEFS 不一致，请运行 npm run generate:openapi");
    process.exit(1);
  }
  console.log(`[pass] OpenAPI 与 ${TOOL_DEFS.length} 个工具定义一致`);
} else {
  fs.writeFileSync(outputPath, generated, "utf8");
  console.log(`[ok] 生成 ${outputPath}（tools=${TOOL_DEFS.length}）`);
}
