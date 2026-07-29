#!/usr/bin/env node
const assert = require("assert");

process.env.NODE_ENV = "test";
process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";

const app = require("../server/src/app");

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, Object.assign({
    headers: { "Content-Type": "application/json" },
  }, options));
  const body = await response.json();
  return { response, body };
}

async function pollTerminal(baseUrl, accepted) {
  const deadline = Date.now() + 8_000;
  let view = null;
  while (Date.now() < deadline) {
    const result = await jsonRequest(
      `${baseUrl}/api/ai/agent/runs/${encodeURIComponent(accepted.runId)}?pollToken=${encodeURIComponent(accepted.pollToken)}`
    );
    assert.strictEqual(result.response.status, 200);
    view = result.body;
    if (["completed", "degraded", "failed", "cancelled"].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, Number(view.nextPollMs) || 10)));
  }
  throw new Error(`run did not finish: ${JSON.stringify(view)}`);
}

async function run() {
  const server = await listen();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const create = await jsonRequest(`${baseUrl}/api/ai/agent/runs`, {
      method: "POST",
      body: JSON.stringify({
        message: "\u4f60\u662f\u8c01\uff1f",
        protocolVersion: "agent.v2",
        requestId: "platform-http-run",
        conversationId: "platform-http-conversation",
        idempotencyKey: "platform-http-idempotency",
        context: { envVersion: "release", memoryMode: "local_only" },
      }),
    });
    assert.strictEqual(create.response.status, 202, JSON.stringify(create.body));
    assert.strictEqual(create.body.appService, "@xiaofu-agent/agent-server");
    assert.strictEqual(create.body.diagnostics.idempotencyKeyAccepted, true);
    assert.ok(create.body.runId && create.body.pollToken);

    const terminal = await pollTerminal(baseUrl, create.body);
    assert.ok(terminal.result && terminal.result.platformTrace, "Run result must contain the platform Trace");
    assert.strictEqual(terminal.result.platformTrace.runtimePackage, "@xiaofu-agent/agent-runtime");
    assert.strictEqual(terminal.result.transport.appService, "@xiaofu-agent/agent-server");
    const types = terminal.events.map((event) => event.type);
    assert.ok(types.includes("runtime.entered"), `missing runtime.entered: ${types.join(",")}`);
    assert.ok(types.includes("stage.started"), `missing stage.started: ${types.join(",")}`);
    assert.ok(types.includes("runtime.completed"), `missing runtime.completed: ${types.join(",")}`);
    const terminalIndexes = terminal.events
      .map((event, index) => (/^run\.(completed|degraded|failed|cancelled)$/.test(event.type) ? index : -1))
      .filter((index) => index >= 0);
    assert.strictEqual(terminalIndexes.length, 1, "Run Repository must expose exactly one terminal event");
    assert.strictEqual(terminalIndexes[0], terminal.events.length - 1, "terminal RunEvent must be last");

    const chat = await jsonRequest(`${baseUrl}/api/ai/agent/chat`, {
      method: "POST",
      body: JSON.stringify({
        message: "\u4f60\u662f\u8c01\uff1f",
        protocolVersion: "agent.v2",
        requestId: "platform-http-chat",
        conversationId: "platform-http-conversation",
        context: { envVersion: "release", memoryMode: "local_only" },
      }),
    });
    assert.strictEqual(chat.response.status, 200);
    assert.strictEqual(chat.body.platformTrace.runtimePackage, "@xiaofu-agent/agent-runtime");
    assert.strictEqual(chat.body.transport.appService, "@xiaofu-agent/agent-server");

    const agui = await jsonRequest(`${baseUrl}/api/ai/agent/agui`, {
      method: "POST",
      body: JSON.stringify({
        message: "\u4f60\u662f\u8c01\uff1f",
        protocolVersion: "agent.v2",
        requestId: "platform-http-agui",
        conversationId: "platform-http-conversation",
        context: { envVersion: "release", memoryMode: "local_only" },
      }),
    });
    assert.strictEqual(agui.response.status, 200);
    assert.strictEqual(agui.body.response.transport.appService, "@xiaofu-agent/agent-server");
    assert.strictEqual(agui.body.response.platformTrace.runtimePackage, "@xiaofu-agent/agent-runtime");
    assert.strictEqual(agui.body.events.filter((event) => event.type === "RUN_FINISHED").length, 1);

    const fs = require("fs");
    const path = require("path");
    const routeSource = fs.readFileSync(path.join(__dirname, "../server/src/routes/ai.js"), "utf8");
    assert.ok(!/agentService\.chat\s*\(/.test(routeSource), "route must not execute the legacy service directly");
    assert.ok(!/setImmediate\s*\(/.test(routeSource), "route must not own the asynchronous execution closure");

    console.log("test-agent-platform-http: PASS");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
