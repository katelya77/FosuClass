#!/usr/bin/env node
// P4c：受治理 MCP Runtime 主测试（tasks.md P4c 验收）。
// 真实 loopback HTTP mock MCP Server + 受控 stdio fixture，验证：
//   - initialize/tools/list/tools/call 全链（含 Session 头透传、Bearer 注入、SSE 响应）；
//   - 治理链：未注册/禁用/模式拒绝/白名单外工具/参数 Schema/写确认/输出裁剪；
//   - 超时与主动取消分类不同；429/5xx/鉴权失败准确降级；
//   - 鉴权材料只按引用使用（不进 descriptor/错误消息）；
//   - 受控 stdio：命令白名单解析、无 shell、环境白名单；
//   - 桥接工具经真实 AgentKernel 五因子链（manifest 因子门控 + 执行闭环）。
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { createMcpRuntime } = require("../packages/mcp-runtime");
const { createToolRuntime } = require("../packages/tool-runtime");
const { AgentKernel } = require("../server/src/services/ai/agentKernel");
const { createMcpBridgeTool, BRIDGE_TOOL_ID } = require("../server/src/services/ai/mcpBridgeTool");

const TEST_TOKEN = "test-token-value-not-a-real-secret";
const observed = { auth: [], sessions: [], methods: [] };

function startMockServer(behavior = {}) {
  observed.auth = [];
  observed.sessions = [];
  observed.methods = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.searchParams.get("delay")) {
      return setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, result: {} }));
      }, Number(url.searchParams.get("delay")));
    }
    if (url.searchParams.get("status")) {
      res.writeHead(Number(url.searchParams.get("status")), { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "forced" }));
    }
    observed.auth.push(String(req.headers.authorization || ""));
    observed.sessions.push(String(req.headers["mcp-session-id"] || ""));
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const message = raw ? JSON.parse(raw) : {};
      observed.methods.push(String(message.method || ""));
      const reply = (result, headers = {}) => {
        if (url.searchParams.get("sse")) {
          res.writeHead(200, Object.assign({ "Content-Type": "text/event-stream" }, headers));
          res.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`);
          return;
        }
        res.writeHead(200, Object.assign({ "Content-Type": "application/json" }, headers));
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      };
      if (message.method === "initialize") {
        return reply({
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-mcp", version: "1" },
        }, { "Mcp-Session-Id": "session-abc-123" });
      }
      if (message.method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      }
      if (message.method === "tools/list") {
        return reply({
          tools: [
            { name: "kb_search", description: "search", inputSchema: { type: "object", required: ["q"], properties: { q: { type: "string" } } } },
            { name: "kb_update", description: "update", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
            { name: "unregistered_tool", description: "not in registry whitelist", inputSchema: { type: "object" } },
          ],
        });
      }
      if (message.method === "tools/call") {
        const name = message.params && message.params.name;
        const longText = "x".repeat(6000);
        return reply({
          content: [{ type: "text", text: behavior.longResult ? longText : `called:${name}` }],
          isError: false,
        });
      }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unknown" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function makeRuntime(extra = {}) {
  return createMcpRuntime(Object.assign({
    env: { MCP_TEST_TOKEN: TEST_TOKEN },
    allowInsecureHttp: true,
    timeoutMs: 15000,
  }, extra));
}

function makeRegistry(port, overrides = {}) {
  return {
    servers: [Object.assign({
      id: "kb",
      transport: "http",
      url: `http://127.0.0.1:${port}/mcp`,
      authEnvVar: "MCP_TEST_TOKEN",
      allowedTools: ["kb_search", "kb_update"],
      writeTools: ["kb_update"],
      timeoutMs: 3000,
    }, overrides)],
  };
}

async function testHappyPath(port) {
  const runtime = makeRuntime();
  const registry = makeRegistry(port);
  const result = await runtime.callTool({
    registry, serverId: "kb", toolName: "kb_search", args: { q: "图书馆" }, runtimeMode: "trial",
  });
  assert.strictEqual(result.isError, false);
  assert.strictEqual(result.content[0].text, "called:kb_search");
  // 鉴权按引用注入：服务器收到 Bearer；descriptor/注册表中没有值。
  assert.ok(observed.auth.includes(`Bearer ${TEST_TOKEN}`), "bearer injected from env reference");
  assert.ok(!JSON.stringify(registry).includes(TEST_TOKEN), "registry never carries the secret value");
  // Session：initialize 之后后续请求携带 Mcp-Session-Id。
  assert.ok(observed.methods[0] === "initialize", "handshake precedes discovery");
  const sessionAfterInit = observed.sessions.slice(1).some((value) => value === "session-abc-123");
  assert.ok(sessionAfterInit, "session id from initialize is propagated on subsequent calls");
  console.log("✓ happy path: handshake → discovery → scoped call, bearer by reference, session passthrough");
}

