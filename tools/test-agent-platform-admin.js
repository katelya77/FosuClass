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
    assert.ok(topology.json.platform.configVersion.startsWith("manifest:"));
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
