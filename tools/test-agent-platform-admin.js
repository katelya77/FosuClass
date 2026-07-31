#!/usr/bin/env node
const assert = require("assert");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");

function assertSafePayload(value) {
  const serialized = JSON.stringify(value);
  [
    /api.?key/i,
    /authorization/i,
    /(?:^|["_])token(?:["_:]|$)/i,
    /system.?prompt/i,
    /hidden.?reason/i,
    /chain.?of.?thought/i,
  ].forEach((pattern) => {
    assert.ok(!pattern.test(serialized), `admin runtime truth leaked forbidden field: ${pattern}`);
  });
}

async function run() {
  const harness = await startAdminHttpHarness({
    environment: {
      AI_RUNTIME_MODE: "public",
      AI_AGENT_ENABLED: "true",
      AI_PROVIDER: "deepseek",
      AI_PROVIDER_CHAIN: "deepseek,mock",
      AI_EXECUTION_POLICY: "adaptive",
      DEEPSEEK_API_KEY: "unit-test-admin-public-zero-placeholder-not-real",
      AI_PROVIDER_IGNORE_ENV_FILE: "true",
      ADMIN_SERVICE_TOKENS: JSON.stringify([
        { name: "c1-catalog", token: "c1-catalog-token", scopes: ["catalog:write"] },
        { name: "c1-config-read", token: "c1-config-read-token", scopes: ["agent-config:read"] },
      ]),
    },
  });
  try {
    const unauthenticated = await harness.request("/api/admin/agent-platform/topology");
    assert.strictEqual(unauthenticated.status, 401, unauthenticated.text);

    const session = await harness.login();
    const topology = await harness.request("/api/admin/agent-platform/topology", {
      cookie: session.cookie,
    });
    assert.strictEqual(topology.status, 200, topology.text);
    assert.strictEqual(topology.json.success, true);
    assert.strictEqual(topology.json.app, "@xiaofu-agent/agent-admin");
    assert.strictEqual(topology.json.platform.runtimePackage, "@xiaofu-agent/agent-runtime");
    assert.strictEqual(topology.json.platform.protocolPackage, "@xiaofu-agent/agent-protocol");
    assert.deepStrictEqual(topology.json.platform.pluginIds, ["fosu-campus"]);
    // P4a：后台显示的 configVersion 必须等于发布内核真实当前快照（cfg-<env>-<seq>-<digest12>）。
    assert.match(topology.json.platform.configVersion, /^cfg-(public|trial|dev)-\d{4,}-[0-9a-f]{12}$/);
    assert.ok(topology.json.platform.configKernel);
    assert.strictEqual(typeof topology.json.platform.configKernel.snapshotCount, "number");
    assert.strictEqual(topology.json.platform.plugins[0].id, "fosu-campus");
    assert.ok(topology.json.platform.plugins[0].version);
    assert.ok(topology.json.platform.packageOwnership.context);
    assert.ok(topology.json.platform.executionPolicy.supported.includes("deterministic"));
    assert.deepStrictEqual(topology.json.platform.executionPolicy.supported,
      ["deterministic", "strict_model_first", "adaptive"]);
    assert.strictEqual(topology.json.platform.executionPolicy.effectiveDefault, "deterministic");
    assert.strictEqual(topology.json.platform.executionPolicy.strictModelFirstReady, true);
    assert.strictEqual(topology.json.platform.executionPolicy.adaptiveReady, true);
    assert.strictEqual(topology.json.platform.runtime.hardDeadlineMs, 15000);
    assert.strictEqual(topology.json.platform.runtime.maxFallbackAttempts, 1);
    assert.strictEqual(topology.json.platform.providerRuntime.maxFallbackAttempts, 1);
    assert.strictEqual(topology.json.platform.providerRuntime.connectionReuse.keepAlive, true);
    assertSafePayload(topology.json);

    const chat = await harness.request("/api/ai/agent/chat", {
      method: "POST",
      body: {
        message: "\u4f60\u662f\u8c01\uff1f",
        protocolVersion: "agent.v2",
        requestId: "platform-admin-trace",
        context: { envVersion: "release", memoryMode: "local_only" },
      },
    });
    assert.strictEqual(chat.status, 200, chat.text);
    assert.ok(chat.json.platformTrace);

    const recent = await harness.request("/api/admin/agent-platform/runs?limit=5", {
      cookie: session.cookie,
    });
    assert.strictEqual(recent.status, 200, recent.text);
    assert.strictEqual(recent.json.success, true);
    assert.ok(recent.json.runs.some((trace) => trace.runId === chat.json.runId));
    assert.ok(recent.json.runs.every((trace) => trace.configVersion));
    const trace = recent.json.runs.find((item) => item.runId === chat.json.runId);
    assert.deepStrictEqual(Object.keys(trace.timings), [
      "createRun", "decision", "tool", "verification", "response", "total",
    ]);

    // P4e 复审跟进（M-2）：runs 列表与 runs/:runId 详情同权 —— 服务令牌必须持
    // agent-config:read；cookie 会话（admin:full）行为不变（上方断言）。
    const runsWrongScope = await harness.request("/api/admin/agent-platform/runs?limit=5", {
      headers: { authorization: "Bearer c1-catalog-token" },
    });
    assert.strictEqual(runsWrongScope.status, 403, runsWrongScope.text);
    assert.strictEqual(runsWrongScope.json.code, "ADMIN_SCOPE_DENIED");
    const runsConfigRead = await harness.request("/api/admin/agent-platform/runs?limit=5", {
      headers: { authorization: "Bearer c1-config-read-token" },
    });
    assert.strictEqual(runsConfigRead.status, 200, runsConfigRead.text);
    assert.strictEqual(runsConfigRead.json.success, true);

    const after = await harness.request("/api/admin/agent-platform/topology", {
      cookie: session.cookie,
    });
    const providerMetrics = after.json.platform.providerRuntime.metrics || {};
    assert.strictEqual(providerMetrics.decision && providerMetrics.decision.count || 0, 0,
      "public must keep external Decision attempts at zero even with credentials configured");
    assert.strictEqual(providerMetrics.response && providerMetrics.response.count || 0, 0,
      "public must keep external Response attempts at zero even with credentials configured");
    assertSafePayload(recent.json);

    console.log("test-agent-platform-admin: PASS");
  } finally {
    await harness.close();
  }
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