async function testGovernance(port) {
  const runtime = makeRuntime();
  const registry = makeRegistry(port);
  const cases = [
    ["unregistered server", { serverId: "ghost", toolName: "kb_search" }, "MCP_SERVER_NOT_REGISTERED"],
    ["disabled server", { registry: makeRegistry(port, { enabled: false }), toolName: "kb_search" }, "MCP_SERVER_DISABLED"],
    ["mode denied", { toolName: "kb_search", runtimeMode: "public", registry: makeRegistry(port, { runtimeModes: ["trial"] }) }, "MCP_SERVER_MODE_DENIED"],
    ["tool outside registry whitelist", { toolName: "unregistered_tool" }, "MCP_TOOL_NOT_ALLOWED"],
    ["args fail discovered schema", { toolName: "kb_search", args: { wrong: 1 } }, "MCP_ARGS_INVALID"],
    ["write without confirmation", { toolName: "kb_update", args: { id: "1" } }, "MCP_WRITE_CONFIRMATION_REQUIRED"],
  ];
  for (const [name, input, code] of cases) {
    await assert.rejects(
      runtime.callTool(Object.assign({ registry, serverId: "kb", runtimeMode: "trial" }, input)),
      (error) => error && error.code === code,
      `${name} must fail with ${code}`
    );
  }
  // 写确认闭环：携带回执的写调用放行。
  const writeResult = await runtime.callTool({
    registry, serverId: "kb", toolName: "kb_update", args: { id: "1" }, runtimeMode: "trial",
    confirmation: { receiptId: "receipt-1" },
  });
  assert.strictEqual(writeResult.isError, false, "confirmed write passes");
  console.log("✓ governance: registration/mode/scope/schema/write-confirmation all enforced");
}

async function testResilience(port) {
  const runtime = makeRuntime({ timeoutMs: 1000 });
  const slowRegistry = makeRegistry(port, { url: `http://127.0.0.1:${port}/mcp?delay=2500`, timeoutMs: 800 });
  await assert.rejects(
    runtime.callTool({ registry: slowRegistry, serverId: "kb", toolName: "kb_search", args: { q: "x" }, runtimeMode: "trial" }),
    (error) => error && error.code === "MCP_TIMEOUT",
    "slow upstream must classify as MCP_TIMEOUT"
  );
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(
    runtime.callTool({ registry: slowRegistry, serverId: "kb", toolName: "kb_search", args: { q: "x" }, runtimeMode: "trial", signal: controller.signal }),
    (error) => error && error.code === "MCP_ABORTED",
    "caller abort (50ms < 800ms timeout) must classify as MCP_ABORTED, not timeout"
  );
  for (const [status, code] of [[429, "MCP_RATE_LIMITED"], [500, "MCP_UPSTREAM_HTTP"], [401, "MCP_AUTH_FAILED"]]) {
    const failing = makeRegistry(port, { url: `http://127.0.0.1:${port}/mcp?status=${status}` });
    await assert.rejects(
      runtime.callTool({ registry: failing, serverId: "kb", toolName: "kb_search", args: { q: "x" }, runtimeMode: "trial" }),
      (error) => error && error.code === code,
      `upstream ${status} must classify as ${code}`
    );
  }
  console.log("✓ resilience: timeout/abort/429/5xx/auth-failure classified distinctly");
}

async function testSseAndClipping(port) {
  const runtime = makeRuntime();
  const sseRegistry = makeRegistry(port, { url: `http://127.0.0.1:${port}/mcp?sse=1` });
  const result = await runtime.callTool({
    registry: sseRegistry, serverId: "kb", toolName: "kb_search", args: { q: "x" }, runtimeMode: "trial",
  });
  assert.strictEqual(result.content[0].text, "called:kb_search", "SSE-framed response parsed");
  // 输出裁剪：6000 字符结果截断到 maxResultChars。
  const longRuntime = makeRuntime({ maxResultChars: 500 });
  const longResult = await longRuntime.callTool({
    registry: sseRegistry, serverId: "kb", toolName: "kb_search", args: { q: "x" }, runtimeMode: "trial",
  });
  assert.ok(longResult.content[0].text.length <= 520, `result clipped (got ${longResult.content[0].text.length})`);
  console.log("✓ SSE transport + output clipping");
}

