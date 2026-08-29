"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const yaml = require("yaml");

const { auditPluginExport, EXPECTED_OPERATIONS, DECISION_OPERATIONS } = require(path.join(__dirname, "..", "..", "ops", "runtime-control-plane", "lib", "plugin-auditor.js"));

function makeExport(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adp-plugin-export-"));
  const zipPath = path.join(dir, "plugin.zip");
  const zip = new AdmZip();
  for (const operationId of EXPECTED_OPERATIONS) {
    const decision = DECISION_OPERATIONS.has(operationId);
    const doc = {
      openapi: "3.0.0",
      info: { title: operationId, version: "1.0.0" },
      servers: [{ url: "https://PLACEHOLDER.invalid/campusflow-adp-tools" }],
      paths: {
        [`/api/${operationId}`]: {
          post: {
            operationId,
            description: options.stale && operationId === EXPECTED_OPERATIONS[0]
              ? "competition-demo-v2 测试 Runtime"
              : "查询当前已核验校园数据源，使用确定性 CampusTools 服务返回业务结果。",
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: decision ? { decisionPreferences: { type: "object" } } : {} },
                },
              },
            },
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: { type: "object", properties: decision ? { decision: { type: "object" } } : {} },
                  },
                },
              },
            },
          },
        },
      },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      security: [{ bearerAuth: [] }],
    };
    zip.addFile(`${operationId}.yaml`, Buffer.from(yaml.stringify(doc), "utf8"));
  }
  zip.writeZip(zipPath);
  return zipPath;
}

test("PA1 valid Tencent-style export has exactly 13 unique operations and Decision contract on exactly six", () => {
  const result = auditPluginExport(makeExport());
  assert.strictEqual(result.pass, true, JSON.stringify(result.errors));
  assert.strictEqual(result.yamlCount, 13);
  assert.strictEqual(result.operationIds.length, 13);
  assert.strictEqual(new Set(result.operationIds).size, 13);
  assert.strictEqual(result.expectedBindings.length, 14);
  assert.strictEqual(result.expectedBindings.filter((x) => x.agent === "main").length, 0);
});

test("PA2 stale development metadata is rejected", () => {
  const result = auditPluginExport(makeExport({ stale: true }));
  assert.strictEqual(result.pass, false);
  assert.ok(result.errors.some((x) => x.code === "STALE_TOOL_METADATA"));
});

test("PA3 canonical import operation descriptions contain stable business copy only", () => {
  const spec = require(path.join(__dirname, "..", "tools", "openapi", "campus-agent-tools.adp-import.json"));
  for (const item of Object.values(spec.paths)) {
    const description = item.post.description;
    assert.match(description, /当前已核验校园数据源/);
    assert.match(description, /确定性 CampusTools 服务/);
    assert.doesNotMatch(description, /competition-demo-v\d|\bR\d+(?:\.\d+)*\b|Runtime|test case|研发|测试版本/i);
  }
});
