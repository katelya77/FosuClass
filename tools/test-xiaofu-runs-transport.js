#!/usr/bin/env node
// Production transport must be the runs API + RunEvent polling: UI states
// come from real server events, never from client-side guesses. The legacy
// direct-chat oracle is only an explicit rollback path.
const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const aiTransportRouter = require("../miniprogram/services/aiTransportRouter");
const agentRunClient = require("../miniprogram/services/agentRunClient");
const cloudbaseConfig = require("../miniprogram/config/cloudbase");

const originalCreateRun = agentRunClient.createRun;
const originalPoll = agentRunClient.pollRunUntilDone;
const originalFlag = cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED;

async function testRunsTransportIsTheDefaultPath() {
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = true;
  const calls = { createRun: 0, poll: 0, oracle: 0 };
  const emittedEvents = [];
  const statuses = [];

  agentRunClient.createRun = async (payload) => {
    calls.createRun += 1;
    assert.strictEqual(payload.message, "今天有什么课");
    assert.strictEqual(payload.context.term, "2025-2026-2");
    assert.strictEqual(payload.protocolVersion, "agent.v2");
    assert.strictEqual(payload.requestId, "req-runs-1");
    assert.strictEqual(payload.conversationId, "conversation-runs-1");
    return { runId: "run-1", pollToken: "poll-1", status: "accepted", nextPollMs: 1 };
  };
  agentRunClient.pollRunUntilDone = async (runId, pollToken, options) => {
    calls.poll += 1;
    assert.strictEqual(runId, "run-1");
    assert.strictEqual(pollToken, "poll-1");
    const events = [
      { type: "understanding.started", sequence: 1 },
      { type: "tool.started", tool: "get_today_courses", sequence: 2 },
      { type: "run.completed", sequence: 3 },
    ];
    options.onEvents(events);
    options.onStatus({ type: "run.completed" });
    return {
      result: {
        protocolVersion: "agent.v2",
        status: "completed",
        answer: "今天有两节课",
        safety: { externalProviderUsed: false },
      },
    };
  };

  const response = await aiTransportRouter.chat({
    message: "今天有什么课",
    context: { term: "2025-2026-2" },
    protocolVersion: "agent.v2",
    requestId: "req-runs-1",
    conversationId: "conversation-runs-1",
    callbacks: {
      onRunEvents: (events) => emittedEvents.push(...events),
      onStatus: (status) => statuses.push(status),
    },
    // Even when a legacy oracle is supplied, the runs path must win unless
    // the rollback flag is explicitly off.
    oracleChat: async () => {
      calls.oracle += 1;
      throw new Error("legacy oracle must not be called in runs mode");
    },
  });

  assert.strictEqual(calls.createRun, 1, "production path must create a run");
  assert.strictEqual(calls.poll, 1, "production path must poll run events");
  assert.strictEqual(calls.oracle, 0, "legacy oracle short-circuit must be gone");
  assert.deepStrictEqual(emittedEvents.map((item) => item.type), [
    "understanding.started",
    "tool.started",
    "run.completed",
  ]);
  assert.strictEqual(response.answer, "今天有两节课");
  assert.ok(Array.isArray(response.runEvents) && response.runEvents.length === 3);
  const submitted = statuses.find((item) => item && item.type === "request.submitted");
  assert.ok(submitted, "submit status must be emitted");
  assert.ok(
    !/理解|查询|核验/.test(submitted.text),
    `pre-event status must stay neutral, got: ${submitted.text}`
  );
}

async function testRollbackFlagRestoresLegacyOracle() {
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = false;
  const calls = { createRun: 0, oracle: 0 };
  agentRunClient.createRun = async () => {
    calls.createRun += 1;
    throw new Error("runs API must not be called in rollback mode");
  };
  const response = await aiTransportRouter.chat({
    message: "hello",
    context: {},
    oracleChat: async () => {
      calls.oracle += 1;
      return { protocolVersion: "agent.v2", status: "completed", answer: "legacy ok" };
    },
  });
  assert.strictEqual(calls.oracle, 1, "rollback flag must restore the legacy oracle path");
  assert.strictEqual(calls.createRun, 0);
  assert.strictEqual(response.answer, "legacy ok");
}

async function run() {
  await testRunsTransportIsTheDefaultPath();
  await testRollbackFlagRestoresLegacyOracle();
  console.log("test-xiaofu-runs-transport: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  agentRunClient.createRun = originalCreateRun;
  agentRunClient.pollRunUntilDone = originalPoll;
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = originalFlag;
});
