#!/usr/bin/env node
/**
 * Capability Contract 测试：
 * 1. 生成器漂移检查（Manifest 改动后产物必须同步，否则失败）
 * 2. Action Command 安全断言（8 类 Action 的 confirmation / targetPolicy 规则）
 * 3. Tool Schema / OpenAPI / 测试矩阵与 Manifest 的一致性
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const manifest = require("../server/config/agent-capability-manifest.json");
const actionCatalog = require("../miniprogram/shared/agentActionCatalog.generated");
const toolSchemas = require("../server/src/services/ai/generated/toolSchemas.generated");

// ---------- 1. 漂移检查：所有生成产物必须与 Manifest 同步 ----------
const generatorCheck = spawnSync(process.execPath, [
  path.resolve(__dirname, "generate-capability-contract.js"),
  "--check",
], { cwd: root, encoding: "utf8" });
assert.strictEqual(
  generatorCheck.status, 0,
  `capability contract artifacts are stale; run node tools/generate-capability-contract.js\n${generatorCheck.stderr || generatorCheck.stdout}`
);

// ---------- 2. Action Command 安全断言 ----------
const EXPECTED_ACTIONS = [
  "navigate", "openSheet", "fillComposer", "fillForm",
  "requestSubscribe", "confirmWrite", "copy", "retry",
];
const AUTO_ACTIONS = ["navigate", "openSheet", "fillComposer", "fillForm", "copy", "retry"];
const CONFIRM_ACTIONS = ["requestSubscribe", "confirmWrite"];

EXPECTED_ACTIONS.forEach((id) => {
  const action = manifest.actions[id];
  assert.ok(action, `manifest must define action ${id}`);
  assert.ok(action.displayName && action.description, `${id} requires displayName and description`);
  assert.ok(action.inputSchema && action.inputSchema.type === "object", `${id} requires object inputSchema`);
  assert.ok(Array.isArray(action.runtimeModes) && action.runtimeModes.length > 0, `${id} requires runtimeModes`);
  action.runtimeModes.forEach((mode) => {
    assert.ok(manifest.runtimeModes[mode], `${id} references unknown runtimeMode ${mode}`);
  });
});

// 读取类自动执行；写类必须确认；不存在绕过确认的写操作
AUTO_ACTIONS.forEach((id) => {
  assert.strictEqual(manifest.actions[id].operation, "read", `${id} must be a read operation`);
  assert.strictEqual(manifest.actions[id].confirmation, "none", `${id} must be auto-executable`);
});
CONFIRM_ACTIONS.forEach((id) => {
  assert.strictEqual(manifest.actions[id].operation, "write", `${id} must be a write operation`);
  assert.strictEqual(manifest.actions[id].confirmation, "required", `${id} must require confirmation`);
});
Object.keys(manifest.actions).forEach((id) => {
  const action = manifest.actions[id];
  if (action.operation !== "read") {
    assert.notStrictEqual(action.confirmation, "none", `write action ${id} must never be auto-executable`);
  }
  assert.ok(["none", "required", "double"].includes(action.confirmation), `${id} confirmation must be none|required|double`);
});

// 模型不得生成任意 URL：navigate 必须有页面白名单策略，且 url 禁止出现协议头
assert.strictEqual(manifest.actions.navigate.targetPolicy, "page_url_whitelist");
assert.strictEqual(manifest.actions.openSheet.targetPolicy, "sheet_enum_whitelist");
assert.strictEqual(manifest.actions.fillForm.targetPolicy, "form_field_whitelist");
assert.strictEqual(manifest.actions.requestSubscribe.targetPolicy, "subscribe_scene_whitelist");

// navigate 页面白名单必须与 generatedPayloadContract.ALLOWED_NAVIGATION_URLS 同源（漂移门禁）
const generatedPayloadContractForPages = require("../server/src/services/ai/generatedPayloadContract");
const manifestPages = [...(manifest.actions.navigate.allowedPages || [])].sort();
const contractPages = [...generatedPayloadContractForPages.ALLOWED_NAVIGATION_URLS].sort();
assert.deepStrictEqual(
  manifestPages, contractPages,
  "manifest.actions.navigate.allowedPages must exactly match generatedPayloadContract.ALLOWED_NAVIGATION_URLS; update both or neither"
);
manifestPages.forEach((page) => {
  assert.ok(page.startsWith("/") && !page.includes("://"), `page whitelist entry must be a local path: ${page}`);
});

// ---------- 2b. 卡片按钮白名单与 Manifest 登记一致（漂移门禁） ----------
const generatedPayloadContract = require("../server/src/services/ai/generatedPayloadContract");
const cardActionIds = Object.keys(manifest.cardActions || {}).filter((id) => !id.startsWith("_")).sort();
const contractActionIds = [...generatedPayloadContract.ALLOWED_ACTION_TYPES].sort();
assert.deepStrictEqual(
  cardActionIds, contractActionIds,
  "manifest.cardActions must exactly match generatedPayloadContract.ALLOWED_ACTION_TYPES; update both or neither"
);
cardActionIds.forEach((id) => {
  const command = manifest.cardActions[id].command;
  if (command !== null && command !== undefined) {
    assert.ok(manifest.actions[command], `cardAction ${id} maps to unknown command ${command}`);
  }
});
// 生成的 Catalog 暴露同一映射
cardActionIds.forEach((id) => {
  const expected = manifest.cardActions[id].command || null;
  assert.strictEqual(actionCatalog.CARD_ACTION_TO_COMMAND[id], expected, `catalog mapping for ${id}`);
});

// ---------- 3. 生成产物一致性 ----------
// Action Catalog
EXPECTED_ACTIONS.forEach((id) => {
  assert.ok(actionCatalog.getAction(id), `generated catalog must expose ${id}`);
});
AUTO_ACTIONS.forEach((id) => assert.strictEqual(actionCatalog.isAutoExecutable(id), true, `${id} auto-exec`));
CONFIRM_ACTIONS.forEach((id) => assert.strictEqual(actionCatalog.isAutoExecutable(id), false, `${id} must not auto-exec`));
assert.strictEqual(actionCatalog.isActionAllowedForRuntime("navigate", "public"), true);
assert.strictEqual(actionCatalog.isActionAllowedForRuntime("navigate", "unknown_mode"), false);
assert.deepStrictEqual(
  [...actionCatalog.ACTION_CONFIRMATION_REQUIRED].sort(),
  [...CONFIRM_ACTIONS].sort()
);

// Tool Schema：数量与 id 集合必须与 manifest.tools 一致
const manifestToolIds = Object.keys(manifest.tools).sort();
const schemaToolIds = Object.keys(toolSchemas.TOOL_SCHEMAS).sort();
assert.deepStrictEqual(schemaToolIds, manifestToolIds, "tool schemas must cover exactly the manifest tools");
manifestToolIds.forEach((id) => {
  const schema = toolSchemas.getToolSchema(id);
  assert.ok(schema, `tool schema ${id} missing`);
  assert.strictEqual(schema.name, id);
  assert.strictEqual(schema["x-fosu-safety"].operation, manifest.tools[id].operation || "read");
  assert.strictEqual(schema["x-fosu-safety"].confirmation, manifest.tools[id].confirmation || "none");
  assert.strictEqual(schema.parameters.type, "object");
});
// 任何 runtime mode 下，写工具都必须 confirmation != none（只能返回确认请求，绝不直接执行）
manifestToolIds.forEach((id) => {
  const t = manifest.tools[id];
  if ((t.operation || "read") !== "read") {
    assert.notStrictEqual(t.confirmation || "none", "none", `write tool ${id} must require confirmation in every mode`);
  }
});
// public 模式只能看到 runtimeModes 含 public 的工具；public 下的写工具同样只返回确认请求
const publicSchemas = toolSchemas.listToolSchemasForRuntime("public");
publicSchemas.forEach((schema) => {
  assert.ok(schema["x-fosu-safety"].runtimeModes.includes("public"));
  if (schema["x-fosu-safety"].operation !== "read") {
    assert.notStrictEqual(
      schema["x-fosu-safety"].confirmation, "none",
      `public write tool ${schema.name} must be confirmation-only`
    );
  }
});
assert.ok(publicSchemas.length > 0 && publicSchemas.length < schemaToolIds.length, "public tool set must be a strict subset");

// OpenAPI：每个工具一个 path；写操作必须声明 confirmation
const openapi = JSON.parse(
  fs.readFileSync(path.join(root, "server", "config", "coze-tool-gateway.openapi.json"), "utf8")
);
assert.strictEqual(openapi.openapi, "3.0.1");
manifestToolIds.forEach((id) => {
  const item = openapi.paths[`/tools/${id}`];
  assert.ok(item && item.post, `openapi missing path for ${id}`);
  assert.strictEqual(item.post.operationId, id);
  if ((manifest.tools[id].confirmation || "none") !== "none") {
    assert.ok(
      /confirmation request/.test(item.post.description),
      `write tool ${id} must declare confirmation-only behavior in openapi`
    );
  }
});
assert.strictEqual(Object.keys(openapi.paths).length, manifestToolIds.length);

// 测试矩阵：计数与 manifest 一致
const matrix = JSON.parse(
  fs.readFileSync(path.join(root, "tools", "capability-contract", "contract-matrix.generated.json"), "utf8")
);
assert.strictEqual(matrix.counts.tools, manifestToolIds.length);
assert.strictEqual(matrix.counts.intents, Object.keys(manifest.intents).length);
assert.strictEqual(matrix.counts.actions, EXPECTED_ACTIONS.length);
assert.strictEqual(matrix.schemaVersion, manifest.schemaVersion);

console.log("test-capability-contract passed");
