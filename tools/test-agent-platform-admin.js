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
      AI_AGENT_ENABLED: "false",
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