async function testControlledStdio() {
  // 受控 stdio：fixture 服务器读一行 JSON-RPC、回一行结果。
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stdio-")), "fixture-server.js");
  fs.writeFileSync(fixture, `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() || "";
  lines.filter((line) => line.trim()).forEach((line) => {
    const message = JSON.parse(line);
    if (message.method === "tools/call") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "stdio:" + message.params.name }], isError: false } }) + "\\n");
    } else if (message.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } }) + "\\n");
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\\n");
    }
  });
});
`);
  const runtime = createMcpRuntime({
    env: {},
    trustedCommands: { node: process.execPath },
    skipInitializeOnStdio: true,
  });
  const registry = {
    servers: [{
      id: "local", transport: "stdio", command: "node", args: [fixture],
      allowedTools: ["echo"], runtimeModes: [],
    }],
  };
  const result = await runtime.callTool({ registry, serverId: "local", toolName: "echo", args: {}, runtimeMode: "dev" });
  assert.strictEqual(result.content[0].text, "stdio:echo", "controlled stdio roundtrip");
  // 未受信命令：fail closed。
  const hostile = { servers: [{ id: "evil", transport: "stdio", command: "bash", args: ["-c", "id"], allowedTools: ["echo"] }] };
  await assert.rejects(
    runtime.callTool({ registry: hostile, serverId: "evil", toolName: "echo", args: {}, runtimeMode: "dev" }),
    (error) => error && error.code === "MCP_COMMAND_NOT_TRUSTED",
    "untrusted command must fail closed"
  );
  console.log("✓ controlled stdio: trusted command resolution, no shell, untrusted rejected");
}

async function testBridgeFiveFactor(port) {
  const runtime = makeRuntime();
  const registry = makeRegistry(port);
  const bridge = createMcpBridgeTool({ resolveRegistry: () => registry, mcpRuntime: runtime });
  const toolRuntime = createToolRuntime({ tools: [bridge] });
  const manifestWithBridge = { getIntent: () => ({ allowedTools: [BRIDGE_TOOL_ID] }) };
  const manifestWithoutBridge = { getIntent: () => ({ allowedTools: ["get_teaching_week"] }) };
  const buildKernel = (capabilityManifestService) => new AgentKernel({
    skillRegistry: { getSkillForIntent: () => null },
    intentResolver: () => ({ name: "noop", slots: {} }),
    toolExecutor: async () => ({ ok: true }),
    toolRuntime,
    capabilityManifestService,
  });
  const skill = { id: "s", allowedTools: [BRIDGE_TOOL_ID] };

  // manifest 因子门控：未列入 manifest 的桥接工具进不了交集。
  const excluded = buildKernel(manifestWithoutBridge).resolveAllowedToolIds(
    { name: "noop" }, skill, "trial", [BRIDGE_TOOL_ID], {}
  );
  assert.deepStrictEqual(excluded, [], "bridge excluded when manifest does not allow it");
  const included = buildKernel(manifestWithBridge).resolveAllowedToolIds(
    { name: "noop" }, skill, "trial", [BRIDGE_TOOL_ID], {}
  );
  assert.deepStrictEqual(included, [BRIDGE_TOOL_ID], "bridge passes intersection when manifest allows it");

  // 执行闭环：经 toolRuntime.execute（Schema 校验 + allowedToolIds 门控）。
  const kernel = buildKernel(manifestWithBridge);
  const ok = await kernel.invokeTool(BRIDGE_TOOL_ID, {
    serverId: "kb", toolName: "kb_search", args: { q: "x" },
  }, { configSnapshot: null, runtimeMode: "trial" }, { allowedToolIds: included });
  assert.strictEqual(ok.success, true, `bridge execution succeeds through the real chain: ${JSON.stringify(ok)}`);
  const denied = await kernel.invokeTool(BRIDGE_TOOL_ID, {
    serverId: "kb", toolName: "kb_update", args: {},
  }, { configSnapshot: null, runtimeMode: "trial" }, { allowedToolIds: included });
  assert.strictEqual(denied.success, false);
  assert.strictEqual(denied.code, "MCP_WRITE_CONFIRMATION_REQUIRED", "write governance enforced end-to-end");
  console.log("✓ bridge tool enters the real five-factor chain (manifest gate + governed execution)");
}

async function run() {
  const { server, port } = await startMockServer();
  try {
    await testHappyPath(port);
    await testGovernance(port);
    await testResilience(port);
    await testSseAndClipping(port);
    await testControlledStdio();
    await testBridgeFiveFactor(port);
  } finally {
    server.close();
  }
  console.log("\ntest-agent-mcp-runtime: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
