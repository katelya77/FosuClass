// Coze Tool Gateway 测试
// 覆盖：默认关闭 / Token 鉴权 / 工具白名单 / 写操作 confirmation-only / OpenAPI 一致性
// 运行: node tools/test-coze-tool-gateway.js

const assert = require("assert");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const gateway = require(path.join(root, "server/src/services/ai/cozeToolGatewayService.js"));
const manifest = require(path.join(root, "server/config/agent-capability-manifest.json"));

const ENV = {
  COZE_TOOL_GATEWAY_ENABLED: "true",
  COZE_TOOL_GATEWAY_TOKEN: "test-gateway-token-123",
};
const AUTH_HEADERS = { authorization: "Bearer test-gateway-token-123" };

// ---------- 1. 默认关闭 ----------
{
  assert.strictEqual(gateway.isGatewayEnabled({}), false, "未配置环境变量时必须关闭");
  assert.strictEqual(
    gateway.isGatewayEnabled({ COZE_TOOL_GATEWAY_ENABLED: "true" }),
    false,
    "只有开关没有 Token 也必须关闭"
  );
  assert.strictEqual(gateway.isGatewayEnabled(ENV), true, "开关 + Token 都配置才启用");
}

// ---------- 2. 鉴权 ----------
{
  const disabled = gateway.authenticateRequest(AUTH_HEADERS, {});
  assert.strictEqual(disabled.ok, false);
  assert.strictEqual(disabled.code, "GATEWAY_DISABLED", "关闭状态下任何请求都拒绝");

  assert.strictEqual(gateway.authenticateRequest({}, ENV).code, "GATEWAY_UNAUTHORIZED");
  assert.strictEqual(
    gateway.authenticateRequest({ authorization: "Bearer wrong-token-xxx" }, ENV).code,
    "GATEWAY_UNAUTHORIZED"
  );
  assert.strictEqual(
    gateway.authenticateRequest({ authorization: "test-gateway-token-123" }, ENV).code,
    "GATEWAY_UNAUTHORIZED",
    "缺少 Bearer 前缀也拒绝"
  );
  assert.strictEqual(gateway.authenticateRequest(AUTH_HEADERS, ENV).ok, true);
}

// ---------- 3. 工具白名单 ----------
{
  assert.strictEqual(gateway.getGatewayTool("rm_rf_everything").code, "TOOL_NOT_FOUND");
  const tool = manifest.tools["get_campus_weather"];
  const okCheck = gateway.getGatewayTool("get_campus_weather");
  assert.strictEqual(okCheck.ok, true, "trial 允许的读工具必须可用");
  assert.ok(tool, "manifest 中应存在该工具");
  // manifest 中没有任何工具运行时列表为空；构造验证：runtimeModes 必须含 gateway runtime
  Object.keys(manifest.tools).forEach((id) => {
    const check = gateway.getGatewayTool(id);
    const allowed = manifest.tools[id].runtimeModes.includes(gateway.GATEWAY_RUNTIME_MODE);
    assert.strictEqual(check.ok, allowed, `${id} gateway 可见性与 manifest runtimeModes 不一致`);
  });
}

// ---------- 4. 执行调用（HTTP 语义） ----------
async function testExecution() {
  // 关闭状态 → 503
  const disabled = await gateway.executeGatewayCall("get_campus_weather", {}, AUTH_HEADERS, {});
  assert.strictEqual(disabled.status, 503);

  // 无 Token → 401
  const unauthorized = await gateway.executeGatewayCall("get_campus_weather", {}, {}, ENV);
  assert.strictEqual(unauthorized.status, 401);

  // 未知工具 → 404
  const notFound = await gateway.executeGatewayCall("delete_database", {}, AUTH_HEADERS, ENV);
  assert.strictEqual(notFound.status, 404);

  // 超大 body → 413
  const bigBody = { text: "x".repeat(20000) };
  const tooLarge = await gateway.executeGatewayCall("get_campus_weather", bigBody, AUTH_HEADERS, ENV);
  assert.strictEqual(tooLarge.status, 413);

  // 合法读工具 → 200 + 结构化响应（业务成败不断言，依赖数据环境）
  const read = await gateway.executeGatewayCall("get_teaching_week", {}, AUTH_HEADERS, ENV);
  assert.strictEqual(read.status, 200);
  assert.ok(typeof read.body.success === "boolean");
  assert.strictEqual(read.body.confirmation, "none", "读工具不得携带确认请求");
  assert.strictEqual(read.body.runtimeMode, "trial", "Gateway 以 trial 模式执行");

  // 写工具 → confirmation-only：必须携带确认元数据，且 Gateway 不执行真实写入
  const writeToolId = Object.keys(manifest.tools).find(
    (id) => manifest.tools[id].operation === "write" || (manifest.tools[id].confirmation && manifest.tools[id].confirmation !== "none")
  );
  assert.ok(writeToolId, "manifest 应至少有一个写工具");
  const write = await gateway.executeGatewayCall(writeToolId, {}, AUTH_HEADERS, ENV);
  assert.strictEqual(write.status, 200);
  assert.notStrictEqual(write.body.confirmation, "none", "写工具必须标记 confirmation");
  assert.ok(
    write.body.confirmationRequest && write.body.confirmationRequest.title,
    "写工具必须返回确认请求，Gateway 绝不直接执行写入"
  );
}

// ---------- 5. OpenAPI 与 Gateway 一致性 ----------
{
  const openapi = JSON.parse(
    fs.readFileSync(path.join(root, "server/config/coze-tool-gateway.openapi.json"), "utf8")
  );
  assert.strictEqual(openapi.servers[0].url, manifest.toolGateway.baseUrl, "OpenAPI server 必须与 manifest.toolGateway 一致");
  const pathPrefix = manifest.toolGateway.pathPrefix || "/tools";
  Object.keys(openapi.paths).forEach((p) => {
    assert.ok(p.startsWith(`${pathPrefix}/`), `OpenAPI path ${p} 必须在 ${pathPrefix} 前缀下`);
    const toolId = p.slice(pathPrefix.length + 1);
    assert.ok(manifest.tools[toolId], `OpenAPI path ${p} 对应的工具必须在 manifest 中`);
    const check = gateway.getGatewayTool(toolId);
    assert.ok(check.ok, `OpenAPI 暴露的工具 ${toolId} 必须对 Gateway 可用`);
  });
  // 反向：trial 可用的工具必须全部出现在 OpenAPI（ Gateway 不藏工具也不超发）
  const openapiToolIds = Object.keys(openapi.paths).map((p) => p.slice(pathPrefix.length + 1)).sort();
  const trialToolIds = Object.keys(manifest.tools)
    .filter((id) => manifest.tools[id].runtimeModes.includes(gateway.GATEWAY_RUNTIME_MODE))
    .sort();
  assert.deepStrictEqual(openapiToolIds, trialToolIds, "OpenAPI 工具集必须与 trial 可用工具集完全一致");
  assert.ok(openapi.security && openapi.security[0] && openapi.security[0].GatewayToken, "OpenAPI 必须声明 GatewayToken 安全要求");
}

testExecution()
  .then(() => console.log("test-coze-tool-gateway passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
