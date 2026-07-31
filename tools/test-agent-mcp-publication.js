#!/usr/bin/env node
// P4c：MCP 发布适配器专项（tasks.md P4c「注册/鉴权不进 Artifact」验收）。
//   - 声明式校验：未知字段/非法 id/非法传输/非受信命令/非法 URL/密钥夹带/
//     writeTools 越界/模式越界/预算越界一律拒绝；
//   - authEnvVar/envAllowlist 只存引用名（标识符模式锁死，无法夹带密钥）；
//   - 发布前测试：启用服务器必须至少声明一个允许工具；
//   - 组合级闭环：发布 → 新快照绑定 → 在途旧快照不变 → rollback 恢复；
//   - 种子 = 空注册表（≡ P4c 前无 MCP 能力）。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createMcpPublicationAdapter } = require("../packages/mcp-runtime");

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mcp-publication-${label}-`));
}

function createAdapter() {
  return createMcpPublicationAdapter({
    knownCommands: ["node", "python"],
    allowInsecureHttp: true,
  });
}

const VALID_HTTP_SERVER = {
  id: "kb-remote",
  transport: "http",
  url: "https://mcp.example.com/mcp",
  authEnvVar: "MCP_KB_TOKEN",
  allowedTools: ["kb_search"],
  writeTools: [],
  runtimeModes: ["trial", "dev"],
  timeoutMs: 8000,
};

function testValidation() {
  const adapter = createAdapter();
  assert.strictEqual(adapter.validate(adapter.seedPayload()).ok, true, "empty registry (seed) validates");
  assert.strictEqual(adapter.validate({ servers: [VALID_HTTP_SERVER] }).ok, true, "valid http server validates");
  const validStdio = adapter.validate({
    servers: [{
      id: "local-fs", transport: "stdio", command: "node", args: ["server.js", "--ro"],
      envAllowlist: ["HOME", "LANG"], allowedTools: ["fs_read"], writeTools: ["fs_read"],
    }],
  });
  assert.strictEqual(validStdio.ok, true, `valid stdio server validates: ${validStdio.errors}`);

  const cases = [
    ["non-declarative top field", { servers: [], backdoor: true }],
    ["bad server id", { servers: [Object.assign({}, VALID_HTTP_SERVER, { id: "Bad ID!" })] }],
    ["duplicate id", { servers: [VALID_HTTP_SERVER, VALID_HTTP_SERVER] }],
    ["unknown transport", { servers: [Object.assign({}, VALID_HTTP_SERVER, { transport: "ws" })] }],
    ["http with command", { servers: [Object.assign({}, VALID_HTTP_SERVER, { command: "node" })] }],
    ["stdio with url", { servers: [{ id: "s1", transport: "stdio", command: "node", url: "https://x.example.com", allowedTools: ["a"] }] }],
    ["untrusted command", { servers: [{ id: "s1", transport: "stdio", command: "bash", allowedTools: ["a"] }] }],
    ["shell metachars in args", { servers: [{ id: "s1", transport: "stdio", command: "node", args: ["a; rm -rf /"], allowedTools: ["a"] }] }],
    ["http url not https", { servers: [Object.assign({}, VALID_HTTP_SERVER, { url: "http://mcp.example.com" })] }],
    ["url with ip literal", { servers: [Object.assign({}, VALID_HTTP_SERVER, { url: "https://203.0.113.7/mcp" })] }],
    ["url with .local host", { servers: [Object.assign({}, VALID_HTTP_SERVER, { url: "https://printer.local/mcp" })] }],
    ["authEnvVar holds a value not a name", { servers: [Object.assign({}, VALID_HTTP_SERVER, { authEnvVar: "sk-live-token-value" })] }],
    ["secret field smuggled", { servers: [Object.assign({}, VALID_HTTP_SERVER, { apiKey: "sk-x" })] }],
    ["secret nested in args target", { servers: [{ id: "s1", transport: "stdio", command: "node", allowedTools: ["a"], password: "x" }] }],
    ["writeTools outside allowedTools", { servers: [Object.assign({}, VALID_HTTP_SERVER, { writeTools: ["kb_delete"] })] }],
    ["runtimeMode outside triple", { servers: [Object.assign({}, VALID_HTTP_SERVER, { runtimeModes: ["prod"] })] }],
    ["timeout out of range", { servers: [Object.assign({}, VALID_HTTP_SERVER, { timeoutMs: 100 })] }],
    ["tool name invalid", { servers: [Object.assign({}, VALID_HTTP_SERVER, { allowedTools: ["drop tables;"] })] }],
    ["envAllowlist not a name", { servers: [{ id: "s1", transport: "stdio", command: "node", envAllowlist: ["secret=value"], allowedTools: ["a"] }] }],
  ];
  cases.forEach(([name, payload]) => {
    const report = adapter.validate(payload);
    assert.strictEqual(report.ok, false, `must reject: ${name}`);
    assert.ok(report.errors.length > 0, `must report errors: ${name}`);
  });
  console.log("✓ declarative validation: unknown/smuggled-secret/untrusted-command/scope violations all rejected");
}

function testPrePublishGuard() {
  const adapter = createAdapter();
  const enabledNoTools = adapter.validate({
    servers: [Object.assign({}, VALID_HTTP_SERVER, { allowedTools: [] })],
  }).normalized;
  const report = adapter.test(enabledNoTools);
  assert.strictEqual(report.ok, false, "enabled server with empty allowedTools fails pre-publish test");
  const disabledNoTools = adapter.validate({
    servers: [Object.assign({}, VALID_HTTP_SERVER, { allowedTools: [], enabled: false })],
  }).normalized;
  assert.strictEqual(adapter.test(disabledNoTools).ok, true, "disabled server may allow no tools");
  console.log("✓ pre-publish test: enabled server must declare at least one allowed tool");
}

function testCompositionRoundtrip() {
  const root = tmpRoot("compose");
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = root;
  const composition = require("../server/src/services/ai/platformComposition");
  const kernel = composition.getConfigKernel();

  const snapshotV1 = kernel.getCurrentSnapshot("trial");
  assert.deepStrictEqual(composition.resolveMcpRegistryForSnapshot(snapshotV1), { servers: [] },
    "seed registry is empty (no MCP capability before any publication)");

  const draftInput = {
    domain: "mcp",
    artifactId: "fosu-campus",
    environment: "trial",
    payload: { servers: [VALID_HTTP_SERVER] },
    actor: "p4c-test",
  };
  kernel.saveDraft(draftInput);
  const validation = kernel.validateDraft(draftInput);
  assert.strictEqual(validation.ok, true, `registry draft validates: ${validation.errors}`);
  assert.strictEqual(kernel.testDraft(draftInput).ok, true);
  kernel.publishDraft(draftInput);

  const snapshotV2 = kernel.getCurrentSnapshot("trial");
  const bound = composition.resolveMcpRegistryForSnapshot(snapshotV2);
  assert.strictEqual(bound.servers.length, 1, "new snapshot binds the published registry");
  assert.strictEqual(bound.servers[0].id, "kb-remote");
  assert.strictEqual(bound.servers[0].authEnvVar, "MCP_KB_TOKEN", "auth stored as reference name only");

  const inFlight = composition.resolveMcpRegistryForSnapshot(snapshotV1);
  assert.deepStrictEqual(inFlight, { servers: [] }, "in-flight snapshot keeps the pre-publish registry");

  kernel.rollback({ domain: "mcp", artifactId: "fosu-campus", environment: "trial", toVersion: 1, actor: "p4c-test" });
  assert.deepStrictEqual(composition.resolveMcpRegistryForSnapshot(kernel.getCurrentSnapshot("trial")), { servers: [] },
    "rollback restores the empty registry");
  console.log("✓ composition roundtrip: publish → snapshot binding → in-flight stability → rollback");
}

testValidation();
testPrePublishGuard();
testCompositionRoundtrip();
console.log("\ntest-agent-mcp-publication: PASS");
