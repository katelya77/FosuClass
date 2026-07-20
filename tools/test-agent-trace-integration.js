#!/usr/bin/env node
const assert = require("assert");

process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";

const agentService = require("../server/src/services/ai/agentService");
const traceRecorder = require("../server/src/services/ai/agentTraceRecorder");

async function run() {
  traceRecorder.clearForTest();
  await agentService.chat({
    protocolVersion: "agent.v2",
    requestId: "req-trace-normal",
    conversationId: "conversation-trace-normal",
    message: "今天有什么课",
    context: { envVersion: "release", term: "test-term", releaseVersion: "test-release" },
  });
  await agentService.chat({
    protocolVersion: "agent.v2",
    requestId: "req-trace-sensitive",
    conversationId: "conversation-trace-sensitive",
    message: "password: trace-secret-password token: trace-secret-token",
    context: { envVersion: "release" },
  });

  const traces = traceRecorder.listForTest();
  assert.strictEqual(traces.length, 2, "every Agent run must create one trace");
  const normal = traces.find((item) => item.requestId === "req-trace-normal");
  const sensitive = traces.find((item) => item.requestId === "req-trace-sensitive");
  assert.ok(normal && sensitive);
  assert.strictEqual(normal.intent, "get_today_courses");
  assert.strictEqual(normal.selectedSkill, "today_schedule");
  assert.strictEqual(normal.providerUsed, false);
  assert.strictEqual(normal.evidenceComplete, true);
  assert.strictEqual(sensitive.errorCode, "SENSITIVE_CREDENTIAL_BLOCKED");
  const text = JSON.stringify(traces);
  assert.ok(!/trace-secret-password|trace-secret-token|password:|token:/i.test(text));
  assert.ok(!/conversation-trace-normal|conversation-trace-sensitive/.test(text));
  console.log("test-agent-trace-integration passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
