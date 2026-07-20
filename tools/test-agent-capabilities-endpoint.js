#!/usr/bin/env node
const assert = require("assert");

process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_API_KEY = "endpoint-test-key-must-never-appear";

const express = require("../server/node_modules/express");
const aiRouter = require("../server/src/routes/ai");

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  const server = await listen(app);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/agent/capabilities`);
    assert.strictEqual(response.status, 200);
    const payload = await response.json();
    assert.strictEqual(payload.success, true);
    assert.deepStrictEqual(payload.protocolVersions, ["agent.v1", "agent.v2"]);
    assert.strictEqual(payload.currentRuntimeMode, "public");
    assert.strictEqual(payload.enhancedModeEnabled, false);
    assert.ok(Array.isArray(payload.capabilities) && payload.capabilities.length >= 20);
    assert.ok(Array.isArray(payload.cardTypes) && payload.cardTypes.includes("schedule"));
    const text = JSON.stringify(payload);
    assert.ok(!/endpoint-test-key|AI_API_KEY|baseUrl|allowlist|openid|deployment|docker|providerChain/i.test(text));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("test-agent-capabilities-endpoint passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
